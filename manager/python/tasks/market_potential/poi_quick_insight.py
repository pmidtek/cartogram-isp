import os
import shutil
import traceback
import json
from uuid import uuid4
from datetime import datetime

import dramatiq
from dramatiq.middleware import TimeLimitExceeded

from psycopg2.extras import Json
from psycopg2.extras import execute_values

from io import BytesIO
import pandas as pd

from lib.clear_directus_cache import clear_directus_cache
from utils import logger, pool, minio_client

import json
from shapely.geometry import shape, GeometryCollection, MultiPolygon, Polygon, mapping
from shapely.ops import unary_union
from shapely.wkb import loads as load_wkb
import geopandas as gpd


def normalize_geojson_fc(fc):
    all_polys = []

    for feature in fc.get("features", []):
        geom = shape(feature["geometry"])

        if isinstance(geom, (Polygon, MultiPolygon)):
            all_polys.append(geom)

        elif isinstance(geom, GeometryCollection):
            # ambil semua polygonal
            all_polys.extend(
                [g for g in geom.geoms if isinstance(g, (Polygon, MultiPolygon))]
            )

    if not all_polys:
        raise ValueError("No polygon geometry found in the FeatureCollection")

    merged = unary_union(all_polys)  # merge semua polygon

    # pastikan MultiPolygon
    if isinstance(merged, Polygon):
        merged = MultiPolygon([merged])

    return {"type": "Feature", "properties": {}, "geometry": mapping(merged)}


SQL_GET_POI = """
    WITH area AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) AS geom
    ) SELECT poi.ogc_fid, poi.poi_name, poi.category, poi.geom
        FROM poi, area
        WHERE poi.geom && area.geom
        AND ST_Intersects(poi.geom, area.geom)
"""

SQL_AREA_FP = """
    WITH area AS (
        SELECT ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326) AS geom
    ),
    fp AS (
        SELECT
            CASE
                WHEN f.hs_class = 'A' THEN 'high'
                WHEN f.hs_class = 'B' THEN 'mid'
                WHEN f.hs_class = 'C' THEN 'low'
                WHEN f.hs_class = 'C1' THEN 'very_low'
                WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
                ELSE 'non_residential'
            END AS hs_class,
            COUNT(DISTINCT f.ogc_fid) AS fp_count
        FROM sp_data_footprint f
        CROSS JOIN area
        WHERE f.geom && area.geom
        AND ST_Intersects(f.geom, area.geom)
        GROUP BY hs_class
    ),
    agg AS (
        SELECT
            jsonb_object_agg(hs_class, fp_count) AS data,
            SUM(fp_count) AS total
        FROM fp
    )
    SELECT
        COALESCE(data->>'high','0')::int AS high,
        COALESCE(data->>'mid','0')::int AS mid,
        COALESCE(data->>'low','0')::int AS low,
        COALESCE(data->>'very_low','0')::int AS very_low,
        COALESCE(data->>'non_residential','0')::int AS non_residential,
        total
    FROM agg;
"""


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
def poi_quick_insight(
    user: str,
    file_id: str,
    geoprocessing_uuid: str,
    categories: list[str],
    analysis_name: str | None = None,
):
    conn = None
    try:
        logger.info("poi quick insight")
        conn = pool.getconn()

        bucket_name = os.environ.get("STORAGE_S3_BUCKET")
        storage_root = os.environ.get("STORAGE_S3_ROOT")
        object_name = f"{storage_root}/{file_id}"
        response = minio_client.get_object(bucket_name, object_name)
        geojson_bytes = response.read()
        response.close()
        response.release_conn()

        geojson_area = json.loads(geojson_bytes.decode("utf-8"))
        area_feature = normalize_geojson_fc(geojson_area)

        with conn.cursor() as cur:
            if categories:
                sql = SQL_GET_POI
                placeholders = ", ".join(["%s"] * len(categories))
                sql += f" AND poi.category IN ({placeholders})"
                cur.execute(sql, (Json(area_feature["geometry"]), *categories))
            else:
                cur.execute(sql, (Json(area_feature["geometry"]),))
            rows = cur.fetchall()

        df_poi = pd.DataFrame(rows, columns=["ogc_fid", "poi_name", "category", "geom"])
        df_poi["geom"] = df_poi["geom"].apply(lambda x: load_wkb(bytes.fromhex(x)))
        gdf_poi = gpd.GeoDataFrame(df_poi, geometry="geom", crs="EPSG:4326")
        jumlah_poi = len(df_poi)

        with conn.cursor() as cur:
            cur.execute(SQL_AREA_FP, (Json(area_feature["geometry"]),))
            row = cur.fetchone()

        fp_by_hs_class = {
            "high": int(row[0]),
            "mid": int(row[1]),
            "low": int(row[2]),
            "very_low": int(row[3]),
            "non_residential": int(row[4]),
        }
        total_footprint = int(row[5])

        area_geom = shape(area_feature["geometry"])
        bounding_box = list(area_geom.bounds)

        geojson_poi = {
            "type": "FeatureCollection",
            "features": [],
        }
        for _, row in gdf_poi.iterrows():
            feature = {
                "type": "Feature",
                "geometry": mapping(row.geom),
                "properties": {
                    "ogc_fid": row.ogc_fid,
                    "poi_name": row.poi_name,
                    "category": row.category,
                },
            }
            geojson_poi["features"].append(feature)

        poi_by_category_array = [
            {"category": str(cat), "count": int(count)}
            for cat, count in df_poi["category"].value_counts().items()
        ]
        geojson_area = {
            "type": "FeatureCollection",
            "features": [area_feature],
        }

        final_result = {
            "options": {},
            "bounding_box": bounding_box,
            "analytics": {
                "total_poi": jumlah_poi,
                "total_footprint": total_footprint,
                "poi_by_category": poi_by_category_array,
                "fp_by_hs_class": fp_by_hs_class,
            },
            "geojson_area": geojson_area,
            "geojson_poi": geojson_poi,
        }

        # file_path = "/data/pqi.json"
        # with open(file_path, "w", encoding="utf-8") as f:
        #     json.dump(final_result, f, ensure_ascii=False, indent=2)

        ## UPLOAD EXCEL RESULT ##
        file_key = str(uuid4())
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if not analysis_name:
            analysis_name = f"pqi_result_{timestamp}"

        filename_disk = f"{file_key}.xlsx"
        filename_download = f"{analysis_name}.xlsx"

        file_size = upload_df_excel_to_minio(gdf_poi, filename_disk)
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
                    INSERT INTO poi_insight_result(date_created, name, user_created, result, geoprocessing_uuid, excel)
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
                poi_insight_result_id = cur.fetchone()[0]

        clear_directus_cache()
        return {
            "status": "success",
            "poi_insight_result_id": poi_insight_result_id,
        }

        return "success"
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
