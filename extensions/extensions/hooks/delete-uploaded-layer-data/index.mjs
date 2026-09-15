import {
  LAYER_DATA_FOLDER_ID,
  LAYER_PREVIEWS_FOLDER_ID,
} from "../../migrations/const/FOLDER_IDS.mjs";

export default ({ schedule }, { database, services, getSchema, logger }) => {
  const { FilesService } = services;

  schedule("0 17 * * *", async () => {
    const filesService = new FilesService({
      knex: database,
      schema: await getSchema(),
    });

    try {
      // get file id
      const { rows } = await database.raw(
        `SELECT array_agg(id) arr
        FROM directus_files
        WHERE CURRENT_TIMESTAMP - uploaded_on > '2d'
        AND folder IN (?,?)
        AND id NOT IN (
          SELECT preview
          FROM vector_tiles
          WHERE preview IS NOT NULL
          UNION ALL
          SELECT preview
          FROM raster_tiles
          WHERE preview IS NOT NULL
          UNION ALL
          SELECT preview
          FROM three_d_tiles
          WHERE preview IS NOT NULL
        )`,
        [LAYER_DATA_FOLDER_ID, LAYER_PREVIEWS_FOLDER_ID]
      );

      if (rows[0]?.arr?.length) {
        await filesService.deleteMany(rows[0].arr);
      }
      logger.info("Old and unused layer data cleaned");
    } catch (error) {
      logger.error(error, "Error in scheduled uploaded layer data cleanup");
    }
  });
};
