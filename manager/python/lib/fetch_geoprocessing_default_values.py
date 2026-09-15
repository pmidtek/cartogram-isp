from psycopg2.extensions import cursor

from utils import logger


def fetch_geoprocessing_default_values(cur: cursor, category_name: str):
    cur.execute(
        "SELECT category_id FROM categories WHERE category_name = %s LIMIT 1",
        [category_name],
    )
    category_id: tuple[str] | None = cur.fetchone()
    if not category_id:
        raise Exception(f'Missing "{category_name}" category')

    cur.execute("SELECT id FROM fill WHERE name = 'default-geoprocessing'")
    fill_style: tuple[int] | None = cur.fetchone()
    if not fill_style:
        raise Exception('Missing "default-geoprocessing" fill style')

    logger.info("Category and role id fetched")
    return (category_id[0], fill_style[0])
