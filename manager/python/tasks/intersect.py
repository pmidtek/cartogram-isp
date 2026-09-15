import traceback
from uuid import uuid4

import dramatiq
from dramatiq.middleware import TimeLimitExceeded
from psycopg2 import sql

from lib.clear_directus_cache import clear_directus_cache
from lib.fetch_geoprocessing_default_values import (
    fetch_geoprocessing_default_values,
)
from lib.build_where_clause import build_where_clause
from utils import (
    logger,
    pool,
    is_dev_mode,
)


@dramatiq.actor(store_results=True, time_limit=1800000)
def intersect(
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
                    cur, "Intersect"
                )

                # fetch input layer configuration
                cur.execute(
                    sql.SQL(
                        "SELECT geometry_type FROM vector_tiles WHERE layer_name IN ({})"
                    ).format(
                        sql.SQL(",").join(sql.Literal(table) for table in input_table)
                    ),
                )
                layer_configs = cur.fetchall()
                geom_types = [row[0] for row in layer_configs]

                # set lowest geometry dimension as output dimension
                dim = 3
                output_geom_type = "MULTIPOLYGON"
                for geom_type in geom_types:
                    if geom_type in ["POINT", "MULTIPOINT"]:
                        dim = 1
                        output_geom_type = "MULTIPOINT"
                        break
                    elif geom_type in ["LINESTRING", "MULTILINESTRING"]:
                        dim = 2
                        output_geom_type = "MULTILINESTRING"
                logger.info("Layer config fetched")

                # fetch input table column names and types except geom column
                cur.execute(
                    sql.SQL(
                        "SELECT table_name,json_object_agg(column_name,data_type) FROM information_schema.columns WHERE table_schema='public' AND table_name IN ({input_tables}) AND column_name<>'geom' GROUP BY table_name"
                    ).format(
                        input_tables=sql.SQL(",").join(
                            sql.Literal(table.split("?")[0]) for table in input_table
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

                # insert data
                total_input_table = len(input_table)
                if total_input_table == 2:
                    select_query = sql.SQL(
                        """ SELECT *
                            FROM (
                              SELECT {input_fields},
                              ST_Multi(
                                    CASE
                                    WHEN ST_Covers({table_a}.geom,{table_b}.geom)
                                    THEN {table_b}.geom
                                    ELSE ST_CollectionExtract(
                                        ST_Intersection({table_a}.geom,{table_b}.geom), 
                                    %s)
                                    END
                                ) geom
                              FROM {table_a}
                              INNER JOIN {table_b}
                              ON ST_Intersects({table_a}.geom,{table_b}.geom)
                              {where_clause}
                            ) intersected
                            WHERE NOT ST_IsEmpty(geom); """
                    ).format(
                        input_fields=sql.SQL(",").join(
                            sql.Identifier(table_name, col_name)
                            for table_name, columns in table_columns
                            for col_name in columns
                        ),
                        table_a=sql.Identifier(input_table[0].split("?")[0]),
                        table_b=sql.Identifier(input_table[1].split("?")[0]),
                        where_clause=sql.SQL(build_where_clause(input_table))
                    )
                else:
                    # create intersection for first 2 table in cte
                    table_columns_selected = table_columns[0:2]
                    cte_queries = [
                        sql.SQL(
                            "WITH cte_1 AS (SELECT {input_fields},CASE WHEN ST_Covers({table_a}.geom,{table_b}.geom) THEN {table_b}.geom ELSE ST_Intersection({table_a}.geom,{table_b}.geom) END geom FROM {table_a} INNER JOIN {table_b} ON ST_Intersects({table_a}.geom,{table_b}.geom))"
                        ).format(
                            input_fields=sql.SQL(",").join(
                                sql.SQL("{} {}").format(
                                    sql.Identifier(table_name, col_name),
                                    sql.Identifier(f"{col_name}_{table_name}"),
                                )
                                for table_name, columns in table_columns_selected
                                for col_name in columns
                            ),
                            table_a=sql.Identifier(input_table[0]),
                            table_b=sql.Identifier(input_table[1]),
                        )
                    ]

                    # rest of the table
                    cte_count = 2
                    for i, table_column in enumerate(table_columns[2:], 2):
                        (current_table_name, current_columns) = table_column
                        if i != total_input_table - 1:
                            # append to cte query if not last input table
                            cte_queries.append(
                                sql.SQL(
                                    "{cte_name} AS (SELECT {input_fields},CASE WHEN ST_Covers({table_a}.geom,{table_b}.geom) THEN {table_b}.geom ELSE ST_Intersection({table_a}.geom,{table_b}.geom) END geom FROM {table_a} INNER JOIN {table_b} ON ST_Intersects({table_a}.geom,{table_b}.geom))"
                                ).format(
                                    cte_name=sql.Identifier("cte_" + str(cte_count)),
                                    input_fields=sql.SQL(",").join(
                                        [
                                            sql.Identifier(
                                                "cte_" + str(cte_count - 1),
                                                f"{col_name}_{table_name_sel}",
                                            )
                                            for table_name_sel, columns_sel in table_columns_selected
                                            for col_name in columns_sel
                                        ]
                                        + [
                                            sql.SQL("{} {}").format(
                                                sql.Identifier(
                                                    current_table_name, col_name
                                                ),
                                                sql.Identifier(
                                                    f"{col_name}_{current_table_name}"
                                                ),
                                            )
                                            for col_name in current_columns
                                        ]
                                    ),
                                    table_a=sql.Identifier(current_table_name),
                                    table_b=sql.Identifier("cte_" + str(cte_count - 1)),
                                )
                            )
                            table_columns_selected.append(table_column)
                            cte_count += 1
                        else:
                            # set last input table as final select query
                            final_query = sql.SQL(
                                """ SELECT *
                                    FROM (
                                      SELECT {input_fields},ST_Multi(CASE WHEN ST_Covers({table_a}.geom,{table_b}.geom) THEN {table_b}.geom ELSE ST_CollectionExtract(ST_Intersection({table_a}.geom,{table_b}.geom),%s) END) geom
                                      FROM {table_a}
                                      INNER JOIN {table_b} ON ST_Intersects({table_a}.geom,{table_b}.geom)
                                    ) intersected
                                    WHERE NOT ST_IsEmpty(geom)"""
                            ).format(
                                input_fields=sql.SQL(",").join(
                                    [
                                        sql.Identifier(
                                            "cte_" + str(cte_count - 1),
                                            f"{col_name}_{table_name_sel}",
                                        )
                                        for table_name_sel, columns_sel in table_columns_selected
                                        for col_name in columns_sel
                                    ]
                                    + [
                                        sql.SQL("{} {}").format(
                                            sql.Identifier(
                                                current_table_name, col_name
                                            ),
                                            sql.Identifier(
                                                f"{col_name}_{current_table_name}"
                                            ),
                                        )
                                        for col_name in current_columns
                                    ]
                                ),
                                table_a=sql.Identifier(current_table_name),
                                table_b=sql.Identifier("cte_" + str(cte_count - 1)),
                            )
                    select_query = sql.SQL("{} {}").format(
                        sql.SQL(",").join(cte_queries), final_query
                    )

                cur.execute(
                    sql.SQL(
                        "INSERT INTO {output_table} ({output_fields}, geom) {select_query}"
                    ).format(
                        output_table=output_table_ident,
                        output_fields=sql.SQL(",").join(
                            sql.Identifier(f"{col_name}_{table_name}")
                            for table_name, columns in table_columns
                            for col_name in columns
                        ),
                        select_query=select_query,
                    ),
                    [dim],
                )
                logger.info("Data inserted")

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
                    output_geom_type,
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

                # register permission
                cur.execute(
                    sql.SQL(f"""INSERT INTO vector_tiles_directus_roles 
                                (vector_tiles_layer_id, directus_roles_id)
                            VALUES ('{layer_id}', 
                                    (SELECT role 
                                    FROM directus_users 
                                    WHERE id = '{user_id}'));""")
                            )
                logger.info("Registered to vector_tiles_directus_roles")

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
