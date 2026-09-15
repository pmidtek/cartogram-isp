import os
import traceback

import dramatiq
from dramatiq.middleware import TimeLimitExceeded

from uuid import uuid4
from io import BytesIO
from datetime import datetime

from lib.clear_directus_cache import clear_directus_cache
from lib.update_status_geoprocessing import update_status_geoprocessing
from utils import logger, pool, minio_client


@dramatiq.actor(store_results=True)
def export_asset(uploader: str, site_type: str = "general", message_id: str = None):
    conn = None
    conn_auto = None

    try:
        conn = pool.getconn()
        conn_auto = pool.getconn()
        conn_auto.autocommit = True

        update_status_geoprocessing(conn_auto, message_id, "Preparing export")

        file_key = str(uuid4())
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

        filename_disk = f"{file_key}_{timestamp}.csv"
        filename_download = f"asset_{timestamp}.csv"

        bucket_name = os.environ.get("STORAGE_S3_BUCKET")
        storage_root = os.environ.get("STORAGE_S3_ROOT")

        object_name = f"{storage_root}/{filename_disk}"

        buffer = BytesIO()

        update_status_geoprocessing(
            conn_auto, message_id, "Streaming data from database"
        )

        if site_type == "general":
            site_type_ids = [1, 2, 4]
        elif site_type == "tower":
            site_type_ids = [3]
        else:
            site_type_ids = None

        with conn.cursor() as cur:
            if site_type_ids:
                ids_str = ",".join(str(x) for x in site_type_ids)
                where_clause = f"""
                    WHERE sp.site_point_type_id
                    IN ({ids_str})
                """
            else:
                where_clause = ""

            copy_sql = f"""
                COPY (
                    SELECT
                        a.*, sp.name AS site_point_name, sp.code AS site_point_code,
                        sp.owner, t.name AS asset_type_name,
                        ST_Y(sp.geom) AS latitude, ST_X(sp.geom) AS longitude,
                        c.city, c.province
                    FROM assets a
                    INNER JOIN site_points sp ON a.site_point_id = sp.id
                    LEFT JOIN asset_types t ON a.asset_type_id = t.id
                    LEFT JOIN  area_cities c ON sp.area_city_id = c.ogc_fid
                    {where_clause}
                    ORDER BY id
                )
                TO STDOUT
                WITH (
                    FORMAT CSV,
                    HEADER TRUE,
                    DELIMITER ',',
                    QUOTE '"'
                )
            """
            cur.copy_expert(copy_sql, buffer)

        buffer.seek(0)
        file_size = buffer.getbuffer().nbytes

        update_status_geoprocessing(conn_auto, message_id, "Uploading file to storage")

        minio_client.put_object(
            bucket_name=bucket_name,
            object_name=object_name,
            data=buffer,
            length=file_size,
            content_type="text/csv",
        )

        update_status_geoprocessing(conn_auto, message_id, "Registering file")

        with conn_auto.cursor() as cur:
            cur.execute(
                """
                INSERT INTO directus_files(
                    id,
                    storage,
                    filename_disk,
                    filename_download,
                    title,
                    type,
                    folder,
                    uploaded_by,
                    uploaded_on,
                    filesize
                )
                VALUES (%s,%s,%s,%s,%s,%s,%s,%s,NOW(),%s)
                RETURNING id;
                """,
                (
                    file_key,
                    "s3",
                    filename_disk,
                    filename_download,
                    filename_download,
                    "text/csv",
                    "2a444433-c697-4544-973f-6f60693e66c0",
                    uploader,
                    file_size,
                ),
            )

        update_status_geoprocessing(conn_auto, message_id, "File registered", file_key)

        clear_directus_cache()

        return {
            "result": "success",
            "file_key": file_key,
        }

    except Exception as err:
        error_traceback = traceback.format_exc()
        if isinstance(err, TimeLimitExceeded):
            error_message = "Time limit exceeded. File might be too big."
        else:
            error_message = str(err)
            logger.error(error_traceback)
        return {
            "error": error_message,
            "traceback": error_traceback,
        }
    finally:
        if conn:
            pool.putconn(conn)
        if conn_auto:
            pool.putconn(conn_auto)
