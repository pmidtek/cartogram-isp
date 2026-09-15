import crypto from "node:crypto";
import { InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import isValidTableName from "../../utils/isValidTableName.mjs";

export default async (router, { database, logger }) => {
	router.post("/", async (req, res, next) => {
		const { accountability } = req;
		const {
			startpoint,
			endpoint,
			tablename,
			fiber_attenuation_db_per_km,
			splice_loss_db,
			splice_every_km,
			connector_loss_db,
			connectors_entry,
			connectors_exit,
			fixed_loss_db,
			splitter_level1_loss_db,
			splitter_level1_count,
			splitter_level2_loss_db,
			splitter_level2_count,
			splitter_level3_loss_db,
			splitter_level3_count,
		} = req.body;

		// ✅ Required field validation
		if (!startpoint || !endpoint || !tablename) {
			return next(
				new InvalidPayloadError({
					reason: "Missing required fields: startpoint, endpoint, and tablename are required.",
				})
			);
		}

		// ✅ Optional: Table name format check
		if (!isValidTableName(tablename)) {
			return next(
				new InvalidPayloadError({
					reason: `Invalid table name: "${tablename}"`,
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
							startpoint,
							endpoint,
							tablename,
							fiber_attenuation_db_per_km,
							splice_loss_db,
							splice_every_km,
							connector_loss_db,
							connectors_entry,
							connectors_exit,
							fixed_loss_db,
							splitter_level1_loss_db,
							splitter_level1_count,
							splitter_level2_loss_db,
							splitter_level2_count,
							splitter_level3_loss_db,
							splitter_level3_count,
						},
						options: {},
						actor_name: "ftth",
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
					service: "geoprocessing/intersect",
					reason: "Failed to queue task",
				})
			);
		}
	});
};
