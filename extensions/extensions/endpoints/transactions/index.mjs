import {
  InvalidPayloadError,
  ServiceUnavailableError,
  ForbiddenError,
} from "@directus/errors";
import { randomUUID } from "crypto";
import ExcelJS from "exceljs";

import clearCache from "../../utils/clearCache.mjs";

export default (router, { database, logger, env }) => {
  const getAssetInfo = async (database, asset_id) => {
    const assetInfo = await database("assets as a")
      .leftJoin("asset_types as at", "at.id", "a.asset_type_id")
      .select(
        "a.id",
        "a.name",
        "a.code",
        "at.name as asset_type_name",
        "a.site_point_id"
      )
      .where("a.id", asset_id)
      .first();
    return assetInfo;
  };
  const getCableInfo = async (database, cable_id) => {
    const cableInfo = await database("cables as c")
      .leftJoin("cable_types as ct", "ct.id", "c.cable_type_id")
      .select(
        "c.id",
        "c.name",
        "c.code",
        "ct.name as cable_type_name",
        "c.site_from",
        "c.site_to"
      )
      .where("c.id", cable_id)
      .first();
    return cableInfo;
  };
  const getTransaction = async (database, type, data) => {
    let result;
    if (type == "assets") {
      const { rows } = await database.raw(
        `SELECT
          id AS core_transaction_id,
          source_type AS destination_type, source_type_id AS destination_type_id,
          source_item_type AS destination_item_type, source_item_type_id AS destination_item_type_id,
          source_side AS destination_side, splice_asset_id
        FROM core_transactions
        WHERE destination_item_type = 'asset_ports' AND destination_item_type_id = ?
        UNION
        SELECT
          id AS core_transaction_id,
          destination_type, destination_type_id,
          destination_item_type, destination_item_type_id,
          destination_side, splice_asset_id
        FROM core_transactions
        WHERE source_item_type = 'asset_ports' AND source_item_type_id = ?`,
        [data.id, data.id]
      );
      result = rows[0];
    } else {
      const { rows } = await database.raw(
        `SELECT
          id AS core_transaction_id,
          source_type AS destination_type, source_type_id AS destination_type_id,
          source_item_type AS destination_item_type, source_item_type_id AS destination_item_type_id,
          source_side AS destination_side, splice_asset_id
        FROM core_transactions
        WHERE destination_item_type = 'cable_cores' AND destination_item_type_id = ? AND destination_side = ?
        UNION
        SELECT
          id AS core_transaction_id,
          destination_type, destination_type_id,
          destination_item_type, destination_item_type_id,
          destination_side, splice_asset_id
        FROM core_transactions
        WHERE source_item_type = 'cable_cores' AND source_item_type_id = ? AND source_side = ?`,
        [data.id, data.side, data.id, data.side]
      );
      result = rows[0];
    }
    return result;
  };
  const traceDestination = async (database, startConn) => {
    let current = startConn;
    const transactions = [];

    let hop = 0;
    while (current && current.destination_type === "cables") {
      if (hop >= 10) {
        logger.info("Stop: mencapai batas maksimum 10 hop");
        return transactions;
      }
      hop++;
      // Ambil info kabel
      let cableId = current.destination_type_id;
      let coreId = current.destination_item_type_id;
      let otherSide = "F";
      if (current.destination_side == "F") {
        otherSide = "B";
      }

      const cableInfo = await getCableInfo(database, cableId);
      // const coreInfo = await database("cable_cores")
      //   .select("id", "path", "tube", "core")
      //   .where("id", coreId)
      //   .first();

      const coreInfo = await database("cable_cores as main")
        .leftJoin("config_color as tc", function () {
          this.on("main.tube", "=", "tc.number").andOn(
            "tc.type",
            "=",
            database.raw("'tube'")
          );
        })
        .leftJoin("config_color as cc", function () {
          this.on("main.core", "=", "cc.number").andOn(
            "cc.type",
            "=",
            database.raw("'core'")
          );
        })
        .select(
          "main.id",
          "main.path",
          "main.tube",
          "main.core",
          "main.cable_id",
          "tc.color as tube_color",
          "cc.color as core_color"
        )
        .where("main.id", coreId)
        .first();

      if (current.splice_asset_id) {
        const assetInfo = await getAssetInfo(database, current.splice_asset_id);
        transactions.push({
          id: current.core_transaction_id + "/splice",
          type: "assets",
          type_id: current.splice_asset_id,
          type_info: assetInfo,
          item_type: "asset_ports",
          item_type_id: null,
          item_type_info: null,
        });
      }

      transactions.push({
        id: current.core_transaction_id,
        type: "cables",
        type_id: cableId,
        type_info: cableInfo,
        item_type: "cable_cores",
        item_type_id: coreId,
        item_type_info: coreInfo,
        splice_asset_id: current.splice_asset_id,
      });

      current = await getTransaction(database, "cables", {
        id: current.destination_item_type_id,
        side: otherSide,
      });
      if (!current) return transactions;
    }

    if (current && current.destination_type === "assets") {
      const assetInfo = await getAssetInfo(
        database,
        current.destination_type_id
      );

      const portInfo = await database("asset_ports")
        .select("id", "path", "number", "port_type")
        .where("id", current.destination_item_type_id)
        .first();

      transactions.push({
        id: current.core_transaction_id,
        type: "assets",
        type_id: current.destination_type_id,
        type_info: assetInfo,
        item_type: "asset_ports",
        item_type_id: current.destination_item_type_id,
        item_type_info: portInfo,
      });
    }

    return transactions;
  };
  const geojsonSite = async (database, sites) => {
    if (!sites.length) {
      return {
        type: "FeatureCollection",
        features: [],
      };
    }
    const site_list = sites.map(() => `?`).join(", ");
    let paramVal = [...sites];

    const { rows } = await database.raw(
      `WITH site_data AS (
        SELECT id, name, code, site_point_type_id, geom
        FROM site_points
        WHERE id IN (${site_list})
        GROUP BY id
      ), agg AS (
        SELECT json_agg(ST_AsGeoJSON(t.*)::json) AS features, ST_Extent(t.geom) AS extent
        FROM site_data t
      ) SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', features,
            'bbox', ARRAY[ST_XMin(extent)::float, ST_YMin(extent)::float, ST_XMax(extent)::float, ST_YMax(extent)::float]
          ) AS geojson
        FROM agg AS t;`,
      paramVal
    );
    return rows[0].geojson;
  };
  const geojsonAsset = async (database, assets) => {
    if (!assets.length) {
      return {
        type: "FeatureCollection",
        features: [],
      };
    }
    const asset_list = assets.map(() => `?`).join(", ");
    let paramVal = [...assets];

    const { rows } = await database.raw(
      `WITH asset_data AS (
        SELECT
          a.id, a.name, a.code, a.asset_type_id, a.site_point_id, at.icon,
          ST_Project(sp.geom::geography, 10, radians(360/(COUNT(*) OVER (PARTITION BY a.site_point_id))*ROW_NUMBER() OVER (PARTITION BY a.site_point_id ORDER BY a.id)))::geometry AS geom
        FROM assets a
        INNER JOIN site_points sp ON a.site_point_id = sp.id
        INNER JOIN asset_types at ON a.asset_type_id = at.id
        WHERE a.id IN (${asset_list})
    ) SELECT json_build_object('type', 'FeatureCollection', 'features', json_agg(ST_AsGeoJSON(t.*)::json)) AS geojson
        FROM asset_data AS t;`,
      paramVal
    );
    return rows[0].geojson;
  };
  const geojsonAssetSpider = async (database, assets) => {
    if (!assets.length) {
      return {
        type: "FeatureCollection",
        features: [],
      };
    }
    const asset_list = assets.map(() => `?`).join(", ");
    let paramVal = [...assets];

    const { rows } = await database.raw(
      `WITH asset_spider AS (
        SELECT
          a.id, a.asset_type_id, a.site_point_id,
          ST_MakeLine(sp.geom, ST_Project(sp.geom::geography, 10, radians(360/(COUNT(*) OVER (PARTITION BY a.site_point_id))*ROW_NUMBER() OVER (PARTITION BY a.site_point_id ORDER BY a.id)))::geometry) AS geom
        FROM assets a
        INNER JOIN site_points sp ON a.site_point_id = sp.id
        WHERE a.id IN (${asset_list})
    ) SELECT json_build_object('type', 'FeatureCollection', 'features', json_agg(ST_AsGeoJSON(t.*)::json)) AS geojson
        FROM asset_spider AS t;`,
      paramVal
    );
    return rows[0].geojson;
  };
  const geojsonCable = async (database, cables) => {
    if (!cables.length) {
      return {
        type: "FeatureCollection",
        features: [],
      };
    }
    const cable_list = cables.map(() => `?`).join(", ");
    let paramVal = [...cables];

    const { rows } = await database.raw(
      `WITH cable_data AS (
        SELECT c.id, c.name, c.code, c.cable_type_id, ST_Union(r.geom) AS geom
        FROM cables c
        INNER JOIN cable_routes cr ON c.id = cr.cable_id
        INNER JOIN routes r ON cr.route_id = r.id
        WHERE c.id IN (${cable_list})
        GROUP BY c.id
    ) SELECT json_build_object('type', 'FeatureCollection', 'features', json_agg(ST_AsGeoJSON(t.*)::json)) AS geojson
        FROM cable_data AS t;`,
      paramVal
    );
    return rows[0].geojson;
  };

  router.post("/v1/generate-ports", async (req, res, next) => {
    const trx = await database.transaction();
    let committed = false;
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }

      const { asset_id, port_type, port_count } = req.body;
      if (!asset_id || !port_type || !port_count) {
        throw new InvalidPayloadError({
          reason: `Missing required field: asset_id, port_type or port_count`,
        });
      }
      const allowedPortType = [
        "uplink/source",
        "downlink/destination",
        "others",
      ];
      if (!allowedPortType.includes(port_type)) {
        throw new InvalidPayloadError({ reason: "port_type not allowed" });
      }
      const formatedPortType = port_type.replace(/\//g, "-");

      const asset = await trx("assets")
        .select("id")
        .where("id", asset_id)
        .first();
      if (!asset) {
        throw new InvalidPayloadError({
          reason: `Asset not found for id=${asset_id}`,
        });
      }
      const assetPorts = await trx("asset_ports")
        .select("id")
        .where({
          asset_id: asset_id,
          port_type: port_type,
        })
        .first();
      if (assetPorts) {
        throw new InvalidPayloadError({
          reason: `${port_type} port type already generated`,
        });
      }

      const payload = [];
      for (let i = 1; i <= port_count; i++) {
        payload.push({
          asset_id,
          path: `${asset_id}/${formatedPortType}/${i}`,
          number: i,
          port_type: port_type,
          port_status: "enabled",
        });
      }

      const inserted = await trx("asset_ports").insert(payload).returning("*");

      await trx.commit();
      committed = true;
      await clearCache(logger, env);

      return res.send({
        success: true,
        message: `Ports ${port_type} generated successfully (${port_count} ports)`,
        data: inserted,
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
          service: "transactions/v1/generate-ports",
          reason: `Failed to generate ports${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    } finally {
      if (!committed) await trx.rollback();
    }
  });
  router.post("/v1/generate-cores", async (req, res, next) => {
    const trx = await database.transaction();
    let committed = false;
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }

      const { cable_id, tube_no } = req.body;
      if (!cable_id || !tube_no) {
        throw new InvalidPayloadError({
          reason: `Missing required field: cable_id or tube_no`,
        });
      }
      const cable = await trx("cables")
        .select("id")
        .where("id", cable_id)
        .first();
      if (!cable) {
        throw new InvalidPayloadError({
          reason: `Cable not found for id=${cable_id}`,
        });
      }
      const cableCores = await trx("cable_cores")
        .select("id")
        .where({
          cable_id: cable_id,
          tube: tube_no,
        })
        .first();
      if (cableCores) {
        throw new InvalidPayloadError({
          reason: `tube no ${tube_no} already generated`,
        });
      }

      if (tube_no != 1) {
        let tubeNoPrev = tube_no - 1;
        const cableCoresPrev = await trx("cable_cores")
          .select("id")
          .where({
            cable_id: cable_id,
            tube: tubeNoPrev,
          })
          .first();
        if (!cableCoresPrev) {
          throw new InvalidPayloadError({
            reason: `previous tube no ${tubeNoPrev} not generated`,
          });
        }
      }

      const payload = [];
      const coreCount = 12;
      for (let i = 1; i <= coreCount; i++) {
        payload.push({
          cable_id,
          path: `${cable_id}/${tube_no}/${i}`,
          tube: tube_no,
          core: i,
          from: "enabled",
          to: "enabled",
        });
      }

      const inserted = await trx("cable_cores").insert(payload).returning("*");

      await trx.commit();
      committed = true;
      await clearCache(logger, env);

      return res.send({
        success: true,
        message: `Cores generated successfully (tube-${tube_no}, ${coreCount} core)`,
        data: inserted,
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
          service: "transactions/v11/generate-cores",
          reason: `Failed to generate cores${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    } finally {
      if (!committed) await trx.rollback();
    }
  });
  router.post("/v1/core-config", async (req, res, next) => {
    const trx = await database.transaction();
    let committed = false;
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }
      const { method, site_point_id, source, destination, splice_asset_id } =
        req.body;
      //Validation
      if ((!method, !site_point_id, !source, !destination)) {
        throw new InvalidPayloadError({
          reason: "method, site_point_id, source, destination",
        });
      }

      let [source_item_type, source_item_type_id, source_side] =
        source.split("$");
      let [destination_item_type, destination_item_type_id, destination_side] =
        destination.split("$");

      const getItemType = (type) => {
        let typeResult;
        if (type == "P") {
          typeResult = "asset_ports";
        } else if (type == "C") {
          typeResult = "cable_cores";
        }
        return typeResult;
      };

      source_item_type = getItemType(source_item_type);
      destination_item_type = getItemType(destination_item_type);

      const allowedMethod = ["port2core", "port2port", "core2core"];
      if (!allowedMethod.includes(method)) {
        throw new InvalidPayloadError({ reason: "method not allowed" });
      }
      const allowedSide = ["F", "B"];
      if (
        (source_item_type === "cable_cores" &&
          !allowedSide.includes(source_side)) ||
        (destination_item_type === "cable_cores" &&
          !allowedSide.includes(destination_side))
      ) {
        throw new InvalidPayloadError({
          reason: "cable_cores allowed side is F or B",
        });
      }

      let source_type;
      let source_type_id;
      let source_side_status;
      let destination_type;
      let destination_type_id;
      let destination_side_status;

      const getCoreById = async (trx, coreId) => {
        try {
          const result = await trx("cable_cores")
            .select("id", "cable_id", "from", "to")
            .where("id", coreId)
            .first();
          return result;
        } catch (error) {
          throw new Error("Failed to get core");
        }
      };
      const getPortById = async (trx, portId) => {
        try {
          const result = await trx("asset_ports")
            .select("id", "asset_id", "port_status")
            .where("id", portId)
            .first();
          return result;
        } catch (error) {
          throw new Error("Failed to get port");
        }
      };

      if (method == "port2core") {
        source_type = "assets";
        const sourceResult = await getPortById(trx, source_item_type_id);
        source_type_id = sourceResult.asset_id;
        source_side_status = sourceResult.port_status;

        destination_type = "cables";
        const destResult = await getCoreById(trx, destination_item_type_id);
        destination_type_id = destResult.cable_id;
        if (destination_side == "F") {
          destination_side_status = destResult.from;
        } else {
          destination_side_status = destResult.to;
        }
      } else if (method == "port2port") {
        source_type = "assets";
        const sourceResult = await getPortById(trx, source_item_type_id);
        source_type_id = sourceResult.asset_id;
        source_side_status = sourceResult.port_status;

        destination_type = "assets";
        const destResult = await getPortById(trx, destination_item_type_id);
        destination_type_id = destResult.asset_id;
        destination_side_status = destResult.port_status;
      } else if (method == "core2core") {
        if (!splice_asset_id) {
          throw new InvalidPayloadError({
            reason: "splice_asset_id required for core2core",
          });
        }
        source_type = "cables";
        const sourceResult = await getCoreById(trx, source_item_type_id);
        source_type_id = sourceResult.cable_id;
        if (source_side == "F") {
          source_side_status = sourceResult.from;
        } else {
          source_side_status = sourceResult.to;
        }

        destination_type = "cables";
        const destResult = await getCoreById(trx, destination_item_type_id);
        destination_type_id = destResult.cable_id;
        if (destination_side == "F") {
          destination_side_status = destResult.from;
        } else {
          destination_side_status = destResult.to;
        }
      }

      if (source_side_status != "enabled") {
        throw new InvalidPayloadError({ reason: "source side not enabled" });
      }
      if (destination_side_status != "enabled") {
        throw new InvalidPayloadError({
          reason: "destination side not enabled",
        });
      }

      //cek asset & cable
      if (source_type == "assets") {
        const { site_point_id: siteId } = await trx("assets")
          .select("site_point_id")
          .where("id", source_type_id)
          .first();
        if (siteId !== site_point_id) {
          throw new InvalidPayloadError({
            reason: "source asset not on site_point",
          });
        }
      } else {
        const { site_from, site_to } = await trx("cables")
          .select("site_from", "site_to")
          .where("id", source_type_id)
          .first();
        if (
          (source_side == "F" && site_from !== site_point_id) ||
          (source_side == "B" && site_to !== site_point_id)
        ) {
          throw new InvalidPayloadError({
            reason: "source cable core not on site_point",
          });
        }
      }
      if (destination_type == "assets") {
        const { site_point_id: siteId } = await trx("assets")
          .select("site_point_id")
          .where("id", destination_type_id)
          .first();
        if (siteId !== site_point_id) {
          throw new InvalidPayloadError({
            reason: "destination asset not on site_point",
          });
        }
      } else {
        const { site_from, site_to } = await trx("cables")
          .select("site_from", "site_to")
          .where("id", destination_type_id)
          .first();
        if (
          (destination_side == "F" && site_from !== site_point_id) ||
          (destination_side == "B" && site_to !== site_point_id)
        ) {
          throw new InvalidPayloadError({
            reason: "destination cable core not on site_point",
          });
        }
      }

      const transactionId = randomUUID();

      const [newTransaction] = await trx("core_transactions")
        .insert({
          id: transactionId,
          site_point_id: site_point_id,
          source_type: source_type,
          source_type_id: source_type_id,
          source_item_type: source_item_type,
          source_item_type_id: source_item_type_id,
          source_side: source_side,
          destination_type: destination_type,
          destination_type_id: destination_type_id,
          destination_item_type: destination_item_type,
          destination_item_type_id: destination_item_type_id,
          destination_side: destination_side,
          splice_asset_id: splice_asset_id,
          date_created: trx.fn.now(),
          user_created: accountability.user,
        })
        .returning("*");
      const updatePort = async (trx, portId) => {
        try {
          await trx("asset_ports")
            .where("id", portId)
            .update({ port_status: "used" });
        } catch (error) {
          throw new Error("Failed to update port");
        }
      };
      const updateCore = async (trx, coreId, coreSide) => {
        try {
          let payload;
          if (coreSide == "F") {
            payload = { from: "used" };
          } else {
            payload = { to: "used" };
          }
          await trx("cable_cores").where("id", coreId).update(payload);
        } catch (error) {
          throw new Error("Failed to update port");
        }
      };

      if (source_type == "assets") {
        await updatePort(trx, source_item_type_id);
      } else {
        await updateCore(trx, source_item_type_id, source_side);
      }
      if (destination_type == "assets") {
        await updatePort(trx, destination_item_type_id);
      } else {
        await updateCore(trx, destination_item_type_id, destination_side);
      }

      await trx.commit();
      committed = true;
      await clearCache(logger, env);

      return res.send({
        success: true,
        message: `Transaction created`,
        data: { core_transactions: newTransaction },
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
          service: "transactions/v1/core-config",
          reason: `Failed to core config${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    } finally {
      if (!committed) {
        await trx.rollback();
      }
    }
  });
  router.get("/core-transactions", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }
      const { site_point_id } = req.query;
      if (!site_point_id) {
        return next(
          new InvalidPayloadError({
            reason: `site_point_id required`,
          })
        );
      }

      const transactions = await database("core_transactions")
        .select(
          "id",
          database.raw(`
            ( CASE
                WHEN source_item_type = 'asset_ports' THEN 'P'
                WHEN source_item_type = 'cable_cores' THEN 'C'
                ELSE 'X'
              END
              || '$' || source_item_type_id ||
              CASE WHEN source_side IS NOT NULL THEN '$' || source_side ELSE '' END
            ) AS source`),
          database.raw(`
            ( CASE 
                WHEN destination_item_type = 'asset_ports' THEN 'P'
                WHEN destination_item_type = 'cable_cores' THEN 'C'
                ELSE 'X'
              END
              || '$' || destination_item_type_id ||
              CASE WHEN destination_side IS NOT NULL THEN '$' || destination_side  ELSE '' END
            ) AS target`)
        )
        .where("site_point_id", site_point_id);

      return res.send({ data: transactions });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "transactions/core-transactions",
          reason: `Failed to get core transactions${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.delete("/core-transactions/:id", async (req, res, next) => {
    const trx = await database.transaction();
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }
      const { id: transactionId } = req.params;

      const transaction = await trx("core_transactions")
        .select("*")
        .where("id", transactionId)
        .first();
      if (!transaction) {
        throw new InvalidPayloadError({ reason: `transaction id not found` });
      }

      const {
        source_item_type,
        source_item_type_id,
        source_side,
        destination_item_type,
        destination_item_type_id,
        destination_side,
      } = transaction;

      const setEnabled = async (item_type, item_type_id, side) => {
        if (!item_type || !item_type_id) return;

        if (item_type == "asset_ports") {
          await trx("asset_ports").where("id", item_type_id).update({
            port_status: "enabled",
          });
        } else {
          const key = side === "F" ? "from" : "to";

          await trx("cable_cores")
            .where("id", item_type_id)
            .update({
              [key]: "enabled",
            });
        }
      };

      await setEnabled(source_item_type, source_item_type_id, source_side);
      await setEnabled(
        destination_item_type,
        destination_item_type_id,
        destination_side
      );

      await trx("core_transactions").where("id", transactionId).del();
      await trx.commit();
      await clearCache(logger, env);
      return res.send({ success: "true" });
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
          service: "transactions/core-transactions",
          reason: `Failed to delete core transactions${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/core-connections", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }
      const { type, type_id } = req.query;
      let prefix;
      let table_name;
      let dataKey;
      if (type == "assets") {
        prefix = "P";
        table_name = "asset_ports";
        dataKey = "asset_id";
      } else if (type == "cables") {
        prefix = "C";
        table_name = "cable_cores";
        dataKey = "cable_id";
      } else {
        return next(
          new InvalidPayloadError({
            reason: `type not allowed`,
          })
        );
      }
      if (!type_id) {
        return next(
          new InvalidPayloadError({
            reason: `type_id required`,
          })
        );
      }

      let connections = [];
      let type_info;
      if (type == "assets") {
        const { rows } = await database.raw(
          `SELECT
            main.id, main.path, main.number, main.port_type,
            CASE WHEN is_source THEN ct.destination_type          ELSE ct.source_type         END AS destination_type,
            CASE WHEN is_source THEN ct.destination_type_id       ELSE ct.source_type_id      END AS destination_type_id,
            CASE WHEN is_source THEN ct.destination_item_type     ELSE ct.source_item_type    END AS destination_item_type,
            CASE WHEN is_source THEN ct.destination_item_type_id  ELSE ct.source_item_type_id END AS destination_item_type_id,
            CASE WHEN is_source THEN ct.destination_side          ELSE ct.source_side         END AS destination_side,
            ct.id AS core_transaction_id
          FROM asset_ports main
          INNER JOIN core_transactions ct
            ON ((ct.source_item_type = 'asset_ports' AND ct.source_item_type_id = main.id)
            OR (ct.destination_item_type = 'asset_ports' AND ct.destination_item_type_id = main.id))
          CROSS JOIN LATERAL (SELECT (ct.source_item_type = 'asset_ports' AND ct.source_item_type_id = main.id) AS is_source) s
          WHERE main.asset_id = ?
          ORDER BY main.path;`,
          [type_id]
        );
        connections.push(...rows);

        const assetInfo = await database("assets as a")
          .leftJoin("asset_types as at", "at.id", "a.asset_type_id")
          .select("a.id", "a.name", "a.code", "at.name as asset_type_name")
          .where("a.id", type_id)
          .first();
        type_info = assetInfo;
      } else {
        const { rows } = await database.raw(
          `SELECT
            CONCAT(main.id, '$', side) AS id, main.path, main.tube, main.core,
            CASE WHEN is_source THEN ct.destination_type          ELSE ct.source_type         END AS destination_type,
            CASE WHEN is_source THEN ct.destination_type_id       ELSE ct.source_type_id      END AS destination_type_id,
            CASE WHEN is_source THEN ct.destination_item_type     ELSE ct.source_item_type    END AS destination_item_type,
            CASE WHEN is_source THEN ct.destination_item_type_id  ELSE ct.source_item_type_id END AS destination_item_type_id,
            CASE WHEN is_source THEN ct.destination_side  ELSE ct.source_side END AS destination_side,
            ct.id AS core_transaction_id
          FROM cable_cores main
          INNER JOIN core_transactions ct
            ON ((ct.source_item_type = 'cable_cores' AND ct.source_item_type_id = main.id AND ct.source_side IN ('B','F'))
            OR (ct.destination_item_type = 'cable_cores' AND ct.destination_item_type_id = main.id AND ct.destination_side IN ('B','F')))
          CROSS JOIN LATERAL (
            SELECT
              CASE 
                  WHEN (ct.source_item_type = 'cable_cores' AND ct.source_item_type_id = main.id) THEN ct.source_side 
                  ELSE ct.destination_side
              END AS side,
              (ct.source_item_type = 'cable_cores' AND ct.source_item_type_id = main.id) AS is_source
          ) s
          WHERE main.cable_id = ?
          ORDER BY main.path;`,
          [type_id]
        );
        connections.push(...rows);

        const cableInfo = await database("cables as c")
          .leftJoin("cable_types as ct", "ct.id", "c.cable_type_id")
          .select("c.id", "c.name", "c.code", "ct.name as cable_type_name")
          .where("c.id", type_id)
          .first();
        type_info = cableInfo;
      }

      const results = [];
      for (const conn of connections) {
        const transactions = await traceDestination(database, conn);

        if (type == "assets") {
          const item = {
            id: conn.id,
            path: conn.path,
            number: conn.number,
            port_type: conn.port_type,
            type: "assets",
            type_info: type_info,
            transactions: transactions,
          };
          results.push(item);
        } else {
          const item = {
            id: conn.id,
            path: conn.path,
            tube: conn.tube,
            core: conn.core,
            type: "cables",
            type_info: type_info,
            transactions: transactions,
          };
          results.push(item);
        }
      }

      let finalResults = results;

      return res.send({ data: finalResults });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "transactions/core-connections",
          reason: `Failed to get coreport connections${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/v1/core-connections", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }
      const { type, type_id } = req.query;
      const allowedtype = ["assets", "cables"];
      if (!allowedtype.includes(type)) {
        return next(
          new InvalidPayloadError({
            reason: `type not allowed`,
          })
        );
      }
      if (!type_id) {
        return next(
          new InvalidPayloadError({
            reason: `type_id required`,
          })
        );
      }

      let connections = [];
      let type_info;

      if (type == "assets") {
        const portList = await database("asset_ports")
          .select("id", "path", "number", "port_type ")
          .where("asset_id", type_id)
          .orderBy([
            { column: "asset_id", order: "asc" },
            { column: "port_type", order: "asc" },
            { column: "number", order: "asc" },
          ]);
        connections.push(...portList);
        type_info = await getAssetInfo(database, type_id);
      } else {
        const { rows: coreInfo } = await database.raw(
          `SELECT
            main.id, main."path", main.tube, main.core, 'F' AS side, main.cable_id, main.remark,
            tc.color AS tube_color, cc.color AS core_color
          FROM cable_cores main
          LEFT JOIN config_color tc ON main.tube=tc."number" AND tc."type"='tube'
          LEFT JOIN config_color cc ON main.core=cc."number" AND cc."type"='core'
          WHERE main.cable_id = ?
          UNION
          SELECT
            main.id, main."path", main.tube, main.core, 'B' AS side, main.cable_id, main.remark,
            tc.color AS tube_color, cc.color AS core_color
          FROM cable_cores main
          LEFT JOIN config_color tc ON main.tube=tc."number" AND tc."type"='tube'
          LEFT JOIN config_color cc ON main.core=cc."number" AND cc."type"='core'
          WHERE cable_id = ?
          ORDER BY cable_id, tube, core, side;`,
          [type_id, type_id]
        );
        connections.push(...coreInfo);
        type_info = await getCableInfo(database, type_id);
      }

      const results = [];
      for (const conn of connections) {
        const start = await getTransaction(database, type, conn);

        let transactions = [];
        if (start) {
          transactions = await traceDestination(database, start);
        }

        if (type == "assets") {
          const item = {
            id: conn.id,
            path: conn.path,
            number: conn.number,
            port_type: conn.port_type,
            type: "assets",
            type_info: type_info,
            transactions: transactions,
          };
          results.push(item);
        } else {
          const item = {
            id: conn.id,
            path: conn.path,
            tube: conn.tube,
            core: conn.core,
            side: conn.side,
            type: "cables",
            type_info: type_info,
            tube_color: conn.tube_color,
            core_color: conn.core_color,
            transactions: transactions,
            remark: conn.remark,
          };
          results.push(item);
        }
      }

      let finalResults = results;

      return res.send({ data: finalResults });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "transactions/core-connections",
          reason: `Failed to get coreport connections${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/v1/core-connections/excel", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }
      const { type, type_id } = req.query;
      const allowedtype = ["assets", "cables"];
      if (!allowedtype.includes(type)) {
        return next(
          new InvalidPayloadError({
            reason: `type not allowed`,
          })
        );
      }
      if (!type_id) {
        return next(
          new InvalidPayloadError({
            reason: `type_id required`,
          })
        );
      }

      let connections = [];
      let type_info;

      if (type == "assets") {
        const portList = await database("asset_ports")
          .select("id", "path", "number", "port_type ")
          .where("asset_id", type_id)
          .orderBy([
            { column: "asset_id", order: "asc" },
            { column: "port_type", order: "asc" },
            { column: "number", order: "asc" },
          ]);
        connections.push(...portList);
        type_info = await getAssetInfo(database, type_id);
      } else {
        const { rows: coreInfo } = await database.raw(
          `SELECT id, "path", tube, core, 'F' AS side, cable_id
            FROM cable_cores main
            WHERE cable_id = ?
          UNION
          SELECT id, "path", tube, core, 'B' AS side, cable_id
            FROM cable_cores main
            WHERE cable_id = ?
            ORDER BY cable_id, tube, core, side;`,
          [type_id, type_id]
        );
        connections.push(...coreInfo);
        type_info = await getCableInfo(database, type_id);
      }

      const results = [];
      for (const conn of connections) {
        const start = await getTransaction(database, type, conn);

        let transactions = [];
        if (start) {
          transactions = await traceDestination(database, start);
        }

        if (type == "assets") {
          const item = {
            id: conn.id,
            path: conn.path,
            number: conn.number,
            port_type: conn.port_type,
            type: "assets",
            type_info: type_info,
            transactions: transactions,
          };
          results.push(item);
        } else {
          const item = {
            id: conn.id,
            path: conn.path,
            tube: conn.tube,
            core: conn.core,
            side: conn.side,
            type: "cables",
            type_info: type_info,
            transactions: transactions,
          };
          results.push(item);
        }
      }

      const headers = [
        { origin: "A1", dest: null, label: "No" },
        { origin: "B1", dest: null, label: "Transaction" },
        { origin: "C1", dest: null, label: "Asset/Cable" },
        { origin: "D1", dest: null, label: "Asset Id/Cable Id" },
        { origin: "E1", dest: null, label: "Name" },
        { origin: "F1", dest: null, label: "Code" },
        { origin: "G1", dest: null, label: "Asset Type/Cable Type" },
        { origin: "H1", dest: null, label: "Site Point Id" },
        { origin: "I1", dest: null, label: "Site From" },
        { origin: "J1", dest: null, label: "Site To" },
        { origin: "K1", dest: null, label: "Path" },
        { origin: "L1", dest: null, label: "Port No" },
        { origin: "M1", dest: null, label: "Port Type" },
        { origin: "N1", dest: null, label: "Tube" },
        { origin: "O1", dest: null, label: "Core" },
        { origin: "P1", dest: null, label: "Side" },
      ];

      const timestamp = new Date().toISOString();
      const filename_download = `transaction_${type}_${type_id}_${timestamp}.xlsx`;

      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Sheet 1");

      function formatHeaderCell1(cellOrigin, cellDest, cellValue, alignment) {
        if (cellDest) {
          worksheet.mergeCells(`${cellOrigin}:${cellDest}`);
        }
        const cell = worksheet.getCell(cellOrigin);
        cell.value = cellValue;
        cell.alignment = alignment;
        cell.font = { bold: true };
        cell.border = {
          top: { style: "thin" },
          left: { style: "thin" },
          bottom: { style: "thin" },
          right: { style: "thin" },
        };
      }

      headers.forEach(({ origin, dest, label }) => {
        formatHeaderCell1(origin, dest, label, {
          horizontal: "center",
          vertical: "middle",
          wrapText: true,
        });
      });

      function colorRow(row, color) {
        row.eachCell({ includeEmpty: true }, (cell) => {
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: color },
          };
        });
      }

      let noExcel = 1;
      let noTrasaction = 1;

      for (const item of results) {
        const rowColor = noTrasaction % 2 === 0 ? "FFEFEFEF" : "FFD0D0D0";

        const answerArray = [
          noExcel++,
          noTrasaction,
          item.type,
          item.type_info.id,
          item.type_info.name,
          item.type_info.code,
          item.type == "assets"
            ? type_info.asset_type_name
            : type_info.cable_type_name,
          item.type_info?.site_point_id ?? null,
          item.type_info?.site_from ?? null,
          item.type_info?.site_to ?? null,
          item.path,
          item.number ?? null,
          item.port_type ?? null,
          item.tube ?? null,
          item.core ?? null,
          item.side ?? null,
        ];
        const excelRow = worksheet.addRow(answerArray);
        colorRow(excelRow, rowColor);
        // worksheet.addRow(answerArray);

        for (const trans of item.transactions) {
          const answerArray = [
            noExcel++,
            noTrasaction,
            trans.type,
            trans.type_info.id,
            trans.type_info.name,
            trans.type_info.code,
            trans.type == "assets"
              ? type_info.asset_type_name
              : type_info.cable_type_name,
            trans.type_info?.site_point_id ?? null,
            trans.type_info?.site_from ?? null,
            trans.type_info?.site_to ?? null,
            trans.item_type_info?.path,
            trans.item_type_info?.number ?? null,
            trans.item_type_info?.port_type ?? null,
            trans.item_type_info?.tube ?? null,
            trans.item_type_info?.core ?? null,
            trans.item_type_info?.side ?? null,
          ];
          const transRow = worksheet.addRow(answerArray);
          colorRow(transRow, rowColor);
          // worksheet.addRow(answerArray);
        }
        noTrasaction++;
      }

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=${filename_download}`
      );
      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "transactions/core-connections",
          reason: `Failed to get coreport connections${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/v1/core-connections-map", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }
      const { item_type, item_type_id } = req.query;
      const allowedtype = ["asset_ports", "cable_cores"];
      if (!allowedtype.includes(item_type)) {
        return next(
          new InvalidPayloadError({
            reason: `type not allowed`,
          })
        );
      }
      if (!item_type_id) {
        return next(
          new InvalidPayloadError({
            reason: `type_id required`,
          })
        );
      }

      let type = item_type === "asset_ports" ? "assets" : "cables";

      let connections = [];
      let type_info;

      if (type == "assets") {
        const portList = await database("asset_ports")
          .select("id", "path", "number", "port_type", "asset_id")
          .where("id", item_type_id);
        connections.push(...portList);
        type_info = await getAssetInfo(database, portList[0].asset_id);
      } else {
        const { rows: coreInfo } = await database.raw(
          `SELECT id, "path", tube, core, 'F' AS side, cable_id
            FROM cable_cores main
            WHERE id = ?
          UNION
          SELECT id, "path", tube, core, 'B' AS side, cable_id
            FROM cable_cores main
            WHERE id = ?
            ORDER BY "path", side;`,
          [item_type_id, item_type_id]
        );
        connections.push(...coreInfo);
        type_info = await getCableInfo(database, coreInfo[0].cable_id);
      }

      const results = [];
      const sites = [];
      const assets = [];
      const cables = [];
      for (const conn of connections) {
        const start = await getTransaction(database, type, conn);

        let transactions = [];
        if (start) {
          transactions = await traceDestination(database, start);
        }

        if (type == "assets") {
          const item = {
            id: conn.id,
            path: conn.path,
            number: conn.number,
            port_type: conn.port_type,
            type: "assets",
            type_info: type_info,
            transactions: transactions,
          };
          results.push(item);
          sites.push(type_info.site_point_id);
          assets.push(type_info.id);
        } else {
          const item = {
            id: conn.id,
            path: conn.path,
            tube: conn.tube,
            core: conn.core,
            side: conn.side,
            type: "cables",
            type_info: type_info,
            transactions: transactions,
          };
          results.push(item);
          sites.push(type_info.site_from);
          sites.push(type_info.site_to);
          cables.push(type_info.id);
        }
        for (const trans of transactions) {
          if (trans.type == "assets") {
            assets.push(trans.type_id);
            sites.push(type_info.site_point_id);
          } else {
            cables.push(trans.type_id);
            sites.push(trans.type_info.site_from);
            sites.push(trans.type_info.site_to);
            if (trans.splice_asset_id) assets.push(trans.splice_asset_id);
          }
        }
      }

      const uniqueSites = [...new Set(sites)].filter((v) => v != null);
      const uniqueAssets = [...new Set(assets)].filter((v) => v != null);
      const uniqueCables = [...new Set(cables)].filter((v) => v != null);

      const site_geojson = await geojsonSite(database, uniqueSites);
      const asset_geojson = await geojsonAsset(database, uniqueAssets);
      const asset_spider_geojson = await geojsonAssetSpider(
        database,
        uniqueAssets
      );
      const cable_geojson = await geojsonCable(database, uniqueCables);

      return res.send({
        data: {
          geojson: {
            site_point: site_geojson,
            asset: asset_geojson,
            asset_spider: asset_spider_geojson,
            cable: cable_geojson,
          },
          connection: results,
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "transactions/core-connections-map",
          reason: `Failed to get coreport connections map${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/add-port", async (req, res, next) => {
    const trx = await database.transaction();
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }
      const { asset_id, port_type, port_count = 1 } = req.body;
      if (!asset_id || !port_type) {
        throw new InvalidPayloadError({
          reason: `Missing required field: asset_id or port_type`,
        });
      }
      const allowedPortType = [
        "uplink/source",
        "downlink/destination",
        "others",
      ];
      if (!allowedPortType.includes(port_type)) {
        throw new InvalidPayloadError({ reason: "port_type not allowed" });
      }
      const formatedPortType = port_type.replace(/\//g, "-");
      const asset = await trx("assets")
        .select("id")
        .where("id", asset_id)
        .first();
      if (!asset) {
        throw new InvalidPayloadError({
          reason: `Asset not found for id=${asset_id}`,
        });
      }
      const maxPort = await trx("asset_ports")
        .max("number as max_port_number")
        .where({
          asset_id: asset_id,
          port_type: port_type,
        })
        .first();
      const startPort = maxPort?.max_port_number + 1 || 1;

      const payload = [];
      for (let i = startPort; i < startPort + port_count; i++) {
        payload.push({
          asset_id,
          path: `${asset_id}/${formatedPortType}/${i}`,
          number: i,
          port_type: port_type,
          port_status: "enabled",
        });
      }
      const inserted = await trx("asset_ports").insert(payload).returning("*");
      await trx.commit();
      await clearCache(logger, env);

      return res.send({
        success: true,
        message: `Ports ${port_type} generated successfully (${port_count} ports)`,
        data: inserted,
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
          service: "transactions/add-port",
          reason: `Failed to get add port${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.delete("/delete-port/:id", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }
      const { id: portId } = req.params;

      const assetPort = await database("asset_ports")
        .select("*")
        .where({
          id: portId,
        })
        .first();

      if (!assetPort) {
        throw new InvalidPayloadError({ reason: "port not found" });
      }

      const { asset_id, port_type, number, port_status } = assetPort;
      if (port_status == "used") {
        throw new InvalidPayloadError({ reason: "port already used" });
      }
      const maxPort = await database("asset_ports")
        .max("number as max_port_number")
        .where({
          asset_id: asset_id,
          port_type: port_type,
        })
        .first();

      const lastPort = maxPort?.max_port_number;
      if (number != lastPort) {
        throw new InvalidPayloadError({
          reason: "Please delete from last port number",
        });
      }

      await database("asset_ports").where("id", portId).del();
      await clearCache(logger, env);

      return res.send({
        success: true,
        message: `Ports ${portId} deleted`,
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
          service: "transactions/delete-port",
          reason: `Failed to delete port${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/fiber-diagram", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        throw new ForbiddenError();
      }
      const { site_point_id } = req.query;
      if (!site_point_id) {
        return next(
          new InvalidPayloadError({
            reason: `site_point_id required`,
          })
        );
      }

      const assetPorts = await database("assets as a")
        .innerJoin("asset_types as ats", "a.asset_type_id", "ats.id")
        .innerJoin("asset_ports as ap", "a.id", "ap.asset_id")
        .select([
          database.raw(`CONCAT('P$', ap.id) AS port_id`),

          "a.id as asset_id",
          "a.name",
          "a.code",
          "ats.name as asset_type_name",

          "ap.path",
          "ap.port_type",
          "ap.number",
          "ap.port_status",
        ])
        .where("a.site_point_id", site_point_id)
        .orderBy([
          { column: "ap.asset_id", order: "asc" },
          { column: "ap.port_type", order: "asc" },
          { column: "ap.number", order: "asc" },
        ]);

      const coreFromQuery = database("cables as c")
        .innerJoin("cable_types as cts", "c.cable_type_id", "cts.id")
        .innerJoin("cable_cores as cc", "c.id", "cc.cable_id")
        .select([
          database.raw(`CONCAT('C$', cc.id, '$F') AS core_id`),

          "c.id as cable_id",
          "c.name",
          "c.code",
          "cts.name as cable_type_name",

          "cc.path",
          "cc.tube",
          "cc.core",
          database.raw(`'F' AS side`),
          database.raw(`'from' AS core_status`),
        ])
        .where((qb) => {
          qb.where("c.site_from", site_point_id).orWhere(
            "c.site_to",
            site_point_id
          );
        });
      const coreToQuery = database("cables as c")
        .innerJoin("cable_types as cts", "c.cable_type_id", "cts.id")
        .innerJoin("cable_cores as cc", "c.id", "cc.cable_id")
        .select([
          database.raw(`CONCAT('C$', cc.id, '$B') AS core_id`),

          "c.id as cable_id",
          "c.name",
          "c.code",
          "cts.name as cable_type_name",

          "cc.path",
          "cc.tube",
          "cc.core",
          database.raw(`'B' AS side`),
          database.raw(`'to' AS core_status`),
        ])
        .where((qb) => {
          qb.where("c.site_from", site_point_id).orWhere(
            "c.site_to",
            site_point_id
          );
        });
      const cableCores = await coreFromQuery.unionAll([coreToQuery]).orderBy([
        { column: "cable_id", order: "asc" },
        { column: "tube", order: "asc" },
        { column: "core", order: "asc" },
        { column: "core_id", order: "asc" },
      ]);

      const assetsMap = assetPorts.reduce((acc, port) => {
        const assetId = port.asset_id;
        if (!acc[assetId]) {
          acc[assetId] = {
            asset_id: assetId,
            asset_name: port.name,
            asset_code: port.code,
            asset_type_name: port.asset_type_name,
            ports: [],
          };
        }
        acc[assetId].ports.push({
          port_id: port.port_id,
          path: port.path,
          port_type: port.port_type,
          number: port.number,
          port_status: port.port_status,
        });
        return acc;
      }, {});
      const cablesMap = cableCores.reduce((acc, core) => {
        const cableId = core.cable_id;
        if (!acc[cableId]) {
          acc[cableId] = {
            cable_id: cableId,
            cable_name: core.name,
            cable_code: core.code,
            cable_type_name: core.cable_type_name,
            cores: [],
          };
        }
        acc[cableId].cores.push({
          core_id: core.core_id,
          path: core.path,
          tube: core.tube,
          core: core.core,
          side: core.side,
          status: core.core_status,
        });
        return acc;
      }, {});

      const assets = Object.values(assetsMap);
      const cables = Object.values(cablesMap);

      const transactions = await database("core_transactions")
        .select([
          "id",
          "source_item_type",
          "source_item_type_id",
          "destination_item_type",
          "destination_item_type_id",
          "source_side",
          "destination_side",
        ])
        .where("site_point_id", site_point_id);

      const connections = transactions.map((trx) => {
        let from = null;
        let to = null;
        // SOURCE
        if (trx.source_item_type === "asset_ports") {
          from = `P$${trx.source_item_type_id}`;
        } else if (trx.source_item_type === "cable_cores") {
          from = `C$${trx.source_item_type_id}$${trx.source_side}`;
        }

        // DESTINATION
        if (trx.destination_item_type === "asset_ports") {
          to = `P$${trx.destination_item_type_id}`;
        } else if (trx.destination_item_type === "cable_cores") {
          to = `C$${trx.destination_item_type_id}$${trx.destination_side}`;
        }

        return {
          transaction_id: trx.id,
          from,
          to,
        };
      });

      const finalResults = {
        site_point_id,
        assets,
        cables,
        transactions: connections,
      };

      return res.send({ data: finalResults });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "transactions/fiber-diagram",
          reason: `Failed to get fiber-diagram${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
};
