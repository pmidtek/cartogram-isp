import {
  InvalidQueryError,
  ServiceUnavailableError,
  ForbiddenError,
  RouteNotFoundError,
} from "@directus/errors";

//masa berlaku cache tile mvt-data, dalam jam
const CACHE_DURATION_HOURS = 1;

//hanya zoom di bawah ini yang di-cache : tile-nya sedikit, mahal dibuat, dan
//sering dilihat berulang. di zoom tinggi jumlah tile meledak dan hit rate kecil
const CACHE_MAX_ZOOM = 11;

//prefix sengaja dibedakan dari endpoint /mvt : key tidak bertabrakan dengan
//layer bernama sama, dan tidak ikut terhapus trigger invalidasi vector_tiles
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

  return `mvtdata_${layerName}${middlePart}_${z}_${x}_${y}`;
}

export default (router, { database, logger }) => {
  //entri kedaluwarsa diabaikan walau cron pembersih belum sempat menghapusnya
  const getTileCache = async (cacheKey) => {
    try {
      const cacheResult = await database("vector_tile_cache")
        .select("value")
        .where("key", cacheKey)
        .where("expired_at", ">", new Date())
        .first();
      return cacheResult ? Buffer.from(cacheResult.value) : null;
    } catch (error) {
      logger.error(error, "Cache lookup failed");
      return null;
    }
  };

  //onConflict dipakai karena key adalah primary key : entri lama yang sudah
  //kedaluwarsa tapi belum dibersihkan harus ditimpa, bukan bikin insert gagal
  const setTileCache = async (cacheKey, mvtBuff) => {
    const expiredAt = new Date();
    expiredAt.setHours(expiredAt.getHours() + CACHE_DURATION_HOURS);
    try {
      await database("vector_tile_cache")
        .insert({ key: cacheKey, value: mvtBuff, expired_at: expiredAt })
        .onConflict("key")
        .merge();
    } catch (error) {
      logger.error(error, "Failed to update cache");
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
  router.get("/site_points", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let { z, x, y } = req.query;
      const is_playground = req.query.is_playground
        ? req.query.is_playground.toLowerCase() === "true"
        : true;

      z = parseInt(z);
      x = parseInt(x);
      y = parseInt(y);
      if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0) {
        return next(new InvalidQueryError({ reason: "Invalid z, x, y" }));
      }

      const resultPlayground = await getPlaygrounds(req, next, is_playground);
      if (!resultPlayground) return;
      const { playgroundProvinces, playgroundCities } = resultPlayground;

      let queryParams = [z, x, y];
      let whereClauses = [];
      const useAreaCity =
        is_playground &&
        (playgroundProvinces.length || playgroundCities.length);
      if (useAreaCity) {
        if (playgroundProvinces.length) {
          whereClauses.push(
            `ac.province_id IN (${playgroundProvinces
              .map((p) => `'${p}'`)
              .join(",")})`
          );
        }
        if (playgroundCities.length) {
          whereClauses.push(
            `ac.city_id IN (${playgroundCities.map((c) => `'${c}'`).join(",")})`
          );
        }
      }

      //exclude ftth site
      whereClauses.push(`spt.code != 'ftth'`);

      let mvtQuery = `
        WITH tile_envelope AS (
            SELECT ST_TileEnvelope(?, ?, ?) tile
        ), mvtgeom_table AS (
            SELECT
              ST_AsMVTGeom(ST_Transform(main.geom, 3857), tile) geom,
              main.id, main.site_point_type_id, main.name, main.owner
            FROM site_points main
            INNER JOIN tile_envelope ON main.geom && ST_Transform(tile, 4326)
            INNER JOIN site_point_types spt ON main.site_point_type_id = spt.id
            ${
              useAreaCity
                ? "LEFT JOIN area_cities ac ON main.area_city_id = ac.ogc_fid"
                : ""
            }
            ${whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : ""}
        ) SELECT ST_AsMVT(mvtgeom_table, 'site_points', 4096, 'geom', 'id') mvt_buff
            FROM mvtgeom_table
        ;`;

      const useCache = z < CACHE_MAX_ZOOM;
      const cacheKey = generateCacheKey(
        "site_points",
        { is_playground: is_playground ? "pg" : "all" },
        z,
        x,
        y,
        playgroundProvinces,
        playgroundCities
      );
      if (useCache) {
        const cachedTile = await getTileCache(cacheKey);
        if (cachedTile) {
          res.setHeader("Content-Type", "application/x-protobuf");
          return res.send(cachedTile);
        }
      }

      const result = await database.raw(mvtQuery, [...queryParams]);
      const mvtBuff = result.rows[0]?.mvt_buff;
      if (mvtBuff && mvtBuff.length) {
        res.setHeader("Content-Type", "application/x-protobuf");
        if (useCache) {
          await setTileCache(cacheKey, mvtBuff);
        }
        return res.send(mvtBuff);
      } else {
        return res.status(204).send();
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt-data/site_points",
          reason: `Failed to get mvt site_points${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/routes", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let { z, x, y } = req.query;
      const is_playground = req.query.is_playground
        ? req.query.is_playground.toLowerCase() === "true"
        : true;

      z = parseInt(z);
      x = parseInt(x);
      y = parseInt(y);
      if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0) {
        return next(new InvalidQueryError({ reason: "Invalid z, x, y" }));
      }

      const resultPlayground = await getPlaygrounds(req, next, is_playground);
      if (!resultPlayground) return;
      const { playgroundProvinces, playgroundCities } = resultPlayground;

      let queryParams = [z, x, y];
      let whereClauses = [];
      const useAreaCity =
        is_playground &&
        (playgroundProvinces.length || playgroundCities.length);
      if (useAreaCity) {
        if (playgroundProvinces.length) {
          whereClauses.push(
            `(
              ac_from.province_id IN (${playgroundProvinces
                .map((p) => `'${p}'`)
                .join(",")})
              OR
              ac_to.province_id IN (${playgroundProvinces
                .map((p) => `'${p}'`)
                .join(",")})
            )`
          );
        }
        if (playgroundCities.length) {
          whereClauses.push(
            `(
              ac_from.city_id IN (${playgroundCities
                .map((c) => `'${c}'`)
                .join(",")})
              OR
              ac_to.city_id IN (${playgroundCities
                .map((c) => `'${c}'`)
                .join(",")})
              )`
          );
        }
      }

      //exclude ftth route
      whereClauses.push(`
        main.route_type_id NOT IN (3, 4, 5)
      `);
      let mvtQuery = `
        WITH tile_envelope AS (
            SELECT ST_TileEnvelope(?, ?, ?) tile
        ), mvtgeom_table AS (
            SELECT
                ST_AsMVTGeom(ST_Transform(main.geom, 3857), tile) AS geom,
                main.id, main.route_type_id
            FROM routes main
            INNER JOIN tile_envelope ON main.geom && ST_Transform(tile, 4326)
            ${
              useAreaCity
                ? `
                INNER JOIN site_points site_from ON main.site_from = site_from.id
                INNER JOIN site_points site_to ON main.site_to = site_to.id
                INNER JOIN area_cities ac_from ON site_from.area_city_id = ac_from.ogc_fid
                INNER JOIN area_cities ac_to ON site_to.area_city_id = ac_to.ogc_fid`
                : ""
            }
            ${whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : ""}
        ) SELECT ST_AsMVT(mvtgeom_table, 'routes', 4096, 'geom', 'id') mvt_buff
            FROM mvtgeom_table
        ;`;

      const useCache = z < CACHE_MAX_ZOOM;
      const cacheKey = generateCacheKey(
        "routes",
        { is_playground: is_playground ? "pg" : "all" },
        z,
        x,
        y,
        playgroundProvinces,
        playgroundCities
      );
      if (useCache) {
        const cachedTile = await getTileCache(cacheKey);
        if (cachedTile) {
          res.setHeader("Content-Type", "application/x-protobuf");
          return res.send(cachedTile);
        }
      }

      const result = await database.raw(mvtQuery, [...queryParams]);
      const mvtBuff = result.rows[0]?.mvt_buff;
      if (mvtBuff && mvtBuff.length) {
        res.setHeader("Content-Type", "application/x-protobuf");
        if (useCache) {
          await setTileCache(cacheKey, mvtBuff);
        }
        return res.send(mvtBuff);
      } else {
        return res.status(204).send();
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt-data/routes",
          reason: `Failed to get mvt routes${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/assets", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let { z, x, y } = req.query;
      const is_playground = req.query.is_playground
        ? req.query.is_playground.toLowerCase() === "true"
        : true;

      z = parseInt(z);
      x = parseInt(x);
      y = parseInt(y);
      if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0) {
        return next(new InvalidQueryError({ reason: "Invalid z, x, y" }));
      }

      const resultPlayground = await getPlaygrounds(req, next, is_playground);
      if (!resultPlayground) return;
      const { playgroundProvinces, playgroundCities } = resultPlayground;

      let queryParams = [z, x, y];
      let whereClauses = [];
      const useAreaCity =
        is_playground &&
        (playgroundProvinces.length || playgroundCities.length);
      if (useAreaCity) {
        if (playgroundProvinces.length) {
          whereClauses.push(
            `ac.province_id IN (${playgroundProvinces
              .map((p) => `'${p}'`)
              .join(",")})`
          );
        }
        if (playgroundCities.length) {
          whereClauses.push(
            `ac.city_id IN (${playgroundCities.map((c) => `'${c}'`).join(",")})`
          );
        }
      }

      //exclude ftth site
      whereClauses.push(`spt.code != 'ftth'`);

      let mvtQuery = `
        WITH tile_envelope AS (
            SELECT ST_TileEnvelope(?, ?, ?) tile
        ), asset_data AS (
            SELECT
              assets.id, assets.name, assets.site_point_id,
              ST_Project(site_points.geom::geography, 10, radians(360/(COUNT(*) OVER (PARTITION BY assets.site_point_id))*ROW_NUMBER() OVER (PARTITION BY assets.site_point_id ORDER BY assets.id)))::geometry AS geom,
              assets.asset_type_id
            FROM assets
            INNER JOIN site_points ON assets.site_point_id = site_points.id
            INNER JOIN tile_envelope t ON site_points.geom && ST_Transform(t.tile, 4326)
            INNER JOIN site_point_types spt ON site_points.site_point_type_id = spt.id
            ${
              useAreaCity
                ? "INNER JOIN area_cities ac ON site_points.area_city_id = ac.ogc_fid"
                : ""
            }
            ${whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : ""}
        ), mvtgeom_table AS (
            SELECT ST_AsMVTGeom(ST_Transform(main.geom, 3857), tile) geom, id, asset_type_id, site_point_id, name
            FROM asset_data main
            INNER JOIN tile_envelope ON main.geom && ST_Transform(tile, 4326)
        ) SELECT ST_AsMVT(mvtgeom_table, 'assets', 4096, 'geom', 'id') mvt_buff
            FROM mvtgeom_table
        ;`;

      const useCache = z < CACHE_MAX_ZOOM;
      const cacheKey = generateCacheKey(
        "assets",
        { is_playground: is_playground ? "pg" : "all" },
        z,
        x,
        y,
        playgroundProvinces,
        playgroundCities
      );
      if (useCache) {
        const cachedTile = await getTileCache(cacheKey);
        if (cachedTile) {
          res.setHeader("Content-Type", "application/x-protobuf");
          return res.send(cachedTile);
        }
      }

      const result = await database.raw(mvtQuery, [...queryParams]);
      const mvtBuff = result.rows[0]?.mvt_buff;
      if (mvtBuff && mvtBuff.length) {
        res.setHeader("Content-Type", "application/x-protobuf");
        if (useCache) {
          await setTileCache(cacheKey, mvtBuff);
        }
        return res.send(mvtBuff);
      } else {
        return res.status(204).send();
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt-data/assets",
          reason: `Failed to get mvt assets${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/asset-spiders", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let { z, x, y } = req.query;
      const is_playground = req.query.is_playground
        ? req.query.is_playground.toLowerCase() === "true"
        : true;

      z = parseInt(z);
      x = parseInt(x);
      y = parseInt(y);
      if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0) {
        return next(new InvalidQueryError({ reason: "Invalid z, x, y" }));
      }

      const resultPlayground = await getPlaygrounds(req, next, is_playground);
      if (!resultPlayground) return;
      const { playgroundProvinces, playgroundCities } = resultPlayground;

      let queryParams = [z, x, y];
      let whereClauses = [];
      const useAreaCity =
        is_playground &&
        (playgroundProvinces.length || playgroundCities.length);
      if (useAreaCity) {
        if (playgroundProvinces.length) {
          whereClauses.push(
            `ac.province_id IN (${playgroundProvinces
              .map((p) => `'${p}'`)
              .join(",")})`
          );
        }
        if (playgroundCities.length) {
          whereClauses.push(
            `ac.city_id IN (${playgroundCities.map((c) => `'${c}'`).join(",")})`
          );
        }
      }

      //exclude ftth site
      whereClauses.push(`spt.code != 'ftth'`);

      let mvtQuery = `
        WITH tile_envelope AS (
            SELECT ST_TileEnvelope(?, ?, ?) tile
        ), asset_data AS (
            SELECT
              	assets.id, assets.site_point_id,
                ST_MakeLine(site_points.geom, ST_Project(site_points.geom::geography, 10, radians(360/(COUNT(*) OVER (PARTITION BY assets.site_point_id))*ROW_NUMBER() OVER (PARTITION BY assets.site_point_id ORDER BY assets.id)))::geometry) AS geom,
                assets.asset_type_id
            FROM assets
            INNER JOIN site_points ON assets.site_point_id = site_points.id
            INNER JOIN tile_envelope t ON site_points.geom && ST_Transform(t.tile, 4326)
            INNER JOIN site_point_types spt ON site_points.site_point_type_id = spt.id
            ${
              useAreaCity
                ? "INNER JOIN area_cities ac ON site_points.area_city_id = ac.ogc_fid"
                : ""
            }
            ${whereClauses.length ? "WHERE " + whereClauses.join(" AND ") : ""}
        ), mvtgeom_table AS (
            SELECT ST_AsMVTGeom(ST_Transform(main.geom, 3857), tile) geom, id, asset_type_id
            FROM asset_data main
            INNER JOIN tile_envelope ON main.geom && ST_Transform(tile, 4326)
        ) SELECT ST_AsMVT(mvtgeom_table, 'asset-spiders', 4096, 'geom', 'id') mvt_buff
            FROM mvtgeom_table
        ;`;

      const useCache = z < CACHE_MAX_ZOOM;
      const cacheKey = generateCacheKey(
        "asset-spiders",
        { is_playground: is_playground ? "pg" : "all" },
        z,
        x,
        y,
        playgroundProvinces,
        playgroundCities
      );
      if (useCache) {
        const cachedTile = await getTileCache(cacheKey);
        if (cachedTile) {
          res.setHeader("Content-Type", "application/x-protobuf");
          return res.send(cachedTile);
        }
      }

      const result = await database.raw(mvtQuery, [...queryParams]);
      const mvtBuff = result.rows[0]?.mvt_buff;
      if (mvtBuff && mvtBuff.length) {
        res.setHeader("Content-Type", "application/x-protobuf");
        if (useCache) {
          await setTileCache(cacheKey, mvtBuff);
        }
        return res.send(mvtBuff);
      } else {
        return res.status(204).send();
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt-data/asset-spiders",
          reason: `Failed to get mvt asset-spiders${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/cables", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      let { z, x, y } = req.query;
      const is_playground = req.query.is_playground
        ? req.query.is_playground.toLowerCase() === "true"
        : true;

      z = parseInt(z);
      x = parseInt(x);
      y = parseInt(y);
      if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0) {
        return next(new InvalidQueryError({ reason: "Invalid z, x, y" }));
      }

      const resultPlayground = await getPlaygrounds(req, next, is_playground);
      if (!resultPlayground) return;
      const { playgroundProvinces, playgroundCities } = resultPlayground;

      let queryParams = [z, x, y];
      let whereClauses = [];
      const useAreaCity =
        is_playground &&
        (playgroundProvinces.length || playgroundCities.length);
      if (useAreaCity) {
        if (playgroundProvinces.length) {
          whereClauses.push(
            `(
              ac_from.province_id IN (${playgroundProvinces
                .map((p) => `'${p}'`)
                .join(",")})
              OR
              ac_to.province_id IN (${playgroundProvinces
                .map((p) => `'${p}'`)
                .join(",")})
            )`
          );
        }
        if (playgroundCities.length) {
          whereClauses.push(
            `(
              ac_from.city_id IN (${playgroundCities
                .map((c) => `'${c}'`)
                .join(",")})
              OR
              ac_to.city_id IN (${playgroundCities
                .map((c) => `'${c}'`)
                .join(",")})
              )`
          );
        }
      }

      //exclude ftth cable
      whereClauses.push(`
        cables.cable_type_id NOT IN (3, 4, 5)
      `);

      let mvtQuery = `
        WITH tile_envelope AS (
            SELECT ST_TileEnvelope(?, ?, ?) tile
        ), cable_data AS (
            SELECT cables.id, cables.cable_type_id, ST_Union(routes.geom) AS geom
            FROM cables
            INNER JOIN cable_routes cr ON cables.id = cr.cable_id
            INNER JOIN routes ON cr.route_id = routes.id
            ${
              useAreaCity
                ? `
                INNER JOIN site_points site_from ON cables.site_from = site_from.id
                INNER JOIN site_points site_to ON cables.site_to = site_to.id
                INNER JOIN area_cities ac_from ON site_from.area_city_id = ac_from.ogc_fid
                INNER JOIN area_cities ac_to ON site_to.area_city_id = ac_to.ogc_fid`
                : ""
            }
            CROSS JOIN tile_envelope t
            WHERE routes.geom && ST_Transform(t.tile, 4326)
            ${whereClauses.length ? " AND " + whereClauses.join(" AND ") : ""}
            GROUP BY cables.id
        ), mvtgeom_table AS (
            SELECT ST_AsMVTGeom(ST_Transform(main.geom, 3857), tile) geom, id, cable_type_id
            FROM cable_data main
            INNER JOIN tile_envelope ON main.geom && ST_Transform(tile, 4326)
        ) SELECT ST_AsMVT(mvtgeom_table, 'cables', 4096, 'geom', 'id') mvt_buff
            FROM mvtgeom_table
        ;`;

      const useCache = z < CACHE_MAX_ZOOM;
      const cacheKey = generateCacheKey(
        "cables",
        { is_playground: is_playground ? "pg" : "all" },
        z,
        x,
        y,
        playgroundProvinces,
        playgroundCities
      );
      if (useCache) {
        const cachedTile = await getTileCache(cacheKey);
        if (cachedTile) {
          res.setHeader("Content-Type", "application/x-protobuf");
          return res.send(cachedTile);
        }
      }

      const result = await database.raw(mvtQuery, [...queryParams]);
      const mvtBuff = result.rows[0]?.mvt_buff;
      if (mvtBuff && mvtBuff.length) {
        res.setHeader("Content-Type", "application/x-protobuf");
        if (useCache) {
          await setTileCache(cacheKey, mvtBuff);
        }
        return res.send(mvtBuff);
      } else {
        return res.status(204).send();
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "mvt-data/routes",
          reason: `Failed to get mvt routes${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
};
