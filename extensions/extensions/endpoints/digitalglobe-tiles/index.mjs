import https from "https";
import { pipeline } from "node:stream/promises";

import { InvalidQueryError, ServiceUnavailableError } from "@directus/errors";

const digitalGlobeReq = (path, auth) => {
  return new Promise((resolve, reject) => {
    https
      .request(
        {
          method: "GET",
          path,
          host: "securewatch.digitalglobe.com",
          headers: { Authorization: `Basic ${auth}` },
        },
        (res) => {
          resolve(res);
        }
      )
      .on("error", (error) => {
        reject(error);
      })
      .end();
  });
};

export default (router, { database, logger }) => {
  router.get("/", async (req, res, next) => {
    let { z, x, y } = req.query;
    const { cql_filter: cqlFilter } = req.query;

    const maxarCred = await database
      .select("securewatch_maxar_username", "securewatch_maxar_password")
      .from("directus_settings")
      .first();

    if (
      !maxarCred.securewatch_maxar_username ||
      !maxarCred.securewatch_maxar_password
    ) {
      return next(
        new ServiceUnavailableError({
          service: "digitalglobe-tiles",
          reason: "Auth not set",
        })
      );
    }

    const auth = Buffer.from(
      `${maxarCred.securewatch_maxar_username}:${maxarCred.securewatch_maxar_password}`
    ).toString("base64");

    z = parseInt(z);
    x = parseInt(x);
    y = parseInt(y);

    if (isNaN(z) || isNaN(x) || isNaN(y) || z < 0 || x < 0 || y < 0) {
      return next(new InvalidQueryError({ reason: "Invalid z, x, y" }));
    }

    const path = `/earthservice/wmtsaccess?CONNECTID=56a0714a-69b6-4bae-9087-46aeba921ca1&SERVICE=WMTS&VERSION=1.0.0&REQUEST=GetTile&TileMatrixSet=EPSG:3857&LAYER=DigitalGlobe:ImageryTileService&FORMAT=image/jpeg&TileMatrix=EPSG:3857:${z}&TILEROW=${y}&TILECOL=${x}&FEATUREPROFILE=Global_Currency_Profile${
      cqlFilter ? "&CQL_FILTER=" + cqlFilter : ""
    }`;

    let digitalGlobeRes;
    try {
      digitalGlobeRes = await digitalGlobeReq(path, auth);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "digitalglobe-tiles",
          reason: "Failed to connect to DigitalGlobe",
        })
      );
    }
    try {
      await pipeline(digitalGlobeRes, res);
    } catch (error) {
      logger.error(error);
    }
  });
};
