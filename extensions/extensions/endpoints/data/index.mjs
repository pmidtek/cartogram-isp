import {
  InvalidPayloadError,
  ServiceUnavailableError,
  ForbiddenError,
} from "@directus/errors";

import xml2js from "xml2js";
import tokml from "@maphubs/tokml";

import clearCache from "../../utils/clearCache.mjs";
import getRequestMeta from "../../utils/metaRequest.mjs";

const builder = new xml2js.Builder({
  headless: true,
  renderOpts: { pretty: true },
});
const parser = new xml2js.Parser();

export default (router, { env, database, logger, services }) => {
  const { ItemsService, MetaService } = services;
  const getSite = async (req, id) => {
    try {
      const siteService = new ItemsService("site_points", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const siteResult = await siteService.readOne(id, {
        fields: [
          "*",
          "user_created.first_name",
          "user_created.last_name",
          "user_updated.first_name",
          "user_updated.last_name",
          "site_point_type_id.id",
          "site_point_type_id.name",
          "area_city_id.city",
          "area_city_id.province",
        ],
      });
      return siteResult;
    } catch (error) {
      logger.error(error);
      throw new ServiceUnavailableError({
        service: "getSite",
        reason: `Failed to get site${
          error?.message ? " : " + error.message : ""
        }`,
      });
    }
  };
  const getAssets = async (req, query) => {
    try {
      const { site_point_id } = query;
      const assetService = new ItemsService("assets", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const assetResult = await assetService.readByQuery({
        fields: [
          "*",
          "user_created.first_name",
          "user_created.last_name",
          "user_updated.first_name",
          "user_updated.last_name",
          "asset_type_id.id",
          "asset_type_id.name",
          "asset_type_id.terminate_type",
        ],
        filter: { site_point_id: { _eq: site_point_id } },
      });
      return assetResult;
    } catch (error) {
      logger.error(error);
      throw new ServiceUnavailableError({
        service: "getAssets",
        reason: `Failed to get assets${
          error?.message ? " : " + error.message : ""
        }`,
      });
    }
  };
  const getRoutes = async (req, query) => {
    try {
      const { site_point_id } = query;
      const routeService = new ItemsService("routes", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const routeResult = await routeService.readByQuery({
        fields: [
          "id",
          "status",
          "user_created.first_name",
          "user_created.last_name",
          "user_updated.first_name",
          "user_updated.last_name",
          "date_created",
          "date_updated",
          "route_type_id.id",
          "route_type_id.name",
          "name",
          "code",
          "description",
          "other_attributes",
        ],
        filter: {
          _or: [
            { site_from: { _eq: site_point_id } },
            {
              site_to: {
                _eq: site_point_id,
              },
            },
          ],
        },
      });
      return routeResult;
    } catch (error) {
      logger.error(error);
      throw new ServiceUnavailableError({
        service: "getRoutes",
        reason: `Failed to get routes${
          error?.message ? " : " + error.message : ""
        }`,
      });
    }
  };
  const getCables = async (req, query) => {
    try {
      const { site_point_id, loc_type = "all" } = query;
      const cableService = new ItemsService("cables", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      let filters = {};
      if (loc_type == "on_site") {
        filters = {
          _or: [
            { site_from: { _eq: site_point_id } },
            {
              site_to: {
                _eq: site_point_id,
              },
            },
          ],
        };
      } else if (loc_type === "passing_site") {
        filters = {
          _and: [
            {
              _or: [
                {
                  routes: { route_id: { site_from: { _eq: site_point_id } } },
                },
                { routes: { route_id: { site_to: { _eq: site_point_id } } } },
              ],
            },
            { site_from: { _neq: site_point_id } },
            {
              site_to: {
                _neq: site_point_id,
              },
            },
          ],
        };
      } else {
        filters = {
          _or: [
            { site_from: { _eq: site_point_id } },
            {
              site_to: {
                _eq: site_point_id,
              },
            },
            {
              routes: { route_id: { site_from: { _eq: site_point_id } } },
            },
            { routes: { route_id: { site_to: { _eq: site_point_id } } } },
          ],
        };
      }
      const cableResult = await cableService.readByQuery({
        fields: [
          "*",
          "user_created.first_name",
          "user_created.last_name",
          "user_updated.first_name",
          "user_updated.last_name",
          "cable_type_id.id",
          "cable_type_id.name",
        ],
        filter: filters,
      });
      return cableResult;
    } catch (error) {
      logger.error(error);
      throw new ServiceUnavailableError({
        service: "getCables",
        reason: `Failed to get cables${
          error?.message ? " : " + error.message : ""
        }`,
      });
    }
  };
  const getCablesById = async (req, cable_id) => {
    try {
      const result = await database("cables")
        .select("cables.id", "cables.name", "cables.code")
        .select(
          database.raw("ST_AsGeojson(ST_Union(routes.geom))::jsonb AS geom")
        )
        .innerJoin("cable_routes as cr", "cables.id", "cr.cable_id")
        .innerJoin("routes", "cr.route_id", "routes.id")
        .whereNotNull("routes.geom")
        .andWhere("cables.id", cable_id)
        .groupBy("cables.id")
        .first();
      return result;
    } catch (error) {
      logger.error(error);
      throw new ServiceUnavailableError({
        service: "getCables",
        reason: `Failed to get cables${
          error?.message ? " : " + error.message : ""
        }`,
      });
    }
  };
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

  function toCSV(data) {
    if (!data.length) return "";

    const headers = Object.keys(data[0]);
    const escape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;

    const rows = data.map((row) =>
      headers.map((h) => escape(row[h])).join(",")
    );

    return [headers.join(","), ...rows].join("\n");
  }

  router.get("/site-point-info/:id", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }

      const { id: site_point_id } = req.params;
      const siteResult = await getSite(req, site_point_id);
      const assetResult = await getAssets(req, { site_point_id });
      const routeResult = await getRoutes(req, { site_point_id });
      const cableResult = await getCables(req, { site_point_id });
      return res.send({
        data: {
          ...siteResult,
          assets: assetResult,
          routes: routeResult,
          cables: cableResult,
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/routes",
          reason: `Failed to get routes${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/assets", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { site_point_id } = req.query;
      const result = await getAssets(req, { site_point_id });
      return res.send({ data: result });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/assets",
          reason: `Failed to get assets${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/routes", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { site_point_id } = req.query;
      const result = await getRoutes(req, { site_point_id });
      return res.send({ data: result });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/routes",
          reason: `Failed to get routes${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/cables", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { site_point_id, loc_type } = req.query;
      const result = await getCables(req, { site_point_id, loc_type });
      return res.send({ data: result });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/cables",
          reason: `Failed to get cables${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/cables/:id", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { id: cable_id } = req.params;
      const result = await getCablesById(req, cable_id);
      return res.send({ data: result });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/cables/:id",
          reason: `Failed to get cables by id${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/site-point-connections", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }

      const { site_point_id } = req.query;
      if (!site_point_id) {
        return next(
          new InvalidPayloadError({ reason: "site_point_id is required" })
        );
      }

      const rows = await database("routes")
        .select(
          "routes.id as route_id",
          "routes.name as route_name",
          "routes.code as route_code",
          "route_types.name as route_type",
          "site_from.id as from_id",
          "site_from.name as from_name",
          "site_from.code as from_code",
          "site_to.id as to_id",
          "site_to.name as to_name",
          "site_to.code as to_code"
        )
        .select(
          database.raw("ST_AsGeoJSON(routes.geom)::jsonb AS geometry")
        )
        .leftJoin(
          "route_types",
          "routes.route_type_id",
          "route_types.id"
        )
        .leftJoin(
          "site_points as site_from",
          "routes.site_from",
          "site_from.id"
        )
        .leftJoin("site_points as site_to", "routes.site_to", "site_to.id")
        .where(function () {
          this.where("routes.site_from", site_point_id).orWhere(
            "routes.site_to",
            site_point_id
          );
        });

      const features = [];
      const data = rows.map((r) => {
        const direction =
          String(r.from_id) === String(site_point_id) ? "outgoing" : "incoming";
        if (r.geometry) {
          features.push({
            type: "Feature",
            id: r.route_id,
            geometry: r.geometry,
            properties: {
              route_id: r.route_id,
              route_name: r.route_name,
              route_code: r.route_code,
              route_type: r.route_type,
              direction,
            },
          });
        }
        return {
          route_id: r.route_id,
          route_name: r.route_name,
          route_code: r.route_code,
          route_type: r.route_type,
          from: r.from_id
            ? { id: r.from_id, name: r.from_name, code: r.from_code }
            : null,
          to: r.to_id
            ? { id: r.to_id, name: r.to_name, code: r.to_code }
            : null,
          direction,
        };
      });

      return res.send({
        data,
        geojson: { type: "FeatureCollection", features },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/site-point-connections",
          reason: `Failed to get connections${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/site_points", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const body = req.body;
      const payload = [];
      for (const item of body) {
        const { geom } = item;
        const { rows: codeResult } = await database.raw(
          `WITH c AS (
            SELECT city_id
            FROM area_cities
            WHERE ST_Covers(geom,ST_SetSRID(ST_GeomFromGeoJSON(?), 4326))
            LIMIT 1
          ), next_seq AS (
            UPDATE area_cities ac
            SET site_seq = ac.site_seq + 1
            WHERE ac.city_id = (SELECT city_id FROM c)
            RETURNING ac.ogc_fid, ac.city_id, ac.site_seq
          ) SELECT
              next_seq.ogc_fid,
              CONCAT(replace(next_seq.city_id, '.', ''), '-', next_seq.site_seq) AS site_code
            FROM next_seq;`,
          [JSON.stringify(geom)]
        );
        const result = codeResult[0];
        if (!result) {
          return next(
            new InvalidPayloadError({
              reason: `city not found for location : ${JSON.stringify(geom)}`,
            })
          );
        }
        const { ogc_fid, site_code } = result;
        item.area_city_id = ogc_fid;
        if (!item.code || item.code.trim() === "") {
          item.code = site_code;
        }
        if (!item.name || item.name.trim() === "") {
          item.name = site_code;
        }
        payload.push(item);
      }

      const sitePointService = new ItemsService("site_points", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const result = await sitePointService.createMany(payload);

      return res.send({ data: result });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/site_points",
          reason: `Failed to post site points${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/tabular/asset_ports", async (req, res, next) => {
    try {
      const { accountability, sanitizedQuery } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      let {
        filter,
        limit = 100,
        sort = "asset_id,port_type,number",
        page = 1,
      } = req.query;

      const metaService = new MetaService({
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const meta = await metaService.getMetaForQuery(
        "asset_ports",
        sanitizedQuery
      );

      const portService = new ItemsService("asset_ports", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const portResult = await portService.readByQuery({
        fields: [
          "*",
          "asset_id.*",
          "asset_id.asset_type_id.name",
          "asset_id.site_point_id.name",
          "asset_id.site_point_id.code",
          "asset_id.site_point_id.geom",
          "asset_id.site_point_id.area_city_id.province",
          "asset_id.site_point_id.area_city_id.city",
        ],
        filter: filter,
        limit: Number(limit),
        page: Number(page),
        sort: sort.split(","),
      });

      const currentPage = Number(page);
      const pageLimit = Number(limit);

      const result = portResult.map((item, index) => ({
        no: (currentPage - 1) * pageLimit + (index + 1),
        path: item.path,
        asset_id: item?.asset_id?.id,
        port_id: item.id,
        asset_type: item?.asset_id?.asset_type_id?.name,
        asset_name: item?.asset_id?.name,
        asset_code: item?.asset_id?.code,
        description: item?.asset_id?.description,
        location: item?.asset_id?.location,
        location_detail: item?.asset_id?.location_detail,
        tag_id: item?.asset_id?.tag_id,
        rfid: item?.asset_id?.rfid,
        serial_number: item?.asset_id?.serial_number,
        port_type: item.port_type,
        port_no: item.number,
        port_speed: item.port_speed,
        port_description: item.port_description,
        sfp_connected_to_port: item.sfp_connected_to_port,
        sfp_length: item.sfp_length,
        sfp_serial: item.sfp_serial,
        opm_dbm: item.opm_dbm,
        aggregation_code: item.aggregation_code,
        port_identifier: item.port_identifier,
        port_status: item.port_status,
        date_of_purchase: item?.asset_id?.date_of_purchase,
        date_of_install: item?.asset_id?.date_of_install,
        date_of_service: item?.asset_id?.date_of_service,
        date_of_warranty_expiration:
          item?.asset_id?.date_of_warranty_expiration,
        date_of_last_inspection: item?.asset_id?.date_of_last_inspection,
        last_inspected_by: item?.asset_id?.last_inspected_by,
        date_of_maintenance_expiration:
          item?.asset_id?.date_of_maintenance_expiration,
        maintenance_by: item?.asset_id?.maintenance_by,
        service_log_ticket_number: item?.asset_id?.service_log_ticket_number,
        site_name: item?.asset_id?.site_point_id?.name,
        site_code: item?.asset_id?.site_point_id?.code,
        latitude: item?.asset_id?.site_point_id?.geom?.coordinates[1],
        longitude: item?.asset_id?.site_point_id?.geom?.coordinates[0],
        province: item?.asset_id?.site_point_id?.area_city_id?.province,
        city: item?.asset_id?.site_point_id?.area_city_id?.city,
      }));

      return res.send({ meta: meta, data: result });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/tabular/asset_ports",
          reason: `Failed to get asset ports${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/tabular/cable_cores", async (req, res, next) => {
    try {
      const { accountability, sanitizedQuery } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      let {
        filter,
        limit = 100,
        sort = "cable_id,tube,core",
        page = 1,
        download,
      } = req.query;

      const isCSV = download === "csv";

      const metaService = new MetaService({
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const meta = await metaService.getMetaForQuery(
        "cable_cores",
        sanitizedQuery
      );

      const coreService = new ItemsService("cable_cores", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const coreResult = await coreService.readByQuery({
        fields: [
          "*",
          "cable_id.*",
          "cable_id.cable_type_id.name",
          "cable_id.site_from.name",
          "cable_id.site_from.code",
          "cable_id.site_from.geom",
          "cable_id.site_from.area_city_id.province",
          "cable_id.site_from.area_city_id.city",
          "cable_id.site_to.name",
          "cable_id.site_to.code",
          "cable_id.site_to.geom",
          "cable_id.site_to.area_city_id.province",
          "cable_id.site_to.area_city_id.city",
        ],
        filter: filter,
        limit: isCSV ? -1 : Number(limit),
        page: isCSV ? 1 : Number(page),
        sort: sort.split(","),
      });

      const currentPage = Number(page);
      const pageLimit = Number(limit);

      const result = coreResult.map((item, index) => ({
        no: (currentPage - 1) * pageLimit + (index + 1),
        path: item.path,
        cable_id: item?.cable_id?.id,
        core_id: item.id,
        cable_type: item?.cable_id?.cable_type_id?.name,
        cable_name: item?.cable_id?.name,
        cable_code: item?.cable_id?.code,
        description: item?.cable_id?.description,
        location: item?.cable_id?.location,
        location_detail: item?.cable_id?.location_detail,
        tag_id: item?.cable_id?.tag_id,
        rfid: item?.cable_id?.rfid,
        serial_number: item?.cable_id?.serial_number,
        cable_tube: item?.tube,
        cable_core: item?.core,
        core_from_status: item?.from,
        core_to_status: item?.to,
        cable_net_length_m: item?.cable_id?.cable_net_length_m,
        cable_gross_length_m: item?.cable_id?.cable_gross_length_m,
        date_of_purchase: item?.cable_id?.date_of_purchase,
        date_of_install: item?.cable_id?.date_of_install,
        date_of_service: item?.cable_id?.date_of_service,
        date_of_warranty_expiration:
          item?.cable_id?.date_of_warranty_expiration,
        date_of_last_inspection: item?.cable_id?.date_of_last_inspection,
        last_inspected_by: item?.cable_id?.last_inspected_by,
        date_of_maintenance_expiration:
          item?.cable_id?.date_of_maintenance_expiration,
        maintenance_by: item?.cable_id?.maintenance_by,
        service_log_ticket_number: item?.cable_id?.service_log_ticket_number,
        site_from_name: item?.cable_id?.site_from?.name,
        site_from_code: item?.cable_id?.site_from?.code,
        from_latitude: item?.cable_id?.site_from?.geom?.coordinates[1],
        from_longitude: item?.cable_id?.site_from?.geom?.coordinates[0],
        from_province: item?.cable_id?.site_from?.area_city_id?.province,
        from_city: item?.cable_id?.site_from?.area_city_id?.city,
        site_to_name: item?.cable_id?.site_to?.name,
        site_to_code: item?.cable_id?.site_to?.code,
        to_latitude: item?.cable_id?.site_to?.geom?.coordinates[1],
        to_longitude: item?.cable_id?.site_to?.geom?.coordinates[0],
        to_province: item?.cable_id?.site_to?.area_city_id?.province,
        to_city: item?.cable_id?.site_to?.area_city_id?.city,
      }));

      if (isCSV) {
        const csv = toCSV(result);
        const filename = `cable_cores_${Date.now()}.csv`;

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${filename}"`
        );

        return res.send(csv);
      }

      return res.send({ meta: meta, data: result });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/tabular/asset_ports",
          reason: `Failed to get asset ports${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/tabular/v2/asset_ports", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const {
        asset_type_id,
        site_name,
        site_code,
        asset_name,
        asset_code,
        asset_type,
        port_status,
        limit = 100,
        page = 1,
        download,
      } = req.query;

      const is_playground = req.query.is_playground
        ? req.query.is_playground.toLowerCase() === "true"
        : true;

      const resultPlayground = await getPlaygrounds(req, next, is_playground);
      const { playgroundProvinces, playgroundCities } = resultPlayground;

      const isCSV = download === "csv";

      const currentPage = Number(page);
      const pageLimit = Number(limit);
      const offset = (currentPage - 1) * pageLimit;

      const baseQuery = database("assets as a")
        .innerJoin("site_points as sp", "a.site_point_id", "sp.id")
        .innerJoin("asset_types as ats", "a.asset_type_id", "ats.id")
        .leftJoin("asset_ports as ap", "a.id", "ap.asset_id")
        .leftJoin("area_cities as ac", "sp.area_city_id", "ac.ogc_fid")
        .where((qb) => {
          if (asset_type_id) {
            qb.andWhere("a.asset_type_id", asset_type_id);
          }

          if (site_name) {
            qb.andWhereILike("sp.name", `%${site_name}%`);
          }

          if (site_code) {
            qb.andWhereILike("sp.code", `%${site_code}%`);
          }

          if (asset_name) {
            qb.andWhereILike("a.name", `%${asset_name}%`);
          }

          if (asset_code) {
            qb.andWhereILike("a.code", `%${asset_code}%`);
          }

          if (asset_type) {
            qb.andWhereILike("ats.name", `%${asset_type}%`);
          }

          if (port_status) {
            qb.andWhere("ap.port_status", port_status);
          }

          if (is_playground) {
            if (playgroundProvinces?.length) {
              qb.whereIn("ac.province_id", playgroundProvinces);
            }
            if (playgroundCities?.length) {
              qb.whereIn("ac.city_id", playgroundCities);
            }
          }
        });

      const [{ filter_count }] = await baseQuery
        .clone()
        .count("* as filter_count");

      const portResultQuery = baseQuery
        .clone()
        .select(
          "ap.path",
          { asset_id: "a.id" },
          { port_id: "ap.id" },
          { asset_type: "ats.name" },
          { asset_name: "a.name" },
          { asset_code: "a.code" },
          "a.description",
          "a.location",
          "a.location_detail",
          "a.tag_id",
          "a.rfid",
          "a.serial_number",
          "ap.port_type",
          { port_no: "ap.number" },
          "ap.port_speed",
          "ap.port_description",
          "ap.sfp_connected_to_port",
          "ap.sfp_length",
          "ap.sfp_serial",
          "ap.opm_dbm",
          "ap.aggregation_code",
          "ap.port_identifier",
          "ap.port_status",
          "a.date_of_purchase",
          "a.date_of_install",
          "a.date_of_service",
          "a.date_of_warranty_expiration",
          "a.date_of_last_inspection",
          "a.last_inspected_by",
          "a.date_of_maintenance_expiration",
          "a.maintenance_by",
          "a.service_log_ticket_number",
          { site_name: "sp.name" },
          { site_code: "sp.code" },
          database.raw("ST_Y(sp.geom) AS latitude"),
          database.raw("ST_X(sp.geom) AS longitude"),
          "ac.province",
          "ac.city"
        )
        .orderBy([
          { column: "a.id", order: "asc" },
          { column: "ap.port_type", order: "asc" },
          { column: "ap.number", order: "asc" },
        ]);

      if (!isCSV) {
        portResultQuery.limit(pageLimit).offset(offset);
      }

      const portResult = await portResultQuery;
      const data = portResult.map((item, index) => ({
        no: offset + index + 1,
        ...item,
      }));

      if (isCSV) {
        const csv = toCSV(data);

        res.setHeader("Content-Type", "text/csv; charset=utf-8");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="asset_ports_${Date.now()}.csv"`
        );

        return res.send(csv);
      }
      return res.send({
        meta: {
          filter_count: Number(filter_count),
        },
        data,
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/tabular/v2/asset_ports",
          reason: `Failed to get asset ports${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });

  router.get("/tower-list/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const result = await database("site_points as sp")
        .select("sp.owner")
        .max("sp.date_created as latest_date_created")
        .whereNotNull("sp.owner")
        .groupBy("sp.owner")
        .orderBy("latest_date_created", "desc");

      return res.json({
        data: result,
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/tower-list",
          reason: "Failed to get tower list",
        })
      );
    }
  });
  router.get("/poi-jenjang-list/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const result = await database("poi as p")
        .select("p.jenjang as owner")
        .where("p.category", "school")
        .whereNotNull("p.jenjang")
        .groupBy("p.jenjang")
        .orderBy("p.jenjang", "ASC");

      return res.json({
        data: result,
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/poi-jenjang-list",
          reason: "Failed to get poi jenjang list",
        })
      );
    }
  });
  router.get("/poi-ruko-list/", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const result = await database("poi as p")
        .select("p.category as owner")
        .where("p.group", "Ruko")
        .groupBy("p.category")
        .orderBy("p.category", "ASC");

      return res.json({
        data: result,
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/poi-jenjang-list",
          reason: "Failed to get poi jenjang list",
        })
      );
    }
  });

  router.patch("/move-site-point/:site_point_id", async (req, res, next) => {
    const { accountability } = req;
    if (!accountability.user) {
      return next(new ForbiddenError());
    }
    const { geom } = req.body;
    if (!geom || geom.type !== "Point" || geom.coordinates?.length !== 2) {
      return next(
        new InvalidPayloadError({
          reason: `geom not found or invalid`,
        })
      );
    }
    const trx = await database.transaction();
    const { site_point_id } = req.params;
    try {
      const { ip, userAgent, origin } = getRequestMeta(req);
      const longitudeNew = geom.coordinates[0];
      const latitudeNew = geom.coordinates[1];

      const siteOld = await trx("site_points")
        .select(
          trx.raw("ST_X(geom) as longitude"),
          trx.raw("ST_Y(geom) as latitude")
        )
        .where("id", site_point_id)
        .first();
      if (!siteOld) {
        throw new InvalidPayloadError({ reason: "site_point not found" });
      }
      const { longitude: longitudeOld, latitude: latitudeOld } = siteOld;

      const { rows: editedSite } = await trx.raw(
        `WITH geom_data AS (
            SELECT ST_Force2D(ST_GeomFromGeoJSON(?)) As geom
        ) UPDATE site_points
          SET geom=geom_data.geom, date_updated=NOW(), user_updated=?
          FROM geom_data
          WHERE id=?
          RETURNING site_points.id, ST_AsGeoJSON(site_points.geom)::jsonb geom;`,
        [geom, accountability.user, site_point_id]
      );
      await trx("directus_activity").insert({
        action: "update",
        user: accountability.user,
        timestamp: trx.fn.now(),
        ip: ip,
        user_agent: userAgent,
        collection: "site_points",
        item: site_point_id,
        comment: null,
        origin: origin,
      });

      const routes = await trx("routes")
        .select("id")
        .where((qb) => {
          qb.where("site_from", site_point_id).orWhere(
            "site_to",
            site_point_id
          );
        });

      const editedRoute = [];
      for (const route of routes) {
        const { rows } = await trx.raw(
          `WITH closest_point AS (
              SELECT
                id,
                CASE
                  WHEN ST_Distance(ST_StartPoint(geom), ST_SetSRID(ST_MakePoint(?, ?),4326)) <
                    ST_Distance(ST_EndPoint(geom), ST_SetSRID(ST_MakePoint(?, ?),4326))
                  THEN 0
                  ELSE ST_NPoints(geom) - 1
                END AS point_index
              FROM routes
              WHERE id = ?
            ) UPDATE routes
              SET
                date_updated=NOW(),
                geom = ST_SetPoint(geom, point_index, ST_SetSRID(ST_MakePoint(?, ?),4326))
              FROM closest_point
              WHERE routes.id = closest_point.id
              RETURNING routes.id, ST_AsGeoJSON(routes.geom)::jsonb geom;`,
          [
            longitudeOld,
            latitudeOld,
            longitudeOld,
            latitudeOld,
            route.id,
            longitudeNew,
            latitudeNew,
          ]
        );
        await trx("directus_activity").insert({
          action: "update",
          user: accountability.user,
          timestamp: trx.fn.now(),
          ip: ip,
          user_agent: userAgent,
          collection: "routes",
          item: route.id,
          comment: null,
          origin: origin,
        });
        editedRoute.push(...rows);
      }

      await trx.commit();
      await clearCache(logger, env);

      return res.send({
        data: { ...editedSite[0], routes: editedRoute },
      });
    } catch (error) {
      logger.error(error);
      await trx.rollback();

      if (
        error instanceof InvalidPayloadError ||
        error instanceof ForbiddenError
      ) {
        return next(error);
      }
      return next(
        new ServiceUnavailableError({
          service: "data/move-site-point/:site_point_id",
          reason: `Failed move site point${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });

  router.get("/activity", async (req, res, next) => {
    const { accountability } = req;
    if (!accountability.user) {
      return next(new ForbiddenError());
    }
    const { limit = 10 } = req.query;
    try {
      const activityService = new ItemsService("directus_activity", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const activityResult = await activityService.readByQuery({
        fields: [
          "id",
          "timestamp",
          "action",
          "user.first_name",
          "user.last_name",
          "user.email",
          "collection",
          "item",
        ],
        filter: {
          collection: { _in: ["site_points", "assets", "routes", "cables"] },
          action: { _in: ["create", "update"] },
        },
        sort: ["-id"],
        limit: Number(limit),
      });
      const results = [];
      for (const item of activityResult) {
        if (item.collection == "site_points") {
          const data = await database("site_points")
            .select(
              "id",
              "name",
              "code",
              database.raw("ST_AsGeoJSON(geom)::jsonb geom")
            )
            .where("id", item.item)
            .first();
          results.push({ ...item, item_info: data ?? {} });
        } else if (item.collection == "assets") {
          const data = await database("assets as a")
            .select(
              "a.id",
              "a.name",
              "a.code",
              database.raw("ST_AsGeoJSON(sp.geom)::jsonb as geom")
            )
            .innerJoin("site_points as sp", "a.site_point_id", "sp.id")
            .where("a.id", item.item)
            .first();
          results.push({ ...item, item_info: data ?? {} });
        } else if (item.collection == "routes") {
          const data = await database("routes")
            .select(
              "id",
              "name",
              "code",
              database.raw("ST_AsGeoJSON(geom)::jsonb geom")
            )
            .where("id", item.item)
            .first();
          results.push({ ...item, item_info: data ?? {} });
        } else if (item.collection == "cables") {
          const data = await getCablesById(req, item.item);
          results.push({ ...item, item_info: data ?? {} });
        }
      }
      return res.send({ data: results });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "data/activity",
          reason: `Failed to get activity${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });

  router.get("/ftth-project/export-kml", async (req, res, next) => {
    const { accountability } = req;
    if (!accountability.user) {
      return next(new ForbiddenError());
    }

    const { project_id } = req.query;
    if (!project_id) {
      return next(new Error("project_id required"));
    }

    try {
      // --- 1. Ambil data GeoJSON dari PostGIS ---
      const site_points = await database
        .select(
          "sp.id",
          "sp.name",
          "type.name AS type_name",
          database.raw("ST_AsGeoJSON(sp.geom) AS geom")
        )
        .from("site_points AS sp")
        .innerJoin(
          "site_point_types AS type",
          "sp.site_point_type_id",
          "type.id"
        )
        .innerJoin("project_site_points AS prj", "sp.id", "prj.site_point_id")
        .where("prj.project_id", project_id);

      const assets = await database
        .select(
          "a.id",
          "a.name",
          "type.name AS type_name",
          database.raw("ST_AsGeoJSON(site.geom) AS geom")
        )
        .from("assets AS a")
        .innerJoin("site_points AS site", "a.site_point_id", "site.id")
        .innerJoin("asset_types AS type", "a.asset_type_id", "type.id")
        .innerJoin("project_assets AS prj", "a.id", "prj.asset_id")
        .where("prj.project_id", project_id);

      const routes = await database
        .select(
          "r.id",
          "r.name",
          "type.name AS type_name",
          database.raw("ST_AsGeoJSON(r.geom) AS geom")
        )
        .from("routes AS r")
        .innerJoin("route_types AS type", "r.route_type_id", "type.id")
        .innerJoin("project_routes AS prj", "r.id", "prj.route_id")
        .where("prj.project_id", project_id);

      const cables = await database("cables AS c")
        .select(
          "c.id",
          "c.name",
          "type.name AS type_name",
          database.raw("ST_AsGeoJSON(ST_Union(r.geom)) AS geom")
        )
        .innerJoin("cable_types AS type", "c.cable_type_id", "type.id")
        .innerJoin("cable_routes AS cr", "c.id", "cr.cable_id")
        .innerJoin("routes AS r", "cr.route_id", "r.id")
        .innerJoin("project_cables AS prj", "c.id", "prj.cable_id")
        .where("prj.project_id", project_id)
        .groupBy("c.id", "c.name", "type.name");

      // --- 2. Helper buat sub-folder per type_name ---
      const kmlSubFolder = async (folderName, items) => {
        const folderItem = { name: [folderName], Folder: [] };
        // Group items by type_name
        const grouped = items.reduce((acc, item) => {
          const type = item.type_name || "Unknown";
          if (!acc[type]) acc[type] = [];
          acc[type].push(item);
          return acc;
        }, {});

        for (const [category, features] of Object.entries(grouped)) {
          const geojson = {
            type: "FeatureCollection",
            features: features.map((f) => ({
              type: "Feature",
              properties: { name: f.name },
              geometry: JSON.parse(f.geom),
            })),
          };
          const kmlData = tokml(geojson);
          const parsed = await parser.parseStringPromise(kmlData);
          const placemarks = parsed.kml.Document[0].Placemark || [];
          if (placemarks.length > 0) {
            folderItem.Folder.push({
              name: [category],
              Placemark: placemarks,
            });
          }
        }
        return folderItem;
      };

      // --- 3. Build merged KML ---
      const mergedKML = {
        kml: {
          $: { xmlns: "http://www.opengis.net/kml/2.2" },
          Document: [{ Folder: [] }],
        },
      };

      mergedKML.kml.Document[0].Folder.push(
        await kmlSubFolder("Site Points", site_points)
      );
      mergedKML.kml.Document[0].Folder.push(
        await kmlSubFolder("Assets", assets)
      );
      mergedKML.kml.Document[0].Folder.push(
        await kmlSubFolder("Routes", routes)
      );
      mergedKML.kml.Document[0].Folder.push(
        await kmlSubFolder("Cables", cables)
      );

      // --- 4. Generate KML string ---
      const kmlString = builder.buildObject(mergedKML);

      // --- 5. Kirim file sebagai response (download) ---
      res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="ftth_project_${project_id}.kml"`
      );
      res.send(kmlString);
    } catch (err) {
      console.error(err);
      return next(new Error("Failed to export KML"));
    }
  });
};
