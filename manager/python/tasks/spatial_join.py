import traceback
from uuid import uuid4

import dramatiq
from dramatiq.middleware import TimeLimitExceeded
from psycopg2 import sql
from psycopg2.extras import Json

from lib.clear_directus_cache import clear_directus_cache
from lib.fetch_geoprocessing_default_values import (
    fetch_geoprocessing_default_values,
)
from lib.parse_filter import parse_filter
from utils import (
    logger,
    pool,
    is_dev_mode,
)


@dramatiq.actor(store_results=True, time_limit=1800000)
def spatial_join(
    target_table: str,
    join_table: str,
    output_table: str,
    user_id: str,
    filter: list[dict] | None,
):
    conn = None
    try:
        conn = pool.getconn()
        with conn:
            with conn.cursor() as cur:
                (category_id, fill_style) = fetch_geoprocessing_default_values(
                    cur, "Spatial Join"
                )

                # fetch input table column names and types except geom column
                cur.execute(
                    sql.SQL(
                        "SELECT table_name,json_object_agg(column_name,data_type) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ({tables}) AND column_name<>'geom' GROUP BY table_name"
                    ).format(
                        tables=sql.SQL(",").join(
                            sql.Literal(table) for table in [target_table, join_table]
                        )
                    )
                )
                table_columns = cur.fetchall()
                logger.info("Columns fetched")

                # create table with serial fid
                columns_sql = ", ".join(
                    ["ogc_fid serial PRIMARY KEY"]
                    + [
                        f'"{col_name}_{table_name}" {col_type}'
                        for table_name, columns in table_columns
                        for col_name, col_type in columns.items()
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

                cur.execute(
                    sql.SQL(
                        """ INSERT INTO {output_table} ({output_fields},geom)
                            SELECT {input_fields},{target_table}.geom
                            FROM {target_table}
                            LEFT JOIN {join_table} ON ST_Intersects({target_table}.geom,{join_table}.geom)
                            {filter} """
                    ).format(
                        output_table=output_table_ident,
                        output_fields=sql.SQL(",").join(
                            sql.Identifier(f"{col_name}_{table_name}")
                            for table_name, columns in table_columns
                            for col_name in columns
                        ),
                        input_fields=sql.SQL(",").join(
                            sql.Identifier(table_name, col_name)
                            for table_name, columns in table_columns
                            for col_name in columns
                        ),
                        target_table=sql.Identifier(target_table),
                        join_table=sql.Identifier(join_table),
                        filter=(
                            sql.SQL("WHERE {}").format(
                                sql.SQL(" AND ").join(
                                    parse_filter(target_table, filter)
                                )
                            )
                            if filter
                            else sql.SQL("")
                        ),
                    )
                )
                logger.info("Data inserted")

                # fetch input layer configuration
                cur.execute(
                    "SELECT geometry_type,bounds FROM vector_tiles WHERE layer_name=%s",
                    [target_table],
                )
                layer_config = cur.fetchone()
                layer_config = list(layer_config)
                logger.info("Layer config fetched")

                # change bounds dict into json
                if layer_config[1]:
                    layer_config[1] = Json(layer_config[1])

                # set new data
                layer_id = str(uuid4())
                new_layer_config = layer_config + [
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
