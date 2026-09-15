import {
  ServiceUnavailableError,
  ForbiddenError,
  InvalidPayloadError,
} from "@directus/errors";
import { Readable } from "stream";
import { isNotEmptyObject } from "../mvt/index.mjs";
import { buildWhere } from "../buffer/index.mjs";

function graphqlToSQLWhere(query) {
  const operatorsMap = {
    _eq: "=",
    _neq: "!=",
    _lt: "<",
    _lte: "<=",
    _gt: ">",
    _gte: ">=",
    _in: "IN",
    _nin: "NOT IN",
    _icontains: "ILIKE",
    _ncontains: "NOT ILIKE",
    _istarts_with: "ILIKE",
    _iends_with: "ILIKE",
    _null: "IS NULL",
    _nnull: "IS NOT NULL",
  };

  function convertNode(node) {
    if (typeof node === "object" && node !== null) {
      const clauses = [];

      for (const field in node) {
        if (Array.isArray(node[field])) {
          // Handle _and and _or conditions
          const subConditions = node[field]
            .map((subNode) => convertNode(subNode))
            .filter(Boolean);
          if (subConditions.length > 0) {
            if (field === "_or") {
              clauses.push(`(${subConditions.join(" OR ")})`);
            } else if (field === "_and") {
              clauses.push(`(${subConditions.join(" AND ")})`);
            }
          }
        } else if (typeof node[field] === "object") {
          // Handle individual field operators
          for (const operator in node[field]) {
            const value = node[field][operator];
            if (operator in operatorsMap) {
              if (operator === "_null" || operator === "_nnull") {
                // IS NULL / IS NOT NULL
                clauses.push(`${field} ${operatorsMap[operator]}`);
              } else if (
                operator === "_icontains" ||
                operator === "_ncontains" ||
                operator === "_istarts_with" ||
                operator === "_iends_with"
              ) {
                // Use value as is for LIKE-based operators, assuming it contains %
                clauses.push(`${field} ${operatorsMap[operator]} '${value}'`);
              } else if (operator === "_in" || operator === "_nin") {
                // IN and NOT IN operators with array values
                const formattedValues = value
                  .map((v) => (typeof v === "string" ? `'${v}'` : v))
                  .join(", ");
                clauses.push(
                  `${field} ${operatorsMap[operator]} (${formattedValues})`
                );
              } else {
                // Other simple operators
                const formattedValue =
                  typeof value === "string" ? `'${value}'` : value;
                clauses.push(
                  `${field} ${operatorsMap[operator]} ${formattedValue}`
                );
              }
            }
          }
        }
      }
      return clauses.length > 0 ? clauses.join(" AND ") : null; // return null if no valid clauses
    }
    return null;
  }

  const whereClause = convertNode(query);
  return whereClause ? `WHERE ${whereClause}` : "";
}

export default (router, { database, logger }) => {
  router.get("/csv/:layerName", async (req, res, next) => {
    const { accountability } = req;
    const { layerName } = req.params;
    const { filter, limit } = req.query;

    try {
      const isCanDownload = await database("directus_users")
        .select("is_can_download")
        .where("id", accountability.user)
        .first();

      if (!isCanDownload.is_can_download) {
        return next(new ForbiddenError());
      } else {
        if (
          !accountability.admin &&
          !accountability.permissions.some(
            (el) => el.collection === layerName && el.action === "read"
          )
        ) {
          return next(new ForbiddenError());
        }

        // Convert the filter to SQL WHERE clause
        let sqlWhereClause = "";
        if (filter) {
          try {
            const filterJSON = JSON.parse(decodeURIComponent(filter));
            sqlWhereClause = graphqlToSQLWhere(filterJSON);
          } catch (error) {
            logger.error(error);
            return next(
              new InvalidQueryError({ reason: "Invalid filter query" })
            );
          }
        }

        const columnsQuery = `SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ?
          ORDER BY ordinal_position;`;
        const columnsResult = await database.raw(columnsQuery, [layerName]);
        const columns = columnsResult.rows.map((col) => col.column_name);
        const hasGeom = columns.includes("geom");

        const selectColumns = columns
          .filter((col) => col !== "geom") // Exclude geom to add at the end
          .map((col) => `"${col}"`)
          .concat(hasGeom ? ["ST_AsGeoJSON(geom) AS geom"] : [])
          .join(", ");

        // Construct the SQL query
        let query = `SELECT ${selectColumns} FROM ${layerName} ${sqlWhereClause}`;
        if (limit && limit != -1) {
          query += ` LIMIT ${parseInt(limit, 10)}`;
        }

        // Execute the query
        const { rows } = await database.raw(query);

        if (!rows.length) {
          throw new Error("No data available");
        }

        // Stream CSV response
        const csvStream = new Readable({
          read() {},
        });
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${layerName}.csv"`
        );
        res.setHeader("Content-Type", "text/csv");

        // Write headers
        const headers = Object.keys(rows[0]).map((header) => `"${header}"`);
        csvStream.push(headers.join(",") + "\n");

        // Write rows
        for (const row of rows) {
          const values = headers.map((header) => {
            const value = row[header.replace(/"/g, "")];
            return header === '"geom"'
              ? `"${value.replace(/"/g, '""')}"`
              : value;
          });
          csvStream.push(values.join(",") + "\n");
        }

        csvStream.push(null); // End the stream
        csvStream.pipe(res); // Pipe the stream to the response
      }
    } catch (error) {
      logger.error("Download failed:", error);
      return next(
        new ServiceUnavailableError({
          service: "download-csv",
          reason: "Failed to download the data",
        })
      );
    }
  });

  router.post("/area/csv", async (req, res, next) => {
    const { accountability } = req;
    const { area } = req.body;
    const layerName = "sp_data_footprint";

    try {
      const isCanDownload = await database("directus_users")
        .select("is_can_download")
        .where("id", accountability.user)
        .first();

      if (!isCanDownload.is_can_download) {
        return next(new ForbiddenError());
      } else {
        if (
          !accountability.admin &&
          !accountability.permissions.some(
            (el) => el.collection === layerName && el.action === "read"
          )
        ) {
          return next(new ForbiddenError());
        }

        // Spatial query with GeoJSON
        const query = `
          WITH polygon_area AS (
            SELECT ST_GeomFromGeoJSON('${JSON.stringify(area)}') AS geom
          )
          SELECT ogc_fid,id,id_prov,id_kabkot,id_kec,id_desa,id_rw,id_rt,
            prov_name,kab_name,kec_name,desa_name,rw,rt,poi_name,hs_npoi,
            type,volt_ty,voltage,prntkn,st_name,class_func,lane_count,divider,
            ar_auto,ar_motor,paved,private_rd,multidigit,znt_class,znt_range,
            hs_size,class,hs_price,hs_pz_rng,carport,hs_class,hs_pz_scr,hs_sz_scr,
            cp_scr,cl_scr,total_scr,grade,table_name,ST_AsGeoJSON(main.geom) as geom
          FROM sp_data_footprint main, polygon_area
          WHERE main.geom && polygon_area.geom
          AND ST_Intersects(main.geom, polygon_area.geom);
        `;

        const { rows } = await database.raw(query);

        if (!rows.length) {
          return res.status(404).send("No data found for the specified area.");
        }

        const csvStream = new Readable({ read() {} });
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${layerName}_area.csv"`
        );
        res.setHeader("Content-Type", "text/csv");

        const headers = Object.keys(rows[0]).map((header) => `"${header}"`);
        csvStream.push(headers.join(",") + "\n");

        for (const row of rows) {
          const values = headers.map((header) => {
            const value = row[header.replace(/"/g, "")];
            return header === '"geom"'
              ? `"${value.replace(/"/g, '""')}"`
              : value;
          });
          csvStream.push(values.join(",") + "\n");
        }

        csvStream.push(null);
        csvStream.pipe(res);
      }
    } catch (error) {
      logger.error("Download failed:", error);
      return next(
        new ServiceUnavailableError({
          service: "download-csv",
          reason: "Failed to download the data",
        })
      );
    }
  });

  router.post("/layer/csv", async (req, res, next) => {
    const { accountability } = req;
    if (!req.accountability.user) {
      return next(new ForbiddenError());
    }
    const { layer, layer_target, ogcFids, invert } = req.body;

    try {
      const isCanDownload = await database("directus_users")
        .select("is_can_download")
        .where("id", accountability.user)
        .first();

      if (!isCanDownload.is_can_download) {
        return next(new ForbiddenError());
      } else {
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
              reason:
                "Body layer data is invalid; layer variable can not null!",
            })
          );
        } else {
          try {
            const {
              rows: [{ exists: layer_exists }],
            } = await database.raw(
              "SELECT COUNT(*) = 1 AS exists FROM vector_tiles WHERE layer_name = ?;",
              [layer]
            );
            const {
              rows: [{ exists: layer_target_exists }],
            } = await database.raw(
              "SELECT COUNT(*) = 1 AS exists FROM vector_tiles WHERE layer_name = ?;",
              [layer_target]
            );

            if (!layer_exists) {
              if (!["sp_data_footprint"].includes(layer)) {
                return next(
                  new InvalidPayloadError({
                    reason:
                      "Body layer data is invalid; layer variable must be a layer from vector tiles collection!",
                  })
                );
              }
            }
            if (!layer_target_exists) {
              if (!["sp_data_footprint"].includes(layer_target)) {
                return next(
                  new InvalidPayloadError({
                    reason:
                      "Body layer_target data is invalid; layer_target variable must be a layer from vector tiles collection!",
                  })
                );
              }
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

        const columnsQuery = `SELECT column_name
          FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = ?
          ORDER BY ordinal_position;`;
        const columnsResult = await database.raw(columnsQuery, [
          layer_name_target,
        ]);
        const columns = columnsResult.rows.map((col) => col.column_name);
        const hasGeom = columns.includes("geom");

        const selectColumns = columns
          .filter((col) => col !== "geom") // Exclude geom to add at the end
          .concat(hasGeom ? ["ST_AsGeoJSON(main.geom) AS geom"] : [])
          .join(", ");

        let query;
        query = `WITH polygon_area AS (
          SELECT ST_Union(geom) as geom from ${layer_name} main
          ${buildWhere(rest)}
          ${ogcFidsFilter}
        )
        SELECT ${selectColumns}
        FROM ${layer_name_target} main, polygon_area
        ${filterQuery}
        ${buildWhere(rest_target, "AND")} ;`;

        // Execute the query
        const { rows } = await database.raw(query);

        if (!rows.length) {
          throw new Error("No data available");
        }

        // Stream CSV response
        const csvStream = new Readable({
          read() {},
        });
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${layer_name_target}.csv"`
        );
        res.setHeader("Content-Type", "text/csv");

        // Write headers
        const headers = Object.keys(rows[0]).map((header) => `"${header}"`);
        csvStream.push(headers.join(",") + "\n");

        // Write rows
        for (const row of rows) {
          const values = headers.map((header) => {
            const value = row[header.replace(/"/g, "")];
            return header === '"geom"'
              ? `"${value.replace(/"/g, '""')}"`
              : value;
          });
          csvStream.push(values.join(",") + "\n");
        }

        csvStream.push(null); // End the stream
        csvStream.pipe(res); // Pipe the stream to the response
      }
    } catch (error) {
      logger.error("Download failed:", error);
      return next(
        new ServiceUnavailableError({
          service: "download-csv",
          reason: "Failed to download the data",
        })
      );
    }
  });
};
