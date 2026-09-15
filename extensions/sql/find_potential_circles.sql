CREATE OR REPLACE FUNCTION find_potential_circles(
  geojson_input jsonb,
  min_radius float DEFAULT 200
)
RETURNS jsonb AS $$
DECLARE
    current_geom geometry;
    circle_center geometry;
    circle_radius float;
    circle_geom geometry;
    circles jsonb := '[]'::jsonb;
    i int := 1;
BEGIN
    -- Ambil dan ubah polygon dari GeoJSON ke geometry (EPSG:3857)
    SELECT ST_Union(
             ST_Transform(
               ST_SetSRID(ST_GeomFromGeoJSON(feature->>'geometry'),4326),
             3857)
           )
    INTO current_geom
    FROM jsonb_array_elements(geojson_input) AS feature;

    LOOP
        -- Cari lingkaran terbesar di dalam polygon saat ini
        SELECT (ST_MaximumInscribedCircle(current_geom)).center,
               (ST_MaximumInscribedCircle(current_geom)).radius
        INTO circle_center, circle_radius;

        -- Jika radius terlalu kecil, berhenti
        IF circle_radius IS NULL OR circle_radius < min_radius THEN
            EXIT;
        END IF;

        -- Buat lingkaran dari hasil tersebut
        SELECT ST_Buffer(circle_center, circle_radius) INTO circle_geom;

        -- Simpan lingkaran ke koleksi dalam bentuk GeoJSON Feature
        circles := circles || jsonb_build_object(
            'type','Feature',
            'geometry', ST_AsGeoJSON(ST_Transform(circle_geom,4326))::jsonb,
            'properties', jsonb_build_object('radius_m', circle_radius)
        );

        -- Kurangi polygon dengan area lingkaran
        SELECT ST_Difference(current_geom, circle_geom) INTO current_geom;

        i := i + 1;
        -- Hindari loop tak berujung
        IF i > 50 THEN
            EXIT;
        END IF;
    END LOOP;

    -- Kembalikan FeatureCollection
    RETURN jsonb_build_object(
        'type','FeatureCollection',
        'features', circles
    );
END;
$$ LANGUAGE plpgsql;
