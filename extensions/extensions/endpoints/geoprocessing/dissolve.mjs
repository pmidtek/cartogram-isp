import crypto from "node:crypto";
import { InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import isValidTableName from "../../utils/isValidTableName.mjs";

export default async (req, res, next, database, logger) => {
  const { accountability } = req;
  const {
    input_table: inputTable,
    fields,
    output_table: outputTable,
    filter = null,
  } = req.body;

  if (!inputTable) {
    return next(new InvalidPayloadError({ reason: "input_table is required" }));
  }
  if (!Array.isArray(fields) || !fields.length) {
    return next(
      new InvalidPayloadError({ reason: "fields must be an array of string" })
    );
  }
  if (!outputTable) {
    return next(
      new InvalidPayloadError({ reason: "output_table is required" })
    );
  }
  for (const field of fields) {
    if (typeof field !== "string") {
      return next(
        new InvalidPayloadError({
          reason: `Invalid value "${field}" in fields. Must be string`,
        })
      );
    } else if (["ogc_fid", "geom"].includes(field)) {
      return next(
        new InvalidPayloadError({
          reason: "Dissolve field must not include ogc_fid nor geom",
        })
      );
    }
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
    if (!["POLYGON", "MULTIPOLYGON"].includes(inputLayer.geometry_type)) {
      return next(
        new InvalidPayloadError({
          reason: "Input table must be Polygon or MultiPolygon",
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

    const columns = await database
      .withSchema("information_schema")
      .select("column_name")
      .from("columns")
      .where({ table_schema: "public", table_name: inputTable })
      .whereIn("column_name", fields);
    const columnNames = columns.map((el) => el.column_name);
    for (const field of fields) {
      if (!columnNames.includes(field)) {
        return next(
          new InvalidPayloadError({
            reason: `Field "${field}" does not exist in table "${inputTable}"`,
          })
        );
      }
    }
  } catch (error) {
    logger.error(error);
    return next(
      new ServiceUnavailableError({
        service: "geoprocessing/dissolve",
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
            fields: fields,
            output_table: outputTable,
            user_id: accountability.user,
            filter,
          },
          options: {},
          actor_name: "dissolve",
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
        service: "geoprocessing/dissolve",
        reason: "Failed to queue task",
      })
    );
  }
};
