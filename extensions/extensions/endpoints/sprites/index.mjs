import minioClient from "../../utils/minioClient.mjs";

export default (router, { env, logger }) => {
  router.get("/:assetName", async (req, res, next) => {
    const { assetName } = req.params; // 'assetName' could be 'sprite.json' or 'sprite.png'

    try {
      // Use your MinIO client instance to fetch the asset from S3
      const stream = await minioClient.getObject(
        env.STORAGE_S3_BUCKET,
        (env.STORAGE_S3_ROOT ? env.STORAGE_S3_ROOT + "/" : "") +
          `sprites/${assetName}`
      );

      // Set appropriate content type
      if (assetName.endsWith(".json")) {
        res.type("application/json");
      } else if (assetName.endsWith(".png")) {
        res.type("image/png");
      }

      // Pipe the S3 object stream to the response
      stream.pipe(res);
    } catch (error) {
      console.error("Error serving sprite asset:", error);
      res.status(500).send("Error serving sprite asset");
    }
  });
};
