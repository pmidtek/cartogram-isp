import {
  InvalidPayloadError,
  ServiceUnavailableError,
  ForbiddenError,
} from "@directus/errors";

import { randomUUID } from "crypto";

export default (router, { database, logger, services }) => {
  const { ItemsService, MetaService } = services;
  const generateAssetOnRoute = async (database, route_id, spacing) => {
    try {
      const routeData = await database("routes")
        .select(database.raw("ST_Length(geom, false) AS length"))
        .where("id", route_id)
        .first();

      if (!routeData) {
        throw new InvalidPayloadError({
          reason: `Route with id ${route_id} not found`,
        });
      }
      const route_length = routeData.length;
      let count_point = Math.floor(route_length / parseInt(spacing));

      let validation = true;
      if (count_point == 0) {
        validation = false;
      }

      let start_point = parseInt(spacing) / route_length;
      let step_point = start_point;
      let end_point = count_point * step_point;

      const { rows: sitesData } = await database.raw(
        `WITH geom_data AS (
          SELECT ST_LineInterpolatePoint(geom, generate_series((?)::numeric, (?)::numeric, (?)::numeric)) AS geom
          FROM routes
          WHERE id = ?
        ) SELECT json_build_object('type', 'FeatureCollection', 'features', json_agg(ST_AsGeoJSON(t.*)::json)) AS geojson
          FROM geom_data AS t;`,
        [start_point, 1, step_point, route_id]
      );
      const geojson_site = sitesData[0].geojson;

      let splices = [];
      for (let i = 1; i <= count_point; i++) {
        let start = (i - 1) * step_point;
        splices.push(`ST_LineSubstring(geom, ${start}, ${i * step_point})`);
      }
      splices.push(`ST_LineSubstring(geom, ${count_point * step_point}, 1.0)`);

      const { rows: routesData } = await database.raw(
        `WITH geom_data AS (
          SELECT unnest(ARRAY[ ${
            splices.length
              ? splices.join(",")
              : `ST_LineSubstring(geom, 0.0, 1.0)`
          }]) AS geom
          FROM routes
          WHERE id = ?
        ) SELECT json_build_object('type', 'FeatureCollection', 'features', json_agg(ST_AsGeoJSON(t.*)::json)) AS geojson
          FROM geom_data AS t;`,
        [route_id]
      );
      const geojson_route = routesData[0].geojson;

      return { validation, route_length, geojson_site, geojson_route };
    } catch (error) {
      logger.error(error);
      throw error;
    }
  };
  const checkRouteSiteFromSiteTo = async (database, route_id) => {
    try {
      const { rows } = await database.raw(
        `SELECT
          routes.site_from, routes.site_to,
          site_from.code AS site_from_code, site_to.code AS site_to_code,
          ST_AsText(ST_StartPoint(routes.geom)) AS start_point,
          ST_AsText(ST_EndPoint(routes.geom)) AS end_point,
          ST_AsText(site_from.geom) AS site_from_point,
          ST_AsText(site_to.geom) AS site_to_point,
          ST_Distance(ST_StartPoint(routes.geom), site_from.geom, false) AS dsf,
          ST_Distance(ST_StartPoint(routes.geom), site_to.geom, false) AS dse,
          ST_Distance(ST_EndPoint(routes.geom), site_from.geom, false) AS def,
          ST_Distance(ST_EndPoint(routes.geom), site_to.geom, false) AS dee
        FROM routes
        INNER JOIN site_points AS site_from
        ON routes.site_from = site_from.id
        INNER JOIN site_points AS site_to
        ON routes.site_to = site_to.id
        WHERE routes.id=?;`,
        [route_id]
      );

      if (!rows?.length) {
        throw new InvalidPayloadError({
          reason: `Route with id ${route_id} not found`,
        });
      }

      const row = rows[0];
      const { site_from, site_to, site_from_code, site_to_code, dsf, def } =
        row;
      const isForwardDirection = dsf < def;

      logger.info(
        `isForwardDirection ${isForwardDirection} | dsf: ${dsf}, def: ${def}`
      );

      return isForwardDirection
        ? { site_from, site_to, site_from_code, site_to_code }
        : {
            site_from: site_to,
            site_to: site_from,
            site_from_code: site_to_code,
            site_to_code: site_from_code,
          };
    } catch (error) {
      throw error;
    }
  };
  const getCablesListByRouteId = async (database, route_id) => {
    try {
      const rows = await database("cable_routes")
        .select("cable_id")
        .where("route_id", route_id);
      return rows;
    } catch (error) {
      throw error;
    }
  };
  const cableSitePart = async (database, cable_id, site_to, site_from) => {
    try {
      const { rows } = await database.raw(`
        SELECT data.node AS site_point_id FROM pgr_Dijkstra(
          'SELECT cable_routes.route_id AS id, routes.site_from AS source, routes.site_to AS target, 1 AS cost
            FROM cable_routes
            INNER JOIN routes ON cable_routes.route_id = routes.id
            WHERE cable_routes.cable_id=${cable_id}',
        ${site_to}, ${site_from}, false) AS data
     ;`);
      return rows;
    } catch (error) {
      throw error;
    }
  };
  const cableRoutePart = async (database, cable_id, site_to, site_from) => {
    try {
      const { rows } = await database.raw(`
      SELECT data.edge AS route_id, data.cost AS route_length FROM pgr_Dijkstra(
        'SELECT cable_routes.route_id AS id, routes.site_from AS source, routes.site_to AS target, ST_Length(routes.geom,false) AS cost
          FROM cable_routes
          INNER JOIN routes
          ON cable_routes.route_id = routes.id
          WHERE cable_routes.cable_id=${cable_id}',
      ${site_to}, ${site_from}, false) AS data
      INNER JOIN routes ON data.edge = routes.id;`);
      return rows;
    } catch (error) {
      throw error;
    }
  };

  router.post("/generate-asset-on-route-preview", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const { route_id, spacing } = req.body;
      if (!route_id || !spacing) {
        return next(
          new InvalidPayloadError({
            reason: "route_id and spacing is required",
          })
        );
      }

      const { validation, route_length, geojson_site, geojson_route } =
        await generateAssetOnRoute(database, route_id, spacing);

      return res.json({
        data: {
          validation,
          length: route_length,
          spacing: spacing,
          geojson_site,
          geojson_route,
        },
      });
    } catch (error) {
      logger.error(error);

      if (
        error instanceof InvalidPayloadError ||
        error instanceof ForbiddenError
      ) {
        return next(error);
      }
      return next(
        new ServiceUnavailableError({
          service: "data-process/generate-asset-on-route-preview",
          reason: "Failed to generate asset on route preview",
        })
      );
    }
  });
  router.post("/generate-asset-on-route", async (req, res, next) => {
    const trx = await database.transaction();
    try {
      if (!req.accountability.user) {
        throw new ForbiddenError();
      }
      const {
        route_id,
        spacing,
        site_point_type_id = 4, //General
        route_type_id = 1,
        asset_type_id = 22, //POLE
      } = req.body;
      if (!route_id || !spacing) {
        throw new InvalidPayloadError({
          reason: "route_id and spacing are required",
        });
      }
      const { validation, route_length, geojson_site, geojson_route } =
        await generateAssetOnRoute(database, route_id, spacing);

      if (!validation) {
        throw new InvalidPayloadError({
          reason: `Invalid data for generate asset on route`,
        });
      }

      const {
        site_from: route_site_from,
        site_to: route_site_to,
        site_from_code: route_site_from_code,
        site_to_code: route_site_to_code,
      } = await checkRouteSiteFromSiteTo(database, route_id);

      const cables = await getCablesListByRouteId(database, route_id);

      //insert site in transaction | update sequence not use transaction
      const site_features = geojson_site.features;
      const site_payload = [];
      for (const item of site_features) {
        const { geometry: geom } = item;
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
          throw new InvalidPayloadError({
            reason: `city not found for location : ${JSON.stringify(geom)}`,
          });
        }
        const { ogc_fid, site_code } = result;
        if (!item.code || item.code.trim() === "") {
          item.code = site_code;
        }
        if (!item.name || item.name.trim() === "") {
          item.name = site_code;
        }
        site_payload.push({
          ...item,
          area_city_id: ogc_fid,
          site_point_type_id,
          geom,
        });
      }
      const sitePointService = new ItemsService("site_points", {
        accountability: req.accountability,
        schema: req.schema,
        knex: trx,
      });
      const site_result_ids = await sitePointService.createMany(site_payload);

      const site_result = await sitePointService.readMany(site_result_ids, {
        fields: ["id", "code", "geom"],
        sort: ["id"],
      });

      //insert asset in transaction
      const asset_payload = [];
      for (const site of site_result) {
        const assetCode = site.code + "-POLE-1";
        asset_payload.push({
          site_point_id: site.id,
          name: assetCode,
          code: assetCode,
          asset_type_id: asset_type_id,
        });
      }
      const assetService = new ItemsService("assets", {
        accountability: req.accountability,
        schema: req.schema,
        knex: trx,
      });
      const asset_result_ids = await assetService.createMany(asset_payload);

      //insert route in transaction
      const route_features = geojson_route.features;
      const route_payload = [];
      for (const [index, item] of route_features.entries()) {
        let site_from;
        let site_to;
        let name;
        let code;

        if (index == 0) {
          site_from = route_site_from;
          site_to = site_result[index].id;
          name = route_site_from_code + "-" + site_result[index].code;
        } else if (index == route_features.length - 1) {
          site_from = site_result[index - 1].id;
          site_to = route_site_to;
          name = site_result[index - 1].code + "-" + route_site_to_code;
        } else {
          site_from = site_result[index - 1].id;
          site_to = site_result[index].id;
          name = site_result[index - 1].code + "-" + site_result[index].code;
        }
        code = name;

        route_payload.push({
          route_type_id,
          site_from,
          site_to,
          name,
          code,
          geom: item.geometry,
        });
      }
      const routeService = new ItemsService("routes", {
        accountability: req.accountability,
        schema: req.schema,
        knex: trx,
      });
      const route_result_ids = await routeService.createMany(route_payload);

      //register route to cable routes
      let cable_route_result_ids = [];
      const cableRouteService = new ItemsService("cable_routes", {
        accountability: req.accountability,
        schema: req.schema,
        knex: trx,
      });
      const cable_route_payload = cables.flatMap((cable) =>
        route_result_ids.map((route_id) => ({
          cable_id: cable.cable_id,
          route_id: route_id,
        }))
      );
      if (cable_route_payload.length > 0) {
        const result = await cableRouteService.createMany(cable_route_payload);
        cable_route_result_ids.push(...result);
      }

      //delete cable_route old and route old
      await cableRouteService.deleteByQuery({
        filter: {
          route_id: route_id,
        },
      });
      await routeService.deleteOne(route_id);

      await trx.commit();
      return res.json({
        data: {
          length: route_length,
          spacing: spacing,
          site_result_ids,
          asset_result_ids,
          route_result_ids,
        },
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
          service: "data-process/generate-assset-on-route",
          reason: "Failed to generate assset on route",
        })
      );
    }
  });
  router.post("/split-route", async (req, res, next) => {
    const trx = await database.transaction();
    try {
      if (!req.accountability.user) {
        throw new ForbiddenError();
      }

      const { route_id, site_point_id } = req.body;
      if (!route_id || !site_point_id) {
        throw new InvalidPayloadError({
          reason: "route_id and site_point_id required",
        });
      }

      const route_old = await trx("routes")
        .select("id", "name", "code", "site_from", "site_to")
        .where("id", route_id)
        .first();
      const site_data = await trx("site_points")
        .select("id")
        .where("id", site_point_id)
        .first();

      if (!route_old) {
        throw new InvalidPayloadError({
          reason: "route_id not found",
        });
      }
      if (!site_data) {
        throw new InvalidPayloadError({
          reason: "site_point_id not found",
        });
      }
      if (
        site_point_id == route_old.site_from ||
        site_point_id == route_old.site_to
      ) {
        throw new InvalidPayloadError({
          reason: "site_point_id is start/end route",
        });
      }

      const splitResult = await trx.raw(
        `WITH calc AS (
          SELECT
            r.id AS route_id,
            ST_ClosestPoint(r.geom, sp.geom) AS cp,
            ST_LineLocatePoint(r.geom, sp.geom) AS frac,
            r.geom AS route_geom,
            sp.geom AS site_geom
          FROM routes r
          INNER JOIN site_points sp ON sp.id = ?
          WHERE r.id = ?
        ) SELECT
            frac,
            ST_AsGeoJSON(ST_MakeLine(ST_LineSubstring(route_geom, 0, frac), site_geom))::jsonb AS geom_1,
            ST_AsGeoJSON(ST_MakeLine(site_geom,ST_LineSubstring(route_geom, frac, 1)))::jsonb AS geom_2
          FROM calc;`,
        [site_point_id, route_id]
      );

      const row = splitResult.rows[0];
      if (!row || !row.geom_1 || !row.geom_2) {
        throw new InvalidPayloadError({
          reason: "failed to split route",
        });
      }

      const baseRouteName =
        route_old.name && route_old.name.trim() !== ""
          ? route_old.name
          : `route-${route_old.id}`;

      const baseRouteCode =
        route_old.code && route_old.code.trim() !== ""
          ? route_old.code
          : `route-${route_old.id}`;

      const routeName1 = `${baseRouteName}-1`;
      const routeName2 = `${baseRouteName}-2`;
      const routeCode1 = `${baseRouteCode}-1`;
      const routeCode2 = `${baseRouteCode}-2`;

      const routeService = new ItemsService("routes", {
        accountability: req.accountability,
        schema: req.schema,
        knex: trx,
      });

      const route1 = await routeService.updateOne(route_id, {
        name: routeName1,
        code: routeCode1,
        site_to: site_point_id,
        geom: row.geom_1,
      });

      const route2 = await routeService.createOne({
        name: routeName2,
        code: routeCode2,
        site_from: site_point_id,
        site_to: route_old.site_to,
        geom: row.geom_2,
      });

      const cables = await getCablesListByRouteId(database, route_id);

      let cable_route_result_ids = [];
      const cableRouteService = new ItemsService("cable_routes", {
        accountability: req.accountability,
        schema: req.schema,
        knex: trx,
      });

      const cable_route_payload = cables.flatMap((cable) => ({
        cable_id: cable.cable_id,
        route_id: route2,
      }));

      if (cable_route_payload.length > 0) {
        const result = await cableRouteService.createMany(cable_route_payload);
        cable_route_result_ids.push(...result);
      }

      await trx.commit();
      return res.json({
        data: { route1, route2 },
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
          service: "data-process/split-route",
          reason: "Failed to split route",
        })
      );
    }
  });
  router.post("/split-cable", async (req, res, next) => {
    const trx = await database.transaction();
    try {
      if (!req.accountability.user) {
        throw new ForbiddenError();
      }
      const { accountability } = req;

      const { cable_id, site_point_id, splice_asset_id } = req.body;
      if (!cable_id || !site_point_id || !splice_asset_id) {
        throw new InvalidPayloadError({
          reason: "route_id, site_point_id and splice_asset_id required",
        });
      }

      const cable_old = await trx("cables")
        .select("*")
        .where("id", cable_id)
        .first();
      const site_data = await trx("site_points")
        .select("id")
        .where("id", site_point_id)
        .first();

      if (!cable_old) {
        throw new InvalidPayloadError({
          reason: "cable_old not found",
        });
      }
      if (!site_data) {
        throw new InvalidPayloadError({
          reason: "site_point_id not found",
        });
      }

      //TODO handle cable cores
      // const cableCore = await trx("cable_cores")
      //   .select("id")
      //   .where("cable_id", cable_id)
      //   .first();

      // if (cableCore) {
      //   throw new InvalidPayloadError({
      //     reason: "cannot split cable that already has cable cores",
      //   });
      // }

      const cable_site_from = cable_old?.site_from;
      const cable_site_to = cable_old?.site_to;
      if (site_point_id == cable_site_from || site_point_id == cable_site_to) {
        throw new InvalidPayloadError({
          reason: "site_point_id is start/end cable",
        });
      }

      // list site point di cable | site harus dilewati cable
      const site_list_all = await cableSitePart(
        trx,
        cable_id,
        cable_site_from,
        cable_site_to
      );
      const cable_site_all = site_list_all.map((site) =>
        Number(site.site_point_id)
      );
      const sitePointIdInt = Number(site_point_id);

      if (!cable_site_all.includes(sitePointIdInt)) {
        throw new InvalidPayloadError({
          reason: "site_point_id not in cable",
        });
      }

      // listing route pada potongan cable-1 dan cable-2
      const route_list_old_cable = await cableRoutePart(
        trx,
        cable_id,
        cable_site_from,
        site_point_id
      );
      const route_list_new_cable = await cableRoutePart(
        trx,
        cable_id,
        site_point_id,
        cable_site_to
      );
      let route_old_length = 0;
      for (const route of route_list_old_cable) {
        route_old_length = route_old_length + parseFloat(route.route_length);
      }
      let route_new_length = 0;
      for (const route of route_list_new_cable) {
        route_new_length = route_new_length + parseFloat(route.route_length);
      }

      // listing site pada potongan cable-1 dan cable-2
      const site_list_old_cable = await cableSitePart(
        trx,
        cable_id,
        cable_site_from,
        site_point_id
      );
      const site_list_new_cable = await cableSitePart(
        trx,
        cable_id,
        site_point_id,
        cable_site_to
      );
      let cable_site_old = [];
      for (const site of site_list_old_cable) {
        if (site.site_point_id != site_point_id) {
          cable_site_old.push(site.site_point_id);
        }
      }
      let cable_site_new = [];
      for (const site of site_list_new_cable) {
        if (site.site_point_id != site_point_id) {
          cable_site_new.push(site.site_point_id);
        }
      }

      // Processing cable dan cable_route | SPLIT
      const cableService = new ItemsService("cables", {
        accountability: req.accountability,
        schema: req.schema,
        knex: trx,
      });
      const cableRouteService = new ItemsService("cable_routes", {
        accountability: req.accountability,
        schema: req.schema,
        knex: trx,
      });

      const baseName =
        cable_old.name && cable_old.name.trim() !== ""
          ? cable_old.name
          : `cable-${cable_old.id}`;
      const baseCode =
        cable_old.code && cable_old.code.trim() !== ""
          ? cable_old.code
          : `cable-${cable_old.id}`;

      //delete cable_route eksisting
      await cableRouteService.deleteByQuery({
        filter: {
          cable_id: {
            _eq: cable_id,
          },
        },
      });
      //edit site_from and site_to from old cable
      const cable1 = await cableService.updateOne(cable_id, {
        site_to: site_point_id,
        cable_net_length_m: route_old_length,
        name: `${baseName}-1`,
        code: `${baseCode}-1`,
      });
      //regis new cable_route for old cable
      const cable_route_payload = route_list_old_cable.flatMap((route) => ({
        cable_id: cable_id,
        route_id: route.route_id,
      }));
      if (cable_route_payload.length > 0) {
        await cableRouteService.createMany(cable_route_payload);
      }

      //post new cable
      const cable2 = await cableService.createOne({
        name: `${baseName}-2`,
        code: `${baseCode}-2`,
        site_from: site_point_id,
        site_to: cable_site_to,
        cable_type_id: cable_old.cable_type_id,
        cable_net_length_m: route_new_length,
        cable_gross_length_m: cable_old.cable_gross_length_m,
        location: cable_old.location,
        location_detail: cable_old.location_detail,
        description: cable_old.description,
        other_attributes: cable_old.other_attributes,
        tag_id: cable_old.tag_id,
        rfid: cable_old.rfid,
        serial_number: cable_old.serial_number,
        date_of_purchase: cable_old.date_of_purchase,
        date_of_install: cable_old.date_of_install,
        date_of_service: cable_old.date_of_service,
        date_of_warranty_expiration: cable_old.date_of_warranty_expiration,
        date_of_last_inspection: cable_old.date_of_last_inspection,
        last_inspected_by: cable_old.last_inspected_by,
        date_of_maintenance_expiration:
          cable_old.date_of_maintenance_expiration,
        maintenance_by: cable_old.maintenance_by,
        service_log_ticket_number: cable_old.service_log_ticket_number,
      });
      //regis new cable_route for new cable
      const cable_route_payload2 = route_list_new_cable.flatMap((route) => ({
        cable_id: cable2,
        route_id: route.route_id,
      }));
      if (cable_route_payload2.length > 0) {
        await cableRouteService.createMany(cable_route_payload2);
      }

      //TODO handle cable cores
      //untuk sekarang blokir dulu diatas

      //cek jumlah tube di cable-1 lalu generate tube di cable-2 dengan jumlah yang sama
      const cableCores1 = await trx("cable_cores")
        .select("tube")
        .where("cable_id", cable1)
        .orderBy("tube", "desc")
        .first();
      const countTubeC1 = cableCores1?.tube ?? 0;

      const cable_cores1 = await trx("cable_cores")
        .select("*")
        .where("cable_id", cable1)
        .orderBy([
          { column: "tube", order: "asc" },
          { column: "core", order: "asc" },
        ]);
      const cable_cores2 = [];
      if (countTubeC1 > 0) {
        const payload = [];
        for (let i = 1; i <= countTubeC1; i++) {
          const coreCount = 12;
          for (let j = 1; j <= coreCount; j++) {
            payload.push({
              cable_id: cable2,
              path: `${cable2}/${i}/${j}`,
              tube: i,
              core: j,
              from: "enabled",
              to: "enabled",
            });
          }
        }
        const inserted = await trx("cable_cores")
          .insert(payload)
          .returning("*");

        cable_cores2.push(...inserted);
      }

      const cableCoreMapping = {
        bySource: {},
        byDestination: {},
      };
      const indexC2 = {};
      for (const c2 of cable_cores2) {
        indexC2[`${c2.tube}-${c2.core}`] = c2.id;
      }
      for (const c1 of cable_cores1) {
        const key = `${c1.tube}-${c1.core}`;
        const c2Id = indexC2[key];
        if (!c2Id) continue;

        cableCoreMapping.bySource[c1.id] = c2Id;
        cableCoreMapping.byDestination[c2Id] = c1.id;
      }

      // list dan update transaction yang ada di site_to cable
      // karena akan diganti dengan cable & core baru
      const exist_transactions_source = await trx("core_transactions")
        .select("*")
        .where({
          source_type: "cables",
          source_type_id: cable_id,
          site_point_id: cable_site_to,
        });
      const exist_transactions_dest = await trx("core_transactions")
        .select("*")
        .where({
          destination_type: "cables",
          destination_type_id: cable_id,
          site_point_id: cable_site_to,
        });

      for (const trxItem of exist_transactions_source) {
        const trxId = trxItem.id;
        const oldSourceCoreId = trxItem.source_item_type_id;
        const newSourceCoreId = cableCoreMapping.bySource[oldSourceCoreId];
        const newCableId = cable2;

        if (!newSourceCoreId) continue;
        await trx("core_transactions").where("id", trxId).update({
          source_type_id: newCableId,
          source_item_type_id: newSourceCoreId,
          site_point_id: cable_site_to,
        });
        await trx("cable_cores").where("id", oldSourceCoreId).update({
          to: "enabled",
        });
        await trx("cable_cores").where("id", newSourceCoreId).update({
          to: "used",
        });
      }
      for (const trxItem of exist_transactions_dest) {
        const trxId = trxItem.id;
        const oldDestCoreId = trxItem.destination_item_type_id;
        const newDestCoreId = cableCoreMapping.bySource[oldDestCoreId];
        const newCableId = cable2;

        if (!newDestCoreId) continue;
        await trx("core_transactions").where("id", trxId).update({
          destination_type_id: newCableId,
          destination_item_type_id: newDestCoreId,
          site_point_id: cable_site_to,
        });
        await trx("cable_cores").where("id", oldDestCoreId).update({
          to: "enabled",
        });
        await trx("cable_cores").where("id", newDestCoreId).update({
          to: "used",
        });
      }

      const payloadTransactions = [];
      for (const core of cable_cores1) {
        const coreOldId = core.id;
        const coreNewId = cableCoreMapping.bySource[coreOldId];
        if (!coreNewId) continue;

        payloadTransactions.push({
          id: randomUUID(),
          site_point_id,
          source_type: "cables",
          source_type_id: cable1,
          source_item_type: "cable_cores",
          source_item_type_id: coreOldId,
          source_side: "B",
          destination_type: "cables",
          destination_type_id: cable2,
          destination_item_type: "cable_cores",
          destination_item_type_id: coreNewId,
          destination_side: "F",
          splice_asset_id,
          date_created: trx.fn.now(),
          user_created: accountability.user,
        });

        await trx("cable_cores").where("id", coreOldId).update({
          to: "used",
        });
        await trx("cable_cores").where("id", coreNewId).update({
          from: "used",
        });
      }

      let newTransactions = [];
      if (payloadTransactions.length > 0) {
        newTransactions = await trx("core_transactions")
          .insert(payloadTransactions)
          .returning("*");
      }

      // throw new Error("force error");

      await trx.commit();
      return res.json({
        data: {
          site_list_all,
          route_list_old_cable,
          route_list_new_cable,
          site_list_old_cable,
          site_list_new_cable,
          cable1,
          cable2,
          exist_transactions_source,
          exist_transactions_dest,
          newTransactions: newTransactions,
        },
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
          service: "data-process/split-cable",
          reason: "Failed to split cable",
        })
      );
    }
  });
};
