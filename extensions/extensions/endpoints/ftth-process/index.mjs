import crypto from "node:crypto";
import {
  InvalidPayloadError,
  ServiceUnavailableError,
  ForbiddenError,
} from "@directus/errors";

export default (router, { database, logger, services }) => {
  const { ItemsService } = services;
  router.post("/area-analysis", async (req, res, next) => {
    try {
      if (!req.accountability.user) {
        return next(new ForbiddenError());
      }
      const { geometry } = req.body;
      if (!geometry) {
        return next(
          new InvalidPayloadError({
            reason: "geometry is required",
          })
        );
      }

      const { rows } = await database.raw(
        `WITH area AS (
            SELECT ST_SetSRID(ST_GeomFromGeoJSON(?), 4326) AS geom
        ) SELECT COUNT(DISTINCT f.ogc_fid)::int AS total_home
            FROM sp_data_footprint f
            CROSS JOIN area
            WHERE f.geom && area.geom AND ST_Intersects(f.geom, area.geom);`,
        [JSON.stringify(geometry)]
      );

      const totalHome = rows[0].total_home;

      const RUMAH_PER_ODC = 32;
      const rawOdc = totalHome / RUMAH_PER_ODC;
      const totalOdc = Math.ceil(rawOdc);

      const MAX_ODC_PER_LINE = 288;
      const totalLine = Math.ceil(totalOdc / MAX_ODC_PER_LINE);

      const results = [];
      let remainingOdc = totalOdc;
      for (let i = 1; i <= totalLine; i++) {
        const odcInLine = Math.min(remainingOdc, MAX_ODC_PER_LINE);
        let cable;
        if (odcInLine <= 24) cable = "24 core";
        else if (odcInLine <= 48) cable = "48 core";
        else if (odcInLine <= 96) cable = "96 core";
        else if (odcInLine <= 144) cable = "144 core";
        else cable = "288 core";
        results.push({
          line: i,
          odc: odcInLine,
          cable,
        });
        remainingOdc -= odcInLine;
      }
      //   const { rows: footprint } = await database.raw(
      //     `WITH area AS (
      //         SELECT ST_SetSRID(ST_GeomFromGeoJSON(?), 4326) AS geom
      //     ) SELECT jsonb_build_object(
      //         'type', 'FeatureCollection',
      //         'features', COALESCE(
      //         jsonb_agg(
      //             jsonb_build_object(
      //                 'type', 'Feature',
      //                 'geometry', ST_AsGeoJSON(f.geom)::jsonb,
      //                 'properties', jsonb_build_object(
      //                 'ogc_fid', f.ogc_fid
      //         ))), '[]'::jsonb) ) AS footprint_geojson
      //     FROM sp_data_footprint f
      //     CROSS JOIN area
      //     WHERE f.geom && area.geom AND ST_Intersects(f.geom, area.geom);`,
      //     [JSON.stringify(geometry)]
      //   );

      return res.json({
        data: {
          total_rumah: totalHome,
          total_odc: totalOdc,
          total_lines: totalLine,
          lines: results,
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "ftth-process/area-analysis",
          reason: "Failed to area analysis",
        })
      );
    }
  });
  router.post("/generate-network", async (req, res, next) => {
    const { accountability } = req;
    if (!accountability.user) {
      return next(new ForbiddenError());
    }

    const {
      name,
      description,
      geometry,
      olt_mode = "site",
      tower_ids = [],
      coordinates = [],
    } = req.body;
    if (!geometry) {
      return next(
        new InvalidPayloadError({
          reason: "geometry is required",
        })
      );
    }
    const allowedOltMode = ["site", "tower", "input"];
    if (!allowedOltMode.includes(olt_mode)) {
      return next(
        new InvalidPayloadError({
          reason: "olt_mode not allowed",
        })
      );
    }

    if (olt_mode === "tower") {
      if (!Array.isArray(tower_ids) || tower_ids.length === 0) {
        return next(
          new InvalidPayloadError({
            reason: "tower_ids is required when olt_mode='tower'",
          })
        );
      }
      if (
        !tower_ids.every(
          (id) =>
            Number.isInteger(id) || (typeof id === "string" && /^\d+$/.test(id))
        )
      ) {
        return next(
          new InvalidPayloadError({
            reason: "tower_ids must be an array of integers",
          })
        );
      }
    }
    if (olt_mode === "input") {
      if (!Array.isArray(coordinates) || coordinates.length === 0) {
        return next(
          new InvalidPayloadError({
            reason: "coordinates is required when olt_mode='input'",
          })
        );
      }

      const isValidCoordinate = (coord) =>
        Array.isArray(coord) &&
        coord.length === 2 &&
        typeof coord[0] === "number" &&
        typeof coord[1] === "number" &&
        coord[0] >= -180 &&
        coord[0] <= 180 &&
        coord[1] >= -90 &&
        coord[1] <= 90;

      if (!coordinates.every(isValidCoordinate)) {
        return next(
          new InvalidPayloadError({
            reason: "coordinates must be [[longitude, latitude], ...]",
          })
        );
      }
    }

    try {
      if (olt_mode == "tower" || olt_mode == "input") {
        const { rows } = await database.raw(
          `WITH area AS (
            SELECT ST_SetSRID(ST_GeomFromGeoJSON(?), 4326) AS geom
        ) SELECT COUNT(DISTINCT f.ogc_fid)::int AS total_home
            FROM sp_data_footprint f
            CROSS JOIN area
            WHERE f.geom && area.geom AND ST_Intersects(f.geom, area.geom);`,
          [JSON.stringify(geometry)]
        );
        const totalHome = rows[0].total_home ?? 0;
        const RUMAH_PER_ODC = 32;
        const MAX_ODC_PER_LINE = 288;
        const BUFFER_THRESHOLD = 0.9;

        const totalOdc = Math.ceil(totalHome / RUMAH_PER_ODC);
        let requiredLine = Math.ceil(totalOdc / MAX_ODC_PER_LINE);
        if (requiredLine > 0) {
          const odcLastLine = totalOdc % MAX_ODC_PER_LINE || MAX_ODC_PER_LINE;
          const utilization = odcLastLine / MAX_ODC_PER_LINE;
          if (utilization >= BUFFER_THRESHOLD) {
            requiredLine += 1;
          }
        }

        if (olt_mode === "tower" && tower_ids.length < requiredLine) {
          return next(
            new InvalidPayloadError({
              reason: `tower_ids must contain at least ${requiredLine} item(s)`,
            })
          );
        }

        if (olt_mode === "input" && coordinates.length < requiredLine) {
          return next(
            new InvalidPayloadError({
              reason: `coordinates must contain at least ${requiredLine} item(s)`,
            })
          );
        }
      }

      const { rows: cityResults } = await database.raw(
        `SELECT ogc_fid, ST_Area(ST_Intersection(geom, input_geom)::geography) AS intersect_area
          FROM area_cities,
          LATERAL (SELECT ST_SetSRID(ST_GeomFromGeoJSON(?), 4326) AS input_geom) AS g
          WHERE ST_Intersects(geom, input_geom)
          ORDER BY intersect_area DESC
          LIMIT 1;`,
        [JSON.stringify(geometry)]
      );
      const area_city_id = cityResults[0];
      if (!area_city_id) {
        return next(
          new InvalidPayloadError({
            reason: "area_city_id not found",
          })
        );
      }

      function removeZFromCoordinates(coords) {
        if (typeof coords[0] === "number") {
          return coords.slice(0, 2);
        }
        return coords.map(removeZFromCoordinates);
      }
      function force2DGeoJSON(geometry) {
        return {
          ...geometry,
          coordinates: removeZFromCoordinates(geometry.coordinates),
        };
      }
      const geometry2D = force2DGeoJSON(geometry);

      const projectService = new ItemsService("project_map", {
        accountability,
        schema: req.schema,
        knex: database,
      });

      const projectId = await projectService.createOne({
        name: name,
        description: description,
        geom: geometry2D,
        area_city_id: area_city_id,
      });

      if (!projectId) {
        return next(
          new ServiceUnavailableError({
            reason: "failed to create project",
          })
        );
      }

      const messageId = crypto.randomUUID();
      const now = new Date();
      const task = "generate_network";
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
              project_id: projectId,
              uploader: accountability.user,
              message_id: messageId,
              olt_mode: olt_mode,
              tower_ids: tower_ids,
              coordinates: coordinates,
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

      return res.json({
        data: {
          project_id: projectId,
          geoprocessing_id: messageId,
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "ftth-process/generate-network",
          reason: "Failed to generate network",
        })
      );
    }
  });
};
