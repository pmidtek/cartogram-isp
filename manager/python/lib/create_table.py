from lib.get_header_info import HeaderInfo
from utils import logger


def create_table_from_header_info(conn, header_info: HeaderInfo, table_name: str):
    # Mapping shapefile field types to PostgreSQL column types
    type_mapping = {
        "Integer": "integer",
        "IntegerList": "integer[]",
        "Real": "double precision",
        "RealList": "double precision[]",
        "String": "text",
        "StringList": "text[]",
        "Binary": "bytea",
        "Date": "date",
        "Time": "time with time zone",
        "DateTime": "timestamp with time zone",
        "Integer64": "bigint",
        "Integer64List": "bigint[]",
    }

    fields = header_info["fields"]
    # Adding an auto-incrementing primary key column and geom column for geometry; assuming 2D geometries in WGS 84 for now
    columns_sql = ", ".join(
        ["ogc_fid serial PRIMARY KEY"]
        + [
            f'"{field["name"].lower()}" {type_mapping.get(field["type"], "text")}'
            for field in fields
        ]
        + ["geom geometry(Geometry, 4326)"]
    )

    create_table_sql = f"""CREATE TABLE {table_name} ({columns_sql}); 
        CREATE INDEX IF NOT EXISTS {table_name}_geom_geom_idx ON {table_name} USING gist (geom);"""

    with conn:
        with conn.cursor() as cur:
            cur.execute(create_table_sql)
    logger.info("Create table based on header info")
