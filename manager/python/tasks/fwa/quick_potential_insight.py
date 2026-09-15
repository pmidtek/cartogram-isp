import os
import random
import traceback
from uuid import uuid4
from datetime import datetime

import dramatiq
from dramatiq.middleware import TimeLimitExceeded

from psycopg2.extras import Json

from io import BytesIO
import pandas as pd

from shapely import wkt
from shapely.geometry import Point, mapping

from lib.clear_directus_cache import clear_directus_cache
from utils import logger, pool, minio_client

HS_CLASS_KEYS = ["high", "mid", "low", "very_low", "non_residential"]

# hs_class mapping reused for both variants
HS_CLASS_CASE = """
    CASE
        WHEN f.hs_class = 'A' THEN 'high'
        WHEN f.hs_class = 'B' THEN 'mid'
        WHEN f.hs_class = 'C' THEN 'low'
        WHEN f.hs_class = 'C1' THEN 'very_low'
        WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
        ELSE 'non_residential'
    END
"""

# Aggregation shared by both variants. {tower_buffer_cte} provides a `tower_buffer`
# CTE with columns: id, name, code, owner, latitude, longitude, geom, source.
SQL_POTENTIAL_TEMPLATE = """
    WITH tower_buffer AS (
        {tower_buffer_cte}
    ),
    fp_tower AS (
        SELECT
            f.ogc_fid,
            tb.id AS tower_id,
            {hs_class_case} AS hs_class
        FROM tower_buffer tb
        JOIN sp_data_footprint f
            ON f.geom && tb.geom AND ST_Intersects(f.geom, tb.geom)
        WHERE f.hs_class IS NOT NULL
    ),
    fp_count AS (
        SELECT ogc_fid, COUNT(DISTINCT tower_id) AS tower_cnt
        FROM fp_tower
        GROUP BY ogc_fid
    ),
    fp_joined AS (
        SELECT ft.tower_id, ft.ogc_fid, ft.hs_class, fc.tower_cnt
        FROM fp_tower ft
        JOIN fp_count fc ON ft.ogc_fid = fc.ogc_fid
    ),
    agg AS (
        SELECT
            tower_id,
            hs_class,
            COUNT(DISTINCT ogc_fid) AS full_cnt,
            COUNT(DISTINCT ogc_fid) FILTER (WHERE tower_cnt = 1) AS main_cnt,
            COUNT(DISTINCT ogc_fid) FILTER (WHERE tower_cnt >= 2) AS shared_cnt
        FROM fp_joined
        GROUP BY tower_id, hs_class
    ),
    summary AS (
        SELECT
            tower_id,
            jsonb_object_agg(hs_class, full_cnt) AS fp_full,
            jsonb_object_agg(hs_class, main_cnt) AS fp_main,
            jsonb_object_agg(hs_class, shared_cnt) AS fp_shared,
            SUM(full_cnt) AS total_full
        FROM agg
        GROUP BY tower_id
    ),
    pair_shared AS (
        SELECT
            a.tower_id,
            b.tower_id AS other_id,
            COUNT(DISTINCT a.ogc_fid) AS cnt
        FROM fp_tower a
        JOIN fp_tower b ON a.ogc_fid = b.ogc_fid AND a.tower_id <> b.tower_id
        GROUP BY a.tower_id, b.tower_id
    ),
    shared_detail AS (
        SELECT
            ps.tower_id,
            jsonb_agg(
                jsonb_build_object(
                    'id', ps.other_id,
                    'name', tb2.name,
                    'code', tb2.code,
                    'owner', tb2.owner,
                    'source', tb2.source,
                    'count', ps.cnt
                ) ORDER BY ps.cnt DESC
            ) AS shared_towers
        FROM pair_shared ps
        JOIN tower_buffer tb2 ON tb2.id = ps.other_id
        GROUP BY ps.tower_id
    )
    SELECT
        tb.id, tb.name, tb.code, tb.owner, tb.latitude, tb.longitude,
        ST_AsText(tb.geom) AS geom_wkt, tb.source,
        s.fp_full, s.fp_main, s.fp_shared,
        COALESCE(s.total_full, 0) AS final_footprint_count,
        COALESCE(sd.shared_towers, '[]'::jsonb) AS shared_towers
    FROM tower_buffer tb
    LEFT JOIN summary s ON s.tower_id = tb.id
    LEFT JOIN shared_detail sd ON sd.tower_id = tb.id
    ORDER BY tb.id;
"""

# total distinct footprint across whole coverage (no double counting of shared fp)
SQL_TOTAL_FOOTPRINT_TEMPLATE = """
    WITH tower_buffer AS (
        {tower_buffer_cte}
    ),
    fp_tower AS (
        SELECT DISTINCT f.ogc_fid
        FROM tower_buffer tb
        JOIN sp_data_footprint f
            ON f.geom && tb.geom AND ST_Intersects(f.geom, tb.geom)
        WHERE f.hs_class IS NOT NULL
    )
    SELECT COUNT(*) FROM fp_tower;
"""

TOWER_BUFFER_DB = """
        SELECT
            sp.id, sp.name, sp.code, sp."owner",
            ST_X(geom) AS longitude, ST_Y(geom) AS latitude,
            ST_Buffer(sp.geom::geography, %s)::geometry AS geom,
            'database' AS source
        FROM site_points sp
        INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
        WHERE spt.name = 'Tower' AND sp.area_city_id = ANY(%s)
"""

TOWER_BUFFER_UPLOAD = """
        SELECT
            row_number() OVER () AS id,
            (feat->'properties'->>'name') AS name,
            (feat->'properties'->>'code') AS code,
            (feat->'properties'->>'owner') AS owner,
            (feat->'geometry'->'coordinates'->>0)::float AS longitude,
            (feat->'geometry'->'coordinates'->>1)::float AS latitude,
            ST_Buffer(ST_SetSRID(ST_MakePoint(
                (feat->'geometry'->'coordinates'->>0)::float,
                (feat->'geometry'->'coordinates'->>1)::float
            ), 4326)::geography, %s)::geometry AS geom,
            'upload' AS source
        FROM (SELECT %s::jsonb AS fc) geojson,
             jsonb_array_elements(fc->'features') AS feat
"""

SQL_GET_AREA_OGC_FID = """
    WITH geojson AS (
        SELECT %s::jsonb AS fc
    ),
    tower_geom AS (
        SELECT
            row_number() OVER () AS id,
            ST_SetSRID(ST_MakePoint(
                (feat->'geometry'->'coordinates'->>0)::float,
                (feat->'geometry'->'coordinates'->>1)::float
            ), 4326) AS geom
        FROM geojson, jsonb_array_elements(fc->'features') AS feat
    )
    SELECT DISTINCT ac.ogc_fid
    FROM tower_geom tg
    INNER JOIN area_cities ac ON ST_Intersects(tg.geom, ac.geom);
"""


def df_to_geojson(df, lat_col="latitude", lon_col="longitude"):
    features = []
    for _, row in df.iterrows():
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        row[lon_col],
                        row[lat_col],
                    ],
                },
                "properties": {
                    key: row[key] for key in df.columns if key not in [lat_col, lon_col]
                },
            }
        )
    geojson = {"type": "FeatureCollection", "features": features}
    return geojson


def random_color():
    return "#{:06x}".format(random.randint(0, 0xFFFFFF))


def to_hs_dict(j):
    j = j or {}
    return {k: int(j.get(k, 0)) for k in HS_CLASS_KEYS}


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


@dramatiq.actor(store_results=True)
def quick_potential_insight(
    mode: str,
    user: str,
    geoprocessing_uuid: str,
    radius: int,
    area_city_ids: list[int] | None,
    file_id: str | None,
    analysis_name: str | None = None,
):
    conn = None
    try:
        ## Validation ##
        if mode == "upload":
            if not file_id:
                raise ValueError("file_id required for upload mode")
        else:
            if not area_city_ids:
                raise ValueError("area_city_ids required for default mode")
            if len(area_city_ids) < 1 or len(area_city_ids) > 3:
                raise ValueError("area_city_ids must contain between 1 and 3 items")

        if radius > 500:
            raise ValueError("radius must not exceed 500 meters")
        if radius <= 0:
            raise ValueError("radius must be greater than zero")
        ## Validation ##

        conn = pool.getconn()

        if mode == "upload":
            bucket_name = os.environ.get("STORAGE_S3_BUCKET")
            storage_root = os.environ.get("STORAGE_S3_ROOT")
            object_name = f"{storage_root}/{file_id}"

            response = minio_client.get_object(bucket_name, object_name)
            file_stream = BytesIO(response.read())
            response.close()
            response.release_conn()

            df_upload = pd.read_csv(file_stream)
            geojson_data = df_to_geojson(df_upload)

            sql_main = SQL_POTENTIAL_TEMPLATE.format(
                tower_buffer_cte=TOWER_BUFFER_UPLOAD, hs_class_case=HS_CLASS_CASE
            )
            sql_total = SQL_TOTAL_FOOTPRINT_TEMPLATE.format(
                tower_buffer_cte=TOWER_BUFFER_UPLOAD
            )
            params = (radius, Json(geojson_data))

            with conn.cursor() as cur:
                cur.execute(SQL_GET_AREA_OGC_FID, (Json(geojson_data),))
                rows = cur.fetchall()
                area_city_ids = list({r[0] for r in rows})

                cur.execute(sql_main, params)
                rows = cur.fetchall()
                cols = [desc[0] for desc in cur.description]
                df = pd.DataFrame(rows, columns=cols)

                cur.execute(sql_total, params)
                total_footprint = int(cur.fetchone()[0] or 0)
        else:
            sql_main = SQL_POTENTIAL_TEMPLATE.format(
                tower_buffer_cte=TOWER_BUFFER_DB, hs_class_case=HS_CLASS_CASE
            )
            sql_total = SQL_TOTAL_FOOTPRINT_TEMPLATE.format(
                tower_buffer_cte=TOWER_BUFFER_DB
            )
            params = (radius, area_city_ids)

            with conn.cursor() as cur:
                cur.execute(sql_main, params)
                rows = cur.fetchall()
                cols = [desc[0] for desc in cur.description]
                df = pd.DataFrame(rows, columns=cols)

                cur.execute(sql_total, params)
                total_footprint = int(cur.fetchone()[0] or 0)

        ### BUILD GEOJSON TOWER & BUFFER ###
        tower_features = []
        buffer_features = []
        excel_rows = []
        for _, row in df.iterrows():
            tid = int(row["id"]) if not pd.isna(row["id"]) else None
            fp_full = to_hs_dict(row["fp_full"])
            fp_main = to_hs_dict(row["fp_main"])
            fp_shared = to_hs_dict(row["fp_shared"])
            final_count = int(row["final_footprint_count"])
            shared_towers = row["shared_towers"] or []
            color = random_color()

            tower_features.append(
                {
                    "type": "Feature",
                    "geometry": mapping(Point(row["longitude"], row["latitude"])),
                    "properties": {
                        "id": tid,
                        "name": row["name"],
                        "code": row["code"],
                        "owner": row["owner"],
                        "source": row["source"],
                        "color": color,
                        "fp_by_hs_class": fp_full,
                        "fp_by_hs_class_main": fp_main,
                        "fp_by_hs_class_shared": fp_shared,
                        "final_footprint_count": final_count,
                        "footprint_shared_tower_count": shared_towers,
                    },
                }
            )

            buffer_features.append(
                {
                    "type": "Feature",
                    "geometry": mapping(wkt.loads(row["geom_wkt"])),
                    "properties": {"id": tid, "color": color},
                }
            )

            excel_row = {
                "id": tid,
                "name": row["name"],
                "code": row["code"],
                "owner": row["owner"],
                "latitude": row["latitude"],
                "longitude": row["longitude"],
                "source": row["source"],
                "final_footprint_count": final_count,
            }
            for k in HS_CLASS_KEYS:
                excel_row[f"full_{k}"] = fp_full[k]
            for k in HS_CLASS_KEYS:
                excel_row[f"main_{k}"] = fp_main[k]
            for k in HS_CLASS_KEYS:
                excel_row[f"shared_{k}"] = fp_shared[k]
            excel_rows.append(excel_row)

        geojson_tower = {"type": "FeatureCollection", "features": tower_features}
        geojson_buffer = {"type": "FeatureCollection", "features": buffer_features}
        ### BUILD GEOJSON (END) ###

        ### STATISTICS & ANALYTICS ###
        if not df.empty:
            bounding_box = [
                float(df["longitude"].min()),
                float(df["latitude"].min()),
                float(df["longitude"].max()),
                float(df["latitude"].max()),
            ]
        else:
            bounding_box = None

        result = {
            "options": {
                "area_city_ids": area_city_ids,
                "radius": radius,
            },
            "bounding_box": bounding_box,
            "analytics": {
                "total_towers": len(df),
                "total_footprint": total_footprint,
            },
            "geojson_tower": geojson_tower,
            "geojson_buffer": geojson_buffer,
        }
        ### STATISTICS & ANALYTICS (END) ###

        ## UPLOAD EXCEL RESULT ##
        file_key = str(uuid4())
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if not analysis_name:
            analysis_name = f"qpi_result_{timestamp}"

        filename_disk = f"{file_key}.xlsx"
        filename_download = f"{analysis_name}.xlsx"

        df_excel = pd.DataFrame(excel_rows)
        df_excel = df_excel.sort_values(
            "final_footprint_count", ascending=False
        ).reset_index(drop=True)
        file_size = upload_df_excel_to_minio(df_excel, filename_disk)
        with conn:
            with conn.cursor() as cur:
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
                        analysis_name,
                        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        "6b67f608-122a-4264-99c1-0d226fc8499a",
                        user,
                        file_size,
                    ),
                )
        ## UPLOAD EXCEL DONE ##

        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO qpi_result(date_created, name, user_created, result, geoprocessing_uuid, excel)
                    VALUES (NOW(), %s, %s, %s, %s, %s)
                    RETURNING id;
                    """,
                    (analysis_name, user, Json(result), geoprocessing_uuid, file_key),
                )
                qmi_result_id = cur.fetchone()[0]

        message = {
            "options": {
                "mode": mode,
                "area_city_ids": area_city_ids,
                "radius": radius,
                "file_id": file_id,
            },
            "qmi_result_id": qmi_result_id,
            "status": "success",
        }

        logger.info(message)

        clear_directus_cache()
        return {"result": message}
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
