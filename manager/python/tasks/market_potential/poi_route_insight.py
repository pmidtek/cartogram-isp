import os
import shutil
import traceback
import json
from uuid import uuid4
from datetime import datetime

import dramatiq
from dramatiq.middleware import TimeLimitExceeded


from shapely.geometry import shape, mapping, LineString
from shapely import wkb

from openrouteservice import client
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from psycopg2.extras import Json

from io import BytesIO
import numpy as np
import pandas as pd
import geopandas as gpd

from lib.clear_directus_cache import clear_directus_cache
from utils import logger, pool, minio_client


def sql_route_buffer(values_sql_str):
    SQL_ROUTE_BUFFER = f"""
        WITH route_final(route_id, geom) AS (
            VALUES
            {values_sql_str}
        ),
        route_hs_summary_raw AS (
            SELECT
                r.route_id,
                CASE
                    WHEN f.hs_class = 'A' THEN 'high'
                    WHEN f.hs_class = 'B' THEN 'mid'
                    WHEN f.hs_class = 'C' THEN 'low'
                    WHEN f.hs_class = 'C1' THEN 'very_low'
                    WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
                    ELSE 'non_residential'
                END AS hs_class,
                COUNT(DISTINCT f.ogc_fid) AS fp_count
            FROM route_final r
            LEFT JOIN sp_data_footprint f
                ON f.geom && r.geom
                AND ST_Intersects(f.geom, r.geom)
            WHERE f.hs_class IS NOT NULL
            GROUP BY r.route_id, hs_class
        ),
        summary_final AS (
            SELECT
                route_id,
                jsonb_object_agg(hs_class, fp_count ORDER BY hs_class) AS fp_by_hs_class,
                SUM(fp_count) AS total
            FROM route_hs_summary_raw
            GROUP BY route_id
        )
        SELECT
            r.route_id AS id,
            COALESCE(s.fp_by_hs_class->>'high','0')::int AS high,
            COALESCE(s.fp_by_hs_class->>'mid','0')::int AS mid,
            COALESCE(s.fp_by_hs_class->>'low','0')::int AS low,
            COALESCE(s.fp_by_hs_class->>'very_low','0')::int AS very_low,
            COALESCE(s.fp_by_hs_class->>'non_residential','0')::int AS non_residential,
            COALESCE(s.total,0) AS final_footprint_count
        FROM route_final r
        LEFT JOIN summary_final s ON r.route_id = s.route_id
        ORDER BY r.route_id;
    """
    return SQL_ROUTE_BUFFER


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
def poi_route_insight(
    poi_insight_result_id: str,
    user: str,
    geoprocessing_uuid: str,
    analysis_name: str | None = None,
):
    conn = None
    try:
        logger.info("route_insight")
        conn = pool.getconn()

        logger.info("get data poi insight")
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT * FROM poi_insight_result WHERE id = %s;",
                [poi_insight_result_id],
            )
            rows = cur.fetchone()
            cols = [desc[0] for desc in cur.description]
            df = pd.DataFrame([rows], columns=cols)

        result = df["result"].iloc[0]
        bounding_box = result.get("bounding_box", None)
        geojson_poi_input = result.get("geojson_poi", None)
        poi_by_category = result.get("analytics", {}).get("poi_by_category", [])

        options = result.get("options", None)
        area_city_ids = options.get("area_city_ids", [])

        features = geojson_poi_input["features"]
        points = []
        for ft in features:
            geom = shape(ft["geometry"])
            points.append(
                {
                    "id": str(ft["properties"].get("ogc_fid")),
                    "type": ft["properties"].get("type", "POI"),
                    "coordinates": [geom.x, geom.y],
                    "name": ft["properties"].get("poi_name"),
                    "code": ft["properties"].get("category"),
                    "owner": ft["properties"].get("owner", "-"),
                    "source": ft["properties"].get("source", "database"),
                }
            )

        logger.info("build distance matrix")
        ors = client.Client(key=os.environ.get("ORS_KEY"))
        coords = [p["coordinates"] for p in points]
        n = len(coords)
        dist_matrix = np.zeros((n, n)).tolist()
        batch_size = 50

        logger.info(n)

        for i in range(0, n, batch_size):
            for j in range(0, n, batch_size):
                origins = coords[i : i + batch_size]
                destinations = coords[j : j + batch_size]
                merged = origins + destinations
                sources = list(range(len(origins)))
                # destinations_idx = list(range(len(destinations)))
                destinations_idx = list(
                    range(len(origins), len(origins) + len(destinations))
                )
                response = ors.distance_matrix(
                    locations=merged,
                    profile="foot-walking",
                    metrics=["distance"],
                    sources=sources,
                    destinations=destinations_idx,
                )
                distances = response["distances"]
                for a, row_val in enumerate(distances):
                    for b, dist in enumerate(row_val):
                        dist_matrix[i + a][j + b] = dist

        logger.info("generate tsp")
        # dist_matrix_array = np.array(dist_matrix)
        # dist_matrix_list = dist_matrix_array.round(1).tolist()  # bulatkan 1 desimal

        # # # simpan ke file
        # file_path = "/data/distance_matrix.json"
        # with open(file_path, "w", encoding="utf-8") as f:
        #     json.dump(dist_matrix_list, f, ensure_ascii=False, indent=2)

        def tsp_ortools(dist_matrix):
            dist_matrix = np.array(dist_matrix)
            size = len(dist_matrix)

            manager = pywrapcp.RoutingIndexManager(
                size, 1, 0
            )  # 1 vehicle, start at index 0
            routing = pywrapcp.RoutingModel(manager)

            def distance_callback(from_idx, to_idx):
                return int(
                    dist_matrix[manager.IndexToNode(from_idx)][
                        manager.IndexToNode(to_idx)
                    ]
                )

            transit_callback_index = routing.RegisterTransitCallback(distance_callback)
            routing.SetArcCostEvaluatorOfAllVehicles(transit_callback_index)

            # use better search strategy
            search_params = pywrapcp.DefaultRoutingSearchParameters()
            search_params.first_solution_strategy = (
                routing_enums_pb2.FirstSolutionStrategy.PATH_CHEAPEST_ARC
            )
            search_params.local_search_metaheuristic = (
                routing_enums_pb2.LocalSearchMetaheuristic.GUIDED_LOCAL_SEARCH
            )
            search_params.time_limit.FromSeconds(4)

            solution = routing.SolveWithParameters(search_params)

            if solution:
                route = []
                idx = routing.Start(0)
                while not routing.IsEnd(idx):
                    route.append(manager.IndexToNode(idx))
                    idx = solution.Value(routing.NextVar(idx))
                route.append(manager.IndexToNode(idx))
                return route

            return None

        route = tsp_ortools(dist_matrix)
        if route is None:
            raise Exception("TSP solution not found")

        coordinates = [points[idx]["coordinates"] for idx in route]

        logger.info("generate directions with batch processing")
        # ORS has a limit of waypoints per request (typically 50)
        max_waypoints = 50
        route_rows = []
        route_row_id = 0

        for batch_start in range(0, len(coordinates), max_waypoints - 1):
            batch_end = min(batch_start + max_waypoints, len(coordinates))
            batch_coords = coordinates[batch_start:batch_end]

            logger.info(
                f"Processing batch {batch_start} to {batch_end} ({len(batch_coords)-1} waypoints)"
            )
            # logger.info(batch_coords)

            res = ors.directions(
                coordinates=batch_coords,
                profile="foot-walking",
                format="geojson",
            )

            # file_path = "/data/direction.json"
            # with open(file_path, "w", encoding="utf-8") as f:
            #     json.dump(res, f, ensure_ascii=False, indent=2)

            full_coords = res["features"][0]["geometry"]["coordinates"]
            segments = res["features"][0]["properties"]["segments"]
            way_points = res["features"][0]["properties"]["way_points"]

            for i in range(len(way_points) - 1):
                start_idx = way_points[i]
                end_idx = way_points[i + 1]

                # ambil subset polyline untuk segmen ke-i
                coords_segment = full_coords[start_idx : end_idx + 1]
                # ensure we have at least 2 points for a valid LineString
                if len(coords_segment) < 2:
                    # fallback: create a direct line between input coordinates
                    coords_segment = [batch_coords[i], batch_coords[i + 1]]
                else:
                    # forced snap to input coordinates for both endpoints
                    coords_segment[0] = batch_coords[i]  # titik awal
                    coords_segment[-1] = batch_coords[i + 1]  # titik akhir

                # calculate the actual index in the original route
                actual_route_idx = batch_start + i
                from_idx = route[actual_route_idx]
                to_idx = route[actual_route_idx + 1]

                route_rows.append(
                    {
                        "id": route_row_id,
                        "from_idx": from_idx,
                        "to_idx": to_idx,
                        "source_id": points[from_idx]["id"],
                        "source_source": points[from_idx]["source"],
                        "source_type": points[from_idx]["type"],
                        "source_name": points[from_idx]["name"],
                        "source_code": points[from_idx]["code"],
                        "source_owner": points[from_idx]["owner"],
                        "destination_id": points[to_idx]["id"],
                        "destination_source": points[to_idx]["source"],
                        "destination_type": points[to_idx]["type"],
                        "destination_name": points[to_idx]["name"],
                        "destination_code": points[to_idx]["code"],
                        "destination_owner": points[to_idx]["owner"],
                        "distance": segments[i][
                            "distance"
                        ],  # hasil ORS segment distance
                        "duration": segments[i]["duration"],
                        "geometry": LineString(coords_segment),  # polyline real
                    }
                )
                route_row_id += 1

        gdf_routes = gpd.GeoDataFrame(route_rows, geometry="geometry", crs="EPSG:4326")

        logger.info("generate geojson")
        geojson_poi = {"type": "FeatureCollection", "features": []}
        # geojson_tower = {"type": "FeatureCollection", "features": []}
        for p in points:
            geojson_poi["features"].append(
                # geojson_tower["features"].append(
                {
                    "type": "Feature",
                    "geometry": {"type": "Point", "coordinates": p["coordinates"]},
                    "properties": {
                        "id": p["id"],
                        "type": p["type"],
                        "name": p["name"],
                        "code": p["code"],
                        "owner": p["owner"],
                        "source": p["source"],
                    },
                }
            )

        BUFFER_METERS = 150
        gdf_routes = gdf_routes.set_crs(4326, allow_override=True)
        # Buat buffer dalam meter
        gdf_routes_3857 = gdf_routes.to_crs(3857)
        gdf_routes["geom_buffer"] = gdf_routes_3857.buffer(BUFFER_METERS).to_crs(4326)

        values_sql_str = ",\n".join(
            [
                f"('{row.id}', ST_GeomFromText('{row.geom_buffer.wkt}', 4326))"
                for _, row in gdf_routes.iterrows()
            ]
        )
        with conn.cursor() as cur:
            cur.execute(sql_route_buffer(values_sql_str))
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description]
            result_df = pd.DataFrame(rows, columns=columns)

        gdf_routes["id"] = gdf_routes["id"].astype(int)
        result_df["id"] = result_df["id"].astype(int)

        gdf_routes = gdf_routes.merge(result_df, on="id", how="left")
        gdf_buffer = gdf_routes.set_geometry("geom_buffer")

        geojson_route = {
            "type": "FeatureCollection",
            "features": [],
        }
        geojson_buffer = {
            "type": "FeatureCollection",
            "features": [],
        }
        for _, row in gdf_routes.iterrows():
            feature = {
                "type": "Feature",
                "geometry": mapping(row.geometry),
                "properties": {
                    "id": row.id,
                    "source_id": row.source_id,
                    "source_source": row.source_source,
                    "source_info": {
                        "id": row.source_id,
                        "type": row.source_type,
                        "name": row.source_name,
                        "code": row.source_code,
                        "owner": row.source_owner,
                        "source": row.source_source,
                    },
                    "destination_id": row.destination_id,
                    "destination_source": row.destination_source,
                    "destination_info": {
                        "id": row.destination_id,
                        "type": row.destination_type,
                        "name": row.destination_name,
                        "code": row.destination_code,
                        "owner": row.destination_owner,
                        "source": row.destination_source,
                    },
                    "distance": row.distance,
                    "fp_by_hs_class": {
                        "high": int(row.high) if not pd.isna(row.high) else 0,
                        "mid": int(row.mid) if not pd.isna(row.mid) else 0,
                        "low": int(row.low) if not pd.isna(row.low) else 0,
                        "very_low": (
                            int(row.very_low) if not pd.isna(row.very_low) else 0
                        ),
                        "non_residential": (
                            int(row.non_residential)
                            if not pd.isna(row.non_residential)
                            else 0
                        ),
                    },
                    "final_footprint_count": (
                        int(row.final_footprint_count)
                        if not pd.isna(row.final_footprint_count)
                        else 0
                    ),
                },
            }
            geojson_route["features"].append(feature)
        for _, row in gdf_buffer.iterrows():
            feature = {
                "type": "Feature",
                "geometry": mapping(row.geom_buffer),
                "properties": {"id": row.id},
            }
            geojson_buffer["features"].append(feature)

        total_routes = len(gdf_routes)
        total_footprint = gdf_routes["final_footprint_count"].sum()
        fp_by_hs_class = {
            "high": int(gdf_routes["high"].sum()),
            "mid": int(gdf_routes["mid"].sum()),
            "low": int(gdf_routes["low"].sum()),
            "very_low": int(gdf_routes["very_low"].sum()),
            "non_residential": int(gdf_routes["non_residential"].sum()),
        }

        total_poi = len(points)
        cable_length = gdf_routes["distance"].sum()

        final_result = {
            "options": {
                "area_city_ids": area_city_ids,
                "radius": BUFFER_METERS,
                "poi_insight_result_id": poi_insight_result_id,
            },
            "bounding_box": bounding_box,
            "analytics": {
                "total_routes": total_routes,
                "cable_length": cable_length,
                "total_poi": total_poi,
                "poi_by_category": poi_by_category,
                "total_footprint": int(total_footprint),
                "fp_by_hs_class": fp_by_hs_class,
            },
            "geojson_route": geojson_route,
            "geojson_poi": geojson_poi,
            # "geojson_tower": geojson_tower,
            "geojson_buffer": geojson_buffer,
        }

        ## UPLOAD EXCEL RESULT ##
        file_key = str(uuid4())
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if not analysis_name:
            analysis_name = f"pri_result_{timestamp}"

        filename_disk = f"{file_key}.xlsx"
        filename_download = f"{analysis_name}.xlsx"

        file_size = upload_df_excel_to_minio(gdf_routes, filename_disk)
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
                    INSERT INTO poi_route_insight_result(date_created, name, user_created, result, geoprocessing_uuid, excel)
                    VALUES (NOW(), %s, %s, %s, %s, %s)
                    RETURNING id;
                    """,
                    (
                        analysis_name,
                        user,
                        Json(final_result),
                        geoprocessing_uuid,
                        file_key,
                    ),
                )
                poi_route_insight_result = cur.fetchone()[0]

        # file_path = "/data/route_insight.json"
        # with open(file_path, "w", encoding="utf-8") as f:
        #     json.dump(final_result, f, ensure_ascii=False, indent=2)

        clear_directus_cache()
        return {
            "status": "success",
            "poi_route_insight_result": poi_route_insight_result,
        }
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
