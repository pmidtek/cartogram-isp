import crypto from "node:crypto";
import { Readable } from "stream";
import csvParser from "csv-parser";
import { InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import isValidTableName from "../../utils/isValidTableName.mjs";


/**
 * Utility to parse a CSV buffer into a JS object
 */
function parseCSV(buffer) {
  return new Promise((resolve, reject) => {
    const results = [];
    const stream = Readable.from(buffer.toString()).pipe(csvParser());

    stream.on("data", (row) => results.push(row));
    stream.on("end", () => resolve(results));
    stream.on("error", reject);
  });
}

export default async (req, res, next, database, logger) => {
  const { accountability } = req;
  const {
      target_table: targetTable,
      id_target: targetId,
      id_join: joinId,
      output_table: outputTable,
      filter = null,
    } = req.body;

    logger.info("all the params: "+ targetId + targetTable + joinId + outputTable);

  // File from multipart form
  const joinFile = req.files?.join_table?.[0];

   if (!joinFile) {
      throw new InvalidPayloadError("Join file is required.");
    }

    const joinRows = await parseCSV(joinFile.buffer);
    logger.info(`Parsed ${joinRows.length} rows from uploaded join file.`);

    // Validate table names (optional security)
    if (!isValidTableName(targetTable) || !isValidTableName(outputTable)) {
      throw new InvalidPayloadError("Invalid table name.");
    }

  if (!targetTable) {
    return next(
      new InvalidPayloadError({ reason: "target_table is required" })
    );
  }

  if (!joinId) {
    return next(
      new InvalidPayloadError({ reason: "join_id is required" })
    );
  }
  if (!targetId) {
    return next(new InvalidPayloadError({ reason: "target_id is required" }));
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
    const {
      rows: [{ exists: targetLayerExists }],
    } = await database.raw(
      "SELECT EXISTS(SELECT 1 FROM vector_tiles WHERE layer_name = ?)",
      targetTable
    );
    if (!targetLayerExists) {
      return next(
        new InvalidPayloadError({
          reason: "Target table does not exist in vector_tiles",
        })
      );
    }

    const {
      rows: [{ exists: targetTableExists }],
    } = await database.raw(
      "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?)",
      targetTable
    );
    if (!targetTableExists) {
      return next(
        new InvalidPayloadError({
          reason: `Table named ${targetTable} does not exist`,
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
        service: "geoprocessing/spatial-join",
        reason: "Failed to validate input",
      })
    );
  }

    const tempJoinTable = `tmp_join_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    logger.error(`Temp join table has been created`);
     try {
    await database.schema.dropTableIfExists(tempJoinTable);

    const sampleRow = joinRows[0];
    await database.schema.createTable(tempJoinTable, (table) => {
      Object.entries(sampleRow).forEach(([col, value]) => {
        if (!col.match(/^[a-zA-Z_][a-zA-Z0-9_]*$/)) {
          logger.error(`Invalid CSV header: ${col}`);
          throw new InvalidPayloadError(`Invalid column name in CSV: ${col}`);
        }
        const isNumber = !isNaN(parseFloat(value)) && isFinite(value);
        table[isNumber ? 'float' : 'text'](col);
      });
    });

    await database.batchInsert(tempJoinTable, joinRows, 100);

    logger.info(`Temporary join table ${tempJoinTable} created.`);

  } catch (error) {
    logger.error("Failed to create temp table:"+ error);
    return next(
      new ServiceUnavailableError({
        service: "geoprocessing/table-join",
        reason: "Failed to prepare join table",
      })
    );
  }

  try {
    logger.info("the request has been added into the worker")

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
            target_table: targetTable,
            join_table: tempJoinTable,
            target_id: targetId,
            join_id: joinId,
            output_table: outputTable,
            user_id: accountability.user,
            filter,
          },
          options: {},
          actor_name: "table_join",
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
        service: "geoprocessing/table-join",
        reason: "Failed to queue task",
      })
    );
  }

}