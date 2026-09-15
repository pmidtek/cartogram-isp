import ExcelJS from "exceljs";

import {
  InvalidPayloadError,
  ServiceUnavailableError,
  ForbiddenError,
} from "@directus/errors";

export default (router, { database, logger, services }) => {
  const { ItemsService } = services;
  router.get("/my-price-list", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const priceService = new ItemsService("boq_bom_price", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const defaultPriceResult = await priceService.readByQuery({
        filter: { type: { _eq: "default" } },
      });
      const myPriceResult = await priceService.readByQuery({
        filter: { user_created: { _eq: accountability.user } },
      });

      const notInMyPrice = defaultPriceResult
        .filter((defaultItem) => {
          const exists = myPriceResult.some(
            (myItem) => myItem.asset_type_id === defaultItem.asset_type_id
          );
          return !exists;
        })
        .map((item) => ({
          asset_type_id: item.asset_type_id,
          price: item.price,
        }));

      if (notInMyPrice.length > 0) {
        logger.info("create not in price");
        await priceService.createMany(notInMyPrice);
      } else {
        logger.info("inon create price");
      }
      const myFinalPrice = await priceService.readByQuery({
        fields: [
          "id",
          "name",
          "asset_type_id.id",
          "asset_type_id.name",
          "price",
        ],
        filter: { user_created: { _eq: accountability.user } },
      });

      return res.send({
        data: myFinalPrice,
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "boq-bom/my-price-list",
          reason: `Failed to get my price list${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.patch("/my-price-list", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const priceService = new ItemsService("boq_bom_price", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });

      const items = req.body;
      for (const item of items) {
        if (!item.id || !item.price) {
          return next(
            new InvalidPayloadError({
              reason: `id and price required`,
            })
          );
        }
        await priceService.updateOne(item.id, {
          price: item.price,
        });
      }

      return res.send({
        data: "saved succesfully",
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "boq-bom/my-price-list",
          reason: `Failed to patch my price list${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/generate-boq-bom", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const {
        generate_type,
        is_price_default = true,
        geojson_point,
        geojson_route,
        site_points,
        assets,
        routes,
        cables,
      } = req.body;
      if (!generate_type) {
        return next(
          new InvalidPayloadError({
            reason: `generate_type required`,
          })
        );
      }
      if (generate_type == "draw") {
        if (!geojson_point || !geojson_route) {
          return next(
            new InvalidPayloadError({
              reason: `geojson_point and geojson_route required for draw mode`,
            })
          );
        }
      } else if (generate_type == "selection") {
        if (!site_points || !assets || !routes || !cables) {
          return next(
            new InvalidPayloadError({
              reason: `site_points, assets, routes, cables required for selection mode`,
            })
          );
        }
      } else {
        return next(
          new InvalidPayloadError({
            reason: `mode ${generate_type} not available`,
          })
        );
      }

      const priceService = new ItemsService("boq_bom_price", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });

      let priceFilter = { type: { _eq: "default" } };
      if (!is_price_default) {
        priceFilter = {
          user_created: {
            _eq: accountability.user,
          },
        };
      }

      const myPriceResult = await priceService.readByQuery({
        fields: [
          "id",
          "name",
          "asset_type_id.id",
          "asset_type_id.name",
          "price",
        ],
        filter: priceFilter,
      });
      if (myPriceResult.length == 0) {
        return next(
          new InvalidPayloadError({
            reason: `price list not setup`,
          })
        );
      }

      let boqItems = [];
      let bomItems = [];
      if (generate_type == "draw") {
        //POLE Calculate
        const poleCount = geojson_point.features.length;
        const polePrice = Math.round(
          parseFloat(
            myPriceResult.find((item) => item.asset_type_id.name === "POLE")
              ?.price ?? 0
          )
        );
        //Cable Calculate
        const cableFeature = geojson_route.features;
        const { rows: cableResult } = await database.raw(
          `WITH features AS (
            SELECT jsonb_array_elements(?::jsonb) AS feature
        ), lines AS (
            SELECT ST_GeomFromGeoJSON(feature->>'geometry')::geometry(LineString, 4326) AS geom
            FROM features
            WHERE (feature->'geometry'->>'type') = 'LineString'
        ), geog AS (
            SELECT ST_SetSRID(geom, 4326)::geography AS geog FROM lines
        ) SELECT ROUND(SUM(ST_Length(geog))::numeric, 2) AS total_length_m
            FROM geog;
        `,
          [JSON.stringify(cableFeature)]
        );

        const cableLength = cableResult[0].total_length_m;
        const cablePrice = Math.round(
          parseFloat(
            myPriceResult.find((item) => item.asset_type_id.name === "Cable")
              ?.price ?? 0
          )
        );

        boqItems = [
          {
            item: "POLE",
            quantity: poleCount,
            unit: "unit",
            unit_cost: polePrice,
            total_cost: poleCount * polePrice,
          },
          {
            item: "Cable",
            quantity: cableLength,
            unit: "meter",
            unit_cost: cablePrice,
            total_cost: cableLength * cablePrice,
          },
        ];
        bomItems = [
          {
            item: "POLE",
            quantity: poleCount,
            unit: "unit",
          },
          {
            item: "Cable",
            quantity: cableLength,
            unit: "meter",
          },
        ];
      } else if (generate_type == "selection") {
        const assetData = await database("assets")
          .innerJoin("asset_types as ast", "assets.asset_type_id", "ast.id")
          .whereIn("assets.id", assets)
          .select("ast.id as asset_type_id", "ast.name")
          .count("ast.id as count")
          .groupBy("ast.id", "ast.name");

        const cableData = await database("cables")
          .innerJoin("cable_routes", "cables.id", "cable_routes.cable_id")
          .innerJoin("routes", "cable_routes.route_id", "routes.id")
          .select(
            database.raw(
              "cables.id, SUM(ST_Length(routes.geom::geography)) AS total_length_m"
            )
          )
          .whereIn("cables.id", cables)
          .groupBy("cables.id");

        for (const asset of assetData) {
          const assetName = asset.name;
          const assetCount = asset.count;
          const assetPrice = Math.round(
            parseFloat(
              myPriceResult.find(
                (item) => item.asset_type_id.id === asset.asset_type_id
              )?.price ?? 0
            )
          );

          boqItems.push({
            item: assetName,
            quantity: assetCount,
            unit: "unit",
            unit_cost: assetPrice,
            total_cost: assetCount * assetPrice,
          });
          bomItems.push({
            item: assetName,
            quantity: assetCount,
            unit: "unit",
          });
        }

        const cableLength = cableData.reduce(
          (sum, item) => sum + parseFloat(item.total_length_m || 0),
          0
        );
        const cablePrice = Math.round(
          parseFloat(
            myPriceResult.find((item) => item.asset_type_id.name === "Cable")
              ?.price ?? 0
          )
        );
        boqItems.push({
          item: "Cable",
          quantity: cableLength,
          unit: "meter",
          unit_cost: cablePrice,
          total_cost: cableLength * cablePrice,
        });
        bomItems.push({ item: "Cable", quantity: cableLength, unit: "meter" });
      }

      let boqSummary = {
        total_cost: boqItems.reduce((sum, item) => sum + item.total_cost, 0),
      };

      return res.send({
        data: {
          boq: { summary: boqSummary, items: boqItems },
          bom: { summary: {}, items: bomItems },
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "boq-bom/my-price-list",
          reason: `Failed to generate boq bom${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });

  router.post("/ftth/generate-boq-bom", async (req, res, next) => {
    const { accountability } = req;
    if (!accountability.user) {
      return next(new ForbiddenError());
    }
    const {
      generate_type = "project", //selection
      is_price_default = true,
      project_id,
      assets = [],
      cables = [],
    } = req.body;
    if (!project_id) {
      return next(
        new InvalidPayloadError({
          reason: `project_id required`,
        })
      );
    }

    if (generate_type === "selection") {
      if (!Array.isArray(assets) || !Array.isArray(cables)) {
        return next(
          new InvalidPayloadError({
            reason: "assets dan cables harus array untuk selection mode",
          })
        );
      }
    } else if (generate_type !== "project") {
      return next(
        new InvalidPayloadError({
          reason: `mode ${generate_type} not available`,
        })
      );
    }

    try {
      const priceService = new ItemsService("ftth_boq_bom_price", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });

      let priceFilter = { is_default: { _eq: true } };
      if (!is_price_default) {
        priceFilter = {
          user_created: {
            _eq: accountability.user,
          },
          is_default: { _eq: false },
        };
      }
      const myPriceResult = await priceService.readByQuery({
        filter: priceFilter,
      });
      if (myPriceResult.length == 0) {
        return next(
          new InvalidPayloadError({
            reason: `price list not setup`,
          })
        );
      }

      const priceJoinAsset = is_price_default
        ? `AND fbbp.is_default = TRUE`
        : `AND fbbp.is_default = FALSE AND fbbp.user_created = ?`;
      const priceJoinCable = is_price_default
        ? `AND fbbp.is_default = TRUE`
        : `AND fbbp.is_default = FALSE AND fbbp.user_created = ?`;
      const priceJoinParams = is_price_default ? [] : [accountability.user];

      const assetWhere =
        generate_type === "project"
          ? `WHERE pa.project_id = ?`
          : `WHERE pa.project_id = ? AND a.id = ANY(?)`;
      const cableWhere =
        generate_type === "project"
          ? `WHERE pc.project_id = ?`
          : `WHERE pc.project_id = ? AND c.id = ANY(?)`;

      const assetIds = generate_type === "selection" ? assets || [] : null;
      const cableIds = generate_type === "selection" ? cables || [] : null;

      if (generate_type === "selection") {
        if (assetIds.length === 0 && cableIds.length === 0) {
          return res.send({
            data: {
              boq: { summary: { total_cost: 0 }, items: [] },
              bom: { items: [] },
            },
          });
        }
      }

      const assetParams = [
        ...priceJoinParams,
        project_id,
        ...(generate_type === "selection" ? [assetIds] : []),
      ];
      const { rows: boq_asset } = await database.raw(
        `SELECT
          at2."name" AS item, a.asset_group_id AS item_code,
          COUNT(a.id) AS quantity, fbbp.unit,
          fbbp.price AS unit_cost, COUNT(a.id)*COALESCE(fbbp.price, 0) AS total_cost
        FROM assets a
        INNER JOIN project_assets pa ON a.id = pa.asset_id
        LEFT JOIN asset_types at2 ON a.asset_type_id = at2.id
        LEFT JOIN ftth_boq_bom_price fbbp ON fbbp.item_type = 'asset'
          AND at2."name" = fbbp.item_type_name
          AND a.asset_group_id = fbbp.item_type_group
           ${priceJoinAsset}
        ${assetWhere}
        GROUP BY at2."name", a.asset_group_id, fbbp.unit, fbbp.price
        ORDER BY at2."name", a.asset_group_id
      ;`,
        assetParams
      );

      const cableParams = [
        ...priceJoinParams,
        project_id,
        ...(generate_type === "selection" ? [cableIds] : []),
      ];
      const { rows: boq_cable_meter } = await database.raw(
        `SELECT
          ct."name" AS item, c.cable_group_id AS item_code,
          CEIL(SUM(COALESCE(c.cable_net_length_m,0))) AS quantity, fbbp.unit,
          fbbp.price AS unit_cost, CEIL(SUM(COALESCE(c.cable_net_length_m,0)))*COALESCE(fbbp.price, 0) AS total_cost
        FROM cables c
        INNER JOIN project_cables pc ON c.id = pc.cable_id
        LEFT JOIN cable_types ct ON c.cable_type_id = ct.id
        LEFT JOIN ftth_boq_bom_price fbbp ON fbbp.item_type = 'cable'
          AND ct."name" = fbbp.item_type_name
          AND c.cable_group_id = fbbp.item_type_group
          ${priceJoinCable}
        ${cableWhere} AND fbbp.unit = 'meter'
        GROUP BY ct."name", c.cable_group_id, fbbp.unit, fbbp.price
        ORDER BY ct."name", c.cable_group_id
      ;`,
        cableParams
      );

      const { rows: boq_cable_unit } = await database.raw(
        `SELECT
          ct."name" AS item, c.cable_group_id AS item_code,
          COUNT(c.id) AS quantity, fbbp.unit,
          fbbp.price AS unit_cost, COUNT(c.id)*COALESCE(fbbp.price, 0) AS total_cost
        FROM cables c
        INNER JOIN project_cables pc ON c.id = pc.cable_id
        LEFT JOIN cable_types ct ON c.cable_type_id = ct.id
        LEFT JOIN ftth_boq_bom_price fbbp ON fbbp.item_type = 'cable'
          AND ct."name" = fbbp.item_type_name
          AND c.cable_group_id = fbbp.item_type_group
          ${priceJoinCable}
        ${cableWhere} AND fbbp.unit != 'meter'
        GROUP BY ct."name", c.cable_group_id, fbbp.unit, fbbp.price
        ORDER BY ct."name", c.cable_group_id
      ;`,
        cableParams
      );

      const boqItems = [...boq_asset, ...boq_cable_meter, ...boq_cable_unit];
      const bomItems = boqItems.map((row) => ({
        item: row.item,
        item_code: row.item_code,
        quantity: row.quantity,
        unit: row.unit,
      }));

      const boqSummary = boqItems.reduce(
        (acc, row) => {
          acc.total_cost += Number(row.total_cost || 0);
          return acc;
        },
        {
          total_cost: 0,
        }
      );

      return res.send({
        data: {
          boq: {
            summary: boqSummary,
            items: boqItems,
          },
          bom: {
            items: bomItems,
          },
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "boq-bom/ftth/generate-boq-bom",
          reason: "Failed to generate boq bom",
        })
      );
    }
  });
  router.get("/ftth/my-price-list", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const priceService = new ItemsService("ftth_boq_bom_price", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });
      const defaultPriceResult = await priceService.readByQuery({
        filter: { is_default: { _eq: true } },
      });
      const myPriceResult = await priceService.readByQuery({
        filter: {
          user_created: { _eq: accountability.user },
          is_default: { _eq: false },
        },
      });

      const notInMyPrice = defaultPriceResult
        .filter((defaultItem) => {
          const exists = myPriceResult.some(
            (myItem) =>
              myItem.item_type === defaultItem.item_type &&
              myItem.item_type_name === defaultItem.item_type_name &&
              myItem.item_type_group === defaultItem.item_type_group
          );
          return !exists;
        })
        .map((defaultItem) => {
          const {
            id,
            is_default,
            user_created,
            date_created,
            user_updated,
            date_updated,
            ...item
          } = defaultItem;

          return item;
        });

      if (notInMyPrice.length > 0) {
        logger.info("create not in price");
        await priceService.createMany(notInMyPrice);
      } else {
        logger.info("non create price");
      }
      const myFinalPrice = await priceService.readByQuery({
        fields: [
          "id",
          "item_type",
          "item_type_name",
          "item_type_group",
          "description",
          "quantity",
          "unit",
          "price",
        ],
        filter: {
          user_created: { _eq: accountability.user },
          is_default: { _eq: false },
        },
        sort: ["item_type", "item_type_name", "item_type_group"],
      });

      return res.send({
        data: myFinalPrice,
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "boq-bom/ftth/my-price-list",
          reason: `Failed to get my price list${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.patch("/ftth/my-price-list", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const priceService = new ItemsService("ftth_boq_bom_price", {
        accountability: req.accountability,
        schema: req.schema,
        knex: database,
      });

      const items = req.body;
      for (const item of items) {
        if (!item.id || !item.price) {
          return next(
            new InvalidPayloadError({
              reason: `id and price required`,
            })
          );
        }
        await priceService.updateOne(item.id, {
          price: item.price,
        });
      }

      return res.send({
        data: "saved succesfully",
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "boq-bom/ftth/my-price-list",
          reason: `Failed to patch my price list${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });

  router.post(
    "/ftth/v2/generate-boq-bom",
    generateBoqBomHandler({ database, logger, services })
  );

  router.post(
    "/feeder-simple/generate-boq-bom",
    generateFeederSimpleBoqBomHandler({ database, logger })
  );
};

function generateBoqBomHandler({ database, logger, services }) {
  function buildBOQMap(codes, priceList) {
    return Object.fromEntries(
      codes.map((code) => [
        code,
        {
          uom: priceList[code]?.uom ?? null,
          qty: 0,
          price: priceList[code]?.price_rp ?? 0,
          total: 0,
          description: priceList[code]?.description ?? null,
          formula: priceList[code]?.formula ?? null,
        },
      ])
    );
  }
  function applyQueryResultToBOQ(boqMap, rows, { ceilQty = false } = {}) {
    for (const row of rows) {
      const code = row.code;
      if (!boqMap[code]) continue;

      let qty = Number(row.qty || 0);
      if (ceilQty) qty = Math.ceil(qty);

      boqMap[code].qty = qty;
      boqMap[code].total = qty * boqMap[code].price;
      boqMap[code].description = boqMap[code].description;
      boqMap[code].formula = boqMap[code].formula;
    }
  }
  async function getCableGrouped(
    database,
    project_id,
    cableTypeId,
    mode = "sum"
  ) {
    const qb = database("cables as c")
      .select("c.cable_group_id as code")
      .innerJoin("project_cables as pc", "c.id", "pc.cable_id")
      .where("pc.project_id", project_id)
      .where("c.cable_type_id", cableTypeId)
      .groupBy("c.cable_group_id");

    if (mode === "sum") {
      qb.sum({ qty: "c.cable_net_length_m" });
    } else {
      qb.count("* as qty");
    }

    return qb;
  }
  async function getAssetGrouped(database, project_id, assetTypeId) {
    return database("assets as a")
      .select("a.asset_group_id as code")
      .count("* as qty")
      .innerJoin("project_assets as pa", "a.id", "pa.asset_id")
      .where("pa.project_id", project_id)
      .where("a.asset_type_id", assetTypeId)
      .groupBy("a.asset_group_id");
  }
  function calculateSC(feederCableBOQ, scBOQ) {
    const len24 = feederCableBOQ["M-FO-24C"]?.qty || 0;
    const len48 = feederCableBOQ["M-FO-48C"]?.qty || 0;
    const len96 = feederCableBOQ["M-FO-96C"]?.qty || 0;
    const len144 = feederCableBOQ["M-FO-144C"]?.qty || 0;
    const len288 = feederCableBOQ["M-FO-288C"]?.qty || 0;

    const totalSC2550 = Math.ceil((len24 / 40) * 2);
    const totalSC5070 = Math.ceil(((len48 + len96) / 40) * 2);
    const totalSC7090 = Math.ceil(((len144 + len288) / 40) * 2);

    scBOQ["M-SC-F-25/50"].qty = totalSC2550;
    scBOQ["M-SC-F-50/70"].qty = totalSC5070;
    scBOQ["M-SC-F-70/90"].qty = totalSC7090;

    Object.values(scBOQ).forEach((item) => {
      item.total = item.qty * item.price;
    });
    return totalSC2550 + totalSC5070 + totalSC7090;
  }

  const boqToRows = (boqMap) =>
    Object.entries(boqMap).map(([code, item]) => ({
      code,
      uom: item.uom,
      qty: item.qty,
      price: item.price,
      total: item.total,
      description: item.description,
      formula: item.formula,
    }));
  const calcSubtotal = (rows) =>
    rows.reduce((sum, r) => sum + Number(r.total || 0), 0);
  const GROUP_CONFIG_MATERIAL = [
    {
      name: "Feeder Material",
      keys: [
        "feederCableBOQ",
        "poleBOQ",
        "scBOQ",
        "xFrame80BOQ",
        "closureBOQ",
        "otbBOQ",
        "mFeedManualBOQ",
      ],
    },
    {
      name: "Distribution Material",
      keys: ["distCableBOQ", "otherDistBOQ", "odcBOQ", "odpBOQ"],
    },
    {
      name: "Accessories Support",
      keys: ["accBOQ"],
    },
    {
      name: "IKR Material",
      keys: ["ikrCableBOQ", "ikrClampBOQ"],
    },
  ];
  const GROUP_CONFIG_SERVICES = [
    {
      name: "Feeder Services",
      keys: ["feederCableSVBOQ", "poleSVBOQ", "otherFeederSvBOQ"],
    },
    {
      name: "Distribution Services",
      keys: ["distCableSVBOQ", "otherDistSvBOQ", "odcOdpSVBOQ"],
    },
    {
      name: "Add On Services",
      keys: ["ontSVBOQ", "sAOSManualBOQ"],
    },
    {
      name: "Add On Material",
      keys: ["sAOMManualBOQ"],
    },
  ];
  const GROUP_CONFIG_IKR_SERVICES = [
    {
      name: "IKR Services",
      keys: ["ikrSVBOQ"],
    },
  ];
  const buildBOQGroups = (boqResult, GROUP_CONFIG, groupName) => {
    const groups = [];
    let grandTotal = 0;

    for (const group of GROUP_CONFIG) {
      let rows = [];

      for (const key of group.keys) {
        const boq = boqResult[key];
        if (!boq) continue;

        rows = rows.concat(boqToRows(boq));
      }

      const subtotal = calcSubtotal(rows);

      groups.push({
        name: group.name,
        rows,
        total: subtotal,
      });

      grandTotal += subtotal;
    }

    return {
      group_name: groupName,
      group_total: grandTotal,
      groups,
    };
  };

  return async (req, res, next) => {
    const { accountability } = req;
    if (!accountability.user) {
      return next(new ForbiddenError());
    }
    const { project_id, download } = req.body;
    if (!project_id) {
      return next(
        new InvalidPayloadError({
          reason: `project_id required`,
        })
      );
    }
    if (download && download != "excel") {
      return next(
        new InvalidPayloadError({
          reason: `download type not allowed`,
        })
      );
    }
    const { manual_input = {} } = req.body;
    const { material = {}, homepass = {}, homeconnect = {} } = manual_input;
    const { feeder: materialFeeder = {} } = material;
    const {
      description: homepassDesc = {},
      add_on_services: homepassAOS = {},
      add_on_material: homepassAOM = {},
    } = homepass;
    const { description: homeconnectDesc } = homeconnect;

    try {
      const priceData = await database("boq_bom_price_default").select(
        "code",
        "description",
        "uom",
        "price_rp",
        "formula"
      );
      const priceList = priceData.reduce((acc, item) => {
        acc[item.code] = item;
        return acc;
      }, {});

      // ================= MATERIAL =================
      // ================= FEEDER =================
      const feederCableId = 3;
      const feederCodes = [
        "M-FO-24C",
        "M-FO-48C",
        "M-FO-96C",
        "M-FO-144C",
        "M-FO-288C",
      ];
      const feederCableBOQ = buildBOQMap(feederCodes, priceList);
      const feederRows = await getCableGrouped(
        database,
        project_id,
        feederCableId,
        "sum"
      );
      applyQueryResultToBOQ(feederCableBOQ, feederRows, { ceilQty: true });

      // ================= POLE =================
      const poleId = 22;
      const poleCodes = ["T6", "T7", "T9"];
      const poleBOQ = buildBOQMap(poleCodes, priceList);

      const poleRows = await getAssetGrouped(database, project_id, poleId);
      applyQueryResultToBOQ(poleBOQ, poleRows);

      // ================= SC =================
      const scCodes = ["M-SC-F-25/50", "M-SC-F-50/70", "M-SC-F-70/90"];
      const scBOQ = buildBOQMap(scCodes, priceList);
      const totalSC = calculateSC(feederCableBOQ, scBOQ);

      // ================= CLOSURE =================
      const closureId = 24;
      const closureCodes = [
        "M-CL-F-24C+",
        "M-CL-F-48C+",
        "M-CL-F-96C+",
        "M-CL-F-144C+",
        "M-CL-F-288C+",
      ];
      const closureBOQ = buildBOQMap(closureCodes, priceList);
      const closureRows = await getAssetGrouped(
        database,
        project_id,
        closureId
      );
      applyQueryResultToBOQ(closureBOQ, closureRows);

      const totalJC24 = closureBOQ["M-CL-F-24C+"].qty;
      const totalJC48 = closureBOQ["M-CL-F-48C+"].qty;
      const totalJC96 = closureBOQ["M-CL-F-96C+"].qty;
      const totalJC144 = closureBOQ["M-CL-F-144C+"].qty;
      const totalJC288 = closureBOQ["M-CL-F-288C+"].qty;
      const totalJC =
        totalJC24 + totalJC48 + totalJC96 + totalJC144 + totalJC288;

      // ================= X Frame 80 X 80 =================
      const coilId = 47;
      const xFrame80Codes = ["M-XF-F-80X80"];
      const xFrame80BOQ = buildBOQMap(xFrame80Codes, priceList);
      const coilRows = await getAssetGrouped(database, project_id, coilId);
      const totalCoil = coilRows.reduce(
        (sum, row) => sum + Number(row.qty || 0),
        0
      );
      const totalXFrame80 = totalCoil + totalJC;
      xFrame80BOQ["M-XF-F-80X80"].qty = totalXFrame80;
      xFrame80BOQ["M-XF-F-80X80"].total =
        totalXFrame80 * xFrame80BOQ["M-XF-F-80X80"].price;

      // ================= OTB =================
      const oltId = 4;
      const otbCodes = [
        "M-OTB-F-48SLC-1U+",
        "M-OTB-F-96SLC-2U+",
        "M-OTB-F-144SLC-4U+",
        "M-OTB-F-288SLC-6U+",
      ];
      const feederToOtbMap = {
        "M-FO-24C": "M-OTB-F-48SLC-1U+",
        "M-FO-48C": "M-OTB-F-48SLC-1U+",
        "M-FO-96C": "M-OTB-F-96SLC-2U+",
        "M-FO-144C": "M-OTB-F-144SLC-4U+",
        "M-FO-288C": "M-OTB-F-288SLC-6U+",
      };
      const feederCountRows = await database("cables as c")
        .select("c.cable_group_id as code")
        .count("* as qty")
        .innerJoin("project_cables as pc", "c.id", "pc.cable_id")
        .innerJoin("site_points as sf", "c.site_from", "sf.id")
        .innerJoin("assets as af", "sf.id", "af.site_point_id")
        .where("pc.project_id", project_id)
        .andWhere("c.cable_type_id", feederCableId)
        .andWhere("af.asset_type_id", oltId)
        .groupBy("c.cable_group_id");
      const remappedFeederCountRows = feederCountRows.map((row) => ({
        ...row,
        code: feederToOtbMap[row.code] || row.code,
      }));
      const otbObj = remappedFeederCountRows.reduce((acc, row) => {
        const code = row.code;
        const qty = Number(row.qty) || 0;
        if (!acc[code]) {
          acc[code] = { code, qty: 0 };
        }
        acc[code].qty += qty;
        return acc;
      }, {});
      const otbRows = Object.values(otbObj);
      const otbBOQ = buildBOQMap(otbCodes, priceList);
      applyQueryResultToBOQ(otbBOQ, otbRows);

      const totalOTB48 = otbBOQ["M-OTB-F-48SLC-1U+"].qty;
      const totalOTB96 = otbBOQ["M-OTB-F-96SLC-2U+"].qty;
      const totalOTB144 = otbBOQ["M-OTB-F-144SLC-4U+"].qty;
      const totalOTB288 = otbBOQ["M-OTB-F-288SLC-6U+"].qty;
      const totalOtb = totalOTB48 + totalOTB96 + totalOTB144 + totalOTB288;

      const mFeedManualCodes = [
        "M-PC-F-SMSCLC/U-DX3M",
        "M-PC-F-SMSCLC/U-DX5M",
        "M-PC-F-SMSCLC/U-DX10M",
        "M-HDPE-F-40/33MM",
      ];
      const mFeedManualBOQ = buildBOQMap(mFeedManualCodes, priceList);
      const mFeedManualRows = Object.entries(materialFeeder).map(
        ([key, value]) => ({
          code: key,
          qty: value,
        })
      );
      applyQueryResultToBOQ(mFeedManualBOQ, mFeedManualRows);

      // ================= DISTRIBUTION =================
      const distCableId = 4;
      const distCodes = ["M-PR-D-50M", "M-PR-D-100M", "M-PR-D-150M"];
      const distCableBOQ = buildBOQMap(distCodes, priceList);
      const distRows = await getCableGrouped(
        database,
        project_id,
        distCableId,
        "count"
      );
      applyQueryResultToBOQ(distCableBOQ, distRows);

      // ================= ODC =================
      const odcId = 3;
      const odcCodes = ["M-ODC-D-8SCUPC+"];
      const odcBOQ = buildBOQMap(odcCodes, priceList);
      const odcRows = await getAssetGrouped(database, project_id, odcId);
      applyQueryResultToBOQ(odcBOQ, odcRows);

      // ================= ODP =================
      const odpId = 2;
      const odpCodes = ["M-ODP-D-8SCUPC+"];
      const odpBOQ = buildBOQMap(odpCodes, priceList);
      const odpRows = await getAssetGrouped(database, project_id, odpId);
      applyQueryResultToBOQ(odpBOQ, odpRows);

      const totalODC = odcBOQ["M-ODC-D-8SCUPC+"].qty;
      const totalODP = odpBOQ["M-ODP-D-8SCUPC+"].qty;

      // ================= Other Dist Material =================
      const otherDistCodes = [
        "M-PC-D-SMSCSC/U-SX3MOUT",
        "M-CL-D-DW",
        "M-XF-D-40X40",
        "M-PSTR-D",
        "M-CL-F-24C+(Mini)",
      ];
      const otherDistBOQ = buildBOQMap(otherDistCodes, priceList);

      otherDistBOQ["M-PC-D-SMSCSC/U-SX3MOUT"].qty = totalODC;
      otherDistBOQ["M-PC-D-SMSCSC/U-SX3MOUT"].total =
        totalODC * otherDistBOQ["M-PC-D-SMSCSC/U-SX3MOUT"].price;

      const precon50Count = distCableBOQ["M-PR-D-50M"].qty;
      const precon100Count = distCableBOQ["M-PR-D-100M"].qty;
      const precon150Count = distCableBOQ["M-PR-D-150M"].qty;
      const totalClampS =
        precon50Count * 2 + precon100Count * 4 + precon150Count * 6;
      otherDistBOQ["M-CL-D-DW"].qty = totalClampS;
      otherDistBOQ["M-CL-D-DW"].total =
        totalClampS * otherDistBOQ["M-CL-D-DW"].price;

      const totalXFrame40 = totalODC + totalODP;
      otherDistBOQ["M-XF-D-40X40"].qty = totalXFrame40;
      otherDistBOQ["M-XF-D-40X40"].total =
        totalXFrame40 * otherDistBOQ["M-XF-D-40X40"].price;

      const totalPole = poleRows.reduce(
        (sum, row) => sum + Number(row.qty || 0),
        0
      );
      const totalClampRing = totalPole * 2;
      otherDistBOQ["M-PSTR-D"].qty = totalClampRing;
      otherDistBOQ["M-PSTR-D"].total =
        totalClampRing * otherDistBOQ["M-PSTR-D"].price;

      const totalJC24Mini = totalODC;
      otherDistBOQ["M-CL-F-24C+(Mini)"].qty = totalJC24Mini;
      otherDistBOQ["M-CL-F-24C+(Mini)"].total =
        totalJC24Mini * otherDistBOQ["M-CL-F-24C+(Mini)"].price;

      // ================= Accessssories =================
      const accCodes = ["M-SB-F-50M", "M-SB-F-XXX"];
      const accBOQ = buildBOQMap(accCodes, priceList);

      const totalSB = Math.ceil(
        (((totalXFrame40 + totalXFrame80) * 2 + totalSC) * 50) / 100 / 50
      );
      accBOQ["M-SB-F-50M"].qty = totalSB;
      accBOQ["M-SB-F-50M"].total = totalSB * accBOQ["M-SB-F-50M"].price;

      const totalSBR = totalSB * 100;
      accBOQ["M-SB-F-XXX"].qty = totalSBR;
      accBOQ["M-SB-F-XXX"].total = totalSBR * accBOQ["M-SB-F-XXX"].price;

      // ================= IKR =================
      const ikrCableId = 5;
      const ikrCodes = ["M-PR-IKR-50M", "M-PR-IKR-100M", "M-PR-IKR-150M"];
      const ikrCableBOQ = buildBOQMap(ikrCodes, priceList);
      const ikrRows = await getCableGrouped(
        database,
        project_id,
        ikrCableId,
        "count"
      );
      applyQueryResultToBOQ(ikrCableBOQ, ikrRows);

      // ================= IKR Clamp =================
      const ontId = 1;
      const ontRows = await getAssetGrouped(database, project_id, ontId);
      const totalOnt = ontRows.reduce(
        (sum, row) => sum + Number(row.qty || 0),
        0
      );

      const ikrClampCodes = ["M-CL-IKR-DW", "M-CH-IKR-DW"];
      const ikrClampBOQ = buildBOQMap(ikrClampCodes, priceList);
      const ikqCLqty = 2 * totalOnt;
      const ikqCHqty = totalOnt;
      ikrClampBOQ["M-CL-IKR-DW"].qty = ikqCLqty;
      ikrClampBOQ["M-CH-IKR-DW"].qty = ikqCHqty;
      ikrClampBOQ["M-CL-IKR-DW"].total =
        ikqCLqty * ikrClampBOQ["M-CL-IKR-DW"].price;
      ikrClampBOQ["M-CH-IKR-DW"].total =
        ikqCHqty * ikrClampBOQ["M-CH-IKR-DW"].price;

      // ================= Services =================
      // ================= FEEDER =================
      const feederSVCodes = [
        "S-PC-F-24C",
        "S-PC-F-48C",
        "S-PC-F-96C",
        "S-PC-F-144C",
        "S-PC-F-288C",
      ];
      const feederToSVMap = {
        "M-FO-24C": "S-PC-F-24C",
        "M-FO-48C": "S-PC-F-48C",
        "M-FO-96C": "S-PC-F-96C",
        "M-FO-144C": "S-PC-F-144C",
        "M-FO-288C": "S-PC-F-288C",
      };
      const remappedFeederRows = feederRows.map((row) => ({
        ...row,
        code: feederToSVMap[row.code] || row.code,
      }));
      const feederCableSVBOQ = buildBOQMap(feederSVCodes, priceList);
      applyQueryResultToBOQ(feederCableSVBOQ, remappedFeederRows, {
        ceilQty: true,
      });

      // ================= POLE =================
      const poleSVCodes = ["S-DP-F-6M", "S-DP-F-7M", "S-DP-F-9M"];
      const poleToSVmap = { T6: "S-DP-F-6M", T7: "S-DP-F-7M", T9: "S-DP-F-9M" };
      const remappedPoleRows = poleRows.map((row) => ({
        ...row,
        code: poleToSVmap[row.code] || row.code,
      }));
      const poleSVBOQ = buildBOQMap(poleSVCodes, priceList);
      applyQueryResultToBOQ(poleSVBOQ, remappedPoleRows);

      // ================= Other Feeder Services =================
      const otherFeederSvCodes = [
        "S-XF-F",
        "S-ACC-F",
        "S-IOTB-F-48C+",
        "S-SOTB-F-48C+",
        "S-ICL-F-48C+",
        "S-SCL-F-48+",
      ];
      const otherFeederSvBOQ = buildBOQMap(otherFeederSvCodes, priceList);

      otherFeederSvBOQ["S-XF-F"].qty = totalXFrame80;
      otherFeederSvBOQ["S-XF-F"].total =
        totalXFrame80 * otherFeederSvBOQ["S-XF-F"].price;

      otherFeederSvBOQ["S-ACC-F"].qty = totalSC;
      otherFeederSvBOQ["S-ACC-F"].total =
        totalSC * otherFeederSvBOQ["S-ACC-F"].price;

      otherFeederSvBOQ["S-IOTB-F-48C+"].qty = totalOtb;
      otherFeederSvBOQ["S-IOTB-F-48C+"].total =
        totalOtb * otherFeederSvBOQ["S-IOTB-F-48C+"].price;

      const totalCoreOTB =
        totalOTB48 * 48 +
        totalOTB96 * 96 +
        totalOTB144 * 144 +
        totalOTB288 * 288;
      otherFeederSvBOQ["S-SOTB-F-48C+"].qty = totalCoreOTB;
      otherFeederSvBOQ["S-SOTB-F-48C+"].total =
        totalCoreOTB * otherFeederSvBOQ["S-SOTB-F-48C+"].price;

      otherFeederSvBOQ["S-ICL-F-48C+"].qty = totalJC;
      otherFeederSvBOQ["S-ICL-F-48C+"].total =
        totalJC * otherFeederSvBOQ["S-ICL-F-48C+"].price;

      const totalCoreJC =
        totalJC24 * 12 +
        totalJC48 * 24 +
        totalJC96 * 48 +
        totalJC144 * 72 +
        totalJC288 * 144;
      otherFeederSvBOQ["S-SCL-F-48+"].qty = totalCoreJC;
      otherFeederSvBOQ["S-SCL-F-48+"].total =
        totalCoreJC * otherFeederSvBOQ["S-SCL-F-48+"].price;

      // ================= Distribution =================
      const distCableSVCodes = ["S-PC-D-1/2C"];
      const distCableSVBOQ = buildBOQMap(distCableSVCodes, priceList);
      const distSVqty =
        precon50Count * 50 + precon100Count * 100 + precon150Count * 150;
      distCableSVBOQ["S-PC-D-1/2C"].qty = distSVqty;
      distCableSVBOQ["S-PC-D-1/2C"].total =
        distSVqty * distCableSVBOQ["S-PC-D-1/2C"].price;

      const odcOdpSVCodes = ["S-IODC-D-8PT+", "S-IODP-D"];
      const odcOdpSVBOQ = buildBOQMap(odcOdpSVCodes, priceList);

      odcOdpSVBOQ["S-IODC-D-8PT+"].qty = totalODC;
      odcOdpSVBOQ["S-IODC-D-8PT+"].total =
        totalODC * odcOdpSVBOQ["S-IODC-D-8PT+"].price;
      odcOdpSVBOQ["S-IODP-D"].qty = totalODP;
      odcOdpSVBOQ["S-IODP-D"].total = totalODP * odcOdpSVBOQ["S-IODP-D"].price;

      const ontSVCodes = ["S-SND-AO", "S-SPMT-AO"];
      const ontSVBOQ = buildBOQMap(ontSVCodes, priceList);
      ontSVBOQ["S-SND-AO"].qty = totalOnt;
      ontSVBOQ["S-SND-AO"].total = totalOnt * ontSVBOQ["S-SND-AO"].price;
      ontSVBOQ["S-SPMT-AO"].qty = totalOnt;
      ontSVBOQ["S-SPMT-AO"].total = totalOnt * ontSVBOQ["S-SPMT-AO"].price;

      const otherDistSvCode = ["S-XF-D", "S-ACC-D"];
      const otherDistSvBOQ = buildBOQMap(otherDistSvCode, priceList);
      otherDistSvBOQ["S-XF-D"].qty = totalXFrame40;
      otherDistSvBOQ["S-XF-D"].total =
        totalXFrame40 * otherDistSvBOQ["S-XF-D"].price;
      const totalAccKu = totalClampS + totalClampRing;
      otherDistSvBOQ["S-ACC-D"].qty = totalAccKu;
      otherDistSvBOQ["S-ACC-D"].total =
        totalAccKu * otherDistSvBOQ["S-ACC-D"].price;

      // manual
      const sAOSManualCodes = [
        "S-PMT-AO-CND",
        "S-AQS-AO",
        "S-TRP-AO",
        "S-HB-AO",
        "S-DOC-AO",
        "S-OPTRCND-AO-0.4",
        "S-SRCND-AO",
        "S-IPCLCND-AO",
        "S-IFCCND-AO",
        "S-IPVCCND-AO",
        "S-IPRBSCND-AO",
        "S-HDPE-AO-40/33/1P",
        "S-HDPE-AO-40/33/2P",
        "S-HDPE-AO-50/42/1P",
        "S-HDPE-AO-50/42/2P",
        "S-BC-AO-1.5-40/33",
      ];
      const sAOSManualBOQ = buildBOQMap(sAOSManualCodes, priceList);
      const sAOSManualRows = Object.entries(homepassAOS).map(
        ([key, value]) => ({
          code: key,
          qty: value,
        })
      );
      applyQueryResultToBOQ(sAOSManualBOQ, sAOSManualRows);

      const sAOMManualCodes = [
        "M-PL-AO-9M",
        "M-HDPECND-AO-40/30MM",
        "M-PCLCND-AO-4M/2",
        "M-FCCND-AO-W",
        "M-SPCND-AO",
        "M-CPCND-AO",
        "M-FSCND-AO",
        "M-PGLCND-AO-6M/2IN",
        "M-CGLCND-AO-2IN",
        "M-DYBCND-AO-10MM",
        "M-DYBCND-AO-12MM",
      ];
      const sAOMManualBOQ = buildBOQMap(sAOMManualCodes, priceList);
      const sAOMManualRows = Object.entries(homepassAOM).map(
        ([key, value]) => ({
          code: key,
          qty: value,
        })
      );
      applyQueryResultToBOQ(sAOMManualBOQ, sAOMManualRows);

      // ================= Services IKR =================
      const ikrSVCodes = ["S-PC-IKR"];
      const ikrSVBOQ = buildBOQMap(ikrSVCodes, priceList);
      ikrSVBOQ["S-PC-IKR"].qty = totalOnt;
      ikrSVBOQ["S-PC-IKR"].total = totalOnt * ikrSVBOQ["S-PC-IKR"].price;

      // ================= FINAL =================
      const boqMaterialResult = {
        feederCableBOQ,
        poleBOQ,
        scBOQ,
        xFrame80BOQ,
        closureBOQ,
        otbBOQ,
        mFeedManualBOQ,
        distCableBOQ,
        otherDistBOQ,
        odcBOQ,
        odpBOQ,
        accBOQ,
        ikrCableBOQ,
        ikrClampBOQ,
      };
      const boqServicesResult = {
        feederCableSVBOQ,
        poleSVBOQ,
        otherFeederSvBOQ,
        distCableSVBOQ,
        odcOdpSVBOQ,
        otherDistSvBOQ,
        ontSVBOQ,
        sAOSManualBOQ,
        sAOMManualBOQ,
      };
      const boqIKRServicesResult = {
        ikrSVBOQ,
      };

      const materialSummary = buildBOQGroups(
        boqMaterialResult,
        GROUP_CONFIG_MATERIAL,
        "Material"
      );
      const servicesSummary = buildBOQGroups(
        boqServicesResult,
        GROUP_CONFIG_SERVICES,
        "Homepass"
      );
      const ikrServicesSummary = buildBOQGroups(
        boqIKRServicesResult,
        GROUP_CONFIG_IKR_SERVICES,
        "Home Connect"
      );

      // other info
      const len24 = feederCableBOQ["M-FO-24C"]?.qty || 0;
      const len48 = feederCableBOQ["M-FO-48C"]?.qty || 0;
      const len96 = feederCableBOQ["M-FO-96C"]?.qty || 0;
      const len144 = feederCableBOQ["M-FO-144C"]?.qty || 0;
      const len288 = feederCableBOQ["M-FO-288C"]?.qty || 0;
      const feederLength = len24 + len48 + len96 + len144 + len288;

      const mCost = materialSummary.group_total;
      const sCost = servicesSummary.group_total;
      const iCost = ikrServicesSummary.group_total;
      const totalCost = mCost + sCost + iCost;

      const mHomePass = materialSummary.groups.slice(0, 3);
      const mHomeConnect = materialSummary.groups.slice(3, 4);
      const mHomePassCost = mHomePass.reduce(
        (sum, row) => sum + Number(row.total || 0),
        0
      );
      const mHomeConnectCost = mHomeConnect.reduce(
        (sum, row) => sum + Number(row.total || 0),
        0
      );

      const mJIACost = Object.values(feederCableBOQ).reduce(
        (sum, item) => sum + (item.total || 0),
        0
      );

      const materialDesc = {
        homepass: totalOnt,
        panjang_kabel: feederLength,
        total_tiang: totalPole,
      };
      const materialInfo = {
        cost_material: mCost,
        cost_service_homepass: sCost,
        cost_service_connect: iCost,
        total_cost: totalCost,
        cpa_material: Number((mCost / totalOnt).toFixed(2)),
        cpa_service_homepass: Number((sCost / totalOnt).toFixed(2)),
        cpa_service_home_connect: Number((iCost / totalOnt).toFixed(2)),
        total_cpa: Number((totalCost / totalOnt).toFixed(2)),
        material_homepass: mHomePassCost,
        material_home_connect: mHomeConnectCost,
        material_jia: mJIACost,
        material_lda: mCost - mJIACost,
      };
      const homepassInfo = {
        homepass: totalOnt,
        service_homepass: sCost,
        cpa_homepass: Number((sCost / totalOnt).toFixed(2)),
        site: homepassDesc?.site ?? null,
        timeline: homepassDesc?.timeline ?? null,
        term_of_payment: homepassDesc?.term_of_payment ?? null,
      };
      const ikrInfo = {
        home_connect: totalOnt,
        service_home_connect: iCost,
        cpa_home_connect: Number((iCost / totalOnt).toFixed(2)),
        site: homeconnectDesc?.site ?? null,
        timeline: homeconnectDesc?.timeline ?? null,
        term_of_payment: homeconnectDesc?.term_of_payment ?? null,
      };

      if (download) {
        logger.info("download");
        // const FONT_NAME = "Arial";
        const FONT_NAME = "Aptos Narrow";
        const COLOR = {
          HEADER_BLUE: "FF2F5496", // header tabel BOM
          HEADER_GREEN: "38761D", // header & subtotal Homepass/Home Connect
          SUBTOTAL_LIGHT: "FFC9DAF8", // subtotal section di Material
          SUBTOTAL_LIGHT2: "FFB6D7A8",
          GRANDTOTAL: "FFCFE2F3", // grand total Material
          WHITE: "FFFFFFFF",
          BLACK: "FF000000",
        };
        const FMT = {
          INT: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)',
          INT2: '_(* #,##0_);_(* (#,##0);_(* "-"??_);_(@_)',
          RP: '_-[$Rp-3809]* #,##0_-;-[$Rp-3809]* #,##0_-;_-[$Rp-3809]* "-"_-;_-@_-',
          RP2: '_-[$Rp-3809]* #,##0.00_-;-[$Rp-3809]* #,##0.00_-;_-[$Rp-3809]* "-"_-;_-@_-',
        };
        const thinBorder = {
          top: { style: "thin", color: { argb: "FFBFBFBF" } },
          left: { style: "thin", color: { argb: "FFBFBFBF" } },
          bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
          right: { style: "thin", color: { argb: "FFBFBFBF" } },
        };

        function fill(argb) {
          return { type: "pattern", pattern: "solid", fgColor: { argb } };
        }
        function applyHeader(
          cell,
          bgColor = COLOR.HEADER_BLUE,
          fontColor = COLOR.WHITE
        ) {
          cell.font = {
            name: FONT_NAME,
            bold: true,
            size: 12,
            color: { argb: fontColor },
          };
          cell.fill = fill(bgColor);
          cell.alignment = {
            vertical: "middle",
            horizontal: "center",
            wrapText: true,
          };
          cell.border = thinBorder;
        }
        function applySectionHeader(cell, bg = COLOR.SUBTOTAL_LIGHT) {
          cell.font = { name: FONT_NAME, bold: true, size: 11 };
          cell.fill = fill(bg);
          cell.alignment = { vertical: "middle" };
          cell.border = thinBorder;
        }
        //--- MAIN FUNCTION ---
        const workbook = new ExcelJS.Workbook();
        const ws1 = workbook.addWorksheet("Material");
        const ws2 = workbook.addWorksheet("Homepass");
        const ws3 = workbook.addWorksheet("Home Connect");

        const COLUMN_WIDTH = [
          { width: 31 },
          { width: 35 },
          { width: 19 },
          { width: 19 },
          { width: 18 },
          { width: 26 },
          { width: 100 },
        ];
        ws1.columns = COLUMN_WIDTH;
        ws2.columns = COLUMN_WIDTH;
        ws3.columns = COLUMN_WIDTH;

        // sheet 1
        ws1.getCell("A3").value = "Forecast FTTH";
        ws1.getCell("A3").font = { name: FONT_NAME, bold: true, size: 18 };

        ws1.mergeCells("A4:B4");
        ws1.getCell("A4").value = "Description";
        ws1.getCell("C4").value = "Formula";
        ["A4", "C4"].forEach((c) => {
          ws1.getCell(c).font = {
            name: FONT_NAME,
            bold: true,
            size: 12,
            color: { argb: COLOR.WHITE },
          };
          ws1.getCell(c).fill = fill(COLOR.HEADER_BLUE);
          ws1.getCell(c).alignment = { vertical: "middle" };
        });

        ws1.getCell("A5").value = "Homepass";
        ws1.getCell("A6").value = "Panjang Kabel";
        ws1.getCell("A7").value = "Total Tiang";
        ws1.getCell("B5").value = materialDesc.homepass;
        // ws1.getCell("B6").value = materialDesc.panjang_kabel;
        // ws1.getCell("B7").value = materialDesc.total_tiang;
        ws1.getCell("C5").value =
          "[Sistem] = Plot berdasarkan Boundary yang di input User";
        ws1.getCell("C6").value = "[Rumus] = Total Panjang Kabel ADSS";
        ws1.getCell("C7").value = "[Rumus] = Total tiang";
        for (let i = 5; i <= 7; i++) {
          const row = ws1.getRow(i);
          row.getCell(1).font = { name: FONT_NAME, bold: true, size: 12 };
          row.getCell(2).font = { name: FONT_NAME, size: 12 };
          row.getCell(2).numFmt = FMT.INT;
          row.getCell(3).font = { name: FONT_NAME, size: 12 };
        }

        ws1.mergeCells("A8:B8");
        ws1.getCell("A8").value = "Summary";
        ws1.getCell("C8").value = "Formula";
        ["A8", "C8"].forEach((c) => {
          ws1.getCell(c).font = {
            name: FONT_NAME,
            bold: true,
            size: 12,
            color: { argb: COLOR.WHITE },
          };
          ws1.getCell(c).fill = fill(COLOR.HEADER_BLUE);
          ws1.getCell(c).alignment = { vertical: "middle" };
        });

        ws1.getCell("A9").value = "Cost Material";
        ws1.getCell("A10").value = "Cost Service Homepass";
        ws1.getCell("A11").value = "Cost Service Home Connect";
        ws1.getCell("A12").value = "Total Cost";
        ws1.getCell("A13").value = "CPA Material";
        ws1.getCell("A14").value = "CPA Service Homepass";
        ws1.getCell("A15").value = "CPA Service Home Connect";
        ws1.getCell("A16").value = "Total CPA";
        ws1.getCell("A17").value = "Material Homepass";
        ws1.getCell("A18").value = "Material Home Connect";
        ws1.getCell("A19").value = "Material JIA";
        ws1.getCell("A20").value = "Material LDA";
        // ws1.getCell("B9").value = materialInfo.cost_material;
        // ws1.getCell("B10").value = materialInfo.cost_service_homepass;
        // ws1.getCell("B11").value = materialInfo.cost_service_connect;
        ws1.getCell("B12").value = { formula: `B9+B10+B11` };
        ws1.getCell("B13").value = { formula: `ROUNDUP(B9/B5,2)` };
        ws1.getCell("B14").value = { formula: `ROUNDUP(B10/B5,2)` };
        ws1.getCell("B15").value = { formula: `ROUNDUP(B11/B5,2)` };
        ws1.getCell("B16").value = { formula: `ROUNDUP(B12/B5,2)` };
        // ws1.getCell("B17").value = materialInfo.material_homepass;
        // ws1.getCell("B18").value = materialInfo.material_home_connect;
        // ws1.getCell("B19").value = materialInfo.material_jia;
        ws1.getCell("B20").value = { formula: `B9-B19` };
        ws1.getCell("C9").value = "[Rumus] = Total Harga Material";
        ws1.getCell("C10").value = "[Rumus] = Total Cost Homepass";
        ws1.getCell("C11").value = "[Rumus] = Total Cost Home Connect";
        ws1.getCell("C12").value = "[Rumus] = Total All Cost";
        ws1.getCell("C13").value = "[Rumus] = Total Cost Material / Homepass";
        ws1.getCell("C14").value =
          "[Rumus] = Total Cost Service Homepass / Homepass";
        ws1.getCell("C15").value =
          "[Rumus] = Total Cost Service Home Connect / Homepass";
        ws1.getCell("C16").value = "[Rumus] = Total All Cost / Homepass";
        ws1.getCell("C17").value =
          "[Rumus] = Cost Feeder Material + Distribution Material + Accessories Support";
        ws1.getCell("C18").value = "[Rumus] = Cost IKR Material";
        ws1.getCell("C19").value = "[Rumus] = Total Cost Material Kabel ADSS";
        ws1.getCell("C20").value =
          "[Rumus] = Total Cost Material - Material JIA";
        for (let i = 9; i <= 20; i++) {
          const row = ws1.getRow(i);
          row.getCell(1).font = { name: FONT_NAME, bold: true, size: 12 };
          row.getCell(2).font = { name: FONT_NAME, size: 12 };
          row.getCell(2).numFmt = FMT.RP;
          row.getCell(3).font = { name: FONT_NAME, size: 12 };
        }
        for (let i = 4; i <= 20; i++) {
          ws1.mergeCells(`C${i}:E${i}`);
        }

        ws1.getCell("A23").value = "Material";
        ws1.getCell("A23").font = { name: FONT_NAME, bold: true, size: 14 };

        const headers = [
          "Code",
          "Description",
          "UoM",
          "Qty",
          "Price",
          "Total",
          "Formula",
        ];
        headers.forEach((h, i) => {
          const cell = ws1.getCell(24, i + 1);
          cell.value = h;
          applyHeader(cell, COLOR.HEADER_BLUE, COLOR.WHITE);
        });
        ws1.getCell("A25").value = "Feeder Material";
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(ws1.getRow(25).getCell(col));
        }

        const startRow = 26;
        const feederMaterialRows =
          materialSummary.groups.find((g) => g.name === "Feeder Material")
            ?.rows || [];
        const feederMaterialTotal =
          materialSummary.groups.find((g) => g.name === "Feeder Material")
            ?.total || 0;
        let rowIndex = startRow;
        const codeRowMapFM = {};
        feederMaterialRows.forEach((item, index) => {
          codeRowMapFM[item.code] = startRow + index;
        });
        const rowFd24 = codeRowMapFM["M-FO-24C"];
        const rowFd48 = codeRowMapFM["M-FO-48C"];
        const rowFd96 = codeRowMapFM["M-FO-96C"];
        const rowFd144 = codeRowMapFM["M-FO-144C"];
        const rowFd288 = codeRowMapFM["M-FO-288C"];
        const rowPole6 = codeRowMapFM["T6"];
        const rowPole7 = codeRowMapFM["T7"];
        const rowPole9 = codeRowMapFM["T9"];
        const rowOTB48 = codeRowMapFM["M-OTB-F-48SLC-1U+"];
        const rowOTB96 = codeRowMapFM["M-OTB-F-96SLC-2U+"];
        const rowOTB144 = codeRowMapFM["M-OTB-F-144SLC-4U+"];
        const rowOTB288 = codeRowMapFM["M-OTB-F-288SLC-6U+"];
        const rowJC24 = codeRowMapFM["M-CL-F-24C+"];
        const rowJC48 = codeRowMapFM["M-CL-F-48C+"];
        const rowJC96 = codeRowMapFM["M-CL-F-96C+"];
        const rowJC144 = codeRowMapFM["M-CL-F-144C+"];
        const rowJC288 = codeRowMapFM["M-CL-F-288C+"];
        feederMaterialRows.forEach((item) => {
          let qtyValue = item.qty;
          const jcStart = codeRowMapFM["M-CL-F-24C+"];
          const jcEnd = codeRowMapFM["M-CL-F-288C+"];

          if (item.code === "M-SC-F-25/50") {
            qtyValue = {
              formula: `ROUNDUP(D${rowFd24}/40*2,0)`,
            };
          }
          if (item.code === "M-SC-F-50/70") {
            qtyValue = {
              formula: `ROUNDUP((D${rowFd48}+D${rowFd96})/40*2,0)`,
            };
          }
          if (item.code === "M-SC-F-70/90") {
            qtyValue = {
              formula: `ROUNDUP((D${rowFd144}+D${rowFd288})/40*2,0)`,
            };
          }
          if (item.code === "M-XF-F-80X80") {
            qtyValue = {
              formula: `${totalCoil}+SUM(D${jcStart}:D${jcEnd})`,
            };
          }

          const row = ws1.getRow(rowIndex);
          row.values = [
            item.code,
            item.description,
            item.uom,
            qtyValue,
            item.price,
            { formula: `D${rowIndex}*E${rowIndex}` },
            item.formula,
          ];

          row.getCell(4).numFmt = FMT.INT;
          row.getCell(5).numFmt = FMT.RP;
          row.getCell(6).numFmt = FMT.RP;

          rowIndex++;
        });
        const rowTotalM1 = rowIndex;
        ws1.getCell(`E${rowIndex}`).value = "Subtotal";
        ws1.getCell(`F${rowIndex}`).value = {
          formula: `SUM(F${startRow}:F${rowIndex - 1})`,
        };
        ws1.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(ws1.getRow(rowIndex).getCell(col));
        }
        ws1.getCell(`A${rowIndex}`).value = "Distribution Material";
        rowIndex++;

        const distMaterialRows =
          materialSummary.groups.find((g) => g.name === "Distribution Material")
            ?.rows || [];
        const distMaterialTotal =
          materialSummary.groups.find((g) => g.name === "Distribution Material")
            ?.total || 0;
        distMaterialRows.forEach((item, index) => {
          codeRowMapFM[item.code] = rowIndex + index;
        });
        const startRowDM = rowIndex;
        const rowP50 = codeRowMapFM["M-PR-D-50M"];
        const rowP100 = codeRowMapFM["M-PR-D-100M"];
        const rowP150 = codeRowMapFM["M-PR-D-150M"];
        const rowOdc = codeRowMapFM["M-ODC-D-8SCUPC+"];
        const rowOdp = codeRowMapFM["M-ODP-D-8SCUPC+"];
        const rowClampS = codeRowMapFM["M-CL-D-DW"];
        const rowClampR = codeRowMapFM["M-PSTR-D"];
        distMaterialRows.forEach((item) => {
          let qtyValue = item.qty;
          const startPole = codeRowMapFM["T6"];
          const endPole = codeRowMapFM["T9"];

          if (
            item.code === "M-PC-D-SMSCSC/U-SX3MOUT" ||
            item.code === "M-CL-F-24C+(Mini)"
          ) {
            qtyValue = {
              formula: `D${rowOdc}`,
            };
          }
          if (item.code === "M-CL-D-DW") {
            qtyValue = {
              formula: `(D${rowP50}*2)+(D${rowP100}*4)+(D${rowP150}*6)`,
            };
          }
          if (item.code === "M-XF-D-40X40") {
            qtyValue = {
              formula: `D${rowOdc}+D${rowOdp}`,
            };
          }
          if (item.code === "M-PSTR-D") {
            qtyValue = {
              formula: `SUM(D${startPole}:D${endPole})*2`,
            };
          }

          const row = ws1.getRow(rowIndex);
          row.values = [
            item.code,
            item.description,
            item.uom,
            qtyValue,
            item.price,
            { formula: `D${rowIndex}*E${rowIndex}` },
            item.formula,
          ];

          row.getCell(4).numFmt = FMT.INT;
          row.getCell(5).numFmt = FMT.RP;
          row.getCell(6).numFmt = FMT.RP;

          rowIndex++;
        });
        const rowTotalM2 = rowIndex;
        ws1.getCell(`E${rowIndex}`).value = "Subtotal";
        ws1.getCell(`F${rowIndex}`).value = {
          formula: `SUM(F${startRowDM}:F${rowIndex - 1})`,
        };
        ws1.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(ws1.getRow(rowIndex).getCell(col));
        }
        ws1.getCell(`A${rowIndex}`).value = "Accessories Support";
        rowIndex++;

        const startRowACM = rowIndex;
        const accMaterialRows =
          materialSummary.groups.find((g) => g.name === "Accessories Support")
            ?.rows || [];
        const accMaterialTotal =
          materialSummary.groups.find((g) => g.name === "Accessories Support")
            ?.total || 0;
        accMaterialRows.forEach((item, index) => {
          codeRowMapFM[item.code] = rowIndex + index;
        });
        const rowX80 = codeRowMapFM["M-XF-F-80X80"];
        const rowX40 = codeRowMapFM["M-XF-D-40X40"];
        const rowSC1 = codeRowMapFM["M-SC-F-25/50"];
        const rowSC2 = codeRowMapFM["M-SC-F-50/70"];
        const rowSC3 = codeRowMapFM["M-SC-F-70/90"];
        const rowSB = codeRowMapFM["M-SB-F-50M"];
        accMaterialRows.forEach((item) => {
          let qtyValue = item.qty;
          if (item.code === "M-SB-F-50M") {
            qtyValue = {
              formula: `ROUNDUP(((2*(D${rowX80}+D${rowX40}))+(D${rowSC1}+D${rowSC2}+D${rowSC3}))*50/100/50,0)`,
            };
          }
          if (item.code === "M-SB-F-XXX") {
            qtyValue = {
              formula: `=D${rowSB}*100`,
            };
          }
          const row = ws1.getRow(rowIndex);
          row.values = [
            item.code,
            item.description,
            item.uom,
            qtyValue,
            item.price,
            { formula: `D${rowIndex}*E${rowIndex}` },
            item.formula,
          ];

          row.getCell(4).numFmt = FMT.INT;
          row.getCell(5).numFmt = FMT.RP;
          row.getCell(6).numFmt = FMT.RP;
          rowIndex++;
        });
        const rowTotalM3 = rowIndex;
        ws1.getCell(`E${rowIndex}`).value = "Subtotal";
        ws1.getCell(`F${rowIndex}`).value = {
          formula: `SUM(F${startRowACM}:F${rowIndex - 1})`,
        };
        ws1.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(ws1.getRow(rowIndex).getCell(col));
        }
        ws1.getCell(`A${rowIndex}`).value = " IKR Material";
        rowIndex++;

        const startRowIKRM = rowIndex;
        const ikrMaterialRows =
          materialSummary.groups.find((g) => g.name === "IKR Material")?.rows ||
          [];
        const ikrMaterialTotal =
          materialSummary.groups.find((g) => g.name === "IKR Material")
            ?.total || 0;
        ikrMaterialRows.forEach((item) => {
          let qtyValue = item.qty;
          const rowSB = codeRowMapFM["M-SB-F-50M"];

          if (item.code === "M-CL-IKR-DW") {
            qtyValue = {
              formula: `B5*2`,
            };
          }
          if (item.code === "M-CH-IKR-DW") {
            qtyValue = {
              formula: `B5`,
            };
          }
          const row = ws1.getRow(rowIndex);
          row.values = [
            item.code,
            item.description,
            item.uom,
            qtyValue,
            item.price,
            { formula: `D${rowIndex}*E${rowIndex}` },
            item.formula,
          ];

          row.getCell(4).numFmt = FMT.INT;
          row.getCell(5).numFmt = FMT.RP;
          row.getCell(6).numFmt = FMT.RP;
          rowIndex++;
        });
        const rowTotalM4 = rowIndex;
        ws1.getCell(`E${rowIndex}`).value = "Subtotal";
        ws1.getCell(`F${rowIndex}`).value = {
          formula: `SUM(F${startRowIKRM}:F${rowIndex - 1})`,
        };
        ws1.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(ws1.getRow(rowIndex).getCell(col));
        }
        rowIndex++;
        const rowTotalMaterial = rowIndex;
        ws1.getCell(`E${rowIndex}`).value = "Grand Total";
        // ws1.getCell(`F${rowIndex}`).value = materialSummary.group_total;
        ws1.getCell(`F${rowIndex}`).value = {
          formula: `F${rowTotalM1}+F${rowTotalM2}+F${rowTotalM3}+F${rowTotalM4}`,
        };
        ws1.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(ws1.getRow(rowIndex).getCell(col));
        }

        // sheet 2
        ws2.getCell("A3").value =
          "RAB - Fiber To The Home Starlite FTTH Reguler";
        ws2.getCell("A3").font = { bold: true, size: 14 };

        ws2.mergeCells("A4:B4");
        ws2.getCell("A4").value = "Description";
        ws2.getCell("C4").value = "Formula";
        ["A4", "C4"].forEach((c) => {
          ws2.getCell(c).font = {
            name: FONT_NAME,
            bold: true,
            size: 12,
            color: { argb: COLOR.WHITE },
          };
          ws2.getCell(c).fill = fill(COLOR.HEADER_BLUE);
          ws2.getCell(c).alignment = { vertical: "middle" };
        });

        ws2.getCell("A5").value = "Homepass";
        ws2.getCell("A6").value = "Service Homepass";
        ws2.getCell("A7").value = "CPA Homepass";
        ws2.getCell("A8").value = "Site";
        ws2.getCell("A9").value = "Timeline";
        ws2.getCell("A10").value = "Term of Payment";
        ws2.getCell("B5").value = { formula: `Material!B5` };
        // ws2.getCell("B6").value = homepassInfo.service_homepass;
        ws2.getCell("B7").value = { formula: `ROUNDUP(B6/B5,2)` };
        ws2.getCell("B8").value = homepassInfo.site;
        ws2.getCell("B9").value = homepassInfo.timeline;
        ws2.getCell("B10").value = homepassInfo.term_of_payment;
        ws2.getCell("C5").value = "[Rumus] Berdasarkan Homepass";
        ws2.getCell("C6").value = "[Rumus] Berdasarkan Cost Service Homepass";
        ws2.getCell("C7").value =
          "[Rumus] = Total Cost Service Homepass / Homepass";
        ws2.getCell("C8").value = "[Manual] = Di isi Manual Oleh User";
        ws2.getCell("C9").value = "[Manual] = Di isi Manual Oleh User";
        ws2.getCell("C10").value = "[Manual] = Di isi Manual Oleh User";

        for (let i = 5; i <= 7; i++) {
          const row = ws2.getRow(i);
          row.getCell(1).font = { name: FONT_NAME, bold: true, size: 12 };
          row.getCell(2).font = { name: FONT_NAME, size: 12 };
          row.getCell(2).numFmt = FMT.RP;
          row.getCell(3).font = { name: FONT_NAME, size: 12 };
        }
        for (let i = 8; i <= 10; i++) {
          const row = ws2.getRow(i);
          row.getCell(1).font = { name: FONT_NAME, bold: true, size: 12 };
          row.getCell(2).font = { name: FONT_NAME, size: 12 };
          row.getCell(3).font = { name: FONT_NAME, size: 12 };
        }
        for (let i = 4; i <= 10; i++) {
          ws2.mergeCells(`C${i}:E${i}`);
        }

        headers.forEach((h, i) => {
          const cell = ws2.getCell(12, i + 1);
          cell.value = h;
          applyHeader(cell, COLOR.HEADER_GREEN, COLOR.WHITE);
        });
        ws2.getCell("A13").value = " Feeder Services";
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(
            ws2.getRow(13).getCell(col),
            COLOR.SUBTOTAL_LIGHT2
          );
        }

        const startRowS2 = 14;
        const feederSVRows =
          servicesSummary.groups.find((g) => g.name === "Feeder Services")
            ?.rows || [];
        const feederSVTotal =
          servicesSummary.groups.find((g) => g.name === "Feeder Services")
            ?.total || 0;
        rowIndex = startRowS2;
        feederSVRows.forEach((item) => {
          let qtyValue = item.qty;
          if (item.code === "S-PC-F-24C") {
            qtyValue = {
              formula: `Material!D${rowFd24}`,
            };
          }
          if (item.code === "S-PC-F-48C") {
            qtyValue = {
              formula: `Material!D${rowFd48}`,
            };
          }
          if (item.code === "S-PC-F-96C") {
            qtyValue = {
              formula: `Material!D${rowFd96}`,
            };
          }
          if (item.code === "S-PC-F-144C") {
            qtyValue = {
              formula: `Material!D${rowFd144}`,
            };
          }
          if (item.code === "S-PC-F-288C") {
            qtyValue = {
              formula: `Material!D${rowFd288}`,
            };
          }
          if (item.code === "S-DP-F-6M") {
            qtyValue = {
              formula: `Material!D${rowPole6}`,
            };
          }
          if (item.code === "S-DP-F-7M") {
            qtyValue = {
              formula: `Material!D${rowPole7}`,
            };
          }
          if (item.code === "S-DP-F-9M") {
            qtyValue = {
              formula: `Material!D${rowPole9}`,
            };
          }
          if (item.code === "S-XF-F") {
            qtyValue = {
              formula: `Material!D${rowX80}`,
            };
          }
          if (item.code === "S-ACC-F") {
            qtyValue = {
              formula: `Material!D${rowSC1}+Material!D${rowSC2}+Material!D${rowSC3}`,
            };
          }
          if (item.code === "S-IOTB-F-48C+") {
            qtyValue = {
              formula: `Material!D${rowOTB48}+Material!D${rowOTB96}+Material!D${rowOTB144}+Material!D${rowOTB288}`,
            };
          }
          if (item.code === "S-SOTB-F-48C+") {
            qtyValue = {
              formula: `(Material!D${rowOTB48}*48)+(Material!D${rowOTB96}*96)+(Material!D${rowOTB144}*144)+(Material!D${rowOTB288}*288)`,
            };
          }
          if (item.code === "S-ICL-F-48C+") {
            qtyValue = {
              formula: `(Material!D${rowJC24}+Material!D${rowJC48}+Material!D${rowJC96}+Material!D${rowJC144}+Material!D${rowJC288})`,
            };
          }
          if (item.code === "S-SCL-F-48+") {
            qtyValue = {
              formula: `(Material!D${rowJC24}*12)+(Material!D${rowJC48}*24)+(Material!D${rowJC96}*48)+(Material!D${rowJC144}*72)+(Material!D${rowJC288}*144)`,
            };
          }

          const row = ws2.getRow(rowIndex);
          row.values = [
            item.code,
            item.description,
            item.uom,
            qtyValue,
            item.price,
            { formula: `D${rowIndex}*E${rowIndex}` },
            item.formula,
          ];

          row.getCell(4).numFmt = FMT.INT;
          row.getCell(5).numFmt = FMT.RP;
          row.getCell(6).numFmt = FMT.RP;
          rowIndex++;
        });
        const rowTotalS1 = rowIndex;
        ws2.getCell(`E${rowIndex}`).value = "Subtotal";
        ws2.getCell(`F${rowIndex}`).value = {
          formula: `SUM(F${startRowS2}:F${rowIndex - 1})`,
        };
        ws2.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(
            ws2.getRow(rowIndex).getCell(col),
            COLOR.SUBTOTAL_LIGHT2
          );
        }
        ws2.getCell(`A${rowIndex}`).value = "Distribution Services";
        rowIndex++;

        const distSVRows =
          servicesSummary.groups.find((g) => g.name === "Distribution Services")
            ?.rows || [];
        const distSVTotal =
          servicesSummary.groups.find((g) => g.name === "Distribution Services")
            ?.total || 0;
        const startRowDMS2 = rowIndex;
        distSVRows.forEach((item) => {
          let qtyValue = item.qty;
          if (item.code === "S-PC-D-1/2C") {
            qtyValue = {
              formula: `(Material!D${rowP50}*50)+(Material!D${rowP100}*100)+(Material!D${rowP150}*150)`,
            };
          }
          if (item.code === "S-XF-D") {
            qtyValue = {
              formula: `Material!D${rowX40}`,
            };
          }
          if (item.code === "S-ACC-D") {
            qtyValue = {
              formula: `Material!D${rowClampS}+Material!D${rowClampR}`,
            };
          }
          if (item.code === "S-IODC-D-8PT+") {
            qtyValue = {
              formula: `Material!D${rowOdc}`,
            };
          }
          if (item.code === "S-IODP-D") {
            qtyValue = {
              formula: `Material!D${rowOdp}`,
            };
          }
          const row = ws2.getRow(rowIndex);
          row.values = [
            item.code,
            item.description,
            item.uom,
            qtyValue,
            item.price,
            { formula: `D${rowIndex}*E${rowIndex}` },
            item.formula,
          ];

          row.getCell(4).numFmt = FMT.INT;
          row.getCell(5).numFmt = FMT.RP;
          row.getCell(6).numFmt = FMT.RP;
          rowIndex++;
        });
        const rowTotalS2 = rowIndex;
        ws2.getCell(`E${rowIndex}`).value = "Subtotal";
        ws2.getCell(`F${rowIndex}`).value = {
          formula: `SUM(F${startRowDMS2}:F${rowIndex - 1})`,
        };
        ws2.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(
            ws2.getRow(rowIndex).getCell(col),
            COLOR.SUBTOTAL_LIGHT2
          );
        }
        ws2.getCell(`A${rowIndex}`).value = "Add On Services";
        rowIndex++;

        const aosRows =
          servicesSummary.groups.find((g) => g.name === "Add On Services")
            ?.rows || [];
        const aosTotal =
          servicesSummary.groups.find((g) => g.name === "Add On Services")
            ?.total || 0;
        const startRowAOS = rowIndex;
        aosRows.forEach((item) => {
          let qtyValue = item.qty;
          if (item.code === "S-SND-AO") {
            qtyValue = {
              formula: `Material!B5`,
            };
          }
          if (item.code === "S-SPMT-AO") {
            qtyValue = {
              formula: `=Material!B5`,
            };
          }
          const row = ws2.getRow(rowIndex);
          row.values = [
            item.code,
            item.description,
            item.uom,
            qtyValue,
            item.price,
            { formula: `D${rowIndex}*E${rowIndex}` },
            item.formula,
          ];

          row.getCell(4).numFmt = FMT.INT;
          row.getCell(5).numFmt = FMT.RP;
          row.getCell(6).numFmt = FMT.RP;
          rowIndex++;
        });
        const rowTotalS3 = rowIndex;
        ws2.getCell(`E${rowIndex}`).value = "Subtotal";
        ws2.getCell(`F${rowIndex}`).value = {
          formula: `SUM(F${startRowAOS}:F${rowIndex - 1})`,
        };
        ws2.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(
            ws2.getRow(rowIndex).getCell(col),
            COLOR.SUBTOTAL_LIGHT2
          );
        }
        ws2.getCell(`A${rowIndex}`).value = "Add On Material";
        rowIndex++;

        const aomRows =
          servicesSummary.groups.find((g) => g.name === "Add On Material")
            ?.rows || [];
        const aomTotal =
          servicesSummary.groups.find((g) => g.name === "Add On Material")
            ?.total || 0;
        const startRowAOM = rowIndex;
        aomRows.forEach((item) => {
          let qtyValue = item.qty;
          if (item.code === "S-PC-IKR") {
            qtyValue = {
              formula: `Material!B5`,
            };
          }
          const row = ws2.getRow(rowIndex);
          row.values = [
            item.code,
            item.description,
            item.uom,
            qtyValue,
            item.price,
            { formula: `D${rowIndex}*E${rowIndex}` },
            item.formula,
          ];

          row.getCell(4).numFmt = FMT.INT;
          row.getCell(5).numFmt = FMT.RP;
          row.getCell(6).numFmt = FMT.RP;
          rowIndex++;
        });
        const rowTotalS4 = rowIndex;
        ws2.getCell(`E${rowIndex}`).value = "Subtotal";
        ws2.getCell(`F${rowIndex}`).value = {
          formula: `SUM(F${startRowAOM}:F${rowIndex - 1})`,
        };
        ws2.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(
            ws2.getRow(rowIndex).getCell(col),
            COLOR.SUBTOTAL_LIGHT2
          );
        }

        rowIndex++;
        const rowTotalSH = rowIndex;
        ws2.getCell(`E${rowIndex}`).value = "Grand Total";
        // ws2.getCell(`F${rowIndex}`).value = servicesSummary.group_total;
        ws2.getCell(`F${rowIndex}`).value = {
          formula: `F${rowTotalS1}+F${rowTotalS2}+F${rowTotalS3}+F${rowTotalS4}`,
        };
        ws2.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(
            ws2.getRow(rowIndex).getCell(col),
            COLOR.SUBTOTAL_LIGHT2
          );
        }

        // sheet 3
        ws3.getCell("A3").value =
          "RAB - Fiber To The Home Starlite FTTH Reguler";
        ws3.getCell("A3").font = { bold: true, size: 14 };

        ws3.mergeCells("A4:B4");
        ws3.getCell("A4").value = "Description";
        ws3.getCell("C4").value = "Formula";
        ["A4", "C4"].forEach((c) => {
          ws3.getCell(c).font = {
            name: FONT_NAME,
            bold: true,
            size: 12,
            color: { argb: COLOR.WHITE },
          };
          ws3.getCell(c).fill = fill(COLOR.HEADER_BLUE);
          ws3.getCell(c).alignment = { vertical: "middle" };
        });

        ws3.getCell("A5").value = "Homepass";
        ws3.getCell("A6").value = "Service Homepass";
        ws3.getCell("A7").value = "CPA Homepass";
        ws3.getCell("A8").value = "Site";
        ws3.getCell("A9").value = "Timeline";
        ws3.getCell("A10").value = "Term of Payment";
        ws3.getCell("B5").value = ikrInfo.home_connect;
        // ws3.getCell("B6").value = ikrInfo.service_home_connect;
        ws3.getCell("B7").value = { formula: `B6/B5` };
        ws3.getCell("B8").value = ikrInfo.site;
        ws3.getCell("B9").value = ikrInfo.timeline;
        ws3.getCell("B10").value = ikrInfo.term_of_payment;
        ws3.getCell("C5").value = "[Rumus] Berdasarkan Homepass";
        ws3.getCell("C6").value = "[Rumus] = Total Cost Home Connect";
        ws3.getCell("C7").value =
          "[Rumus] = Total Cost Service Home Connect / Homepass";
        ws3.getCell("C8").value = "[Manual] = Di isi Manual Oleh User";
        ws3.getCell("C9").value = "[Manual] = Di isi Manual Oleh User";
        ws3.getCell("C10").value = "[Manual] = Di isi Manual Oleh User";

        for (let i = 5; i <= 7; i++) {
          const row = ws3.getRow(i);
          row.getCell(1).font = { name: FONT_NAME, bold: true, size: 12 };
          row.getCell(2).font = { name: FONT_NAME, size: 12 };
          row.getCell(2).numFmt = FMT.RP;
          row.getCell(3).font = { name: FONT_NAME, size: 12 };
        }
        for (let i = 8; i <= 10; i++) {
          const row = ws3.getRow(i);
          row.getCell(1).font = { name: FONT_NAME, bold: true, size: 12 };
          row.getCell(2).font = { name: FONT_NAME, size: 12 };
          row.getCell(3).font = { name: FONT_NAME, size: 12 };
        }
        for (let i = 4; i <= 10; i++) {
          ws3.mergeCells(`C${i}:E${i}`);
        }

        headers.forEach((h, i) => {
          const cell = ws3.getCell(12, i + 1);
          cell.value = h;
          applyHeader(cell, COLOR.HEADER_GREEN, COLOR.WHITE);
        });
        ws3.getCell("A13").value = "IKR Services";
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(
            ws3.getRow(13).getCell(col),
            COLOR.SUBTOTAL_LIGHT2
          );
        }

        const startRowS3 = 14;
        const ikrSVRows =
          ikrServicesSummary.groups.find((g) => g.name === "IKR Services")
            ?.rows || [];
        const ikrSVTotal =
          ikrServicesSummary.groups.find((g) => g.name === "IKR Services")
            ?.total || 0;
        rowIndex = startRowS3;
        ikrSVRows.forEach((item) => {
          let qtyValue = item.qty;
          const row = ws3.getRow(rowIndex);
          row.values = [
            item.code,
            item.description,
            item.uom,
            qtyValue,
            item.price,
            { formula: `D${rowIndex}*E${rowIndex}` },
            item.formula,
          ];

          row.getCell(4).numFmt = FMT.INT;
          row.getCell(5).numFmt = FMT.RP;
          row.getCell(6).numFmt = FMT.RP;
          rowIndex++;
        });
        const rowTotalI1 = rowIndex;
        ws3.getCell(`E${rowIndex}`).value = "Subtotal";
        ws3.getCell(`F${rowIndex}`).value = {
          formula: `SUM(F${startRowS3}:F${rowIndex - 1})`,
        };
        ws3.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(
            ws3.getRow(rowIndex).getCell(col),
            COLOR.SUBTOTAL_LIGHT2
          );
        }
        rowIndex++;
        const rowTotalSHC = rowIndex;
        ws3.getCell(`E${rowIndex}`).value = "Grand Total";
        // ws3.getCell(`F${rowIndex}`).value = ikrServicesSummary.group_total;
        ws3.getCell(`F${rowIndex}`).value = {
          formula: `F${rowTotalI1}`,
        };
        ws3.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(
            ws3.getRow(rowIndex).getCell(col),
            COLOR.SUBTOTAL_LIGHT2
          );
        }

        //other summary
        ws1.getCell("B6").value = {
          formula: `D${rowFd24}+D${rowFd48}+D${rowFd96}+D${rowFd144}+D${rowFd288}`,
        };
        ws1.getCell("B7").value = {
          formula: `D${rowPole6}+D${rowPole7}+D${rowPole9}`,
        };
        ws1.getCell("B9").value = { formula: `F${rowTotalMaterial}` };
        ws1.getCell("B10").value = { formula: `Homepass!F${rowTotalSH}` };
        ws1.getCell("B11").value = {
          formula: `'Home Connect'!F${rowTotalSHC}`,
        };
        ws1.getCell("B17").value = {
          formula: `F${rowTotalM1}+F${rowTotalM2}+F${rowTotalM3}`,
        };
        ws1.getCell("B18").value = {
          formula: `F${rowTotalM4}`,
        };
        ws1.getCell("B19").value = {
          formula: `F${rowFd24}+F${rowFd48}+F${rowFd96}+F${rowFd144}+F${rowFd288}`,
        };

        ws2.getCell("B6").value = { formula: `F${rowTotalSH}` };
        ws3.getCell("B6").value = { formula: `F${rowTotalSHC}` };

        res.setHeader(
          "Content-Type",
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        );
        res.setHeader(
          "Content-Disposition",
          `attachment; filename=boq_bom.xlsx`
        );
        await workbook.xlsx.write(res);
        return res.end();
      } else {
        logger.info("json");
        return res.send({
          data: {
            boq: {
              material: {
                ...materialSummary,
                description: materialDesc,
                summary: materialInfo,
              },
              homepass: { ...servicesSummary, summary: homepassInfo },
              homeconnect: { ...ikrServicesSummary, summary: ikrInfo },
            },
            bom: null,
          },
        });
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "boq-bom/ftth/generate-boq-bom",
          reason: "Failed to generate boq bom",
        })
      );
    }
  };
}

function generateFeederSimpleBoqBomHandler({ database, logger }) {
  // Mode feeder-simple: satu-satunya input yang diketahui adalah panjang jalur (meter),
  // semua qty diturunkan dari angka itu.
  const SPAN = { POLE_M: 40, COIL_M: 300, JC_M: 3800 };
  const SC_PER_POLE = 2;

  // diurutkan dari core terkecil, "ambil core terkecil" = elemen pertama
  const FEEDER_CATALOG = [
    {
      core: 24,
      cable: "M-FO-24C",
      closure: "M-CL-F-24C+",
      sc: "M-SC-F-25/50",
      cable_sv: "S-PC-F-24C",
      jc_core: 12,
    },
    {
      core: 48,
      cable: "M-FO-48C",
      closure: "M-CL-F-48C+",
      sc: "M-SC-F-50/70",
      cable_sv: "S-PC-F-48C",
      jc_core: 24,
    },
    {
      core: 96,
      cable: "M-FO-96C",
      closure: "M-CL-F-96C+",
      sc: "M-SC-F-50/70",
      cable_sv: "S-PC-F-96C",
      jc_core: 48,
    },
    {
      core: 144,
      cable: "M-FO-144C",
      closure: "M-CL-F-144C+",
      sc: "M-SC-F-70/90",
      cable_sv: "S-PC-F-144C",
      jc_core: 72,
    },
    {
      core: 288,
      cable: "M-FO-288C",
      closure: "M-CL-F-288C+",
      sc: "M-SC-F-70/90",
      cable_sv: "S-PC-F-288C",
      jc_core: 144,
    },
  ];
  const POLE_CATALOG = [
    { code: "T6", pole_sv: "S-DP-F-6M" },
    { code: "T7", pole_sv: "S-DP-F-7M" },
    { code: "T9", pole_sv: "S-DP-F-9M" },
  ];

  const makeRow = (priceList, code, qty, formula) => {
    const price = Number(priceList[code]?.price_rp ?? 0);
    return {
      code,
      uom: priceList[code]?.uom ?? null,
      qty,
      price,
      total: qty * price,
      description: priceList[code]?.description ?? null,
      formula: formula ?? priceList[code]?.formula ?? null,
    };
  };
  const calcSubtotal = (rows) =>
    rows.reduce((sum, r) => sum + Number(r.total || 0), 0);
  const buildGroup = (groupName, name, rows) => {
    const total = calcSubtotal(rows);
    return {
      group_name: groupName,
      group_total: total,
      groups: [{ name, rows, total }],
    };
  };

  return async (req, res, next) => {
    const { accountability } = req;
    if (!accountability.user) {
      return next(new ForbiddenError());
    }

    const {
      route_length_m,
      feeder_code,
      pole_code = "T6",
      download,
      manual_input = {},
    } = req.body;

    const routeLength = Number(route_length_m);
    if (!Number.isFinite(routeLength) || routeLength <= 0) {
      return next(
        new InvalidPayloadError({
          reason: `route_length_m required and must be a number greater than 0`,
        })
      );
    }
    if (download && download != "excel") {
      return next(
        new InvalidPayloadError({
          reason: `download type not allowed`,
        })
      );
    }

    const feeder = feeder_code
      ? FEEDER_CATALOG.find((f) => f.cable === feeder_code)
      : FEEDER_CATALOG[0]; // core terkecil
    if (!feeder) {
      return next(
        new InvalidPayloadError({
          reason: `feeder_code must be one of ${FEEDER_CATALOG.map(
            (f) => f.cable
          ).join(", ")}`,
        })
      );
    }
    const pole = POLE_CATALOG.find((p) => p.code === pole_code);
    if (!pole) {
      return next(
        new InvalidPayloadError({
          reason: `pole_code must be one of ${POLE_CATALOG.map(
            (p) => p.code
          ).join(", ")}`,
        })
      );
    }

    const { description: manualDesc = {} } = manual_input;

    try {
      const priceData = await database("boq_bom_price_default").select(
        "code",
        "description",
        "uom",
        "price_rp",
        "formula"
      );
      const priceList = priceData.reduce((acc, item) => {
        acc[item.code] = item;
        return acc;
      }, {});

      // ================= QTY =================
      const cableQty = Math.ceil(routeLength);
      const poleQty = Math.ceil(routeLength / SPAN.POLE_M);
      const coilQty = Math.ceil(routeLength / SPAN.COIL_M);
      const jcQty = Math.ceil(routeLength / SPAN.JC_M);
      const scQty = poleQty * SC_PER_POLE;
      const xFrame80Qty = coilQty + jcQty;
      const sbQty = Math.ceil(((xFrame80Qty * 2 + scQty) * 50) / 100 / 50);
      const sbrQty = sbQty * 100;

      // ================= MATERIAL =================
      const materialRows = [
        makeRow(
          priceList,
          feeder.cable,
          cableQty,
          "[Rumus] = Panjang Jalur, core terkecil pada katalog feeder"
        ),
        makeRow(
          priceList,
          pole.code,
          poleQty,
          `[Rumus] = Panjang Jalur / ${SPAN.POLE_M} m`
        ),
        makeRow(
          priceList,
          feeder.sc,
          scQty,
          `[Rumus] = Total Tiang x ${SC_PER_POLE}`
        ),
        makeRow(
          priceList,
          feeder.closure,
          jcQty,
          `[Rumus] = Panjang Jalur / ${SPAN.JC_M} m`
        ),
        makeRow(
          priceList,
          "M-XF-F-80X80",
          xFrame80Qty,
          "[Rumus] = Total Coil + Total JC"
        ),
        makeRow(
          priceList,
          "M-SB-F-50M",
          sbQty,
          "[Rumus] = ((Total X-Frame x 2) + Total SC) x 50 / 100 / 50"
        ),
        makeRow(priceList, "M-SB-F-XXX", sbrQty, "[Rumus] = Total SB x 100"),
      ];

      // ================= SERVICES =================
      const jcCoreQty = jcQty * feeder.jc_core;
      const servicesRows = [
        makeRow(
          priceList,
          feeder.cable_sv,
          cableQty,
          "[Rumus] = Panjang Kabel Feeder"
        ),
        makeRow(priceList, pole.pole_sv, poleQty, "[Rumus] = Total Tiang"),
        makeRow(priceList, "S-XF-F", xFrame80Qty, "[Rumus] = Total X-Frame"),
        makeRow(priceList, "S-ACC-F", scQty, "[Rumus] = Total SC"),
        makeRow(priceList, "S-ICL-F-48C+", jcQty, "[Rumus] = Total JC"),
        makeRow(
          priceList,
          "S-SCL-F-48+",
          jcCoreQty,
          `[Rumus] = Total JC x ${feeder.jc_core} core`
        ),
      ];

      const materialSummary = buildGroup(
        "Material",
        "Feeder Material",
        materialRows
      );
      const servicesSummary = buildGroup(
        "Services",
        "Feeder Services",
        servicesRows
      );

      const mCost = materialSummary.group_total;
      const sCost = servicesSummary.group_total;
      const totalCost = mCost + sCost;
      const mJIACost = materialRows[0].total; // kabel feeder

      const materialDesc = {
        panjang_jalur_m: routeLength,
        panjang_kabel_m: cableQty,
        total_tiang: poleQty,
        total_coil: coilQty,
        total_jc: jcQty,
        feeder_core: feeder.core,
      };
      const materialInfo = {
        cost_material: mCost,
        cost_services: sCost,
        total_cost: totalCost,
        material_jia: mJIACost,
        material_lda: mCost - mJIACost,
        cost_per_meter: Number((totalCost / routeLength).toFixed(2)),
      };
      const servicesInfo = {
        panjang_jalur_m: routeLength,
        service_feeder: sCost,
        cost_per_meter: Number((sCost / routeLength).toFixed(2)),
        site: manualDesc?.site ?? null,
        timeline: manualDesc?.timeline ?? null,
        term_of_payment: manualDesc?.term_of_payment ?? null,
      };

      if (!download) {
        logger.info("json");
        return res.send({
          data: {
            boq: {
              material: {
                ...materialSummary,
                description: materialDesc,
                summary: materialInfo,
              },
              services: { ...servicesSummary, summary: servicesInfo },
            },
            bom: null,
          },
        });
      }

      logger.info("download");
      const FONT_NAME = "Aptos Narrow";
      const COLOR = {
        HEADER_BLUE: "FF2F5496",
        HEADER_GREEN: "38761D",
        SUBTOTAL_LIGHT: "FFC9DAF8",
        SUBTOTAL_LIGHT2: "FFB6D7A8",
        WHITE: "FFFFFFFF",
      };
      const FMT = {
        INT: '_(* #,##0_);_(* (#,##0);_(* "-"_);_(@_)',
        INT2: '_(* #,##0_);_(* (#,##0);_(* "-"??_);_(@_)',
        RP: '_-[$Rp-3809]* #,##0_-;-[$Rp-3809]* #,##0_-;_-[$Rp-3809]* "-"_-;_-@_-',
      };
      const thinBorder = {
        top: { style: "thin", color: { argb: "FFBFBFBF" } },
        left: { style: "thin", color: { argb: "FFBFBFBF" } },
        bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
        right: { style: "thin", color: { argb: "FFBFBFBF" } },
      };
      function fill(argb) {
        return { type: "pattern", pattern: "solid", fgColor: { argb } };
      }
      function applyHeader(cell, bgColor, fontColor = COLOR.WHITE) {
        cell.font = {
          name: FONT_NAME,
          bold: true,
          size: 12,
          color: { argb: fontColor },
        };
        cell.fill = fill(bgColor);
        cell.alignment = {
          vertical: "middle",
          horizontal: "center",
          wrapText: true,
        };
        cell.border = thinBorder;
      }
      function applySectionHeader(cell, bg) {
        cell.font = { name: FONT_NAME, bold: true, size: 11 };
        cell.fill = fill(bg);
        cell.alignment = { vertical: "middle" };
        cell.border = thinBorder;
      }
      function applyBlockHeader(ws, labelCell, formulaCell) {
        [labelCell, formulaCell].forEach((c) => {
          ws.getCell(c).font = {
            name: FONT_NAME,
            bold: true,
            size: 12,
            color: { argb: COLOR.WHITE },
          };
          ws.getCell(c).fill = fill(COLOR.HEADER_BLUE);
          ws.getCell(c).alignment = { vertical: "middle" };
        });
      }
      // tulis baris tabel BOQ, qty boleh berupa formula Excel supaya workbook tetap hidup
      function writeItemRow(ws, rowIndex, item, qtyValue) {
        const row = ws.getRow(rowIndex);
        row.values = [
          item.code,
          item.description,
          item.uom,
          qtyValue,
          item.price,
          { formula: `D${rowIndex}*E${rowIndex}` },
          item.formula,
        ];
        row.getCell(4).numFmt = FMT.INT;
        row.getCell(5).numFmt = FMT.RP;
        row.getCell(6).numFmt = FMT.RP;
      }
      function writeTotalRow(ws, rowIndex, label, formula, bg) {
        ws.getCell(`E${rowIndex}`).value = label;
        ws.getCell(`F${rowIndex}`).value = { formula };
        ws.getCell(`F${rowIndex}`).numFmt = FMT.RP;
        for (let col = 1; col <= 7; col++) {
          applySectionHeader(ws.getRow(rowIndex).getCell(col), bg);
        }
      }

      const workbook = new ExcelJS.Workbook();
      const ws1 = workbook.addWorksheet("Material");
      const ws2 = workbook.addWorksheet("Services");
      const COLUMN_WIDTH = [
        { width: 31 },
        { width: 35 },
        { width: 19 },
        { width: 19 },
        { width: 18 },
        { width: 26 },
        { width: 100 },
      ];
      ws1.columns = COLUMN_WIDTH;
      ws2.columns = COLUMN_WIDTH;

      const headers = [
        "Code",
        "Description",
        "UoM",
        "Qty",
        "Price",
        "Total",
        "Formula",
      ];

      // ---------- Sheet Material ----------
      ws1.getCell("A3").value = "Forecast FTTH - Feeder Simple";
      ws1.getCell("A3").font = { name: FONT_NAME, bold: true, size: 18 };

      ws1.mergeCells("A4:B4");
      ws1.getCell("A4").value = "Description";
      ws1.getCell("C4").value = "Formula";
      applyBlockHeader(ws1, "A4", "C4");

      ws1.getCell("A5").value = "Panjang Jalur (m)";
      ws1.getCell("A6").value = "Panjang Kabel Feeder (m)";
      ws1.getCell("A7").value = "Total Tiang";
      ws1.getCell("A8").value = "Total Coil";
      ws1.getCell("A9").value = "Total JC";
      ws1.getCell("A10").value = "Core Kabel Feeder";
      ws1.getCell("B5").value = routeLength;
      ws1.getCell("B6").value = { formula: `ROUNDUP(B5,0)` };
      ws1.getCell("B7").value = { formula: `ROUNDUP(B5/${SPAN.POLE_M},0)` };
      ws1.getCell("B8").value = { formula: `ROUNDUP(B5/${SPAN.COIL_M},0)` };
      ws1.getCell("B9").value = { formula: `ROUNDUP(B5/${SPAN.JC_M},0)` };
      ws1.getCell("B10").value = feeder.core;
      ws1.getCell("C5").value = "[Input] = Panjang jalur yang di input User";
      ws1.getCell("C6").value = "[Rumus] = Panjang Jalur";
      ws1.getCell("C7").value = `[Rumus] = Panjang Jalur / ${SPAN.POLE_M} m`;
      ws1.getCell("C8").value = `[Rumus] = Panjang Jalur / ${SPAN.COIL_M} m`;
      ws1.getCell("C9").value = `[Rumus] = Panjang Jalur / ${SPAN.JC_M} m`;
      ws1.getCell("C10").value = "[Rumus] = Core terkecil pada katalog feeder";
      for (let i = 5; i <= 10; i++) {
        const row = ws1.getRow(i);
        row.getCell(1).font = { name: FONT_NAME, bold: true, size: 12 };
        row.getCell(2).font = { name: FONT_NAME, size: 12 };
        row.getCell(2).numFmt = FMT.INT2;
        row.getCell(3).font = { name: FONT_NAME, size: 12 };
      }

      ws1.mergeCells("A12:B12");
      ws1.getCell("A12").value = "Summary";
      ws1.getCell("C12").value = "Formula";
      applyBlockHeader(ws1, "A12", "C12");

      ws1.getCell("A13").value = "Cost Material";
      ws1.getCell("A14").value = "Cost Services";
      ws1.getCell("A15").value = "Total Cost";
      ws1.getCell("A16").value = "Material JIA";
      ws1.getCell("A17").value = "Material LDA";
      ws1.getCell("A18").value = "Cost per Meter";
      ws1.getCell("C13").value = "[Rumus] = Total Harga Feeder Material";
      ws1.getCell("C14").value = "[Rumus] = Total Harga Feeder Services";
      ws1.getCell("C15").value = "[Rumus] = Cost Material + Cost Services";
      ws1.getCell("C16").value = "[Rumus] = Total Cost Material Kabel Feeder";
      ws1.getCell("C17").value = "[Rumus] = Cost Material - Material JIA";
      ws1.getCell("C18").value = "[Rumus] = Total Cost / Panjang Jalur";
      for (let i = 13; i <= 18; i++) {
        const row = ws1.getRow(i);
        row.getCell(1).font = { name: FONT_NAME, bold: true, size: 12 };
        row.getCell(2).font = { name: FONT_NAME, size: 12 };
        row.getCell(2).numFmt = FMT.RP;
        row.getCell(3).font = { name: FONT_NAME, size: 12 };
      }
      for (let i = 4; i <= 18; i++) {
        ws1.mergeCells(`C${i}:E${i}`);
      }

      ws1.getCell("A21").value = "Material";
      ws1.getCell("A21").font = { name: FONT_NAME, bold: true, size: 14 };
      headers.forEach((h, i) => {
        const cell = ws1.getCell(22, i + 1);
        cell.value = h;
        applyHeader(cell, COLOR.HEADER_BLUE);
      });
      ws1.getCell("A23").value = "Feeder Material";
      for (let col = 1; col <= 7; col++) {
        applySectionHeader(ws1.getRow(23).getCell(col), COLOR.SUBTOTAL_LIGHT);
      }

      // urutan baris mengikuti materialRows: cable, pole, sc, closure, xframe, sb, sbr
      const startRowM = 24;
      const rowCable = startRowM;
      const rowPole = startRowM + 1;
      const rowSC = startRowM + 2;
      const rowJC = startRowM + 3;
      const rowXF = startRowM + 4;
      const rowSB = startRowM + 5;
      const materialQtyFormula = {
        [rowCable]: `B6`,
        [rowPole]: `B7`,
        [rowSC]: `D${rowPole}*${SC_PER_POLE}`,
        [rowJC]: `B9`,
        [rowXF]: `B8+D${rowJC}`,
        [rowSB]: `ROUNDUP((D${rowXF}*2+D${rowSC})*50/100/50,0)`,
        [startRowM + 6]: `D${rowSB}*100`,
      };
      materialRows.forEach((item, index) => {
        const rowIndex = startRowM + index;
        writeItemRow(ws1, rowIndex, item, {
          formula: materialQtyFormula[rowIndex],
        });
      });
      const rowSubtotalM = startRowM + materialRows.length;
      writeTotalRow(
        ws1,
        rowSubtotalM,
        "Subtotal",
        `SUM(F${startRowM}:F${rowSubtotalM - 1})`,
        COLOR.SUBTOTAL_LIGHT
      );
      const rowGrandTotalM = rowSubtotalM + 1;
      writeTotalRow(
        ws1,
        rowGrandTotalM,
        "Grand Total",
        `F${rowSubtotalM}`,
        COLOR.SUBTOTAL_LIGHT
      );

      // ---------- Sheet Services ----------
      ws2.getCell("A3").value = "Feeder Services";
      ws2.getCell("A3").font = { name: FONT_NAME, bold: true, size: 14 };

      ws2.mergeCells("A4:B4");
      ws2.getCell("A4").value = "Description";
      ws2.getCell("C4").value = "Formula";
      applyBlockHeader(ws2, "A4", "C4");

      ws2.getCell("A5").value = "Panjang Jalur (m)";
      ws2.getCell("A6").value = "Service Feeder";
      ws2.getCell("A7").value = "Cost per Meter";
      ws2.getCell("A8").value = "Site";
      ws2.getCell("A9").value = "Timeline";
      ws2.getCell("A10").value = "Term of Payment";
      ws2.getCell("B5").value = { formula: `Material!B5` };
      ws2.getCell("B7").value = { formula: `ROUNDUP(B6/B5,2)` };
      ws2.getCell("B8").value = servicesInfo.site;
      ws2.getCell("B9").value = servicesInfo.timeline;
      ws2.getCell("B10").value = servicesInfo.term_of_payment;
      ws2.getCell("C5").value = "[Rumus] Berdasarkan Panjang Jalur";
      ws2.getCell("C6").value = "[Rumus] = Total Cost Feeder Services";
      ws2.getCell("C7").value =
        "[Rumus] = Total Cost Feeder Services / Panjang Jalur";
      ws2.getCell("C8").value = "[Manual] = Di isi Manual Oleh User";
      ws2.getCell("C9").value = "[Manual] = Di isi Manual Oleh User";
      ws2.getCell("C10").value = "[Manual] = Di isi Manual Oleh User";
      for (let i = 5; i <= 7; i++) {
        const row = ws2.getRow(i);
        row.getCell(1).font = { name: FONT_NAME, bold: true, size: 12 };
        row.getCell(2).font = { name: FONT_NAME, size: 12 };
        row.getCell(3).font = { name: FONT_NAME, size: 12 };
      }
      ws2.getCell("B5").numFmt = FMT.INT2;
      ws2.getCell("B6").numFmt = FMT.RP;
      ws2.getCell("B7").numFmt = FMT.RP;
      for (let i = 8; i <= 10; i++) {
        const row = ws2.getRow(i);
        row.getCell(1).font = { name: FONT_NAME, bold: true, size: 12 };
        row.getCell(2).font = { name: FONT_NAME, size: 12 };
        row.getCell(3).font = { name: FONT_NAME, size: 12 };
      }
      for (let i = 4; i <= 10; i++) {
        ws2.mergeCells(`C${i}:E${i}`);
      }

      headers.forEach((h, i) => {
        const cell = ws2.getCell(12, i + 1);
        cell.value = h;
        applyHeader(cell, COLOR.HEADER_GREEN);
      });
      ws2.getCell("A13").value = "Feeder Services";
      for (let col = 1; col <= 7; col++) {
        applySectionHeader(ws2.getRow(13).getCell(col), COLOR.SUBTOTAL_LIGHT2);
      }

      // urutan baris mengikuti servicesRows: cable, pole, xframe, sc, jc, jc core
      const startRowS = 14;
      const servicesQtyFormula = [
        `Material!B6`,
        `Material!B7`,
        `Material!D${rowXF}`,
        `Material!D${rowSC}`,
        `Material!B9`,
        `Material!B9*${feeder.jc_core}`,
      ];
      servicesRows.forEach((item, index) => {
        writeItemRow(ws2, startRowS + index, item, {
          formula: servicesQtyFormula[index],
        });
      });
      const rowSubtotalS = startRowS + servicesRows.length;
      writeTotalRow(
        ws2,
        rowSubtotalS,
        "Subtotal",
        `SUM(F${startRowS}:F${rowSubtotalS - 1})`,
        COLOR.SUBTOTAL_LIGHT2
      );
      const rowGrandTotalS = rowSubtotalS + 1;
      writeTotalRow(
        ws2,
        rowGrandTotalS,
        "Grand Total",
        `F${rowSubtotalS}`,
        COLOR.SUBTOTAL_LIGHT2
      );

      // summary yang menunjuk balik ke tabel, supaya ikut berubah saat B5 diubah
      ws1.getCell("B13").value = { formula: `F${rowGrandTotalM}` };
      ws1.getCell("B14").value = { formula: `Services!F${rowGrandTotalS}` };
      ws1.getCell("B15").value = { formula: `B13+B14` };
      ws1.getCell("B16").value = { formula: `F${rowCable}` };
      ws1.getCell("B17").value = { formula: `B13-B16` };
      ws1.getCell("B18").value = { formula: `ROUNDUP(B15/B5,2)` };
      ws2.getCell("B6").value = { formula: `F${rowGrandTotalS}` };

      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename=boq_bom_feeder_simple.xlsx`
      );
      await workbook.xlsx.write(res);
      return res.end();
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "boq-bom/ftth/feeder-simple/generate-boq-bom",
          reason: "Failed to generate boq bom",
        })
      );
    }
  };
}
