import crypto from "node:crypto";

import {
  InvalidPayloadError,
  ServiceUnavailableError,
  ForbiddenError,
} from "@directus/errors";

import clearCache from "../../utils/clearCache.mjs";

export default (router, { env, database, logger, services }) => {
  router.post("/asset", async (req, res, next) => {
    const { accountability } = req;
    if (!accountability.user) {
      return next(new ForbiddenError());
    }
    const { site_type = "general" } = req.body;
    const allowedSiteType = ["general", "tower"];
    if (!allowedSiteType.includes(site_type)) {
      return next(new InvalidPayloadError({ reason: "site_type not allowed" }));
    }
    try {
      const messageId = crypto.randomUUID();
      const now = new Date();
      const task = "export_asset";
      await database
        .insert({
          message_id: messageId,
          task_name: task,
          queue_name: "default",
          state: "queued",
          mtime: now.toISOString(),
          message: JSON.stringify({
            args: [],
            kwargs: {
              uploader: accountability.user,
              message_id: messageId,
            },
            options: {},
            actor_name: task,
            message_id: messageId,
            queue_name: "default",
            message_timestamp: now.getTime().toString(),
          }),
          uploader: accountability.user,
        })
        .into("geoprocessing_queue");

      await clearCache(logger, env);

      return res.json({
        data: {
          geoprocessing_id: messageId,
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "export-background/asset",
          reason: "Failed to export asset",
        })
      );
    }
  });
};
