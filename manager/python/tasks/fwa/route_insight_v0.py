import os
import shutil
import traceback
import json
from uuid import uuid4
from datetime import datetime

import dramatiq
from dramatiq.middleware import TimeLimitExceeded


from shapely.geometry import shape
from shapely import wkb

from openrouteservice import client
from ortools.constraint_solver import pywrapcp, routing_enums_pb2

from psycopg2.extras import Json

import numpy as np
import pandas as pd
import geopandas as gpd

from lib.clear_directus_cache import clear_directus_cache
from utils import logger, pool, minio_client


@dramatiq.actor(store_results=True)
def route_insight(
    qmi_id: str,
    user: str,
    geoprocessing_uuid: str,
    analysis_name: str | None = None,
):
    conn = None
    try:
        logger.info("route_insight")
        conn = pool.getconn()

        logger.info("get data tower")
        with conn.cursor() as cur:
            cur.execute(f"SELECT * FROM qmi_result WHERE id = %s;", [qmi_id])
            rows = cur.fetchone()
            cols = [desc[0] for desc in cur.description]
            df = pd.DataFrame([rows], columns=cols)

        result = df["result"].iloc[0]
        bounding_box = result.get("bounding_box", None)
        geojson_tower = result.get("geojson_tower", None)

        features = geojson_tower["features"]
        records = []
        for ft in features:
            props = ft.get("properties", {})
            geom = shape(ft["geometry"])  # shapely geometry
            props["geometry"] = geom
            records.append(props)

        gdf_tower = gpd.GeoDataFrame(records, geometry="geometry", crs="EPSG:4326")
        # gdf_tower.head()

        logger.info("get data stasiun")
        xmin, ymax, xmax, ymin = bounding_box
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT sp.*
                FROM site_points sp
                INNER JOIN site_point_types spt
                    ON sp.site_point_type_id = spt.id
                AND spt.name IN ('Stasiun', 'Shelter')
                WHERE ST_Within(
                    sp.geom,
                    ST_MakeEnvelope(%s, %s, %s, %s, 4326)
                );
                """,
                (xmin, ymin, xmax, ymax),
            )
            rows = cur.fetchall()
            cols = [desc[0] for desc in cur.description]
            df_stasiun = pd.DataFrame(rows, columns=cols)

        df_stasiun["geometry"] = df_stasiun["geom"].apply(
            lambda x: wkb.loads(bytes.fromhex(x))
        )
        gdf_stasiun = gpd.GeoDataFrame(df_stasiun, geometry="geometry", crs="EPSG:4326")
        # gdf_stasiun.head()

        logger.info("clustering data")
        gdf_tower_m = gdf_tower.to_crs(3857)
        gdf_stasiun_m = gdf_stasiun.to_crs(3857)

        gdf_joined = gpd.sjoin_nearest(
            gdf_tower_m, gdf_stasiun_m[["id", "geometry"]], how="left"
        ).rename(columns={"id_left": "id", "id_right": "stasiun_id"})

        gdf_joined = gdf_joined.to_crs(4326)
        gdf_joined.drop(columns=["index_right"], inplace=True, errors="ignore")
        # gdf_joined.head()

        logger.info("build matrix")
        ors = client.Client(key=os.environ.get("ORS_KEY"))

        stasiun_towers = []
        for _, stasiun in gdf_stasiun.iterrows():
            stasiun_id = stasiun["id"]
            stasiun_point = [stasiun.geometry.x, stasiun.geometry.y]

            items = []
            items.append(
                {"id": str(stasiun_id), "type": "stasiun", "coordinates": stasiun_point}
            )
            towers = gdf_joined[gdf_joined["stasiun_id"] == stasiun_id]
            for _, tower in towers.iterrows():
                items.append(
                    {
                        "id": str(tower["id"]),
                        "type": "tower",
                        "coordinates": [tower.geometry.x, tower.geometry.y],
                    }
                )
            stasiun_towers.append(items)

        stasiun_tower_matrix = []
        batch_size = 50
        for items in stasiun_towers:
            stasiun_id = items[0]["id"]
            coords = [item["coordinates"] for item in items]
            n = len(coords)

            # matrix kosong NxN
            full_matrix = np.zeros((n, n)).tolist()
            for i in range(0, n, batch_size):
                for j in range(0, n, batch_size):

                    origins = coords[i : i + batch_size]
                    destinations = coords[j : j + batch_size]

                    merged = origins + destinations
                    sources = list(range(len(origins)))
                    destinations_idx = list(range(len(destinations)))

                    response = ors.distance_matrix(
                        locations=merged,
                        # profile="driving-car",
                        profile="foot-walking",
                        metrics=["distance"],
                        sources=sources,
                        destinations=destinations_idx,
                    )

                    distances = response["distances"]

                    # place into full_matrix
                    for a, row_val in enumerate(distances):
                        for b, dist in enumerate(row_val):
                            full_matrix[i + a][j + b] = dist

            stasiun_tower_matrix.append(
                {"stasiun_id": stasiun_id, "matrix": full_matrix}
            )

        logger.info("generate tsp")

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

        final_result = []
        for item in stasiun_tower_matrix:
            stasiun_id = item["stasiun_id"]
            logger.info(stasiun_id)
            dist_matrix = item["matrix"]

            # ambil semua titik untuk stasiun tersebut (stasiun + towers)
            group = next(g for g in stasiun_towers if g[0]["id"] == str(stasiun_id))
            points = group[:]  # semua titik

            # panggil OR-Tools TSP
            route = tsp_ortools(dist_matrix)
            if route is None:
                print(f"TSP solution not found for stasiun {stasiun_id}")
                continue

            # buat GeoJSON untuk rute segment per stasiun
            geojson_routes = {"type": "FeatureCollection", "features": []}
            for i in range(len(route) - 1):
                from_idx = route[i]
                to_idx = route[i + 1]
                geojson_routes["features"].append(
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "LineString",
                            "coordinates": [
                                points[from_idx]["coordinates"],
                                points[to_idx]["coordinates"],
                            ],
                        },
                        "properties": {
                            "stasiun_id": stasiun_id,
                            "source_id": points[from_idx]["id"],
                            "target_id": points[to_idx]["id"],
                            "distance": dist_matrix[from_idx][to_idx],
                        },
                    }
                )

            geojson_tower = {"type": "FeatureCollection", "features": []}
            for p in points:
                geojson_tower["features"].append(
                    {
                        "type": "Feature",
                        "geometry": {
                            "type": "Point",
                            "coordinates": p["coordinates"],
                        },
                        "properties": {
                            "id": p["id"],
                            "type": p["type"],
                            "stasiun_id": stasiun_id,
                        },
                    }
                )

            final_result.append(
                {
                    "stasiun_id": stasiun_id,
                    "geojson_routes": geojson_routes,
                    "geojson_tower": geojson_tower,
                }
            )

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if not analysis_name:
            analysis_name = f"qmi_result_{timestamp}"

        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO route_insight_result(date_created, name, user_created, result, geoprocessing_uuid)
                    VALUES (NOW(), %s, %s, %s, %s)
                    RETURNING id;
                    """,
                    (analysis_name, user, Json(final_result), geoprocessing_uuid),
                )
                route_insight_result_id = cur.fetchone()[0]

        # file_path = "/data/route_insight.json"
        # with open(file_path, "w", encoding="utf-8") as f:
        #     json.dump(final_result, f, ensure_ascii=False, indent=2)

        clear_directus_cache()
        return {
            "status": "success",
            "route_insight_result_id": route_insight_result_id,
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
