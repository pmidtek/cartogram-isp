import traceback
from uuid import uuid4

import dramatiq
from dramatiq.middleware import TimeLimitExceeded
from psycopg2 import sql

from lib.clear_directus_cache import clear_directus_cache
from lib.fetch_geoprocessing_default_values import (
    fetch_geoprocessing_default_values,
)
from utils import (
    logger,
    pool,
    is_dev_mode,
)


@dramatiq.actor(store_results=True, time_limit=1800000)
def merge(
    input_table: list[str],
    output_table: str,
    user_id: str,
):
    conn = None
    try:
        conn = pool.getconn()
        with conn:
            with conn.cursor() as cur:
                (category_id, fill_style) = fetch_geoprocessing_default_values(
                    cur, "Merge"
                )

                # fetch input table column names and types except ogc_fid and geom column
                cur.execute(
                    sql.SQL(
                        "SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN ({input_tables}) AND column_name NOT IN ('ogc_fid','geom')"
                    ).format(
                        input_tables=sql.SQL(",").join(
                            sql.Literal(table) for table in input_table
                        )
                    )
                )
                tables_columns_types = cur.fetchall()
                logger.info("Columns fetched")

                # build unique output column dict and input column list
                input_table_columns = {table_name: [] for table_name in input_table}
                output_column_names_types: dict[str, str] = {}
                for table_name, column_name, data_type in tables_columns_types:
                    output_column_names_types[column_name] = data_type
                    input_table_columns[table_name].append(column_name)

                # create table with serial fid
                columns_sql = ", ".join(
                    ["ogc_fid serial PRIMARY KEY"]
                    + [
                        f'"{col_name}" {col_type}'
                        for col_name, col_type in output_column_names_types.items()
                    ]
                    + ["geom geometry(Geometry, 4326)"]
                )
                output_table_ident = sql.Identifier(output_table)
                cur.execute(
                    sql.SQL("CREATE TABLE {output_table} ({columns_sql})").format(
                        output_table=output_table_ident,
                        columns_sql=sql.SQL(columns_sql),
                    )
                )
                cur.execute(
                    sql.SQL(
                        "CREATE INDEX IF NOT EXISTS {idx_name} ON {output_table} USING gist (geom)"
                    ).format(
                        idx_name=sql.Identifier(f"{output_table}_geom_geom_idx"),
                        output_table=output_table_ident,
                    )
                )
                logger.info("Table created")

                # insert data
                select_queries: list[sql.Composable] = []
                for table_name in input_table_columns.keys():
                    select_columns: list[sql.Composable] = []
                    for col_name in output_column_names_types.keys():
                        if col_name in input_table_columns[table_name]:
                            select_columns.append(sql.Identifier(col_name))
                        else:
                            select_columns.append(sql.Literal(None))
                    select_queries.append(
                        sql.SQL(
                            "SELECT {select_columns},geom FROM {input_table}"
                        ).format(
                            select_columns=sql.SQL(",").join(select_columns),
                            input_table=sql.Identifier(table_name),
                        )
                    )
                cur.execute(
                    sql.SQL(
                        "INSERT INTO {output_table} ({output_fields},geom) {select_queries}"
                    ).format(
                        output_table=output_table_ident,
                        output_fields=sql.SQL(",").join(
                            sql.Identifier(col_name)
                            for col_name in output_column_names_types.keys()
                        ),
                        select_queries=sql.SQL(" UNION ALL ").join(select_queries),
                    )
                )
                logger.info("Data inserted")

                # fetch input layer configuration
                cur.execute(
                    "SELECT geometry_type FROM vector_tiles WHERE layer_name=%s",
                    [input_table[0]],
                )
                layer_config = cur.fetchone()
                layer_config = list(layer_config)
                logger.info("Layer config fetched")

                # get new bounding box
                cur.execute(
                    sql.SQL(
                        "SELECT ST_AsGeoJSON(ST_Extent(geom)::geometry) FROM {output_table}"
                    ).format(output_table=output_table_ident)
                )
                (new_bounds,) = cur.fetchone()
                if new_bounds is None:
                    raise Exception("Geoprocessing result does not have any geometry")

                # set new data
                layer_id = str(uuid4())
                new_layer_config = layer_config + [
                    new_bounds,
                    category_id,
                    True,
                    "roles",
                    fill_style,
                    output_table,
                    user_id,
                    output_table.replace("_", " ").title(),
                    layer_id,
                ]

                # register to vector_tiles
                cur.execute(
                    sql.SQL(
                        "INSERT INTO vector_tiles(geometry_type,bounds,category,listed,permission_type,fill_style,layer_name,user_created,layer_alias,layer_id) VALUES({})"
                    ).format(
                        sql.SQL(",").join(sql.Placeholder() * len(new_layer_config))
                    ),
                    new_layer_config,
                )
                logger.info("Registered to vector_tiles")

        if not is_dev_mode():
            clear_directus_cache()

        return {"layer_id": layer_id}
    except Exception as err:
        error_traceback = traceback.format_exc()
        if isinstance(err, TimeLimitExceeded):
            error_message = "Time limit exceeded. File might be too big to process."
        else:
            error_message = str(err)
            logger.error(error_traceback)
        return {"error": error_message, "traceback": error_traceback}
    finally:
        if conn:
            pool.putconn(conn)
