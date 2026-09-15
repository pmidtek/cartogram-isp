import { InvalidPayloadError, ServiceUnavailableError } from "@directus/errors";
import tokml from "tokml"; // npm install tokml
import archiver from "archiver"; // npm install archiver

export default (router, { logger }) => {
  router.post("/geojson-to-kml", async (req, res, next) => {
    try {
      const body = req.body;

      if (!body) {
        throw new InvalidPayloadError({
          reason: "Request body kosong",
        });
      }

      // Jika body single GeoJSON
      if (!Array.isArray(body)) {
        if (body.type !== "FeatureCollection") {
          throw new InvalidPayloadError({
            reason: "Payload harus GeoJSON FeatureCollection",
          });
        }

        const kmlString = tokml(body);

        res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
        res.setHeader("Content-Disposition", "attachment; filename=output.kml");

        return res.send(kmlString);
      }

      // Jika body array (multi GeoJSON) → zip semua hasil KML
      if (Array.isArray(body)) {
        res.setHeader("Content-Type", "application/zip");
        res.setHeader(
          "Content-Disposition",
          "attachment; filename=geojsons.zip",
        );

        const archive = archiver("zip", { zlib: { level: 9 } });
        archive.on("error", (err) => {
          throw err;
        });
        archive.pipe(res);

        body.forEach((geo, idx) => {
          if (geo.type !== "FeatureCollection") return;

          const kmlString = tokml(geo);
          archive.append(kmlString, {
            name: `output_${idx + 1}.kml`,
          });
        });

        await archive.finalize();
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: `tools/geojson-to-kml`,
          reason: "Failed to convert geojson to kml",
        }),
      );
    }
  });
};
