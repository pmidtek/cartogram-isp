import {
  InvalidPayloadError,
  ServiceUnavailableError,
  ForbiddenError,
} from "@directus/errors";

import { isNotEmptyObject } from "../mvt/index.mjs";

export function buildWhere(rest, prefix = "WHERE") {
  return isNotEmptyObject(rest)
    ? `${prefix} ` +
        Object.keys(rest)
          .map((key) => `main.${key} = '${rest[key]}'`)
          .join(" AND ")
    : "";
}

export default (router, { database, logger }) => {
  router.patch("/", async (req, res, next) => {
    const { accountability } = req;
    const { points, radius, layer, type, column } = req.body;

    if (!layer) {
      return next(new InvalidPayloadError({ reason: "layer is required" }));
    }

    try {
      const {
        rows: [{ exists }],
      } = await database.raw(
        "SELECT EXISTS(SELECT 1 FROM vector_tiles WHERE layer_name = ?)",
        layer
      );
      if (!exists) {
        return next(new ForbiddenError());
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "buffer-analysis",
          reason: "Failed to apply buffer analysis",
        })
      );
    }

    if (
      !accountability.admin &&
      !accountability.permissions.some(
        (el) => el.collection === layer && el.action === "read"
      )
    ) {
      return next(new ForbiddenError());
    }

    if (!Array.isArray(points)) {
      return next(
        new InvalidPayloadError({
          reason: "points must be array of [lon,lat]",
        })
      );
    }

    if (typeof radius !== "number" || !isFinite(radius) || radius < 0) {
      return next(
        new InvalidPayloadError({ reason: "radius must be positive number" })
      );
    }

    // Construct the array part of the SQL for points
    let p = 0;
    const pointBindings = {};
    const makePointQueries = [];
    for (const point of points) {
      if (!Array.isArray(point) || point.length !== 2) {
        return next(
          new InvalidPayloadError({
            reason: "points must be array of [lon,lat]",
          })
        );
      }
      const bindingName0 = `point${p++}`;
      const bindingName1 = `point${p++}`;
      pointBindings[bindingName0] = point[0];
      pointBindings[bindingName1] = point[1];
      makePointQueries.push(`ST_MakePoint(:${bindingName0},:${bindingName1})`);
    }

    const baseSQL = `
        WITH buffer AS (
            SELECT ST_Buffer(ST_SetSRID(ST_Collect(ARRAY[${makePointQueries.join(
              ","
            )}]), 4326)::geography, :radius)::geometry AS geom
        )
    `;

    // Build the SQL
    let sql;
    if (type === "simple") {
      sql = `${baseSQL}
               SELECT 'All' as category, COUNT(*) FROM :layer:, buffer
               WHERE ST_Intersects(:layer:.geom, buffer.geom);
        `;
    } else if (type === "categorical") {
      if (!column) {
        return next(new InvalidPayloadError({ reason: "column is required" }));
      } else if (!req.schema.collections[layer]?.fields[column]) {
        return next(new ForbiddenError());
      }
      sql = `${baseSQL}
               SELECT :column: as category, COUNT(*) FROM :layer:, buffer
               WHERE ST_Intersects(:layer:.geom, buffer.geom)
               GROUP BY :column:;
        `;
    } else {
      return next(
        new InvalidPayloadError({
          reason: 'type must be "simple" or "categorical"',
        })
      );
    }

    try {
      const { rows } = await database.raw(sql, {
        ...pointBindings,
        radius,
        layer,
        column,
      });
      return res.json(rows);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "buffer-analysis",
          reason: "Failed to apply buffer analysis",
        })
      );
    }
  });

  router.post("/layer", async (req, res, next) => {
    if (!req.accountability.user) {
      return next(new ForbiddenError());
    }
    const { layer, layer_target, ogcFids, type, column, invert } = req.body;

    let colsQuery;
    if (ogcFids && !Array.isArray(ogcFids)) {
      return next(
        new InvalidPayloadError({
          reason: "ogcFids must be an array!",
        })
      );
    }

    let filterQuery;
    if (invert && invert == true) {
      filterQuery = `WHERE NOT (main.geom && polygon_area.geom
              AND ST_Intersects(main.geom, polygon_area.geom)) `;
    } else {
      filterQuery = `WHERE main.geom && polygon_area.geom
              AND ST_Intersects(main.geom, polygon_area.geom) `;
    }

    if (!layer || !layer_target) {
      return next(
        new InvalidPayloadError({
          reason: "Body layer data is invalid; layer variable can not null!",
        })
      );
    } else {
      try {
        const {
          rows: [{ exists }],
        } = await database.raw(
          "SELECT COUNT(*) = 2 AS exists FROM vector_tiles WHERE layer_name IN (?,?);",
          [layer, layer_target]
        );

        if (!exists) {
          return next(
            new InvalidPayloadError({
              reason:
                "Body layer data is invalid; layer variable must be a layer from vector tiles collection!",
            })
          );
        }
      } catch (error) {
        logger.error(error);
        return next(
          new InvalidPayloadError({
            reason: "Body layer data is invalid!",
          })
        );
      }
    }

    let rest = {};
    let [layer_name, queryString] = layer.split("?");
    if (queryString) {
      queryString.split("&").forEach((pair) => {
        let [key, value] = pair.split("=");
        rest[key] = value;
      });
    }
    // Determine the prefix based on whether 'rest' is empty,
    const prefix = isNotEmptyObject(rest) ? "AND" : "WHERE";

    // Convert ogcFids to SQL filter if it's a valid non-empty array
    let ogcFidsFilter = "";
    if (ogcFids && ogcFids.length > 0) {
      const sanitizedIds = ogcFids
        .map((id) => parseInt(id, 10))
        .filter((id) => !isNaN(id));

      if (sanitizedIds.length > 0) {
        ogcFidsFilter = `${prefix} ogc_fid IN (${sanitizedIds.join(", ")})`;
      }
    }

    let rest_target = {};
    let [layer_name_target, queryString_target] = layer_target.split("?");
    if (queryString_target) {
      queryString_target.split("&").forEach((pair) => {
        let [key, value] = pair.split("=");
        rest_target[key] = value;
      });
    }

    let query;
    if (type === "simple") {
      query = `WITH polygon_area AS (
                SELECT ST_Union(geom) as geom from ${layer_name} main
                ${buildWhere(rest)}
                ${ogcFidsFilter}
              )
              SELECT 'All' as category, count(*) AS count
              FROM ${layer_name_target} main, polygon_area
              ${filterQuery}
              ${buildWhere(rest_target, "AND")}
              GROUP BY 1
              ORDER BY 2 DESC ;`;
    } else if (type === "categorical") {
      if (!column) {
        return next(new InvalidPayloadError({ reason: "column is required" }));
      } else if (!req.schema.collections[layer_name_target]?.fields[column]) {
        return next(new ForbiddenError());
      }
      query = `WITH polygon_area AS (
        SELECT ST_Union(geom) as geom from ${layer_name} main
        ${buildWhere(rest)}
        ${ogcFidsFilter}
      )
      SELECT ${column} as category, count(*) AS count
      FROM ${layer_name_target} main, polygon_area
      ${filterQuery}
      ${buildWhere(rest_target, "AND")}
      GROUP BY 1
      ORDER BY 2 DESC ;`;
    } else {
      return next(
        new InvalidPayloadError({
          reason: 'type must be "simple" or "categorical"',
        })
      );
    }

    try {
      const { rows } = await database.raw(query);
      return res.json(rows);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "chart-analysis",
          reason: "Failed to get chart",
        })
      );
    }
  });
};
