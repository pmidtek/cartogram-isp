import {
  InvalidQueryError,
  ServiceUnavailableError,
  ForbiddenError,
  RouteNotFoundError,
} from "@directus/errors";

export function isNotEmptyObject(obj) {
  return obj && Object.keys(obj).length > 0 && obj.constructor === Object;
}

export function generateCacheKey(
  layerName,
  rest,
  z,
  x,
  y,
  playgroundProvinces = [],
  playgroundCities = []
) {
  const values = [
    ...Object.values(rest),
    ...[...playgroundProvinces].sort(),
    ...[...playgroundCities].sort(),
  ].filter(Boolean);

  const middlePart = values.length ? `_${values.join("_")}` : "";

  return `mvt_${layerName}${middlePart}_${z}_${x}_${y}`;
}

export default (router, { database, logger }) => {
  router.get("/:layerName", async (req, res, next) => {
    if (!req.accountability.user) {
      return next(new ForbiddenError());
    }
    let { z, x, y, ...rest } = req.query;
    const { layerName } = req.params;
    let { accountability } = req;

    // Parse and validate tile coordinates
    z = parseInt(z);
    x = parseInt(x);
    y = parseInt(y);
    if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0) {
      return next(new InvalidQueryError({ reason: "Invalid z, x, y" }));
    }

    let is_playground = false;
    if (
      ["poi", "aoi_area", "area_provinces", "area_cities"].includes(layerName)
    ) {
      is_playground = true;
    }

    let playgroundProvinces = [];
    let playgroundCities = [];
    try {
      if (is_playground) {
        const playgroundData = await database("playgrounds")
          .select("provinces", "cities")
          .where("user_created", accountability.user)
          .first();
        if (playgroundData) {
          playgroundProvinces = Array.isArray(playgroundData.provinces)
            ? playgroundData.provinces.map((p) => p.key).filter(Boolean)
            : [];
          playgroundCities = Array.isArray(playgroundData.cities)
            ? playgroundData.cities.map((c) => c.key).filter(Boolean)
            : [];
        }
        // if (!playgroundData || !playgroundProvinces.length) {
        //   return next(
        //     new InvalidQueryError({ reason: "Playground not setup" })
        //   );
        // }
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt",
          reason: "Failed to fetch MVT playground",
        })
      );
    }
    logger.info(playgroundProvinces);
    logger.info(playgroundCities);

    if ("access_token" in rest) {
      delete rest.access_token;
    }
    // Generate a unique cache key for the requested tile
    // const cacheKey = `mvt_${layerName}_${Object.values(rest).join(
    //   "_"
    // )}_${z}_${x}_${y}`;

    const cacheKey = generateCacheKey(
      layerName,
      rest,
      z,
      x,
      y,
      playgroundProvinces,
      playgroundCities
    );
    logger.info(cacheKey);

    // Attempt to retrieve the tile from cache
    try {
      const cacheResult = await database("vector_tile_cache")
        .select("value")
        .where("key", cacheKey)
        .first();

      if (cacheResult) {
        res.setHeader("Content-Type", "application/x-protobuf");
        return res.send(Buffer.from(cacheResult.value));
      }
    } catch (cacheError) {
      logger.error("Cache lookup failed:", cacheError);
      return next(
        new ServiceUnavailableError({
          service: "mvt",
          reason: "Failed to fetch MVT cache",
        })
      );
    }

    // Fetch additional configuration for the layer
    let layerConfig;
    const SIMPLE_LAYER_NAMES = new Set(["poi"]);
    try {
      const isSimpleLayer = SIMPLE_LAYER_NAMES.has(layerName);
      const layerKey =
        !isSimpleLayer && isNotEmptyObject(rest)
          ? layerName +
            "?" +
            Object.keys(rest)
              .map((key) => `${key}=${rest[key]}`)
              .join("&")
          : layerName;
      logger.info(layerKey);
      layerConfig = await database("vector_tiles")
        .select(
          "fill_class_columns",
          "line_class_columns",
          "circle_class_columns",
          "symbol_class_columns",
          "cache_duration"
        )
        .where("layer_name", layerKey)
        .first();
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt",
          reason: "Failed to fetch vector layer list",
        })
      );
    }

    if (!layerConfig) {
      return next(new RouteNotFoundError({ path: "/mvt" + req.path }));
    }

    // Prepare query parameters for fetching the tile
    let queryParams = [z, x, y];

    let classColumnParam = "";
    const classColumnsArr = [];
    if (layerConfig.fill_class_columns) {
      classColumnsArr.push(...layerConfig.fill_class_columns.split(","));
    }
    if (layerConfig.line_class_columns) {
      classColumnsArr.push(...layerConfig.line_class_columns.split(","));
    }
    if (layerConfig.circle_class_columns) {
      classColumnsArr.push(...layerConfig.circle_class_columns.split(","));
    }
    if (layerConfig.symbol_class_columns) {
      classColumnsArr.push(...layerConfig.symbol_class_columns.split(","));
    }
    if (classColumnsArr.length) {
      const classColumnsSet = new Set(classColumnsArr);
      classColumnsSet.forEach((col) => {
        classColumnParam += ", ??";
        queryParams.push(col);
      });
    }

    // SQL query to generate the Mapbox Vector Tile (MVT)
    let whereClauses = [];
    let paramVal = [];

    if (layerName == "poi") {
      // whereClauses.push(`main.category = ?`);
      // paramVal.push("school");
      whereClauses.push(`main.group IS NOT NULL`);
    }

    if (is_playground) {
      const layerMap = {
        poi: {
          prov: "area_cities.province_id",
          city: "area_cities.city_id",
        },
        aoi_area: {
          prov: "area_cities.province_id",
          city: "area_cities.city_id",
        },
        area_provinces: {
          prov: "main.province_id",
        },
        area_cities: {
          prov: "main.province_id",
          city: "main.city_id",
        },
      };

      const cols = layerMap[layerName];
      if (!cols) return;

      if (playgroundProvinces.length && cols.prov) {
        whereClauses.push(
          `${cols.prov} IN (${playgroundProvinces.map(() => "?").join(",")})`
        );
        paramVal.push(...playgroundProvinces);
      }

      if (playgroundCities.length && cols.city) {
        whereClauses.push(
          `${cols.city} IN (${playgroundCities.map(() => "?").join(",")})`
        );
        paramVal.push(...playgroundCities);
      }
    }

    let mvtQuery;
    if (layerName == "poi") {
      mvtQuery = `
        WITH tile_envelope AS (
          SELECT ST_TileEnvelope(?, ?, ?) tile
        ), mvtgeom_table AS (
          SELECT ST_AsMVTGeom(ST_Transform(main.geom, 3857), tile, 512) geom, main.ogc_fid${classColumnParam}
          FROM ?? main
          INNER JOIN tile_envelope ON main.geom && ST_Transform(tile, 4326)
          LEFT JOIN aoi_area ON main.aoi_area_id = aoi_area.ogc_fid
          LEFT JOIN area_cities ON main.area_city_id = area_cities.ogc_fid
          ${whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : ""}
        )
        SELECT ST_AsMVT(mvtgeom_table, ?, 512, 'geom', 'ogc_fid') mvt_buff
        FROM mvtgeom_table
      `;
    } else if (layerName == "aoi_area") {
      mvtQuery = `
        WITH tile_envelope AS (
          SELECT ST_TileEnvelope(?, ?, ?) tile
        ), mvtgeom_table AS (
          SELECT ST_AsMVTGeom(ST_Transform(main.geom, 3857), tile, 512) geom, main.ogc_fid${classColumnParam}
          FROM ?? main
          INNER JOIN tile_envelope ON main.geom && ST_Transform(tile, 4326)
          LEFT JOIN area_cities ON main.area_city_id = area_cities.ogc_fid
          ${whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : ""}
        )
        SELECT ST_AsMVT(mvtgeom_table, ?, 512, 'geom', 'ogc_fid') mvt_buff
        FROM mvtgeom_table
      `;
    } else {
      mvtQuery = `
        WITH tile_envelope AS (
          SELECT ST_TileEnvelope(?, ?, ?) tile
        ), mvtgeom_table AS (
          SELECT ST_AsMVTGeom(ST_Transform(main.geom, 3857), tile, 512) geom, ogc_fid${classColumnParam}
          FROM ?? main
          INNER JOIN tile_envelope ON main.geom && ST_Transform(tile, 4326)
          ${whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : ""}
        )
        SELECT ST_AsMVT(mvtgeom_table, ?, 512, 'geom', 'ogc_fid') mvt_buff
        FROM mvtgeom_table
      `;
    }
    // logger.info(mvtQuery);

    // Execute the query and send the result
    try {
      const result = await database.raw(mvtQuery, [
        ...queryParams,
        layerName,
        ...paramVal,
        layerName,
      ]);
      const mvtBuff = result.rows[0]?.mvt_buff;

      if (mvtBuff && mvtBuff.length) {
        res.setHeader("Content-Type", "application/x-protobuf");

        // Update the cache if caching is enabled for this layer
        if (layerConfig.cache_duration > 0) {
          const expirationTime = new Date();
          expirationTime.setHours(
            expirationTime.getHours() + layerConfig.cache_duration
          );

          try {
            await database("vector_tile_cache").insert({
              key: cacheKey,
              value: mvtBuff,
              expired_at: expirationTime,
            });
          } catch (cacheUpdateError) {
            logger.error("Failed to update cache:", cacheUpdateError);
          }
        }

        return res.send(mvtBuff);
      } else {
        return res.status(204).send();
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt",
          reason: "Failed to fetch MVT",
        })
      );
    }
  });
  router.get("/ftth/sp_data_footprint", async (req, res, next) => {
    if (!req.accountability.user) {
      return next(new ForbiddenError());
    }
    let { z, x, y } = req.query;
    const layerName = "sp_data_footprint";

    // Parse and validate tile coordinates
    z = parseInt(z);
    x = parseInt(x);
    y = parseInt(y);
    if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0) {
      return next(new InvalidQueryError({ reason: "Invalid z, x, y" }));
    }
    if (z < 18) return res.status(204).send();

    const cacheKey = generateCacheKey(layerName, {}, z, x, y);
    logger.info(cacheKey);

    // Attempt to retrieve the tile from cache
    try {
      const cacheResult = await database("vector_tile_cache")
        .select("value")
        .where("key", cacheKey)
        .first();

      if (cacheResult) {
        res.setHeader("Content-Type", "application/x-protobuf");
        return res.send(Buffer.from(cacheResult.value));
      }
    } catch (cacheError) {
      logger.error("Cache lookup failed:", cacheError);
      return next(
        new ServiceUnavailableError({
          service: "mvt",
          reason: "Failed to fetch MVT cache",
        })
      );
    }

    // Fetch additional configuration for the layer
    let layerConfig;
    try {
      layerConfig = await database("vector_tiles")
        .select(
          "fill_class_columns",
          "line_class_columns",
          "circle_class_columns",
          "symbol_class_columns",
          "cache_duration"
        )
        .where("layer_name", layerName)
        .first();
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt",
          reason: "Failed to fetch vector layer list",
        })
      );
    }

    if (!layerConfig) {
      return next(new RouteNotFoundError({ path: "/mvt" + req.path }));
    }

    // Prepare query parameters for fetching the tile
    let queryParams = [z, x, y];

    let classColumnParam = "";
    const classColumnsArr = [];
    if (layerConfig.fill_class_columns) {
      classColumnsArr.push(...layerConfig.fill_class_columns.split(","));
    }
    if (layerConfig.line_class_columns) {
      classColumnsArr.push(...layerConfig.line_class_columns.split(","));
    }
    if (layerConfig.circle_class_columns) {
      classColumnsArr.push(...layerConfig.circle_class_columns.split(","));
    }
    if (layerConfig.symbol_class_columns) {
      classColumnsArr.push(...layerConfig.symbol_class_columns.split(","));
    }
    if (classColumnsArr.length) {
      const classColumnsSet = new Set(classColumnsArr);
      classColumnsSet.forEach((col) => {
        classColumnParam += ", ??";
        queryParams.push(col);
      });
    }

    // SQL query to generate the Mapbox Vector Tile (MVT)
    let mvtQuery = `
      WITH tile_envelope AS (
        SELECT ST_TileEnvelope(?, ?, ?) tile
      ), mvtgeom_table AS (
        SELECT ST_AsMVTGeom(ST_Transform(main.geom, 3857), tile, 512) geom, ogc_fid${classColumnParam}
        FROM ?? main
        INNER JOIN tile_envelope ON main.geom && ST_Transform(tile, 4326)
      )
      SELECT ST_AsMVT(mvtgeom_table, ?, 512, 'geom', 'ogc_fid') mvt_buff
      FROM mvtgeom_table;`;

    // Execute the query and send the result
    try {
      const result = await database.raw(mvtQuery, [
        ...queryParams,
        layerName,
        layerName,
      ]);
      const mvtBuff = result.rows[0]?.mvt_buff;

      if (mvtBuff && mvtBuff.length) {
        res.setHeader("Content-Type", "application/x-protobuf");

        // Update the cache if caching is enabled for this layer
        if (layerConfig.cache_duration > 0) {
          const expirationTime = new Date();
          expirationTime.setHours(
            expirationTime.getHours() + layerConfig.cache_duration
          );

          try {
            await database("vector_tile_cache").insert({
              key: cacheKey,
              value: mvtBuff,
              expired_at: expirationTime,
            });
          } catch (cacheUpdateError) {
            logger.error("Failed to update cache:", cacheUpdateError);
          }
        }

        return res.send(mvtBuff);
      } else {
        return res.status(204).send();
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt/ftth/sp_data_footprint",
          reason: "Failed to fetch MVT",
        })
      );
    }
  });
};
