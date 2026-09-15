import os
import time
import pandas as pd
import math
import random
import numpy as np
import json
import urllib.parse
import urllib.request
import urllib.error
from sklearn.cluster import KMeans
from scipy.spatial import cKDTree
import flexpolyline as fp


import geopandas as gpd
from shapely import wkb, wkt, set_precision
from shapely.geometry import LineString, Point, MultiLineString, mapping, shape
from shapely.ops import substring, unary_union, linemerge

import osmnx as ox

from ortools.sat.python import cp_model
from openrouteservice import client, exceptions as ors_exceptions

from utils import logger


def get_gdf_road(
    conn, project_id: int, buffer_area_m: int = 50, road_mode: str = "osm"
):
    if road_mode not in ("osm", "local"):
        raise ValueError(f"road_mode tidak valid: {road_mode}")

    logger.info("Get project area")
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT ST_Transform(ST_Buffer(ST_Transform(geom, 3857), %s),4326) AS geom_buffer
            FROM project_map
            WHERE id = %s;
            """,
            [buffer_area_m, project_id],
        )
        geom_project_wkb = cur.fetchone()[0]

    project_polygon = wkb.loads(geom_project_wkb)
    gdf_project = gpd.GeoDataFrame(
        {"id": [project_id]},
        geometry=[project_polygon],
        crs="EPSG:4326",
    )

    if road_mode == "local":
        area_polygon = gdf_project.geometry.iloc[0]
        return _get_gdf_road_api(area_polygon), gdf_project

    area_polygon = gdf_project.geometry.iloc[0]
    G = ox.graph_from_polygon(area_polygon, network_type="drive", simplify=True)
    gdf_road = ox.graph_to_gdfs(G, nodes=False, edges=True)

    # VALID_HIGHWAY = [
    #     "primary",
    #     "secondary",
    #     "tertiary",
    #     "residential",
    #     "unclassified",
    #     "service",
    # ]
    # gdf_road = gdf_road[gdf_road["highway"].isin(VALID_HIGHWAY)]
    def normalize_osmid(osmid):
        if isinstance(osmid, list):
            return tuple(sorted(osmid))
        return str(osmid)

    gdf_road["osmid_norm"] = gdf_road["osmid"].apply(normalize_osmid)
    gdf_road = gdf_road.drop_duplicates(subset="osmid_norm")

    return gdf_road, gdf_project


def _get_gdf_road_api(area_polygon):
    """
    Ambil ruas jalan dari API eksternal idtek (streetgeo) yang intersect dengan
    area project (polygon sudah di-buffer di get_gdf_road). Jalan tol
    (class_func = '1') di-exclude via param exclude_class_func.
    Kontrak API: tasks/ftth_process/road_data_api.md
    """
    api_url = os.environ.get("ROAD_API_URL")
    api_key = os.environ.get("ROAD_API_KEY")
    if not api_url or not api_key:
        raise ValueError("ROAD_API_URL / ROAD_API_KEY belum diset")

    logger.info("Get road data from idtek API")
    payload = {
        "area": mapping(area_polygon),
        "exclude_class_func": ["1"],
        "srid": 4326,
    }
    req = urllib.request.Request(
        api_url,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
            # WAF idtek memblokir UA default urllib (Python-urllib -> 403),
            # jadi kirim UA browser-like agar lolos.
            "User-Agent": "Mozilla/5.0",
        },
        method="POST",
    )

    # retry sederhana menghormati Retry-After saat rate limit (429)
    result = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as response:
                result = json.loads(response.read().decode("utf-8"))
            break
        except urllib.error.HTTPError as err:
            if err.code == 429 and attempt < 2:
                retry_after = int(err.headers.get("Retry-After", "5"))
                logger.warning(f"Road API 429, retry in {retry_after}s")
                time.sleep(retry_after)
                continue
            raise

    features = result.get("features", []) if result else []
    if not features:
        raise ValueError("No road found")

    road_records = []
    for feat in features:
        geometry = shape(feat["geometry"])
        # multi sebenarnya satu garis yang tersimpan sebagai multi -> normalisasi
        if isinstance(geometry, MultiLineString):
            merged = linemerge(geometry)
            if not merged.is_empty:
                geometry = merged
        props = feat.get("properties", {})
        road_records.append(
            {
                "ogc_fid": props.get("ogc_fid"),
                "class_func": props.get("class_func"),
                "geometry": geometry,
            }
        )

    gdf_road = gpd.GeoDataFrame(road_records, geometry="geometry", crs="EPSG:4326")
    logger.info(f"Total road (idtek API): {len(gdf_road)}")
    return gdf_road


def get_gdf_rumah(conn, project_id):
    logger.info("Get footprint data")
    rumah_records = []
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT f.ogc_fid, ST_AsBinary(ST_PointOnSurface(f.geom)) AS geom
            FROM project_map p
            INNER JOIN sp_data_footprint f ON ST_Intersects(p.geom, f.geom)
            WHERE p.id=%s;
            """,
            [project_id],
        )
        rows = cur.fetchall()

        if not rows:
            raise ValueError(f"No footprint found")

        for ogc_fid, geom in rows:
            geometry = wkb.loads(bytes(geom))
            rumah_records.append({"ogc_fid": ogc_fid, "geometry": geometry})

    gdf_rumah = gpd.GeoDataFrame(rumah_records, geometry="geometry", crs="EPSG:4326")
    logger.info(f"Total rumah: {len(gdf_rumah)}")
    return gdf_rumah


def build_site_clusters(node_records, tol_m=5.0):
    """
    Gabung node (site point kandidat) yang berdekatan menjadi satu cluster,
    supaya site point dari alur terpisah (feeder vs distribution) tidak menumpuk.

    ALGORITMA: leader clustering (bukan union-find transitif). Keeper dipilih
    berurutan: prioritas terkecil (ODC>ODP>pole pembawa JC/coil>pole) -> coverage
    terbanyak (paling sentral) -> key. Tiap keeper menyerap node yang belum
    ter-assign dan berjarak <= tol_m DARI KEEPER (bukan berantai). Ini menjamin
    tiap node berada <= tol_m dari keeper-nya, jadi tidak ada endpoint yang
    "loncat" ke site yang jauh.

    node_records: list dict {kind, key, priority, geometry(EPSG:4326)}.

    Return:
        nodes: DataFrame [kind, key, priority, geometry, cluster_id]
        keepers: GeoDataFrame [cluster_id, geometry] (EPSG:4326), 1 baris/cluster.
            cluster_id = index node keeper.
    """
    df = pd.DataFrame(node_records)
    if df.empty:
        keepers = gpd.GeoDataFrame(
            {"cluster_id": pd.Series(dtype="int64")},
            geometry=gpd.GeoSeries([], crs="EPSG:4326"),
            crs="EPSG:4326",
        )
        return df, keepers

    df = df.reset_index(drop=True)
    geom_3857 = gpd.GeoSeries(df["geometry"].tolist(), crs="EPSG:4326").to_crs(3857)
    coords = np.array([(g.x, g.y) for g in geom_3857])
    n = len(df)

    kinds = df["kind"].to_numpy()
    keys = df["key"].astype(str).to_numpy()
    prio = df["priority"].to_numpy()

    # tetangga <= tol_m per node (termasuk diri sendiri)
    tree = cKDTree(coords)
    neighbors = tree.query_ball_point(coords, r=tol_m)
    coverage = np.array([len(neighbors[i]) for i in range(n)])

    # urutan pemilihan keeper: prioritas asc, coverage desc, key asc
    order = sorted(range(n), key=lambda i: (prio[i], -coverage[i], keys[i]))

    assigned = np.full(n, -1, dtype=int)  # cluster_id (=index keeper), -1 = belum
    for i in order:
        if assigned[i] != -1:
            continue
        # i jadi keeper cluster baru; serap tetangga <= tol_m yang belum ter-assign
        assigned[i] = i
        absorbed = []
        for j in neighbors[i]:
            if assigned[j] == -1:
                assigned[j] = i
                if j != i:
                    absorbed.append(j)
        # LOG alur merge: hanya cluster yang benar-benar menggabung (>1 titik).
        # koordinat lon,lat (EPSG:4326) supaya gampang dicari di peta.
        if absorbed:

            def lonlat(idx):
                g = df["geometry"].iloc[idx]
                return f"{g.y:.6f},{g.x:.6f}"

            kp = f"{kinds[i]}:{keys[i]}@{lonlat(i)}"
            parts = []
            for j in absorbed:
                d = float(np.hypot(*(coords[j] - coords[i])))
                parts.append(f"{kinds[j]}:{keys[j]}({d:.1f}m)@{lonlat(j)}")
            logger.info(f"[merge] keeper {kp} <- " + ", ".join(parts))

    df["cluster_id"] = assigned

    keeper_ids = sorted(set(assigned.tolist()))
    keepers = gpd.GeoDataFrame(
        {"cluster_id": keeper_ids},
        geometry=[df["geometry"].iloc[cid] for cid in keeper_ids],
        crs="EPSG:4326",
    ).reset_index(drop=True)

    merged = n - len(keepers)
    logger.info(
        f"Site clusters: {n} node -> {len(keepers)} site point "
        f"(gabung {merged} titik, tol={tol_m}m)"
    )
    return df, keepers


def snap_route_endpoints(
    gdf, site_geom, from_col="site_from", to_col="site_to", label=""
):
    """
    Snap vertex ujung line route ke geometri site keeper supaya tidak ada gap
    setelah merge site point. `site_geom`: dict site_point_id -> shapely Point
    (EPSG:4326). `label` hanya untuk log.

    PENTING: arah geometri route tidak selalu sama dengan urutan from->to
    (mis. segmen feeder dari node_cluster_lines yang orientasinya ditentukan dari
    hop-distance, bukan urutan koordinat). Jadi penetapan ujung mana ke site mana
    dipilih berdasarkan jarak terkecil (bukan asumsi coord[0]=from), supaya route
    tidak "loncat" ke site yang salah.

    length_m dihitung ulang (EPSG:3857) setelah snap. Tiap ujung yang bergeser
    >= 0.1m di-log: koordinat asal -> baru, jarak, dan site tujuan.
    """
    if gdf is None or len(gdf) == 0:
        return gdf

    def d2(a, b):
        return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2

    def dist_m(a, b):
        # a,b = (lon,lat) EPSG:4326 -> jarak meter (approx, cukup utk log)
        dlon = (b[0] - a[0]) * 111320.0 * math.cos(math.radians((a[1] + b[1]) / 2.0))
        dlat = (b[1] - a[1]) * 110540.0
        return math.hypot(dlon, dlat)

    new_geoms = []
    for _, row in gdf.iterrows():
        geom = row.geometry
        if geom is None or geom.geom_type != "LineString":
            new_geoms.append(geom)
            continue
        coords = list(geom.coords)
        sf = row.get(from_col)
        st = row.get(to_col)
        fp = site_geom.get(int(sf)) if pd.notna(sf) else None
        tp = site_geom.get(int(st)) if pd.notna(st) else None
        c0, cN = coords[0], coords[-1]  # simpan koordinat asal utk log
        end_site = {0: None, -1: None}

        if fp is not None and tp is not None:
            fpt, tpt = (fp.x, fp.y), (tp.x, tp.y)
            # pilih orientasi (ujung mana -> from/to) yg total perpindahannya minimal
            if d2(c0, fpt) + d2(cN, tpt) <= d2(c0, tpt) + d2(cN, fpt):
                coords[0], coords[-1] = fpt, tpt
                end_site[0], end_site[-1] = int(sf), int(st)
            else:
                coords[0], coords[-1] = tpt, fpt
                end_site[0], end_site[-1] = int(st), int(sf)
        elif fp is not None:
            fpt = (fp.x, fp.y)
            if d2(c0, fpt) <= d2(cN, fpt):
                coords[0] = fpt
                end_site[0] = int(sf)
            else:
                coords[-1] = fpt
                end_site[-1] = int(sf)
        elif tp is not None:
            tpt = (tp.x, tp.y)
            if d2(c0, tpt) <= d2(cN, tpt):
                coords[0] = tpt
                end_site[0] = int(st)
            else:
                coords[-1] = tpt
                end_site[-1] = int(st)

        # LOG perpindahan tiap ujung (>=0.1m)
        for pos, orig in ((0, c0), (-1, cN)):
            if end_site[pos] is None:
                continue
            new = coords[pos]
            d = dist_m(orig, new)
            if d >= 0.1:
                logger.info(
                    f"[snap {label}] {orig[0]:.6f},{orig[1]:.6f} -> "
                    f"{new[0]:.6f},{new[1]:.6f} ({d:.1f}m) -> site {end_site[pos]}"
                )

        new_geoms.append(LineString(coords))

    gdf = gdf.copy()
    gdf["geometry"] = gpd.GeoSeries(new_geoms, index=gdf.index, crs=gdf.crs)
    gdf["length_m"] = gdf.geometry.to_crs(3857).length
    return gdf


def generate_gdf_odp_candidate(
    gdf_road,
    odc_spacing_m: int = 50,
    road_mode: str = "osm",
):
    ODP_SPACING = odc_spacing_m
    odp_candidates = []
    cid = 0

    T9 = {
        "motorway",
        "motorway_link",
        "trunk",
        "trunk_link",
        "primary",
        "primary_link",
    }

    T7 = {
        "secondary",
        "secondary_link",
        "tertiary",
        "tertiary_link",
    }

    # mode local (HERE): pole_type dari class_func (1=tol sudah di-exclude)
    CLASS_FUNC_POLE = {2: "T9", 3: "T7", 4: "T7", 5: "T6"}

    def class_func_to_pole(value):
        try:
            return CLASS_FUNC_POLE.get(int(value), "T6")
        except (TypeError, ValueError):
            return "T6"

    def normalize_highway(value):
        if value is None:
            return []
        if isinstance(value, str):
            return [value]
        if isinstance(value, np.ndarray):
            return value.tolist()
        if isinstance(value, (list, tuple, set)):
            return list(value)
        return [str(value)]

    for idx, road in gdf_road.iterrows():
        line = road.geometry

        if line.length < ODP_SPACING:
            continue

        if road_mode == "local":
            highway = road.get("class_func", None)
            pole_type = class_func_to_pole(highway)
        else:
            highway = road.get("highway", None)
            highway_values = normalize_highway(road.get("highway"))
            if any(h in T9 for h in highway_values):
                pole_type = "T9"
            elif any(h in T7 for h in highway_values):
                pole_type = "T7"
            else:
                pole_type = "T6"

        d = 0
        while d <= line.length:
            odp_candidates.append(
                {
                    "odp_id": f"ODP_{cid}",
                    "geometry": line.interpolate(d),
                    "used": False,
                    "highway": highway,
                    "pole_type": pole_type,
                }
            )
            cid += 1
            d += ODP_SPACING

    gdf_odp_candidate = gpd.GeoDataFrame(
        odp_candidates, geometry="geometry", crs=gdf_road.crs
    )

    logger.info(f"ODP candidate generated: {len(gdf_odp_candidate)}")

    gdf_odp_candidate = gdf_odp_candidate[
        ~gdf_odp_candidate.geometry.duplicated()
    ].reset_index(drop=True)

    # spatial filtering (optimized)
    MIN_DISTANCE = 20
    # build spatial index
    sindex = gdf_odp_candidate.sindex
    keep_mask = np.ones(len(gdf_odp_candidate), dtype=bool)

    for i, geom in enumerate(gdf_odp_candidate.geometry):
        if not keep_mask[i]:
            continue

        # cari kandidat yang mungkin dekat (bounding box query)
        possible_matches_index = list(
            sindex.query(geom.buffer(MIN_DISTANCE), predicate="intersects")
        )

        for j in possible_matches_index:
            if i == j or not keep_mask[j]:
                continue

            if geom.distance(gdf_odp_candidate.geometry.iloc[j]) < MIN_DISTANCE:
                keep_mask[j] = False

    gdf_odp_candidate = gdf_odp_candidate[keep_mask].reset_index(drop=True)

    logger.info(f"ODP candidate cleanse generated: {len(gdf_odp_candidate)}")
    return gdf_odp_candidate


## MAIN BUILD ODP - START
def assign_all_clusters_cp_sat(
    gdf_rumah_3857,
    gdf_odp_3857,
    gdf_road_3857,
    target_per_cluster,
    max_per_odp,
    min_fill,
    max_dist_m,
    ideal_fill_for_candidate,
    extra_candidates,
    top_k_per_rumah,
    num_workers=4,
    solver_time_limit=30,
    allow_new_odp=True,
):
    logger.info("Assign rumah to ODP")
    gdf_rumah_clustered = cluster_rumah_kmeans(
        gdf_rumah_3857, target_per_cluster=target_per_cluster
    )

    results_rumah = []
    results_odp = []

    clusters = list(gdf_rumah_clustered.groupby("cluster_id"))
    total_clusters = len(clusters)
    logger.info(f"Total clusters: {total_clusters}")

    gdf_odp_pool = gdf_odp_3857.copy()

    # for cluster_id, gdf_r_cluster in gdf_rumah_clustered.groupby("cluster_id"):
    for i, (cluster_id, gdf_r_cluster) in enumerate(clusters, start=1):
        n_r = len(gdf_r_cluster)
        logger.info(
            f"[Cluster {i}/{total_clusters}] cluster_id={cluster_id} | rumah={n_r}"
        )
        gdf_odp_local = select_odp_candidates_for_cluster(
            gdf_r_cluster,
            gdf_odp_pool,
            gdf_road_3857,
            max_per_odp,
            max_dist_m=max_dist_m,
            extra_candidates=extra_candidates,
            ideal_fill=ideal_fill_for_candidate,
            cluster_id=cluster_id,
            allow_new_odp=allow_new_odp,
        )

        # kalau kandidat odp kosong: jangan crash, biarkan semua rumah tanpa ODP
        if len(gdf_odp_local) == 0:
            logger.warning(
                f"[Cluster {i}/{total_clusters}] tidak ada ODP dalam jangkauan, "
                f"{n_r} rumah dibiarkan tanpa ODP"
            )
            gdf_r_assigned = gdf_r_cluster.copy()
            gdf_r_assigned["odp_id"] = None
            gdf_r_assigned["cluster_id"] = cluster_id
            results_rumah.append(gdf_r_assigned)
            continue

        gdf_r_assigned, gdf_odp_used = assign_rumah_to_odp_cp_sat(
            gdf_r_cluster,
            gdf_odp_local,
            max_per_odp=max_per_odp,
            min_fill=min_fill,
            max_dist=max_dist_m,
            solver_time_limit=solver_time_limit,
            top_k_per_rumah=top_k_per_rumah,
            num_workers=num_workers,
        )

        used_ids = set(gdf_odp_used["odp_id"].tolist())
        gdf_odp_pool = gdf_odp_pool[~gdf_odp_pool["odp_id"].isin(used_ids)].copy()
        logger.info(
            f"[Cluster {i}/{total_clusters}] used_odp={len(used_ids)} | remaining_odp={len(gdf_odp_pool)}"
        )

        gdf_r_assigned["cluster_id"] = cluster_id
        results_rumah.append(gdf_r_assigned)

        # cluster bisa saja tidak memakai ODP sama sekali (semua rumah standalone)
        if len(gdf_odp_used) > 0:
            gdf_odp_used["cluster_id"] = cluster_id
            results_odp.append(gdf_odp_used)

    gdf_rumah_final = gpd.GeoDataFrame(
        pd.concat(results_rumah, ignore_index=True), crs=gdf_rumah_3857.crs
    )
    if results_odp:
        gdf_odp_final = gpd.GeoDataFrame(
            pd.concat(results_odp, ignore_index=True), crs=gdf_odp_3857.crs
        )
    else:
        # tidak ada satupun ODP terpakai (semua rumah berdiri sendiri).
        # pertahankan skema kolom asli supaya akses kolom di hilir tidak KeyError.
        gdf_odp_final = gdf_odp_3857.iloc[0:0].copy()

    logger.info(f"ODP terpilih: {len(gdf_odp_final)}")
    # cek rumah tanpa ODP
    unassigned = gdf_rumah_final[gdf_rumah_final.odp_id.isna()]
    logger.info(f"Rumah tanpa ODP: {len(unassigned)}")

    if len(gdf_odp_final) == 0:
        logger.warning(
            "Tidak ada ODP yang terpakai untuk seluruh rumah "
            f"(max_dist_m={max_dist_m}, allow_new_odp={allow_new_odp}). "
            "Semua rumah dibiarkan standalone; tahap jaringan berikutnya dilewati."
        )

    return gdf_rumah_final, gdf_odp_final


def cluster_rumah_kmeans(gdf_rumah_3857, target_per_cluster=320, random_state=42):
    n = len(gdf_rumah_3857)
    k = max(1, int(np.ceil(n / target_per_cluster)))

    coords = np.column_stack([gdf_rumah_3857.geometry.x, gdf_rumah_3857.geometry.y])

    km = KMeans(n_clusters=k, random_state=random_state, n_init="auto")
    labels = km.fit_predict(coords)

    gdf_3857 = gdf_rumah_3857.copy()
    gdf_3857["_cluster_raw"] = labels

    ## spatial ordering cluster
    # centroid tiap cluster (mean x,y)
    centroids = (
        gdf_3857.groupby("_cluster_raw")
        .apply(
            lambda df: pd.Series(
                {"cx": df.geometry.x.mean(), "cy": df.geometry.y.mean()}
            )
        )
        .reset_index()
    )

    # urut: atas dulu (cy besar), lalu kiri dulu (cx kecil)
    centroids = centroids.sort_values(
        ["cy", "cx"], ascending=[False, True]
    ).reset_index(drop=True)

    # mapping raw -> ordered
    mapping = {row["_cluster_raw"]: i for i, row in centroids.iterrows()}

    gdf_3857["cluster_id"] = gdf_3857["_cluster_raw"].map(mapping).astype(int)
    gdf_3857 = gdf_3857.drop(columns=["_cluster_raw"])

    return gdf_3857


def select_odp_candidates_for_cluster(
    gdf_rumah_cluster,
    gdf_odp_3857,
    gdf_road_3857,
    max_per_odp,
    max_dist_m,
    extra_candidates,
    ideal_fill,
    cluster_id,
    seed=42,
    allow_new_odp=True,
):
    radius_m = max_dist_m + 50
    n_r = len(gdf_rumah_cluster)
    needed_odp = math.ceil(n_r / ideal_fill)
    take_n = needed_odp + extra_candidates

    needed_by_capacity = math.ceil(n_r / max_per_odp)
    need_odp = max(take_n, needed_by_capacity)

    rumah_union = gdf_rumah_cluster.unary_union
    hull = rumah_union.convex_hull
    buffer_area = hull.buffer(radius_m)

    # STEP 1: ambil ODP existing di area buffer
    gdf_in = gdf_odp_3857[gdf_odp_3857.intersects(buffer_area)].copy()
    gdf_in["is_new"] = False

    # Mode "pakai yang ada saja": tidak buat ODP baru, tidak prune existing,
    # supaya seluruh ODP dalam jangkauan bisa dimanfaatkan maksimal.
    # Kalau tetap tidak cukup, rumah dibiarkan tanpa ODP (di-handle solver).
    if not allow_new_odp:
        logger.info(f"ODP total : {len(gdf_odp_3857)}")
        logger.info(f"ODP intersected(buffer) : {len(gdf_in)}")
        logger.info(f"ODP needed (ideal): {take_n}")
        logger.info(f"ODP needed (capacity): {needed_by_capacity}")
        logger.info(f"ODP terpilih (existing only): {len(gdf_in)}")
        return gdf_in

    # kalau terlalu banyak, prune ke yang paling dekat hull
    if len(gdf_in) > need_odp:
        gdf_in["dist_to_cluster"] = gdf_in.geometry.distance(hull)
        gdf_in = gdf_in.nsmallest(take_n, "dist_to_cluster").copy()
        gdf_in = gdf_in.drop(columns=["dist_to_cluster"])

    # kalau sudah cukup
    if len(gdf_in) >= need_odp:
        logger.info(f"ODP total : {len(gdf_odp_3857)}")
        logger.info(f"ODP intersected(buffer) : {len(gdf_in)}")
        logger.info(f"ODP needed (ideal): {take_n}")
        logger.info(f"ODP needed (capacity): {needed_by_capacity}")
        logger.info(f"ODP terpilih : {len(gdf_in)}")
        return gdf_in

    # STEP 2: kalau kurang → generate ODP baru random
    missing = need_odp - len(gdf_in)

    # radius larangan (agar random tidak terlalu dekat ODP existing)
    avoid_radius_m = 50
    if len(gdf_in) > 0:
        odp_cover = gdf_in.geometry.buffer(avoid_radius_m).unary_union
        empty_area = buffer_area.difference(odp_cover)
        if empty_area.is_empty:
            empty_area = buffer_area
    else:
        empty_area = buffer_area

    # generate random points
    new_pts = _random_points_in_geom(empty_area, missing, seed=seed)
    new_pts = _snap_points_to_roads(new_pts, gdf_road_3857)

    # buat gdf ODP baru
    prefix = f"NEW_ODP_C{cluster_id}"
    gdf_new = gpd.GeoDataFrame(
        {
            "odp_id": [f"{prefix}_{i}" for i in range(missing)],
            "is_new": True,
            "pole_type": "T6",
        },
        geometry=new_pts,
        crs=gdf_odp_3857.crs,
    )

    # pastikan kolom schema match (biar aman concat)
    for col in gdf_odp_3857.columns:
        if col not in gdf_new.columns and col != "geometry":
            gdf_new[col] = None

    for col in gdf_new.columns:
        if col not in gdf_in.columns and col != "geometry":
            gdf_in[col] = None

    # concat existing + new
    gdf_final = gpd.GeoDataFrame(
        pd.concat([gdf_in, gdf_new[gdf_in.columns]], ignore_index=True),
        geometry="geometry",
        crs=gdf_odp_3857.crs,
    )

    logger.info(f"ODP total : {len(gdf_odp_3857)}")
    logger.info(f"ODP intersected(buffer) : {len(gdf_in)}")
    logger.info(f"ODP needed (ideal): {take_n}")
    logger.info(f"ODP needed (capacity): {needed_by_capacity}")
    logger.info(f"ODP terpilih : {len(gdf_final)}")
    return gdf_final


def assign_rumah_to_odp_cp_sat(
    gdf_rumah,
    gdf_odp,
    max_per_odp=10,
    min_fill=0,
    solver_time_limit=30,
    top_k_per_rumah=20,
    num_workers=4,
    max_dist=None,
):
    """
    Wrapper production:
    - coba solve pakai top_k_per_rumah
    - kalau infeasible, auto retry dengan k lebih besar
    - terakhir fallback full bipartite (k=None)
    - max_dist (meter, opsional): rumah > max_dist dari ODP terdekat tidak
      ditugaskan ke ODP manapun (odp_id = None)
    """

    retry_plan = []

    # start dari user value
    if top_k_per_rumah is not None:
        retry_plan.append(int(top_k_per_rumah))

    # tambah step upgrade
    retry_plan += [30, 40, None]

    # hilangkan duplikat tapi urutan tetap
    seen = set()
    retry_plan = [k for k in retry_plan if not (k in seen or seen.add(k))]

    last_error = None

    for k_try in retry_plan:
        try:
            logger.info(
                f"CP-SAT solve: rumah={len(gdf_rumah)} odp={len(gdf_odp)} top_k={k_try}"
            )
            return _solve_with_topk_cp_sat(
                gdf_rumah=gdf_rumah,
                gdf_odp=gdf_odp,
                max_per_odp=max_per_odp,
                min_fill=min_fill,
                solver_time_limit=solver_time_limit,
                top_k_per_rumah=k_try,
                num_workers=num_workers,
                max_dist=max_dist,
            )
        except RuntimeError as e:
            last_error = e
            if "feasible assignment" not in str(e):
                raise
            logger.warning(f"Infeasible dengan top_k={k_try}, retry...")

    raise RuntimeError(
        f"CP-SAT infeasible bahkan setelah retry. Last error: {last_error}"
    )


def _solve_with_topk_cp_sat(
    gdf_rumah,
    gdf_odp,
    max_per_odp,
    min_fill,
    solver_time_limit,
    top_k_per_rumah,
    num_workers,
    max_dist=None,
):
    """
    Solve assignment rumah -> ODP pakai CP-SAT.

    Prioritas objective (berjenjang):
      1. Maksimalkan jumlah rumah yang tertugas.
      2. Setiap rumah ke ODP terdekat yang masih tersedia (minimasi total jarak).

    Constraint:
      - Setiap ODP menampung maksimal `max_per_odp` rumah.
      - Rumah yang jarak ke ODP terdekat > `max_dist` tidak ditugaskan (odp_id=None).

    Parameter:
    - top_k_per_rumah: None (semua ODP jadi kandidat) atau int (hanya k ODP
      terdekat per rumah) untuk mempercepat solve.
    - min_fill (opsional): jika > 0, ODP yang dipakai wajib menampung minimal
      sekian rumah; default 0 = tanpa batas bawah.
    """

    model = cp_model.CpModel()

    n_rumah = len(gdf_rumah)
    n_odp = len(gdf_odp)

    if n_rumah == 0 or n_odp == 0:
        raise RuntimeError("Rumah atau ODP kosong.")

    # -----------------------------
    # Distance matrix
    # -----------------------------
    rumah_coords = np.column_stack([gdf_rumah.geometry.x, gdf_rumah.geometry.y])
    odp_coords = np.column_stack([gdf_odp.geometry.x, gdf_odp.geometry.y])

    # skala meter -> unit internal (mm) supaya jarak jadi integer untuk CP-SAT
    DIST_SCALE = 1000

    dist_matrix = np.linalg.norm(
        rumah_coords[:, None, :] - odp_coords[None, :, :], axis=2
    )
    dist_matrix = (dist_matrix * DIST_SCALE).astype(int)

    # threshold jarak maksimum (meter) -> unit internal
    max_dist_units = None if max_dist is None else int(max_dist * DIST_SCALE)

    # -----------------------------
    # Candidate pruning (top-k only)
    # -----------------------------
    candidates = []

    if top_k_per_rumah is None:
        # full bipartite: semua ODP kandidat boleh (tetap dibatasi max_dist)
        for r in range(n_rumah):
            drow = dist_matrix[r]
            if max_dist_units is None:
                candidates.append(list(range(n_odp)))
            else:
                idx = np.where(drow <= max_dist_units)[0]
                idx = idx[np.argsort(drow[idx])]
                candidates.append(idx.tolist())

    else:
        k = min(int(top_k_per_rumah), n_odp)

        for r in range(n_rumah):
            drow = dist_matrix[r]

            idx = np.argpartition(drow, k - 1)[:k]
            idx = idx[np.argsort(drow[idx])]

            # buang kandidat yang di luar max_dist
            if max_dist_units is not None:
                idx = idx[drow[idx] <= max_dist_units]

            candidates.append(idx.tolist())

    # -----------------------------
    # Decision variables
    # -----------------------------
    x = {}
    # indeks balik odp -> daftar rumah kandidat (biar constraint kapasitas O(edges),
    # bukan O(n_odp * n_rumah))
    odp_to_r = {o: [] for o in range(n_odp)}
    for r in range(n_rumah):
        for o in candidates[r]:
            x[(r, o)] = model.NewBoolVar(f"x_r{r}_o{o}")
            odp_to_r[o].append(r)

    # min_fill hanya perlu variabel "ODP terpakai" (y). Default min_fill=0 -> skip.
    use_y = bool(min_fill) and min_fill > 0

    # -----------------------------
    # Constraints
    # -----------------------------
    # (1) tiap rumah maksimal 1 ODP. Boleh 0 kalau semua kandidat sudah penuh
    #     atau rumah di luar max_dist (candidates[r] kosong). "Tugaskan sebanyak
    #     mungkin" ditangani objective, bukan constraint == 1.
    for r in range(n_rumah):
        if candidates[r]:
            model.Add(sum(x[(r, o)] for o in candidates[r]) <= 1)

    # (2) tiap ODP maksimal max_per_odp rumah
    for o in range(n_odp):
        terms = [x[(r, o)] for r in odp_to_r[o]]
        if not terms:
            continue
        if use_y:
            y_o = model.NewBoolVar(f"y_o{o}")
            model.Add(sum(terms) <= max_per_odp * y_o)
            model.Add(sum(terms) >= min_fill * y_o)
        else:
            model.Add(sum(terms) <= max_per_odp)

    # -----------------------------
    # Objective (lexicographic via bobot)
    # -----------------------------
    #   Prioritas 1: maksimalkan jumlah rumah tertugas
    #   Prioritas 2: minimalkan total jarak (rumah -> ODP terdekat yang tersedia)
    #
    # ASSIGN_REWARD dibuat lebih besar dari total jarak maksimum yang mungkin
    # (n_rumah * jarak_kandidat_terjauh). Dengan begitu menambah 1 assignment
    # SELALU menurunkan objective lebih banyak daripada penghematan jarak apa pun
    # -> jumlah rumah tertugas benar-benar jadi prioritas tertinggi, dan di antara
    # solusi dengan jumlah tertugas sama, solver memilih total jarak terkecil.
    max_edge = max((int(dist_matrix[r, o]) for (r, o) in x), default=0)
    assign_reward = n_rumah * max_edge + 1

    obj_terms = [(int(dist_matrix[r, o]) - assign_reward) * x[(r, o)] for (r, o) in x]

    model.Minimize(sum(obj_terms))

    # -----------------------------
    # Solve
    # -----------------------------
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = solver_time_limit
    solver.parameters.num_search_workers = num_workers

    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError("CP-SAT solver could not find a feasible assignment.")

    # -----------------------------
    # Build results
    # -----------------------------
    assignment = {}
    assigned_counts = np.zeros(n_odp, dtype=int)

    for r in range(n_rumah):
        for o in candidates[r]:
            if solver.Value(x[(r, o)]) == 1:
                assignment[r] = o
                assigned_counts[o] += 1
                break

    gdf_rumah_assigned = gdf_rumah.copy()
    odp_ids = gdf_odp["odp_id"].tolist()
    gdf_rumah_assigned["odp_id"] = [
        odp_ids[assignment[r]] if r in assignment else None for r in range(n_rumah)
    ]

    n_unassigned = n_rumah - len(assignment)
    if n_unassigned:
        logger.info(f"Rumah tanpa ODP (di luar max_dist={max_dist} m): {n_unassigned}")

    used_idx = [i for i, c in enumerate(assigned_counts) if c > 0]
    gdf_odp_final = gdf_odp.iloc[used_idx].copy()
    gdf_odp_final["assigned_count"] = assigned_counts[used_idx]

    return gdf_rumah_assigned, gdf_odp_final


def _random_points_in_geom(geom, n, seed=42, max_tries=200000):
    """
    Generate n random points inside shapely geometry (Polygon/MultiPolygon).
    """
    random.seed(seed)

    if geom.is_empty:
        return []

    minx, miny, maxx, maxy = geom.bounds
    pts = []
    tries = 0

    while len(pts) < n and tries < max_tries:
        tries += 1
        p = Point(random.uniform(minx, maxx), random.uniform(miny, maxy))

        if geom.contains(p):
            pts.append(p)

    if len(pts) < n:
        raise RuntimeError(
            f"Gagal generate random points: butuh={n}, dapat={len(pts)}, tries={tries}"
        )

    return pts


def _snap_points_to_roads(
    points,
    gdf_road,
    search_radius=500,  # meter
    max_snap_distance=500,  # meter (opsional batas maksimal snap)
):
    """
    Snap list of Points ke jalan terdekat.
    Kalau gagal atau terlalu jauh → return titik asli.
    """

    if gdf_road is None or len(gdf_road) == 0:
        return points

    try:
        sindex = gdf_road.sindex
    except Exception as e:
        logger.error(f"Gagal buat spatial index: {e}")
        return points

    snapped_pts = []
    failed = 0
    too_far = 0

    for p in points:
        try:
            if not isinstance(p, Point):
                snapped_pts.append(p)
                continue

            # 🔹 1. Cari kandidat via bounding box buffer
            candidate_idx = list(sindex.intersection(p.buffer(search_radius).bounds))

            if not candidate_idx:
                failed += 1
                snapped_pts.append(p)
                continue

            candidates = gdf_road.iloc[candidate_idx]

            # 🔹 2. Hitung jarak sebenarnya
            distances = candidates.geometry.distance(p)
            nearest_idx = distances.idxmin()
            nearest_dist = distances.loc[nearest_idx]

            # 🔹 3. Batasi jarak maksimal snap
            if nearest_dist > max_snap_distance:
                too_far += 1
                snapped_pts.append(p)
                continue

            nearest_road = gdf_road.geometry.loc[nearest_idx]

            if (
                nearest_road is None
                or nearest_road.is_empty
                or not isinstance(nearest_road, (LineString, MultiLineString))
            ):
                failed += 1
                snapped_pts.append(p)
                continue

            # 🔹 4. Lakukan snapping
            snapped = nearest_road.interpolate(nearest_road.project(p))

            snapped_pts.append(snapped)

        except Exception as e:
            logger.error(f"Gagal snap ke jalan: {e}")
            failed += 1
            snapped_pts.append(p)

    logger.info(
        f"Snap selesai | total={len(points)} | "
        f"gagal_bbox={failed} | terlalu_jauh={too_far}"
    )

    return snapped_pts


## MAIN BUILD ODP - END


def build_odc_grouping_cp_sat_medoid(
    gdf_odp,
    max_odp_per_odc=4,
    max_dist_m=None,  # optional: batasi assignment biar makin cepat
    solver_time_limit=30,
    num_workers=8,
):
    """
    CP-SAT Medoid model (Facility Location) untuk grouping ODP → ODC.

    Variabel:
      y[j] = 1 jika ODP j dipilih sebagai center (ODC)
      x[i,j] = 1 jika ODP i di-assign ke center j

    Constraint:
      - setiap ODP harus assigned tepat 1 center
      - kapasitas center <= max_odp_per_odc
      - x[i,j] <= y[j]
      - (opsional) max_dist_m membatasi kandidat assignment

    Objective:
      - minimize jumlah center (ODC)
      - minimize total distance ODP → center
    """

    logger.info("Building ODC")

    n = len(gdf_odp)
    if n == 0:
        return gdf_odp.copy(), gpd.GeoDataFrame(
            [], geometry="geometry", crs=gdf_odp.crs
        )

    coords = np.array([(p.x, p.y) for p in gdf_odp.geometry])

    # distance matrix (int)
    dist_matrix = np.linalg.norm(coords[:, None, :] - coords[None, :, :], axis=2)
    dist_matrix = (dist_matrix * 1000).astype(int)  # meter x 1000

    model = cp_model.CpModel()

    # y[j] = center aktif
    y = [model.NewBoolVar(f"y_{j}") for j in range(n)]

    # x[i,j] = ODP i assigned ke center j
    x = {}
    for i in range(n):
        for j in range(n):
            x[i, j] = model.NewBoolVar(f"x_{i}_{j}")

    # -------------------------
    # Constraints
    # -------------------------

    # setiap ODP tepat 1 center
    for i in range(n):
        model.Add(sum(x[i, j] for j in range(n)) == 1)

    # hanya boleh assigned ke center aktif
    for i in range(n):
        for j in range(n):
            model.Add(x[i, j] <= y[j])

    # kapasitas center
    for j in range(n):
        model.Add(sum(x[i, j] for i in range(n)) <= max_odp_per_odc * y[j])

    # optional: center harus include dirinya sendiri (stabilin cluster)
    for j in range(n):
        model.Add(x[j, j] == y[j])

    # optional: batasi max distance assignment (buat speed)
    if max_dist_m is not None:
        MAX_DIST = int(max_dist_m * 1000)
        for i in range(n):
            for j in range(n):
                if dist_matrix[i, j] > MAX_DIST:
                    model.Add(x[i, j] == 0)

    # -------------------------
    # Objective (lexicographic)
    # -------------------------
    BIG_M = 1_000_000

    obj_terms = []
    obj_terms.append(BIG_M * sum(y[j] for j in range(n)))

    for i in range(n):
        for j in range(n):
            obj_terms.append(dist_matrix[i, j] * x[i, j])

    model.Minimize(sum(obj_terms))

    # -------------------------
    # Solve
    # -------------------------
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = solver_time_limit
    solver.parameters.num_search_workers = num_workers

    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError("No feasible ODC grouping found (medoid model).")

    # -------------------------
    # Extract result
    # -------------------------
    assign_center = {}
    centers = []

    for j in range(n):
        if solver.Value(y[j]) == 1:
            centers.append(j)

    # mapping i -> center j
    for i in range(n):
        for j in range(n):
            if solver.Value(x[i, j]) == 1:
                assign_center[i] = j
                break

    # buat odc_id berbasis urutan center
    center_to_odc = {c: f"ODC_{idx}" for idx, c in enumerate(centers)}

    gdf_odp_out = gdf_odp.copy()
    gdf_odp_out["odc_id"] = [center_to_odc[assign_center[i]] for i in range(n)]

    # gdf_odc: geometry = lokasi center
    # odc_rows = []
    # for c in centers:
    #     odc_rows.append(
    #         {
    #             "odc_id": center_to_odc[c],
    #             "odp_id": gdf_odp.iloc[c]["odp_id"],  # optional: siapa anchor-nya
    #             "geometry": gdf_odp.iloc[c].geometry,
    #         }
    #     )

    # gdf_odc = gpd.GeoDataFrame(odc_rows, geometry="geometry", crs=gdf_odp.crs)

    return gdf_odp_out


def build_odc_grouping_cp_sat_medoid_clustered(
    gdf_odp,
    max_odp_per_odc=4,
    max_dist_m=150,
    target_cluster_size=200,
    solver_time_limit=30,
    num_workers=8,
    ors_client=None,
):
    n = len(gdf_odp)
    if n == 0:
        out = gdf_odp.copy()
        out["odc_id"] = pd.Series(dtype="object")
        return out

    coords = np.array([(p.x, p.y) for p in gdf_odp.geometry], dtype=np.float64)

    # jumlah cluster kira2
    k = max(1, int(math.ceil(n / target_cluster_size)))

    km = KMeans(n_clusters=k, random_state=42, n_init="auto")
    labels = km.fit_predict(coords)

    gdf_odp = gdf_odp.copy()
    gdf_odp["odc_cluster"] = labels

    outputs = []

    for cluster_id in sorted(gdf_odp["odc_cluster"].unique()):
        sub = gdf_odp[gdf_odp["odc_cluster"] == cluster_id].copy()
        logger.info(f"[ODC-CLUSTER] cluster={cluster_id}/{k-1}")

        # solve cluster kecil
        sub_out = build_odc_grouping_cp_sat_medoid_pruned(
            sub,
            max_odp_per_odc=max_odp_per_odc,
            max_dist_m=max_dist_m,
            top_k=15,
            solver_time_limit=solver_time_limit,
            num_workers=num_workers,
            ors_client=ors_client,
        )

        # supaya ODC id unik global
        sub_out["odc_id"] = sub_out["odc_id"].apply(lambda x: f"C{cluster_id}_{x}")

        outputs.append(sub_out)

    return gpd.GeoDataFrame(pd.concat(outputs, ignore_index=True), crs=gdf_odp.crs)


def build_odc_grouping_cp_sat_medoid_pruned(
    gdf_odp,
    max_odp_per_odc=4,
    max_dist_m=None,  # optional pruning by radius
    top_k=30,  # <-- kunci utama hemat memory
    solver_time_limit=30,
    num_workers=8,
    ors_client=None,
    logger=None,
):
    """
    CP-SAT Medoid model (Facility Location) untuk grouping ODP → ODC,
    tapi dibuat versi PRUNED supaya tidak O(n^2) variables.

    Variabel:
      y[j] = 1 jika ODP j dipilih sebagai center (ODC)
      x[i,j] = 1 jika ODP i di-assign ke center j (hanya kandidat)

    Constraint:
      - setiap ODP harus assigned tepat 1 center (dari kandidatnya)
      - kapasitas center <= max_odp_per_odc
      - x[i,j] <= y[j]
      - x[j,j] == y[j]  (center harus include dirinya sendiri)

    Objective (lexicographic):
      - minimize jumlah center
      - minimize total distance

    Output:
      gdf_odp_out: gdf_odp + odc_id
    """

    if logger is None:

        class _Dummy:
            def info(self, *a, **k):
                pass

            def warning(self, *a, **k):
                pass

        logger = _Dummy()

    n = len(gdf_odp)
    if n == 0:
        out = gdf_odp.copy()
        out["odc_id"] = pd.Series(dtype="object")
        return out

    # untuk HERE / ORS (WGS84)
    gdf_odp_wgs = gdf_odp.to_crs(4326)
    coords_ors = [(p.x, p.y) for p in gdf_odp_wgs.geometry]

    # Network distance
    # if ors_client is not None:
    #     logger.info("Computing ORS distance matrix")
    #     network_matrix = compute_ors_distance_matrix(coords_ors, ors_client)
    #     dist_int = network_matrix.astype(np.int32)
    # else:
    #     dist_int = (dist * 1000).astype(np.int32)

    # Jarak jaringan HERE (meter). Rute invalid ditandai UNREACHABLE (lihat
    # compute_here_distance_matrix: matrix < 0 -> 1e9).
    network_matrix = compute_here_distance_matrix(coords_ors)
    dist_int = network_matrix.astype(np.int32)

    UNREACHABLE = 1_000_000_000
    BIG_M = 1_000_000

    # -----------------------------------
    # Candidate pruning per i (semua pakai jarak jaringan HERE / dist_int)
    # -----------------------------------
    candidates = []
    # unit meter, samakan dengan dist_int (bukan lagi *1000 versi Euclidean)
    MAX_DIST = None if max_dist_m is None else int(max_dist_m)

    for i in range(n):
        drow = dist_int[i]

        # hanya center yang benar-benar terjangkau via jaringan
        reachable = drow < UNREACHABLE

        # radius pruning (opsional) di atas keterjangkauan
        if MAX_DIST is not None:
            feasible = np.where(reachable & (drow <= MAX_DIST))[0]
        else:
            feasible = np.where(reachable)[0]

        # fallback: diri sendiri (dist_int[i, i] == 0) selalu jadi kandidat
        if len(feasible) == 0:
            feasible = np.array([i])

        # top-k terdekat (jaringan)
        if top_k is not None and len(feasible) > top_k:
            feasible = feasible[np.argsort(drow[feasible])[:top_k]]

        # WAJIB: i harus bisa assign ke dirinya sendiri
        # (biar constraint x[i,i] == y[i] tetap feasible)
        if i not in feasible:
            feasible = np.append(feasible, i)

        candidates.append(feasible.tolist())

    # -----------------------------------
    # Build CP-SAT model
    # -----------------------------------
    model = cp_model.CpModel()

    # y[j]
    y = [model.NewBoolVar(f"y_{j}") for j in range(n)]

    # x[(i,j)] hanya untuk kandidat
    x = {}

    for i in range(n):
        for j in candidates[i]:
            x[(i, j)] = model.NewBoolVar(f"x_{i}_{j}")

    # -----------------------------------
    # Constraints
    # -----------------------------------

    # setiap ODP i tepat 1 assigned
    for i in range(n):
        model.Add(sum(x[(i, j)] for j in candidates[i]) == 1)

    # x => y
    for i in range(n):
        for j in candidates[i]:
            model.Add(x[(i, j)] <= y[j])

    # kapasitas center: sum_i x[i,j] <= max * y[j]
    # IMPORTANT: jangan loop i=0..n untuk tiap j (itu O(n^2) lagi).
    # Kita bikin adjacency list: siapa saja yang punya j sebagai kandidat.
    cand_of_j = [[] for _ in range(n)]
    for i in range(n):
        for j in candidates[i]:
            cand_of_j[j].append(i)

    for j in range(n):
        if len(cand_of_j[j]) == 0:
            model.Add(y[j] == 0)
            continue

        model.Add(sum(x[(i, j)] for i in cand_of_j[j]) <= max_odp_per_odc * y[j])

    # center harus include dirinya sendiri
    # x[j,j] harus ada
    for j in range(n):
        if (j, j) not in x:
            # harusnya tidak terjadi karena kita append i ke feasible
            # tapi kita guard untuk safety
            x[(j, j)] = model.NewBoolVar(f"x_{j}_{j}")
            candidates[j].append(j)
            cand_of_j[j].append(j)

        model.Add(x[(j, j)] == y[j])

    # -----------------------------------
    # Objective
    # -----------------------------------
    obj_terms = []
    obj_terms.append(BIG_M * sum(y))

    for i in range(n):
        for j in candidates[i]:
            obj_terms.append(int(dist_int[i, j]) * x[(i, j)])

    model.Minimize(sum(obj_terms))

    # -----------------------------------
    # Solve
    # -----------------------------------
    solver = cp_model.CpSolver()
    solver.parameters.max_time_in_seconds = solver_time_limit
    solver.parameters.num_search_workers = num_workers

    logger.info(f"CP-SAT ODC(pruned): n_odp={n} top_k={top_k} max_dist_m={max_dist_m}")

    status = solver.Solve(model)

    if status not in (cp_model.OPTIMAL, cp_model.FEASIBLE):
        raise RuntimeError("No feasible ODC grouping found (pruned medoid model).")

    # -----------------------------------
    # Extract results
    # -----------------------------------
    centers = [j for j in range(n) if solver.Value(y[j]) == 1]

    # mapping i -> center j
    assign_center = np.full(n, -1, dtype=np.int32)

    for i in range(n):
        for j in candidates[i]:
            if solver.Value(x[(i, j)]) == 1:
                assign_center[i] = j
                break

        if assign_center[i] < 0:
            raise RuntimeError(f"Internal error: ODP {i} not assigned.")

    # buat odc_id berbasis urutan center
    center_to_odc = {c: f"ODC_{idx}" for idx, c in enumerate(centers)}

    gdf_odp_out = gdf_odp.copy()
    gdf_odp_out["odc_id"] = [center_to_odc[int(assign_center[i])] for i in range(n)]

    return gdf_odp_out


def assign_odp_roles(gdf_odp):
    """
    Input:
      gdf_odp wajib punya kolom:
        - odp_id
        - odc_id
        - geometry (Point)

    Output:
      gdf_odp + kolom:
        - role       (ODP_1 / ODP_2 / ODP_3 / ODP_4)
        - parent_odp (odp_id atau None)
    """
    logger.info("Selecting ODP Roles")

    gdf = gdf_odp.copy()
    gdf["role"] = None
    gdf["parent_odp"] = None
    gdf["parent_odc"] = None

    for odc_id, grp in gdf.groupby("odc_id"):
        idxs = grp.index.tolist()
        points = grp.geometry.tolist()

        if len(points) == 0:
            continue

        # ---------- 1. centroid ----------
        centroid = grp.geometry.unary_union.centroid

        # ---------- 2. anchor = ODP_2 ----------
        dists = grp.geometry.distance(centroid)
        anchor_idx = dists.idxmin()

        gdf.at[anchor_idx, "role"] = "ODP_2"
        gdf.at[anchor_idx, "parent_odp"] = None

        remaining = grp.drop(anchor_idx)

        if remaining.empty:
            continue

        # ---------- 3. ODP_1 & ODP_3 ----------
        anchor_geom = gdf.loc[anchor_idx].geometry
        dists_to_anchor = remaining.geometry.distance(anchor_geom)
        nearest = dists_to_anchor.sort_values().index.tolist()

        if len(nearest) >= 1:
            gdf.at[nearest[0], "role"] = "ODP_1"
            gdf.at[nearest[0], "parent_odp"] = gdf.at[anchor_idx, "odp_id"]
            gdf.at[nearest[0], "parent_odc"] = gdf.at[anchor_idx, "odp_id"]

        if len(nearest) >= 2:
            gdf.at[nearest[1], "role"] = "ODP_3"
            gdf.at[nearest[1], "parent_odp"] = gdf.at[anchor_idx, "odp_id"]
            gdf.at[nearest[1], "parent_odc"] = gdf.at[anchor_idx, "odp_id"]

        # ---------- 4. ODP_4 ----------
        if len(nearest) == 3:
            idx4 = nearest[2]
            gdf.at[idx4, "role"] = "ODP_4"

            # parent = lebih dekat ke ODP_1 atau ODP_3
            p1 = gdf.loc[nearest[0]]
            p3 = gdf.loc[nearest[1]]

            d1 = gdf.loc[idx4].geometry.distance(p1.geometry)
            d3 = gdf.loc[idx4].geometry.distance(p3.geometry)

            gdf.at[idx4, "parent_odp"] = p1.odp_id if d1 <= d3 else p3.odp_id
            gdf.at[idx4, "parent_odc"] = gdf.at[anchor_idx, "odp_id"]

    return gdf


def set_odc_to_odp_anchor(gdf_odp):
    gdf_anchor = gdf_odp[gdf_odp["role"] == "ODP_2"].copy()
    gdf_odc = gdf_anchor[["odc_id", "odp_id", "geometry"]].reset_index(drop=True)

    gdf_odc = gpd.GeoDataFrame(
        gdf_odc,
        geometry="geometry",
        crs=gdf_odp.crs,
    )

    return gdf_odc


def build_odc_odp_lines(
    gdf_odp,
    route_type_id=4,
    transport_mode="pedestrian",
):
    """
    Build line ODC–ODP menggunakan HERE Routing API.

    Return:
      GeoDataFrame LineString
    """

    logger.info("build odc-odp line")
    gdf_odp = gdf_odp.to_crs(4326)

    line_records = []
    if gdf_odp["odp_id"].duplicated().any():
        dup = gdf_odp[gdf_odp["odp_id"].duplicated(keep=False)]["odp_id"].unique()
        raise ValueError(f"odp_id tidak unik, duplikat: {dup[:10]}")

    odp_index = gdf_odp.set_index("odp_id")

    for _, row in gdf_odp.iterrows():
        # ODP_2 tidak punya parent
        if row.role == "ODP_2" or pd.isna(row.parent_odp):
            continue

        parent_id = row.parent_odp

        if parent_id not in odp_index.index:
            continue

        parent_row = odp_index.loc[parent_id]

        start_lonlat = (
            parent_row.geometry.x,
            parent_row.geometry.y,
        )

        end_lonlat = (
            row.geometry.x,
            row.geometry.y,
        )

        try:

            route_record = get_route_or_straight_here(
                start_lonlat=start_lonlat,
                end_lonlat=end_lonlat,
                route_type_id=route_type_id,
                from_odp=parent_row.name,
                to_odp=row.odp_id,
                transport_mode=transport_mode,
            )

            route_record["odc_id"] = row.odc_id

            line_records.append(route_record)

        except Exception as e:

            logger.error(f"Gagal routing " f"{parent_row.name} -> {row.odp_id}: {e}")

            # fallback garis lurus
            line_4326 = LineString(
                [
                    start_lonlat,
                    end_lonlat,
                ]
            )

            # hitung meter
            line_3857 = (
                gpd.GeoSeries(
                    [line_4326],
                    crs=4326,
                )
                .to_crs(3857)
                .iloc[0]
            )

            line_records.append(
                {
                    "odc_id": row.odc_id,
                    "from_odp": parent_row.name,
                    "to_odp": row.odp_id,
                    "length_m": float(line_3857.length),
                    "geometry": line_3857,
                    "route_type_id": route_type_id,
                    "waypoints": [],
                }
            )

    gdf = gpd.GeoDataFrame(
        line_records,
        geometry="geometry",
        crs=3857,
    )

    pole_counter = 1
    jc_counter = 1
    pole_record = []
    jc_record = []
    split_records = []
    for _, row in gdf.iterrows():
        line = row.geometry
        if line is None or line.is_empty:
            continue

        waypoint_indexes = row.get("waypoints", []) or []
        if len(waypoint_indexes) == 0:
            split_records.append(
                {
                    "from_odp": str(row["from_odp"]),
                    "to_odp": str(row["to_odp"]),
                    "length_m": float(line.length),
                    "geometry": line,
                    "route_type_id": route_type_id,
                }
            )
            continue
        waypoint_distances = get_waypoint_distances(
            line,
            waypoint_indexes,
        )
        distances = np.unique(
            np.round(
                waypoint_distances,
                1,
            )
        )
        distances = distances[(distances > 1) & (distances < line.length - 1)]
        if len(distances) == 0:
            split_records.append(
                {
                    "from_odp": str(row["from_odp"]),
                    "to_odp": str(row["to_odp"]),
                    "length_m": float(line.length),
                    "geometry": line,
                    "route_type_id": route_type_id,
                }
            )
            continue

        pole_points = [line.interpolate(float(d)) for d in distances]
        pole_ids = [
            f"DIST-POLE-{idx}"
            for idx in range(pole_counter, pole_counter + len(pole_points))
        ]
        pole_counter += len(pole_points)

        for d, pole_id, pt in zip(
            distances,
            pole_ids,
            pole_points,
        ):
            pole_record.append(
                {
                    "pole_id": pole_id,
                    "geometry": pt,
                    "is_waypoint": True,
                }
            )
            # Waypoint HERE (persimpangan) cukup jadi Pole; tidak dibuat JC.

        split_distances = np.concatenate(([0], distances, [line.length]))

        fromKey = str(row["from_odp"])
        toKey = str(row["to_odp"])
        for i in range(len(split_distances) - 1):
            d1 = split_distances[i]
            d2 = split_distances[i + 1]
            segment = substring(line, d1, d2)

            if i == 0:
                # segment pertama
                record = {
                    "from_odp": fromKey,
                    "to_pole": pole_ids[0] if len(pole_ids) > 0 else toKey,
                    "length_m": float(d2 - d1),
                    "geometry": segment,
                    "route_type_id": route_type_id,
                }
            elif i == len(split_distances) - 2:
                # segment terakhir
                record = {
                    "from_pole": pole_ids[-1] if len(pole_ids) > 0 else fromKey,
                    "to_odp": toKey,
                    "length_m": float(d2 - d1),
                    "geometry": segment,
                    "route_type_id": route_type_id,
                }
            else:
                # segment tengah
                record = {
                    "from_pole": pole_ids[i - 1],
                    "to_pole": pole_ids[i],
                    "length_m": float(d2 - d1),
                    "geometry": segment,
                    "route_type_id": route_type_id,
                }

            split_records.append(record)

    def make_gdf(records, columns=None):
        if records:
            return gpd.GeoDataFrame(records, geometry="geometry", crs=3857).to_crs(4326)
        data = {col: [] for col in (columns or [])}
        if "geometry" not in data:
            data["geometry"] = []
        return gpd.GeoDataFrame(
            data,
            geometry="geometry",
            crs=4326,
        )

    gdf_split = make_gdf(
        split_records,
        columns=["geometry", "from_odp", "to_odp", "from_pole", "to_pole"],
    )
    gdf_pole = make_gdf(
        pole_record,
        columns=["pole_id", "geometry"],
    )
    gdf_jc = make_gdf(
        jc_record,
        columns=["jc_id", "pole_id", "jc_type", "geometry"],
    )
    return gdf_split, gdf_pole, gdf_jc


def build_odp_rumah_lines(gdf_odp, gdf_rumah, route_type_id=5):
    logger.info("Generate ODP Rumah Line")
    odp_rumah_lines = []
    odp_index = gdf_odp.set_index("odp_id")
    for _, rumah in gdf_rumah.iterrows():
        odp_id = rumah.odp_id
        if pd.isna(odp_id) or odp_id not in odp_index.index:
            continue
        odp_geom = odp_index.loc[odp_id].geometry
        line = LineString([odp_geom, rumah.geometry])
        odp_rumah_lines.append(
            {
                "ogc_fid": rumah.ogc_fid,
                "odp_id": odp_id,
                "length_m": line.length,
                "geometry": line,
                "route_type_id": route_type_id,
            }
        )
    gdf_odp_rumah = gpd.GeoDataFrame(
        odp_rumah_lines, geometry="geometry", crs=gdf_rumah.crs
    )
    return gdf_odp_rumah


def build_odc_sub_lines_mst(
    gdf_odc,
    gdf_odc_3857,
    odc_center_idx,
    odc_center_odp_id,
    route_type_id,
):
    """
    Bangun sub line antar ODC dalam satu cluster sebagai Minimum Spanning Tree
    (Prim's algorithm) yang di-root pada ODC pusat.

    - Bobot edge memakai HERE Distance Matrix API (network distance).
      Jika API gagal -> fallback ke jarak Euclidean (EPSG:3857).
    - Tree menghubungkan SEMUA ODC tanpa loop dengan total cost minimal.
    - Edge diorientasikan dari pusat keluar, sehingga from_odp = parent ODC
      dan to_odp = child ODC (konsisten dengan arah kabel).
    - Geometri tiap edge tetap dibangun via get_route_or_straight_here
      (yang punya fallback garis lurus sendiri).

    Return:
        list[dict] record sub line (struktur sama dgn get_route_or_straight_here),
        atau [] jika cluster hanya berisi ODC pusat.
    """
    # 1) node list: semua ODC (termasuk pusat), buang yang odp_id None (kecuali pusat)
    nodes = []
    center_pos = None
    for idx, r in gdf_odc_3857.iterrows():
        odp_id = gdf_odc.loc[idx, "odp_id"]
        is_center = idx == odc_center_idx
        if odp_id is None and not is_center:
            continue

        r_4326 = gpd.GeoSeries([r.geometry], crs=3857).to_crs(4326).iloc[0]
        if is_center:
            center_pos = len(nodes)
            odp_id = odc_center_odp_id
        nodes.append(
            {
                "idx": idx,
                "odp_id": odp_id,
                "lonlat": (r_4326.x, r_4326.y),
                "xy_3857": (r.geometry.x, r.geometry.y),
            }
        )

    n = len(nodes)
    if n <= 1:
        return []
    if center_pos is None:
        center_pos = 0

    # 2) weight matrix (HERE network distance, fallback Euclidean)
    coords = [node["lonlat"] for node in nodes]
    try:
        matrix = compute_here_distance_matrix(coords)
        # simetrisasi (HERE bisa asimetris krn jalan satu arah)
        W = np.minimum(matrix, matrix.T)
    except Exception as err:
        logger.info(f"HERE matrix gagal, fallback Euclidean: {err}")
        pts = np.array([node["xy_3857"] for node in nodes], dtype=np.float64)
        W = np.linalg.norm(pts[:, None, :] - pts[None, :, :], axis=2)

    # 3) MST via Prim's, root di center_pos -> parent[] berorientasi keluar dari pusat
    INF = np.inf
    in_tree = np.zeros(n, dtype=bool)
    key = np.full(n, INF, dtype=np.float64)
    parent = np.full(n, -1, dtype=np.int64)
    key[center_pos] = 0.0

    for _ in range(n):
        u = -1
        best = INF
        for v in range(n):
            if not in_tree[v] and key[v] < best:
                best = key[v]
                u = v
        if u == -1:
            break  # node tersisa tidak terjangkau (harusnya tdk terjadi)
        in_tree[u] = True
        for v in range(n):
            if not in_tree[v] and W[u, v] < key[v]:
                key[v] = W[u, v]
                parent[v] = u

    # 4) bangun geometri tiap edge (parent -> child)
    line_sub_records = []
    for child in range(n):
        p = int(parent[child])
        if p == -1:
            continue  # root (center) atau node tak terhubung
        parent_node = nodes[p]
        child_node = nodes[child]
        record_sub = get_route_or_straight_here(
            start_lonlat=parent_node["lonlat"],
            end_lonlat=child_node["lonlat"],
            route_type_id=route_type_id,
            from_odp=parent_node["odp_id"],
            to_odp=child_node["odp_id"],
            transport_mode="pedestrian",  # atau "pedestrian"
        )
        line_sub_records.append(record_sub)

    return line_sub_records


def node_cluster_lines(
    line_parent_records,
    line_sub_records,
    gdf_odc_3857,
    gdf_odc,
    odc_center_odp_id,
    olt_site_point_id,
    route_type_id,
    grid_size=1.0,
    junction_prefix="JX",
):
    """
    Noding geometri PARENT (OLT->ODC pusat) + SUB line (MST antar ODC) satu
    cluster supaya ruas jalan yang dipakai bersama menjadi SATU segmen unik.

    Tangani 2 jenis overlap:
    - sub vs sub  (mis. X-B antara A-B dan B-D)
    - sub vs parent (sub retrace parent di dekat ODC pusat)

    Kebijakan: utamakan EDIT sub line. Ruas yang berimpit dgn parit parent
    diklaim sbg PARENT (parent tetap menutup OLT->center penuh, hanya dipecah
    di titik cabang X). Sub line yang overlap dipotong jadi X->D.

    - Snap ke grid `grid_size` (m) lalu unary_union (dissolve overlap + split).
    - Endpoint: vertex OLT -> site_from(olt_site_point_id); vertex ODC -> odp_id;
      lainnya (titik cabang) -> junction POLE pasif `f"{junction_prefix}{n}"`.
    - Junction adalah pole baru: disimpan di from_pole/to_pole & dikembalikan
      terpisah utk digabung dgn pole lain.
    - waypoints (titik manuver HERE / simpang) dihitung ulang per segmen dari
      parent+sub supaya tidak hilang.

    Return:
        (parent_records, sub_records, junction_poles)
        - junction_poles: list[dict] {pole_id, geometry} pole di tiap titik cabang.
          (Tidak ada JC di persimpangan; cukup pole.)
        Bila tidak ada yg bisa di-node (<2 geom) -> (parent asli, sub asli, []).
    """
    parent_geoms = [
        r["geometry"] for r in line_parent_records if r.get("geometry") is not None
    ]
    sub_geoms = [
        r["geometry"] for r in line_sub_records if r.get("geometry") is not None
    ]
    if len(parent_geoms) + len(sub_geoms) < 2:
        return line_parent_records, line_sub_records, []

    def grid_key(x, y):
        return (round(x / grid_size), round(y / grid_size))

    # 1) snap + union semua (parent + sub)
    snapped_parent = [set_precision(g, grid_size) for g in parent_geoms]
    snapped_sub = [set_precision(g, grid_size) for g in sub_geoms]
    merged = unary_union(snapped_parent + snapped_sub)

    if merged.is_empty:
        return line_parent_records, line_sub_records, []

    if isinstance(merged, LineString):
        segments = [merged]
    elif isinstance(merged, MultiLineString):
        segments = list(merged.geoms)
    else:
        segments = [
            g for g in getattr(merged, "geoms", []) if isinstance(g, LineString)
        ]

    segments = [s for s in segments if (not s.is_empty) and s.length > 0]
    if len(segments) == 0:
        return line_parent_records, line_sub_records, []

    # buffer parent utk klasifikasi segmen (ruas yg berimpit parent -> milik parent)
    parent_union = unary_union(snapped_parent) if snapped_parent else None
    parent_buffer = (
        parent_union.buffer(grid_size * 0.5) if parent_union is not None else None
    )

    # 2) node OLT & ODC by grid key
    olt_key = None
    if snapped_parent:
        olt_key = grid_key(*snapped_parent[0].coords[0][:2])
    olt_node_id = f"OLT_{olt_site_point_id}"

    odc_node_by_key = {}
    for idx, r in gdf_odc_3857.iterrows():
        odp_id = gdf_odc.loc[idx, "odp_id"]
        if odp_id is None:
            continue
        odc_node_by_key[grid_key(r.geometry.x, r.geometry.y)] = odp_id
    odc_ids = set(odc_node_by_key.values())

    # 2b) titik manuver HERE (simpang) dari parent + sub -> grid key
    maneuver_keys = set()
    for rec in list(line_parent_records) + list(line_sub_records):
        g = rec.get("geometry")
        wp = rec.get("waypoints") or []
        if g is None or not wp:
            continue
        coords = list(g.coords)
        for w in wp:
            if 0 <= w < len(coords):
                maneuver_keys.add(grid_key(coords[w][0], coords[w][1]))

    # 3) assign node id per endpoint
    junction_by_key = {}
    junction_geom = {}  # jid -> Point(3857)
    junction_counter = [1]

    def node_id_for(coord):
        key = grid_key(coord[0], coord[1])
        if olt_key is not None and key == olt_key:
            return olt_node_id
        if key in odc_node_by_key:
            return odc_node_by_key[key]
        if key in junction_by_key:
            return junction_by_key[key]
        jid = f"{junction_prefix}{junction_counter[0]}"
        junction_counter[0] += 1
        junction_by_key[key] = jid
        junction_geom[jid] = Point(coord[0], coord[1])
        return jid

    seg_nodes = []  # (a_id, b_id, seg, is_parent)
    adjacency = {}
    for seg in segments:
        coords = list(seg.coords)
        a_id = node_id_for(coords[0])
        b_id = node_id_for(coords[-1])
        if a_id == b_id:
            continue  # buang loop degenerate
        # is_parent = bool(parent_buffer is not None and parent_buffer.covers(seg))
        # seg_nodes.append((a_id, b_id, seg, is_parent))
        seg_nodes.append((a_id, b_id, seg))
        si = len(seg_nodes) - 1
        adjacency.setdefault(a_id, []).append((b_id, si))
        adjacency.setdefault(b_id, []).append((a_id, si))

    if len(seg_nodes) == 0:
        return line_parent_records, line_sub_records, []

    # 4) hop-distance dari pusat & dari OLT (utk orientasi from->to)
    from collections import deque

    def find_path_edges(start, target):
        visited = {start}
        prev = {}
        q = deque([start])
        while q:
            u = q.popleft()
            if u == target:
                break
            for v, seg_idx in adjacency.get(u, []):
                if v not in visited:
                    visited.add(v)
                    prev[v] = (u, seg_idx)
                    q.append(v)
        if target not in visited:
            return set()

        edge_ids = set()
        cur = target
        while cur != start:
            p, seg_idx = prev[cur]
            edge_ids.add(seg_idx)
            cur = p
        return edge_ids

    def bfs_hops(start):
        dist = {start: 0}
        q = deque([start])
        while q:
            u = q.popleft()
            for v, _ in adjacency.get(u, []):
                if v not in dist:
                    dist[v] = dist[u] + 1
                    q.append(v)
        return dist

    center_dist = bfs_hops(odc_center_odp_id)
    olt_dist = bfs_hops(olt_node_id)
    INF = float("inf")

    parent_edge_ids = find_path_edges(
        olt_node_id,
        odc_center_odp_id,
    )

    logger.info(
        f"cluster parent path edges={len(parent_edge_ids)} "
        f"olt={olt_node_id} center={odc_center_odp_id}"
    )

    def from_keys(rec, node_id):
        if node_id == olt_node_id:
            rec["site_from"] = olt_site_point_id
        elif node_id in odc_ids:
            rec["from_odp"] = node_id
        else:
            rec["from_pole"] = node_id

    def to_keys(rec, node_id):
        # if node_id == olt_node_id:
        #     rec["site_to"] = olt_site_point_id
        if node_id in odc_ids:
            rec["to_odp"] = node_id
        else:
            rec["to_pole"] = node_id

    # 5) emit record per segmen, pisah parent vs sub
    parent_records = []
    sub_records = []
    # for a_id, b_id, seg, is_parent in seg_nodes:
    for seg_idx, (a_id, b_id, seg) in enumerate(seg_nodes):
        is_parent = seg_idx in parent_edge_ids

        if is_parent:
            # orientasi OLT -> center (endpoint lebih dekat OLT jadi 'from')
            rev = not (olt_dist.get(a_id, INF) <= olt_dist.get(b_id, INF))
        else:
            # orientasi center -> luar (endpoint lebih dekat center jadi 'from')
            rev = not (center_dist.get(a_id, INF) <= center_dist.get(b_id, INF))

        if rev:
            from_id, to_id = b_id, a_id
            # from_id = node di coords[-1]; balik arah geometri supaya
            # coords[0]=from, coords[-1]=to. split_feeder mengasumsikan
            # from_pole/from_odp ada di ujung awal geometri (jarak 0), jadi arah
            # geometri HARUS konsisten dgn from->to. Tanpa ini label ujung luar
            # tertukar -> ujung route "loncat" ke junction di seberang saat snap.
            seg = LineString(list(seg.coords)[::-1])
        else:
            from_id, to_id = a_id, b_id

        seg_coords = list(seg.coords)
        seg_waypoints = [
            i
            for i in range(1, len(seg_coords) - 1)
            if grid_key(seg_coords[i][0], seg_coords[i][1]) in maneuver_keys
        ]

        rec = {
            "length_m": float(seg.length),
            "geometry": seg,
            "route_type_id": route_type_id,
            "waypoints": seg_waypoints,
            # wajib selalu ada
            "from_odp": None,
            "to_odp": None,
            "from_pole": None,
            "to_pole": None,
        }
        from_keys(rec, from_id)
        to_keys(rec, to_id)

        if is_parent:
            parent_records.append(rec)
        else:
            sub_records.append(rec)

    junction_poles = [
        {"pole_id": jid, "geometry": geom} for jid, geom in junction_geom.items()
    ]
    # titik cabang/persimpangan cukup jadi pole; tidak membuat JC di sini.
    return parent_records, sub_records, junction_poles


def select_olt_candidate(
    conn,
    lon,
    lat,
    olt_mode="site",
    tower_ids=None,
    coordinates=None,
    exclude_keys=None,
):
    """
    Pilih 1 kandidat OLT terdekat ke (lon, lat) sesuai mode, exclude key yg sudah dipakai.

    Mode:
    - "site"  : OLT eksisting dari site_points (type 1/2/3 + asset OLT type 4).
                olt_key = site_point_id.
    - "tower" : baris ftth_tower (key ogc_fid, geom EPSG:4326) dibatasi tower_ids.
                olt_key = ogc_fid.
    - "input" : koordinat dari list coordinates=[(lon,lat),...]. olt_key = index.

    Return:
        (olt_key:int, olt_geom_4326:Point) atau (None, None).
    """
    exclude = set(exclude_keys) if exclude_keys else set()

    if olt_mode == "input":
        best = None
        for idx, lonlat in enumerate(coordinates or []):
            if idx in exclude:
                continue
            clon, clat = lonlat[0], lonlat[1]
            d = (clon - lon) ** 2 + (clat - lat) ** 2
            if best is None or d < best[0]:
                best = (d, idx, (clon, clat))
        if best is None:
            return None, None
        return best[1], Point(best[2][0], best[2][1])

    with conn.cursor() as cur:
        exclude_ids = list(exclude)
        if olt_mode == "tower":
            if not tower_ids:
                return None, None
            query = f"""
            WITH p AS (
                SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS pt
            )
            SELECT t.ogc_fid, t.geom
            FROM ftth_tower t
            CROSS JOIN p
            WHERE t.ogc_fid = ANY(%s)
            {"AND NOT (t.ogc_fid = ANY(%s))" if exclude_ids else ""}
            ORDER BY p.pt <-> t.geom
            LIMIT 1;
            """
            params = [lon, lat, list(tower_ids)] + (
                [exclude_ids] if exclude_ids else []
            )
        else:  # "site"
            query = f"""
            WITH p AS (
                SELECT ST_SetSRID(ST_MakePoint(%s, %s), 4326) AS pt
            )
            SELECT sp.id, sp.geom
            FROM site_points sp
            JOIN assets a ON a.site_point_id = sp.id
            CROSS JOIN p
            WHERE sp.site_point_type_id IN (1,2,3) AND a.asset_type_id = 4
            {"AND NOT (sp.id = ANY(%s))" if exclude_ids else ""}
            ORDER BY p.pt <-> sp.geom
            LIMIT 1;
            """
            params = [lon, lat] + ([exclude_ids] if exclude_ids else [])

        cur.execute(query, params)
        row = cur.fetchone()

    if not row:
        return None, None

    olt_key, olt_geom_hex = row
    olt_geom_4326 = wkb.loads(olt_geom_hex, hex=True)
    return int(olt_key), olt_geom_4326


def find_site_olt(
    conn,
    gdf_odc,
    route_type_id=3,
    exclude_olt_ids=None,
    junction_prefix="JX",
    olt_mode="site",
    tower_ids=None,
    coordinates=None,
):
    if len(gdf_odc) == 0:
        return None, None, None, None, None, None, None, None

    # --- cari ODC pusat (medoid) ---
    gdf_odc_3857 = gdf_odc.to_crs(3857).copy()
    cluster_centroid_3857 = gdf_odc_3857.geometry.unary_union.centroid
    cluster_centroid_4326 = (
        gpd.GeoSeries([cluster_centroid_3857], crs=3857).to_crs(4326).iloc[0]
    )
    lon, lat = cluster_centroid_4326.x, cluster_centroid_4326.y

    # --- pilih OLT terdekat sesuai mode (site / tower / input) ---
    olt_site_point_id, olt_geom_4326 = select_olt_candidate(
        conn,
        lon,
        lat,
        olt_mode=olt_mode,
        tower_ids=tower_ids,
        coordinates=coordinates,
        exclude_keys=exclude_olt_ids,
    )
    # olt_key (site_point_id / ogc_fid / index) dipakai sbg key remap site_from + dedup.
    # asset eksisting tidak dipakai lagi (OLT dibuat baru di downstream).
    olt_asset_id = None

    if olt_geom_4326 is None:
        return None, None, None, None, None, None, None, None

    olt_lonlat = (olt_geom_4326.x, olt_geom_4326.y)

    # cari odc terdekat
    olt_point_3857 = gpd.GeoSeries([olt_geom_4326], crs=4326).to_crs(3857).iloc[0]
    gdf_odc_3857["dist_to_olt"] = gdf_odc_3857.geometry.distance(olt_point_3857)
    nearest_row = gdf_odc_3857.sort_values("dist_to_olt").iloc[0]
    odc_center_idx = nearest_row.name
    odc_center_odp_id = gdf_odc.loc[odc_center_idx, "odp_id"]

    # --- buat line OLT -> ODC pusat, dan ODC pusat -> ODC lain ---
    line_parent_records = []
    line_sub_records = []

    ors_client = client.Client(key=os.environ.get("ORS_KEY"))

    odc_center_geom_4326 = (
        gpd.GeoSeries([gdf_odc.loc[odc_center_idx].geometry], crs=gdf_odc.crs)
        .to_crs(4326)
        .iloc[0]
    )

    # 1) OLT -> ODC pusat
    olt_lonlat = (olt_geom_4326.x, olt_geom_4326.y)
    medoid_lonlat = (odc_center_geom_4326.x, odc_center_geom_4326.y)
    record_parent = get_route_or_straight_here(
        start_lonlat=olt_lonlat,
        end_lonlat=medoid_lonlat,
        route_type_id=route_type_id,
        site_from=int(olt_site_point_id),
        to_odp=odc_center_odp_id,
        transport_mode="car",
    )
    line_parent_records.append(record_parent)

    # 2) ODC pusat -> ODC lainnya (MST, root di ODC pusat)
    line_sub_records = build_odc_sub_lines_mst(
        gdf_odc=gdf_odc,
        gdf_odc_3857=gdf_odc_3857,
        odc_center_idx=odc_center_idx,
        odc_center_odp_id=odc_center_odp_id,
        route_type_id=route_type_id,
    )

    # edge MST (parent_odc -> child_odc) utk pembuatan kabel feeder mengikuti MST.
    # diambil SEBELUM noding (yg memecah jadi segmen pole/junction).
    mst_edges = [(rec.get("from_odp"), rec.get("to_odp")) for rec in line_sub_records]

    # 2b) noding parent + sub: ruas jalan yg dipakai bersama -> 1 segmen unik.
    #     sub line yg overlap parent dipotong; parent dipecah di titik cabang X.
    #     junction (titik cabang) dikembalikan sbg pole baru.
    line_parent_records, line_sub_records, junction_poles = node_cluster_lines(
        line_parent_records=line_parent_records,
        line_sub_records=line_sub_records,
        gdf_odc_3857=gdf_odc_3857,
        gdf_odc=gdf_odc,
        odc_center_odp_id=odc_center_odp_id,
        olt_site_point_id=int(olt_site_point_id),
        route_type_id=route_type_id,
        junction_prefix=junction_prefix,
    )

    gdf_parent_line = gpd.GeoDataFrame(
        line_parent_records, geometry="geometry", crs="EPSG:3857"
    ).to_crs(4326)
    if len(line_sub_records) > 0:
        gdf_sub_line = gpd.GeoDataFrame(
            line_sub_records, geometry="geometry", crs="EPSG:3857"
        ).to_crs(4326)
    else:
        gdf_sub_line = None

    if junction_poles:
        gdf_junction_pole = gpd.GeoDataFrame(
            junction_poles, geometry="geometry", crs="EPSG:3857"
        ).to_crs(4326)
    else:
        gdf_junction_pole = None

    return (
        olt_site_point_id,
        olt_asset_id,
        gdf_parent_line,
        gdf_sub_line,
        odc_center_odp_id,
        gdf_junction_pole,
        mst_edges,
        olt_geom_4326,
    )


def get_route_or_straight(
    client,
    start_lonlat,
    end_lonlat,
    route_type_id,
    site_from=None,
    from_odp=None,
    to_odp=None,
    route_profile="driving-car",
):
    """
    Coba ambil route dari ORS.
    Jika gagal → fallback garis lurus.
    Return: dict record (geometry 3857 + length)
    """
    try:
        coords = [start_lonlat, end_lonlat]
        route = client.directions(
            coordinates=coords,
            profile=route_profile,
            format="geojson",
        )

        geom = route["features"][0]["geometry"]
        # FORCE SNAP KE TITIK ASLI
        coords = list(geom["coordinates"])
        coords[0] = start_lonlat
        coords[-1] = end_lonlat

        line_4326 = LineString(coords)
        line_3857 = gpd.GeoSeries([line_4326], crs=4326).to_crs(3857).iloc[0]
        length_m = float(line_3857.length)

    except (
        ors_exceptions.ApiError,
        ors_exceptions.HTTPError,
        ors_exceptions.Timeout,
        IndexError,
        KeyError,
        Exception,
    ):
        # 🔁 FALLBACK GARIS LURUS
        p1 = gpd.GeoSeries([LineString([start_lonlat, end_lonlat])], crs=4326)
        line_3857 = p1.to_crs(3857).iloc[0]
        length_m = float(line_3857.length)

    record = {
        "length_m": length_m,
        "geometry": line_3857,
        "route_type_id": route_type_id,
    }

    if site_from:
        record["site_from"] = site_from
    if from_odp:
        record["from_odp"] = from_odp
    if to_odp:
        record["to_odp"] = to_odp

    return record


def get_route_or_straight_here(
    start_lonlat,
    end_lonlat,
    route_type_id,
    site_from=None,
    from_odp=None,
    to_odp=None,
    transport_mode="car",
):
    """
    Ambil route dari HERE Routing API.
    Jika gagal -> fallback garis lurus.

    start_lonlat / end_lonlat:
        (lon, lat)

    Return:
        dict record
    """

    waypoints = []
    try:
        api_key = os.environ.get("HERE_KEY")
        params = {
            "transportMode": transport_mode,
            "origin": f"{start_lonlat[1]},{start_lonlat[0]}",
            "destination": f"{end_lonlat[1]},{end_lonlat[0]}",
            "return": "summary,polyline,actions",
            "apikey": api_key,
        }

        query = urllib.parse.urlencode(params)
        url = "https://router.hereapi.com/v8/routes" f"?{query}"
        req = urllib.request.Request(
            url,
            headers={"Content-Type": "application/json"},
            method="GET",
        )

        with urllib.request.urlopen(req) as response:
            route = json.loads(response.read().decode("utf-8"))

        section = route["routes"][0]["sections"][0]
        # decode flexible polyline
        decoded = fp.decode(section["polyline"])
        # HERE decode result:
        # [(lat, lon), ...]
        seg_coords = [[lng, lat] for lat, lng in decoded]

        # ambil actions untuk waypoint (pole+jc)
        actions = section.get("actions", [])
        for idx, action in enumerate(actions):
            if idx == 0:
                continue
            if idx == len(actions) - 1:
                continue
            offset = action.get("offset")
            if offset is not None:
                waypoints.append(offset)

        # force snap ke titik asli
        seg_coords[0] = list(start_lonlat)
        seg_coords[-1] = list(end_lonlat)

        line_4326 = LineString(seg_coords)
        line_3857 = gpd.GeoSeries([line_4326], crs=4326).to_crs(3857).iloc[0]
        length_m = float(line_3857.length)

    except Exception:
        # fallback garis lurus
        line_4326 = LineString(
            [
                start_lonlat,
                end_lonlat,
            ]
        )

        line_3857 = gpd.GeoSeries([line_4326], crs=4326).to_crs(3857).iloc[0]
        length_m = float(line_3857.length)

    record = {
        "length_m": length_m,
        "geometry": line_3857,
        "route_type_id": route_type_id,
        "waypoints": waypoints,
    }

    if site_from is not None:
        record["site_from"] = site_from

    if from_odp is not None:
        record["from_odp"] = from_odp

    if to_odp is not None:
        record["to_odp"] = to_odp

    return record


def split_lines_with_jc(
    gdf_sub_line,
    jc_spacing_m=50,
    start_id=1,
    from_key="from_odp",
    to_key="to_odp",
    jc_prefix="",
):
    """
    Input:
      gdf_sub_line: GeoDataFrame (EPSG:4326) dengan kolom:
        - from_odp
        - to_odp
        - geometry (LineString)
        - route_type_id

    Output:
      gdf_jc: titik JC (EPSG:4326)
      gdf_sub_line_split: line hasil split (EPSG:4326)
    """

    # kerja di meter biar spacing akurat
    lines_3857 = gdf_sub_line.to_crs(3857).copy()

    jc_records = []
    split_records = []

    jc_counter = start_id

    for _, row in lines_3857.iterrows():
        line = row.geometry
        fromKey = str(row[from_key])
        toKey = str(row[to_key])
        route_type_id = row.get("route_type_id", None)

        if line.length <= 0:
            split_records.append(
                {
                    from_key: fromKey,
                    to_key: toKey,
                    "length_m": float(line.length),
                    "geometry": line,
                    "route_type_id": route_type_id,
                }
            )
            continue

        # jarak titik jc: 50,100,... sebelum ujung line
        # distances = np.arange(jc_spacing_m, line.length, jc_spacing_m)
        tolerance_m = 10
        distances = np.arange(
            jc_spacing_m, max(0, line.length - tolerance_m), jc_spacing_m
        )

        # kalau tidak butuh JC, line tetap masuk
        if len(distances) == 0:
            split_records.append(
                {
                    from_key: fromKey,
                    to_key: toKey,
                    "length_m": float(line.length),
                    "geometry": line,
                    "route_type_id": route_type_id,
                }
            )
            continue

        # buat titik jc
        jc_points = [line.interpolate(float(d)) for d in distances]
        jc_ids = [
            f"JC{jc_prefix}{i}" for i in range(jc_counter, jc_counter + len(jc_points))
        ]
        jc_counter += len(jc_points)

        for jc_id, pt in zip(jc_ids, jc_points):
            jc_records.append(
                {
                    "jc_id": jc_id,
                    "geometry": pt,
                }
            )

        # node chain: from -> jc1 -> jc2 -> ... -> to
        nodes = [(fromKey, line.coords[0])]
        nodes += list(zip(jc_ids, [(p.x, p.y) for p in jc_points]))
        nodes += [(toKey, line.coords[-1])]

        # bikin segmen per pasangan node
        for (id_a, xy_a), (id_b, xy_b) in zip(nodes[:-1], nodes[1:]):
            seg = LineString([xy_a, xy_b])
            split_records.append(
                {
                    from_key: id_a,
                    to_key: id_b,
                    "length_m": float(seg.length),
                    "geometry": seg,
                    "route_type_id": route_type_id,
                }
            )

    # gdf_jc = gpd.GeoDataFrame(jc_records, geometry="geometry", crs="EPSG:3857").to_crs(
    #     4326
    # )
    # gdf_sub_line_split = gpd.GeoDataFrame(
    #     split_records, geometry="geometry", crs="EPSG:3857"
    # ).to_crs(4326)
    # JC

    if len(jc_records) == 0:
        gdf_jc = gpd.GeoDataFrame(
            columns=["jc_id", "route_type_id", "geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )
    else:
        gdf_jc = gpd.GeoDataFrame(
            jc_records, geometry="geometry", crs="EPSG:3857"
        ).to_crs(4326)

    # Split line
    if len(split_records) == 0:
        gdf_sub_line_split = gpd.GeoDataFrame(
            columns=["from_odp", "to_odp", "length_m", "route_type_id", "geometry"],
            geometry="geometry",
            crs="EPSG:4326",
        )
    else:
        gdf_sub_line_split = gpd.GeoDataFrame(
            split_records, geometry="geometry", crs="EPSG:3857"
        ).to_crs(4326)

    return gdf_jc, gdf_sub_line_split


def get_waypoint_distances(line, waypoint_indexes):
    """
    Convert HERE polyline vertex offsets
    menjadi distance sepanjang line (meter).
    line harus CRS meter (3857)
    """
    coords = list(line.coords)
    if len(coords) < 2:
        return []
    cumulative = [0.0]
    for i in range(1, len(coords)):
        p1 = Point(coords[i - 1])
        p2 = Point(coords[i])
        cumulative.append(cumulative[-1] + p1.distance(p2))
    distances = []
    for idx in waypoint_indexes:
        if 0 <= idx < len(cumulative):
            distances.append(float(cumulative[idx]))
    return distances


def split_feeder(
    gdf_line,
    asset_group,
    pole_spacing_m=40,
    jc_spacing_m=3800,
    coil_spacing_m=300,
    min_tail_m=20,
    pole_counter=1,
    jc_counter=1,
    coil_counter=1,
    feeder_type="parent",
):
    split_records = []
    pole_record = []
    jc_record = []
    coil_record = []

    JC_MAP = {
        "feeder_cable_24": "jc_24",
        "feeder_cable_48": "jc_48",
        "feeder_cable_96": "jc_96",
        "feeder_cable_144": "jc_144",
        "feeder_cable_288": "jc_288",
    }

    lines_3857 = gdf_line.to_crs(3857).copy()
    for _, row in lines_3857.iterrows():
        cable_type = row.cable_type
        jc_key = JC_MAP[cable_type]
        jc_type = asset_group[jc_key]

        line = row.geometry
        # tentukan endpoint awal/akhir + key-nya.
        # untuk sub line, endpoint bisa berupa junction (pole) -> from_pole/to_pole,
        # atau ODC -> from_odp/to_odp.
        if feeder_type == "parent":
            # parent bisa terpecah di junction (X): start/end bisa berupa pole
            if pd.notna(row.get("site_from")):
                # start_key, start_val = "site_from", str(row["site_from"])
                start_key = "site_from"
                start_val = int(row["site_from"])
            else:
                start_key, start_val = "from_pole", str(row["from_pole"])
            if pd.notna(row.get("to_pole")):
                end_key, end_val = "to_pole", str(row["to_pole"])
            else:
                end_key, end_val = "to_odp", str(row["to_odp"])
        else:
            if pd.notna(row.get("from_pole")):
                start_key, start_val = "from_pole", str(row["from_pole"])
            else:
                start_key, start_val = "from_odp", str(row["from_odp"])
            if pd.notna(row.get("to_pole")):
                end_key, end_val = "to_pole", str(row["to_pole"])
            else:
                end_key, end_val = "to_odp", str(row["to_odp"])
        route_type_id = row.get("route_type_id", None)

        if line.length <= 0:
            continue

        # POLE GENERATION
        # waypoint (simpang/maneuver HERE) WAJIB jadi pole; dipakai sbg anchor.
        waypoint_indexes = row.get("waypoints", []) or []
        waypoint_distances = get_waypoint_distances(
            line,
            waypoint_indexes,
        )
        # anchor = ujung awal (0) -> tiap waypoint valid -> ujung akhir (length).
        # pole reguler 40 m dihitung ULANG relatif tiap anchor, lalu pole terakhir
        # di tiap interval di-skip bila sisa ke anchor berikutnya <= min_tail_m.
        # ini mencegah stub pendek / pole menumpuk dekat waypoint maupun endpoint
        # (titik potong dari plan_ftth_network). contoh waypoint @90 (len 160):
        # 0-40-90-130-160 (bukan 0-40-80-90-120-160).
        wp_anchors = sorted(
            d
            for d in {round(float(x), 3) for x in waypoint_distances}
            if 1 < d < line.length - 1
        )
        anchors = [0.0] + wp_anchors + [float(line.length)]
        regular_distances = []
        for a, b in zip(anchors[:-1], anchors[1:]):
            seg = np.arange(a + pole_spacing_m, b, pole_spacing_m)
            if len(seg) > 0 and (b - seg[-1]) <= min_tail_m:
                seg = seg[:-1]
            regular_distances.extend(round(float(x), 3) for x in seg)
        # gabung pole reguler + waypoint (anchor), unique + sort
        distances = np.array(
            sorted(set(regular_distances) | set(wp_anchors)),
            dtype=float,
        )
        # hindari terlalu dekat start/end
        distances = distances[(distances > 1) & (distances < line.length - 1)]

        pole_points = [line.interpolate(float(d)) for d in distances]
        waypoint_distance_set = {round(float(d), 3) for d in waypoint_distances}
        pole_ids = [
            f"FEEDER-POLE-{idx}"
            for idx in range(pole_counter, pole_counter + len(pole_points))
        ]
        pole_counter += len(pole_points)
        distance_to_pole = {}

        for d, pole_id, pt in zip(distances, pole_ids, pole_points):
            is_waypoint = round(float(d), 3) in waypoint_distance_set
            pole_record.append(
                {
                    "pole_id": pole_id,
                    "geometry": pt,
                    "is_waypoint": is_waypoint,
                }
            )
            distance_to_pole[round(float(d), 3)] = {
                "pole_id": pole_id,
                "geometry": pt,
            }

        # SPLIT LINE PER SEGMENT
        split_distances = np.concatenate(([0], distances, [line.length]))
        # rantai node: endpoint awal -> pole2 di tengah -> endpoint akhir.
        # tiap node: (is_pole, key, val). endpoint pakai start_key/end_key
        # (bisa from_odp/to_odp atau from_pole/to_pole utk junction);
        # pole di tengah selalu from_pole/to_pole.
        chain = [(start_key == "from_pole", start_key, start_val)]
        for pid in pole_ids:
            chain.append((True, None, pid))
        chain.append((end_key == "to_pole", end_key, end_val))

        for i in range(len(split_distances) - 1):
            d1 = split_distances[i]
            d2 = split_distances[i + 1]

            segment = substring(line, d1, d2)

            a_is_pole, a_key, a_val = chain[i]
            b_is_pole, b_key, b_val = chain[i + 1]

            record = {
                "length_m": float(d2 - d1),
                "geometry": segment,
                "route_type_id": route_type_id,
            }
            # sisi from
            if i == 0 and not a_is_pole:
                record[a_key] = a_val  # site_from / from_odp / from_pole(junction)
            else:
                record["from_pole"] = a_val
            # sisi to
            if i == len(split_distances) - 2 and not b_is_pole:
                record[b_key] = b_val  # to_odp / to_pole(junction)
            else:
                record["to_pole"] = b_val

            split_records.append(record)

        # JC (snap ke pole terdekat)
        jc_distances = np.arange(jc_spacing_m, line.length, jc_spacing_m)
        for d in jc_distances:
            idx = np.argmin(np.abs(distances - d))
            jc_record.append(
                {
                    "jc_id": f"FEEDER-JC-{jc_counter}",
                    "jc_type": jc_type,
                    "geometry": pole_points[idx],
                    "pole_id": pole_ids[idx],
                    "distance_target": float(d),
                    "distance_actual": float(distances[idx]),
                }
            )
            jc_counter += 1

        # Waypoint HERE (persimpangan/simpang) cukup jadi Pole; tidak dibuat JC.

        # COIL (snap ke pole terdekat)
        coil_distances = np.arange(coil_spacing_m, line.length, coil_spacing_m)
        for d in coil_distances:
            idx = np.argmin(np.abs(distances - d))
            coil_record.append(
                {
                    "coil_id": f"FEEDER-COIL-{coil_counter}",
                    "geometry": pole_points[idx],
                    "pole_id": pole_ids[idx],
                    "distance_target": float(d),
                    "distance_actual": float(distances[idx]),
                }
            )
            coil_counter += 1

    def make_gdf(records, columns=None):
        if records:
            return gpd.GeoDataFrame(records, geometry="geometry", crs=3857).to_crs(4326)
        data = {col: [] for col in (columns or [])}
        if "geometry" not in data:
            data["geometry"] = []
        return gpd.GeoDataFrame(
            data,
            geometry="geometry",
            crs=4326,
        )

    gdf_split = make_gdf(
        split_records,
        columns=["geometry"],
    )
    gdf_pole = make_gdf(
        pole_record,
        columns=["pole_id", "geometry"],
    )
    gdf_jc = make_gdf(
        jc_record,
        columns=["jc_id", "pole_id", "jc_type", "geometry"],
    )
    gdf_coil = make_gdf(
        coil_record,
        columns=["coil_id", "pole_id", "geometry"],
    )

    return gdf_split, gdf_pole, gdf_jc, gdf_coil, pole_counter, jc_counter, coil_counter


# find_routes_pgr_ksp() dihapus: pgr_KSP dijalankan tanpa filter project
# sehingga tiap panggilan memindai SELURUH tabel routes. Pencarian jalur
# kabel sekarang in-memory lewat lib.ftth_route_graph.RouteGraph.


def compute_ors_distance_matrix(
    coords, ors_client, profile="foot-walking", batch_size=50
):
    """
    coords : [(lon,lat), ...]
    return : NxN distance matrix (meter)
    """

    n = len(coords)

    full_matrix = np.zeros((n, n))

    for i in range(0, n, batch_size):
        for j in range(0, n, batch_size):

            origins = coords[i : i + batch_size]
            destinations = coords[j : j + batch_size]

            merged = origins + destinations

            sources = list(range(len(origins)))
            destinations_idx = list(range(len(origins), len(merged)))

            response = ors_client.distance_matrix(
                locations=merged,
                profile=profile,
                metrics=["distance"],
                sources=sources,
                destinations=destinations_idx,
            )

            distances = response["distances"]

            for a, row_val in enumerate(distances):
                for b, dist in enumerate(row_val):
                    full_matrix[i + a][j + b] = dist if dist else 1e9

    return full_matrix


def compute_here_distance_matrix(coords, profile="pedestrian"):
    """
    coords : [(lon, lat), ...]
    return : NxN matrix (meter)
    """
    api_key = os.environ.get("HERE_KEY")
    url = f"https://matrix.router.hereapi.com/v8/matrix?async=false&apiKey={api_key}"

    origins = [{"lat": lat, "lng": lon} for lon, lat in coords]
    destinations = [{"lat": lat, "lng": lon} for lon, lat in coords]

    payload = {
        "origins": origins,
        "destinations": destinations,
        "regionDefinition": {"type": "world"},
        "profile": profile,
        "matrixAttributes": ["distances"],
    }

    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=300) as response:
        result = json.loads(response.read().decode())

    if "matrix" not in result:
        logger.info("HERE MATRIX ERROR RESPONSE:")
        logger.info(json.dumps(result, indent=2))
        raise RuntimeError("HERE Matrix API failed")

    distances = result["matrix"]["distances"]

    n = len(coords)

    matrix = np.array(distances, dtype=np.float64).reshape(n, n)

    # replace invalid routes
    matrix[matrix < 0] = 1e9

    return matrix


##### FUNCTION #####
