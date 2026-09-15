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

const ObjectNotFoundError = createError(
  "OBJECT_NOT_FOUND",
  (ext) => `Object ${ext.objectKey} not found`,
  404
);

export default (router, { database, env, logger }) => {
  router.get("/:xktId", async (req, res, next) => {
    const { xktId } = req.params;

    // validate uuid
    if (!validateUuid(xktId)) {
      return next(new RouteNotFoundError({ path: "/xkt" + req.path }));
    }

    let xktExists = false;
    try {
      ({
        rows: [xktExists],
      } = await database.raw(
        "SELECT EXISTS (SELECT 1 FROM xkt WHERE id = :xktId)",
        { xktId }
      ));
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "xkt",
          reason: "Failed to fetch xkt entry",
        })
      );
    }

    if (!xktExists) {
      return next(new RouteNotFoundError({ path: "/xkt" + req.path }));
    }

    const objectKey =
      (env.STORAGE_S3_ROOT ? env.STORAGE_S3_ROOT + "/" : "") +
      `xkt/${xktId}.xkt`;

    let fileStream;
    try {
      fileStream = await minioClient.getObject(
        env.STORAGE_S3_BUCKET,
        objectKey
      );
    } catch (error) {
      if (error.code === "NoSuchKey") {
        return next(new ObjectNotFoundError({ objectKey }));
      } else {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "xkt",
            reason: "Failed to xkt object",
          })
        );
      }
    }

    try {
      await pipeline(fileStream, res);
    } catch (error) {
      logger.error(error);
    }
  });
};
