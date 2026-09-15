import os
import traceback
import json
from uuid import uuid4

from io import BytesIO
import pandas as pd


import dramatiq
from dramatiq.middleware import TimeLimitExceeded

from lib.clear_directus_cache import clear_directus_cache
from lib.import_file_to_directus import import_file_to_directus, normalize_drive_url
from lib.parse_kml import parse_kml_points
from lib.update_status_geoprocessing import update_status_geoprocessing

from utils import logger, pool, minio_client


def clean_value(v):
    if pd.isna(v):
        return None
    if isinstance(v, str):
        s = v.strip()
        if s.lower() in ["nan", "none", "null", "", "-", " "]:
            return None
        return s
    return v


def clean_value_update(v):
    if pd.isna(v):
        return None
    if isinstance(v, str):
        s = v.strip()
        if s.lower() in ["nan", "none", "null", ""]:
            return None
        if s == "-":
            return "-"
        return s
    return v


def upload_df_excel_to_minio(df, object_name):
    bucket_name = os.environ.get("STORAGE_S3_BUCKET")
    storage_root = os.environ.get("STORAGE_S3_ROOT")
    object_name = f"{storage_root}/{object_name}"

    buffer = BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        df.to_excel(writer, index=False)

    buffer.seek(0)
    file_bytes = buffer.getbuffer()
    file_size = len(file_bytes)

    minio_client.put_object(
        bucket_name=bucket_name,
        object_name=object_name,
        data=buffer,
        length=file_size,
        content_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )

    return file_size


def read_site_point_input(file_stream, object_key):
    """Read the uploaded file into a DataFrame.

    Returns the DataFrame plus the offset that turns a 0-based DataFrame index
    into the number shown on the failure report (spreadsheet row for .xlsx,
    placemark number for .kml/.kmz).
    """
    ext = os.path.splitext(object_key)[1].lower()
    if ext in [".kml", ".kmz"]:
        return parse_kml_points(file_stream.read()), 1
    return pd.read_excel(file_stream), 2


@dramatiq.actor(store_results=True)
def import_site_point(
    object_key: str,
    uploader: str,
    message_id: str = None,
    site_point_type_id: int = None,
):
    seq_conn = None
    main_conn = None
    try:
        bucket_name = os.environ.get("STORAGE_S3_BUCKET")
        storage_root = os.environ.get("STORAGE_S3_ROOT")
        object_name = f"{storage_root}/{object_key}"

        response = minio_client.get_object(bucket_name, object_name)
        file_stream = BytesIO(response.read())
        response.close()
        response.release_conn()

        df, row_offset = read_site_point_input(file_stream, object_key)
        if df.empty:
            raise ValueError("File kosong atau tidak memiliki data.")

        # KML/KMZ carries no type column, so the value picked on upload is used
        # as the default for rows that do not define one themselves.
        if site_point_type_id is not None:
            if "site_point_type_id" in df.columns:
                df["site_point_type_id"] = df["site_point_type_id"].fillna(
                    site_point_type_id
                )
            else:
                df["site_point_type_id"] = site_point_type_id

        exclude_cols = [
            "name",
            "code",
            "site_point_type_id",
            "description",
            "owner",
            "latitude",
            "longitude",
        ]
        extra_cols = [c for c in df.columns if c not in exclude_cols]
        df["other_attributes"] = df.apply(
            lambda row: json.dumps(
                [{"label": c, "value": row[c]} for c in extra_cols if pd.notna(row[c])]
            ),
            axis=1,
        )
        valid_cols = [c for c in exclude_cols if c in df.columns]
        df = df[valid_cols + ["other_attributes"]]
        df = df.map(clean_value)

        seq_conn = pool.getconn()
        seq_conn.autocommit = True
        main_conn = pool.getconn()

        get_area_info = """
            WITH c AS (
                SELECT city_id
                FROM area_cities
                WHERE ST_Covers(geom,ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
                LIMIT 1
            ), next_seq AS (
                UPDATE area_cities ac
                SET site_seq = ac.site_seq + 1
                WHERE ac.city_id = (SELECT city_id FROM c)
                RETURNING ac.ogc_fid, ac.city_id, ac.site_seq
            ) SELECT
                next_seq.ogc_fid,
                CONCAT(replace(next_seq.city_id, '.', ''), '-', next_seq.site_seq) AS site_code
                FROM next_seq;
        """
        insert_site_point = """
            INSERT INTO site_points (
                user_created, date_created,
                name, code, site_point_type_id,
                owner, area_city_id, geom,
                description, other_attributes)
            VALUES (
                %s, NOW(),
                %s, %s, %s,
                %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                %s, %s
            );
        """

        required_cols = ["latitude", "longitude", "site_point_type_id"]
        invalid_rows = []
        total_valid = 0
        with main_conn:
            with main_conn.cursor() as cur_main, seq_conn.cursor() as cur_seq:
                for index, row in df.iterrows():
                    if any(pd.isna(row.get(c)) for c in required_cols):
                        invalid_rows.append(
                            {
                                "row": index + row_offset,
                                "reason": "Missing latitude/longitude/site_point_type_id",
                                **row.to_dict(),
                            }
                        )
                        continue

                    lat, lon = row.get("latitude"), row.get("longitude")
                    try:
                        lat = float(lat)
                        lon = float(lon)
                    except Exception:
                        invalid_rows.append(
                            {
                                "row": index + row_offset,
                                "reason": "Invalid latitude/longitude",
                                **row.to_dict(),
                            }
                        )
                        continue
                    geom = {"type": "Point", "coordinates": [lon, lat]}

                    cur_seq.execute(get_area_info, [json.dumps(geom)])
                    area_result = cur_seq.fetchone()
                    if not area_result or not all(area_result):
                        invalid_rows.append(
                            {
                                "row": index + row_offset,
                                "reason": "Area not found for coordinates",
                                **row.to_dict(),
                            }
                        )
                        continue

                    area_city_id, site_code = area_result
                    code = (
                        row.get("code")
                        if row.get("code") and str(row.get("code")).strip()
                        else site_code
                    )
                    name = (
                        row.get("name")
                        if row.get("name") and str(row.get("name")).strip()
                        else code
                    )

                    cur_main.execute(
                        insert_site_point,
                        [
                            uploader,
                            name,
                            code,
                            row.get("site_point_type_id"),
                            row.get("owner"),
                            area_city_id,
                            json.dumps(geom),
                            row.get("description"),
                            row.get("other_attributes"),
                        ],
                    )
                    total_valid += 1

        messages = "success"
        if invalid_rows:
            df_invalid = pd.DataFrame(invalid_rows)
            file_key = str(uuid4())
            logger.info(file_key)
            filename_disk = f"{file_key}.xlsx"
            filename_download = f"failed_upload_site.xlsx"
            file_size = upload_df_excel_to_minio(df_invalid, filename_disk)
            with seq_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO directus_files(id, storage, filename_disk, filename_download, title, type, folder, uploaded_by, uploaded_on, filesize)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
                    RETURNING id;
                    """,
                    (
                        file_key,
                        "s3",
                        filename_disk,
                        filename_download,
                        "failed_upload_site",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "2a444433-c697-4544-973f-6f60693e66c0",
                        uploader,
                        file_size,
                    ),
                )
            update_status_geoprocessing(
                seq_conn, message_id, "genarate file report", file_key
            )
            messages = "success with invalid"

        clear_directus_cache()
        result = {
            "result": messages,
            "total_valid": total_valid,
            "total_invalid": len(invalid_rows),
        }
        # logger.info(result)
        return result
    except Exception as err:
        error_traceback = traceback.format_exc()
        if isinstance(err, TimeLimitExceeded):
            error_message = "Time limit exceeded. File might be too big to process."
        else:
            error_message = str(err)
            logger.error(error_traceback)
        return {"error": error_message, "traceback": error_traceback}
    finally:
        # cleanup
        if seq_conn:
            pool.putconn(seq_conn)
        if main_conn:
            pool.putconn(main_conn)


@dramatiq.actor(store_results=True)
def register_asset(
    object_key: str,
    uploader: str,
    message_id: str = None,
):
    conn = None
    auto_conn = None
    try:
        bucket_name = os.environ.get("STORAGE_S3_BUCKET")
        storage_root = os.environ.get("STORAGE_S3_ROOT")
        object_name = f"{storage_root}/{object_key}"

        response = minio_client.get_object(bucket_name, object_name)
        file_stream = BytesIO(response.read())
        response.close()
        response.release_conn()

        df = pd.read_excel(file_stream)
        if df.empty:
            raise ValueError("File Excel kosong atau tidak memiliki data.")

        exclude_cols = [
            "site_point_id",
            "name",
            "code",
            "asset_type_id",
            "description",
            "location",
            "location_detail",
            "tag_id",
            "rfid",
            "serial_number",
            "date_of_purchase",
            "date_of_install",
            "date_of_service",
            "date_of_warranty_expiration",
            "date_of_last_inspection",
            "last_inspected_by",
            "date_of_maintenance_expiration",
            "maintenance_by",
            "service_log_ticket_number",
        ]
        attachment_cols = [c for c in df.columns if str(c).startswith("attachment_")]
        extra_cols = [
            c for c in df.columns if c not in exclude_cols and c not in attachment_cols
        ]
        df["other_attributes"] = df.apply(
            lambda row: json.dumps(
                [{"label": c, "value": row[c]} for c in extra_cols if pd.notna(row[c])]
            ),
            axis=1,
        )
        df = df[
            [c for c in exclude_cols if c in df.columns]
            + ["other_attributes"]
            + attachment_cols
        ]
        df = df.map(clean_value)

        required_cols = ["site_point_id", "asset_type_id"]
        missing_required = [c for c in required_cols if c not in df.columns]
        if missing_required:
            raise ValueError(
                f"Kolom wajib berikut tidak ada di file Excel: {missing_required}"
            )

        all_cols = exclude_cols + ["other_attributes"]
        valid_cols = [c for c in all_cols if c in df.columns]
        missing_cols = [c for c in all_cols if c not in df.columns]
        if missing_cols:
            logger.warning(f"Kolom berikut tidak ditemukan di Excel: {missing_cols}")

        placeholders = ", ".join(["%s"] * len(valid_cols))
        columns_sql = ", ".join(valid_cols)

        insert_asset = f"""
            INSERT INTO assets (
                user_created, date_created,
                {columns_sql}
            ) VALUES (
                %s, NOW(),
                {placeholders}
            ) RETURNING id;
        """
        conn = pool.getconn()
        invalid_rows = []
        total_valid = 0
        with conn:
            with conn.cursor() as cur:
                for index, row in df.iterrows():
                    try:
                        for col in required_cols:
                            if col not in row or pd.isna(row[col]):
                                raise ValueError(
                                    f"Kolom {col} kosong di baris {index+2}"
                                )
                    except Exception as e:
                        invalid_rows.append(
                            {
                                "row": index + 2,
                                "reason": str(e),
                                **row.to_dict(),
                            }
                        )
                        continue
                    # INSERT assets
                    row_values = []
                    for c in valid_cols:
                        v = row.get(c)
                        if pd.isna(v):
                            v = None
                        row_values.append(v)

                    values = [uploader] + row_values

                    site_point_id = row.get("site_point_id")
                    cur.execute(
                        "SELECT id FROM site_points WHERE id = %s",
                        (site_point_id,),
                    )
                    if cur.fetchone() is None:
                        invalid_rows.append(
                            {
                                "row": index + 2,
                                "reason": f"site_point_id {site_point_id} tidak ditemukan",
                                **row.to_dict(),
                            }
                        )
                        continue
                    cur.execute(insert_asset, values)
                    inserted_asset_id = cur.fetchone()[0]

                    # INSERT assets_files
                    if not attachment_cols:
                        continue

                    for col in attachment_cols:
                        label = str(col).replace("attachment_", "").strip()
                        url_file = row.get(col)

                        if url_file in (None, ""):
                            continue

                        directus_file_id = import_file_to_directus(
                            url_file=url_file,
                        )

                        if not directus_file_id:
                            logger.warning(
                                f"Gagal import attachment. asset_id={inserted_asset_id}, label={label}"
                            )
                            continue

                        cur.execute(
                            """
                            INSERT INTO assets_files (assets_id, directus_files_id, label)
                            VALUES (%s, %s, %s)
                            """,
                            (inserted_asset_id, directus_file_id, label),
                        )
                    total_valid += 1

        auto_conn = pool.getconn()
        auto_conn.autocommit = True
        messages = "success"
        if invalid_rows:
            df_invalid = pd.DataFrame(invalid_rows)
            file_key = str(uuid4())
            logger.info(file_key)
            filename_disk = f"{file_key}.xlsx"
            filename_download = f"failed_register_asset.xlsx"
            file_size = upload_df_excel_to_minio(df_invalid, filename_disk)
            with auto_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO directus_files(id, storage, filename_disk, filename_download, title, type, folder, uploaded_by, uploaded_on, filesize)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
                    RETURNING id;
                    """,
                    (
                        file_key,
                        "s3",
                        filename_disk,
                        filename_download,
                        "failed_register_asset",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "2a444433-c697-4544-973f-6f60693e66c0",
                        uploader,
                        file_size,
                    ),
                )
            update_status_geoprocessing(
                auto_conn, message_id, "genarate file report", file_key
            )
            messages = "success with invalid"

        clear_directus_cache()
        result = {
            "result": messages,
            "total_valid": total_valid,
            "total_invalid": len(invalid_rows),
        }
        logger.info(result)
        return {"result": result}
    except Exception as err:
        error_traceback = traceback.format_exc()
        if isinstance(err, TimeLimitExceeded):
            error_message = "Time limit exceeded. File might be too big to process."
        else:
            error_message = str(err)
            logger.error(error_traceback)
        return {"error": error_message, "traceback": error_traceback}
    finally:
        # cleanup
        if conn:
            pool.putconn(conn)
        if auto_conn:
            pool.putconn(auto_conn)


@dramatiq.actor(store_results=True)
def update_asset(
    object_key: str,
    uploader: str,
    message_id: str = None,
):
    conn = None
    auto_conn = None
    try:
        bucket_name = os.environ.get("STORAGE_S3_BUCKET")
        storage_root = os.environ.get("STORAGE_S3_ROOT")
        object_name = f"{storage_root}/{object_key}"

        response = minio_client.get_object(bucket_name, object_name)
        file_stream = BytesIO(response.read())
        response.close()
        response.release_conn()

        df = pd.read_excel(file_stream)
        if df.empty:
            raise ValueError("File Excel kosong atau tidak memiliki data.")

        valid_cols = [
            "id",
            "name",
            "code",
            "description",
            "location",
            "location_detail",
            "tag_id",
            "rfid",
            "serial_number",
            "date_of_purchase",
            "date_of_install",
            "date_of_service",
            "date_of_warranty_expiration",
            "date_of_last_inspection",
            "last_inspected_by",
            "date_of_maintenance_expiration",
            "maintenance_by",
            "service_log_ticket_number",
        ]

        attachment_cols = [c for c in df.columns if str(c).startswith("attachment_")]

        df = df[[c for c in valid_cols if c in df.columns] + attachment_cols]
        df = df.map(clean_value_update)

        required_cols = ["id"]
        missing_required = [c for c in required_cols if c not in df.columns]
        if missing_required:
            raise ValueError(
                f"Kolom wajib berikut tidak ada di file Excel: {missing_required}"
            )

        missing_cols = [c for c in valid_cols if c not in df.columns]
        if missing_cols:
            logger.warning(f"Kolom berikut tidak ditemukan di Excel: {missing_cols}")

        updatable_cols = [
            c for c in df.columns if c != "id" and not c.startswith("attachment_")
        ]
        if not updatable_cols and not attachment_cols:
            raise ValueError("Tidak ada kolom update (assets maupun attachment).")

        conn = pool.getconn()
        invalid_rows = []
        total_valid = 0
        with conn:
            with conn.cursor() as cur:
                for index, row in df.iterrows():
                    asset_id = row.get("id")
                    try:
                        if asset_id in (None, ""):
                            raise ValueError(f"Kolom id kosong di baris {index+2}")
                    except Exception as e:
                        invalid_rows.append(
                            {
                                "row": index + 2,
                                "reason": str(e),
                                **row.to_dict(),
                            }
                        )
                        continue

                    # 1) UPDATE assets
                    set_cols = []
                    set_values = []
                    for c in updatable_cols:
                        v = row.get(c)
                        if pd.isna(v):
                            v = None
                        if isinstance(v, str) and v.strip() == "-":
                            set_cols.append(f"{c} = %s")
                            set_values.append(None)
                            continue
                        if v is None:
                            continue

                        set_cols.append(f"{c} = %s")
                        set_values.append(v)

                    if not set_cols:
                        continue

                    cur.execute(
                        "SELECT id FROM assets WHERE id = %s",
                        (asset_id,),
                    )
                    if cur.fetchone() is None:
                        invalid_rows.append(
                            {
                                "row": index + 2,
                                "reason": f"asset_id {asset_id} tidak ditemukan",
                                **row.to_dict(),
                            }
                        )
                        continue

                    update_sql = f"""
                        UPDATE assets
                        SET
                            user_updated = %s,
                            date_updated = NOW(),
                            {", ".join(set_cols)}
                        WHERE id = %s;
                    """

                    values = [uploader] + set_values + [asset_id]
                    cur.execute(update_sql, values)

                    # 2) UPDATE assets_files (attachment)
                    if not attachment_cols:
                        continue

                    for col in attachment_cols:
                        label = str(col).replace("attachment_", "").strip()
                        url_file = row.get(col)

                        # kosong -> skip
                        if url_file in (None, ""):
                            continue

                        # import url -> directus file id
                        directus_file_id = import_file_to_directus(
                            url_file=url_file,
                        )
                        if not directus_file_id:
                            logger.warning(
                                f"Gagal import attachment. asset_id={asset_id}, label={label}"
                            )
                            continue

                        cur.execute(
                            """
                            SELECT id
                            FROM assets_files
                            WHERE assets_id = %s AND label = %s
                            LIMIT 1
                            """,
                            (asset_id, label),
                        )
                        existing = cur.fetchone()
                        if existing:
                            assets_files_id = existing[0]
                            cur.execute(
                                """
                                UPDATE assets_files
                                SET directus_files_id = %s
                                WHERE id = %s
                                """,
                                (directus_file_id, assets_files_id),
                            )
                        else:
                            cur.execute(
                                """
                                INSERT INTO assets_files (assets_id, directus_files_id, label)
                                VALUES (%s, %s, %s)
                                """,
                                (asset_id, directus_file_id, label),
                            )
                    total_valid += 1

        auto_conn = pool.getconn()
        auto_conn.autocommit = True
        messages = "success"
        if invalid_rows:
            df_invalid = pd.DataFrame(invalid_rows)
            file_key = str(uuid4())
            logger.info(file_key)
            filename_disk = f"{file_key}.xlsx"
            filename_download = f"failed_update_asset.xlsx"
            file_size = upload_df_excel_to_minio(df_invalid, filename_disk)
            with auto_conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO directus_files(id, storage, filename_disk, filename_download, title, type, folder, uploaded_by, uploaded_on, filesize)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW(), %s)
                    RETURNING id;
                    """,
                    (
                        file_key,
                        "s3",
                        filename_disk,
                        filename_download,
                        "failed_update_asset",
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "2a444433-c697-4544-973f-6f60693e66c0",
                        uploader,
                        file_size,
                    ),
                )
            update_status_geoprocessing(
                auto_conn, message_id, "genarate file report", file_key
            )
            messages = "success with invalid"

        clear_directus_cache()
        result = {
            "result": messages,
            "total_valid": total_valid,
            "total_invalid": len(invalid_rows),
        }
        logger.info(result)
        clear_directus_cache()
        return {"result": result}
    except Exception as err:
        error_traceback = traceback.format_exc()
        if isinstance(err, TimeLimitExceeded):
            error_message = "Time limit exceeded. File might be too big to process."
        else:
            error_message = str(err)
            logger.error(error_traceback)
        return {"error": error_message, "traceback": error_traceback}
    finally:
        # cleanup
        if conn:
            pool.putconn(conn)
        if auto_conn:
            pool.putconn(auto_conn)
