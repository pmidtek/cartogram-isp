import os
import math
import traceback
from datetime import datetime

import dramatiq
from dramatiq.middleware import TimeLimitExceeded

from psycopg2.extras import Json

from io import BytesIO
import pandas as pd

from lib.clear_directus_cache import clear_directus_cache
from utils import logger, pool, minio_client

HS_CLASS_KEYS = ["high", "mid", "low", "very_low", "non_residential"]

# hs_class mapping (same as quick_potential_insight)
HS_CLASS_CASE = """
    CASE
        WHEN f.hs_class = 'A' THEN 'high'
        WHEN f.hs_class = 'B' THEN 'mid'
        WHEN f.hs_class = 'C' THEN 'low'
        WHEN f.hs_class = 'C1' THEN 'very_low'
        WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
        ELSE 'non_residential'
    END
"""

# Sectorization constants
SECTOR_WIDTHS = [60, 85, 90, 120]  # allowed beam widths (degrees)
COVER_RATIO = 0.9  # smallest beam must cover >= 90% of the sector's footprints
SECTOR_SPAN = 120  # each sector claims a ~120 deg arc
BIN_DEG = 10  # histogram resolution (degrees)
N_BINS = 360 // BIN_DEG  # 36 bins

# {tower_cte} -> CTE named `tower` with columns:
#   id, name, code, owner, longitude, latitude, pt (geom 4326), source
TOWER_CTE_DB = """
        SELECT
            sp.id, sp.name, sp.code, sp."owner",
            ST_X(sp.geom) AS longitude, ST_Y(sp.geom) AS latitude,
            sp.geom AS pt, ST_Buffer(sp.geom::geography, %s)::geometry AS buf,
            'database' AS source
        FROM site_points sp
        INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
        WHERE spt.name = 'Tower' AND sp.area_city_id = ANY(%s)
"""

TOWER_CTE_UPLOAD = """
        SELECT
            row_number() OVER () AS id,
            (feat->'properties'->>'name') AS name,
            (feat->'properties'->>'code') AS code,
            (feat->'properties'->>'owner') AS owner,
            (feat->'geometry'->'coordinates'->>0)::float AS longitude,
            (feat->'geometry'->'coordinates'->>1)::float AS latitude,
            ST_SetSRID(ST_MakePoint(
                (feat->'geometry'->'coordinates'->>0)::float,
                (feat->'geometry'->'coordinates'->>1)::float
            ), 4326) AS pt,
            ST_Buffer(
                ST_SetSRID(
                    ST_MakePoint(
                        (feat->'geometry'->'coordinates'->>0)::float,
                        (feat->'geometry'->'coordinates'->>1)::float
                    ),
                    4326
                )::geography,
                %s
            )::geometry AS buf,
            'upload' AS source
        FROM (SELECT %s::jsonb AS fc) geojson,
             jsonb_array_elements(fc->'features') AS feat
"""

# Towers (kept even when they have no footprint in radius)
Q_TOWERS_TEMPLATE = """
    WITH tower AS (
        {tower_cte}
    )
    SELECT
        id, name, code, owner, longitude, latitude,
        ST_AsText(pt) AS geom_wkt, source
    FROM tower
    ORDER BY id;
"""

# Footprint azimuth per footprint (one spatial join). Binning is done in Python
# only for sector placement; counting uses the exact azimuth so the result matches
# the recompute hook (extensions/.../handle-antenna-direction-item-data).
Q_HIST_TEMPLATE = """
    WITH tower AS (
        {tower_cte}
    ),
    fp AS (
        SELECT
            t.id AS tower_id,
            degrees(ST_Azimuth(t.pt::geography, ST_Centroid(f.geom)::geography)) AS az,
            {hs_class_case} AS hs_class
        FROM tower t
        JOIN sp_data_footprint f
        ON t.buf && f.geom AND ST_Intersects(t.buf, f.geom)
        WHERE f.hs_class IS NOT NULL
    )
    SELECT tower_id, az, hs_class FROM fp;
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
    return {"type": "FeatureCollection", "features": features}


def bin_center(i):
    return i * BIN_DEG + BIN_DEG / 2.0


def circ_in_arc(angle, center, width):
    """True if `angle` (deg) lies within the arc centered at `center` with `width` (deg)."""
    diff = abs(((angle - center + 180) % 360) - 180)
    return diff <= width / 2.0


def circ_mean(weighted):
    """Circular mean of (angle_deg, weight) pairs, normalized to [0, 360)."""
    s = sum(w * math.sin(math.radians(a)) for a, w in weighted)
    c = sum(w * math.cos(math.radians(a)) for a, w in weighted)
    if s == 0 and c == 0:
        return None
    return (math.degrees(math.atan2(s, c)) + 360) % 360


def _beam_degrees(az, w):
    """Integer degrees [floor(az-w/2) .. ceil(az+w/2)) covered by a beam, mod 360.

    Half-open so two abutting beams sharing a boundary are not treated as overlapping.
    """
    half = w / 2.0
    start = int(math.floor(az - half))
    end = int(math.ceil(az + half))
    return [d % 360 for d in range(start, end)]


def _beam_free(az, w, blocked_deg):
    """True if no degree covered by beam(az, w) is already occupied."""
    return not any(blocked_deg[d] for d in _beam_degrees(az, w))


def _block_beam(az, w, blocked_deg):
    for d in _beam_degrees(az, w):
        blocked_deg[d] = True


def _search_az(az0, lo, hi, w, blocked_deg):
    """Closest azimuth to az0 within [lo, hi] whose beam is free of blocked_deg.

    Returns the azimuth (un-normalized, may be outside [0,360)) or None.
    """
    base = min(max(az0, lo), hi)
    span = hi - lo
    step = 0
    while step <= span + 1:
        for cand in (base - step, base + step):
            if lo - 1e-9 <= cand <= hi + 1e-9 and _beam_free(cand, w, blocked_deg):
                return cand
        if step == 0:
            # base failed; only widen outward from here
            pass
        step += 1
    return None


def _place_beam(remaining, claimed_idx, claimed_total, best_center, az0, blocked_deg):
    """Pick (azimuth, beam_width): smallest width covering >=90% with a free beam,
    clamped inside the 120deg claim window. Falls back to the widest placeable beam.
    Returns (azimuth_normalized, beam_width) or None when nothing fits without overlap.
    """

    def window_bounds(w):
        half = w / 2.0
        lo, hi = best_center - (SECTOR_SPAN / 2.0 - half), best_center + (
            SECTOR_SPAN / 2.0 - half
        )
        if lo > hi:  # beam as wide as the window (w == SECTOR_SPAN)
            lo = hi = best_center
        return lo, hi

    def coverage(az, w):
        return sum(
            remaining[bi]
            for bi in claimed_idx
            if circ_in_arc(bin_center(bi), az, w)
        )

    # smallest width that still covers >= COVER_RATIO of the claimed footprints
    for w in SECTOR_WIDTHS:
        lo, hi = window_bounds(w)
        cand = _search_az(az0, lo, hi, w, blocked_deg)
        if cand is not None and coverage(cand, w) >= COVER_RATIO * claimed_total:
            return cand % 360, w

    # fallback: widest width we can place at all, maximizing coverage
    for w in reversed(SECTOR_WIDTHS):
        lo, hi = window_bounds(w)
        cand = _search_az(az0, lo, hi, w, blocked_deg)
        if cand is not None:
            return cand % 360, w

    return None


def compute_sectors(bins, fps, radius):
    """Greedy 120deg-claim + tighten, with a per-degree occupancy mask so the 3
    sector beams never overlap. Returns a list of 3 sector dicts (or None).

    `bins` (10deg histogram) drives sector *placement*; the final footprint count
    & details are computed from `fps` (list of (azimuth, hs_class)) using the exact
    azimuth, so results match the recompute hook."""
    remaining = list(bins)
    blocked_deg = [False] * 360
    sectors = []

    for _ in range(3):
        if sum(remaining) <= 0:
            sectors.append(None)
            continue

        # 1. best 120deg arc center (max footprint count) over remaining bins
        best_center, best_total = None, -1
        for ci in range(N_BINS):
            center = bin_center(ci)
            total = sum(
                remaining[bi]
                for bi in range(N_BINS)
                if circ_in_arc(bin_center(bi), center, SECTOR_SPAN)
            )
            if total > best_total:
                best_total, best_center = total, center

        if best_total <= 0:
            sectors.append(None)
            continue

        claimed_idx = [
            bi
            for bi in range(N_BINS)
            if circ_in_arc(bin_center(bi), best_center, SECTOR_SPAN)
            and remaining[bi] > 0
        ]
        claimed_total = sum(remaining[bi] for bi in claimed_idx)

        # 2. azimuth = weighted circular mean of claimed bins
        az0 = circ_mean([(bin_center(bi), remaining[bi]) for bi in claimed_idx])
        if az0 is None:
            az0 = best_center

        # 3. place beam: smallest free width covering >=90%, clamped within the window
        placement = _place_beam(
            remaining, claimed_idx, claimed_total, best_center, az0, blocked_deg
        )
        if placement is None:
            # cannot place without overlapping an existing sector -> skip
            for bi in claimed_idx:
                remaining[bi] = 0
            sectors.append(None)
            continue
        azimuth, beam_width = placement

        # 4. footprint count & details within the final beam, using the exact
        #    per-footprint azimuth (no binning) so it matches the recompute hook.
        in_beam_fps = [(a, k) for (a, k) in fps if circ_in_arc(a, azimuth, beam_width)]
        fp_count = len(in_beam_fps)
        details = {k: 0 for k in HS_CLASS_KEYS}
        for _, k in in_beam_fps:
            details[k] = details.get(k, 0) + 1

        # 5. analytic sector area = 0.5 * r^2 * theta
        coverage = 0.5 * radius * radius * math.radians(beam_width)

        sectors.append(
            {
                "azimuth": round(azimuth, 2),
                "beam_width": beam_width,
                "coverage_area_m2": round(coverage, 2),
                "footprint_count": fp_count,
                "footprint_details": details,
            }
        )

        # 6. occupy this beam's degrees, then drop the whole claimed 120deg arc so
        #    the next sector moves to a different region.
        _block_beam(azimuth, beam_width, blocked_deg)
        for bi in claimed_idx:
            remaining[bi] = 0

    # order sectors by azimuth (s1 <= s2 <= s3); None last
    sectors.sort(key=lambda s: (s is None, s["azimuth"] if s else 0))
    return sectors


def sector_columns(sec):
    """Flatten a sector dict (or None) to (azimuth, beam_width, coverage, count, details_json)."""
    if not sec:
        return (None, None, None, None, None)
    return (
        sec["azimuth"],
        sec["beam_width"],
        sec["coverage_area_m2"],
        sec["footprint_count"],
        Json(sec["footprint_details"]),
    )


@dramatiq.actor(store_results=True)
def antenna_direction(
    mode: str,
    user: str,
    geoprocessing_uuid: str,
    radius: int,
    area_city_ids: list[int] | None,
    file_id: str | None,
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
        ## Validation ##

        conn = pool.getconn()
        logger.info("GET OPTIONS")
        if mode == "upload":
            tower_cte = TOWER_CTE_UPLOAD

            bucket_name = os.environ.get("STORAGE_S3_BUCKET")
            storage_root = os.environ.get("STORAGE_S3_ROOT")
            object_name = f"{storage_root}/{file_id}"

            response = minio_client.get_object(bucket_name, object_name)
            file_stream = BytesIO(response.read())
            response.close()
            response.release_conn()

            df_upload = pd.read_csv(file_stream)
            geojson_data = df_to_geojson(df_upload)

            tower_params = (
                radius,
                Json(geojson_data),
            )
            hist_params = (
                radius,
                Json(geojson_data),
            )
        else:
            tower_cte = TOWER_CTE_DB
            tower_params = (
                radius,
                area_city_ids,
            )
            hist_params = (
                radius,
                area_city_ids,
            )
        logger.info("FORMATTING OPTIONS")
        q_towers = Q_TOWERS_TEMPLATE.format(tower_cte=tower_cte)
        q_hist = Q_HIST_TEMPLATE.format(
            tower_cte=tower_cte,
            hs_class_case=HS_CLASS_CASE,
        )
        logger.info("GET TOWER")
        with conn.cursor() as cur:
            cur.execute(q_towers, tower_params)
            tower_rows = cur.fetchall()
            tower_cols = [desc[0] for desc in cur.description]

            cur.execute(q_hist, hist_params)
            hist_rows = cur.fetchall()

        towers = [dict(zip(tower_cols, r)) for r in tower_rows]
        logger.info("ANALYS HIZTOGRAM")
        # histogram[tower_id] -> (bins[N_BINS] for placement, fps for exact count)
        histogram = {}
        for tower_id, az, hs_class in hist_rows:
            if tower_id not in histogram:
                histogram[tower_id] = ([0] * N_BINS, [])
            bins, fps = histogram[tower_id]
            bins[int(math.floor(az / BIN_DEG)) % N_BINS] += 1
            fps.append((az, hs_class))
        logger.info("GET ANTENNA DIRECTION")
        ## Insert antenna_direction (parent) ##
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        if not analysis_name:
            analysis_name = f"antenna_direction_{timestamp}"

        total_footprint = 0
        with conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO antenna_direction(
                        name, geoprocessing_uuid, radius_m, user_created, date_created
                    )
                    VALUES (%s, %s, %s, %s, NOW())
                    RETURNING id;
                    """,
                    (analysis_name, geoprocessing_uuid, radius, user),
                )
                antenna_direction_id = cur.fetchone()[0]

                for tw in towers:
                    tower_id = tw["id"]
                    bins, fps = histogram.get(tower_id, ([0] * N_BINS, []))
                    total_footprint += sum(bins)
                    s1, s2, s3 = compute_sectors(bins, fps, radius)

                    s1_az, s1_bw, s1_area, s1_cnt, s1_det = sector_columns(s1)
                    s2_az, s2_bw, s2_area, s2_cnt, s2_det = sector_columns(s2)
                    s3_az, s3_bw, s3_area, s3_cnt, s3_det = sector_columns(s3)

                    cur.execute(
                        """
                        INSERT INTO antenna_direction_item(
                            antenna_direction_id, tower_source, tower_id,
                            tower_name, tower_code, tower_owner,
                            s1_azimuth, s1_beam_width, s1_coverage_area_m2,
                            s2_azimuth, s2_beam_width, s2_coverage_area_m2,
                            s3_azimuth, s3_beam_width, s3_coverage_area_m2,
                            s1_footprint_count, s2_footprint_count, s3_footprint_count,
                            s1_footprint_details, s2_footprint_details, s3_footprint_details,
                            geom, user_created, date_created
                        )
                        VALUES (
                            %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            %s, %s, %s,
                            ST_GeomFromText(%s, 4326), %s, NOW()
                        );
                        """,
                        (
                            antenna_direction_id,
                            tw["source"],
                            tower_id,
                            tw["name"],
                            tw["code"],
                            tw["owner"],
                            s1_az,
                            s1_bw,
                            s1_area,
                            s2_az,
                            s2_bw,
                            s2_area,
                            s3_az,
                            s3_bw,
                            s3_area,
                            s1_cnt,
                            s2_cnt,
                            s3_cnt,
                            s1_det,
                            s2_det,
                            s3_det,
                            tw["geom_wkt"],
                            user,
                        ),
                    )

        message = {
            "options": {
                "mode": mode,
                "area_city_ids": area_city_ids,
                "radius": radius,
                "file_id": file_id,
            },
            "antenna_direction_id": antenna_direction_id,
            "analytics": {
                "total_towers": len(towers),
                "total_footprint": total_footprint,
            },
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
