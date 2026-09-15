import { InvalidQueryError, ServiceUnavailableError } from "@directus/errors";

export default (router, { database, logger, services }) => {
  const { ItemsService } = services;

  router.get("/", async (req, res, next) => {
    return res.json({
      status: "ok",
      message: "succeed, add data layer ready 123",
    });
  });

  router.post("/", async (req, res, next) => {
    try {
      const { accountability } = req;
      const { layerName, layerAlias, distance, loss, geom } = req.body;

      if (!geom || !layerName) {
        throw new InvalidQueryError("layerName and geom are required");
      }

      // Services
      const vectorTilesService = new ItemsService("vector_tiles", {
        schema: req.schema,
        knex: database,
        accountability,
      });

      const ftthCounterService = new ItemsService("ftth_counter", {
        schema: req.schema,
        knex: database,
        accountability,
      });

      const collectionsService = new ItemsService("directus_collections", {
        schema: req.schema,
        knex: database,
        accountability,
      });

      const fieldsService = new ItemsService("directus_fields", {
        schema: req.schema,
        knex: database,
        accountability,
      });

      // Get current counter
      const counterData = await ftthCounterService.readByQuery({
        filter: { id: { _eq: 1 } },
        fields: ["count"],
        limit: 1,
      });

      const currentCount = counterData[0]?.count || 0;
      const uniqueLayer = `${layerName}_${String(currentCount)}`;
      // logger.info("currentCount: "+ JSON.stringify(currentCount));
      // logger.info("currentCount: "+ JSON.stringify(counterData));
      // logger.info("unique layer: "+ uniqueLayer)

      // Ensure table exists (or add missing columns)
      await database.schema.hasTable(uniqueLayer).then(async (exists) => {
        if (!exists) {
          await database.schema.createTable(uniqueLayer, (table) => {
            table.increments("ogc_fid").primary();
            table.float("distance");
            table.float("loss");
            table.specificType("geom", "geometry");
          });
        } else {
          const hasDistance = await database.schema.hasColumn(uniqueLayer, "distance");
          if (!hasDistance) await database.schema.alterTable(uniqueLayer, (t) => t.float("distance"));

          const hasLoss = await database.schema.hasColumn(uniqueLayer, "loss");
          if (!hasLoss) await database.schema.alterTable(uniqueLayer, (t) => t.float("loss"));

          const hasGeom = await database.schema.hasColumn(uniqueLayer, "geom");
          if (!hasGeom) await database.schema.alterTable(uniqueLayer, (t) => t.specificType("geom", "geometry"));
        }
      });

      // Check if collection already exists
      const existingCollection = await collectionsService.readByQuery({
        filter: { collection: { _eq: uniqueLayer } },
        fields: ["collection"],
        limit: 1,
      });

      if (!existingCollection.data || existingCollection.data.length === 0) {
        // safe to create
        await collectionsService.createOne({
          collection: uniqueLayer,
          icon: "box",
          note: `Auto-generated collection for ${uniqueLayer}`,
          display_template: "{{ogc_fid}}",
          hidden: false,
          singleton: false,
        });

        // Register fields
        const fieldsToInsert = [
          { field: "ogc_fid", interface: "numeric", display: "numeric" },
          { field: "distance", interface: "numeric", display: "numeric" },
          { field: "loss", interface: "numeric", display: "numeric" },
          { field: "geom", interface: "input", display: "raw" },
        ];

        for (const f of fieldsToInsert) {
          await fieldsService.createOne({
            collection: uniqueLayer,
            field: f.field,
            interface: f.interface,
            display: f.display,
            hidden: false,
            readonly: false,
            sort: null,
          });
        }
      }


      // Insert geometry (WKT -> PostGIS geometry)
      const [newId] = await database(uniqueLayer)
        .insert({
          distance,
          loss,
          geom: database.raw(`ST_GeomFromText(?, 4326)`, [geom]),
        })
        .returning("ogc_fid");

      logger.info("Inserted row id: " + newId);

      // Get bounds
      const [boundsResult] = await database.select(
        database.raw(`ST_AsGeoJSON(ST_Envelope(ST_GeomFromText(?, 4326))) as bounds`, [geom])
      );

      const bounds = JSON.parse(boundsResult.bounds);

      // Insert into vector_tiles
      const newLayer = await vectorTilesService.createOne({
        layer_name: uniqueLayer,
        geometry_type: "MULTILINESTRING", // better for FTTH
        bounds,
        minzoom: 4,
        maxzoom: 20,
        layer_alias: layerAlias,
        category: "13a16f8f-1313-44bb-8a84-9b01c26175e9",
        active: true,
        listed: true,
        line_style: 11,
        cache_duration: 480,
        permission_type: "roles+public",
        is_ftth: false,
        user_created: accountability?.user || null,
      });

      // Increment counter
      await ftthCounterService.updateOne(1, { count: currentCount + 1 });

      return res.json({
        success: true,
        id: newId,
        vector_tile: newLayer,
        collection: uniqueLayer,
      });
    } catch (err) {
      logger.error(err);
      return next(new ServiceUnavailableError(err.message));
    }
  });
};
