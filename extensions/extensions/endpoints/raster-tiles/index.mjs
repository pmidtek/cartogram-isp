import { pipeline } from "node:stream/promises";

import {
  createError,
  InvalidQueryError,
  ServiceUnavailableError,
  RouteNotFoundError,
} from "@directus/errors";

import minioClient from "../../utils/minioClient.mjs";

const validateUuid = (input) => {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(input);
};

const TileNotFoundError = createError(
  "TILE_NOT_FOUND",
  (ext) =>
    `Tile ${ext.z},${ext.x},${ext.y} for layer_id ${ext.layerId} not found`,
  404
);

export default (router, { database, env, logger }) => {
  router.get("/:layerId", async (req, res, next) => {
    const { accountability } = req;
    let { z, x, y } = req.query;
    const { layerId } = req.params;

    // validate uuid
    if (!validateUuid(layerId)) {
      return next(new RouteNotFoundError({ path: "/raster-tiles" + req.path }));
    }

    let rasterTileRows;
    // get raster tile entry
    try {
      ({ rows: rasterTileRows } = await database.raw(
        `
        WITH allowed_roles_query AS (
          SELECT ARRAY_AGG(directus_roles_id) allowed_roles
          FROM raster_tiles_directus_roles
          WHERE raster_tiles_layer_id = :layerId
        )
        SELECT permission_type, allowed_roles
        FROM raster_tiles, allowed_roles_query
        WHERE layer_id = :layerId
      `,
        { layerId }
      ));
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "raster-tiles",
          reason: "Failed to fetch raster tile entry",
        })
      );
    }

    if (!rasterTileRows.length) {
      return next(new RouteNotFoundError({ path: "/raster-tiles" + req.path }));
    }

    switch (rasterTileRows[0].permission_type) {
      case "admin":
        if (!accountability.admin) {
          return next(
            new RouteNotFoundError({ path: "/raster-tiles" + req.path })
          );
        }
        break;

      case "roles":
        if (
          !accountability.admin &&
          (!accountability.role ||
            !Array.isArray(rasterTileRows[0].allowed_roles) ||
            !rasterTileRows[0].allowed_roles.includes(accountability.role))
        ) {
          return next(
            new RouteNotFoundError({ path: "/raster-tiles" + req.path })
          );
        }
        break;

      case "roles+public":
        if (
          !accountability.admin &&
          accountability.role &&
          (!Array.isArray(rasterTileRows[0].allowed_roles) ||
            !rasterTileRows[0].allowed_roles.includes(accountability.role))
        ) {
          return next(
            new RouteNotFoundError({ path: "/raster-tiles" + req.path })
          );
        }
        break;

      default:
        return next(
          new ServiceUnavailableError({
            service: "raster-tiles",
            reason: `Unexpected uploaded raster tile permission type for ${layerId}: ${rasterTileRows[0].permission_type}`,
          })
        );
    }

    z = parseInt(z);
    x = parseInt(x);
    y = parseInt(y);

    if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0) {
      return next(new InvalidQueryError({ reason: "Invalid z, x, y" }));
    }

    const objectKey =
      (env.STORAGE_S3_ROOT ? env.STORAGE_S3_ROOT + "/" : "") +
      `raster-tiles/${layerId}/${z}/${x}/${y}.png`;

    let fileStream;
    try {
      fileStream = await minioClient.getObject(
        env.STORAGE_S3_BUCKET,
        objectKey
      );
    } catch (error) {
      if (error.code === "NoSuchKey") {
        return next(new TileNotFoundError({ z, x, y, layerId }));
      } else {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "raster-tiles",
            reason: "Failed to fetch tile",
          })
        );
      }
    }

    try {
      res.setHeader("Content-Type", "image/png");
      await pipeline(fileStream, res);
    } catch (error) {
      logger.error(error);
    }
  });
};
