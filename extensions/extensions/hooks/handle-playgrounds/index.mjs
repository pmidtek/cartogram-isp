export default ({ filter }, { database, services, getSchema, logger }) => {
  const { ItemsService } = services;
  const userAreaData = async (accountability) => {
    try {
      const usersService = new ItemsService("directus_users", {
        schema: await getSchema(),
        knex: database,
      });
      const userMe = await usersService.readOne(accountability.user, {
        fields: [
          "id",
          "role.admin_access",
          "role.role_type",
          "area_province.province_id",
          "area_city.city_id",
        ],
      });
      const admin_access = userMe.role.admin_access;
      const role_type = userMe.role.role_type;
      let province;
      let city;
      if (!admin_access && role_type == "province") {
        province = userMe.area_province?.province_id;
      } else if (!admin_access && role_type == "city") {
        province = userMe.area_province?.province_id;
        city = userMe.area_city?.city_id;
      }
      return { province: province, city: city };
    } catch (error) {
      logger.error(error);
      throw error;
    }
  };
  filter("playgrounds.items.read", async (payload) => {
    const result = [];
    for (const item of payload) {
      if (item.cities && item.provinces) {
        try {
          const dataId = item.id;
          let queryProvinces = `
            SELECT
                p.id,
                jsonb_agg(DISTINCT jsonb_build_object(
                  'key', elem->>'key',
                  'value', ap.province
                )) AS provinces
            FROM playgrounds p
            CROSS JOIN LATERAL jsonb_array_elements(p.provinces::jsonb) elem
            LEFT JOIN area_provinces ap ON ap.province_id = (elem->>'key')
            WHERE p.id = ?
            GROUP BY p.id;`;
          let queryCities = `
            SELECT
                p.id,
                jsonb_agg(jsonb_build_object(
                  'key', elem->>'key',
                  'value', ac.city
                )) AS cities
            FROM playgrounds p
            CROSS JOIN LATERAL jsonb_array_elements(p.cities::jsonb) elem
            LEFT JOIN area_cities ac ON ac.city_id = (elem->>'key')
            WHERE p.id = ?
            GROUP BY p.id;`;

          const { rows: citiesResult } = await database.raw(queryCities, [
            dataId,
          ]);
          const { rows: provincesResult } = await database.raw(queryProvinces, [
            dataId,
          ]);

          if (provincesResult.length) {
            item.provinces = provincesResult[0].provinces;
          }
          if (citiesResult.length) {
            item.cities = citiesResult[0].cities;
          }
          result.push(item);
        } catch (error) {
          logger.error(error);
          result.push(item);
        }
      } else if (item.provinces) {
        try {
          const dataId = item.id;
          let queryProvinces = `
            SELECT
                p.id,
                jsonb_agg(DISTINCT jsonb_build_object(
                  'key', elem->>'key',
                  'value', ap.province
                )) AS provinces
            FROM playgrounds p
            CROSS JOIN LATERAL jsonb_array_elements(p.provinces::jsonb) elem
            LEFT JOIN area_provinces ap ON ap.province_id = (elem->>'key')
            WHERE p.id = ?
            GROUP BY p.id;`;

          const { rows: provincesResult } = await database.raw(queryProvinces, [
            dataId,
          ]);

          if (provincesResult.length) {
            item.provinces = provincesResult[0].provinces;
          }
          result.push(item);
        } catch (error) {
          logger.error(error);
          result.push(item);
        }
      } else {
        result.push(item);
      }
    }
    return result.length ? result : payload;
  });
  filter("map.items.read", async (payload, {}, { accountability }) => {
    const result = [];
    let province_id;
    let city_id;
    try {
      const { province, city } = await userAreaData(accountability);
      if (province) province_id = province;
      if (city) city_id = city;
    } catch {}

    for (const item of payload) {
      if (city_id) {
        const areaService = new ItemsService("area_cities", {
          schema: await getSchema(),
          knex: database,
        });
        const area = await areaService.readByQuery({
          fields: ["bbox"],
          filter: { city_id: { _eq: city_id } },
        });
        const newBbox = area[0].bbox;
        if (newBbox) item.initial_map_view = newBbox;
      } else if (province_id) {
        const areaService = new ItemsService("area_provinces", {
          schema: await getSchema(),
          knex: database,
        });
        const area = await areaService.readByQuery({
          fields: ["bbox"],
          filter: { province_id: { _eq: province_id } },
        });
        const newBbox = area[0].bbox;
        if (newBbox) item.initial_map_view = newBbox;
      }
      result.push(item);
    }
    return result.length ? result : payload;
  });
};
