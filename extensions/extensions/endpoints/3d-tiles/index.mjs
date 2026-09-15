import { pipeline } from "node:stream/promises";

import {
  createError,
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
  (ext) => `File ${ext.fileName} for layer_id ${ext.layerId} not found`,
  404
);

export default (router, { database, env, logger }) => {
  router.get("/:layerId/*", async (req, res, next) => {
    const { accountability } = req;
    const { layerId } = req.params;

    // construct file name
    const fileName = req.path.slice(`/${layerId}/`.length);
    if (!fileName) {
      return next(new RouteNotFoundError({ path: "/3d-tiles" + req.path }));
    }

    // validate uuid
    if (!validateUuid(layerId)) {
      return next(new RouteNotFoundError({ path: "/3d-tiles" + req.path }));
    }

    let threeDTileRows;
    // get three d tile entry
    try {
      ({ rows: threeDTileRows } = await database.raw(
        `
        WITH allowed_roles_query AS (
          SELECT ARRAY_AGG(directus_roles_id) allowed_roles
          FROM three_d_tiles_directus_roles
          WHERE three_d_tiles_layer_id = :layerId
        )
        SELECT permission_type, allowed_roles
        FROM three_d_tiles, allowed_roles_query
        WHERE layer_id = :layerId
      `,
        { layerId }
      ));
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "3d-tiles",
          reason: "Failed to fetch raster tile entry",
        })
      );
    }

    if (!threeDTileRows.length) {
      return next(new RouteNotFoundError({ path: "/3d-tiles" + req.path }));
    }

    switch (threeDTileRows[0].permission_type) {
      case "admin":
        if (!accountability.admin) {
          return next(new RouteNotFoundError({ path: "/3d-tiles" + req.path }));
        }
        break;

      case "roles":
        if (
          !accountability.admin &&
          (!accountability.role ||
            !Array.isArray(threeDTileRows[0].allowed_roles) ||
            !threeDTileRows[0].allowed_roles.includes(accountability.role))
        ) {
          return next(new RouteNotFoundError({ path: "/3d-tiles" + req.path }));
        }
        break;

      case "roles+public":
        if (
          !accountability.admin &&
          accountability.role &&
          (!Array.isArray(threeDTileRows[0].allowed_roles) ||
            !threeDTileRows[0].allowed_roles.includes(accountability.role))
        ) {
          return next(new RouteNotFoundError({ path: "/3d-tiles" + req.path }));
        }
        break;

      default:
        return next(
          new ServiceUnavailableError({
            service: "3d-tiles",
            reason: `Unexpected uploaded raster tile permission type for ${layerId}: ${threeDTileRows[0].permission_type}`,
          })
        );
    }

    const objectKey =
      (env.STORAGE_S3_ROOT ? env.STORAGE_S3_ROOT + "/" : "") +
      `3d-tiles/${layerId}/${fileName}`;
    let fileStream;
    try {
      fileStream = await minioClient.getObject(
        env.STORAGE_S3_BUCKET,
        objectKey
      );
    } catch (error) {
      if (error.code === "NoSuchKey") {
        return next(new TileNotFoundError({ fileName, layerId }));
      } else {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "3d-tiles",
            reason: "Failed to fetch tile",
          })
        );
      }
    }

    try {
      if (fileName.endsWith(".json")) {
        res.setHeader("Content-Type", "application/json");
      }
      await pipeline(fileStream, res);
    } catch (error) {
      logger.error(error);
    }
  });
};
