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
import math
import numpy as np

from shapely import wkb, wkt
from shapely.geometry import Point, Polygon, MultiPolygon, mapping
from shapely.validation import make_valid
from shapely.ops import transform
from pyproj import Transformer
from collections import defaultdict, deque
from io import BytesIO

from lib.clear_directus_cache import clear_directus_cache
from utils import logger, pool, minio_client

SQL_TOWER_PAIRWISE = """
    WITH tower_buffer AS (
        SELECT
            sp.id, sp.name, sp.code, sp."owner",
            ST_X(geom) AS longitude, ST_Y(geom) AS latitude,
            ST_Buffer(sp.geom::geography, %s)::geometry AS geom,
            'database' AS source
        FROM site_points sp
        INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
        WHERE spt.name = 'Tower' AND sp.area_city_id = ANY(%s)
        -- AND sp.id IN (55, 56, 3095, 14495, 14312, 4563, 3167, 2444, 13511, 14335, 14339)
    ),
    pairwise AS (
        SELECT
            a.id AS t1, a.owner AS t1_owner, a.name AS t1_name, a.code AS t1_code, a.latitude AS t1_latitude, a.longitude AS t1_longitude, a.source AS t1_source,
            b.id AS t2, b.owner AS t2_owner, b.name AS t2_name, b.code AS t2_code, b.latitude AS t2_latitude, b.longitude AS t2_longitude, b.source AS t2_source,
            a.geom AS t1_geom, b.geom AS t2_geom
        FROM tower_buffer a
        LEFT JOIN tower_buffer b ON a.id <> b.id
        AND a.geom && b.geom AND ST_Intersects(a.geom, b.geom)
    ),
    tower_fp_raw AS (
        SELECT  tb.id, COUNT(DISTINCT f.ogc_fid) AS fp_count
        FROM tower_buffer tb
        LEFT JOIN sp_data_footprint f ON f.geom && tb.geom AND ST_Intersects(f.geom, tb.geom)
        GROUP BY tb.id
    )
    SELECT
        p.t1, p.t1_name, p.t1_code, p.t1_owner, t1.fp_count AS t1_fp, p.t1_latitude, p.t1_longitude, p.t1_source,
        p.t2, p.t2_name, p.t2_code, p.t2_owner, t2.fp_count AS t2_fp, p.t2_latitude, p.t2_longitude, p.t2_source,
        p.t1_geom, p.t2_geom
    FROM pairwise p
    LEFT JOIN tower_fp_raw t1 ON t1.id = p.t1
    LEFT JOIN tower_fp_raw t2 ON t2.id = p.t2
    ORDER BY p.t1, p.t2;
"""

SQL_TOWER_UPLOAD_PAIRWISE = """
    WITH geojson AS (
        SELECT %s::jsonb AS fc
    ),
    tower_buffer AS (
        SELECT
            row_number() OVER () AS id,
            (feat->'properties'->>'name') AS name,
            (feat->'properties'->>'code') AS code,
            (feat->'properties'->>'owner') AS owner,
            (feat->'geometry'->'coordinates'->>0)::float AS longitude,
            (feat->'geometry'->'coordinates'->>1)::float AS latitude,
            ST_Buffer(ST_SetSRID(ST_MakePoint(
                (feat->'geometry'->'coordinates'->>0)::float,
                (feat->'geometry'->'coordinates'->>1)::float
            ), 4326)::geography, %s )::geometry AS geom,
            'upload' AS source
        FROM geojson, jsonb_array_elements(fc->'features') AS feat
    ),
    pairwise AS (
        SELECT
            a.id AS t1, a.owner AS t1_owner, a.name AS t1_name, a.code AS t1_code, a.latitude AS t1_latitude, a.longitude AS t1_longitude, a.source AS t1_source,
            b.id AS t2, b.owner AS t2_owner, b.name AS t2_name, b.code AS t2_code, b.latitude AS t2_latitude, b.longitude AS t2_longitude, b.source AS t2_source,
            a.geom AS t1_geom, b.geom AS t2_geom
        FROM tower_buffer a
        LEFT JOIN tower_buffer b ON a.id <> b.id
        AND a.geom && b.geom AND ST_Intersects(a.geom, b.geom)
    ),
    tower_fp_raw AS (
        SELECT  tb.id, COUNT(DISTINCT f.ogc_fid) AS fp_count
        FROM tower_buffer tb
        LEFT JOIN sp_data_footprint f ON f.geom && tb.geom AND ST_Intersects(f.geom, tb.geom)
        GROUP BY tb.id
    )
    SELECT
        p.t1, p.t1_name, p.t1_code, p.t1_owner, t1.fp_count AS t1_fp, p.t1_latitude, p.t1_longitude, p.t1_source,
        p.t2, p.t2_name, p.t2_code, p.t2_owner, t2.fp_count AS t2_fp, p.t2_latitude, p.t2_longitude, p.t2_source,
        p.t1_geom, p.t2_geom
    FROM pairwise p
    LEFT JOIN tower_fp_raw t1 ON t1.id = p.t1
    LEFT JOIN tower_fp_raw t2 ON t2.id = p.t2
    ORDER BY p.t1, p.t2;
"""

SQL_GET_AREA_OGC_FID = """
    WITH geojson AS (
        SELECT %s::jsonb AS fc
    ),
    tower_geom AS (
        SELECT
            row_number() OVER () AS id,
            ST_SetSRID(ST_MakePoint(
                (feat->'geometry'->'coordinates'->>0)::float,
                (feat->'geometry'->'coordinates'->>1)::float
            ), 4326) AS geom
        FROM geojson, jsonb_array_elements(fc->'features') AS feat
    )
    SELECT DISTINCT ac.ogc_fid
    FROM tower_geom tg
    INNER JOIN area_cities ac ON ST_Intersects(tg.geom, ac.geom);
    """


def df_to_geojson(df, lat_col="latitude", lon_col="longitude"):
    features = []
    for _, row in df.iterrows():
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [
                        row[lon_col],
                        row[lat_col],
                    ],
                },
                "properties": {
                    key: row[key] for key in df.columns if key not in [lat_col, lon_col]
                },
            }
        )
    geojson = {"type": "FeatureCollection", "features": features}
    return geojson


def sql_str(val):
    if val is None:
        return "NULL"
    val = str(val).replace("'", "''")
    return f"'{val}'"


def sql_tower_buffer(values_sql_str):
    SQL_TOWER_BUFFER = f"""
        WITH tower_final(tower_id, geom, name, code, owner, latitude, longitude, source) AS (
            VALUES
            {values_sql_str}
        ),
        tower_hs_summary_raw AS (
            SELECT
                t.tower_id,
                CASE
                WHEN f.hs_class = 'A' THEN 'high'
                WHEN f.hs_class = 'B' THEN 'mid'
                WHEN f.hs_class = 'C' THEN 'low'
                WHEN f.hs_class = 'C1' THEN 'very_low'
                WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
                ELSE 'non_residential'
                END AS hs_class,
                COUNT(DISTINCT f.ogc_fid) AS fp_count
            FROM tower_final t
            LEFT JOIN sp_data_footprint f
                ON f.geom && t.geom
                AND ST_Intersects(f.geom, t.geom)
            WHERE f.hs_class IS NOT NULL
            GROUP BY t.tower_id, hs_class
        ),
        summary_final AS (
            SELECT
                tower_id,
                jsonb_object_agg(hs_class, fp_count ORDER BY hs_class) AS fp_by_hs_class,
                SUM(fp_count) AS total
            FROM tower_hs_summary_raw
            GROUP BY tower_id
        )
        SELECT
            t.tower_id AS id, t.name, t.code, t.owner, t.latitude, t.longitude,
            ST_AsText(t.geom) AS geom_wkt,
            COALESCE(s.fp_by_hs_class->>'high','0')::int AS high,
            COALESCE(s.fp_by_hs_class->>'mid','0')::int AS mid,
            COALESCE(s.fp_by_hs_class->>'low','0')::int AS low,
            COALESCE(s.fp_by_hs_class->>'very_low','0')::int AS very_low,
            COALESCE(s.fp_by_hs_class->>'non_residential','0')::int AS non_residential,
            COALESCE(s.total,0) AS final_footprint_count,
            t.source
        FROM tower_final t
        LEFT JOIN summary_final s ON t.tower_id = s.tower_id
        ORDER BY t.tower_id;
    """
    return SQL_TOWER_BUFFER


def sql_tower_sectorize(values_sql_str):
    SQL_TOWER_SECTORIZE = f"""
        WITH tower_final(tower_id, geom, latitude, longitude) AS (
            VALUES
            {values_sql_str}
        ),
        fp_intersect AS (
            SELECT
                t.tower_id,
                f.id AS fp_id,
                ST_Centroid(f.geom) AS fp_centroid,
                ST_Azimuth(
                    ST_SetSRID(ST_MakePoint(t.longitude::double precision, t.latitude::double precision), 4326),
                    ST_Centroid(f.geom)
                ) AS rad
            FROM tower_final t
            INNER JOIN sp_data_footprint f ON f.geom && t.geom
            AND ST_Intersects(f.geom, t.geom)
        ),
        fp_angle AS (
            SELECT
                tower_id, fp_id,
                ((degrees(rad) + 360) - 360 * floor((degrees(rad) + 360) / 360))::double precision AS angle_deg,
                width_bucket(((degrees(rad) + 360) - 360 * floor((degrees(rad) + 360) / 360))::double precision, 0, 360, 36) AS bucket_10deg
            FROM fp_intersect
        )
        SELECT *
        FROM fp_angle
        ORDER BY tower_id, angle_deg;
    """
    return SQL_TOWER_SECTORIZE


def find_winner(priority_map, row):
    if row["t1_fp"] > row["t2_fp"]:
        return "t1"
    if row["t2_fp"] > row["t1_fp"]:
        return "t2"

    # jika sama gunakan priority owner
    p1 = priority_map.get(row["t1_owner"], 999)
    p2 = priority_map.get(row["t2_owner"], 999)

    if p1 < p2:
        return "t1"
    elif p2 < p1:
        return "t2"
    else:
        return "t1"  # fallback (owner sama)


def ensure_winner_t1(r):
    if r["winner"] == "t1":
        return r
    # swap
    newr = r.copy()
    newr["t1"], newr["t2"] = r["t2"], r["t1"]
    newr["t1_owner"], newr["t2_owner"] = r["t2_owner"], r["t1_owner"]
    newr["t1_fp"], newr["t2_fp"] = r["t2_fp"], r["t1_fp"]
    newr["t1_geom"], newr["t2_geom"] = r["t2_geom"], r["t1_geom"]
    return newr


def create_topology(df_win):
    fp_map = {}
    for _, row in df_win.iterrows():
        fp_map[row["t1"]] = row["t1_fp"]
        fp_map[row["t2"]] = row["t2_fp"]

    # simpan geom original
    geom_original = {}
    for _, r in df_win.iterrows():
        if r["t1"] not in geom_original:
            geom_original[r["t1"]] = make_valid(wkb.loads(bytes.fromhex(r["t1_geom"])))
        if r["t2"] not in geom_original:
            geom_original[r["t2"]] = make_valid(wkb.loads(bytes.fromhex(r["t2_geom"])))

    # cek tower kalah dengan tower mana saja
    losers_to_winners = {}
    for _, r in df_win.iterrows():
        loser = r["t2"]
        winner = r["t1"]
        losers_to_winners.setdefault(loser, []).append(winner)

    # topology
    deps = defaultdict(set)  # loser -> {winner1, winner2, ...}
    reverse = defaultdict(set)  # winner -> {losers that depend on it}

    for loser, winners in losers_to_winners.items():
        for w in winners:
            deps[loser].add(w)
            reverse[w].add(loser)

    in_degree = {
        t: 0 for t in geom_original.keys()
    }  # Hitung in-degree (berapa winner yang harus diproses dulu)
    for loser, winners in deps.items():
        in_degree[loser] = len(winners)

    queue = deque([t for t, deg in in_degree.items() if deg == 0])

    topo_order = []

    while queue:
        t = queue.popleft()
        topo_order.append(t)
        # semua tower yang t mengalahkan (t → loser)
        for losing in reverse.get(t, []):
            in_degree[losing] -= 1
            if in_degree[losing] == 0:
                queue.append(losing)

    if len(topo_order) != len(in_degree):
        logger.info("Ada siklus (menang-kalah bolak balik)! Ranking tidak valid!")

    geom_final = {}
    for t in topo_order:
        g = geom_original[t]
        winners = deps.get(t, [])
        # potong oleh winner-winner yang sudah diproses
        for w in winners:
            g = g.difference(geom_final[w])
            g = make_valid(g)

        geom_final[t] = g

    return geom_final


def compute_sector_window(df_angle, sliding_window=12):
    results = []
    for tower_id, df_tower in df_angle.groupby("tower_id"):
        # 1) Convert angle to bucket size 10°
        df_tower["bucket"] = np.floor(df_tower["angle_deg"] / 10).astype(int)
        # 2) Histogram count per 10°
        hist = (
            df_tower.groupby("bucket")
            .size()
            .reindex(range(36), fill_value=0)
            .reset_index()
        )
        hist.columns = ["bucket", "count"]
        # 3) Expand 3x for circular 360°
        hist_ext = pd.concat([hist, hist, hist], ignore_index=True)
        counts = hist_ext["count"].to_numpy()
        # 4) Sliding window 12 bucket (=120°)
        window_sums = np.convolve(
            counts, np.ones(sliding_window, dtype=int), mode="valid"
        )
        # Ambil yang max
        max_idx = np.argmax(window_sums)
        total_120 = window_sums[max_idx]
        # Normalize index ke domain 0-35
        start_bucket = max_idx % 36
        start_angle = start_bucket * 10
        end_angle = start_angle + 120

        results.append(
            {
                "tower_id": tower_id,
                "start_bucket": start_bucket,
                "total_120deg": int(total_120),
                "start_angle": start_angle,
                "end_angle": end_angle,
            }
        )
    return pd.DataFrame(results)


def build_sector_ranges(start_angle):
    start_angle = float(start_angle) % 360
    s1_start = start_angle
    s1_end = (s1_start + 120) % 360
    s2_start = s1_end
    s2_end = (s2_start + 120) % 360
    s3_start = s2_end
    s3_end = s1_start
    return [
        {"sector": 1, "start": s1_start, "end": s1_end},
        {"sector": 2, "start": s2_start, "end": s2_end},
        {"sector": 3, "start": s3_start, "end": s3_end},
    ]


def classify_angle(angle, sector_ranges):
    angle = float(angle) % 360
    for r in sector_ranges:
        s, e = r["start"], r["end"]
        if s < e:
            if s <= angle < e:
                return r["sector"]
        else:  # wrap around
            if angle >= s or angle < e:
                return r["sector"]
    return None


def create_sector(
    center_lon, center_lat, radius_m, start_angle, end_angle, n_points=90
):
    """
    Create sector polygon (lon, lat) using metric CRS for stable geometry.
    Angles: 0° = north, clockwise.
    """

    # Proyeksi lokal sesuai lokasi titik (UTM zona lokal)
    utm_zone = int((center_lon + 180) / 6) + 1
    utm_crs = f"EPSG:326{utm_zone}"  # north hemisphere, ganti ke 327 untuk south
    if center_lat < 0:
        utm_crs = f"EPSG:327{utm_zone}"  # south hemisphere

    # projector
    to_utm = Transformer.from_crs("EPSG:4326", utm_crs, always_xy=True).transform
    to_wgs = Transformer.from_crs(utm_crs, "EPSG:4326", always_xy=True).transform

    # titik center dalam UTM
    cx, cy = transform(to_utm, Point(center_lon, center_lat)).coords[0]

    # normalisasi wrap-around
    if end_angle <= start_angle:
        end_angle += 360

    # list sudut dalam radian (konversi 0° north clockwise -> math rad)
    def user_to_math(ang):
        return math.radians(90 - ang)

    start = user_to_math(start_angle)
    end = user_to_math(end_angle)

    angles = [start + i * (end - start) / n_points for i in range(n_points + 1)]

    # bangun polygon dalam UTM
    edge_points = [
        (cx + radius_m * math.cos(a), cy + radius_m * math.sin(a)) for a in angles
    ]

    points = [(cx, cy)] + edge_points + [(cx, cy)]
    sector_utm = Polygon(points)

    # kembali ke lon/lat
    sector_geo = transform(to_wgs, sector_utm)

    # validasi bentuk
    if not sector_geo.is_valid:
        sector_geo = sector_geo.buffer(0)

    return sector_geo


def merge_buffer_to_tower(buffer_features, tower_features, key="id"):
    # Buat lookup dictionary: tower_id -> properti yang diinginkan
    buffer_lookup = {}
    for bf in buffer_features:
        tid = bf["properties"][key]
        buffer_lookup[tid] = {
            "fp_by_hs_class": bf["properties"].get("fp_by_hs_class", {}),
            "final_footprint_count": bf["properties"].get("final_footprint_count", 0),
        }
    # Update tower_features
    for tf in tower_features:
        tid = tf["properties"][key]
        if tid in buffer_lookup:
            tf["properties"].update(buffer_lookup[tid])

    return tower_features


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
def quick_market_insight(
    mode: str,
    user: str,
    geoprocessing_uuid: str,
    radius: int,
    area_city_ids: list[int] | None,
    file_id: str | None,
    priority: list[int] | None,
    sector_count: int | None = 3,
    analysis_name: str | None = None,
):
    conn = None
    try:
        ## Validation ##
        if mode == "upload":
            if not file_id:
                raise ValueError("file_id required for upload mode")
        else:
            if not area_city_ids:
                raise ValueError("area_city_ids required for default mode")
            if len(area_city_ids) < 1 or len(area_city_ids) > 3:
                raise ValueError("area_city_ids must contain between 1 and 3 items")

        if radius > 500:
            raise ValueError("radius must not exceed 500 meters")
        if radius <= 0:
            raise ValueError("radius must be greater than zero")
        if sector_count not in (2, 3):
            raise ValueError("sector_count must be 2 or 3")
        ## Validation ##

        conn = pool.getconn()
        # get pairs from db
        if mode == "upload":
            bucket_name = os.environ.get("STORAGE_S3_BUCKET")
            storage_root = os.environ.get("STORAGE_S3_ROOT")
            object_name = f"{storage_root}/{file_id}"

            response = minio_client.get_object(bucket_name, object_name)
            file_stream = BytesIO(response.read())
            response.close()
            response.release_conn()

            df_upload = pd.read_csv(file_stream)
            geojson_data = df_to_geojson(df_upload)
            with conn.cursor() as cur:
                cur.execute(SQL_GET_AREA_OGC_FID, (Json(geojson_data),))
                rows = cur.fetchall()
                area_city_ids = list({r[0] for r in rows})

                cur.execute(SQL_TOWER_UPLOAD_PAIRWISE, (Json(geojson_data), radius))
                rows = cur.fetchall()
                cols = [desc[0] for desc in cur.description]
                df = pd.DataFrame(rows, columns=cols)
        else:
            with conn.cursor() as cur:
                cur.execute(
                    SQL_TOWER_PAIRWISE,
                    (radius, area_city_ids),
                )
                rows = cur.fetchall()
                cols = [desc[0] for desc in cur.description]
                df = pd.DataFrame(rows, columns=cols)

        # priority
        priority_default = ["TBG", "Alfa", "Balcom", "CTM", "Gihon", "PKP", "SRG"]
        if not priority:
            priority = priority_default

        priority_map = {name: i for i, name in enumerate(priority)}

        # df all unique towers
        df_towers = (
            df[
                [
                    "t1",
                    "t1_name",
                    "t1_code",
                    "t1_owner",
                    "t1_fp",
                    "t1_latitude",
                    "t1_longitude",
                    "t1_geom",
                    "t1_source",
                ]
            ]
            .drop_duplicates(subset=["t1"])
            .copy()
        )
        df_towers.rename(columns=lambda x: x.replace("t1_", ""), inplace=True)
        df_towers.rename(columns={"t1": "id"}, inplace=True)

        # create df_single & df_pairs with clear duplicate pairs
        df["t1"] = df["t1"].astype(int)
        df["t2"] = df["t2"].astype("Int64")

        df_single = df[df["t2"].isna()].copy()

        df_pairs = df[df["t2"].notna()].copy()
        df_pairs["pair_key"] = df_pairs.apply(
            lambda r: tuple(sorted([r["t1"], r["t2"]])), axis=1
        )
        df_pairs = df_pairs.drop_duplicates(subset=["pair_key"]).drop(
            columns=["pair_key"]
        )

        # create df_win
        df2 = df_pairs.copy()
        df2["winner"] = df2.apply(lambda r: find_winner(priority_map, r), axis=1)
        df_win = df2.apply(ensure_winner_t1, axis=1)
        df_win = (
            df_win.drop(columns=["winner"])
            .sort_values(["t1_fp", "t2_fp"], ascending=[False, False])
            .reset_index(drop=True)
        )

        geom_final = create_topology(df_win)

        # gabungkan informasi semua tower
        all_towers = {}
        for tid, geom in geom_final.items():
            row = df_towers.loc[df_towers["id"] == tid]
            info = {
                "name": row["name"].values[0] if not row.empty else None,
                "code": row["code"].values[0] if not row.empty else None,
                "owner": row["owner"].values[0] if not row.empty else None,
                "latitude": row["latitude"].values[0] if not row.empty else None,
                "longitude": row["longitude"].values[0] if not row.empty else None,
                "source": row["source"].values[0] if not row.empty else "database",
            }
            all_towers[tid] = {"geom": geom, "info": info}

        df_single = df_single.rename(
            columns={
                "t1_name": "name",
                "t1_code": "code",
                "t1_owner": "owner",
                "t1_latitude": "latitude",
                "t1_longitude": "longitude",
                "t1_source": "source",
            }
        )
        for _, row in df_single.iterrows():
            tid = row["t1"]
            if tid in all_towers:
                continue
            geom = wkb.loads(bytes.fromhex(row["t1_geom"]))
            info = {
                k: row[k]
                for k in ["name", "code", "owner", "latitude", "longitude", "source"]
            }
            all_towers[tid] = {"geom": geom, "info": info}

        ### BUFFER TOWER PROCESS ###
        ## Create df_result & geojson_buffer##
        values_sql = []
        for tid, data in all_towers.items():
            geom = data["geom"]
            info = data.get("info", {})

            if isinstance(geom, Polygon):
                geom = MultiPolygon([geom])
            geom_wkt = geom.wkt.replace("'", "''")

            name_sql = sql_str(info.get("name"))
            code_sql = sql_str(info.get("code"))
            owner_sql = sql_str(info.get("owner"))
            latitude_sql = sql_str(info.get("latitude"))
            longitude_sql = sql_str(info.get("longitude"))
            source_sql = sql_str(info.get("source", "database"))

            values_sql.append(
                f"({tid}, ST_GeomFromText('{geom_wkt}', 4326), {name_sql}, {code_sql}, {owner_sql}, {latitude_sql}, {longitude_sql}, {source_sql})"
            )

        values_sql_str = ",\n".join(values_sql)
        SQL_TOWER_BUFFER = sql_tower_buffer(values_sql_str)
        with conn.cursor() as cur:
            cur.execute(SQL_TOWER_BUFFER)
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description]
            df_result = pd.DataFrame(rows, columns=columns)

        # build geojson
        df_result["fp_by_hs_class"] = df_result.apply(
            lambda r: {
                "high": int(r["high"]),
                "mid": int(r["mid"]),
                "low": int(r["low"]),
                "very_low": int(r["very_low"]),
                "non_residential": int(r["non_residential"]),
            },
            axis=1,
        )
        buffer_features = []
        for _, row in df_result.iterrows():
            geom = wkt.loads(row["geom_wkt"])
            fp_by_hs_class = {k: int(v) for k, v in row["fp_by_hs_class"].items()}
            feature = {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {
                    "id": int(row["id"]) if not pd.isna(row["id"]) else None,
                    "name": row["name"],
                    "code": row["code"],
                    "owner": row["owner"],
                    "fp_by_hs_class": fp_by_hs_class,
                    "final_footprint_count": int(row["final_footprint_count"]),
                    "source": row["source"],
                },
            }
            buffer_features.append(feature)

        geojson_buffer = {"type": "FeatureCollection", "features": buffer_features}
        ### BUFFER TOWER PROCESS (END) ###

        ### SECTORIZE POLYGON ###
        values_sql2 = []
        for _, row in df_result.iterrows():
            tower_id = row["id"]
            geom_wkt = row["geom_wkt"].replace("'", "''")  # escape single quote
            latitude = row["latitude"]  # numeric (jangan pakai sql_str)
            longitude = row["longitude"]
            values_sql2.append(
                f"({tower_id}, ST_GeomFromText('{geom_wkt}', 4326), {latitude}, {longitude})"
            )

        values_sql_str2 = ",\n".join(values_sql2)
        SQL_TOWER_SECTORIZE = sql_tower_sectorize(values_sql_str2)
        with conn.cursor() as cur:
            cur.execute(SQL_TOWER_SECTORIZE)
            rows = cur.fetchall()
            columns = [desc[0] for desc in cur.description]
            df_angle = pd.DataFrame(rows, columns=columns)

        sliding_window = 36 // sector_count
        df_best_sector = compute_sector_window(df_angle, sliding_window)

        result_rows = []
        for tower_id, df_t in df_angle.groupby("tower_id"):
            # ambil start angle dari df_best_sector
            start = df_best_sector.loc[
                df_best_sector["tower_id"] == tower_id, "start_angle"
            ].iloc[0]
            ranges = build_sector_ranges(start)
            # assign sektor
            df_t["sector_id"] = df_t["angle_deg"].apply(
                lambda x: classify_angle(x, ranges)
            )
            # hitung banyaknya fp per sektor
            count_df = (
                df_t.groupby("sector_id")["fp_id"]
                .count()
                .reset_index(name="count_footprint")
            )
            count_df["tower_id"] = tower_id
            result_rows.append(count_df)

        # hasil final
        df_sector_count = pd.concat(result_rows, ignore_index=True)
        df_sector_count = df_sector_count[["tower_id", "sector_id", "count_footprint"]]

        df_sector_count.sort_values(["tower_id", "sector_id"], inplace=True)
        df_sector_count.reset_index(drop=True, inplace=True)

        colors = ["#FF0000", "#00FF00", "#0000FF"]
        sector_features = []
        sector_feature_id = 1  # counter unik
        count_lookup = {
            (row.tower_id, row.sector_id): row.count_footprint
            for _, row in df_sector_count.iterrows()
        }
        for _, row in df_result.iterrows():
            poly_raw = wkt.loads(row["geom_wkt"])
            poly = make_valid(poly_raw)
            center = Point(row["longitude"], row["latitude"])

            matching_rows = df_best_sector[df_best_sector.tower_id == row["id"]]
            if matching_rows.empty:
                # misal skip tower ini
                continue
            best_sector_row = matching_rows.iloc[0]

            # Cari start_angle dari df_best_sector
            best_sector_row = df_best_sector[df_best_sector.tower_id == row["id"]].iloc[
                0
            ]
            start_angle_0 = best_sector_row.start_angle % 360
            step = 360 // sector_count

            start_angles = [
                (start_angle_0 + i * step) % 360 for i in range(sector_count)
            ]

            for i, sa in enumerate(start_angles):
                ea = (sa + step) % 360
                sector_wedge = create_sector(center.x, center.y, radius, sa, ea)
                intersected = poly.intersection(sector_wedge)

                if intersected.is_empty:
                    continue

                count_fp = int(count_lookup.get((row["id"], i + 1), 0))  # pastikan int
                count_fp_total = int(row.get("final_footprint_count", 0))
                if count_fp_total > 0:
                    percentage_fp = round(count_fp / count_fp_total * 100, 2)
                else:
                    percentage_fp = 0.0
                # Tangani GeometryCollection
                if intersected.geom_type == "GeometryCollection":
                    for geom in intersected.geoms:
                        if not geom.is_empty:
                            sector_features.append(
                                {
                                    "type": "Feature",
                                    "geometry": mapping(geom),
                                    "properties": {
                                        "id": sector_feature_id,
                                        "tower_id": row["id"],
                                        "sector_id": i + 1,
                                        "fill": colors[i],
                                        "count_footprint": count_fp,
                                        "percentage": percentage_fp,
                                        "source": row["source"],
                                    },
                                }
                            )
                else:
                    sector_features.append(
                        {
                            "type": "Feature",
                            "geometry": mapping(intersected),
                            "properties": {
                                "id": sector_feature_id,
                                "tower_id": row["id"],
                                "sector_id": i + 1,
                                "fill": colors[i],
                                "count_footprint": count_fp,
                                "percentage": percentage_fp,
                                "source": row["source"],
                            },
                        }
                    )
                sector_feature_id += 1  # increment ID

        geojson_sector = {"type": "FeatureCollection", "features": sector_features}
        ### SECTORIZE POLYGON (END) ###

        ### TOWER RESULT ###
        tower_features = []
        for _, row in df_towers.iterrows():
            geom = Point(row["longitude"], row["latitude"])
            feature = {
                "type": "Feature",
                "geometry": mapping(geom),
                "properties": {
                    "id": row["id"],
                    "name": row.get("name", None),
                    "code": row.get("code", None),
                    "owner": row.get("owner", None),
                    "source": row.get("source", "database"),
                },
            }
            tower_features.append(feature)

        tower_features = merge_buffer_to_tower(buffer_features, tower_features)

        geojson_tower = {"type": "FeatureCollection", "features": tower_features}
        ### TOWER RESULT (END) ###

        ### STATISTICS & ANALYTICS ###
        # Chart: Jumlah footprint per owner tower
        # Total footprint keseluruhan
        total_footprint = int(df_result["final_footprint_count"].sum())

        fp_by_owner_df = (
            df_result.groupby("owner")["final_footprint_count"].sum().reset_index()
        )
        fp_by_owner_df.columns = ["owner", "footprint_count"]
        fp_by_owner_df = fp_by_owner_df.sort_values("footprint_count", ascending=False)
        # Convert to native Python types for JSON serialization
        chart_fp_by_owner = [
            {
                "owner": str(row["owner"]),
                "footprint_count": int(row["footprint_count"]),
                "percentage": float(
                    round(
                        (
                            (row["footprint_count"] / total_footprint * 100)
                            if total_footprint > 0
                            else 0
                        ),
                        2,
                    )
                ),
            }
            for _, row in fp_by_owner_df.iterrows()
        ]

        # Bounding box dari semua tower yang dianalisis
        if not df_result.empty:
            bounding_box = [
                float(df_result["longitude"].min()),
                float(df_result["latitude"].min()),
                float(df_result["longitude"].max()),
                float(df_result["latitude"].max()),
            ]
        else:
            bounding_box = None
        ### STATISTICS & ANALYTICS (END) ###

        result = {
            "options": {
                "area_city_ids": area_city_ids,
                "radius": radius,
                "priority": priority,
            },
            "bounding_box": bounding_box,
            "analytics": {
                "total_towers": len(df_result),
                "total_footprint": total_footprint,
                "fp_by_owner": chart_fp_by_owner,
            },
            "geojson_tower": geojson_tower,
            "geojson_buffer": geojson_buffer,
            "geojson_sector": geojson_sector,
        }

        # file_path = "/data/qmi_result.json"
        # with open(file_path, "w", encoding="utf-8") as f:
        #     json.dump(result, f, ensure_ascii=False, indent=2)

        ## UPLOAD EXCEL RESULT ##
        file_key = str(uuid4())
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if not analysis_name:
            analysis_name = f"qmi_result_{timestamp}"

        filename_disk = f"{file_key}.xlsx"
        filename_download = f"{analysis_name}.xlsx"

        df_result.drop(
            columns=["geom_wkt", "fp_by_hs_class"], errors="ignore", inplace=True
        )
        df_result["priority"] = df_result["owner"].map(priority_map).fillna(998) + 1
        df_result["priority"] = df_result["priority"].astype(int)
        df_result = df_result.sort_values("priority")
        file_size = upload_df_excel_to_minio(df_result, filename_disk)
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
                    INSERT INTO qmi_result(date_created, name, user_created, result, geoprocessing_uuid, excel)
                    VALUES (NOW(), %s, %s, %s, %s, %s)
                    RETURNING id;
                    """,
                    (analysis_name, user, Json(result), geoprocessing_uuid, file_key),
                )
                qmi_result_id = cur.fetchone()[0]

        ## char jumlah fp per owner tower
        ## jumlah fp total
        ## di klik kedap kedip analysisnya (sudah ada keterangan owner di geojson)
        ## bounding box tower analysis

        message = {
            "options": {
                "mode": mode,
                "area_city_ids": area_city_ids,
                "radius": radius,
                "file_id": file_id,
                "priority": priority,
                "sector_count": sector_count,
            },
            "qmi_result_id": qmi_result_id,
            "status": "success",
        }

        logger.info(message)

        clear_directus_cache()
        return {"result": message}
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


@dramatiq.actor(store_results=True)
def quick_market_insight_merge(
    user: str,
    geoprocessing_uuid: str,
    qmi_id: list[int],
    analysis_name: str | None = None,
):
    conn = None
    try:
        conn = pool.getconn()
        logger.info("merge")

        results = []

        with conn.cursor() as cur:
            for qid in qmi_id:
                cur.execute(
                    """
                    SELECT id, name, result
                    FROM qmi_result
                    WHERE id = %s;
                    """,
                    (qid,),
                )
                row = cur.fetchone()
                if row:
                    row_dict = {"id": row[0], "name": row[1], "result": row[2]}
                    results.append(row_dict)

        # === MERGE BASED ON PRIORITY ===
        geojson_tower = {"type": "FeatureCollection", "features": []}
        geojson_buffer = {"type": "FeatureCollection", "features": []}
        geojson_sector = {"type": "FeatureCollection", "features": []}

        used_tower_ids = set()
        used_buffer_ids = set()
        used_sector_ids = set()

        # Collect merged options (area_city_ids, radius, priority)
        merged_options = {
            "area_city_ids": [],
            "radius": [],
            "priority": [],
        }

        # For DataFrame rows
        df_rows = []

        for idx, res in enumerate(results):
            r = res["result"]

            # Collect options
            if "options" in r:
                if "area_city_ids" in r["options"]:
                    merged_options["area_city_ids"].extend(
                        r["options"]["area_city_ids"]
                    )
                if "radius" in r["options"] and r["options"]["radius"] is not None:
                    merged_options["radius"].append(r["options"]["radius"])
                if "priority" in r["options"] and r["options"]["priority"] is not None:
                    merged_options["priority"].append(r["options"]["priority"])

            # Get priority list for current QMI
            priority_list = r["options"].get("priority", [])

            # Merge geojson_tower with priority assignment
            for feat in r["geojson_tower"]["features"]:
                fid = feat["properties"]["id"]
                source = feat["properties"].get("source", "database")

                # For database source: check if already used (unique by id)
                # For upload source: always append (no duplicate check)
                should_add = False
                if source == "upload":
                    should_add = True
                elif source == "database" and fid not in used_tower_ids:
                    should_add = True
                    used_tower_ids.add(fid)

                if should_add:
                    # Add priority to tower properties
                    owner = feat["properties"].get("owner", "Unknown")
                    if priority_list and owner in priority_list:
                        owner_priority = priority_list.index(owner) + 1
                        feat["properties"]["priority"] = f"{idx + 1}-{owner_priority}"
                    else:
                        feat["properties"]["priority"] = ""

                    geojson_tower["features"].append(feat)

                    # Build DataFrame row
                    coords = feat["geometry"]["coordinates"]
                    props = feat["properties"]
                    fp_by_hs = props.get("fp_by_hs_class", {})

                    row = {
                        "id": fid,
                        "name": props.get("name"),
                        "code": props.get("code"),
                        "owner": props.get("owner"),
                        "latitude": coords[1],
                        "longitude": coords[0],
                        "high": fp_by_hs.get("high", 0),
                        "mid": fp_by_hs.get("mid", 0),
                        "low": fp_by_hs.get("low", 0),
                        "very_low": fp_by_hs.get("very_low", 0),
                        "non_residential": fp_by_hs.get("non_residential", 0),
                        "final_footprint_count": props.get("final_footprint_count", 0),
                        "priority": props.get("priority", ""),
                        "source": source,
                    }
                    df_rows.append(row)

            # Merge geojson_buffer
            for feat in r["geojson_buffer"]["features"]:
                fid = feat["properties"]["id"]
                source = feat["properties"].get("source", "database")

                # For database source: check if already used
                # For upload source: always append
                should_add = False
                if source == "upload":
                    should_add = True
                elif source == "database" and fid not in used_buffer_ids:
                    should_add = True
                    used_buffer_ids.add(fid)

                if should_add:
                    geojson_buffer["features"].append(feat)

            # Merge geojson_sector (unique by tower_id + sector_id for database source)
            for feat in r["geojson_sector"]["features"]:
                tower_id = feat["properties"]["tower_id"]
                sector_id = feat["properties"]["sector_id"]
                source = feat["properties"].get("source", "database")
                unique_key = (tower_id, sector_id)

                # For database source: check if already used
                # For upload source: always append (no duplicate check)
                should_add = False
                if source == "upload":
                    should_add = True
                elif source == "database" and unique_key not in used_sector_ids:
                    should_add = True
                    used_sector_ids.add(unique_key)

                if should_add:
                    geojson_sector["features"].append(feat)

        # Remove duplicate area_city_ids
        merged_options["area_city_ids"] = list(set(merged_options["area_city_ids"]))

        # Calculate analytics
        total_footprint = 0
        fp_by_owner = {}

        for feat in geojson_buffer["features"]:
            fp_count = feat["properties"].get("final_footprint_count", 0)
            owner = feat["properties"].get("owner", "Unknown")

            total_footprint += fp_count
            if owner not in fp_by_owner:
                fp_by_owner[owner] = 0
            fp_by_owner[owner] += fp_count

        # Convert fp_by_owner to chart format
        chart_fp_by_owner = [
            {
                "owner": owner,
                "footprint_count": count,
                "percentage": float(
                    round(
                        (count / total_footprint * 100) if total_footprint > 0 else 0, 2
                    )
                ),
            }
            for owner, count in sorted(
                fp_by_owner.items(), key=lambda x: x[1], reverse=True
            )
        ]

        # Calculate bounding box from tower features
        if geojson_tower["features"]:
            lons = []
            lats = []
            for feat in geojson_tower["features"]:
                coords = feat["geometry"]["coordinates"]
                lons.append(coords[0])
                lats.append(coords[1])

            bounding_box = [
                min(lons),  # min longitude
                min(lats),  # min latitude
                max(lons),  # max longitude
                max(lats),  # max latitude
            ]
        else:
            bounding_box = None

        # Create DataFrame from rows
        df_result = pd.DataFrame(df_rows)

        # Sort by priority
        # Create a helper column for sorting: split "1-1" into (1, 1) for proper sorting
        def parse_priority(priority_str):
            if not priority_str or priority_str == "":
                return (999, 999)  # Empty priorities go last
            parts = priority_str.split("-")
            return (int(parts[0]), int(parts[1]))

        df_result["_sort_key"] = df_result["priority"].apply(parse_priority)
        df_result = df_result.sort_values("_sort_key")
        df_result = df_result.drop(columns=["_sort_key"])

        # Upload Excel to MinIO
        file_key = str(uuid4())
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if not analysis_name:
            analysis_name = f"qmi_merged_{timestamp}"

        filename_disk = f"{file_key}.xlsx"
        filename_download = f"{analysis_name}.xlsx"

        file_size = upload_df_excel_to_minio(df_result, filename_disk)

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

        # Build result in the same format as quick_market_insight
        result = {
            "options": merged_options,
            "bounding_box": bounding_box,
            "analytics": {
                "total_towers": len(geojson_tower["features"]),
                "total_footprint": total_footprint,
                "fp_by_owner": chart_fp_by_owner,
            },
            "geojson_tower": geojson_tower,
            "geojson_buffer": geojson_buffer,
            "geojson_sector": geojson_sector,
        }
        # file_path = "/data/qmi_merged.json"
        # with open(file_path, "w", encoding="utf-8") as f:
        #     json.dump(result, f, ensure_ascii=False, indent=2)

        # Insert merged result to qmi_result table
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO qmi_result(date_created, name, user_created, result, geoprocessing_uuid, excel)
                    VALUES (NOW(), %s, %s, %s, %s, %s)
                    RETURNING id;
                    """,
                    (analysis_name, user, Json(result), geoprocessing_uuid, file_key),
                )
                qmi_result_id = cur.fetchone()[0]

        clear_directus_cache()
        return {"status": "success", "qmi_id": qmi_id, "qmi_result_id": qmi_result_id}
        # return result
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
