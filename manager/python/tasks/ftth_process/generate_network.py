import traceback
import os
import math

import dramatiq
from dramatiq.middleware import TimeLimitExceeded
from openrouteservice import client

import pandas as pd
import numpy as np

import geopandas as gpd

from psycopg2.extras import execute_values

from lib.clear_directus_cache import clear_directus_cache
from lib.ftth_process import (
    get_gdf_road,
    get_gdf_rumah,
    build_site_clusters,
    snap_route_endpoints,
    generate_gdf_odp_candidate,
    assign_all_clusters_cp_sat,
    build_odc_grouping_cp_sat_medoid_clustered,
    assign_odp_roles,
    set_odc_to_odp_anchor,
    build_odc_odp_lines,
    build_odp_rumah_lines,
    find_site_olt,
    split_lines_with_jc,
    split_feeder,
)
from lib.ftth_process_find_olt import plan_ftth_network
from lib.ftth_route_graph import RouteGraph
from lib.ftth_data import (
    insert_site_point_fc,
    insert_asset_fc_bulk,
    insert_route_fc_bulk,
    insert_cable_fc_bulk,
)
from lib.update_status_geoprocessing import (
    update_status_geoprocessing,
    update_ftth_status,
)
from utils import logger, pool, db_conn

import json


@dramatiq.actor(store_results=True, time_limit=21600000)
def generate_network(
    project_id: int,
    uploader: str,
    odc_spacing_m: int = 45,
    message_id: str = None,
    dev_mode: bool = False,
    olt_mode: str = "site",
    tower_ids: list = None,
    coordinates: list = None,
    road_mode: str = "local",
):
    ## status
    # (1/15) Getting OSM road data
    # (2/15) Getting Footprint data
    # (3/15) Generate ODP candidate from OSM data
    # (4/15) Assign Footprint(ONT) to nearest ODP
    # (5/15) Selecting ODC from ODP
    # (6/15) Assign ODP roles
    # (7/15) Generate ODC-ODP Route
    # (8/15) Generate ODP-ONT Route
    # (9/15) Find nearest OLT
    # (10/15) Split line with Clossure
    # (11/15) Register nearest OLT to project
    # (12/15) Generate & Insert to Site Points
    # (13/15) Generate & Insert to Assets
    # (14/15) Generate & Insert to Routes
    # (15/15) Generate & Insert to Cables
    GEOPROCESSING_STEPS = {
        1: "Getting road data",
        2: "Getting Footprint data",
        3: "Generate ODP candidate from road data",
        4: "Assign Footprint (ONT) to nearest ODP",
        5: "Selecting ODC from ODP",
        6: "Assign ODP roles",
        7: "Generate ODC-ODP Route",
        8: "Generate ODP-ONT Route",
        9: "Find nearest OLT",
        10: "Split line with Closure",
        11: "Register nearest OLT to project",
        12: "Generate & Insert to Site Points",
        13: "Generate & Insert to Assets",
        14: "Generate & Insert to Routes",
        15: "Generate & Insert to Cables (Feeder)",
        16: "Generate & Insert to Cables (Distributrion)",
        17: "Generate & Insert to Cables (IKR)",
    }

    def get_step_label(step: int) -> str:
        total = len(GEOPROCESSING_STEPS)
        return f"({step}/{total}) {GEOPROCESSING_STEPS.get(step, 'Unknown Step')}"

    def set_status(step: int):
        # koneksi status diambil sesaat lalu dikembalikan; task ini bisa jalan
        # berjam-jam, jadi jangan tahan koneksi pool hanya untuk update status.
        with db_conn(autocommit=True) as status_conn:
            update_status_geoprocessing(status_conn, message_id, get_step_label(step))

    ## PARAMETER
    buffer_area_m = 20  # buffer polygon project untuk get data OSM jalan

    target_per_cluster = 320  # target clustering rumah dalam pencarian kandidat ODP
    ideal_fill_for_candidate = 8  # ideal rumah per kadidat odp di clustering
    extra_candidates = 4  # tambahan kadidat odp per clustering

    max_per_odp = 8  # maximal rumah per odp
    min_fill = 0  # toleransi minimal rumah dalam odp
    max_dist_m_odp = 45  # batas pencarian rumah ke odp terdekat
    top_k_per_rumah = 10  # batas jumlah potensial odp terdekat
    allow_new_odp = False  # False = pakai ODP existing saja, tidak buat ODP baru

    max_odp_per_odc = 4  # batas maksimal odp per odc
    max_dist_m_odc = 145  # batas pencarian odc ke odp terdekat

    num_workers_odp = 4  # jumlah worker model ODP
    solver_time_limit_odp = 30  # batas waktu solver model CP-SAT ODP
    pole_t7_ratio = 0.2  # komposisi jenis pole: 20% T7, sisanya T6 (JC -> T9)

    num_workers_odc = 4  # jumlah worker model ODC
    solver_time_limit_odc = 30  # batas waktu solver model CP-SAT ODC

    # Semua sequence asset mulai dari 001 per project run.
    # ODC  : ODC<seq>          -> ODC001, ODC002, ...
    # ODP  : <odc_code>.ODP<n> -> ODC001.ODP001 s.d. ODC001.ODP004
    #        n dari role ODP (ODP_1..ODP_4)
    # ONT  : <odp_code>_ONT<n> -> ODC001.ODP001_ONT001 (n per ODP)
    # POLE : jenis tiang saja  -> T6 / T7 / T9
    # Asset lain: <TIPE><seq>  -> JC001.. / OLT001.. / COIL001..

    asset_group = {
        "odc": "M-ODC-D-8SCUPC+",
        "odp": "M-ODP-D-8SCUPC+",
        "ont": "M-ONT-XXX",
        "jc_24": "M-CL-F-24C+",
        "jc_48": "M-CL-F-48C+",
        "jc_96": "M-CL-F-96C+",
        "jc_144": "M-CL-F-144C+",
        "jc_288": "M-CL-F-288C+",
        "pole_6": "T6",
        "pole_7": "T7",
        "pole_9": "T9",
        "feeder_cable_288": "M-FO-288C",
        "feeder_cable_144": "M-FO-144C",
        "feeder_cable_96": "M-FO-96C",
        "feeder_cable_48": "M-FO-48C",
        "feeder_cable_24": "M-FO-24C",
        "dist_cable_50": "M-PR-D-50M",
        "dist_cable_100": "M-PR-D-100M",
        "dist_cable_150": "M-PR-D-150M",
        "drop_cable_50": "M-PR-IKR-50M",
        "drop_cable_100": "M-PR-IKR-100M",
        "drop_cable_150": "M-PR-IKR-150M",
    }

    ## PARAMETER
    # Sumber lokasi OLT: "site" (default) | "tower" | "input"
    if road_mode not in ("osm", "local"):
        raise ValueError(f"road_mode tidak valid: {road_mode}")
    if olt_mode not in ("site", "tower", "input"):
        raise ValueError(f"olt_mode tidak valid: {olt_mode}")
    if olt_mode == "tower" and not tower_ids:
        raise ValueError("olt_mode 'tower' membutuhkan tower_ids (list ogc_fid)")
    if olt_mode == "input" and not coordinates:
        raise ValueError("olt_mode 'input' membutuhkan coordinates [(lon, lat), ...]")

    conn = None
    seq_conn = None
    try:
        conn = pool.getconn()
        ## LOAD ROAD (OSM)
        logger.info("Get OSM road data by project area")
        set_status(1)
        # gdf_road, gdf_project = get_gdf_road(conn, project_id, buffer_area_m)
        # gdf_project.to_file("/data/area.geojson", driver="GeoJSON")
        # gdf_road.to_file("/data/road.geojson", driver="GeoJSON")
        # return None
        if dev_mode:
            gdf_road = gpd.read_file("/data/road.geojson")
            gdf_road = gdf_road.set_crs(epsg=4326).to_crs(epsg=3857)
        else:
            gdf_road, _ = get_gdf_road(
                conn, project_id, buffer_area_m, road_mode=road_mode
            )
            gdf_road = gdf_road.to_crs(epsg=3857)
        logger.info("OSM road loaded")

        ## LOAD RUMAH (FOOTPRINT → POINT)
        set_status(2)
        gdf_rumah = get_gdf_rumah(conn, project_id)
        gdf_rumah = gdf_rumah.to_crs(epsg=3857)

        ## GENERATE ODP CANDIDATE (SETIAP X Meter DI JALAN)
        set_status(3)
        gdf_odp = generate_gdf_odp_candidate(
            gdf_road, odc_spacing_m, road_mode=road_mode
        )

        ## ASSIGN Rumah to ODP
        set_status(4)
        gdf_rumah, gdf_odp = assign_all_clusters_cp_sat(
            gdf_rumah_3857=gdf_rumah,
            gdf_odp_3857=gdf_odp,
            gdf_road_3857=gdf_road,
            target_per_cluster=target_per_cluster,
            max_per_odp=max_per_odp,
            min_fill=min_fill,
            max_dist_m=max_dist_m_odp,
            ideal_fill_for_candidate=ideal_fill_for_candidate,
            extra_candidates=extra_candidates,
            top_k_per_rumah=top_k_per_rumah,
            num_workers=num_workers_odp,
            solver_time_limit=solver_time_limit_odp,
            allow_new_odp=allow_new_odp,
        )

        if dev_mode:
            gdf_rumah = gdf_rumah.to_crs(epsg=4326)
            gdf_odp = gdf_odp.to_crs(epsg=4326)

            gdf_rumah["marker-color"] = "#e10909"
            gdf_odp["marker-color"] = "#1e90ff"

            gdf_rumah.to_file("/data/rumah.geojson", driver="GeoJSON")
            gdf_odp.to_file("/data/odp.geojson", driver="GeoJSON")

            gdf_rumah = gdf_rumah.to_crs(epsg=3857)
            gdf_odp = gdf_odp.to_crs(epsg=3857)

        ## Building ODC
        ors_client = client.Client(key=os.environ.get("ORS_KEY"))
        set_status(5)
        gdf_odp = build_odc_grouping_cp_sat_medoid_clustered(
            gdf_odp,
            max_odp_per_odc=max_odp_per_odc,
            max_dist_m=max_dist_m_odc,
            target_cluster_size=200,
            solver_time_limit=solver_time_limit_odc,
            num_workers=num_workers_odc,
            ors_client=ors_client,
        )

        ## Assign ODP ROLE (ODP 1, ODP 2, ODP 3 & ODP 4)
        set_status(6)
        gdf_odp = assign_odp_roles(gdf_odp)
        gdf_odc = set_odc_to_odp_anchor(gdf_odp)

        if dev_mode:
            gdf_odc = gdf_odc.to_crs(epsg=4326)
            gdf_odc["marker-color"] = "#2ecc71"
            gdf_odc.to_file("/data/odc.geojson", driver="GeoJSON")

            gdf_odp = gdf_odp.to_crs(epsg=4326)
            gdf_odp.to_file("/data/odp.geojson", driver="GeoJSON")

            # gdf_odc = gpd.read_file("/data/odc.geojson")
            # gdf_odp = gpd.read_file("/data/odp.geojson")
            # gdf_rumah = gpd.read_file("/data/rumah.geojson")

            gdf_odc = gdf_odc.to_crs(epsg=3857)
            gdf_odp = gdf_odp.to_crs(epsg=3857)
            gdf_rumah = gdf_rumah.to_crs(epsg=3857)

        ## ODC-ODP Line
        set_status(7)
        gdf_odc_odp, gdf_dist_pole, gdf_dist_jc = build_odc_odp_lines(gdf_odp)
        ## ODP-Rumah Line
        set_status(8)
        gdf_odp_rumah = build_odp_rumah_lines(gdf_odp, gdf_rumah)

        gdf_rumah = gdf_rumah.to_crs(epsg=4326)
        gdf_odc = gdf_odc.to_crs(epsg=4326)
        gdf_odp = gdf_odp.to_crs(epsg=4326)
        gdf_odc_odp = gdf_odc_odp.to_crs(epsg=4326)
        gdf_odp_rumah = gdf_odp_rumah.to_crs(epsg=4326)

        set_status(9)
        (
            odc_cluster,
            gdf_parent_line,
            gdf_sub_line,
            gdf_junction_pole,
        ) = plan_ftth_network(
            conn,
            gdf_odc,
            olt_mode=olt_mode,
            tower_ids=tower_ids,
            coordinates=coordinates,
        )
        (
            gdf_parent_line,
            gdf_parent_pole,
            gdf_parent_jc,
            gdf_parent_coil,
            pole_counter,
            jc_counter,
            coil_counter,
        ) = split_feeder(
            gdf_parent_line,
            asset_group,
            feeder_type="parent",
        )

        gdf_sub_line, gdf_sub_pole, gdf_sub_jc, gdf_sub_coil, _, _, _ = split_feeder(
            gdf_sub_line,
            asset_group,
            pole_counter=pole_counter,
            jc_counter=jc_counter,
            coil_counter=coil_counter,
            feeder_type="sub",
        )

        pole_parts = [gdf_parent_pole, gdf_sub_pole, gdf_dist_pole]
        # junction (titik cabang noding sub line) adalah pole baru
        if gdf_junction_pole is not None and not gdf_junction_pole.empty:
            pole_parts.append(gdf_junction_pole)
        gdf_pole = gpd.GeoDataFrame(
            pd.concat(
                pole_parts,
                ignore_index=True,
            ),
            geometry="geometry",
            crs=gdf_parent_pole.crs,
        )

        # persimpangan jalan cukup jadi pole; tidak ada JC junction.
        jc_parts = [gdf_parent_jc, gdf_sub_jc, gdf_dist_jc]
        gdf_jc = gpd.GeoDataFrame(
            pd.concat(
                jc_parts,
                ignore_index=True,
            ),
            geometry="geometry",
            crs=gdf_parent_jc.crs,
        )

        gdf_coil = gpd.GeoDataFrame(
            pd.concat(
                [
                    gdf_parent_coil,
                    gdf_sub_coil,
                ],
                ignore_index=True,
            ),
            geometry="geometry",
            crs=gdf_parent_coil.crs,
        )

        # if gdf_parent_line is not None:
        #     gdf_parent_line["stroke"] = "#3498db"  # biru
        #     gdf_parent_line.to_file("/data/feeder_split.geojson", driver="GeoJSON")
        # if gdf_pole is not None:
        #     gdf_pole["marker-color"] = "#2ecc71"
        #     gdf_pole.to_file("/data/feeder_pole.geojson", driver="GeoJSON")
        # if gdf_jc is not None:
        #     gdf_jc["marker-color"] = "#e10909"
        #     gdf_jc.to_file("/data/feeder_jc.geojson", driver="GeoJSON")
        # if gdf_coil is not None:
        #     gdf_coil["marker-color"] = "#1e90ff"
        #     gdf_coil.to_file("/data/feeder_coil.geojson", driver="GeoJSON")

        # raise Exception("Terjadi kesalahan")

        set_status(10)
        # gdf_jc, gdf_sub_line = split_lines_with_jc(gdf_sub_line, jc_spacing_m=4000)
        # gdf_jcr, gdf_odp_rumah = split_lines_with_jc(
        _, gdf_odp_rumah = split_lines_with_jc(
            gdf_odp_rumah,
            jc_spacing_m=9999999999999999999,
            from_key="odp_id",
            to_key="ogc_fid",
            jc_prefix="R",
        )

        if dev_mode:
            gdf_odc_odp["stroke"] = "#3498db"  # biru
            gdf_odc_odp.to_file("/data/odc_to_odp.geojson", driver="GeoJSON")
            gdf_odp_rumah["stroke"] = "#e74c3c"  # merah
            gdf_odp_rumah.to_file("/data/odp_to_rumah.geojson", driver="GeoJSON")
            gdf_sub_line["stroke"] = "#2ecc71"  # hijau
            gdf_sub_line.to_file("/data/odc_sub_line.geojson", driver="GeoJSON")
            gdf_pole["marker-color"] = "#9b59b6"  # ungu
            gdf_pole.to_file("/data/pole.geojson", driver="GeoJSON")
            # gdf_jc["marker-color"] = "#9b59b6"  # ungu
            # gdf_jcr.to_file("/data/clossure_rumah.geojson", driver="GeoJSON")

            files = [
                ("/data/rumah.geojson", "rumah"),
                ("/data/odp.geojson", "odp"),
                ("/data/odc.geojson", "odc"),
                ("/data/pole.geojson", "pole"),
                # ("/data/clossure_rumah.geojson", "clossure"),
                ("/data/odc_to_odp.geojson", "odc_odp"),
                ("/data/odp_to_rumah.geojson", "odp_rumah"),
                ("/data/odc_sub_line.geojson", "odc_sub_line"),
            ]

            all_features = []
            for path, layer in files:
                with open(path, "r") as f:
                    data = json.load(f)

                features = data.get("features", [])
                for feat in features:
                    feat.setdefault("properties", {})
                    feat["properties"]["layer"] = layer
                    all_features.append(feat)

            geojson_all = {
                "type": "FeatureCollection",
                "features": all_features,
            }

            output_path = "/data/ftth_all_raw.geojson"
            with open(output_path, "w") as f:
                json.dump(geojson_all, f)

            print(f"✔ GeoJSON gabungan tersimpan: {output_path}")
            return None

        gdf_odc["site_point_id"] = None
        gdf_odp["site_point_id"] = None
        gdf_rumah["site_point_id"] = None
        # gdf_jc["site_point_id"] = None
        # gdf_jcr["site_point_id"] = None

        gdf_odc_odp["site_from"] = None
        gdf_odc_odp["site_to"] = None

        seq_conn = pool.getconn()
        seq_conn.autocommit = True

        with conn:
            with conn.cursor() as cur_main, seq_conn.cursor() as cur_seq:
                ## Buat Site Point + Asset OLT BARU (bukan register data eksisting)
                set_status(11)
                # sequence kode site point per project: P<project_id>_<seq>.
                # dipakai berurutan lintas semua insert_site_point_fc di bawah
                # (OLT -> POLE -> ODC -> ODP -> ONT) supaya tidak terputus.
                site_seq = 0
                olt_records = []
                for cluster in odc_cluster:
                    olt_geom = cluster.get("olt_geom")
                    logger.info(
                        f"[Cluster {cluster['cluster_index']}] "
                        f"ODC={cluster['total_odc']} "
                        f"Cable={cluster['cable_type']} "
                        f"OLT_SITE={cluster.get('olt_site_point_id')}"
                    )
                    if olt_geom is None:
                        continue
                    olt_records.append(
                        {
                            # id OLT eksisting hanya dipakai sbg key remap site_from
                            "olt_key": cluster.get("olt_site_point_id"),
                            "cluster_index": cluster.get("cluster_index"),
                            "geometry": olt_geom,
                        }
                    )

                gdf_olt = None
                olt_site_index = pd.Series(dtype="Int64")
                if olt_records:
                    gdf_olt = gpd.GeoDataFrame(
                        olt_records, geometry="geometry", crs="EPSG:4326"
                    )
                    gdf_olt, site_seq = insert_site_point_fc(
                        cur_main,
                        cur_seq,
                        gdf_olt,
                        uploader,
                        project_id,
                        site_point_type_id=5,
                        site_seq=site_seq,
                    )
                    # index: id OLT eksisting -> id site_point OLT baru
                    olt_site_index = gdf_olt.set_index("olt_key")["site_point_id"]
                    # overwrite id OLT di cluster dgn id site_point baru (utk kabel)
                    new_olt_by_cluster = gdf_olt.set_index("cluster_index")[
                        "site_point_id"
                    ]
                    for cluster in odc_cluster:
                        ci = cluster.get("cluster_index")
                        if ci in new_olt_by_cluster.index:
                            cluster["olt_site_point_id"] = int(
                                new_olt_by_cluster.loc[ci]
                            )
                ## Insert Site Point ODC, ODP, POLE (MERGE titik <5m) & ONT(Rumah)
                set_status(12)
                # Gabung site point berdekatan (<=5m) dari alur terpisah (feeder vs
                # distribution). Scope: ODC/ODP/POLE (exclude ONT & OLT). Keeper
                # prioritas ODC>ODP>pole(pembawa JC/coil)>pole biasa; hanya keeper
                # yang di-insert sbg site point, sisanya berbagi site keeper.
                gdf_odp_odc = (
                    gdf_odp[gdf_odp["role"] == "ODP_2"].copy().reset_index(drop=True)
                )
                gdf_odp_main = (
                    gdf_odp[gdf_odp["role"] != "ODP_2"].copy().reset_index(drop=True)
                )

                jc_coil_poles = set(gdf_jc["pole_id"]) | set(gdf_coil["pole_id"])

                # Prioritas keeper (kecil = menang jadi site hasil gabung).
                # Skema "feeder-first": pole feeder jadi acuan posisi supaya
                # geometri feeder (split_feeder) tidak melenceng saat snap.
                #   0 feeder pole + JC/coil (titik sambung/cabang feeder)
                #   1 feeder pole
                #   2 ODC
                #   3 ODP
                #   4 dist pole + JC/coil
                #   5 dist pole
                # Feeder pole dikenali dari prefix pole_id: FEEDER-POLE-* / JX*
                # (junction cabang feeder); selain itu dianggap distribusi.
                def _pole_priority(pid):
                    is_feeder = pid.startswith("FEEDER-POLE") or pid.startswith("JX")
                    has_jc_coil = pid in jc_coil_poles
                    if is_feeder:
                        return 0 if has_jc_coil else 1
                    return 4 if has_jc_coil else 5

                node_records = []
                for _, r in gdf_odc.iterrows():
                    node_records.append(
                        {
                            "kind": "odc",
                            "key": r["odp_id"],
                            "priority": 2,
                            "geometry": r.geometry,
                        }
                    )
                for _, r in gdf_odp_main.iterrows():
                    node_records.append(
                        {
                            "kind": "odp",
                            "key": r["odp_id"],
                            "priority": 3,
                            "geometry": r.geometry,
                        }
                    )
                for _, r in gdf_pole.iterrows():
                    node_records.append(
                        {
                            "kind": "pole",
                            "key": r["pole_id"],
                            "priority": _pole_priority(str(r["pole_id"])),
                            "geometry": r.geometry,
                        }
                    )

                nodes, keepers = build_site_clusters(node_records, tol_m=20.0)
                keepers, site_seq = insert_site_point_fc(
                    cur_main,
                    cur_seq,
                    keepers,
                    uploader,
                    project_id,
                    site_point_type_id=5,
                    site_seq=site_seq,
                )
                cluster_site = keepers.set_index("cluster_id")["site_point_id"]
                nodes["site_point_id"] = nodes["cluster_id"].map(cluster_site)

                # index per-jenis: key -> site_point_id (hasil merge)
                pole_site_index = nodes[nodes["kind"] == "pole"].set_index("key")[
                    "site_point_id"
                ]
                odc_site_index = nodes[nodes["kind"] == "odc"].set_index("key")[
                    "site_point_id"
                ]
                odp_site_index = nodes[nodes["kind"] == "odp"].set_index("key")[
                    "site_point_id"
                ]

                # isi site_point_id ke gdf sumber
                gdf_pole["site_point_id"] = (
                    gdf_pole["pole_id"].map(pole_site_index).astype("Int64")
                )
                gdf_odc["site_point_id"] = (
                    gdf_odc["odp_id"].map(odc_site_index).astype("Int64")
                )
                gdf_odp_main["site_point_id"] = (
                    gdf_odp_main["odp_id"].map(odp_site_index).astype("Int64")
                )
                gdf_odp_odc["site_point_id"] = (
                    gdf_odp_odc["odp_id"].map(odc_site_index).astype("Int64")
                )
                # mapping parent dari ODC
                gdf_odp_main["parent_site_point_id"] = (
                    gdf_odp_main["parent_odc"].map(odc_site_index).astype("Int64")
                )
                gdf_odp = gpd.GeoDataFrame(
                    pd.concat([gdf_odp_main, gdf_odp_odc], ignore_index=True),
                    crs=gdf_odp.crs,
                )

                # Insert Site JC
                # gdf_jc = insert_site_point_fc(
                #     cur_main,
                #     cur_seq,
                #     gdf_jc,
                #     uploader,
                #     project_id,
                #     site_point_type_id=5,
                # )
                # gdf_jcr = insert_site_point_fc(
                #     cur_main,
                #     cur_seq,
                #     gdf_jcr,
                #     uploader,
                #     project_id,
                #     site_point_type_id=5,
                # )

                # Insert Site ONT (Rumah)
                gdf_rumah, site_seq = insert_site_point_fc(
                    cur_main,
                    cur_seq,
                    gdf_rumah,
                    uploader,
                    project_id,
                    site_point_type_id=5,
                    site_seq=site_seq,
                )

                # odc_site_index / odp_site_index / pole_site_index sudah dibangun
                # dari hasil merge site cluster di atas.
                # Indexing Site ONT (Rumah)
                ont_site_index = gdf_rumah.set_index("ogc_fid")["site_point_id"]
                ont_site_index.index = ont_site_index.index.astype(str)
                # Indexing Site Combine (ODC, ODP, JC & ONT)
                site_index = pd.concat(
                    [
                        pole_site_index,
                        odc_site_index,
                        odp_site_index,
                        # jc_site_index,
                        # jcr_site_index,
                        ont_site_index,
                    ]
                )
                # Mappig Asset Feeder
                gdf_pole["site_point_id"] = (
                    gdf_pole["pole_id"].map(pole_site_index).astype("Int64")
                )
                gdf_coil["site_point_id"] = (
                    gdf_coil["pole_id"].map(pole_site_index).astype("Int64")
                )
                gdf_jc["site_point_id"] = (
                    gdf_jc["pole_id"].map(pole_site_index).astype("Int64")
                )

                # mapping parent dari ODP
                gdf_rumah["parent_site_point_id"] = (
                    gdf_rumah["odp_id"].map(site_index).astype("Int64")
                )
                gdf_odp_rumah["site_from"] = (
                    gdf_odp_rumah["odp_id"].map(site_index).astype("Int64")
                )
                gdf_odp_rumah["site_to"] = (
                    gdf_odp_rumah["ogc_fid"].map(site_index).astype("Int64")
                )

                # pastikan kolom endpoint ada (split_feeder hanya buat kolom yg
                # muncul di salah satu segmen) supaya mapping tidak KeyError.
                def ensure_cols(gdf, cols):
                    if gdf is not None:
                        for c in cols:
                            if c not in gdf.columns:
                                gdf[c] = pd.NA
                    return gdf

                ensure_cols(
                    gdf_parent_line,
                    ["site_from", "from_pole", "to_pole", "to_odp"],
                )
                ensure_cols(
                    gdf_odc_odp,
                    ["from_odp", "to_odp", "from_pole", "to_pole"],
                )
                ensure_cols(
                    gdf_sub_line,
                    ["from_pole", "to_pole", "from_odp", "to_odp"],
                )

                # Mapping site to routes
                # segmen OLT: id OLT eksisting -> id site_point OLT baru
                if not olt_site_index.empty:
                    gdf_parent_line["site_from"] = gdf_parent_line["site_from"].map(
                        olt_site_index
                    )
                gdf_parent_line["site_from"] = gdf_parent_line["site_from"].fillna(
                    gdf_parent_line["from_pole"].map(pole_site_index)
                )
                gdf_parent_line["site_to"] = gdf_parent_line["to_pole"].map(
                    pole_site_index
                )

                gdf_parent_line["site_to"] = gdf_parent_line["site_to"].fillna(
                    gdf_parent_line["to_odp"].map(site_index)
                )

                gdf_odc_odp["site_from"] = gdf_odc_odp["from_odp"].map(site_index)
                gdf_odc_odp["site_to"] = gdf_odc_odp["to_odp"].map(site_index)
                gdf_odc_odp["site_from"] = gdf_odc_odp["site_from"].fillna(
                    gdf_odc_odp["from_pole"].map(pole_site_index)
                )
                gdf_odc_odp["site_to"] = gdf_odc_odp["site_to"].fillna(
                    gdf_odc_odp["to_pole"].map(pole_site_index)
                )

                # gdf_odp_rumah["site_from"] = gdf_odp_rumah["odp_id"].map(site_index)
                # gdf_odp_rumah["site_to"] = gdf_odp_rumah["ogc_fid"].map(site_index)

                if gdf_sub_line is not None and not gdf_sub_line.empty:
                    gdf_sub_line["site_from"] = gdf_sub_line["from_pole"].map(
                        pole_site_index
                    )
                    gdf_sub_line["site_to"] = gdf_sub_line["to_pole"].map(
                        pole_site_index
                    )

                    gdf_sub_line["site_from"] = gdf_sub_line["site_from"].fillna(
                        gdf_sub_line["from_odp"].map(site_index)
                    )
                    gdf_sub_line["site_to"] = gdf_sub_line["site_to"].fillna(
                        gdf_sub_line["to_odp"].map(site_index)
                    )

                # Snap vertex ujung route ke titik site keeper (hasil merge) supaya
                # tidak ada gap antara garis route dan marker site point.
                site_geom = {}
                for gdf_site in (keepers, gdf_olt, gdf_rumah):
                    if gdf_site is None or gdf_site.empty:
                        continue
                    site_geom.update(
                        dict(zip(gdf_site["site_point_id"], gdf_site.geometry))
                    )

                # DIAGNOSTIK (baca-saja): deteksi ujung route yang site tujuannya
                # jauh (>5m) dari ujung geometrinya -> menandai mismatch pemetaan
                # site_from/site_to. TIDAK mengubah geometri apa pun; hanya log.
                def _diag_snap(gdf_line, label, id_cols):
                    if gdf_line is None or len(gdf_line) == 0:
                        return

                    def _dm(a, b):
                        dlon = (
                            (b[0] - a[0])
                            * 111320.0
                            * math.cos(math.radians((a[1] + b[1]) / 2.0))
                        )
                        dlat = (b[1] - a[1]) * 110540.0
                        return math.hypot(dlon, dlat)

                    n_bad = 0
                    for _, row in gdf_line.iterrows():
                        geom = row.geometry
                        if geom is None or geom.geom_type != "LineString":
                            continue
                        cc = list(geom.coords)
                        c0, cN = cc[0], cc[-1]
                        sf = row.get("site_from")
                        st = row.get("site_to")
                        fp = site_geom.get(int(sf)) if pd.notna(sf) else None
                        tp = site_geom.get(int(st)) if pd.notna(st) else None
                        # orientasi jarak minimal (sama seperti snap_route_endpoints)
                        if fp is not None and tp is not None:
                            fpt, tpt = (fp.x, fp.y), (tp.x, tp.y)
                            if _dm(c0, fpt) + _dm(cN, tpt) <= _dm(c0, tpt) + _dm(
                                cN, fpt
                            ):
                                pairs = [(c0, fpt, int(sf)), (cN, tpt, int(st))]
                            else:
                                pairs = [(c0, tpt, int(st)), (cN, fpt, int(sf))]
                        elif fp is not None:
                            fpt = (fp.x, fp.y)
                            pairs = (
                                [(c0, fpt, int(sf))]
                                if _dm(c0, fpt) <= _dm(cN, fpt)
                                else [(cN, fpt, int(sf))]
                            )
                        elif tp is not None:
                            tpt = (tp.x, tp.y)
                            pairs = (
                                [(c0, tpt, int(st))]
                                if _dm(c0, tpt) <= _dm(cN, tpt)
                                else [(cN, tpt, int(st))]
                            )
                        else:
                            continue
                        seg_bad = False
                        for orig, target, site_id in pairs:
                            d = _dm(orig, target)
                            if d > 5.0:
                                n_bad += 1
                                seg_bad = True
                                ids = ", ".join(f"{c}={row.get(c)}" for c in id_cols)
                                logger.warning(
                                    f"[diag {label}] mismatch {d:.1f}m: ujung "
                                    f"{orig[0]:.6f},{orig[1]:.6f} -> site {site_id} "
                                    f"@ {target[0]:.6f},{target[1]:.6f} | "
                                    f"site_from={sf} site_to={st} | {ids}"
                                )
                        if seg_bad:
                            fpos = f"{fp.x:.6f},{fp.y:.6f}" if fp is not None else "-"
                            tpos = f"{tp.x:.6f},{tp.y:.6f}" if tp is not None else "-"
                            logger.warning(
                                f"[diag {label} FULL] geom c0={c0[0]:.6f},{c0[1]:.6f} "
                                f"cN={cN[0]:.6f},{cN[1]:.6f} | "
                                f"site_from={sf}@{fpos} site_to={st}@{tpos} | "
                                f"d(c0,from)={_dm(c0,(fp.x,fp.y)):.1f} "
                                f"d(cN,from)={_dm(cN,(fp.x,fp.y)):.1f} "
                                f"d(c0,to)={_dm(c0,(tp.x,tp.y)):.1f} "
                                f"d(cN,to)={_dm(cN,(tp.x,tp.y)):.1f}"
                                if (fp is not None and tp is not None)
                                else (
                                    f"[diag {label} FULL] geom "
                                    f"c0={c0[0]:.6f},{c0[1]:.6f} "
                                    f"cN={cN[0]:.6f},{cN[1]:.6f} | "
                                    f"site_from={sf}@{fpos} site_to={st}@{tpos}"
                                )
                            )
                    logger.info(
                        f"[diag {label}] {n_bad} ujung mismatch (>5m) dari "
                        f"{len(gdf_line)} segmen"
                    )

                _diag_snap(
                    gdf_parent_line,
                    "parent",
                    ["from_pole", "to_pole", "from_odp", "to_odp"],
                )
                _diag_snap(
                    gdf_sub_line,
                    "sub",
                    ["from_pole", "to_pole", "from_odp", "to_odp"],
                )
                _diag_snap(
                    gdf_odc_odp,
                    "odc_odp",
                    ["from_odp", "to_odp", "from_pole", "to_pole"],
                )
                _diag_snap(
                    gdf_odp_rumah,
                    "odp_rumah",
                    ["odp_id", "ogc_fid"],
                )

                gdf_parent_line = snap_route_endpoints(
                    gdf_parent_line, site_geom, label="parent"
                )
                gdf_sub_line = snap_route_endpoints(
                    gdf_sub_line, site_geom, label="sub"
                )
                gdf_odc_odp = snap_route_endpoints(
                    gdf_odc_odp, site_geom, label="odc_odp"
                )
                gdf_odp_rumah = snap_route_endpoints(
                    gdf_odp_rumah, site_geom, label="odp_rumah"
                )

                ## ORDER Sequence
                # sequence ODC per project run, mulai dari 1 (tidak lagi
                # mengambil nomor global dari odc_contractor_sequence).
                odc_seq = 1

                ## INSERT Asset
                set_status(13)
                asset_rows = []
                # INSERT Asset OLT (baru, asset_type_id=4, asset_group None)
                olt_seq = 1
                if gdf_olt is not None:
                    for _, row in gdf_olt.iterrows():
                        code = f"OLT{olt_seq:03d}"
                        olt_seq += 1
                        asset_rows.append(
                            (
                                row.site_point_id,
                                code,
                                code,
                                4,  # asset_type_id OLT
                                None,  # asset_group_id
                                uploader,
                            )
                        )
                # Jenis pole tidak lagi dari kelas jalan: disebar acak dengan
                # komposisi 80% T6 / 20% T7. Pole yang dipasangi JC -> T9.
                # seed dari project_id supaya hasil sebaran reproducible
                # (re-run project yang sama -> jenis pole yang sama).
                rng = np.random.default_rng(project_id)

                def assign_pole_types(n):
                    n_t7 = int(round(n * pole_t7_ratio))
                    types = np.array(
                        [asset_group["pole_7"]] * n_t7
                        + [asset_group["pole_6"]] * (n - n_t7),
                        dtype=object,
                    )
                    rng.shuffle(types)
                    return types

                # ODC bercabang = muncul sebagai induk (from_odp) di MST dgn
                # >=2 anak. ODC dgn 1 anak hanya pass-through -> TIDAK dibuat JC.
                def _branch_odps(cluster):
                    cnt = {}
                    for frm, _ in cluster.get("mst_edges", []):
                        cnt[frm] = cnt.get(frm, 0) + 1
                    return {frm for frm, c in cnt.items() if c >= 2}

                # site yang punya JC -> pole di site itu jenisnya T9.
                # (feeder JC via pole + JC percabangan ODC via site ODC)
                jc_sites = set()
                if len(gdf_jc):
                    jc_sites |= set(gdf_jc["site_point_id"].dropna().astype(int))
                for cluster in odc_cluster:
                    for frm in _branch_odps(cluster):
                        if frm in odc_site_index.index:
                            jc_sites.add(int(odc_site_index.loc[frm]))

                # INSERT Asset FEEDER POLE (nama = jenis tiang saja).
                # POLE hanya 1 per site point hasil merge (site yang sudah punya
                # pole di-skip, baik dari feeder pole maupun ODP pole di bawah).
                sites_with_pole = set()
                gdf_pole["pole_type"] = assign_pole_types(len(gdf_pole))
                gdf_pole.loc[gdf_pole["site_point_id"].isin(jc_sites), "pole_type"] = (
                    asset_group["pole_9"]
                )
                gdf_pole["code"] = None
                for index, row in gdf_pole.iterrows():
                    if pd.isna(row.site_point_id):
                        continue
                    sp = int(row.site_point_id)
                    if sp in sites_with_pole:
                        continue
                    sites_with_pole.add(sp)
                    code = row.pole_type
                    asset_rows.append(
                        (
                            row.site_point_id,
                            code,
                            code,
                            22,  # asset_type_id POLE
                            row.pole_type,
                            uploader,
                        )
                    )
                # INSERT Asset FEEDER COIL
                coil_seq = 1
                gdf_coil["code"] = None
                for index, row in gdf_coil.iterrows():
                    code = f"COIL{coil_seq:03d}"
                    coil_seq += 1
                    asset_rows.append(
                        (
                            row.site_point_id,
                            code,
                            code,
                            47,  # asset_type_id COIL
                            None,
                            uploader,
                        )
                    )
                # INSERT Asset FEEDER JC
                # sequence JC berlanjut sampai JC percabangan ODC di bawah
                jc_seq = 1
                gdf_jc["code"] = None
                for index, row in gdf_jc.iterrows():
                    code = f"JC{jc_seq:03d}"
                    jc_seq += 1
                    asset_rows.append(
                        (
                            row.site_point_id,
                            code,
                            code,
                            24,  # asset_type_id JC
                            row.jc_type,
                            uploader,
                        )
                    )

                # INSERT Asset ODC
                gdf_odc["code"] = None
                for index, row in gdf_odc.iterrows():
                    code = f"ODC{odc_seq:03d}"
                    odc_seq = odc_seq + 1

                    asset_rows.append(
                        (
                            row.site_point_id,
                            code,
                            code,
                            3,  # asset_type_id ODC
                            asset_group["odc"],  # asset_group_id
                            uploader,
                        )
                    )
                    gdf_odc.at[index, "code"] = code
                odc_code_index = gdf_odc.set_index("odp_id")["code"]

                # INSERT Asset JC PERCABANGAN ODC (feeder/sub).
                # JC hanya dibuat di ODC yang BERCABANG (>=2 anak di MST). ODC
                # dgn 1 anak (pass-through) maupun leaf tidak dapat JC.
                # Co-located dgn site point ODC.
                JC_MAP = {
                    "feeder_cable_24": "jc_24",
                    "feeder_cable_48": "jc_48",
                    "feeder_cable_96": "jc_96",
                    "feeder_cable_144": "jc_144",
                    "feeder_cable_288": "jc_288",
                }
                for cluster in odc_cluster:
                    cable_type = cluster.get("cable_type")
                    jc_spec = asset_group[JC_MAP.get(cable_type, "jc_24")]
                    branch_odps = _branch_odps(cluster)
                    for odp_id in branch_odps:
                        if odp_id not in odc_site_index.index:
                            continue
                        odc_sp = int(odc_site_index.loc[odp_id])
                        code = f"JC{jc_seq:03d}"
                        jc_seq += 1
                        asset_rows.append(
                            (
                                odc_sp,
                                code,
                                code,
                                24,  # asset_type_id JC
                                jc_spec,  # jc_type per ukuran cable feeder cluster
                                uploader,
                            )
                        )

                # Insert Asset ODP
                parent_map = gdf_odp.set_index("odp_id")["parent_odp"].to_dict()

                def resolve_odc_code(odp_id):
                    cur = odp_id
                    for _ in range(10):  # biar aman dari infinite loop
                        if cur in odc_code_index and odc_code_index[cur] is not None:
                            return odc_code_index[cur]
                        cur = parent_map.get(cur)
                        if cur is None or (isinstance(cur, float) and np.isnan(cur)):
                            return None
                    return None

                gdf_odp["odc_code"] = gdf_odp["odp_id"].apply(resolve_odc_code)
                odp_role_map = {
                    "ODP_1": "ODP001",
                    "ODP_2": "ODP002",
                    "ODP_3": "ODP003",
                    "ODP_4": "ODP004",
                }
                gdf_odp["odp_level"] = gdf_odp["role"].map(odp_role_map)
                # pole ODP ikut komposisi acak 80/20; site yang punya JC (ODC
                # bercabang) polenya T9.
                gdf_odp["pole_type"] = assign_pole_types(len(gdf_odp))
                gdf_odp.loc[gdf_odp["site_point_id"].isin(jc_sites), "pole_type"] = (
                    asset_group["pole_9"]
                )
                gdf_odp["code"] = None
                for index, row in gdf_odp.iterrows():
                    odc_code = row.odc_code
                    odp_code = row.odp_level
                    code = f"{odc_code}.{odp_code}"
                    pole_type = row.pole_type
                    # pole ODP: nama = jenis tiang saja
                    pole_code = pole_type

                    asset_rows.append(
                        (
                            row.site_point_id,
                            code,
                            code,
                            2,  # asset_type_id ODP
                            asset_group["odp"],  # asset_group_id
                            uploader,
                        )
                    )
                    # POLE hanya 1 per site point (skip bila site sudah punya pole,
                    # mis. ODP yang merge dgn feeder pole).
                    if not pd.isna(row.site_point_id):
                        sp = int(row.site_point_id)
                        if sp not in sites_with_pole:
                            sites_with_pole.add(sp)
                            asset_rows.append(
                                (
                                    row.site_point_id,
                                    pole_code,
                                    pole_code,
                                    22,  # asset_type_id POLE
                                    pole_type,  # asset_group_id
                                    uploader,
                                )
                            )
                    gdf_odp.at[index, "code"] = code
                odp_code_index = gdf_odp.set_index("odp_id")["code"]

                # INSERT Asset JC
                # jc0_code = f"P{project_id}_JC0"
                # asset_rows.append(
                #     (
                #         odc_center_site_point_id,
                #         jc0_code,
                #         jc0_code,
                #         24,  # asset_type_id JC
                #         asset_group["jc"],  # asset_group_id
                #         uploader,
                #     )
                # )
                # gdf_jc["code"] = None
                # for index, row in gdf_jc.iterrows():
                #     code = f"P{project_id}_{row.jc_id}"
                #     pole_code = f"{code}_POLE"

                #     asset_rows.append(
                #         (
                #             row.site_point_id,
                #             code,
                #             code,
                #             24,  # asset_type_id JC
                #             asset_group["jc"],  # asset_group_id
                #             uploader,
                #         )
                #     )
                #     asset_rows.append(
                #         (
                #             row.site_point_id,
                #             pole_code,
                #             pole_code,
                #             22,  # asset_type_id POLE
                #             "T9",  # asset_group_id
                #             uploader,
                #         )
                #     )

                # gdf_jcr["code"] = None
                # for index, row in gdf_jcr.iterrows():
                #     code = f"P{project_id}_{row.jc_id}"

                #     asset_rows.append(
                #         (
                #             row.site_point_id,
                #             code,
                #             code,
                #             24,  # asset_type_id JC
                #             asset_group["jc"],  # asset_group_id
                #             uploader,
                #         )
                #     )

                # Insert Asset ONT
                gdf_rumah["odp_code"] = gdf_rumah["odp_id"].map(odp_code_index)

                # Pisahkan rumah tanpa ODP (odp_id None / di luar max_dist).
                mask_no_odp = gdf_rumah["odp_id"].isna()
                gdf_rumah_ont = gdf_rumah[~mask_no_odp].copy()
                gdf_rumah_no_odp = gdf_rumah[mask_no_odp].copy()

                # ONT tertugas ke ODP -> asset_type_id 1, asset_group ONT
                # nama ONT mengikuti ODP induknya, nomor urut per ODP
                gdf_rumah_ont["ont_no"] = (
                    gdf_rumah_ont.groupby("odp_code").cumcount() + 1
                )
                gdf_rumah_ont["code"] = (
                    gdf_rumah_ont["odp_code"].astype(str)
                    + "_ONT"
                    + gdf_rumah_ont["ont_no"].map("{:03d}".format)
                )
                for index, row in gdf_rumah_ont.iterrows():
                    code = row.code
                    asset_rows.append(
                        (
                            row.site_point_id,
                            code,
                            code,
                            1,  # asset_type_id ONT
                            asset_group["ont"],  # asset_group_id
                            uploader,
                        )
                    )

                # ONT tanpa ODP (di luar jangkauan) -> asset_type_id 48, group None
                # tanpa ODP induk -> pakai sequence sendiri
                gdf_rumah_no_odp["code"] = [
                    f"ONT{i:03d}" for i in range(1, len(gdf_rumah_no_odp) + 1)
                ]
                for index, row in gdf_rumah_no_odp.iterrows():
                    code = row.code
                    asset_rows.append(
                        (
                            row.site_point_id,
                            code,
                            code,
                            48,  # asset_type_id ONT tanpa ODP
                            None,  # asset_group_id
                            uploader,
                        )
                    )

                insert_asset_fc_bulk(cur_main, uploader, project_id, asset_rows)

                # Insert Route
                set_status(14)
                # nama/kode route pakai kode site point (P<project_id>_<seq>),
                # bukan id site point.
                # site_code hanya ada pada site yang benar-benar di-insert:
                # keeper (hasil merge ODC/ODP/pole), OLT, dan ONT.
                site_code_by_id = {}
                for gdf_site in (keepers, gdf_olt, gdf_rumah):
                    if gdf_site is None or gdf_site.empty:
                        continue
                    site_code_by_id.update(
                        dict(zip(gdf_site["site_point_id"], gdf_site["site_code"]))
                    )

                def site_code_of(site_id):
                    return site_code_by_id.get(
                        int(site_id), f"P{project_id}_{int(site_id)}"
                    )

                route_rows = []
                if gdf_parent_line is not None and not gdf_parent_line.empty:
                    for _, row in gdf_parent_line.iterrows():
                        site_from = row.site_from
                        site_to = row.site_to

                        if (
                            pd.isna(site_from)
                            or pd.isna(site_to)
                            or int(site_from) == int(site_to)
                        ):
                            continue

                        name = f"{site_code_of(site_from)}-{site_code_of(site_to)}"
                        code = name
                        route_type_id = row.route_type_id

                        route_rows.append(
                            (
                                int(site_from),
                                int(site_to),
                                name,
                                code,
                                route_type_id,
                                row.geometry.wkb,  # ST_GeomFromText
                                row.length_m,
                                uploader,
                            )
                        )
                if gdf_sub_line is not None and not gdf_sub_line.empty:
                    for _, row in gdf_sub_line.iterrows():
                        site_from = row.site_from
                        site_to = row.site_to

                        if (
                            pd.isna(site_from)
                            or pd.isna(site_to)
                            or int(site_from) == int(site_to)
                        ):
                            continue

                        name = f"{site_code_of(site_from)}-{site_code_of(site_to)}"
                        code = name
                        route_type_id = row.route_type_id

                        route_rows.append(
                            (
                                int(site_from),
                                int(site_to),
                                name,
                                code,
                                route_type_id,
                                row.geometry.wkb,  # ST_GeomFromText
                                row.length_m,
                                uploader,
                            )
                        )
                for _, row in gdf_odc_odp.iterrows():
                    site_from = row.site_from
                    site_to = row.site_to

                    if (
                        pd.isna(site_from)
                        or pd.isna(site_to)
                        or int(site_from) == int(site_to)
                    ):
                        continue

                    name = f"{site_code_of(site_from)}-{site_code_of(site_to)}"
                    code = name
                    route_type_id = row.route_type_id

                    route_rows.append(
                        (
                            int(site_from),
                            int(site_to),
                            name,
                            code,
                            route_type_id,
                            row.geometry.wkb,  # ST_GeomFromText
                            row.length_m,
                            uploader,
                        )
                    )
                for _, row in gdf_odp_rumah.iterrows():
                    site_from = row.site_from
                    site_to = row.site_to

                    if (
                        pd.isna(site_from)
                        or pd.isna(site_to)
                        or int(site_from) == int(site_to)
                    ):
                        continue

                    name = f"{site_code_of(site_from)}-{site_code_of(site_to)}"
                    code = name
                    route_type_id = row.route_type_id

                    route_rows.append(
                        (
                            int(site_from),
                            int(site_to),
                            name,
                            code,
                            route_type_id,
                            row.geometry.wkb,  # ST_GeomFromText
                            row.length_m,
                            uploader,
                        )
                    )

                # ringkasan tiap tahap; ikut dikembalikan sbg hasil task
                # supaya bisa diperiksa tanpa membaca log worker.
                stats = {}

                route_records = insert_route_fc_bulk(
                    cur_main, uploader, project_id, route_rows
                )
                stats["route"] = {
                    "inserted": len(route_records),
                    "expected": len(route_rows),
                }
                logger.info(
                    f"Route inserted: {len(route_records)} dari "
                    f"{len(route_rows)} baris"
                )

                # Graph route in-memory menggantikan pgr_KSP. Semua edge
                # sudah ada di route_records, jadi pencarian jalur kabel
                # tidak perlu round trip ke database sama sekali.
                route_graph = RouteGraph.from_route_records(route_records)
                stats["graph"] = {
                    "node": len(route_graph),
                    "edge": len(route_records),
                }
                logger.info(
                    f"Route graph: {len(route_graph)} node, "
                    f"{len(route_records)} edge"
                )
                # lookup langsung dua arah untuk pasangan yang tersambung
                # oleh tepat satu route (mayoritas ODC-ODP & ODP-ONT).
                route_map = {}
                for rid, r_from, r_to, r_len in route_records:
                    entry = {"route_id": rid, "length_m": r_len}
                    route_map.setdefault((r_from, r_to), entry)
                    route_map.setdefault((r_to, r_from), entry)

                # Resolusi jalur kabel lewat RouteGraph. Permintaan
                # dikelompokkan per site sumber supaya satu kali Dijkstra
                # melayani semua tujuan dari sumber yang sama.
                def resolve_paths(pairs, max_dist=None):
                    """pairs: iterable (site_from, site_to).

                    Return dict (site_from, site_to) -> (route_ids, length_m).
                    """
                    by_source = {}
                    for s_from, s_to in pairs:
                        by_source.setdefault(s_from, set()).add(s_to)
                    resolved = {}
                    for s_from, targets in by_source.items():
                        found = route_graph.shortest_paths(
                            s_from, targets, max_dist=max_dist
                        )
                        for s_to, path in found.items():
                            resolved[(s_from, s_to)] = path
                    return resolved

                ## Insert Cable
                set_status(15)
                cable_rows = []

                # Cable OLT-ODC center + cable feeder antar ODC mengikuti MST
                # (parent_odc -> child_odc), bukan star dari center ke semua ODC.
                feeder_requests = []  # (site_from, site_to, cable_spec)
                for cluster in odc_cluster:
                    cable_type = cluster.get("cable_type")
                    cable_spec = asset_group[cable_type]
                    olt_site_point_id = cluster.get("olt_site_point_id")
                    odc_center_odp_id = cluster.get("odc_center_odp_id")
                    odc_center_site_point_id = int(
                        odc_site_index.loc[odc_center_odp_id]
                    )

                    if olt_site_point_id is not None:
                        feeder_requests.append(
                            (
                                int(olt_site_point_id),
                                odc_center_site_point_id,
                                cable_spec,
                            )
                        )

                    for from_odp, to_odp in cluster.get("mst_edges", []):
                        feeder_requests.append(
                            (
                                int(odc_site_index.loc[from_odp]),
                                int(odc_site_index.loc[to_odp]),
                                cable_spec,
                            )
                        )

                # dua ODC/OLT yang tergabung jadi satu site point -> skip
                feeder_requests = [
                    req for req in feeder_requests if req[0] != req[1]
                ]
                feeder_paths = resolve_paths(
                    (req[0], req[1]) for req in feeder_requests
                )
                n_feeder_unreachable = 0
                for site_from, site_to, cable_spec in feeder_requests:
                    path = feeder_paths.get((site_from, site_to))
                    if path is None:
                        n_feeder_unreachable += 1
                        logger.warning(
                            f"Cable feeder tidak terhubung di graph route: "
                            f"{site_code_of(site_from)} -> "
                            f"{site_code_of(site_to)} "
                            f"(site {site_from} -> {site_to})"
                        )
                        continue
                    route_ids, length_m = path
                    cable_code = f"{site_code_of(site_from)}-{site_code_of(site_to)}"
                    cable_rows.append(
                        {
                            "site_from": site_from,
                            "site_to": site_to,
                            "code": cable_code,
                            "name": cable_code,
                            "cable_type_id": 3,
                            "cable_group_id": cable_spec,
                            "length_m": length_m,
                            "route_ids": route_ids,
                        }
                    )
                stats["cable_feeder"] = {
                    "pair": len(feeder_requests),
                    "failed": n_feeder_unreachable,
                }
                logger.info(
                    f"Cable feeder: {len(feeder_requests)} pasangan, "
                    f"{n_feeder_unreachable} gagal"
                )

                # Kabel akses (ODC-ODP & ODP-ONT) mayoritas tersambung oleh
                # tepat satu route -> cukup lookup route_map. Sisanya (mis.
                # ODC-ODP yang terpecah jadi rantai lewat DIST-POLE) baru
                # ditelusuri di graph, dibatasi radius supaya Dijkstra-nya
                # berhenti cepat.
                access_max_dist_m = 2000

                def collect_pairs(gdf, from_col, to_col):
                    pairs = []
                    for _, row in gdf.iterrows():
                        s_from = row[from_col]
                        s_to = row[to_col]
                        if pd.isna(s_from) or pd.isna(s_to):
                            continue
                        s_from = int(s_from)
                        s_to = int(s_to)
                        # ODP yang tergabung dgn ODC induknya -> skip
                        if s_from == s_to:
                            continue
                        pairs.append((s_from, s_to))
                    return pairs

                # Cable ODC - ODP ## todo untuk cable ke odp ke 4 masih dari odp 1/3 belum dari odp2
                set_status(16)
                dist_pairs = collect_pairs(
                    gdf_odp_main, "parent_site_point_id", "site_point_id"
                )
                dist_missing = {p for p in dist_pairs if p not in route_map}
                dist_paths = resolve_paths(
                    dist_missing, max_dist=access_max_dist_m
                )
                n_dist_unresolved = 0
                for site_from, site_to in dist_pairs:
                    route_data = route_map.get((site_from, site_to))
                    if route_data:
                        route_ids = [route_data["route_id"]]
                        length_m = route_data["length_m"]
                    else:
                        path = dist_paths.get((site_from, site_to))
                        if path is None:
                            n_dist_unresolved += 1
                            logger.warning(
                                f"Cable ODC-ODP tidak terhubung di graph "
                                f"route: {site_code_of(site_from)} -> "
                                f"{site_code_of(site_to)} "
                                f"(site {site_from} -> {site_to})"
                            )
                            continue
                        route_ids, length_m = path

                    if length_m <= 45:
                        d_cable_spec = asset_group["dist_cable_50"]
                    elif length_m <= 95:
                        d_cable_spec = asset_group["dist_cable_100"]
                    elif length_m <= 145:
                        d_cable_spec = asset_group["dist_cable_150"]
                    else:
                        d_cable_spec = asset_group["dist_cable_150"]  # fallback

                    cable_code = f"{site_code_of(site_from)}-{site_code_of(site_to)}"
                    cable_rows.append(
                        {
                            "site_from": site_from,
                            "site_to": site_to,
                            "code": cable_code,
                            "name": cable_code,
                            "cable_type_id": 4,
                            "cable_group_id": d_cable_spec,
                            "length_m": length_m,
                            "route_ids": route_ids,
                        }
                    )

                stats["cable_odc_odp"] = {
                    "pair": len(dist_pairs),
                    "graph_lookup": len(dist_missing),
                    "failed": n_dist_unresolved,
                }
                logger.info(
                    f"Cable ODC-ODP: {len(dist_pairs)} pasangan, "
                    f"{len(dist_missing)} perlu telusur graph, "
                    f"{n_dist_unresolved} gagal"
                )

                # Cable ODP - ONT
                set_status(17)
                drop_pairs = collect_pairs(gdf_odp_rumah, "site_from", "site_to")
                drop_missing = {p for p in drop_pairs if p not in route_map}
                drop_paths = resolve_paths(
                    drop_missing, max_dist=access_max_dist_m
                )
                n_drop_unresolved = 0
                for site_from, site_to in drop_pairs:
                    route_data = route_map.get((site_from, site_to))
                    if route_data:
                        route_ids = [route_data["route_id"]]
                        length_m = route_data["length_m"]
                    else:
                        path = drop_paths.get((site_from, site_to))
                        if path is None:
                            n_drop_unresolved += 1
                            logger.warning(
                                f"Cable ODP-ONT tidak terhubung di graph "
                                f"route: {site_code_of(site_from)} -> "
                                f"{site_code_of(site_to)} "
                                f"(site {site_from} -> {site_to})"
                            )
                            continue
                        route_ids, length_m = path

                    if length_m <= 45:
                        d_cable_spec = asset_group["drop_cable_50"]
                    elif length_m <= 95:
                        d_cable_spec = asset_group["drop_cable_100"]
                    elif length_m <= 145:
                        d_cable_spec = asset_group["drop_cable_150"]
                    else:
                        d_cable_spec = asset_group[
                            "drop_cable_150"
                        ]  # fallback ## todo create jc

                    cable_code = f"{site_code_of(site_from)}-{site_code_of(site_to)}"
                    cable_rows.append(
                        {
                            "site_from": site_from,
                            "site_to": site_to,
                            "code": cable_code,
                            "name": cable_code,
                            "cable_type_id": 5,
                            "cable_group_id": d_cable_spec,
                            "length_m": length_m,
                            "route_ids": route_ids,
                        }
                    )

                stats["cable_odp_ont"] = {
                    "pair": len(drop_pairs),
                    "graph_lookup": len(drop_missing),
                    "failed": n_drop_unresolved,
                }
                logger.info(
                    f"Cable ODP-ONT: {len(drop_pairs)} pasangan, "
                    f"{len(drop_missing)} perlu telusur graph, "
                    f"{n_drop_unresolved} gagal"
                )

                stats["cable_rows"] = len(cable_rows)
                logger.info(f"Cable rows: {len(cable_rows)}")
                insert_cable_fc_bulk(
                    cur_main,
                    uploader,
                    project_id,
                    cable_rows,
                )

                # Cleanup route kosong: pencarian jalur kabel bisa memilih
                # jalur lebih pendek lewat route lain, sehingga sebagian route
                # tak pernah dirujuk cable_routes. Route tanpa cable tampil
                # menggantung di peta -> hapus. Urutan: project_routes
                # (child FK) dulu, baru routes.
                cur_main.execute(
                    """
                    SELECT pr.route_id
                    FROM project_routes pr
                    WHERE pr.project_id = %s
                      AND NOT EXISTS (
                        SELECT 1 FROM cable_routes cr
                        WHERE cr.route_id = pr.route_id
                      )
                    """,
                    [project_id],
                )
                orphan_route_ids = [r[0] for r in cur_main.fetchall()]
                stats["orphan_route_deleted"] = len(orphan_route_ids)
                if orphan_route_ids:
                    cur_main.execute(
                        "DELETE FROM project_routes "
                        "WHERE project_id = %s AND route_id = ANY(%s)",
                        [project_id, orphan_route_ids],
                    )
                    cur_main.execute(
                        "DELETE FROM routes WHERE id = ANY(%s)",
                        [orphan_route_ids],
                    )
                    logger.info(
                        f"Cleanup route kosong: hapus {len(orphan_route_ids)} "
                        f"route tak dipakai cable (project {project_id})"
                    )
                else:
                    logger.info("Cleanup route kosong: tidak ada route menggantung")

                update_ftth_status(cur_main, project_id, True)

        clear_directus_cache()
        logger.info("success")
        return {
            "success": True,
            "total_home": len(gdf_rumah),
            "total_odp": len(gdf_odp),
            "total_odc": len(gdf_odc),
            "stats": stats,
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
        if seq_conn:
            pool.putconn(seq_conn)
