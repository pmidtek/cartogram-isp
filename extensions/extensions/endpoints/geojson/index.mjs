import {
  ServiceUnavailableError,
  InvalidQueryError,
  RouteNotFoundError,
  ForbiddenError,
  InvalidPayloadError,
} from "@directus/errors";

export default (router, { database, logger, services }) => {
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

  router.get("/area_cities", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let { options = "centroid", city_id, ogc_fid } = req.query;

      if (options === "area") {
        if (!city_id && !ogc_fid) {
          return next(
            new InvalidPayloadError({
              reason: "city_id or ogc_fid is required when options is 'area'",
            })
          );
        }
        if (city_id) {
          const cityIds = Array.isArray(city_id)
            ? city_id
            : city_id.split(",").map((id) => id.trim());
          if (cityIds.length > 10) {
            return next(
              new InvalidPayloadError({
                reason: "Maximum 10 city_id allowed when options is 'area'",
              })
            );
          }
        }
        if (ogc_fid) {
          const ogcFids = Array.isArray(ogc_fid)
            ? ogc_fid
            : ogc_fid.split(",").map((id) => id.trim());
          if (ogcFids.length > 3) {
            return next(
              new InvalidPayloadError({
                reason: "Maximum 3 ogc_fid allowed when options is 'area'",
              })
            );
          }
        }
      } else {
        const { city } = await userAreaData(req.accountability, req.schema);
        if (city) city_id = city;
      }

      let geomColumn;
      if (options === "area") {
        geomColumn = "ST_AsGeojson(geom) as geom";
      } else {
        geomColumn = "ST_AsGeojson(centroid) as geom";
      }

      let selectColumns = [
        "city as area",
        "city_id as area_id",
        "tower_count",
        "tower_count_detail",
        geomColumn,
      ];

      let mainQuery = database("area_cities").select(
        database.raw(selectColumns.join(", "))
      );

      if (city_id) {
        const cityIds = Array.isArray(city_id)
          ? city_id
          : city_id.split(",").map((id) => id.trim());
        mainQuery = mainQuery.whereIn("city_id", cityIds);
      }
      if (ogc_fid) {
        const ogcFids = Array.isArray(ogc_fid)
          ? ogc_fid
          : ogc_fid.split(",").map((id) => id.trim());
        mainQuery = mainQuery.whereIn("ogc_fid", ogcFids);
      }

      const results = await mainQuery;
      let geojson = {
        type: "FeatureCollection",
        features: [],
      };
      results.forEach((row) => {
        if (row.geom) {
          geojson.features.push({
            type: "Feature",
            properties: {
              area: row.area,
              area_id: row.area_id,
              tower_count: row.tower_count,
              tower_count_detail: row.tower_count_detail,
            },
            geometry: JSON.parse(row.geom),
          });
        }
      });

      res.json(geojson);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/area_cities",
        })
      );
    }
  });
  router.get("/area_province", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let { options = "centroid", province_id, ogc_fid } = req.query;

      if (options === "area") {
        if (!province_id && !ogc_fid) {
          return next(
            new InvalidPayloadError({
              reason:
                "province_id or ogc_fid is required when options is 'area'",
            })
          );
        }
      } else {
        const { province } = await userAreaData(req.accountability, req.schema);
        if (province) province_id = province;
      }

      let geomColumn;
      if (options === "area") {
        geomColumn = "ST_AsGeojson(geom) as geom";
      } else {
        geomColumn = "ST_AsGeojson(centroid) as geom";
      }

      let selectColumns = [
        "province as area",
        "province_id as area_id",
        "tower_count",
        "tower_count_detail",
        geomColumn,
      ];

      let mainQuery = database("area_provinces").select(
        database.raw(selectColumns.join(", "))
      );

      if (province_id) {
        mainQuery = mainQuery.where("province_id", province_id);
      }
      if (ogc_fid) {
        mainQuery = mainQuery.where("ogc_fid", ogc_fid);
      }

      const results = await mainQuery;
      let geojson = {
        type: "FeatureCollection",
        features: [],
      };
      results.forEach((row) => {
        if (row.geom) {
          geojson.features.push({
            type: "Feature",
            properties: {
              area: row.area,
              area_id: row.area_id,
              tower_count: row.tower_count,
              tower_count_detail: row.tower_count_detail,
            },
            geometry: JSON.parse(row.geom),
          });
        }
      });

      res.json(geojson);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/area_province",
        })
      );
    }
  });

  router.get("/site_points", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const { project_id } = req.query;
      if (!project_id) {
        return next(new InvalidQueryError({ reason: "project_id required" }));
      }

      const { rows } = await database.raw(
        `WITH site_data AS (
            SELECT sp.id, sp.name, sp.site_point_type_id, sp.geom, spt.color
            FROM site_points sp
            INNER JOIN project_site_points psp ON sp.id = psp.site_point_id
            LEFT JOIN site_point_types spt ON sp.site_point_type_id = spt.id
            WHERE psp.project_id = ?
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'id', id,
                'geometry', ST_AsGeoJSON(geom)::jsonb,
                'properties', jsonb_build_object(
                  'name', name,
                  'site_point_type_id', site_point_type_id,
                  'color', color
                  )
                )
              )
            ) AS geojson
          FROM site_data
        ;`,
        [project_id]
      );

      const result = rows[0].geojson;

      return res.json(result);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/site_points",
        })
      );
    }
  });
  router.get("/assets", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const { project_id } = req.query;
      if (!project_id) {
        return next(new InvalidQueryError({ reason: "project_id required" }));
      }

      const ontId = 1;
      const { rows } = await database.raw(
        `WITH asset_data AS (
            SELECT
              assets.id, assets.name, assets.site_point_id,
              COALESCE(assets.asset_group_id::varchar, assets.asset_type_id::varchar) AS asset_type_id,
              COALESCE(ag.icon::text, at2.icon::text) AS icon,
              ST_Project(site_points.geom::geography, 5,
                radians(360/(COUNT(*) OVER (PARTITION BY assets.site_point_id))*ROW_NUMBER() OVER (PARTITION BY assets.site_point_id ORDER BY assets.id))
              )::geometry AS geom
            FROM assets
            INNER JOIN site_points ON assets.site_point_id = site_points.id
            INNER JOIN project_assets pa ON assets.id = pa.asset_id
            LEFT JOIN asset_types at2 ON assets.asset_type_id = at2.id
            LEFT JOIN asset_groups ag ON assets.asset_group_id = ag.id
            WHERE pa.project_id = ? AND assets.asset_type_id != ?
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'id', id,
                'geometry', ST_AsGeoJSON(geom)::jsonb,
                'properties', jsonb_build_object(
                  'name', name,
                  'asset_type_id', asset_type_id,
                  'site_point_id', site_point_id,
                  'icon', icon
                  )
                )
              )
            ) AS geojson
          FROM asset_data
        ;`,
        [project_id, ontId]
      );

      const result = rows[0].geojson;

      return res.json(result);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/assets",
        })
      );
    }
  });
  router.get("/asset-spiders", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const { project_id } = req.query;
      if (!project_id) {
        return next(new InvalidQueryError({ reason: "project_id required" }));
      }

      const ontId = 1;
      const { rows } = await database.raw(
        `WITH asset_data AS (
            SELECT
              assets.id, assets.name, assets.site_point_id,
              COALESCE(assets.asset_group_id::varchar, assets.asset_type_id::varchar) AS asset_type_id,
              ST_MakeLine(site_points.geom, ST_Project(site_points.geom::geography, 5,
                radians(360/(COUNT(*) OVER (PARTITION BY assets.site_point_id))*ROW_NUMBER() OVER (PARTITION BY assets.site_point_id ORDER BY assets.id)))::geometry
              ) AS geom
            FROM assets
            INNER JOIN site_points ON assets.site_point_id = site_points.id
            INNER JOIN project_assets pa ON assets.id = pa.asset_id
            WHERE pa.project_id = ? AND assets.asset_type_id != ?
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'id', id,
                'geometry', ST_AsGeoJSON(geom)::jsonb,
                'properties', jsonb_build_object(
                  'name', name,
                  'asset_type_id', asset_type_id,
                  'site_point_id', site_point_id
                  )
                )
              )
            ) AS geojson
          FROM asset_data
        ;`,
        [project_id, ontId]
      );

      const result = rows[0].geojson;

      return res.json(result);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/asset-spiders",
        })
      );
    }
  });
  router.get("/routes", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const { project_id } = req.query;
      if (!project_id) {
        return next(new InvalidQueryError({ reason: "project_id required" }));
      }

      const { rows } = await database.raw(
        `WITH route_data AS (
            SELECT routes.id, routes.name, routes.route_type_id, routes.geom, rt.color
            FROM routes
            INNER JOIN project_routes pr ON routes.id = pr.route_id
            LEFT JOIN route_types rt ON routes.route_type_id = rt.id
            WHERE pr.project_id = ?
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'id', id,
                'geometry', ST_AsGeoJSON(geom)::jsonb,
                'properties', jsonb_build_object(
                  'name', name,
                  'route_type_id', route_type_id,
                  'color', color
                  )
                )
              )
            ) AS geojson
          FROM route_data
        ;`,
        [project_id]
      );

      const result = rows[0].geojson;

      return res.json(result);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/routes",
        })
      );
    }
  });
  router.get("/cables", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const { project_id } = req.query;
      if (!project_id) {
        return next(new InvalidQueryError({ reason: "project_id required" }));
      }

      const { rows } = await database.raw(
        `WITH cable_data AS (
            SELECT cables.id, cables.name, cables.cable_group_id AS cable_type_id, ST_Union(routes.geom) AS geom, cg.color
            FROM cables
            INNER JOIN cable_routes cr ON cables.id = cr.cable_id
            INNER JOIN routes ON cr.route_id = routes.id
            INNER JOIN project_cables pc ON cables.id = pc.cable_id
            LEFT JOIN cable_types ct ON cables.cable_type_id = ct.id
            LEFT JOIN cable_groups cg ON cables.cable_group_id = cg.id
            WHERE pc.project_id = ?
            GROUP BY cables.id, cg.color
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'id', id,
                'geometry', ST_AsGeoJSON(geom)::jsonb,
                'properties', jsonb_build_object(
                  'name', name,
                  'cable_type_id', cable_type_id,
                  'color', color
                  )
                )
              )
            ) AS geojson
          FROM cable_data
        ;`,
        [project_id]
      );

      const result = rows[0].geojson;

      return res.json(result);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/cables",
        })
      );
    }
  });

  router.get("/assets/by-site-point", async (req, res, next) => {
    if (!req.accountability.user) {
      return next(new ForbiddenError());
    }
    const { site_point_id } = req.query;
    const min_r = Number(req.query.min_r ?? 10);
    const max_r = Number(req.query.max_r ?? 40);
    const step = Number(req.query.step ?? 2);

    if (!site_point_id) {
      return next(new InvalidQueryError({ reason: "site_point_id required" }));
    }
    if (
      Number.isNaN(min_r) ||
      Number.isNaN(max_r) ||
      Number.isNaN(step) ||
      min_r < 0 ||
      max_r < 0 ||
      step < 0 ||
      max_r < min_r
    ) {
      return next(
        new InvalidQueryError({
          reason: "invalid radius params (min_r, max_r, step)",
        })
      );
    }

    try {
      const { rows } = await database.raw(
        `WITH base AS (
          SELECT
            a.id, a.name, a.site_point_id, a.asset_type_id,
            at2.icon, sp.geom AS base_geom,
            COUNT(*) OVER (PARTITION BY a.site_point_id) AS n,
            ROW_NUMBER() OVER (PARTITION BY a.site_point_id ORDER BY a.id) AS rn
          FROM assets a
          INNER JOIN site_points sp ON a.site_point_id = sp.id
          LEFT JOIN asset_types at2 ON a.asset_type_id = at2.id
          WHERE a.site_point_id = ?
        ), asset_data AS (
          SELECT
            id, name, site_point_id, asset_type_id, icon,
            ST_Project(
              base_geom::geography,
              -- radius dinamis (meter)
              (? + LEAST(?, (n - 1) * ?))::double precision,
              -- angle dibagi rata
              radians((360.0 / n) * rn)
            )::geometry AS geom
          FROM base
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'id', id,
                'geometry', ST_AsGeoJSON(geom)::jsonb,
                'properties', jsonb_build_object(
                  'name', name,
                  'asset_type_id', asset_type_id,
                  'site_point_id', site_point_id,
                  'icon', icon
                )
              )
            ), '[]'::jsonb)
          ) AS geojson
        FROM asset_data;
        `,
        [site_point_id, min_r, max_r, step]
      );

      return res.json(rows[0].geojson);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/assets/by-site-point",
        })
      );
    }
  });
  router.get("/asset-spiders/by-site-point", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }

      const { site_point_id } = req.query;

      const min_r = Number(req.query.min_r ?? 10);
      const max_r = Number(req.query.max_r ?? 40);
      const step = Number(req.query.step ?? 2);

      if (!site_point_id) {
        return next(
          new InvalidQueryError({ reason: "site_point_id required" })
        );
      }

      if (
        Number.isNaN(min_r) ||
        Number.isNaN(max_r) ||
        Number.isNaN(step) ||
        min_r < 0 ||
        max_r < 0 ||
        step < 0 ||
        max_r < min_r
      ) {
        return next(
          new InvalidQueryError({
            reason: "invalid radius params (min_r, max_r, step)",
          })
        );
      }

      const { rows } = await database.raw(
        `
        WITH base AS (
          SELECT
            a.id,
            a.name,
            a.site_point_id,
            a.asset_type_id,
            at2.icon,
            sp.geom AS base_geom,

            COUNT(*) OVER (PARTITION BY a.site_point_id) AS n,
            ROW_NUMBER() OVER (PARTITION BY a.site_point_id ORDER BY a.id) AS rn
          FROM assets a
          INNER JOIN site_points sp ON a.site_point_id = sp.id
          LEFT JOIN asset_types at2 ON a.asset_type_id = at2.id
          WHERE a.site_point_id = ?
        ),
        asset_data AS (
          SELECT
            id, name, site_point_id, asset_type_id, icon,

            ST_MakeLine(
              base_geom,
              ST_Project(
                base_geom::geography,

                -- radius dinamis (meter)
                (? + LEAST(?, (n - 1) * ?))::double precision,

                -- angle dibagi rata
                radians((360.0 / n) * rn)
              )::geometry
            ) AS geom

          FROM base
        )
        SELECT jsonb_build_object(
          'type', 'FeatureCollection',
          'features', COALESCE(jsonb_agg(
            jsonb_build_object(
              'type', 'Feature',
              'id', id,
              'geometry', ST_AsGeoJSON(geom)::jsonb,
              'properties', jsonb_build_object(
                'name', name,
                'asset_type_id', asset_type_id,
                'site_point_id', site_point_id,
                'icon', icon
              )
            )
          ), '[]'::jsonb)
        ) AS geojson
        FROM asset_data;
      `,
        [site_point_id, min_r, max_r, step]
      );

      return res.json(
        rows[0]?.geojson ?? { type: "FeatureCollection", features: [] }
      );
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/asset-spiders/by-site-point",
        })
      );
    }
  });

  router.get("/fwa/antenna_sector", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }

      const { antenna_direction_id } = req.query;
      if (!antenna_direction_id) {
        return next(
          new InvalidQueryError({ reason: "antenna_direction_id required" })
        );
      }

      const steps = 32;
      const { rows } = await database.raw(
        `WITH sectors AS (
            SELECT
              item.id AS item_id, item.tower_owner, item.geom,
              main.radius_m,
              s.sector_no, s.azimuth, s.beam_width 
            FROM antenna_direction main
            INNER JOIN antenna_direction_item item ON main.id = item.antenna_direction_id
            CROSS JOIN LATERAL (VALUES
              (1, item.s1_azimuth, item.s1_beam_width),
              (2, item.s2_azimuth, item.s2_beam_width),
              (3, item.s3_azimuth, item.s3_beam_width)
            ) AS s(sector_no, azimuth, beam_width)
            WHERE main.id = ? AND s.beam_width IS NOT NULL AND s.azimuth IS NOT NULL
        ), arc AS (
            SELECT
              item_id, tower_owner, geom, sector_no, g,
              ST_Project(
                geom::geography,
                radius_m,
                radians(azimuth - beam_width / 2.0 + beam_width * g::numeric / ?)
              )::geometry AS pt
            FROM sectors
            CROSS JOIN generate_series(0, ?) AS g
        ), poly AS (
            SELECT
              item_id, tower_owner, sector_no,
              ST_MakePolygon(
                ST_MakeLine(
                  array_prepend(geom, array_append(array_agg(pt ORDER BY g), geom))
                )
              ) AS geom
            FROM arc
            GROUP BY
              item_id, tower_owner, sector_no, geom
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'id', item_id || '-' || sector_no,
                'geometry', ST_AsGeoJSON(geom)::jsonb,
                'properties', jsonb_build_object(
                  'item_id', item_id,
                  'tower_owner', tower_owner,
                  'sector_no', sector_no,
                  'color', CASE sector_no
                    WHEN 1 THEN '#00B050'
                    WHEN 2 THEN '#0070C0'
                    ELSE '#ED7D31'
                  END
                )
              )
            ), '[]'::jsonb)
          ) AS geojson
          FROM poly
        ;`,
        [antenna_direction_id, steps, steps]
      );

      return res.json(
        rows[0]?.geojson ?? { type: "FeatureCollection", features: [] }
      );
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/fwa/antenna_sector",
        })
      );
    }
  });

  router.get("/fwa/antenna", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }

      const { antenna_direction_id } = req.query;
      if (!antenna_direction_id) {
        return next(
          new InvalidQueryError({ reason: "antenna_direction_id required" })
        );
      }

      const { rows } = await database.raw(
        `SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'id', item.id,
                'geometry', ST_AsGeoJSON(item.geom)::jsonb,
                'properties', jsonb_build_object(
                  'tower_owner', item.tower_owner
                )
              )
            ), '[]'::jsonb)
          ) AS geojson
          FROM antenna_direction main
          INNER JOIN antenna_direction_item item ON main.id = item.antenna_direction_id
          WHERE main.id = ?
        ;`,
        [antenna_direction_id]
      );

      return res.json(
        rows[0]?.geojson ?? { type: "FeatureCollection", features: [] }
      );
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          reason: "Unexpected Error",
          service: "geojson/fwa/antenna",
        })
      );
    }
  });
};
