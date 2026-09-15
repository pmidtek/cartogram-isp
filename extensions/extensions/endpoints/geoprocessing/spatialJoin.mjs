import crypto from "node:crypto";
import { InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import isValidTableName from "../../utils/isValidTableName.mjs";

export default async (req, res, next, database, logger) => {
  const { accountability } = req;
  const {
    target_table: targetTable,
    join_table: joinTable,
    output_table: outputTable,
    filter = null,
  } = req.body;

  if (!targetTable) {
    return next(
      new InvalidPayloadError({ reason: "target_table is required" })
    );
  }
  if (!joinTable) {
    return next(new InvalidPayloadError({ reason: "join_table is required" }));
  }
  if (targetTable === joinTable) {
    return next(
      new InvalidPayloadError({
        reason: "join_table must be different than target_table",
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
      rows: [{ exists: joinLayerExists }],
    } = await database.raw(
      "SELECT EXISTS(SELECT 1 FROM vector_tiles WHERE layer_name = ?)",
      joinTable
    );
    if (!joinLayerExists) {
      return next(
        new InvalidPayloadError({
          reason: "Join table does not exist in vector_tiles",
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
      rows: [{ exists: joinTableExists }],
    } = await database.raw(
      "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ?)",
      joinTable
    );
    if (!joinTableExists) {
      return next(
        new InvalidPayloadError({
          reason: `Table named ${joinTable} does not exist`,
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
            target_table: targetTable,
            join_table: joinTable,
            output_table: outputTable,
            user_id: accountability.user,
            filter,
          },
          options: {},
          actor_name: "spatial_join",
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
        service: "geoprocessing/spatial-join",
        reason: "Failed to queue task",
      })
    );
  }
};
