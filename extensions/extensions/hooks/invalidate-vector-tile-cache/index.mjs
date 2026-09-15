export default ({ schedule }, { database, logger }) => {
  schedule("*/30 * * * *", async () => {
    try {
      // Directly delete expired items from the vector_tile_cache table
      await database("vector_tile_cache")
        .where("expired_at", "<", new Date())
        .delete();
      logger.info("Expired vector tile cache cleaned");
    } catch (error) {
      logger.error(error, "Error in scheduled cache cleanup");
    }
  });
};
