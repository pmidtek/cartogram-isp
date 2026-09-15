import {
  ServiceUnavailableError,
  ForbiddenError,
  InvalidPayloadError,
} from "@directus/errors";

import { isNotEmptyObject } from "../mvt/index.mjs";

function isValidString(input) {
  const regex = /^[a-zA-Z0-9_ ]*$/;
  return regex.test(input);
}

function buildWhere(rest) {
  return isNotEmptyObject(rest)
    ? "WHERE " +
        Object.keys(rest)
          .map((key) => `main.${key} = '${rest[key]}'`)
          .join(" AND ")
    : "";
}

export default (router, { database, services, logger }) => {
  const { ItemsService } = services;
  const userAreaData = async (accountability, schema) => {
    try {
      const usersService = new ItemsService("directus_users", {
        accountability: accountability,
        schema: schema,
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

  router.post("/count/kab/:dataType", async (req, res, next) => {
    if (!req.accountability.user) {
      return next(new ForbiddenError());
    }
    const { nmkab } = req.body;
    const { dataType } = req.params;

    let colsQuery, tableView;

    if (dataType === "footprint_grade") {
      colsQuery = "grade as class_ts";
      tableView = "view_footprint_grade_all";
    } else if (dataType === "house_class") {
      colsQuery = "hs_class as class_ts";
      tableView = "view_hs_classs_all";
    } else if (dataType === "carport") {
      colsQuery = "carport as class_ts";
      tableView = "view_carport_all";
    } else if (dataType === "energy") {
      colsQuery = ` CASE
                      WHEN voltage::integer >= 3300 THEN '>=3300'
                      ELSE voltage::text
                    END as class_ts `;
      tableView = "view_energy_all";
    } else if (dataType === "house_price") {
      colsQuery = ` hs_pz_rng as class_ts `;
      tableView = "view_house_price_all";
    } else if (dataType === "road_type") {
      colsQuery = ` CASE
                      WHEN paved = 'Y' THEN 'Paved'
                      WHEN paved = 'Unpaved' THEN 'Unpaved'
                      ELSE paved
                    END as class_ts`;
      tableView = "view_road_type_all";
    } else {
      return next(
        new InvalidPayloadError({
          reason: "Wrong dataType",
        })
      );
    }

    if (!nmkab) {
      try {
        const { rows } = await database.raw(`SELECT * FROM ${tableView}`);

        return res.json(rows);
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "chart-analysis",
            reason: "Failed to get chart",
          })
        );
      }
    }
    let layer_name;
    let queryString;
    let rest = {};
    try {
      const { rows } = await database.raw(
        "SELECT layer_name FROM cities WHERE name = ?",
        nmkab
      );
      if (!rows[0]) {
        return next(
          new ForbiddenError({
            reason: "Wrong nmkab data",
          })
        );
      }
      [layer_name, queryString] = rows[0].layer_name.split("?");
      if (queryString) {
        queryString.split("&").forEach((pair) => {
          let [key, value] = pair.split("=");
          rest[key] = value;
        });
      }
    } catch (error) {
      logger.error(error);
    }

    try {
      const { rows } =
        await database.raw(`SELECT ${colsQuery}, count(*) FROM ${layer_name} main
                    ${buildWhere(rest)}
                    GROUP BY 1 ORDER BY 2 DESC `);

      return res.json(rows);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "chart-analysis",
          reason: "Failed to get chart",
        })
      );
    }
  });

  router.post("/count/digitize/:dataType", async (req, res, next) => {
    if (!req.accountability.user) {
      return next(new ForbiddenError());
    }
    const { area } = req.body;
    const { dataType } = req.params;

    let colsQuery;

    if (dataType === "footprint_grade") {
      colsQuery = "grade as class_ts";
    } else if (dataType === "house_class") {
      colsQuery = "hs_class as class_ts";
    } else if (dataType === "carport") {
      colsQuery = "carport as class_ts";
    } else if (dataType === "energy") {
      colsQuery = ` CASE
                      WHEN voltage::integer >= 3300 THEN '>=3300'
                      ELSE voltage::text
                    END as class_ts `;
    } else if (dataType === "house_price") {
      colsQuery = ` hs_pz_rng as class_ts `;
    } else if (dataType === "road_type") {
      colsQuery = ` CASE
                      WHEN paved = 'Y' THEN 'Paved'
                      WHEN paved = 'Unpaved' THEN 'Unpaved'
                      ELSE paved
                    END as class_ts`;
    } else {
      return next(
        new InvalidPayloadError({
          reason: "Wrong dataType",
        })
      );
    }

    if (!area) {
      return next(
        new InvalidPayloadError({
          reason: "Body area data is invalid; area variable can not null!",
        })
      );
    } else if (typeof area !== "object") {
      return next(
        new InvalidPayloadError({
          reason: "Body area data is invalid; area variable must be geojson!",
        })
      );
    }

    // let query = `
    // WITH polygon_area AS (
    // SELECT ST_GeomFromGeoJSON('${JSON.stringify(area)}') AS geom
    // )
    // SELECT class_ts, SUM(count) AS count
    // FROM (
    // `;

    let query = `
    WITH polygon_area AS (
    SELECT ST_GeomFromGeoJSON('${JSON.stringify(area)}') AS geom
    )
    SELECT ${colsQuery}, count(*) AS count
    FROM sp_data_footprint main, polygon_area
    WHERE main.geom && polygon_area.geom
    AND ST_Intersects(main.geom, polygon_area.geom)
    GROUP BY 1
    ORDER BY 2 DESC ;
    `;

    // let layer_name;
    // try {
    //   const { rows } = await database.raw(
    //     `SELECT distinct layer_name FROM cities WHERE ST_Intersects(union_area, (SELECT ST_GeomFromGeoJSON('${JSON.stringify(
    //       area
    //     )}')))`
    //   );
    //   if (!rows[0]) {
    //     return next(
    //       new ForbiddenError({
    //         reason: "Wrong area data",
    //       })
    //     );
    //   }
    //   rows.forEach((row, index) => {
    //     query += `
    //       SELECT ${colsQuery}, count(*) AS count
    //       FROM ${row.layer_name}, polygon_area
    //       WHERE ${row.layer_name}.geom && polygon_area.geom
    //       AND ST_Intersects(${row.layer_name}.geom, polygon_area.geom)
    //       GROUP BY 1
    //     `;

    //     // Add UNION ALL between SELECT statements, except after the last one
    //     if (index < rows.length - 1) {
    //       query += "UNION ALL\n";
    //     }
    //   });
    //   layer_name = rows[0].layer_name;
    // } catch (error) {
    //   logger.error(error);
    // }

    // query += `
    // ) AS combined_results
    // GROUP BY 1;
    // `;

    try {
      const { rows } = await database.raw(query);
      return res.json(rows);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "chart-analysis",
          reason: "Failed to get chart",
        })
      );
    }
  });

  router.post("/count/layer/:dataType", async (req, res, next) => {
    if (!req.accountability.user) {
      return next(new ForbiddenError());
    }
    const { layer, ogcFids } = req.body;
    const { dataType } = req.params;

    let colsQuery;
    if (ogcFids && !Array.isArray(ogcFids)) {
      return next(
        new InvalidPayloadError({
          reason: "ogcFids must be an array!",
        })
      );
    }

    if (dataType === "footprint_grade") {
      colsQuery = "grade as class_ts";
    } else if (dataType === "house_class") {
      colsQuery = "hs_class as class_ts";
    } else if (dataType === "carport") {
      colsQuery = "carport as class_ts";
    } else if (dataType === "energy") {
      colsQuery = ` CASE
                      WHEN voltage::integer >= 3300 THEN '>=3300'
                      ELSE voltage::text
                    END as class_ts `;
    } else if (dataType === "house_price") {
      colsQuery = ` hs_pz_rng as class_ts `;
    } else if (dataType === "road_type") {
      colsQuery = ` CASE
                      WHEN paved = 'Y' THEN 'Paved'
                      WHEN paved = 'Unpaved' THEN 'Unpaved'
                      ELSE paved
                    END as class_ts`;
    } else {
      return next(
        new InvalidPayloadError({
          reason: "Wrong dataType",
        })
      );
    }

    if (!layer) {
      return next(
        new InvalidPayloadError({
          reason: "Body layer data is invalid; layer variable can not null!",
        })
      );
    } else {
      try {
        const {
          rows: [{ exists }],
        } = await database.raw(
          "SELECT EXISTS(SELECT 1 FROM vector_tiles WHERE layer_name = ?)",
          layer
        );
        if (!exists) {
          return next(
            new InvalidPayloadError({
              reason:
                "Body layer data is invalid; layer variable must be a layer from vector tiles collection!",
            })
          );
        }
      } catch (error) {
        logger.error(error);
        return next(
          new InvalidPayloadError({
            reason: "Body layer data is invalid!",
          })
        );
      }
    }

    // let query = `
    // WITH polygon_area AS (
    // SELECT ST_Union(geom) as geom from ${layer}
    // )
    // SELECT class_ts, SUM(count) AS count
    // FROM (
    // `;

    let rest = {};
    let [layer_name, queryString] = layer.split("?");
    if (queryString) {
      queryString.split("&").forEach((pair) => {
        let [key, value] = pair.split("=");
        rest[key] = value;
      });
    }
    // Determine the prefix based on whether 'rest' is empty
    const prefix = isNotEmptyObject(rest) ? "AND" : "WHERE";

    // Convert ogcFids to SQL filter if it's a valid non-empty array
    let ogcFidsFilter = "";
    if (ogcFids && ogcFids.length > 0) {
      const sanitizedIds = ogcFids
        .map((id) => parseInt(id, 10))
        .filter((id) => !isNaN(id));

      if (sanitizedIds.length > 0) {
        ogcFidsFilter = `${prefix} ogc_fid IN (${sanitizedIds.join(", ")})`;
      }
    }

    let query = `
    WITH polygon_area AS (
      SELECT ST_Union(geom) as geom from ${layer_name} main
      ${buildWhere(rest)}
      ${ogcFidsFilter}
    )
    SELECT ${colsQuery}, count(*) AS count
    FROM sp_data_footprint main, polygon_area
    WHERE main.geom && polygon_area.geom
    AND ST_Intersects(main.geom, polygon_area.geom)
    GROUP BY 1
    ORDER BY 2 DESC ;
    `;

    // let layer_name;
    // try {
    //   const { rows } = await database.raw(
    //     `
    //     WITH polygon_area AS (
    //     SELECT geom from ${layer}
    //     )
    //     SELECT distinct layer_name FROM cities, polygon_area
    //     WHERE ST_Intersects(cities.union_area, polygon_area.geom)
    //     AND NOT ST_Touches(cities.union_area, polygon_area.geom);`
    //   );
    //   if (!rows[0]) {
    //     return next(
    //       new ForbiddenError({
    //         reason: "Wrong area data",
    //       })
    //     );
    //   }
    //   rows.forEach((row, index) => {
    //     query += `
    //       SELECT ${colsQuery}, count(*) AS count
    //       FROM ${row.layer_name}, polygon_area
    //       WHERE ${row.layer_name}.geom && polygon_area.geom
    //       AND ST_Intersects(${row.layer_name}.geom, polygon_area.geom)
    //       GROUP BY 1
    //     `;

    //     // Add UNION ALL between SELECT statements, except after the last one
    //     if (index < rows.length - 1) {
    //       query += "UNION ALL\n";
    //     }
    //   });
    //   layer_name = rows[0].layer_name;
    // } catch (error) {
    //   logger.error(error);
    // }

    // query += `
    // ) AS combined_results
    // GROUP BY 1;
    // `;

    try {
      const { rows } = await database.raw(query);
      return res.json(rows);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "chart-analysis",
          reason: "Failed to get chart",
        })
      );
    }
  });

  router.get("/count/tower-owner/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let { province_id, city_id, limit = 10 } = req.query;
      if (limit < 1) {
        return next(new InvalidPayloadError({ reason: "limit >=1" }));
      }

      const { province, city } = await userAreaData(
        req.accountability,
        req.schema
      );
      if (province) province_id = province;
      if (city) city_id = city;

      const result = await database("site_points as sp")
        .select("sp.owner")
        .count("sp.id as count")
        .innerJoin("site_point_types as spt", "sp.site_point_type_id", "spt.id")
        .innerJoin("area_cities as ac", "sp.area_city_id", "ac.ogc_fid")
        .where("spt.name", "Tower")
        .where((qb) => {
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
        })
        .groupBy("sp.owner")
        .orderBy("count", "desc")
        .limit(limit);

      const totalResult = await database("site_points as sp")
        .count("sp.id as total")
        .innerJoin("site_point_types as spt", "sp.site_point_type_id", "spt.id")
        .innerJoin("area_cities as ac", "sp.area_city_id", "ac.ogc_fid")
        .where("spt.name", "Tower")
        .where((qb) => {
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
        })
        .first();

      const total = parseInt(totalResult.total);

      const listWithPercentage = result.map((item) => ({
        owner: item.owner,
        count: parseInt(item.count),
        percentage: parseFloat(
          ((parseInt(item.count) / total) * 100).toFixed(2)
        ),
      }));

      const top10Total = listWithPercentage.reduce(
        (sum, item) => sum + item.count,
        0
      );
      const othersCount = total - top10Total;

      if (othersCount > 0) {
        listWithPercentage.push({
          owner: "Others",
          count: othersCount,
          percentage: parseFloat(((othersCount / total) * 100).toFixed(2)),
        });
      }

      // Default bbox for Indonesia
      let bbox = [95.0, -11.0, 141.0, 6.0];

      if (city_id) {
        const bboxResult = await database.raw(
          `
          SELECT ARRAY[
            ST_XMin(bbox::geometry),
            ST_YMin(bbox::geometry),
            ST_XMax(bbox::geometry),
            ST_YMax(bbox::geometry)
          ] as bbox
          FROM area_cities
          WHERE city_id = ?
        `,
          [city_id]
        );
        if (bboxResult.rows[0] && bboxResult.rows[0].bbox) {
          bbox = bboxResult.rows[0].bbox;
        }
      } else if (province_id) {
        const bboxResult = await database.raw(
          `
          SELECT ARRAY[
            ST_XMin(bbox::geometry),
            ST_YMin(bbox::geometry),
            ST_XMax(bbox::geometry),
            ST_YMax(bbox::geometry)
          ] as bbox
          FROM area_provinces
          WHERE province_id = ?
        `,
          [province_id]
        );
        if (bboxResult.rows[0] && bboxResult.rows[0].bbox) {
          bbox = bboxResult.rows[0].bbox;
        }
      }

      return res.json({
        data: { bbox, total, list: listWithPercentage },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "count/towers",
          reason: "Failed to get towers chart",
        })
      );
    }
  });
  router.get("/count/tower-area/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let {
        owner,
        province_id,
        city_id,
        group_by = "province",
        limit = 10,
      } = req.query;

      if (limit < 1) {
        return next(new InvalidPayloadError({ reason: "limit >=1" }));
      }

      const { province, city } = await userAreaData(
        req.accountability,
        req.schema
      );
      if (province) province_id = province;
      if (city) city_id = city;

      if (!["province", "city"].includes(group_by)) {
        return next(
          new InvalidPayloadError({
            reason: "group_by must be 'province' or 'city'",
          })
        );
      }

      // Determine grouping columns based on group_by parameter
      let selectColumns, groupByColumn;

      if (group_by === "province") {
        selectColumns = [
          "ac.province_id as area_id",
          "ac.province as area_name",
        ];
        groupByColumn = ["ac.province_id", "ac.province"];
      } else {
        selectColumns = [
          "ac.city_id as area_id",
          "ac.city as area_name",
          "ac.province_id",
          "ac.province",
        ];
        groupByColumn = [
          "ac.city_id",
          "ac.city",
          "ac.province_id",
          "ac.province",
        ];
      }

      // Build main query
      let mainQuery = database("site_points as sp")
        .select(selectColumns)
        .count("sp.id as count")
        .innerJoin("site_point_types as spt", "sp.site_point_type_id", "spt.id")
        .innerJoin("area_cities as ac", "sp.area_city_id", "ac.ogc_fid")
        .where("spt.name", "Tower");

      if (owner) {
        mainQuery = mainQuery.where("sp.owner", owner);
      }

      if (province_id) {
        mainQuery = mainQuery.where("ac.province_id", province_id);
      }
      if (city_id) {
        mainQuery = mainQuery.where("ac.city_id", city_id);
      }

      const result = await mainQuery
        .groupBy(groupByColumn)
        .orderBy("count", "desc")
        .limit(limit);

      // Get total count
      let totalQuery = database("site_points as sp")
        .count("sp.id as total")
        .innerJoin("site_point_types as spt", "sp.site_point_type_id", "spt.id")
        .innerJoin("area_cities as ac", "sp.area_city_id", "ac.ogc_fid")
        .where("spt.name", "Tower");

      if (owner) {
        totalQuery = totalQuery.where("sp.owner", owner);
      }

      if (province_id) {
        totalQuery = totalQuery.where("ac.province_id", province_id);
      }
      if (city_id) {
        totalQuery = totalQuery.where("ac.city_id", city_id);
      }

      const totalResult = await totalQuery.first();
      const total = parseInt(totalResult.total);

      // Calculate percentage for each item
      const listWithPercentage = result.map((item) => ({
        area_id: item.area_id,
        area_name: item.area_name,
        count: parseInt(item.count),
        percentage: parseFloat(
          ((parseInt(item.count) / total) * 100).toFixed(2)
        ),
        ...(group_by === "city" && {
          province_id: item.province_id,
          province: item.province,
        }),
      }));

      // Calculate "Others"
      const topTotal = listWithPercentage.reduce(
        (sum, item) => sum + item.count,
        0
      );
      const othersCount = total - topTotal;

      if (othersCount > 0) {
        listWithPercentage.push({
          area_id: null,
          area_name: "Others",
          count: othersCount,
          percentage: parseFloat(((othersCount / total) * 100).toFixed(2)),
        });
      }

      // Get bounding box based on selected towers
      let bbox = [95.0, -11.0, 141.0, 6.0]; // Default Indonesia bbox

      const bboxQuery = database("site_points as sp")
        .select(
          database.raw(`
          ARRAY[
            ST_XMin(ST_Extent(sp.geom)),
            ST_YMin(ST_Extent(sp.geom)),
            ST_XMax(ST_Extent(sp.geom)),
            ST_YMax(ST_Extent(sp.geom))
          ] as bbox
        `)
        )
        .innerJoin("site_point_types as spt", "sp.site_point_type_id", "spt.id")
        .innerJoin("area_cities as ac", "sp.area_city_id", "ac.ogc_fid")
        .where("spt.name", "Tower");

      if (owner) {
        bboxQuery.where("sp.owner", owner);
      }

      if (province_id) {
        bboxQuery.where("ac.province_id", province_id);
      }
      if (city_id) {
        bboxQuery.where("ac.city_id", city_id);
      }

      const bboxResult = await bboxQuery.first();
      if (bboxResult && bboxResult.bbox) {
        bbox = bboxResult.bbox;
      }

      return res.json({
        data: { bbox, total, list: listWithPercentage, group_by },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "count/tower-area",
          reason: "Failed to get tower area chart",
        })
      );
    }
  });
  router.get("/count/poi-school-jenjang/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let { province_id, city_id, limit = 10 } = req.query;
      if (limit < 1) {
        return next(new InvalidPayloadError({ reason: "limit >=1" }));
      }

      const { province, city } = await userAreaData(
        req.accountability,
        req.schema
      );
      if (province) province_id = province;
      if (city) city_id = city;

      const result = await database("poi as p")
        .select({ owner: "jenjang" })
        .count("p.ogc_fid as count")
        .innerJoin("area_cities as ac", "p.area_city_id", "ac.ogc_fid")
        .where("p.category", "school")
        .whereNotNull("p.jenjang")
        .where((qb) => {
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
        })
        .groupBy("p.jenjang")
        .orderBy("count", "desc")
        .limit(limit);

      const totalResult = await database("poi as p")
        .count("p.ogc_fid as total")
        .innerJoin("area_cities as ac", "p.area_city_id", "ac.ogc_fid")
        .where("p.category", "school")
        .whereNotNull("p.jenjang")
        .where((qb) => {
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
        })
        .first();

      const total = parseInt(totalResult.total);

      const listWithPercentage = result.map((item) => ({
        owner: item.owner,
        count: parseInt(item.count),
        percentage: parseFloat(
          ((parseInt(item.count) / total) * 100).toFixed(2)
        ),
      }));

      const top10Total = listWithPercentage.reduce(
        (sum, item) => sum + item.count,
        0
      );
      const othersCount = total - top10Total;

      if (othersCount > 0) {
        listWithPercentage.push({
          owner: "Others",
          count: othersCount,
          percentage: parseFloat(((othersCount / total) * 100).toFixed(2)),
        });
      }

      // Default bbox for Indonesia
      let bbox = [95.0, -11.0, 141.0, 6.0];

      if (city_id) {
        const bboxResult = await database.raw(
          `
          SELECT ARRAY[
            ST_XMin(bbox::geometry),
            ST_YMin(bbox::geometry),
            ST_XMax(bbox::geometry),
            ST_YMax(bbox::geometry)
          ] as bbox
          FROM area_cities
          WHERE city_id = ?
        `,
          [city_id]
        );
        if (bboxResult.rows[0] && bboxResult.rows[0].bbox) {
          bbox = bboxResult.rows[0].bbox;
        }
      } else if (province_id) {
        const bboxResult = await database.raw(
          `
          SELECT ARRAY[
            ST_XMin(bbox::geometry),
            ST_YMin(bbox::geometry),
            ST_XMax(bbox::geometry),
            ST_YMax(bbox::geometry)
          ] as bbox
          FROM area_provinces
          WHERE province_id = ?
        `,
          [province_id]
        );
        if (bboxResult.rows[0] && bboxResult.rows[0].bbox) {
          bbox = bboxResult.rows[0].bbox;
        }
      }

      return res.json({
        data: { bbox, total, list: listWithPercentage },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "count/poi-school-jenjang",
          reason: "Failed to get poi-school-jenjang chart",
        })
      );
    }
  });
  router.get("/count/poi-school-area/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let {
        owner,
        province_id,
        city_id,
        group_by = "province",
        limit = 10,
      } = req.query;

      if (limit < 1) {
        return next(new InvalidPayloadError({ reason: "limit >=1" }));
      }

      if (!["province", "city"].includes(group_by)) {
        return next(
          new InvalidPayloadError({
            reason: "group_by must be 'province' or 'city'",
          })
        );
      }

      const { province, city } = await userAreaData(
        req.accountability,
        req.schema
      );
      if (province) province_id = province;
      if (city) city_id = city;

      // Determine grouping columns based on group_by parameter
      let selectColumns, groupByColumn;

      if (group_by === "province") {
        selectColumns = [
          "ac.province_id as area_id",
          "ac.province as area_name",
        ];
        groupByColumn = ["ac.province_id", "ac.province"];
      } else {
        selectColumns = [
          "ac.city_id as area_id",
          "ac.city as area_name",
          "ac.province_id",
          "ac.province",
        ];
        groupByColumn = [
          "ac.city_id",
          "ac.city",
          "ac.province_id",
          "ac.province",
        ];
      }

      // Build main query
      let mainQuery = database("poi as p")
        .select(selectColumns)
        .count("p.ogc_fid as count")
        .innerJoin("area_cities as ac", "p.area_city_id", "ac.ogc_fid")
        .where("p.category", "school")
        .whereNotNull("p.jenjang");
      if (owner) {
        mainQuery = mainQuery.where("p.jenjang", owner);
      }

      if (province_id) {
        mainQuery = mainQuery.where("ac.province_id", province_id);
      }
      if (city_id) {
        mainQuery = mainQuery.where("ac.city_id", city_id);
      }

      const result = await mainQuery
        .groupBy(groupByColumn)
        .orderBy("count", "desc")
        .limit(limit);

      // Get total count
      let totalQuery = database("poi as p")
        .count("p.ogc_fid as total")
        .innerJoin("area_cities as ac", "p.area_city_id", "ac.ogc_fid")
        .where("p.category", "school")
        .whereNotNull("p.jenjang");

      if (owner) {
        totalQuery = totalQuery.where("p.jenjang", owner);
      }

      if (province_id) {
        totalQuery = totalQuery.where("ac.province_id", province_id);
      }
      if (city_id) {
        totalQuery = totalQuery.where("ac.city_id", city_id);
      }

      const totalResult = await totalQuery.first();
      const total = parseInt(totalResult.total);

      // Calculate percentage for each item
      const listWithPercentage = result.map((item) => ({
        area_id: item.area_id,
        area_name: item.area_name,
        count: parseInt(item.count),
        percentage: parseFloat(
          ((parseInt(item.count) / total) * 100).toFixed(2)
        ),
        ...(group_by === "city" && {
          province_id: item.province_id,
          province: item.province,
        }),
      }));

      // Calculate "Others"
      const topTotal = listWithPercentage.reduce(
        (sum, item) => sum + item.count,
        0
      );
      const othersCount = total - topTotal;

      if (othersCount > 0) {
        listWithPercentage.push({
          area_id: null,
          area_name: "Others",
          count: othersCount,
          percentage: parseFloat(((othersCount / total) * 100).toFixed(2)),
        });
      }

      // Get bounding box based on selected towers
      let bbox = [95.0, -11.0, 141.0, 6.0]; // Default Indonesia bbox

      const bboxQuery = database("poi as p")
        .select(
          database.raw(`
          ARRAY[
            ST_XMin(ST_Extent(p.geom)),
            ST_YMin(ST_Extent(p.geom)),
            ST_XMax(ST_Extent(p.geom)),
            ST_YMax(ST_Extent(p.geom))
          ] as bbox
        `)
        )
        .innerJoin("area_cities as ac", "p.area_city_id", "ac.ogc_fid")
        .where("p.category", "school")
        .whereNotNull("p.jenjang");

      if (owner) {
        bboxQuery.where("p.jenjang", owner);
      }

      if (province_id) {
        bboxQuery.where("ac.province_id", province_id);
      }
      if (city_id) {
        bboxQuery.where("ac.city_id", city_id);
      }

      const bboxResult = await bboxQuery.first();
      if (bboxResult && bboxResult.bbox) {
        bbox = bboxResult.bbox;
      }

      return res.json({
        data: { bbox, total, list: listWithPercentage, group_by },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "count/poi-school-area",
          reason: "Failed to get poi-school-area chart",
        })
      );
    }
  });
  router.get("/count/poi-ruko/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let { province_id, city_id, limit = 10 } = req.query;
      if (limit < 1) {
        return next(new InvalidPayloadError({ reason: "limit >=1" }));
      }

      const { province, city } = await userAreaData(
        req.accountability,
        req.schema
      );
      if (province) province_id = province;
      if (city) city_id = city;

      const result = await database("poi as p")
        .select({ owner: "p.category" })
        .count("p.ogc_fid as count")
        .innerJoin("area_cities as ac", "p.area_city_id", "ac.ogc_fid")
        .where("p.group", "Ruko")
        .where((qb) => {
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
        })
        .groupBy("p.category")
        .orderBy("count", "desc")
        .limit(limit);

      const totalResult = await database("poi as p")
        .count("p.ogc_fid as total")
        .innerJoin("area_cities as ac", "p.area_city_id", "ac.ogc_fid")
        .where("p.group", "Ruko")
        .where((qb) => {
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
        })
        .first();

      const total = parseInt(totalResult.total);

      const listWithPercentage = result.map((item) => ({
        owner: item.owner,
        count: parseInt(item.count),
        percentage: parseFloat(
          ((parseInt(item.count) / total) * 100).toFixed(2)
        ),
      }));

      const top10Total = listWithPercentage.reduce(
        (sum, item) => sum + item.count,
        0
      );
      const othersCount = total - top10Total;

      if (othersCount > 0) {
        listWithPercentage.push({
          owner: "Others",
          count: othersCount,
          percentage: parseFloat(((othersCount / total) * 100).toFixed(2)),
        });
      }

      // Default bbox for Indonesia
      let bbox = [95.0, -11.0, 141.0, 6.0];

      if (city_id) {
        const bboxResult = await database.raw(
          `
          SELECT ARRAY[
            ST_XMin(bbox::geometry),
            ST_YMin(bbox::geometry),
            ST_XMax(bbox::geometry),
            ST_YMax(bbox::geometry)
          ] as bbox
          FROM area_cities
          WHERE city_id = ?
        `,
          [city_id]
        );
        if (bboxResult.rows[0] && bboxResult.rows[0].bbox) {
          bbox = bboxResult.rows[0].bbox;
        }
      } else if (province_id) {
        const bboxResult = await database.raw(
          `
          SELECT ARRAY[
            ST_XMin(bbox::geometry),
            ST_YMin(bbox::geometry),
            ST_XMax(bbox::geometry),
            ST_YMax(bbox::geometry)
          ] as bbox
          FROM area_provinces
          WHERE province_id = ?
        `,
          [province_id]
        );
        if (bboxResult.rows[0] && bboxResult.rows[0].bbox) {
          bbox = bboxResult.rows[0].bbox;
        }
      }

      return res.json({
        data: { bbox, total, list: listWithPercentage },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "count/poi-ruko",
          reason: "Failed to get poi-ruko chart",
        })
      );
    }
  });
  router.get("/count/poi-ruko-area/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let {
        owner,
        province_id,
        city_id,
        group_by = "province",
        limit = 10,
      } = req.query;

      if (limit < 1) {
        return next(new InvalidPayloadError({ reason: "limit >=1" }));
      }

      if (!["province", "city"].includes(group_by)) {
        return next(
          new InvalidPayloadError({
            reason: "group_by must be 'province' or 'city'",
          })
        );
      }

      const { province, city } = await userAreaData(
        req.accountability,
        req.schema
      );
      if (province) province_id = province;
      if (city) city_id = city;

      // Determine grouping columns based on group_by parameter
      let selectColumns, groupByColumn;

      if (group_by === "province") {
        selectColumns = [
          "ac.province_id as area_id",
          "ac.province as area_name",
        ];
        groupByColumn = ["ac.province_id", "ac.province"];
      } else {
        selectColumns = [
          "ac.city_id as area_id",
          "ac.city as area_name",
          "ac.province_id",
          "ac.province",
        ];
        groupByColumn = [
          "ac.city_id",
          "ac.city",
          "ac.province_id",
          "ac.province",
        ];
      }

      // Build main query
      let mainQuery = database("poi as p")
        .select(selectColumns)
        .count("p.ogc_fid as count")
        .innerJoin("area_cities as ac", "p.area_city_id", "ac.ogc_fid")
        .where("p.group", "Ruko");
      if (owner) {
        mainQuery = mainQuery.where("p.category", owner);
      }

      if (province_id) {
        mainQuery = mainQuery.where("ac.province_id", province_id);
      }
      if (city_id) {
        mainQuery = mainQuery.where("ac.city_id", city_id);
      }

      const result = await mainQuery
        .groupBy(groupByColumn)
        .orderBy("count", "desc")
        .limit(limit);

      // Get total count
      let totalQuery = database("poi as p")
        .count("p.ogc_fid as total")
        .innerJoin("area_cities as ac", "p.area_city_id", "ac.ogc_fid")
        .where("p.group", "Ruko");

      if (owner) {
        totalQuery = totalQuery.where("p.category", owner);
      }

      if (province_id) {
        totalQuery = totalQuery.where("ac.province_id", province_id);
      }
      if (city_id) {
        totalQuery = totalQuery.where("ac.city_id", city_id);
      }

      const totalResult = await totalQuery.first();
      const total = parseInt(totalResult.total);

      // Calculate percentage for each item
      const listWithPercentage = result.map((item) => ({
        area_id: item.area_id,
        area_name: item.area_name,
        count: parseInt(item.count),
        percentage: parseFloat(
          ((parseInt(item.count) / total) * 100).toFixed(2)
        ),
        ...(group_by === "city" && {
          province_id: item.province_id,
          province: item.province,
        }),
      }));

      // Calculate "Others"
      const topTotal = listWithPercentage.reduce(
        (sum, item) => sum + item.count,
        0
      );
      const othersCount = total - topTotal;

      if (othersCount > 0) {
        listWithPercentage.push({
          area_id: null,
          area_name: "Others",
          count: othersCount,
          percentage: parseFloat(((othersCount / total) * 100).toFixed(2)),
        });
      }

      // Get bounding box based on selected towers
      let bbox = [95.0, -11.0, 141.0, 6.0]; // Default Indonesia bbox

      const bboxQuery = database("poi as p")
        .select(
          database.raw(`
          ARRAY[
            ST_XMin(ST_Extent(p.geom)),
            ST_YMin(ST_Extent(p.geom)),
            ST_XMax(ST_Extent(p.geom)),
            ST_YMax(ST_Extent(p.geom))
          ] as bbox
        `)
        )
        .innerJoin("area_cities as ac", "p.area_city_id", "ac.ogc_fid")
        .where("p.group", "Ruko");

      if (owner) {
        bboxQuery.where("p.category", owner);
      }

      if (province_id) {
        bboxQuery.where("ac.province_id", province_id);
      }
      if (city_id) {
        bboxQuery.where("ac.city_id", city_id);
      }

      const bboxResult = await bboxQuery.first();
      if (bboxResult && bboxResult.bbox) {
        bbox = bboxResult.bbox;
      }

      return res.json({
        data: { bbox, total, list: listWithPercentage, group_by },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "count/poi-ruko-area",
          reason: "Failed to get poi-ruko-area chart",
        })
      );
    }
  });
  router.get("/count/isp/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let {
        province_id,
        city_id,
        limit = 10,
        categories = "school",
      } = req.query;

      if (limit < 1) {
        return next(new InvalidPayloadError({ reason: "limit >=1" }));
      }

      const { province, city } = await userAreaData(
        req.accountability,
        req.schema
      );
      if (province) province_id = province;
      if (city) city_id = city;

      const categoriesArray = categories
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      const result = await database("aoi_area as aa")
        .select("aa.isp", "i.color")
        .count({ count: "p.ogc_fid" })
        .innerJoin("area_cities as ac", "aa.area_city_id", "ac.ogc_fid")
        // .leftJoin("poi as p", "aa.ogc_fid", "p.aoi_area_id")
        .leftJoin("poi as p", function () {
          this.on("aa.ogc_fid", "p.aoi_area_id");
          if (categoriesArray.length) {
            this.andOnIn("p.category", categoriesArray);
          }
        })
        .leftJoin("isp as i", "aa.isp", "i.name")
        .where((qb) => {
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
          // if (categoriesArray.length) qb.whereIn("p.category", categoriesArray);
        })
        .groupBy("aa.isp", "i.color")
        .orderBy("count", "desc")
        .limit(limit);

      const ispAll = await database("aoi_area as aa")
        .countDistinct({ count: "aa.isp" })
        .innerJoin("area_cities as ac", "aa.area_city_id", "ac.ogc_fid")
        .where((qb) => {
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
        })
        .first();
      const totalIsp = Number(ispAll.count);

      const totalResult = await database("aoi_area as aa")
        .count({ total: "p.ogc_fid" })
        .innerJoin("area_cities as ac", "aa.area_city_id", "ac.ogc_fid")
        // .leftJoin("poi as p", "aa.ogc_fid", "p.aoi_area_id")
        .leftJoin("poi as p", function () {
          this.on("aa.ogc_fid", "p.aoi_area_id");
          if (categoriesArray.length) {
            this.andOnIn("p.category", categoriesArray);
          }
        })
        .where((qb) => {
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
          // if (categoriesArray.length) qb.whereIn("p.category", categoriesArray);
        })
        .first();

      const total_poi = parseInt(totalResult.total);
      const listWithPercentage = result.map((item) => ({
        owner: item.isp,
        owner_type: "isp",
        count: parseInt(item.count),
        count_type: "poi",
        percentage: parseFloat(
          ((parseInt(item.count) / total_poi) * 100).toFixed(2)
        ),
        color: item.color ?? "#B0BEC5",
      }));

      const top10Total = listWithPercentage.reduce(
        (sum, item) => sum + item.count,
        0
      );
      const othersCount = total_poi - top10Total;

      if (othersCount > 0) {
        listWithPercentage.push({
          owner: "Others",
          owner_type: "isp",
          count: othersCount,
          count_type: "poi",
          percentage: parseFloat(((othersCount / total_poi) * 100).toFixed(2)),
        });
      }

      // Default bbox for Indonesia
      let bbox = [95.0, -11.0, 141.0, 6.0];
      if (city_id) {
        const bboxResult = await database.raw(
          `
          SELECT ARRAY[
            ST_XMin(bbox::geometry),
            ST_YMin(bbox::geometry),
            ST_XMax(bbox::geometry),
            ST_YMax(bbox::geometry)
          ] as bbox
          FROM area_cities
          WHERE city_id = ?
        `,
          [city_id]
        );
        if (bboxResult.rows[0] && bboxResult.rows[0].bbox) {
          bbox = bboxResult.rows[0].bbox;
        }
      } else if (province_id) {
        const bboxResult = await database.raw(
          `
          SELECT ARRAY[
            ST_XMin(bbox::geometry),
            ST_YMin(bbox::geometry),
            ST_XMax(bbox::geometry),
            ST_YMax(bbox::geometry)
          ] as bbox
          FROM area_provinces
          WHERE province_id = ?
        `,
          [province_id]
        );
        if (bboxResult.rows[0] && bboxResult.rows[0].bbox) {
          bbox = bboxResult.rows[0].bbox;
        }
      }

      return res.json({
        data: {
          bbox,
          total: totalIsp,
          total_poi,
          list: listWithPercentage,
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "count/poi-school-area",
          reason: "Failed to get poi-school-area chart",
        })
      );
    }
  });
  router.get("/count/isp-detail/:isp_name/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const { isp_name } = req.params;
      let { province_id, city_id, categories = "school" } = req.query;

      const { province, city } = await userAreaData(
        req.accountability,
        req.schema
      );
      if (province) province_id = province;
      if (city) city_id = city;

      const categoriesArray = categories
        .split(",")
        .map((c) => c.trim())
        .filter((c) => c.length > 0);

      const aoiList = await database("aoi_area as aa")
        .select(
          "aa.ogc_fid",
          "aa.name",
          "aa.category",
          "aa.coverage",
          "aa.isp",
          "aa.footprint_summary"
        )
        .innerJoin("area_cities as ac", "aa.area_city_id", "ac.ogc_fid")
        .where("aa.isp", isp_name)
        .where((qb) => {
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
        })
        .orderBy("name", "desc");

      const poiCountSubquery = database("aoi_area as aa")
        .select("aa.ogc_fid", "p.category")
        .count({ jumlah: "p.ogc_fid" })
        .innerJoin("area_cities as ac", "aa.area_city_id", "ac.ogc_fid")
        .innerJoin("poi as p", "aa.ogc_fid", "p.aoi_area_id")
        .where((qb) => {
          if (isp_name) qb.where("aa.isp", isp_name);
          if (province_id) qb.where("ac.province_id", province_id);
          if (city_id) qb.where("ac.city_id", city_id);
          if (categoriesArray.length) qb.whereIn("p.category", categoriesArray);
        })
        .groupBy("aa.ogc_fid", "p.category")
        .as("pc");

      const poiList = await database
        .select(
          "pc.ogc_fid",
          database.raw(`jsonb_agg(jsonb_build_object(
            'category', pc.category,
            'jumlah', pc.jumlah
            ) ORDER BY pc.category) AS poi_summary`)
        )
        .from(poiCountSubquery)
        .groupBy("pc.ogc_fid")
        .orderBy("pc.ogc_fid");

      const poiMap = {};
      for (const row of poiList) {
        poiMap[row.ogc_fid] = row.poi_summary ?? [];
      }

      const result = aoiList.map((aoi) => {
        const poiSummary = poiMap[aoi.ogc_fid] || [];

        const totalPoi = poiSummary.reduce(
          (sum, item) => sum + Number(item.jumlah || 0),
          0
        );

        const footprintSummary = aoi.footprint_summary || {};
        const totalFootprint =
          typeof footprintSummary === "object"
            ? Object.entries(footprintSummary)
                .filter(([key]) => key !== "total")
                .reduce((sum, [, val]) => sum + Number(val || 0), 0)
            : 0;

        return {
          ...aoi,
          poi_summary: poiSummary,
          total_poi: totalPoi,
          total_footprint: totalFootprint,
        };
      });

      // FOOTPRINT (GLOBAL)
      const globalFootprintSummary = {};
      let globalTotalFootprint = 0;

      for (const aoi of result) {
        const fs = aoi.footprint_summary || {};
        if (typeof fs !== "object") continue;

        for (const [key, val] of Object.entries(fs)) {
          if (key === "total") continue;
          const num = Number(val || 0);

          globalFootprintSummary[key] =
            (globalFootprintSummary[key] || 0) + num;

          globalTotalFootprint += num;
        }
      }

      // POI (GLOBAL)
      const poiCategoryMap = {};
      let globalTotalPoi = 0;

      for (const aoi of result) {
        for (const item of aoi.poi_summary || []) {
          const cat = item.category;
          const num = Number(item.jumlah || 0);

          poiCategoryMap[cat] = (poiCategoryMap[cat] || 0) + num;
          globalTotalPoi += num;
        }
      }

      const globalPoiSummary = Object.entries(poiCategoryMap)
        .map(([category, jumlah]) => ({ category, jumlah }))
        .sort((a, b) => a.category.localeCompare(b.category));

      return res.json({
        data: {
          isp: isp_name,
          total_footprint: globalTotalFootprint,
          total_poi: globalTotalPoi,
          footprint_summary: globalFootprintSummary,
          poi_summary: globalPoiSummary,
          list: result,
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "count/poi-school-area",
          reason: "Failed to get poi-school-area chart",
        })
      );
    }
  });
};
