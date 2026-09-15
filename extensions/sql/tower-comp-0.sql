WITH tower_buffer AS (
    SELECT sp.id AS tower_id, ST_Buffer(sp.geom::geography, 500)::geometry AS geom
    FROM site_points sp
    INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
    INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
    WHERE spt.name='Tower' AND ac.city=?
), pairwise_intersect AS (
    SELECT
        LEAST(a.tower_id, b.tower_id) AS t1,
        GREATEST(a.tower_id, b.tower_id) AS t2,
        ST_Intersection(a.geom, b.geom) AS geom
    FROM tower_buffer a
    INNER JOIN tower_buffer b ON a.tower_id < b.tower_id
    AND ST_Intersects(a.geom, b.geom)
), all_areas AS (
    SELECT tower_id, geom FROM tower_buffer
    UNION ALL
    SELECT t1 AS tower_id, geom FROM pairwise_intersect
    UNION ALL
    SELECT t2 AS tower_id, geom FROM pairwise_intersect
), tower_fp_raw AS (
    SELECT a.tower_id, COUNT(DISTINCT f.ogc_fid) AS fp_count
    FROM all_areas a
    INNER JOIN sp_data_footprint f ON ST_Intersects(f.geom, a.geom)
    GROUP BY a.tower_id
), winner_per_overlap AS (
    SELECT
    i.t1, i.t2,
    CASE
        WHEN t1.fp_count > t2.fp_count THEN t1.tower_id
        WHEN t2.fp_count > t1.fp_count THEN t2.tower_id
        ELSE LEAST(t1.tower_id, t2.tower_id)
    END AS winner
    FROM pairwise_intersect i
    INNER JOIN tower_fp_raw t1 ON t1.tower_id = i.t1
    INNER JOIN tower_fp_raw t2 ON t2.tower_id = i.t2
), tower_final AS (
    SELECT
    t.tower_id,
    CASE WHEN EXISTS (
        SELECT 1 FROM winner_per_overlap w
        WHERE (w.t1 = t.tower_id OR w.t2 = t.tower_id)
        AND w.winner <> t.tower_id
    ) THEN (
        SELECT ST_Difference(t.geom, ST_Union(wi.geom))
        FROM pairwise_intersect wi
        INNER JOIN winner_per_overlap w ON ((wi.t1 = w.t1 AND wi.t2 = w.t2) OR (wi.t1 = w.t2 AND wi.t2 = w.t1))
        AND w.winner <> t.tower_id
    ) ELSE t.geom END AS geom
    FROM tower_buffer t
), tower_final_count AS (
    SELECT t.tower_id, COUNT(DISTINCT f.ogc_fid) AS final_footprint_count
    FROM tower_final t
    LEFT JOIN sp_data_footprint f ON ST_Intersects(f.geom, t.geom)
    GROUP BY t.tower_id
), tower_hs_summary_raw AS (
    SELECT
    t.tower_id,
    CASE
        WHEN f.hs_class = 'A' THEN 'high'
        WHEN f.hs_class = 'B' THEN 'mid'
        WHEN f.hs_class = 'C' THEN 'low'
        WHEN f.hs_class = 'C1' THEN 'very_low'
        WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
        ELSE f.hs_class
    END AS hs_class,
    COUNT(DISTINCT f.ogc_fid) AS fp_count
    FROM tower_final t
    LEFT JOIN sp_data_footprint f ON ST_Intersects(f.geom, t.geom)
    WHERE f.hs_class IS NOT NULL
    GROUP BY t.tower_id, f.hs_class
), tower_hs_summary AS (
    SELECT tf.tower_id, COALESCE(jsonb_object_agg(r.hs_class, r.fp_count) FILTER (WHERE r.hs_class IS NOT NULL),'{}'::jsonb) AS fp_by_hs_class
    FROM tower_final tf
    LEFT JOIN tower_hs_summary_raw r ON tf.tower_id = r.tower_id
    GROUP BY tf.tower_id
), tower_final_result AS (
    SELECT
    sp.id, sp.code, sp.name, sp.owner,
    t.geom,
    c.final_footprint_count,
    h.fp_by_hs_class
    FROM tower_final t
    INNER JOIN site_points sp ON sp.id = t.tower_id
    LEFT JOIN tower_final_count c ON c.tower_id = t.tower_id
    LEFT JOIN tower_hs_summary h ON h.tower_id = t.tower_id
) SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', jsonb_agg(jsonb_build_object(
        'type', 'Feature',
        'geometry', ST_AsGeoJSON(t.geom)::jsonb,
        'properties', to_jsonb(t) - 'geom'
    ))) AS geojson
    FROM tower_final_result t;