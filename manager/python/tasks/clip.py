import traceback
from uuid import uuid4

import dramatiq
from dramatiq.middleware import TimeLimitExceeded
from psycopg2 import sql

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
def clip(
    input_table: str,
    clip_table: str,
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
                    cur, "Clip"
                )

                # fetch input table column names and types except geom
                cur.execute(
                    "SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name=%s AND column_name<>'geom'",
                    [input_table],
                )
                columns = cur.fetchall()
                logger.info("Column types fetched")

                # fetch input layer configuration
                cur.execute(
                    "SELECT geometry_type FROM vector_tiles WHERE layer_name=%s",
                    [input_table],
                )
                layer_config = cur.fetchone()
                layer_config = list(layer_config)
                if layer_config[0] in ["POLYGON", "MULTIPOLYGON"]:
                    dim = 3
                elif layer_config[0] in ["LINESTRING", "MULTILINESTRING"]:
                    dim = 2
                else:
                    dim = 1
                logger.info("Layer config fetched")

                # create table with serial fid
                columns_sql = ", ".join(
                    ["ogc_fid serial PRIMARY KEY"]
                    + [
                        (
                            f'"{column[0]}_old" {column[1]}'
                            if column[0].startswith("ogc_fid")
                            else f'"{column[0]}" {column[1]}'
                        )
                        for column in columns
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
                cur.execute(
                    sql.SQL(
                        """ INSERT INTO {output_table} ({output_fields},geom)
                            WITH u AS (
                              SELECT ST_Union(geom) geom
                              FROM {clip_table}
                            )
                            SELECT *
                            FROM (
                              SELECT {input_fields},ST_Multi(CASE WHEN ST_Covers(u.geom,i.geom) THEN i.geom ELSE ST_CollectionExtract(ST_Intersection(u.geom,i.geom),{dim}) END) geom
                              FROM {input_table} i
                              INNER JOIN u ON ST_Intersects(u.geom,i.geom)
                              {filter_query}
                            ) clipped
                            WHERE NOT ST_IsEmpty(geom) """
                    ).format(
                        output_table=output_table_ident,
                        output_fields=sql.SQL(",").join(
                            (
                                sql.Identifier(column[0] + "_old")
                                if column[0].startswith("ogc_fid")
                                else sql.Identifier(column[0])
                            )
                            for column in columns
                        ),
                        clip_table=sql.Identifier(clip_table),
                        input_fields=sql.SQL(",").join(
                            sql.Identifier(column[0]) for column in columns
                        ),
                        dim=sql.Literal(dim),
                        input_table=sql.Identifier(input_table),
                        filter_query=(
                            sql.SQL("WHERE {}").format(
                                sql.SQL(" AND ").join(parse_filter("i", filter))
                            )
                            if filter
                            else sql.SQL("")
                        ),
                    )
                )
                logger.info("New table created")

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
                new_layer_config = [
                    (
                        layer_config[0]
                        if layer_config[0].startswith("MULTI")
                        else "MULTI" + layer_config[0]
                    ),
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
