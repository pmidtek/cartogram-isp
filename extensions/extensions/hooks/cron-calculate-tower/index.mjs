export default ({ schedule }, { database, logger }) => {
  schedule("0 */1 * * *", async () => {
    // schedule("46 11 * * *", async () => {
    try {
      logger.info("updating summary tower per province");
      await database.raw(`
        WITH data_count AS (
          SELECT sp.owner, ac.province_id, COUNT(sp.id) AS tower_count
          FROM site_points sp
          INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id AND spt.name = 'Tower'
          INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
          GROUP BY sp.owner, ac.province_id
        ),
        data_agg AS (
          SELECT
            province_id, SUM(tower_count) AS total_tower,
            jsonb_agg(jsonb_build_object('owner', owner, 'count', tower_count)ORDER BY tower_count DESC) AS tower_detail
          FROM data_count
          GROUP BY province_id
        )
        UPDATE area_provinces ap
        SET 
          tower_count = agg.total_tower,
          tower_count_detail = agg.tower_detail,
          tower_count_last_updated = NOW()
        FROM data_agg agg
        WHERE ap.province_id = agg.province_id;`);
      logger.info("updated summary tower per province");
      logger.info("updating summary tower per city");
      await database.raw(`
        WITH data_count AS (
          SELECT sp.owner, ac.city_id, COUNT(sp.id) AS tower_count
          FROM site_points sp
          INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id AND spt.name = 'Tower'
          INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
          GROUP BY sp.owner, ac.city_id
        ),
        data_agg AS (
          SELECT
            city_id, SUM(tower_count) AS total_tower,
            jsonb_agg(jsonb_build_object('owner', owner, 'count', tower_count)ORDER BY tower_count DESC) AS tower_detail
          FROM data_count
          GROUP BY city_id
        )
        UPDATE area_cities ac
        SET 
          tower_count = agg.total_tower,
          tower_count_detail = agg.tower_detail,
          tower_count_last_updated = NOW()
        FROM data_agg agg
        WHERE ac.city_id = agg.city_id;`);
      logger.info("updated summary tower per city");
    } catch (error) {
      logger.error(error, "Error in scheduled for counting tower data");
    }
  });
};
