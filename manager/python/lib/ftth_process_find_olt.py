import math
import numpy as np
import pandas as pd
import geopandas as gpd

from .ftth_process import find_site_olt

# ---------------------------
# CONFIG
# ---------------------------
CABLE_RULES = [
    {"max_odc": 24, "cable": "feeder_cable_24"},
    {"max_odc": 48, "cable": "feeder_cable_48"},
    {"max_odc": 96, "cable": "feeder_cable_96"},
    {"max_odc": 144, "cable": "feeder_cable_144"},
    {"max_odc": 288, "cable": "feeder_cable_288"},
]

MAX_CAPACITY = 288

# CABLE_RULES = [
#     {"max_odc": 2, "cable": "feeder_cable_24"},
#     {"max_odc": 4, "cable": "feeder_cable_48"},
#     {"max_odc": 8, "cable": "feeder_cable_96"},
#     {"max_odc": 16, "cable": "feeder_cable_144"},
#     {"max_odc": 32, "cable": "feeder_cable_288"},
# ]

# MAX_CAPACITY = 4


# ---------------------------
# HELPER: cable type
# ---------------------------
def get_cable_type(total_odc):
    for rule in CABLE_RULES:
        if total_odc <= rule["max_odc"]:
            return rule["cable"]
    return "288C"  # fallback (should not happen)


# ---------------------------
# HELPER: capacity-first clustering
# ---------------------------
def split_odc_capacity_first(gdf_odc, max_capacity=288):
    if len(gdf_odc) == 0:
        return []

    gdf = gdf_odc.copy().to_crs(3857)
    gdf["x"] = gdf.geometry.x
    gdf["y"] = gdf.geometry.y

    remaining = gdf.copy()
    clusters = []

    while len(remaining) > 0:
        # ambil seed random biar tidak bias urutan
        seed = remaining.sample(1).iloc[0]
        seed_point = np.array([seed["x"], seed["y"]])

        coords = remaining[["x", "y"]].values
        dists = np.linalg.norm(coords - seed_point, axis=1)

        remaining = remaining.assign(dist=dists)

        cluster = remaining.sort_values("dist").iloc[:max_capacity]

        clusters.append(cluster.drop(columns=["x", "y", "dist"]))

        remaining = remaining.drop(cluster.index)

    return clusters


# ---------------------------
# MAIN: FTTH planner
# ---------------------------
def plan_ftth_network(
    conn,
    gdf_odc,
    route_type_id=3,
    olt_mode="site",
    tower_ids=None,
    coordinates=None,
):
    """
    Return list of cluster results:
    - tiap cluster punya OLT sendiri
    - cable type sesuai kapasitas
    - sumber lokasi OLT: olt_mode "site" | "tower" | "input"
    """

    if len(gdf_odc) == 0:
        return [], None, None, None

    results = []
    all_parent_lines = []
    all_sub_lines = []
    all_junction_poles = []

    # 1. split berdasarkan kapasitas
    clusters = split_odc_capacity_first(gdf_odc, MAX_CAPACITY)

    # 2. proses tiap cluster
    used_olt_ids = set()
    for i, cluster in enumerate(clusters):
        total_odc = len(cluster)
        cable_type = get_cable_type(total_odc)

        (
            olt_site_point_id,
            olt_asset_id,
            gdf_parent_line,
            gdf_sub_line,
            odc_center_odp_id,
            gdf_junction_pole,
            mst_edges,
            olt_geom,
        ) = find_site_olt(
            conn,
            cluster,
            route_type_id,
            exclude_olt_ids=used_olt_ids,
            junction_prefix=f"JX{i}_",
            olt_mode=olt_mode,
            tower_ids=tower_ids,
            coordinates=coordinates,
        )

        # dedup OLT pakai olt_key (site_point_id / ogc_fid / index)
        if olt_site_point_id is not None:
            used_olt_ids.add(olt_site_point_id)

        cluster_odp_ids = cluster["odp_id"].dropna().tolist()
        odc_other_odp_ids = [x for x in cluster_odp_ids if x != odc_center_odp_id]

        if gdf_parent_line is not None and len(gdf_parent_line) > 0:
            gdf_parent_line = gdf_parent_line.copy()
            gdf_parent_line["cluster_index"] = i
            gdf_parent_line["cable_type"] = cable_type
            all_parent_lines.append(gdf_parent_line)

        if gdf_sub_line is not None and len(gdf_sub_line) > 0:
            gdf_sub_line = gdf_sub_line.copy()
            gdf_sub_line["cluster_index"] = i
            gdf_sub_line["cable_type"] = cable_type
            all_sub_lines.append(gdf_sub_line)

        if gdf_junction_pole is not None and len(gdf_junction_pole) > 0:
            gdf_junction_pole = gdf_junction_pole.copy()
            gdf_junction_pole["cluster_index"] = i
            all_junction_poles.append(gdf_junction_pole)

        results.append(
            {
                "cluster_index": i,
                "total_odc": total_odc,
                "cable_type": cable_type,
                "olt_site_point_id": olt_site_point_id,
                "olt_asset_id": olt_asset_id,
                "odc_center_odp_id": odc_center_odp_id,
                "odc_other_odp_ids": odc_other_odp_ids,
                "mst_edges": mst_edges or [],
                "olt_geom": olt_geom,
            }
        )
    gdf_all_parent_line = (
        gpd.GeoDataFrame(
            pd.concat(all_parent_lines, ignore_index=True), crs="EPSG:4326"
        )
        if all_parent_lines
        else None
    )
    gdf_all_sub_line = (
        gpd.GeoDataFrame(pd.concat(all_sub_lines, ignore_index=True), crs="EPSG:4326")
        if all_sub_lines
        else None
    )
    gdf_all_junction_pole = (
        gpd.GeoDataFrame(
            pd.concat(all_junction_poles, ignore_index=True), crs="EPSG:4326"
        )
        if all_junction_poles
        else None
    )

    return (
        results,
        gdf_all_parent_line,
        gdf_all_sub_line,
        gdf_all_junction_pole,
    )
