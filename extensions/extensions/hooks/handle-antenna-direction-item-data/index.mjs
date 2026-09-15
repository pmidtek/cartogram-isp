export default ({ action }, { database, services, getSchema, logger }) => {
  const SECTOR_GEOM_FIELDS = [
    "s1_azimuth",
    "s1_beam_width",
    "s2_azimuth",
    "s2_beam_width",
    "s3_azimuth",
    "s3_beam_width",
  ];
  action("antenna_direction_item.items.update", async ({ payload, keys }) => {
    try {
      // 1. hanya recompute jika ada perubahan geometri sector (azimuth/beam_width)
      const touchedSector = SECTOR_GEOM_FIELDS.some((f) => f in payload);
      if (!touchedSector) return;
      if (!keys || keys.length === 0) return;
      logger.info(
        `antenna_direction_item footprint count triggered for keys: ${keys.join(
          ", "
        )}`
      );

      const placeholders = keys.map(() => "?").join(", ");

      // 2-6. Selaraskan dgn manager/python/tasks/fwa/antenna_direction.py (acuan):
      //   buffer lingkaran penuh -> intersect sp_data_footprint -> azimuth centroid
      //   tiap footprint dari tower -> uji keanggotaan arc beam (az +- bw/2).
      //   Luas coverage = analitik 0.5 * r^2 * radians(bw). hs_class NULL dikecualikan.
      //   (Hook pakai azimuth eksak, TANPA binning 10 derajat seperti python.)
      // database.raw UPDATE tidak memicu ulang action hook -> tidak ada loop.
      await database.raw(
        `WITH items AS (
            SELECT item.id AS item_id, item.geom, main.radius_m,
                   ST_Buffer(item.geom::geography, main.radius_m)::geometry AS buf
            FROM antenna_direction_item item
            INNER JOIN antenna_direction main ON main.id = item.antenna_direction_id
            WHERE item.id IN (${placeholders})
              AND main.radius_m IS NOT NULL
        ), fp AS (
            -- azimuth (derajat) tiap footprint dari tower, dihitung sekali per item
            SELECT i.item_id, f.ogc_fid, f.hs_class,
              degrees(
                ST_Azimuth(i.geom::geography, ST_Centroid(f.geom)::geography)
              ) AS az
            FROM items i
            JOIN sp_data_footprint f
              ON i.buf && f.geom AND ST_Intersects(i.buf, f.geom)
            WHERE f.hs_class IS NOT NULL
        ), sectors AS (
            SELECT item.id AS item_id, s.sector_no, s.azimuth, s.beam_width
            FROM antenna_direction_item item
            CROSS JOIN LATERAL (VALUES
              (1, item.s1_azimuth, item.s1_beam_width),
              (2, item.s2_azimuth, item.s2_beam_width),
              (3, item.s3_azimuth, item.s3_beam_width)
            ) AS s(sector_no, azimuth, beam_width)
            WHERE item.id IN (${placeholders})
              AND s.azimuth IS NOT NULL
              AND s.beam_width IS NOT NULL
        ), sector_fp AS (
            -- circ_in_arc: abs(((az - center + 180) mod 360) - 180) <= bw/2
            SELECT s.item_id, s.sector_no, fp.ogc_fid, fp.hs_class
            FROM sectors s
            JOIN fp ON fp.item_id = s.item_id
            WHERE abs(
                    mod(mod((fp.az - s.azimuth + 180)::numeric, 360) + 360, 360) - 180
                  ) <= s.beam_width / 2.0
        ), stats AS (
            SELECT item_id, sector_no,
              COUNT(DISTINCT ogc_fid) AS cnt,
              jsonb_build_object(
                'high', COUNT(DISTINCT ogc_fid) FILTER (WHERE hs_class = 'A'),
                'mid', COUNT(DISTINCT ogc_fid) FILTER (WHERE hs_class = 'B'),
                'low', COUNT(DISTINCT ogc_fid) FILTER (WHERE hs_class = 'C'),
                'very_low', COUNT(DISTINCT ogc_fid) FILTER (WHERE hs_class = 'C1'),
                'non_residential', COUNT(DISTINCT ogc_fid)
                  FILTER (WHERE hs_class NOT IN ('A', 'B', 'C', 'C1'))
              ) AS details
            FROM sector_fp
            GROUP BY item_id, sector_no
        ), sector_stats AS (
            -- semua sektor valid disertakan (sektor tanpa footprint -> count 0)
            SELECT s.item_id, s.sector_no,
              round((0.5 * i.radius_m * i.radius_m * radians(s.beam_width))::numeric, 2) AS area_m2,
              COALESCE(st.cnt, 0) AS cnt,
              COALESCE(
                st.details,
                jsonb_build_object(
                  'high', 0, 'mid', 0, 'low', 0, 'very_low', 0, 'non_residential', 0
                )
              ) AS details
            FROM sectors s
            JOIN items i ON i.item_id = s.item_id
            LEFT JOIN stats st
              ON st.item_id = s.item_id AND st.sector_no = s.sector_no
        ), pivot AS (
            SELECT item_id,
              MAX(cnt) FILTER (WHERE sector_no = 1) AS s1,
              MAX(cnt) FILTER (WHERE sector_no = 2) AS s2,
              MAX(cnt) FILTER (WHERE sector_no = 3) AS s3,
              MAX(area_m2) FILTER (WHERE sector_no = 1) AS s1_area,
              MAX(area_m2) FILTER (WHERE sector_no = 2) AS s2_area,
              MAX(area_m2) FILTER (WHERE sector_no = 3) AS s3_area,
              (array_agg(details) FILTER (WHERE sector_no = 1))[1] AS s1_det,
              (array_agg(details) FILTER (WHERE sector_no = 2))[1] AS s2_det,
              (array_agg(details) FILTER (WHERE sector_no = 3))[1] AS s3_det
            FROM sector_stats
            GROUP BY item_id
        )
        UPDATE antenna_direction_item item
        SET s1_footprint_count = pivot.s1,
            s2_footprint_count = pivot.s2,
            s3_footprint_count = pivot.s3,
            s1_coverage_area_m2 = pivot.s1_area,
            s2_coverage_area_m2 = pivot.s2_area,
            s3_coverage_area_m2 = pivot.s3_area,
            s1_footprint_details = pivot.s1_det,
            s2_footprint_details = pivot.s2_det,
            s3_footprint_details = pivot.s3_det
        FROM pivot
        WHERE item.id = pivot.item_id;`,
        [...keys, ...keys]
      );

      logger.info(
        `antenna_direction_item footprint count updated for keys: ${keys.join(
          ", "
        )}`
      );
    } catch (error) {
      logger.error(
        error,
        "Error updating antenna_direction_item footprint count"
      );
    }
  });
};
