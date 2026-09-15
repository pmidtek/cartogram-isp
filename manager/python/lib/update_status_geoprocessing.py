from psycopg2.extensions import connection, cursor

from utils import logger
from .clear_directus_cache import clear_directus_cache


def update_status_geoprocessing(
    conn: connection,
    message_id: str = None,
    status: str = None,
    file_report: str = None,
):
    if not message_id or not status:
        return

    try:
        logger.info(f"Update geoprocessing_queue status : {status}")
        with conn.cursor() as cur:
            cur.execute(
                "UPDATE geoprocessing_queue SET status = %s, file_report = %s WHERE message_id = %s",
                [status, file_report, message_id],
            )
            clear_directus_cache()
    except Exception as e:
        logger.error(f"Failed to update geoprocessing_queue status: {e}")


def update_ftth_status(cur: cursor, project_id: int, is_generated: bool = True):
    cur.execute(
        "UPDATE project_map SET is_generated = %s WHERE id = %s",
        [is_generated, project_id],
    )
    logger.info("FTTH project is generated")
