import crypto from "node:crypto";
import { InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import isValidTableName from "../../utils/isValidTableName.mjs";

export default async (req, res, next, database, logger) => {
  const { accountability } = req;
  const {
    input_table: inputTable,
    clip_table: clipTable,
    output_table: outputTable,
    filter = null,
  } = req.body;

  if (!inputTable) {
    return next(new InvalidPayloadError({ reason: "input_table is required" }));
  }
  if (!clipTable) {
    return next(new InvalidPayloadError({ reason: "clip_table is required" }));
  }
  if (inputTable === clipTable) {
    return next(
      new InvalidPayloadError({
        reason: "clip_table must be different than input_table",
      })
    );
  }
  if (!outputTable) {
    return next(
      new InvalidPayloadError({ reason: "output_table is required" })
    );
  }
  if (!isValidTableName(outputTable)) {
    return next(
      new InvalidPayloadError({
        reason:
          "output_table must be alphanumeric and underscore only, starts with letter or underscore, and does not exceed 50 characters",
      })
    );
  }
  if (filter && !Array.isArray(filter)) {
    return next(
      new InvalidPayloadError({
        reason: "filter must be array of object",
      })
    );
  }

  try {
    const inputLayer = await database
      .select("geometry_type")
      .from("vector_tiles")
      .where("layer_name", inputTable)
      .first();
    if (!inputLayer) {
      return next(
        new InvalidPayloadError({
          reason: "Input table does not exist in vector_tiles",
        })
      );
    }
    const clipLayer = await database
      .select("geometry_type")
      .from("vector_tiles")
      .where("layer_name", clipTable)
      .first();
    if (!clipLayer) {
      return next(
        new InvalidPayloadError({
          reason: "Clip table does not exist in vector_tiles",
        })
      );
    }

    // check if input geometry types are valid for clipping
    if (
      (["POLYGON", "MULTIPOLYGON"].includes(inputLayer.geometry_type) &&
        !["POLYGON", "MULTIPOLYGON"].includes(clipLayer.geometry_type)) ||
      (["LINESTRING", "MULTILINESTRING"].includes(inputLayer.geometry_type) &&
        !["POLYGON", "MULTIPOLYGON", "LINESTRING", "MULTILINESTRING"].includes(
          clipLayer.geometry_type
        )) ||
      (["POINT", "MULTIPOINT"].includes(inputLayer.geometry_type) &&
        ![
          "POLYGON",
          "MULTIPOLYGON",
          "LINESTRING",
          "MULTILINESTRING",
          "POINT",
          "MULTIPOINT",
        ].includes(clipLayer.geometry_type))
    ) {
      return next(
        new InvalidPayloadError({
          reason:
            "Polygon input can only be clipped by polygon, line input can only be clipped by polygon or line, point input can only be clipped by polygon, line, or point",
        })
      );
    }

    const {
      rows: [{ exists: inputTableExists }],
    } = await database.raw(
      "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?)",
      inputTable
    );
    if (!inputTableExists) {
      return next(
        new InvalidPayloadError({
          reason: `Table named ${inputTable} does not exist`,
        })
      );
    }

    const {
      rows: [{ exists: clipTableExists }],
    } = await database.raw(
      "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?)",
      clipTable
    );
    if (!clipTableExists) {
      return next(
        new InvalidPayloadError({
          reason: `Table named ${clipTable} does not exist`,
        })
      );
    }

    const {
      rows: [{ exists: outputLayerExists }],
    } = await database.raw(
      "SELECT EXISTS(SELECT 1 FROM vector_tiles WHERE layer_name = ?)",
      outputTable
    );
    if (outputLayerExists) {
      return next(
        new InvalidPayloadError({
          reason: "Output table already exists in vector_tiles",
        })
      );
    }

    const {
      rows: [{ exists: outputTableExists }],
    } = await database.raw(
      "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?)",
      outputTable
    );
    if (outputTableExists) {
      return next(
        new InvalidPayloadError({
          reason: "Output table name already exists",
        })
      );
    }
  } catch (error) {
    logger.error(error);
    return next(
      new ServiceUnavailableError({
        service: "geoprocessing/clip",
        reason: "Failed to validate input",
      })
    );
  }

  try {
    const messageId = crypto.randomUUID();
    const now = new Date();
    await database
      .insert({
        message_id: messageId,
        queue_name: "default",
        state: "queued",
        mtime: now.toISOString(),
        message: JSON.stringify({
          args: [],
          kwargs: {
            input_table: inputTable,
            clip_table: clipTable,
            output_table: outputTable,
            user_id: accountability.user,
            filter,
          },
          options: {},
          actor_name: "clip",
          message_id: messageId,
          queue_name: "default",
          message_timestamp: now.getTime().toString(),
        }),
        uploader: accountability.user,
      })
      .into("geoprocessing_queue");
    return res.json({ message_id: messageId });
  } catch (error) {
    logger.error(error);
    return next(
      new ServiceUnavailableError({
        service: "geoprocessing/clip",
        reason: "Failed to queue task",
      })
    );
  }
};
