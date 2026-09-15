--EXPLAIN ANALYZE
WITH tower_buffer AS (
  SELECT
    sp.id AS tower_id, sp.code, sp.name, sp.owner,
    ST_Buffer(sp.geom::geography, 500)::geometry AS geom
  FROM site_points sp
  INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
  INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
  WHERE spt.name = 'Tower' AND ac.city = 'KOTA CIMAHI'
), pairwise_intersect AS (
  SELECT
    a.tower_id AS t1, b.tower_id AS t2,
    ST_Intersection(a.geom, b.geom) AS geom_intersect
  FROM tower_buffer a
  INNER JOIN tower_buffer b ON a.tower_id < b.tower_id
  AND ST_Intersects(a.geom, b.geom)
), tower_fp_raw AS (
  SELECT tb.tower_id, COUNT(DISTINCT f.ogc_fid) AS fp_count
  FROM tower_buffer tb
  LEFT JOIN sp_data_footprint f ON f.geom && tb.geom
  AND ST_Intersects(f.geom, tb.geom)
  GROUP BY tb.tower_id
), losers_to_cut AS (
  SELECT DISTINCT
    CASE 
      WHEN t1.fp_count > t2.fp_count THEN t2.tower_id
      WHEN t2.fp_count > t1.fp_count THEN t1.tower_id
      ELSE LEAST(t1.tower_id, t2.tower_id)
    END AS tower_id,
    ST_Union(p.geom_intersect) AS geom_to_cut
  FROM pairwise_intersect p
  INNER JOIN tower_fp_raw t1 ON p.t1 = t1.tower_id
  INNER JOIN tower_fp_raw t2 ON p.t2 = t2.tower_id
  GROUP BY CASE 
    WHEN t1.fp_count > t2.fp_count THEN t2.tower_id
    WHEN t2.fp_count > t1.fp_count THEN t1.tower_id
    ELSE LEAST(t1.tower_id, t2.tower_id)
  END
), tower_final AS (
  SELECT
    t.tower_id, t.code, t.name, t.owner,
    CASE 
      WHEN l.geom_to_cut IS NOT NULL THEN 
        ST_Difference(t.geom, ST_MakeValid(l.geom_to_cut))
      ELSE t.geom
    END AS geom
  FROM tower_buffer t
  LEFT JOIN losers_to_cut l ON t.tower_id = l.tower_id
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
  LEFT JOIN sp_data_footprint f ON f.geom && t.geom
  AND ST_Intersects(f.geom, t.geom)
  WHERE f.hs_class IS NOT NULL
  GROUP BY t.tower_id, hs_class
), summary_final AS (
	SELECT 
	  tower_id,
	  jsonb_object_agg(hs_class, fp_count ORDER BY hs_class) AS hs_summary,
	  SUM(fp_count) AS total
	FROM tower_hs_summary_raw
	GROUP BY tower_id
) SELECT jsonb_build_object(
    'type', 'FeatureCollection',
    'features', jsonb_agg(jsonb_build_object(
      'type', 'Feature',
      'geometry', ST_AsGeoJSON(t.geom)::jsonb,
      'properties', jsonb_build_object(
        'id', t.tower_id,
        'code', t.code,
        'name', t.name,
        'owner', t.owner,
        'fp_by_hs_class', s.hs_summary,
        'final_footprint_count', s.total
    )))) AS geojson
FROM tower_final t
LEFT JOIN summary_final s ON t.tower_id = s.tower_id;