import {
  InvalidQueryError,
  ServiceUnavailableError,
  ForbiddenError,
  RouteNotFoundError,
} from "@directus/errors";

export default (router, { database, logger, services }) => {
  const { ItemsService } = services;
  const getPlaygrounds = async (req, next, is_playground) => {
    try {
      let provinces = [];
      let cities = [];
      if (is_playground) {
        const playgroundData = await database("playgrounds")
          .select("provinces", "cities")
          .where("user_created", req.accountability.user)
          .first();
        if (playgroundData) {
          provinces = Array.isArray(playgroundData.provinces)
            ? playgroundData.provinces.map((p) => p.key).filter(Boolean)
            : [];
          cities = Array.isArray(playgroundData.cities)
            ? playgroundData.cities.map((c) => c.key).filter(Boolean)
            : [];
        }
        if (!playgroundData || !provinces.length) {
          return next(
            new InvalidQueryError({ reason: "Playground not setup" })
          );
        }
      }
      return { playgroundProvinces: provinces, playgroundCities: cities };
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt",
          reason: "Failed to fetch MVT playground",
        })
      );
    }
  };
  router.get("/layer-list/:module", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const vectorService = new ItemsService("vector_tiles", {
        schema: req.schema,
        knex: database,
      });

      const { module } = req.params;
      const is_playground = req.query.is_playground
        ? req.query.is_playground.toLowerCase() === "true"
        : true;

      const resultPlayground = await getPlaygrounds(req, next, is_playground);
      if (!resultPlayground) return;
      const { playgroundProvinces, playgroundCities } = resultPlayground;

      let paramSite = [];
      let paramSubSite = [];
      let paramAsset = [];
      let paramRoute = [];
      let paramCable = [];
      let filterSite = [];
      let filterSubSite = [];
      let filterAsset = [];
      let filterRoute = [];
      let filterCable = [];
      if (is_playground) {
        if (playgroundProvinces.length) {
          const pointProv = `ac.province_id IN (${playgroundProvinces
            .map((p) => `'${p}'`)
            .join(",")})`;
          const lineProv = `(
              ac_from.province_id IN (${playgroundProvinces
                .map((p) => `'${p}'`)
                .join(",")})
              OR
              ac_to.province_id IN (${playgroundProvinces
                .map((p) => `'${p}'`)
                .join(",")})
          )`;
          filterSite.push(pointProv);
          filterSubSite.push(pointProv);
          filterAsset.push(pointProv);
          filterRoute.push(lineProv);
          filterCable.push(lineProv);
        }
        if (playgroundCities.length) {
          const pointProv = `ac.city_id IN (${playgroundCities
            .map((c) => `'${c}'`)
            .join(",")})`;
          const lineProv = `(
              ac_from.city_id IN (${playgroundCities
                .map((c) => `'${c}'`)
                .join(",")})
              OR
              ac_to.city_id IN (${playgroundCities
                .map((c) => `'${c}'`)
                .join(",")})
          )`;
          filterSite.push(pointProv);
          filterSubSite.push(pointProv);
          filterAsset.push(pointProv);
          filterRoute.push(lineProv);
          filterCable.push(lineProv);
        }
      }
      if (module == "backhaul") {
        filterSite.push("spt.code IN ('shelter', 'stasiun', 'general')");
        filterSubSite.push("spt.code = 'tower-rental'");

        filterAsset.push(
          "spt.code IN ('shelter', 'stasiun', 'general', 'tower-rental')"
        );
        filterRoute.push(
          "spt_from.code IN ('shelter', 'stasiun', 'general', 'tower-rental')"
        );
        filterRoute.push(
          "spt_to.code IN ('shelter', 'stasiun', 'general', 'tower-rental')"
        );
        filterCable.push(
          "spt_from.code IN ('shelter', 'stasiun', 'general', 'tower-rental')"
        );
        filterCable.push(
          "spt_to.code IN ('shelter', 'stasiun', 'general', 'tower-rental')"
        );
      } else if (module == "fwa-access") {
        filterSite.push("spt.code IN ('shelter', 'stasiun', 'general')");
        filterSubSite.push("spt.code = 'tower'");

        filterAsset.push(
          "spt.code IN ('shelter', 'stasiun', 'general', 'tower-rental', 'tower')"
        );
        filterRoute.push(
          "spt_from.code IN ('shelter', 'stasiun', 'general', 'tower-rental', 'tower')"
        );
        filterRoute.push(
          "spt_to.code IN ('shelter', 'stasiun', 'general', 'tower-rental', 'tower')"
        );
        filterCable.push(
          "spt_from.code IN ('shelter', 'stasiun', 'general', 'tower-rental', 'tower')"
        );
        filterCable.push(
          "spt_to.code IN ('shelter', 'stasiun', 'general', 'tower-rental', 'tower')"
        );
      }

      // ${filterSite.length ? "WHERE " + filterSite.join(" AND ") : ""}

      let siteQuery = `
        WITH site_data AS (
          SELECT sp.id
          FROM site_points sp
          INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
          LEFT JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
          WHERE spt.is_have_sub = false
          ${filterSite.length ? "AND " + filterSite.join(" AND ") : ""}
        ) SELECT
            site_points.site_point_type_id, spt."name" AS site_point_type_name, spt.is_have_sub,
            ?::boolean AS isvisible
        FROM site_points
        INNER JOIN site_data ON site_points.id = site_data.id
        INNER JOIN site_point_types spt ON site_points.site_point_type_id = spt.id
        GROUP BY site_points.site_point_type_id , spt.name, spt.is_have_sub
        ORDER BY site_points.site_point_type_id;
      `;

      let subSiteQuery = `
        WITH site_data AS (
          SELECT sp.id
          FROM site_points sp
          LEFT JOIN site_point_types spt ON sp.site_point_type_id = spt.id
          LEFT JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
          WHERE spt.is_have_sub = TRUE
          ${filterSubSite.length ? "AND " + filterSubSite.join(" AND ") : ""}
        ), sub_group AS (
          SELECT
              sp.site_point_type_id,
              sp.owner AS sub_type_name
          FROM site_points sp
          INNER JOIN site_data ON sp.id = site_data.id
          INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
          GROUP BY sp.site_point_type_id, sp.owner
        ) SELECT
            spt.id AS site_point_type_id,
            spt.name AS site_point_type_name,
            spt.is_have_sub,
            ARRAY_AGG(json_build_object(
              'sub_type_key', 'owner',
              'sub_type_name', sg.sub_type_name,
              'isvisible', ?::boolean
            ) ORDER BY sg.sub_type_name) AS sub_types,
            ?::boolean AS isvisible
        FROM site_point_types spt
        INNER JOIN sub_group sg ON sg.site_point_type_id = spt.id
        GROUP BY spt.id, spt.name, spt.is_have_sub
        ORDER BY spt.name;
      `;

      let assetsQuery = `
        WITH asset_data AS (
          SELECT assets.id
          FROM assets
          INNER JOIN site_points ON assets.site_point_id = site_points.id
          LEFT JOIN site_point_types spt ON site_points.site_point_type_id = spt.id
          LEFT JOIN area_cities ac ON site_points.area_city_id = ac.ogc_fid
          ${filterAsset.length ? "WHERE " + filterAsset.join(" AND ") : ""}
        ) SELECT
            assets.asset_type_id, at.name AS asset_type_name, at.icon,
            ?::boolean AS isvisible
        FROM assets
        INNER JOIN asset_data ON assets.id = asset_data.id
        LEFT JOIN asset_types at ON assets.asset_type_id = at.id
        GROUP BY assets.asset_type_id, at.name, at.icon
        ORDER BY at.name;
      `;
      let routeQuery = `
        WITH route_data AS (
          SELECT r.id
          FROM routes r
          LEFT JOIN site_points site_from ON r.site_from = site_from.id
          LEFT JOIN site_point_types spt_from ON site_from.site_point_type_id = spt_from.id
          LEFT JOIN site_points site_to ON r.site_to = site_to.id
          LEFT JOIN site_point_types spt_to ON site_to.site_point_type_id = spt_to.id
          LEFT JOIN area_cities ac_from ON site_from.area_city_id = ac_from.ogc_fid
          LEFT JOIN area_cities ac_to ON site_to.area_city_id = ac_to.ogc_fid
          ${filterRoute.length ? "WHERE " + filterRoute.join(" AND ") : ""}
        ) SELECT
            routes.route_type_id, rt.name AS route_type_name,
            ?::boolean AS isvisible
        FROM routes
        INNER JOIN route_data ON routes.id = route_data.id
        LEFT JOIN route_types rt ON routes.route_type_id = rt.id
        GROUP BY routes.route_type_id, rt.name
        ORDER BY rt.name;
      `;
      let cableQuery = `
        WITH cable_data AS (
          SELECT cables.id
          FROM cables
          LEFT JOIN site_points site_from ON cables.site_from = site_from.id
          LEFT JOIN site_point_types spt_from ON site_from.site_point_type_id = spt_from.id
          LEFT JOIN site_points site_to ON cables.site_to = site_to.id
          LEFT JOIN site_point_types spt_to ON site_to.site_point_type_id = spt_to.id
          LEFT JOIN area_cities ac_from ON site_from.area_city_id = ac_from.ogc_fid
          LEFT JOIN area_cities ac_to ON site_to.area_city_id = ac_to.ogc_fid
          ${filterCable.length ? "WHERE " + filterCable.join(" AND ") : ""}
        ) SELECT
            cables.cable_type_id , ct.name AS cable_type_name,
            ?::boolean AS isvisible
        FROM cables
        INNER JOIN cable_data ON cables.id = cable_data.id
        LEFT JOIN cable_types ct ON cables.cable_type_id = ct.id
        GROUP BY cables.cable_type_id , ct.name
        ORDER BY ct.name;
      `;

      let layerList = {};

      if (module == "backhaul") {
        let siteResult = [];
        const { rows: siteResult1 } = await database.raw(siteQuery, [
          ...paramSite,
          true,
        ]);
        const { rows: siteResult2 } = await database.raw(subSiteQuery, [
          ...paramSubSite,
          true,
          true,
        ]);
        const { rows: assetResult } = await database.raw(assetsQuery, [
          ...paramAsset,
          true,
        ]);
        const { rows: routeResult } = await database.raw(routeQuery, [
          ...paramRoute,
          true,
        ]);
        const { rows: cableResult } = await database.raw(cableQuery, [
          ...paramCable,
          true,
        ]);
        siteResult.push(...siteResult1, ...siteResult2);
        layerList.site_points = siteResult;
        layerList.assets = assetResult;
        layerList.cables = cableResult;
        layerList.routes = routeResult;
      } else if (module == "fwa-access") {
        let siteResult = [];
        const { rows: siteResult1 } = await database.raw(siteQuery, [
          ...paramSite,
          false,
        ]);
        const { rows: siteResult2 } = await database.raw(subSiteQuery, [
          ...paramSubSite,
          true,
          true,
        ]);
        const { rows: assetResult } = await database.raw(assetsQuery, [
          ...paramAsset,
          false,
        ]);
        const { rows: routeResult } = await database.raw(routeQuery, [
          ...paramRoute,
          false,
        ]);
        const { rows: cableResult } = await database.raw(cableQuery, [
          ...paramCable,
          false,
        ]);
        siteResult.push(...siteResult1, ...siteResult2);
        layerList.site_points = siteResult;
        layerList.assets = assetResult;
        layerList.cables = cableResult;
        layerList.routes = routeResult;
        layerList.administrations = [
          {
            layer_name: "area_provinces",
            administrations_name: "Administration Provinces",
            isvisible: true,
          },
          {
            layer_name: "area_cities",
            administrations_name: "Administration Cities",
            isvisible: true,
          },
        ];

        const vectorResult = await vectorService.readByQuery({
          fields: [
            "layer_id",
            "layer_name",
            "data_supports_name",
            "isvisible",
            "geometry_type",
            "bounds",
            "minzoom",
            "maxzoom",
            "hover_popup_columns",
            "click_popup_columns",
            "image_columns",
            "fill_style.*",
            "line_style.*",
            "circle_style.*",
            "symbol_style.*",
            "modules.isvisible",
            "modules.sort",
            "modules.active",
          ],
          filter: {
            active: { _eq: true },
            modules: { modules_id: { code: { _eq: "fwa-access" } } },
          },
          deep: {
            modules: {
              _filter: { modules_id: { code: { _eq: "fwa-access" } } },
            },
          },
          alias: { data_supports_name: "layer_alias" },
          sort: ["modules.sort", "layer_name"],
        });
        layerList.data_supports = vectorResult.map((layer) => {
          const mod = layer.modules?.[0];
          const { modules, ...restLayer } = layer;
          return {
            ...restLayer,
            active: mod?.active ?? layer.active,
            isvisible: mod?.isvisible ?? layer.isvisible,
          };
        });
      } else if (module == "market-potential") {
        const vectorResult = await vectorService.readByQuery({
          fields: [
            "layer_id",
            "layer_name",
            "data_supports_name",
            "isvisible",
            "geometry_type",
            "bounds",
            "minzoom",
            "maxzoom",
            "hover_popup_columns",
            "click_popup_columns",
            "image_columns",
            "fill_style.*",
            "line_style.*",
            "circle_style.*",
            "symbol_style.*",
            "circle_class_columns",
            "fill_class_columns",
            "line_class_columns",
            "symbol_class_columns",
            "modules.isvisible",
            "modules.sort",
            "modules.active",
          ],
          filter: {
            active: { _eq: true },
            modules: { modules_id: { code: { _eq: "market-potential" } } },
          },
          deep: {
            modules: {
              _filter: { modules_id: { code: { _eq: "market-potential" } } },
            },
          },
          alias: { data_supports_name: "layer_alias" },
          sort: ["modules.sort", "layer_name"],
        });
        layerList.administrations = [
          {
            layer_name: "area_provinces",
            administrations_name: "Administration Provinces",
            isvisible: true,
          },
          {
            layer_name: "area_cities",
            administrations_name: "Administration Cities",
            isvisible: true,
          },
        ];
        layerList.data_supports = vectorResult.map((layer) => {
          const mod = layer.modules?.[0];
          const { modules, ...restLayer } = layer;
          return {
            ...restLayer,
            active: mod?.active ?? layer.active,
            isvisible: mod?.isvisible ?? layer.isvisible,
          };
        });
      } else {
        const vectorResult = await vectorService.readByQuery({
          fields: [
            "layer_id",
            "layer_name",
            "data_supports_name",
            "isvisible",
            "geometry_type",
            "bounds",
            "minzoom",
            "maxzoom",
            "hover_popup_columns",
            "click_popup_columns",
            "image_columns",
            "fill_style.*",
            "line_style.*",
            "circle_style.*",
            "symbol_style.*",
            "circle_class_columns",
            "fill_class_columns",
            "line_class_columns",
            "symbol_class_columns",
            "modules.isvisible",
            "modules.sort",
            "modules.active",
          ],
          filter: {
            active: { _eq: true },
            modules: { modules_id: { code: { _eq: module } } },
          },
          deep: {
            modules: {
              _filter: { modules_id: { code: { _eq: module } } },
            },
          },
          alias: { data_supports_name: "layer_alias" },
          sort: ["modules.sort", "layer_name"],
        });
        layerList.data_supports = vectorResult.map((layer) => {
          const mod = layer.modules?.[0];
          const { modules, ...restLayer } = layer;
          return {
            ...restLayer,
            active: mod?.active ?? layer.active,
            isvisible: mod?.isvisible ?? layer.isvisible,
          };
        });
      }

      return res.send({
        data: layerList,
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "layers/layers-list",
          reason: `Failed to get layers-list${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
};
