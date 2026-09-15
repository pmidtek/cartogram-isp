import crypto from "node:crypto";
import { InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import isValidTableName from "../../utils/isValidTableName.mjs";

export default async (req, res, next, database, logger) => {
  const { accountability } = req;
  const { input_table: inputTable, output_table: outputTable } = req.body;
  if (!Array.isArray(inputTable) || inputTable.length < 2) {
    return next(
      new InvalidPayloadError({
        reason:
          "input_table must be an array of string with minimum length of 2",
      })
    );
  }
  if (new Set(inputTable).size !== inputTable.length) {
    return next(
      new InvalidPayloadError({
        reason: "input_table must not have duplicate value",
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
  for (const table of inputTable) {
    if (typeof table !== "string") {
      return next(
        new InvalidPayloadError({
          reason: `Invalid value "${table}" in input_table. Must be string`,
        })
      );
    }
  }

  try {
    const geomTypes = [];
    for (const table of inputTable) {
      const inputLayer = await database
        .select("geometry_type")
        .from("vector_tiles")
        .where("layer_name", table)
        .first();
      if (!inputLayer) {
        return next(
          new InvalidPayloadError({
            reason: `${table} does not exist in vector_tiles`,
          })
        );
      }
      geomTypes.push(inputLayer.geometry_type);

      const {
        rows: [{ exists: inputTableExists }],
      } = await database.raw(
        "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?)",
        table
      );
      if (!inputTableExists) {
        return next(
          new InvalidPayloadError({
            reason: `Table named ${table} does not exist`,
          })
        );
      }
    }

    // check if input geometry types are identical
    if (!geomTypes.every((el) => el === geomTypes[0])) {
      return next(
        new InvalidPayloadError({
          reason: "Input tables must have identical geometry type",
        })
      );
    }

    // check if input columns have same name, they must have same type
    const { rows: columns } = await database.raw(
      `SELECT table_name,column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name IN (${inputTable
        .map((_) => "?")
        .join(",")})`,
      inputTable
    );
    const colNameTypes = {};
    for (const col of columns) {
      if (
        colNameTypes[col.column_name] &&
        colNameTypes[col.column_name].type !== col.data_type
      ) {
        return next(
          new InvalidPayloadError({
            reason: `One of the merged column has same name but different type: ${
              col.table_name
            }.${col.column_name} is ${col.data_type}, but ${
              colNameTypes[col.column_name].table
            }.${col.column_name} is ${colNameTypes[col.column_name].type}`,
          })
        );
      } else {
        colNameTypes[col.column_name] = {
          table: col.table_name,
          type: col.data_type,
        };
      }
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
        service: "geoprocessing/merge",
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
            output_table: outputTable,
            user_id: accountability.user,
          },
          options: {},
          actor_name: "merge",
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
        service: "geoprocessing/merge",
        reason: "Failed to queue task",
      })
    );
  }
};
