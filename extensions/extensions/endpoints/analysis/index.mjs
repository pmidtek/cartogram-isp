import {
  createError,
  InvalidPayloadError,
  ServiceUnavailableError,
  ForbiddenError,
} from "@directus/errors";
import { Readable } from "stream";

import * as turf from "@turf/turf";
import tokml from "tokml";

import crypto from "node:crypto";
import minioClient from "../../utils/minioClient.mjs";
import { ANALYSIS_FOLDER_ID } from "../../migrations/const/FOLDER_IDS.mjs";
import {
  storageRoot,
  storageLocation,
  storageBucket,
} from "../../utils/storageInfo.mjs";

const DataNotFoundError = createError(
  "DATA_NOT_FOUND",
  (ext) => `Data not found`,
  404
);

function analysisCode(base_code, date = new Date()) {
  const pad = (n, size = 2) => String(n).padStart(size, "0");

  const dd = pad(date.getDate());
  const mm = pad(date.getMonth() + 1);
  const yy = String(date.getFullYear()).slice(-2);
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  const ss = pad(date.getSeconds());

  const data = dd + mm + yy + hh + min + ss;
  const code = `${base_code}_${data}`;

  return code;
}

function nearestNeighbor(durations, start = 0) {
  const n = durations.length;
  const visited = new Array(n).fill(false);
  const route = [start];
  visited[start] = true;
  let current = start;

  for (let step = 1; step < n; step++) {
    let next = -1;
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j]) {
        const d = durations[current][j];
        if (d < best) {
          best = d;
          next = j;
        }
      }
    }
    if (next === -1) break;
    route.push(next);
    visited[next] = true;
    current = next;
  }
  return route;
}

function routeCost(durations, route) {
  let cost = 0;
  for (let i = 0; i < route.length - 1; i++) {
    cost += durations[route[i]][route[i + 1]];
  }
  // close the loop
  cost += durations[route[route.length - 1]][route[0]];
  return cost;
}

function twoOpt(durations, route) {
  const n = route.length;
  let improved = true;

  function swapSegment(arr, i, k) {
    // reverse arr[i..k]
    while (i < k) {
      const tmp = arr[i];
      arr[i] = arr[k];
      arr[k] = tmp;
      i++;
      k--;
    }
  }

  while (improved) {
    improved = false;
    for (let i = 1; i < n - 1; i++) {
      for (let k = i + 1; k < n; k++) {
        // compute delta if we reverse segment i..k
        const a = route[i - 1];
        const b = route[i];
        const c = route[k];
        const d = route[(k + 1) % n]; // wrap
        const before = durations[a][b] + durations[c][d];
        const after = durations[a][c] + durations[b][d];
        if (after + 1e-9 < before) {
          // improvement
          swapSegment(route, i, k);
          improved = true;
        }
      }
      if (improved) break; // restart outer loop after improvement
    }
  }
  return route;
}

function buildGeoJSON(route, coords, sources, response) {
  // closed route: append start at end
  const closedRoute = route.concat([route[0]]);
  const lineCoords = closedRoute.map((i) => coords[i]);

  const lineFeature = {
    type: "Feature",
    properties: {
      name: "TSP Route",
      cost: routeCost(response.durations, route),
    },
    geometry: {
      type: "LineString",
      coordinates: lineCoords,
    },
  };

  // points with order
  const pointFeatures = route.map((idx, order) => ({
    type: "Feature",
    properties: {
      order: order,
      index: idx,
      snapped_distance: sources[idx].snapped_distance,
    },
    geometry: {
      type: "Point",
      coordinates: coords[idx],
    },
  }));

  return {
    type: "FeatureCollection",
    features: [lineFeature, ...pointFeatures],
  };
}

async function solveTSPandMakeGeoJSON(response, startIndex = 0) {
  const durations = response.durations;
  const sources = response.sources;
  const coords = sources.map((s) => s.location);

  // initial route
  let route = nearestNeighbor(durations, startIndex);

  // If nearestNeighbor didn't include all nodes (shouldn't happen), append missing:
  if (route.length < coords.length) {
    const missing = [];
    const present = new Set(route);
    for (let i = 0; i < coords.length; i++)
      if (!present.has(i)) missing.push(i);
    route = route.concat(missing);
  }

  const initialCost = routeCost(durations, route);
  // 2-opt improve
  route = twoOpt(durations, route);
  const improvedCost = routeCost(durations, route);

  const geojson_matrix = buildGeoJSON(route, coords, sources, response);

  const closedRoute = route.concat([route[0]]);
  const lineCoords = closedRoute.map((i) => coords[i]);

  const profile = "foot-walking";
  const routeRes = await fetch(
    `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization:
          "5b3ce3597851110001cf6248a74916be492f4775af9522b9c91d851c",
      },
      body: JSON.stringify({
        coordinates: lineCoords,
      }),
    }
  );

  if (!routeRes.ok) {
    throw new Error(`Generate Routes HTTP error! Status: ${routeRes.status}`);
  }

  const geojson_route = await routeRes.json();

  if (geojson_route.features?.[0]?.properties) {
    delete geojson_route.features[0].properties.segments;
    delete geojson_route.features[0].properties.way_points;
  }
  delete geojson_route.metadata;

  return {
    route,
    initialCost,
    improvedCost,
    geojson_matrix,
    geojson_route,
  };
}

const ORS_API_KEY = "5b3ce3597851110001cf6248a74916be492f4775af9522b9c91d851c";

async function requestOrsDirections(profile, coordinates, body = {}) {
  const routeRes = await fetch(
    `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: ORS_API_KEY,
      },
      body: JSON.stringify({ coordinates, ...body }),
    }
  );

  if (!routeRes.ok) {
    const resError = await routeRes.json().catch(() => null);
    throw new Error(
      resError?.error?.message ??
        `Generate Routes HTTP error! Status: ${routeRes.status}`
    );
  }

  return routeRes.json();
}

const PROFILE_LABELS = {
  "driving-car": "Mobil",
  "driving-hgv": "Truk",
  "cycling-regular": "Motor",
  "cycling-electric": "Motor listrik",
  "cycling-road": "Sepeda",
  "foot-walking": "Jalan kaki",
  "foot-hiking": "Jalan kaki",
};

// ORS has no motorcycle profile, cycling-regular is the closest match: it uses
// the small streets a motorbike would take and skips highways and tollways.
const DEFAULT_ROUTE_PROFILES = ["driving-car", "cycling-regular"];

// foot-walking reaches places no vehicle network covers, so it is only used
// when none of the requested profiles produced a route at all
const FALLBACK_ROUTE_PROFILE = "foot-walking";

function normalizeProfileEntry(entry) {
  const profile = typeof entry === "string" ? entry : entry?.profile;
  if (!profile) return null;
  return {
    profile: profile,
    label:
      (typeof entry === "object" && entry?.label) ||
      PROFILE_LABELS[profile] ||
      profile,
  };
}

// ORS snaps every request to the nearest road, so re-attach the exact
// coordinates the caller asked for on both ends of the line.
function snapRouteToLocations(feature, locStart, locEnd) {
  if (feature?.properties) {
    delete feature.properties.segments;
    delete feature.properties.way_points;
  }

  const coords = feature?.geometry?.coordinates;
  if (!Array.isArray(coords) || coords.length === 0) return feature;

  const isSameCoord = (a, b) => a[0] === b[0] && a[1] === b[1];
  if (!isSameCoord(coords[0], locStart)) coords.unshift(locStart);
  if (!isSameCoord(coords[coords.length - 1], locEnd)) coords.push(locEnd);
  feature.geometry.coordinates = coords;

  return feature;
}

export default (router, { database, logger, services }) => {
  const { ItemsService } = services;
  router.post("/backhaul-backbound", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { geojson_source, geojson_buffer } = req.body;

      const module = "backhaul_backbound";
      const code = analysisCode(module);

      const features_source = geojson_source.features;
      const features_buffer = geojson_buffer.features;

      let queryLength = `
        WITH input_geojson AS (
          SELECT ?::json AS fc
        ), features AS (
            SELECT
                COALESCE(f->'properties'->>'road_category', 'Primary Road') AS road_category,
                ST_SetSRID(
                    ST_GeomFromGeoJSON(f->>'geometry'),
                    4326
                ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), merged AS (
            SELECT
                road_category,
                ST_Union(geom) AS geom
            FROM features
            GROUP BY road_category
        ) SELECT
                'Feature' AS type,
                jsonb_build_object(
                  'road_category',  road_category,
                  'length_m',       ST_Length(geom::geography,false)
                ) AS properties,
                ST_AsGeoJSON(geom)::json AS geometry
            FROM merged
            ORDER BY road_category
        ;`;

      let queryArea = `
        WITH input_geojson AS (
          SELECT ?::json AS fc
        ), features AS (
            SELECT
                COALESCE(f->'properties'->>'road_category', 'Primary Road') AS road_category,
                ST_SetSRID(
                    ST_GeomFromGeoJSON(f->>'geometry'),
                    4326
                ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), merged AS (
            SELECT
                road_category,
                ST_Union(geom) AS geom
            FROM features
            GROUP BY road_category
        ) SELECT
                'Feature' AS type,
                jsonb_build_object(
                  'road_category',  road_category,
                  'area_m2',        ST_Area(geom::geography,false)
                ) AS properties,
                ST_AsGeoJSON(geom)::json AS geometry
            FROM merged
            ORDER BY road_category
        ;`;

      let queryAreaTotal = `
        WITH input_geojson AS (
          SELECT ?::json AS fc
        ), features AS (
            SELECT
                COALESCE(f->'properties'->>'road_category', 'Primary Road') AS road_category,
                ST_SetSRID(
                    ST_GeomFromGeoJSON(f->>'geometry'),
                    4326
                ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), merged AS (
            SELECT
                ST_Union(geom) AS geom
            FROM features
        ) SELECT
                'Feature' AS type,
                jsonb_build_object(
                  'road_category',  'All',
                  'area_m2',        ST_Area(geom::geography,false)
                ) AS properties,
                ST_AsGeoJSON(geom)::json AS geometry
            FROM merged
        ;`;

      let queryHsSummary = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              COALESCE(f->'properties'->>'road_category', 'Primary Road') AS road_category,
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ) SELECT f.road_category, hs_class AS group, count(*) AS count
            FROM sp_data_footprint main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY 1, 2
            ORDER BY 1, 3 DESC
        ;`;

      let queryHsGeojson = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              COALESCE(f->'properties'->>'road_category', 'Primary Road') AS road_category,
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), joined AS (
            SELECT 
                main.ogc_fid,
                main.hs_class,
                array_agg(DISTINCT f.road_category) AS road_categories,
                main.geom
            FROM sp_data_footprint main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY main.ogc_fid
        ) SELECT json_build_object(
            'type',       'FeatureCollection',
            'features',   json_agg(
              json_build_object(
                'type',       'Feature',
                'geometry',   ST_AsGeoJSON(j.geom)::json,
                'properties', json_build_object(
                  'ogc_fid', j.ogc_fid,
                  'hs_class', j.hs_class,
                  'road_category', j.road_categories
                )
              )
              ORDER BY j.road_categories, j.hs_class
            )
          ) AS geojson
          FROM joined j
        ;`;

      let queryPOISummary = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              COALESCE(f->'properties'->>'road_category', 'Primary Road') AS road_category,
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ) SELECT f.road_category, category AS group, count(*) AS count
            FROM poi main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY 1, 2
            ORDER BY 1, 3 DESC
        ;`;

      let queryPOIGeojson = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              COALESCE(f->'properties'->>'road_category', 'Primary Road') AS road_category,
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), joined AS (
            SELECT 
                main.ogc_fid,
                main.poi_name,
                main.category,
                array_agg(DISTINCT f.road_category) AS road_categories,
                main.geom
            FROM poi main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY main.ogc_fid
        ) SELECT json_build_object(
            'type',       'FeatureCollection',
            'features',   json_agg(
              json_build_object(
                'type',       'Feature',
                'geometry',   ST_AsGeoJSON(j.geom)::json,
                'properties', json_build_object(
                  'ogc_fid', j.ogc_fid,
                  'poi_name', j.poi_name,
                  'category', j.category,
                  'road_category', j.road_categories
                )
              )
              ORDER BY j.road_categories, j.poi_name
            )
          ) AS geojson
          FROM joined j
        ;`;

      let queryTowerSummary = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              COALESCE(f->'properties'->>'road_category', 'Primary Road') AS road_category,
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ) SELECT f.road_category, data_source AS group, count(*) AS count
            FROM towers main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY 1, 2
            ORDER BY 1, 3 DESC
        ;`;

      let queryTowerGeojson = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              COALESCE(f->'properties'->>'road_category', 'Primary Road') AS road_category,
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), joined AS (
            SELECT 
                main.ogc_fid,
                main.data_source,
                array_agg(DISTINCT f.road_category) AS road_categories,
                main.geom
            FROM towers main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY main.ogc_fid
        ) SELECT json_build_object(
            'type',       'FeatureCollection',
            'features',   json_agg(
              json_build_object(
                'type',       'Feature',
                'geometry',   ST_AsGeoJSON(j.geom)::json,
                'properties', json_build_object(
                  'ogc_fid', j.ogc_fid,
                  'data_source', j.data_source,
                  'road_category', j.road_categories
                )
              )
              ORDER BY j.road_categories, j.data_source
            )
          ) AS geojson
          FROM joined j
        ;`;

      const response = {
        code: code,
        geojson_source: {},
        geojson_buffer: {},
      };

      const result = {
        buffer: {},
        layers: {
          house_class: { summary: {}, geojson: {} },
          poi: { summary: {}, geojson: {} },
          telecommunication: { summary: {}, geojson: {} },
        },
      };

      let features_buffer_merged;
      let features_buffer_all;

      try {
        const { rows: resultSource } = await database.raw(queryLength, [
          JSON.stringify(features_source),
        ]);
        const { rows: resultBuffer } = await database.raw(queryArea, [
          JSON.stringify(features_buffer),
        ]);
        const { rows: resultBufferAll } = await database.raw(queryAreaTotal, [
          JSON.stringify(features_buffer),
        ]);

        features_buffer_merged = resultBuffer;
        features_buffer_all = resultBufferAll;

        const geojson_source_merged = {
          type: "FeatureCollection",
          features: resultSource,
        };

        const geojson_buffer_merged = {
          type: "FeatureCollection",
          features: resultBuffer,
        };

        let length_total_m = 0;
        const merged = resultSource.map((src) => {
          const buf = resultBuffer.find(
            (b) => b.properties.road_category === src.properties.road_category
          );
          length_total_m = length_total_m + src.properties.length_m;
          return {
            road_category: src.properties.road_category,
            length_m: src.properties.length_m,
            area_m2: buf ? buf.properties.area_m2 : null,
          };
        });
        const buffer_all = {
          road_category: "All",
          length_m: length_total_m,
          area_m2: resultBufferAll[0].properties.area_m2,
        };

        result.buffer = [buffer_all, ...merged];
        response.geojson_source = geojson_source_merged;
        response.geojson_buffer = geojson_buffer_merged;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/backhaul-backbound",
            reason: "Failed generate buffer properties",
          })
        );
      }

      try {
        const { rows } = await database.raw(queryHsSummary, [
          JSON.stringify(features_buffer_merged),
        ]);
        const { rows: rowsAll } = await database.raw(queryHsSummary, [
          JSON.stringify(features_buffer_all),
        ]);
        result.layers.house_class.summary = [...rowsAll, ...rows];
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/backhaul-backbound",
            reason: "Failed generate summary house class",
          })
        );
      }

      try {
        const { rows } = await database.raw(queryHsGeojson, [
          JSON.stringify(features_buffer_merged),
        ]);
        result.layers.house_class.geojson = rows[0].geojson;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/backhaul-backbound",
            reason: "Failed generate geojson house class",
          })
        );
      }

      try {
        const { rows } = await database.raw(queryPOISummary, [
          JSON.stringify(features_buffer_merged),
        ]);
        const { rows: rowsAll } = await database.raw(queryPOISummary, [
          JSON.stringify(features_buffer_all),
        ]);
        result.layers.poi.summary = [...rowsAll, ...rows];
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/backhaul-backbound",
            reason: "Failed generate summary poi",
          })
        );
      }

      try {
        const { rows } = await database.raw(queryPOIGeojson, [
          JSON.stringify(features_buffer_merged),
        ]);
        result.layers.poi.geojson = rows[0].geojson;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/backhaul-backbound",
            reason: "Failed generate geojson poi",
          })
        );
      }

      try {
        const { rows } = await database.raw(queryTowerSummary, [
          JSON.stringify(features_buffer_merged),
        ]);
        const { rows: rowsAll } = await database.raw(queryTowerSummary, [
          JSON.stringify(features_buffer_all),
        ]);
        result.layers.telecommunication.summary = [...rowsAll, ...rows];
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/backhaul-backbound",
            reason: "Failed generate summary telecommunication",
          })
        );
      }

      try {
        const { rows } = await database.raw(queryTowerGeojson, [
          JSON.stringify(features_buffer_merged),
        ]);
        result.layers.telecommunication.geojson = rows[0].geojson;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/backhaul-backbound",
            reason: "Failed generate geojson telecommunication",
          })
        );
      }

      try {
        const analysisResultService = new ItemsService("analysis_result", {
          accountability,
          schema: req.schema,
          knex: database,
        });
        await analysisResultService.createOne({
          code: code,
          module: module,
          geojson_source: geojson_source,
          geojson_buffer: geojson_buffer,
          result: result,
        });
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/backhaul-backbound",
            reason: "Failed to save analysis result",
          })
        );
      }

      response.result = result;

      return res.json({
        data: response,
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/backhaul-backbound",
          reason: "Failed to analysis backhaul-backbound",
        })
      );
    }
  });
  router.post("/market-potential", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { geojson_source, geojson_buffer } = req.body;

      const module = "market_potential";
      const code = analysisCode(module);

      const features_source = geojson_source.features;
      const features_buffer = geojson_buffer.features;

      let queryLength = `
        WITH input_geojson AS (
          SELECT ?::json AS fc
        ), features AS (
            SELECT
                ST_SetSRID(
                    ST_GeomFromGeoJSON(f->>'geometry'),
                    4326
                ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), merged AS (
            SELECT
                ST_Union(geom) AS geom
            FROM features
        ) SELECT
                'Feature' AS type,
                jsonb_build_object(
                  'length_m',       ST_Length(geom::geography,false)
                ) AS properties,
                ST_AsGeoJSON(geom)::json AS geometry
            FROM merged
        ;`;

      let queryArea = `
        WITH input_geojson AS (
          SELECT ?::json AS fc
        ), features AS (
            SELECT
                ST_SetSRID(
                    ST_GeomFromGeoJSON(f->>'geometry'),
                    4326
                ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), merged AS (
            SELECT
                ST_Union(geom) AS geom
            FROM features
        ) SELECT
                'Feature' AS type,
                jsonb_build_object(
                  'area_m2',        ST_Area(geom::geography,false)
                ) AS properties,
                ST_AsGeoJSON(geom)::json AS geometry
            FROM merged
        ;`;

      let queryHsSummary = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ) SELECT hs_class AS group, count(*) AS count
            FROM sp_data_footprint main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY 1
            ORDER BY 1, 2 DESC
        ;`;

      let queryHsGeojson = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), joined AS (
            SELECT 
                main.ogc_fid,
                main.hs_class,
                main.geom
            FROM sp_data_footprint main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY main.ogc_fid
        ) SELECT json_build_object(
            'type',       'FeatureCollection',
            'features',   json_agg(
              json_build_object(
                'type',       'Feature',
                'geometry',   ST_AsGeoJSON(j.geom)::json,
                'properties', json_build_object(
                  'ogc_fid', j.ogc_fid,
                  'hs_class', j.hs_class
                )
              )
              ORDER BY j.hs_class
            )
          ) AS geojson
          FROM joined j
        ;`;

      let queryPOISummary = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ) SELECT category AS group, count(*) AS count
            FROM poi main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY 1
            ORDER BY 1, 2 DESC
        ;`;

      let queryPOIGeojson = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), joined AS (
            SELECT 
                main.ogc_fid,
                main.poi_name,
                main.category,
                main.geom
            FROM poi main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY main.ogc_fid
        ) SELECT json_build_object(
            'type',       'FeatureCollection',
            'features',   json_agg(
              json_build_object(
                'type',       'Feature',
                'geometry',   ST_AsGeoJSON(j.geom)::json,
                'properties', json_build_object(
                  'ogc_fid', j.ogc_fid,
                  'poi_name', j.poi_name,
                  'category', j.category
                )
              )
              ORDER BY j.poi_name
            )
          ) AS geojson
          FROM joined j
        ;`;

      let queryTowerSummary = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ) SELECT data_source AS group, count(*) AS count
            FROM towers main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY 1
            ORDER BY 1, 2 DESC
        ;`;

      let queryTowerGeojson = `
        WITH input_geojson AS (
            SELECT ?::json AS fc
        ), features AS (
            SELECT
              ST_SetSRID(
                ST_GeomFromGeoJSON(f->>'geometry'),
                4326
              ) AS geom
            FROM input_geojson, json_array_elements(fc) AS f
        ), joined AS (
            SELECT 
                main.ogc_fid,
                main.data_source,
                main.geom
            FROM towers main
            INNER JOIN features f ON ST_Intersects(main.geom, f.geom)
            GROUP BY main.ogc_fid
        ) SELECT json_build_object(
            'type',       'FeatureCollection',
            'features',   json_agg(
              json_build_object(
                'type',       'Feature',
                'geometry',   ST_AsGeoJSON(j.geom)::json,
                'properties', json_build_object(
                  'ogc_fid', j.ogc_fid,
                  'data_source', j.data_source
                )
              )
              ORDER BY j.data_source
            )
          ) AS geojson
          FROM joined j
        ;`;

      const response = {
        code: code,
        geojson_source: {},
        geojson_buffer: {},
      };

      const result = {
        buffer: {},
        layers: {
          house_class: { summary: {}, geojson: {} },
          poi: { summary: {}, geojson: {} },
          telecommunication: { summary: {}, geojson: {} },
        },
      };

      let features_buffer_merged;
      try {
        const { rows: resultSource } = await database.raw(queryLength, [
          JSON.stringify(features_source),
        ]);
        const { rows: resultBuffer } = await database.raw(queryArea, [
          JSON.stringify(features_buffer),
        ]);

        features_buffer_merged = resultBuffer;

        const geojson_source_merged = {
          type: "FeatureCollection",
          features: resultSource,
        };

        const geojson_buffer_merged = {
          type: "FeatureCollection",
          features: resultBuffer,
        };

        const merged = {
          length_m: resultSource[0].properties.length_m,
          area_m2: resultBuffer[0].properties.area_m2,
        };

        result.buffer = merged;
        response.geojson_source = geojson_source_merged;
        response.geojson_buffer = geojson_buffer_merged;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/market-potential",
            reason: "Failed generate buffer properties",
          })
        );
      }

      try {
        const { rows } = await database.raw(queryHsSummary, [
          JSON.stringify(features_buffer_merged),
        ]);
        result.layers.house_class.summary = rows;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/market-potential",
            reason: "Failed generate summary house class",
          })
        );
      }
      try {
        const { rows } = await database.raw(queryHsGeojson, [
          JSON.stringify(features_buffer_merged),
        ]);
        result.layers.house_class.geojson = rows[0].geojson;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/market-potential",
            reason: "Failed generate geojson house class",
          })
        );
      }

      try {
        const { rows } = await database.raw(queryPOISummary, [
          JSON.stringify(features_buffer_merged),
        ]);
        result.layers.poi.summary = rows;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/market-potential",
            reason: "Failed generate summary poi",
          })
        );
      }
      try {
        const { rows } = await database.raw(queryPOIGeojson, [
          JSON.stringify(features_buffer_merged),
        ]);
        result.layers.poi.geojson = rows[0].geojson;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/market-potential",
            reason: "Failed generate geojson poi",
          })
        );
      }

      try {
        const { rows } = await database.raw(queryTowerSummary, [
          JSON.stringify(features_buffer_merged),
        ]);
        result.layers.telecommunication.summary = rows;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/market-potential",
            reason: "Failed generate summary telecommunication",
          })
        );
      }
      try {
        const { rows } = await database.raw(queryTowerGeojson, [
          JSON.stringify(features_buffer_merged),
        ]);
        result.layers.telecommunication.geojson = rows[0].geojson;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/market-potential",
            reason: "Failed generate geojson telecommunication",
          })
        );
      }

      response.result = result;
      res.send({ data: response });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/market-potential",
          reason: "Failed to analysis market-potential",
        })
      );
    }
  });
  router.post("/fixed-wireless-access", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { options } = req.body;
      const { data_source, radius } = options;

      const ids = data_source.map(() => "?").join(",");

      let sourceDataFeature;
      let bufferDataFeature;
      let hsDataSummary;
      let hsDataFeature;
      let poiDataSummary;
      let poiDataFeature;
      let towerDataSummary;
      let towerDataFeature;
      try {
        const { rows: resultSource } = await database.raw(
          `WITH site_data AS (
            SELECT
              ROW_NUMBER() OVER (ORDER BY sp.id) AS ord,
              sp.id, sp.code, sp.owner,
              ac.province, ac.city, NULL AS district,
              sp.geom
            FROM site_points sp
            INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
            WHERE sp.id IN (${ids})
          ) SELECT
              ord AS fid, 'Feature' AS type,
              to_jsonb(t) - 'geom' AS properties,
              ST_AsGeoJSON(geom)::jsonb AS geometry
            FROM site_data t
            ORDER BY ord;`,
          [...data_source]
        );
        const { rows: resultBuffer } = await database.raw(
          `WITH site_data AS (
            SELECT
              ROW_NUMBER() OVER (ORDER BY sp.id) AS ord, sp.id,
              ?::int AS radius_m,
              ST_Area(ST_Buffer(sp.geom::geography, ?), false) AS area_m2,
              ST_Buffer(sp.geom::geography, ?)::geometry AS geom
            FROM site_points sp
            INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
            WHERE sp.id IN (${ids})
          ) SELECT
              ord AS fid, 'Feature' AS type,
              to_jsonb(t) - 'geom' AS properties,
              ST_AsGeoJSON(geom)::jsonb AS geometry
            FROM site_data t
            ORDER BY ord;`,
          [radius, radius, radius, ...data_source]
        );
        sourceDataFeature = resultSource;
        bufferDataFeature = resultBuffer;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/fixed-wireless-access",
            reason: "Failed generate data & buffer properties",
          })
        );
      }

      try {
        const { rows } = await database.raw(
          `WITH tower_buffer AS (
            SELECT ROW_NUMBER() OVER (ORDER BY sp.id) AS fid, sp.id AS tower_id, ST_Buffer(sp.geom::geography, ?)::geometry AS geom
            FROM site_points sp
            WHERE sp.id IN (${ids})
          ) SELECT
              t.fid,
              CASE
                WHEN hs_class = 'A' THEN 'High'
                WHEN hs_class = 'B' THEN 'Mid'
                WHEN hs_class = 'C' THEN 'Low'
                WHEN hs_class = 'C1' THEN 'Very Low'
                WHEN hs_class = 'Non-Residential' THEN 'Non-Residential'
                ELSE 'Other'
              END AS group,
              count(*) AS count
            FROM sp_data_footprint main
            INNER JOIN tower_buffer t ON ST_Intersects(main.geom, t.geom)
            GROUP BY 1, 2
            ORDER BY 1, 2 DESC;`,
          [radius, ...data_source]
        );
        hsDataSummary = rows;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/fixed-wireless-access",
            reason: "Failed generate summary house class",
          })
        );
      }
      try {
        const { rows } = await database.raw(
          `WITH tower_buffer AS (
            SELECT ROW_NUMBER() OVER (ORDER BY sp.id) AS fid, sp.id AS tower_id, ST_Buffer(sp.geom::geography, ?)::geometry AS geom
            FROM site_points sp
            WHERE sp.id IN (${ids})
          ), joined AS (
            SELECT t.fid, main.ogc_fid, main.hs_class, main.geom
            FROM sp_data_footprint main
            INNER JOIN tower_buffer t ON ST_Intersects(main.geom, t.geom)
          ) SELECT j.fid, json_agg(
              json_build_object(
                'type',       'Feature',
                'geometry',   ST_AsGeoJSON(j.geom)::json,
                'properties', json_build_object(
                  'ogc_fid', j.ogc_fid,
                  'hs_class', j.hs_class
              )) ORDER BY j.hs_class) AS feature
            FROM joined j
            GROUP BY j.fid;`,
          [radius, ...data_source]
        );
        hsDataFeature = rows;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/fixed-wireless-access",
            reason: "Failed generate geojson house class",
          })
        );
      }

      try {
        const { rows } = await database.raw(
          `WITH tower_buffer AS (
            SELECT ROW_NUMBER() OVER (ORDER BY sp.id) AS fid, sp.id AS tower_id, ST_Buffer(sp.geom::geography, ?)::geometry AS geom
            FROM site_points sp
            WHERE sp.id IN (${ids})
          ) SELECT t.fid, category AS group, count(*) AS count
            FROM poi main
            INNER JOIN tower_buffer t ON ST_Intersects(main.geom, t.geom)
            GROUP BY 1, 2
            ORDER BY 1, 2 DESC;`,
          [radius, ...data_source]
        );
        poiDataSummary = rows;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/fixed-wireless-access",
            reason: "Failed generate summary poi",
          })
        );
      }
      try {
        const { rows } = await database.raw(
          `WITH tower_buffer AS (
            SELECT ROW_NUMBER() OVER (ORDER BY sp.id) AS fid, sp.id AS tower_id, ST_Buffer(sp.geom::geography, ?)::geometry AS geom
            FROM site_points sp
            WHERE sp.id IN (${ids})
          ), joined AS (
            SELECT t.fid, main.ogc_fid, main.poi_name, main.category, main.geom
            FROM poi main
              INNER JOIN tower_buffer t ON ST_Intersects(main.geom, t.geom)
          ) SELECT j.fid, json_agg(
              json_build_object(
                'type',       'Feature',
                'geometry',   ST_AsGeoJSON(j.geom)::json,
                'properties', json_build_object(
                  'ogc_fid', j.ogc_fid,
                  'poi_name', j.poi_name,
                  'category', j.category
              )) ORDER BY j.poi_name) AS feature
            FROM joined j
            GROUP BY j.fid;`,
          [radius, ...data_source]
        );
        poiDataFeature = rows;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/fixed-wireless-access",
            reason: "Failed generate geojson poi",
          })
        );
      }

      try {
        const { rows } = await database.raw(
          `WITH tower_buffer AS (
            SELECT ROW_NUMBER() OVER (ORDER BY sp.id) AS fid, sp.id AS tower_id, ST_Buffer(sp.geom::geography, ?)::geometry AS geom
            FROM site_points sp
            WHERE sp.id IN (${ids})
          ) SELECT t.fid, owner AS group, count(*) AS count
            FROM site_points main
            INNER JOIN site_point_types spt ON main.site_point_type_id = spt.id AND spt.name = 'Tower'
            INNER JOIN tower_buffer t ON ST_Intersects(main.geom, t.geom)
            WHERE main.id NOT IN (SELECT tower_id FROM tower_buffer)
            GROUP BY 1, 2
            ORDER BY 1, 2 DESC;`,
          [radius, ...data_source]
        );
        towerDataSummary = rows;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/fixed-wireless-access",
            reason: "Failed generate summary telecommunication",
          })
        );
      }
      try {
        const { rows } = await database.raw(
          `WITH tower_buffer AS (
            SELECT ROW_NUMBER() OVER (ORDER BY sp.id) AS fid, sp.id AS tower_id, ST_Buffer(sp.geom::geography, ?)::geometry AS geom
            FROM site_points sp
            WHERE sp.id IN (${ids})
          ), joined AS (
            SELECT t.fid, main.id AS ogc_fid, main.owner as data_source, main.geom
            FROM site_points main
            INNER JOIN site_point_types spt ON main.site_point_type_id = spt.id AND spt.name = 'Tower'
            INNER JOIN tower_buffer t ON ST_Intersects(main.geom, t.geom)
            WHERE main.id NOT IN (SELECT tower_id FROM tower_buffer)
          ) SELECT j.fid, json_agg(
              json_build_object(
                'type',       'Feature',
                'geometry',   ST_AsGeoJSON(j.geom)::json,
                'properties', json_build_object(
                  'ogc_fid', j.ogc_fid,
                  'data_source', j.data_source
              )) ORDER BY j.data_source) AS feature
            FROM joined j
            GROUP BY j.fid;`,
          [radius, ...data_source]
        );
        towerDataFeature = rows;
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/fixed-wireless-access",
            reason: "Failed generate geojson telecommunication",
          })
        );
      }

      const finalResult = sourceDataFeature.map((src) => {
        const fid = src.fid;
        const data_source_id = src.properties.id;

        const buffer = bufferDataFeature.find((b) => b.fid === fid);
        const hsSummary = hsDataSummary.filter((s) => s.fid === fid);
        const hsFeature = hsDataFeature.find((h) => h.fid === fid);
        const poiSummary = poiDataSummary.filter((s) => s.fid === fid);
        const poiFeature = poiDataFeature.find((h) => h.fid === fid);
        const towerSummary = towerDataSummary.filter((s) => s.fid === fid);
        const towerFeature = towerDataFeature.find((h) => h.fid === fid);

        const finalCode = src?.properties?.code
          ? analysisCode(`fwa_tower_${src.properties.code}`)
          : analysisCode(`fwa_tower`) + "_" + fid;

        return {
          code: finalCode,
          options: { radius: radius, data_source: [data_source_id] },
          geojson_source: {
            type: "FeatureCollection",
            features: [src],
          },
          geojson_buffer: {
            type: "FeatureCollection",
            features: [buffer],
          },
          result: {
            buffer: {
              radius_m: buffer?.properties?.radius_m ?? null,
              area_m2: buffer?.properties?.area_m2 ?? null,
            },
            layers: {
              house_class: {
                summary: hsSummary,
                geojson: {
                  type: "FeatureCollection",
                  features: hsFeature?.feature ?? [],
                },
              },
              poi: {
                summary: poiSummary,
                geojson: {
                  type: "FeatureCollection",
                  features: poiFeature?.feature ?? [],
                },
              },
              telecommunication: {
                summary: towerSummary,
                geojson: {
                  type: "FeatureCollection",
                  features: towerFeature?.feature ?? [],
                },
              },
            },
          },
        };
      });
      res.send({ data: finalResult });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/fixed-wireless-access",
          reason: "Failed to analysis fixed-wireless-access",
        })
      );
    }
  });
  router.post(
    "/fixed-wireless-access/csv/:layerName",
    async (req, res, next) => {
      try {
        const { accountability } = req;
        if (!accountability.user) {
          return next(new ForbiddenError());
        }
        const { layerName } = req.params;
        const allowedLayerName = ["sp_data_footprint", "poi", "towers"];
        if (!allowedLayerName.includes(layerName)) {
          return next(
            new InvalidPayloadError({
              reason: "allowed layerName is sp_data_footprint, poi, towers",
            })
          );
        }
        const { options } = req.body;
        const { data_source, radius } = options;

        const ids = data_source.map(() => "?").join(",");

        let query;
        if (layerName == "sp_data_footprint") {
          query = `
            WITH tower_buffer AS (
              SELECT sp.id AS tower_id, ST_Buffer(sp.geom::geography, ?)::geometry AS geom
              FROM site_points sp
              WHERE sp.id IN (${ids})
            ), tower_hs_summary_raw AS (
              SELECT
                t.tower_id,
                CASE
                  WHEN f.hs_class = 'A' THEN 'high'
                  WHEN f.hs_class = 'B' THEN 'mid'
                  WHEN f.hs_class = 'C' THEN 'low'
                  WHEN f.hs_class = 'C1' THEN 'very_low'
                  WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
                  ELSE 'other'
                END AS hs_class,
                COUNT(DISTINCT f.ogc_fid) AS fp_count
              FROM tower_buffer t
              LEFT JOIN sp_data_footprint f ON ST_Intersects(f.geom, t.geom)
              WHERE f.hs_class IS NOT NULL
              GROUP BY t.tower_id, f.hs_class
            ), tower_hs_summary AS (
              SELECT tf.tower_id, COALESCE(jsonb_object_agg(r.hs_class, r.fp_count) FILTER (WHERE r.hs_class IS NOT NULL),'{}'::jsonb) AS fp_by_hs_class
              FROM tower_buffer tf
              LEFT JOIN tower_hs_summary_raw r ON tf.tower_id = r.tower_id
              GROUP BY tf.tower_id
            ) SELECT
                sp.id, sp.code, sp.name,
                ac.province, ac.city,
                ST_X(sp.geom) AS longitude, ST_Y(sp.geom) AS latitude,
                sp.owner,
                COALESCE((h.fp_by_hs_class->>'high')::int, 0) AS high,
                COALESCE((h.fp_by_hs_class->>'mid')::int, 0) AS mid,
                COALESCE((h.fp_by_hs_class->>'low')::int, 0) AS low,
                COALESCE((h.fp_by_hs_class->>'very_low')::int, 0) AS very_low,
                COALESCE((h.fp_by_hs_class->>'non_residential')::int, 0) AS non_residential,
                COALESCE((h.fp_by_hs_class->>'high')::int, 0) +
                COALESCE((h.fp_by_hs_class->>'mid')::int, 0) +
                COALESCE((h.fp_by_hs_class->>'low')::int, 0) +
                COALESCE((h.fp_by_hs_class->>'very_low')::int, 0) +
                COALESCE((h.fp_by_hs_class->>'non_residential')::int, 0) +
                COALESCE((h.fp_by_hs_class->>'other')::int, 0)
                AS total
              FROM tower_buffer t
              INNER JOIN site_points sp ON sp.id = t.tower_id
              INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
              LEFT JOIN tower_hs_summary h ON h.tower_id = t.tower_id
            ;`;
        } else if (layerName == "poi") {
          query = `
            WITH tower_buffer AS (
              SELECT sp.id AS tower_id, ST_Buffer(sp.geom::geography, ?)::geometry AS geom
              FROM site_points sp
              WHERE sp.id IN (${ids})
            ) SELECT
                ogc_fid, poi_name, category, address,
                nmkec, nmkab, nmprov,
                ST_Y(main.geom) AS latitude, ST_X(main.geom) AS longitude
              FROM tower_buffer comp
              INNER JOIN poi main ON ST_Intersects(main.geom, comp.geom);`;
        } else if (layerName == "towers") {
          query = `
            WITH tower_buffer AS (
              SELECT sp.id AS tower_id, ST_Buffer(sp.geom::geography, ?)::geometry AS geom
              FROM site_points sp
              WHERE sp.id IN (${ids})
            ) SELECT DISTINCT
                main.id, main.name, main.code, main."owner",
                ac.province, ac.city,
                ST_Y(main.geom) AS latitude, ST_X(main.geom) AS longitude
              FROM tower_buffer comp
              INNER JOIN site_points main ON ST_Intersects(main.geom, comp.geom)
              INNER JOIN site_point_types spt ON main.site_point_type_id = spt.id
              INNER JOIN area_cities ac ON main.area_city_id = ac.ogc_fid
              WHERE spt.name = 'Tower' AND main.id NOT IN (SELECT tower_id FROM tower_buffer);`;
        }

        const { rows } = await database.raw(query, [radius, ...data_source]);
        if (!rows.length) {
          return next(new DataNotFoundError());
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
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/fixed-wireless-access",
            reason: "Failed export fixed-wireless-access",
          })
        );
      }
    }
  );
  router.post("/download/area/csv/:layerName", async (req, res, next) => {
    const { layerName } = req.params;
    const { geojson_buffer } = req.body;
    try {
      const allowedLayerName = ["sp_data_footprint", "poi", "towers"];
      if (!allowedLayerName.includes(layerName)) {
        return next(
          new InvalidPayloadError({
            reason: "allowed layerName is sp_data_footprint, poi, towers",
          })
        );
      }

      let query;
      if (layerName == "sp_data_footprint") {
        query = `
          WITH input_geojson AS (
            SELECT ?::json AS fc
          ), features AS (
              SELECT
                  ST_SetSRID(
                      ST_GeomFromGeoJSON(f->>'geometry'),
                      4326
                  ) AS geom
              FROM input_geojson, json_array_elements(fc) AS f
          ), merged AS (
              SELECT
                ST_Union(geom) AS geom
              FROM features
          ) SELECT
                ogc_fid,id,id_prov,id_kabkot,id_kec,id_desa,id_rw,id_rt,
                prov_name,kab_name,kec_name,desa_name,rw,rt,poi_name,hs_npoi,
                type,volt_ty,voltage,prntkn,st_name,class_func,lane_count,divider,
                ar_auto,ar_motor,paved,private_rd,multidigit,znt_class,znt_range,
                hs_size,class,hs_price,hs_pz_rng,carport,hs_class,hs_pz_scr,hs_sz_scr,
                cp_scr,cl_scr,total_scr,grade,table_name,ST_AsGeoJSON(main.geom) as geom
              FROM sp_data_footprint main, merged
              WHERE main.geom && merged.geom
              AND ST_Intersects(main.geom, merged.geom);
        `;
      } else if (layerName == "poi") {
        query = `
          WITH input_geojson AS (
            SELECT ?::json AS fc
          ), features AS (
              SELECT
                  ST_SetSRID(
                      ST_GeomFromGeoJSON(f->>'geometry'),
                      4326
                  ) AS geom
              FROM input_geojson, json_array_elements(fc) AS f
          ), merged AS (
              SELECT
                ST_Union(geom) AS geom
              FROM features
          ) SELECT
                  ogc_fid, poi_name, category, address,
                  nmkec, nmkab, nmprov, newkabkot,
                  latitude, longitude, ST_AsGeoJSON(main.geom) AS geom
                FROM poi main, merged
              WHERE main.geom && merged.geom
              AND ST_Intersects(main.geom, merged.geom);
        `;
      } else if (layerName == "towers") {
        query = `
          WITH input_geojson AS (
            SELECT ?::json AS fc
          ), features AS (
              SELECT
                  ST_SetSRID(
                      ST_GeomFromGeoJSON(f->>'geometry'),
                      4326
                  ) AS geom
              FROM input_geojson, json_array_elements(fc) AS f
          ), merged AS (
              SELECT
                ST_Union(geom) AS geom
              FROM features
          ) SELECT
                ogc_fid, data_source, tower_code, site_name, site_type, tower_type, tower_height,
                address, building_height, space_available, power_source, site_available, island,
                province, city, district, village, source_id, ST_AsGeoJSON(main.geom) AS geom
              FROM towers main, merged
              WHERE main.geom && merged.geom
              AND ST_Intersects(main.geom, merged.geom);
        `;
      }

      const features_buffer = geojson_buffer.features;
      const { rows } = await database.raw(query, [
        JSON.stringify(features_buffer),
      ]);
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
          return header === '"geom"' ? `"${value.replace(/"/g, '""')}"` : value;
        });
        csvStream.push(values.join(",") + "\n");
      }

      csvStream.push(null);
      csvStream.pipe(res);
    } catch (error) {
      logger.error("Download failed: ");
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: `analysis/download/area/csv/${layerName}`,
          reason: "Failed to download csv data",
        })
      );
    }
  });
  router.post("/tsp", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { locations, profile = "foot-walking" } = req.body;
      if (!locations) {
        return next(
          new InvalidPayloadError({
            reason: "locations is required",
          })
        );
      }

      const matrixRes = await fetch(
        `https://api.openrouteservice.org/v2/matrix/${profile}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              "5b3ce3597851110001cf6248a74916be492f4775af9522b9c91d851c",
          },
          body: JSON.stringify({
            locations: locations,
          }),
        }
      );

      if (!matrixRes.ok) {
        throw new Error(
          `Generate Matrix HTTP error! Status: ${matrixRes.status}`
        );
      }

      const matrixData = await matrixRes.json();
      const result = await solveTSPandMakeGeoJSON(matrixData, 0);

      res.send({ data: result });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/tsp",
          reason: `Failed to generate tsp${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/generate-route", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { locations, profile = "foot-walking" } = req.body;
      if (!Array.isArray(locations) || locations.length < 2) {
        return next(
          new InvalidPayloadError({
            reason: "locations minimal terdiri dari 2 titik",
          })
        );
      }

      const routeRes = await fetch(
        `https://api.openrouteservice.org/v2/directions/${profile}/geojson`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization:
              "5b3ce3597851110001cf6248a74916be492f4775af9522b9c91d851c",
          },
          body: JSON.stringify({
            coordinates: locations,
            // -1 lifts the 350m default search radius, otherwise points that sit
            // on a plaza or inside a block are rejected as "not routable"
            radiuses: locations.map(() => -1),
          }),
        }
      );

      let status = "success";
      let message = null;
      let geojson_route = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              coordinates: locations,
              type: "LineString",
            },
          },
        ],
      };

      if (!routeRes.ok) {
        status = "failed";
        const resError = await routeRes.json();
        message =
          resError?.error?.message ??
          `Generate Routes HTTP error! Status: ${routeRes.status}`;
        logger.warn(message);
      } else {
        geojson_route = await routeRes.json();

        const feature = geojson_route.features?.[0];
        if (feature) {
          if (feature.properties) {
            delete feature.properties.segments;
            delete feature.properties.way_points;
          }
          delete geojson_route.metadata;

          const coords = feature.geometry.coordinates;
          const locStart = locations[0];
          const locEnd = locations[1];

          const isSameCoord = (a, b) => a[0] === b[0] && a[1] === b[1];
          if (!isSameCoord(coords[0], locStart)) {
            coords.unshift(locStart);
          }
          if (!isSameCoord(coords[coords.length - 1], locEnd)) {
            coords.push(locEnd);
          }
          feature.geometry.coordinates = coords;
        }
      }

      res.send({
        data: {
          status: status,
          message: message,
          geojson_route: geojson_route,
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/tsp",
          reason: `Failed to generate tsp${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/find-option-route", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }

      const { locations, profile, profiles, target_count = 3 } = req.body;

      // alternative routing on ORS only works between a single origin and
      // destination, so the endpoint is deliberately limited to 2 points
      if (!Array.isArray(locations) || locations.length !== 2) {
        return next(
          new InvalidPayloadError({
            reason: "locations harus terdiri dari tepat 2 titik",
          })
        );
      }

      let profileInput = DEFAULT_ROUTE_PROFILES;
      if (Array.isArray(profiles) && profiles.length > 0) {
        profileInput = profiles;
      } else if (profile) {
        profileInput = [profile];
      }
      const profileEntries = profileInput
        .map(normalizeProfileEntry)
        .filter(Boolean);
      if (profileEntries.length === 0) {
        return next(new InvalidPayloadError({ reason: "profile tidak valid" }));
      }

      const targetCount = Math.min(
        Math.max(parseInt(target_count, 10) || 3, 1),
        5
      );
      const locStart = locations[0];
      const locEnd = locations[1];

      const routeOptions = [];
      const seenGeometry = new Set();
      const warnings = [];

      const addRouteOption = (feature, source, label, routeProfile = null) => {
        if (routeOptions.length >= targetCount) return;
        if (!feature?.geometry?.coordinates?.length) return;

        snapRouteToLocations(feature, locStart, locEnd);

        // different strategies often converge on the same road, keep it once
        const signature = JSON.stringify(feature.geometry.coordinates);
        if (seenGeometry.has(signature)) return;
        seenGeometry.add(signature);

        let distance = feature.properties?.summary?.distance ?? null;
        if (distance === null) {
          distance = Number(
            turf
              .length(turf.lineString(feature.geometry.coordinates), {
                units: "meters",
              })
              .toFixed(2)
          );
        }

        routeOptions.push({
          id: routeOptions.length + 1,
          label: label,
          source: source,
          profile: routeProfile,
          distance: distance,
          duration: feature.properties?.summary?.duration ?? null,
          geojson_route: {
            type: "FeatureCollection",
            features: [feature],
          },
        });
      };

      const requestRoutes = async (entry) => {
        try {
          const geojson = await requestOrsDirections(entry.profile, locations, {
            // -1 lifts the 350m default search radius, otherwise points that sit
            // on a plaza or inside a block are rejected as "not routable"
            radiuses: locations.map(() => -1),
            alternative_routes: {
              target_count: Math.min(Math.max(targetCount, 2), 3),
              weight_factor: 1.6,
              share_factor: 0.6,
            },
          });
          return { entry, features: geojson.features ?? [] };
        } catch (error) {
          warnings.push(`${entry.profile}: ${error.message}`);
          logger.warn(
            `find-option-route ${entry.profile} failed: ${error.message}`
          );
          return { entry, features: [] };
        }
      };

      let collected = await Promise.all(profileEntries.map(requestRoutes));

      // walking covers paths no vehicle network has, use it only if the
      // requested profiles came back empty
      if (
        collected.every((c) => c.features.length === 0) &&
        !profileEntries.some((e) => e.profile === FALLBACK_ROUTE_PROFILE)
      ) {
        collected = [
          await requestRoutes(normalizeProfileEntry(FALLBACK_ROUTE_PROFILE)),
        ];
      }

      // take the primary route of every profile first so each transport mode is
      // represented, then fill the remaining slots with their alternatives
      const deepestResult = Math.max(
        0,
        ...collected.map((c) => c.features.length)
      );
      for (let depth = 0; depth < deepestResult; depth++) {
        if (routeOptions.length >= targetCount) break;
        for (const { entry, features } of collected) {
          if (routeOptions.length >= targetCount) break;
          const feature = features[depth];
          if (!feature) continue;
          addRouteOption(
            feature,
            "ors",
            depth === 0 ? entry.label : `${entry.label} - Alternatif ${depth}`,
            entry.profile
          );
        }
      }

      const totalFromOrs = routeOptions.length;

      // last resort so the caller always has something drawable
      if (totalFromOrs === 0) {
        addRouteOption(
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "LineString",
              coordinates: locations,
            },
          },
          "straight_line",
          "Garis lurus"
        );
      }

      res.send({
        data: {
          status: totalFromOrs > 0 ? "success" : "failed",
          message: warnings.length > 0 ? warnings.join(" | ") : null,
          profiles: profileEntries.map((e) => e.profile),
          total_options: routeOptions.length,
          options: routeOptions,
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/find-option-route",
          reason: `Failed to find option route${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/fwa-comparison", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { geojson_area, geojson_comparison } = req.body;

      const features_area = geojson_area.features;
      const features_comparison = geojson_comparison.features;

      let queryComBuff = `
        WITH input_geojson AS (
          SELECT ?::jsonb AS geojson
        ), features AS (
            SELECT
              ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(feature->>'geometry'), 4326),3857) AS geom,
              feature->'properties' AS props
            FROM input_geojson, jsonb_array_elements(geojson) AS feature
        ), buffered AS (
            SELECT ST_Buffer(geom, 300) AS geom, props
            FROM features
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(ST_Transform(geom, 4326))::jsonb,
                'properties', props || jsonb_build_object('fill', '#FF0000')
            ))) AS geojson
          FROM buffered;`;

      let queryTower = `
        WITH input_geojson AS (
          SELECT ?::jsonb AS geojson
        ), polygon_geom AS (
            SELECT ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(feature->>'geometry'), 4326)) AS geom
            FROM input_geojson, jsonb_array_elements(geojson) AS feature
        ), intersected AS (
            SELECT DISTINCT ON (sp.geom)
              sp.*, spt.name AS asset_type_name,
              ST_AsGeoJSON(sp.geom)::jsonb AS geometry
            FROM site_points sp
            INNER JOIN polygon_geom p ON ST_Intersects(sp.geom, p.geom)
            INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id AND spt.name = 'Tower'
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'geometry', geometry,
                'properties', to_jsonb(t) - 'geom'
            ))) AS geojson
          FROM intersected t;`;

      let queryTowerBuff = `
        WITH input_geojson AS (
          SELECT ?::jsonb AS geojson
        ), polygon_geom AS (
            SELECT ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(feature->>'geometry'), 4326)) AS geom
            FROM input_geojson, jsonb_array_elements(geojson) AS feature
        ), intersected AS (
            SELECT DISTINCT ON (sp.geom)
              sp.*, spt.name AS asset_type_name,
              ST_AsGeoJSON(sp.geom)::jsonb AS geometry
            FROM site_points sp
            INNER JOIN polygon_geom p ON ST_Intersects(sp.geom, p.geom)
            INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id AND spt.name = 'Tower'
        ),  buffered AS (
            SELECT
              ST_Transform(ST_Buffer(ST_Transform(t.geom, 3857),300),4326) AS geom, t.id
            FROM intersected t
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(geom)::jsonb,
                'properties', to_jsonb(b) - 'geom' || jsonb_build_object('fill', '#99C743')
            ))) AS geojson
          FROM buffered b;`;

      let queryIntersectCount = `
        WITH tower_buff  AS (
          SELECT ST_SetSRID(ST_GeomFromGeoJSON(feature->>'geometry'), 4326) AS geom
          FROM jsonb_array_elements(?::jsonb) AS feature
        ), comp_buff AS (
            SELECT ST_SetSRID(ST_GeomFromGeoJSON(feature->>'geometry'), 4326) AS geom
            FROM jsonb_array_elements(?::jsonb) AS feature
        ) SELECT COUNT(DISTINCT t.geom)::int  AS count
          FROM tower_buff t
          JOIN comp_buff c ON ST_Intersects(t.geom, c.geom);`;

      let queryAreaDifference = `
        WITH a_input AS (
          SELECT ?::jsonb AS geojson
        ), b_input AS (
            SELECT ?::jsonb AS geojson
        ), c_input AS (
            SELECT ?::jsonb AS geojson
        ), a_geom AS (
            SELECT ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(feature->>'geometry'), 4326)) AS geom
            FROM a_input, jsonb_array_elements(geojson) AS feature
        ), b_geom AS (
            SELECT ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(feature->>'geometry'), 4326)) AS geom
            FROM b_input, jsonb_array_elements(geojson) AS feature
        ), c_geom AS (
            SELECT ST_Union(ST_SetSRID(ST_GeomFromGeoJSON(feature->>'geometry'), 4326)) AS geom
            FROM c_input, jsonb_array_elements(geojson) AS feature
        ), bc_union AS (
            SELECT ST_Union(ARRAY[b.geom, c.geom]) AS geom
            FROM b_geom b, c_geom c
        ), difference AS (
            SELECT ST_Difference(a.geom, bc.geom) AS geom
            FROM a_geom a, bc_union bc
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(geom)::jsonb,
                'properties', jsonb_build_object('source', 'A_minus_BC', 'fill', '#00AEEF')
            ))) AS geojson
          FROM difference
          WHERE NOT ST_IsEmpty(geom);`;

      let queryPotential = `SELECT find_potential_circles(?::jsonb, ?) AS geojson;`;

      const { rows: resultComBuff } = await database.raw(queryComBuff, [
        JSON.stringify(features_comparison),
      ]);
      const { rows: resultTower } = await database.raw(queryTower, [
        JSON.stringify(features_area),
      ]);
      const { rows: resultTowerBuff } = await database.raw(queryTowerBuff, [
        JSON.stringify(features_area),
      ]);
      const { rows: intersectResult } = await database.raw(
        queryIntersectCount,
        [
          JSON.stringify(resultTowerBuff[0].geojson.features),
          JSON.stringify(resultComBuff[0].geojson.features),
        ]
      );
      const { rows: resultAreaDiff } = await database.raw(queryAreaDifference, [
        JSON.stringify(geojson_area.features),
        JSON.stringify(resultTowerBuff[0].geojson.features),
        JSON.stringify(resultComBuff[0].geojson.features),
      ]);
      const { rows: resultPotential } = await database.raw(queryPotential, [
        JSON.stringify(resultAreaDiff[0].geojson.features),
        200,
      ]);

      const resultStats = {
        tower: resultTower[0]?.geojson?.features?.length || 0,
        comparison: resultComBuff[0]?.geojson?.features?.length || 0,
        potential: resultPotential[0]?.geojson?.features?.length || 0,
        intersect: intersectResult[0]?.count || 0,
      };

      // const geojson_all = {
      //   type: "FeatureCollection",
      //   features: [
      //     ...geojson_area.features,
      //     ...resultTower[0].geojson.features,
      //     ...resultTowerBuff[0].geojson.features,
      //     ...geojson_comparison.features,
      //     ...resultComBuff[0].geojson.features,
      //     ...resultAreaDiff[0].geojson.features,
      //     ...resultPotential[0].geojson.features,
      //   ],
      // };

      res.send({
        data: {
          status: "success",
          // geojson_all: geojson_all,
          // geojson_diff: resultAreaDiff[0].geojson,
          geojson_area: geojson_area,
          geojson_tower: resultTower[0].geojson,
          geojson_tower_buffer: resultTowerBuff[0].geojson,
          geojson_comparison: geojson_comparison,
          geojson_comparison_buffer: resultComBuff[0].geojson,
          geojson_potential: resultPotential[0].geojson,
          result: resultStats,
        },
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/fwa-comparison",
          reason: `Failed to generate fwa-comparison${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/fwa-buffer-city", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { city, download = null } = req.body;

      if (!city) {
        return next(
          new InvalidPayloadError({
            reason: "city is required",
          })
        );
      }

      let queryBuffer = `
        WITH tower_buffer AS (
          SELECT
            sp.id AS tower_id, sp.code, sp.name, sp.owner,
            ST_Buffer(sp.geom::geography, 500)::geometry AS geom
          FROM site_points sp
          INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
          INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
          WHERE spt.name = 'Tower' AND ac.city = ?
        ), pairwise_intersect AS (
          SELECT
            a.tower_id AS t1, b.tower_id AS t2,
            ST_Intersection(a.geom, b.geom) AS geom_intersect
          FROM tower_buffer a
          INNER JOIN tower_buffer b ON a.tower_id < b.tower_id
          AND ST_Intersects(a.geom, b.geom)
        ), tower_fp_raw AS (
          SELECT tb.tower_id, COUNT(DISTINCT f.ogc_fid) AS fp_count
          FROM tower_buffer tb
          LEFT JOIN sp_data_footprint f ON f.geom && tb.geom
          AND ST_Intersects(f.geom, tb.geom)
          GROUP BY tb.tower_id
        ), losers_to_cut AS (
          SELECT DISTINCT
            CASE 
              WHEN t1.fp_count > t2.fp_count THEN t2.tower_id
              WHEN t2.fp_count > t1.fp_count THEN t1.tower_id
              ELSE LEAST(t1.tower_id, t2.tower_id)
            END AS tower_id,
            ST_Union(p.geom_intersect) AS geom_to_cut
          FROM pairwise_intersect p
          INNER JOIN tower_fp_raw t1 ON p.t1 = t1.tower_id
          INNER JOIN tower_fp_raw t2 ON p.t2 = t2.tower_id
          GROUP BY CASE 
            WHEN t1.fp_count > t2.fp_count THEN t2.tower_id
            WHEN t2.fp_count > t1.fp_count THEN t1.tower_id
            ELSE LEAST(t1.tower_id, t2.tower_id)
          END
        ), tower_final AS (
          SELECT
            t.tower_id, t.code, t.name, t.owner,
            CASE 
              WHEN l.geom_to_cut IS NOT NULL THEN 
                ST_Difference(t.geom, ST_MakeValid(l.geom_to_cut))
              ELSE t.geom
            END AS geom
          FROM tower_buffer t
          LEFT JOIN losers_to_cut l ON t.tower_id = l.tower_id
        ), tower_hs_summary_raw AS (
          SELECT
            t.tower_id,
            CASE
              WHEN f.hs_class = 'A' THEN 'high'
              WHEN f.hs_class = 'B' THEN 'mid'
              WHEN f.hs_class = 'C' THEN 'low'
              WHEN f.hs_class = 'C1' THEN 'very_low'
              WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
              ELSE f.hs_class
            END AS hs_class,
            COUNT(DISTINCT f.ogc_fid) AS fp_count
          FROM tower_final t
          LEFT JOIN sp_data_footprint f ON f.geom && t.geom
          AND ST_Intersects(f.geom, t.geom)
          WHERE f.hs_class IS NOT NULL
          GROUP BY t.tower_id, hs_class
        ), summary_final AS (
          SELECT 
            tower_id,
            jsonb_object_agg(hs_class, fp_count ORDER BY hs_class) AS fp_by_hs_class,
            SUM(fp_count) AS total
          FROM tower_hs_summary_raw
          GROUP BY tower_id
        ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(jsonb_build_object(
              'type', 'Feature',
              'geometry', ST_AsGeoJSON(t.geom)::jsonb,
              'properties', jsonb_build_object(
                'id', t.tower_id,
                'code', t.code,
                'name', t.name,
                'owner', t.owner,
                'fp_by_hs_class', s.fp_by_hs_class,
                'final_footprint_count', s.total
            )))) AS geojson
          FROM tower_final t
          LEFT JOIN summary_final s ON t.tower_id = s.tower_id;
        `;

      let queryCSV = `
        WITH tower_buffer AS (
          SELECT
            sp.id AS tower_id, sp.code, sp.name, sp.owner, sp.area_city_id, sp.geom AS geom_ori,
            ST_Buffer(sp.geom::geography, 500)::geometry AS geom
          FROM site_points sp
          INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
          INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
          WHERE spt.name='Tower' AND ac.city=?
        ), pairwise_intersect AS (
          SELECT
            a.tower_id AS t1, b.tower_id AS t2,
            ST_Intersection(a.geom, b.geom) AS geom_intersect
          FROM tower_buffer a
          INNER JOIN tower_buffer b ON a.tower_id < b.tower_id
          AND ST_Intersects(a.geom, b.geom)
        ), tower_fp_raw AS (
          SELECT tb.tower_id, COUNT(DISTINCT f.ogc_fid) AS fp_count
          FROM tower_buffer tb
          LEFT JOIN sp_data_footprint f ON f.geom && tb.geom
          AND ST_Intersects(f.geom, tb.geom)
          GROUP BY tb.tower_id
        ), losers_to_cut AS (
          SELECT DISTINCT
            CASE 
              WHEN t1.fp_count > t2.fp_count THEN t2.tower_id
              WHEN t2.fp_count > t1.fp_count THEN t1.tower_id
              ELSE LEAST(t1.tower_id, t2.tower_id)
            END AS tower_id,
            ST_Union(p.geom_intersect) AS geom_to_cut
          FROM pairwise_intersect p
          INNER JOIN tower_fp_raw t1 ON p.t1 = t1.tower_id
          INNER JOIN tower_fp_raw t2 ON p.t2 = t2.tower_id
          GROUP BY CASE 
            WHEN t1.fp_count > t2.fp_count THEN t2.tower_id
            WHEN t2.fp_count > t1.fp_count THEN t1.tower_id
            ELSE LEAST(t1.tower_id, t2.tower_id)
          END
        ), tower_final AS (
          SELECT
            t.tower_id, t.code, t.name, t.owner, t.area_city_id, t.geom_ori,
            CASE 
              WHEN l.geom_to_cut IS NOT NULL THEN 
                ST_Difference(t.geom, ST_MakeValid(l.geom_to_cut))
              ELSE t.geom
            END AS geom
          FROM tower_buffer t
          LEFT JOIN losers_to_cut l ON t.tower_id = l.tower_id
        ), tower_hs_summary_raw AS (
          SELECT
            t.tower_id,
            CASE
              WHEN f.hs_class = 'A' THEN 'high'
              WHEN f.hs_class = 'B' THEN 'mid'
              WHEN f.hs_class = 'C' THEN 'low'
              WHEN f.hs_class = 'C1' THEN 'very_low'
              WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
              ELSE f.hs_class
            END AS hs_class,
            COUNT(DISTINCT f.ogc_fid) AS fp_count
          FROM tower_final t
          LEFT JOIN sp_data_footprint f ON f.geom && t.geom
          AND ST_Intersects(f.geom, t.geom)
          WHERE f.hs_class IS NOT NULL
          GROUP BY t.tower_id, hs_class
        ), summary_final AS (
          SELECT 
            tower_id,
            jsonb_object_agg(hs_class, fp_count ORDER BY hs_class) AS fp_by_hs_class,
            SUM(fp_count) AS total
          FROM tower_hs_summary_raw
          GROUP BY tower_id
        ) SELECT
            t.tower_id AS id, t.code, t.name,
            ac.province, ac.city,
            ST_X(t.geom_ori) AS longitude, ST_Y(t.geom_ori) AS latitude,
            t.owner,
            (h.fp_by_hs_class->>'high')::int AS high,
            (h.fp_by_hs_class->>'mid')::int AS mid,
            (h.fp_by_hs_class->>'low')::int AS low,
            (h.fp_by_hs_class->>'very_low')::int AS very_low,
            (h.fp_by_hs_class->>'non_residential')::int AS non_residential,
            h.total
          FROM tower_final t
          INNER JOIN area_cities ac ON t.area_city_id = ac.ogc_fid
          LEFT JOIN summary_final h ON t.tower_id = h.tower_id;
        `;

      if (download == "csv") {
        const { rows } = await database.raw(queryCSV, [city]);
        if (!rows.length) {
          return next(new DataNotFoundError());
        }
        const csvStream = new Readable({ read() {} });
        let csvFilename = `fwa_buffer_city_${city
          .toLowerCase()
          .replace(/\s+/g, "_")}`;
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${csvFilename}.csv"`
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
      } else {
        const { rows: resultBuffer } = await database.raw(queryBuffer, [city]);
        res.send({
          data: { geojson_buffer: resultBuffer[0].geojson },
        });
      }
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/fwa-buffer-city",
          reason: `Failed to process fwa-buffer-city${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get("/route-recomendations", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const {
        site_from,
        site_to,
        limit_result = 10,
        route_type_id,
      } = req.query;

      if (!site_from || !site_to || !route_type_id) {
        return next(
          new InvalidPayloadError({
            reason: "site_from, site_to and route_type_id is required",
          })
        );
      }
      if (route_type_id && !parseInt(route_type_id)) {
        return next(
          new InvalidPayloadError({
            reason: "route_type_id not in not integer",
          })
        );
      }

      let rtCond = "";
      if (route_type_id) {
        rtCond = `WHERE r.route_type_id=${parseInt(route_type_id)}`;
      }

      const { rows: result } = await database.raw(
        `WITH route_list AS (
          SELECT * FROM pgr_KSP(
          'SELECT r.id, r.site_from AS source, r.site_to AS target, ST_Length(r.geom) AS cost
          FROM routes r ${rtCond}',
          ?::INT, ?::INT, ?::INT, FALSE)
        ), route_data AS (
          SELECT route_list.path_id, r.id AS route_id, r.geom
          FROM route_list
          INNER JOIN routes r ON route_list.edge = r.id
        ), site_data AS (
          SELECT route_list.path_id, ARRAY_AGG(sp.code) as site_points
          FROM route_list
          INNER JOIN site_points sp ON route_list.node = sp.id
            GROUP BY route_list.path_id
        ) SELECT
            json_build_object('type', 'FeatureCollection', 'features', json_agg(ST_AsGeoJSON(t.*)::json)) AS geojson,
            ARRAY_AGG(t.route_id) AS routes,
            site_data.site_points,
            ST_Length(ST_Union(ST_Force2D(geom)),false)::numeric(10,3) AS length
          FROM route_data AS t
          INNER JOIN site_data
          ON t.path_id = site_data.path_id
          GROUP BY t.path_id, site_data.site_points
          ORDER BY t.path_id;`,
        [site_from, site_to, limit_result]
      );
      res.send({ data: result });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/route-recomendations",
          reason: `Failed to process route-recomendations${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/fwa-quadrant", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      // const allowedMethod = ["fixed", "dynamic"];
      const {
        method = "fixed",
        quadrant = 3,
        radius = 500,
        tower_id = [],
      } = req.body;
      let sqlPoly;
      let paramPoly = [];
      if (tower_id.length == 0) {
        return next(
          new InvalidPayloadError({
            reason: "tower_id is required",
          })
        );
      }
      const ids = tower_id.map(() => "?").join(",");
      if (method && method == "fixed") {
        if (quadrant == 3) {
          sqlPoly = `
            WITH tower AS (
              SELECT 
                sp.id AS tower_id,
                sp.geom AS tower_geom,
                ST_Buffer(sp.geom::geography, ?)::geometry AS buffer_geom
              FROM site_points sp
              INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
              WHERE spt.name = 'Tower'
                AND sp.id IN (${ids})
            ),
            -- 1️⃣ Hitung azimuth setiap footprint dari titik tower
            angles AS (
              SELECT
                t.tower_id,
                f.ogc_fid AS footprint_id,
                (degrees(ST_Azimuth(t.tower_geom, ST_Centroid(f.geom))) + 360)::numeric % 360 AS angle_deg
              FROM tower t
              JOIN sp_data_footprint f
              ON f.geom && t.buffer_geom AND ST_Intersects(t.buffer_geom, f.geom)
            ),
            -- 2️⃣ Histogram (bin 10°) untuk cari arah dominan per tower
            angle_bins AS (
              SELECT 
                tower_id,
                FLOOR(angle_deg / 10) * 10 AS angle_bin,
                COUNT(*) AS count_bin
              FROM angles
              GROUP BY tower_id, FLOOR(angle_deg / 10)
            ),
            -- 3️⃣ Ambil sudut dominan per tower
            dominant AS (
              SELECT tower_id, angle_bin AS dominant_angle
              FROM (
                SELECT 
                  tower_id, 
                  angle_bin,
                  count_bin,
                  ROW_NUMBER() OVER (PARTITION BY tower_id ORDER BY count_bin DESC) AS rn
                FROM angle_bins
              ) ranked
              WHERE rn = 1
            ),
            -- 4️⃣ Klasifikasi footprint berdasarkan rotasi sudut dominan
            classified AS (
              SELECT 
                a.tower_id,
                a.footprint_id,
                ((a.angle_deg - d.dominant_angle + 360) % 360) AS rotated_angle,
                CASE
                  WHEN ((a.angle_deg - d.dominant_angle + 360) % 360) < 120 THEN 1
                  WHEN ((a.angle_deg - d.dominant_angle + 360) % 360) < 240 THEN 2
                  ELSE 3
                END AS sector_id
              FROM angles a
              JOIN dominant d USING (tower_id)
            ),
            -- 5️⃣ Hitung jumlah footprint di tiap sektor per tower
            sector_stats AS (
              SELECT
                tower_id,
                sector_id,
                COUNT(*) AS count_footprint
              FROM classified
              GROUP BY tower_id, sector_id
            ),
            -- 6️⃣ Buat poligon sektor per tower
            sector_polygons AS (
              SELECT
                t.tower_id,
                s.sector_id,
                s.count_footprint,
                d.dominant_angle,
                (d.dominant_angle + (s.sector_id - 1) * 120) % 360 AS start_angle,
                (d.dominant_angle + s.sector_id * 120) % 360 AS end_angle,
                ST_Transform(
                  ST_Intersection(
                    t.buffer_geom,
                    ST_MakePolygon(
                      ST_MakeLine(ARRAY[
                        t.tower_geom,
                        ST_Project(t.tower_geom::geography, ?::int, radians((d.dominant_angle + (s.sector_id - 1) * 120) % 360))::geometry,
                        ST_Project(t.tower_geom::geography, ?::int, radians((d.dominant_angle + s.sector_id * 120) % 360))::geometry,
                        t.tower_geom
                      ])
                    )
                  ),
                  4326
                ) AS geom
              FROM tower t
              JOIN dominant d USING (tower_id)
              JOIN sector_stats s USING (tower_id)
            )
            -- 7️⃣ Hasil akhir per tower dalam bentuk GeoJSON
            SELECT
              tower_id,
              jsonb_build_object(
                'type', 'FeatureCollection',
                'features', jsonb_agg(
                  jsonb_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(geom)::jsonb,
                    'properties', jsonb_build_object(
                      'sector_id', sector_id,
                      'count_footprint', count_footprint,
                      'start_angle', start_angle,
                      'end_angle', end_angle,
                      'fill', CASE sector_id
                              WHEN 1 THEN '#FF0000'
                              WHEN 2 THEN '#FFFF00'
                              WHEN 3 THEN '#00FF00'
                            END
                    )
                  )
                )
              ) AS geojson
            FROM sector_polygons
            GROUP BY tower_id;`;
          paramPoly.push(radius, ...tower_id, radius * 2, radius * 2);
        } else if (quadrant == 2) {
          sqlPoly = `
            WITH tower AS (
              SELECT 
                sp.id AS tower_id,
                sp.geom AS tower_geom,
                ST_Buffer(sp.geom::geography, ?)::geometry AS buffer_geom
              FROM site_points sp
              INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
              WHERE spt.name = 'Tower'
                AND sp.id IN (${ids})
            ),
            -- 1️⃣ Hitung azimuth setiap footprint dari titik tower
            angles AS (
              SELECT
                t.tower_id,
                f.ogc_fid AS footprint_id,
                (degrees(ST_Azimuth(t.tower_geom, ST_Centroid(f.geom))) + 360)::numeric % 360 AS angle_deg
              FROM tower t
              JOIN sp_data_footprint f
                ON f.geom && t.buffer_geom 
              AND ST_Intersects(t.buffer_geom, f.geom)
            ),
            -- 2️⃣ Histogram (bin 10°) untuk cari arah dominan per tower
            angle_bins AS (
              SELECT 
                tower_id,
                FLOOR(angle_deg / 10) * 10 AS angle_bin,
                COUNT(*) AS count_bin
              FROM angles
              GROUP BY tower_id, FLOOR(angle_deg / 10)
            ),
            -- 3️⃣ Ambil sudut dominan per tower
            dominant AS (
              SELECT tower_id, angle_bin AS dominant_angle
              FROM (
                SELECT 
                  tower_id, 
                  angle_bin,
                  count_bin,
                  ROW_NUMBER() OVER (PARTITION BY tower_id ORDER BY count_bin DESC) AS rn
                FROM angle_bins
              ) ranked
              WHERE rn = 1
            ),
            -- 4️⃣ Klasifikasi footprint menjadi 2 sektor (berdasar rotasi dari arah dominan)
            classified AS (
              SELECT 
                a.tower_id,
                a.footprint_id,
                ((a.angle_deg - d.dominant_angle + 360) % 360) AS rotated_angle,
                CASE
                  WHEN ((a.angle_deg - d.dominant_angle + 360) % 360) < 180 THEN 1
                  ELSE 2
                END AS sector_id
              FROM angles a
              JOIN dominant d USING (tower_id)
            ),
            -- 5️⃣ Hitung jumlah footprint di tiap sektor per tower
            sector_stats AS (
              SELECT
                tower_id,
                sector_id,
                COUNT(*) AS count_footprint
              FROM classified
              GROUP BY tower_id, sector_id
            ),
            -- 6️⃣ Buat poligon sektor per tower (2 kuadran)
            sector_polygons AS (
              SELECT
                t.tower_id,
                s.sector_id,
                ss.count_footprint,
                d.dominant_angle,
                (d.dominant_angle + (s.sector_id - 1) * 180) % 360 AS start_angle,
                (d.dominant_angle + s.sector_id * 180) % 360 AS end_angle,
                ST_Transform(
                  ST_MakePolygon(
                    ST_MakeLine(ARRAY[
                      t.tower_geom
                    ] || ARRAY(
                      SELECT ST_Project(
                              t.tower_geom::geography,
                              ?::int,
                              radians((d.dominant_angle + (s.sector_id - 1) * 180 + i) % 360)
                            )::geometry
                      FROM generate_series(0, 180, 5) AS i
                    ) || ARRAY[t.tower_geom])
                  ),
                  4326
                ) AS geom
              FROM tower t
              JOIN dominant d USING (tower_id)
              CROSS JOIN LATERAL (
                SELECT generate_series(1, 2) AS sector_id
              ) s
              LEFT JOIN sector_stats ss
                ON ss.tower_id = t.tower_id AND ss.sector_id = s.sector_id
            )
            -- 7️⃣ Hasil akhir per tower dalam bentuk GeoJSON
            SELECT
              tower_id,
              jsonb_build_object(
                'type', 'FeatureCollection',
                'features', jsonb_agg(
                  jsonb_build_object(
                    'type', 'Feature',
                    'geometry', ST_AsGeoJSON(geom)::jsonb,
                    'properties', jsonb_build_object(
                      'sector_id', sector_id,
                      'count_footprint', count_footprint,
                      'dominant_angle', dominant_angle,
                      'start_angle', start_angle,
                      'end_angle', end_angle,
                      'fill', CASE sector_id
                                WHEN 1 THEN '#FF0000'
                                ELSE '#00FF00'
                              END
                    )
                  )
                )
              ) AS geojson
            FROM sector_polygons
            GROUP BY tower_id;`;
          paramPoly.push(radius, ...tower_id, radius);
        } else {
          return next(
            new InvalidPayloadError({
              reason: "allowed quadrant is 2 or 3",
            })
          );
        }
      } else if (method == "dynamic") {
        sqlPoly = `
        WITH tower AS (
          SELECT
            sp.id AS tower_id, sp.geom AS tower_geom,
            ST_Buffer(sp.geom::geography, ?)::geometry AS buffer_geom
          FROM site_points sp
          INNER JOIN site_point_types spt ON sp.site_point_type_id = spt.id
          WHERE spt."name" = 'Tower' AND sp.id IN (${ids})
        ),
        angles AS (
          SELECT
            t.tower_id, f.ogc_fid AS footprint_id,
            (degrees(ST_Azimuth(t.tower_geom, ST_Centroid(f.geom))) + 360)::numeric % 360 AS angle_deg
          FROM tower t
          INNER JOIN sp_data_footprint f ON f.geom && t.buffer_geom
          AND ST_Intersects(t.buffer_geom, f.geom)
        ),
        ranked AS (
          SELECT
            tower_id, footprint_id, angle_deg,
            NTILE(3) OVER (PARTITION BY tower_id ORDER BY angle_deg) AS sector_id
          FROM angles
        ),
        sector_stats AS (
          SELECT
            tower_id, sector_id, COUNT(*) AS count_footprint,
            MIN(angle_deg) AS start_angle, MAX(angle_deg) AS end_angle
          FROM ranked
          GROUP BY tower_id, sector_id
        ),
        sector_fixed AS (
          SELECT
            tower_id, sector_id, count_footprint, start_angle,
            LEAD(start_angle) OVER (PARTITION BY tower_id ORDER BY start_angle) AS next_start
          FROM sector_stats
        ),
        sector_adjusted AS (
          SELECT
            f.tower_id, f.sector_id, f.count_footprint,
            ROUND(f.start_angle) AS start_angle,
            ROUND(COALESCE(f.next_start,FIRST_VALUE(f.start_angle) OVER (PARTITION BY f.tower_id ORDER BY f.start_angle) + 360)) AS end_angle,
            ROUND(100*(COALESCE(f.next_start,FIRST_VALUE(f.start_angle) OVER (PARTITION BY f.tower_id ORDER BY f.start_angle) + 360) - f.start_angle) / 360.0,2) AS angle_percentage
          FROM sector_fixed f
        ),
        sector_polygons AS (
          SELECT
            t.tower_id, s.sector_id, s.count_footprint,
            s.start_angle, s.end_angle, s.angle_percentage,
            ST_MakePolygon(
              ST_MakeLine(
                ARRAY[
                  t.tower_geom
                ] ||
                ARRAY(
                  SELECT ST_Project(
                    t.tower_geom::geography,
                    ?::int,
                    radians(a)
                  )::geometry
                  FROM generate_series(s.start_angle, s.end_angle, 1) AS a
                ) ||
                ARRAY[t.tower_geom]
              )
            ) AS geom
          FROM tower t
          INNER JOIN sector_adjusted s ON t.tower_id = s.tower_id
        )
        SELECT
          tower_id,
          jsonb_build_object(
            'type', 'FeatureCollection',
            'features', jsonb_agg(
              jsonb_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(ST_Transform(geom, 4326))::jsonb,
                'properties', jsonb_build_object(
                  'sector_id', sector_id,
                  'count_footprint', count_footprint,
                  'start_angle', start_angle,
                  'end_angle', end_angle,
                  'angle_percentage', angle_percentage||'%',
                  'fill', CASE sector_id
                            WHEN 1 THEN '#FF0000'
                            WHEN 2 THEN '#FFFF00'
                            WHEN 3 THEN '#00FF00'
                          END
                )
              )
            )
          ) AS geojson
        FROM sector_polygons
        GROUP BY tower_id;`;
        paramPoly.push(radius, ...tower_id, radius);
      } else {
        return next(
          new InvalidPayloadError({
            reason: "methode not allowed",
          })
        );
      }

      const { rows: resultQ } = await database.raw(sqlPoly, paramPoly);
      const { rows: resultFp } = await database.raw(
        `WITH tower_buffer AS (
            SELECT 
              sp.id AS tower_id,
              ST_Buffer(sp.geom::geography, ?)::geometry AS geom
            FROM site_points sp
            WHERE sp.id IN (${ids})
        ), joined AS (
          SELECT t.tower_id, f.ogc_fid, f.hs_class, f.geom
          FROM sp_data_footprint f
          INNER JOIN tower_buffer t ON f.geom && t.geom
          AND ST_Intersects(f.geom, t.geom)
        ) SELECT 
            j.tower_id,
            jsonb_build_object(
              'type',     'FeatureCollection',
              'features', jsonb_agg(
                jsonb_build_object(
                  'type',       'Feature',
                  'geometry',   ST_AsGeoJSON(j.geom)::jsonb,
                  'properties', jsonb_build_object(
                    'ogc_fid',  j.ogc_fid,
                    'hs_class', j.hs_class
                  )) ORDER BY j.hs_class)) AS geojson
          FROM joined j
          GROUP BY j.tower_id;`,
        [radius, ...tower_id]
      );
      const finalResult = resultQ.map((src) => {
        const { tower_id, geojson: geojson_quadrant } = src;
        const fp = resultFp.find((b) => b.tower_id === tower_id);

        return {
          tower_id,
          geojson_quadrant,
          geojson_footprint: fp ? fp.geojson : null,
        };
      });
      res.send({
        data: finalResult,
      });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/fwa-quadrant",
          reason: `Failed to process fwa quadrant${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/fwa-quadrant/csv", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      const { tower_id, geojson_quadrant } = req.body;
      const { rows } = await database.raw(
        `WITH input_geojson AS (
          SELECT ?::json AS fc, ?::int AS tower_id
        ), tower AS (
          SELECT
            tower_id,
            f->'properties'->>'sector_id' AS sector_id,
            f->'properties'->>'start_angle' AS start_angle,
		        f->'properties'->>'end_angle' AS end_angle,
            ST_SetSRID(ST_GeomFromGeoJSON(f->>'geometry'),4326) AS geom
          FROM input_geojson, json_array_elements(fc) AS f
        ), tower_hs_summary_raw AS (
          SELECT
            t.tower_id, t.sector_id,
            CASE
              WHEN f.hs_class = 'A' THEN 'high'
              WHEN f.hs_class = 'B' THEN 'mid'
              WHEN f.hs_class = 'C' THEN 'low'
              WHEN f.hs_class = 'C1' THEN 'very_low'
              WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
              ELSE 'other'
            END AS hs_class,
            COUNT(DISTINCT f.ogc_fid) AS fp_count
          FROM tower t
          LEFT JOIN sp_data_footprint f ON f.geom && t.geom AND ST_Intersects(f.geom, t.geom)
          WHERE f.hs_class IS NOT NULL
          GROUP BY t.tower_id, t.sector_id, f.hs_class
        ), tower_hs_summary AS (
          SELECT
            t.tower_id, t.sector_id,
            COALESCE(jsonb_object_agg(r.hs_class, r.fp_count) FILTER (WHERE r.hs_class IS NOT NULL),'{}'::jsonb) AS fp_by_hs_class
          FROM tower t
          LEFT JOIN tower_hs_summary_raw r ON t.tower_id = r.tower_id AND t.sector_id = r.sector_id
          GROUP BY t.tower_id, t.sector_id
        ) SELECT
            sp.id, sp.code, sp.name,
            ac.province, ac.city,
            t.sector_id, t.start_angle, t.end_angle,
            ST_X(sp.geom) AS longitude, ST_Y(sp.geom) AS latitude,
            sp.owner,
            COALESCE((h.fp_by_hs_class->>'high')::int, 0) AS high,
            COALESCE((h.fp_by_hs_class->>'mid')::int, 0) AS mid,
            COALESCE((h.fp_by_hs_class->>'low')::int, 0) AS low,
            COALESCE((h.fp_by_hs_class->>'very_low')::int, 0) AS very_low,
            COALESCE((h.fp_by_hs_class->>'non_residential')::int, 0) AS non_residential,
            COALESCE((h.fp_by_hs_class->>'high')::int, 0) +
            COALESCE((h.fp_by_hs_class->>'mid')::int, 0) +
            COALESCE((h.fp_by_hs_class->>'low')::int, 0) +
            COALESCE((h.fp_by_hs_class->>'very_low')::int, 0) +
            COALESCE((h.fp_by_hs_class->>'non_residential')::int, 0) +
            COALESCE((h.fp_by_hs_class->>'other')::int, 0)
            AS total
          FROM tower t
          INNER JOIN site_points sp ON sp.id = t.tower_id
          INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
          LEFT JOIN tower_hs_summary h ON t.tower_id = h.tower_id AND t.sector_id = h.sector_id
        ;`,
        [JSON.stringify(geojson_quadrant.features), tower_id]
      );
      if (!rows.length) {
        return next(new DataNotFoundError());
      }

      const csvStream = new Readable({ read() {} });
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="fwa_quadran_tower_${tower_id}_result.csv"`
      );
      res.setHeader("Content-Type", "text/csv");

      const headers = Object.keys(rows[0]).map((header) => `"${header}"`);
      csvStream.push(headers.join(",") + "\n");

      for (const row of rows) {
        const values = headers.map((header) => {
          const value = row[header.replace(/"/g, "")];
          return header === '"geom"' ? `"${value.replace(/"/g, '""')}"` : value;
        });
        csvStream.push(values.join(",") + "\n");
      }

      csvStream.push(null);
      csvStream.pipe(res);
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/fwa-quadrant/csv",
          reason: `Failed to download csv${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/fwa-quadrant-direction", async (req, res, next) => {
    try {
      const { tower_ids, radius = 100 } = req.body;

      if (!tower_ids || !tower_ids.length) {
        return next(new InvalidPayloadError({ reason: "tower_ids required" }));
      }

      const sql = `
        WITH tower AS (
          SELECT sp.id AS tower_id, sp.geom AS tower_geom, ST_Buffer(sp.geom::geography,?)::geometry AS buffer_geom
          FROM site_points sp
          WHERE sp.id = ANY(?::int[])
        ), angles AS (
          SELECT t.tower_id, (degrees(ST_Azimuth(t.tower_geom, ST_Centroid(f.geom))) + 360)::numeric % 360 AS angle_deg
          FROM tower t
          INNER JOIN sp_data_footprint f ON f.geom && t.buffer_geom
          AND ST_Intersects(f.geom, t.buffer_geom)
        ) SELECT c.tower_id, c.sector_id, ST_AsGeoJSON(t.tower_geom)::jsonb AS tower_geom, c.jumlah_fp
        FROM (
          SELECT
            tower_id,
              CASE
                WHEN angle_deg < 120 THEN 1
                WHEN angle_deg < 240 THEN 2
                ELSE 3
              END AS sector_id,
              COUNT(*) AS jumlah_fp
              FROM angles
              GROUP BY tower_id, sector_id
        ) c
        INNER JOIN tower t ON t.tower_id = c.tower_id
        ORDER BY c.tower_id, c.sector_id;
    `;

      const { rows } = await database.raw(sql, [radius, tower_ids]);
      const towerMap = {};

      for (const row of rows) {
        if (!towerMap[row.tower_id]) {
          towerMap[row.tower_id] = {
            tower_geom: row.tower_geom,
            sectors: [],
          };
        }
        towerMap[row.tower_id].sectors.push({
          sector_id: row.sector_id,
          count: Number(row.jumlah_fp),
        });
      }

      const sectorAngles = {
        1: [0, 120],
        2: [120, 240],
        3: [240, 360],
      };
      const sectorMid = {
        1: 60,
        2: 180,
        3: 300,
      };
      const colors = {
        1: "#FF0000",
        2: "#00FF00",
        3: "#0000FF",
      };

      function createSectorPolygon(towerPoint, startAngle, endAngle) {
        const steps = 60;
        const step = (endAngle - startAngle) / steps;
        const coords = [towerPoint.geometry.coordinates];

        for (let i = 0; i <= steps; i++) {
          const angle = startAngle + i * step;
          const pt = turf.destination(towerPoint, radius, angle, {
            units: "meters",
          });
          coords.push(pt.geometry.coordinates);
        }

        coords.push(towerPoint.geometry.coordinates);
        return turf.polygon([coords]);
      }

      function createDirectionLine(towerPoint, angle) {
        const halfRadius = radius / 2;
        const end = turf.destination(towerPoint, halfRadius, angle, {
          units: "meters",
        });

        return turf.lineString([
          towerPoint.geometry.coordinates,
          end.geometry.coordinates,
        ]);
      }

      const output = [];
      for (const towerId in towerMap) {
        const towerData = towerMap[towerId];
        const towerPoint = turf.point(towerData.tower_geom.coordinates);
        const sectors = towerData.sectors;

        // dominant sector
        const dominant = sectors.reduce((max, s) =>
          s.count > max.count ? s : max
        );
        const direction = sectorMid[dominant.sector_id];

        // Quadrant polygons
        const features = [];
        for (const s of sectors) {
          const [start, end] = sectorAngles[s.sector_id];
          const poly = createSectorPolygon(towerPoint, start, end);
          poly.properties = {
            fill: colors[s.sector_id],
            start_angle: start,
            end_angle: end,
            sector_id: s.sector_id,
            count_footprint: s.count,
          };
          features.push(poly);
        }

        const geojsonQuadrant = {
          type: "FeatureCollection",
          features,
        };

        // Direction line
        const line = createDirectionLine(towerPoint, direction);
        const geojsonDirection = {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: line.geometry,
              properties: {
                direction,
              },
            },
          ],
        };

        output.push({
          tower_id: Number(towerId),
          direction,
          geojson_quadrant: geojsonQuadrant,
          geojson_direction: geojsonDirection,
        });
      }

      //FP
      const { rows: resultFp } = await database.raw(
        `WITH tower_buffer AS (
          SELECT sp.id AS tower_id, ST_Buffer(sp.geom::geography, ?)::geometry AS geom
          FROM site_points sp
          WHERE sp.id = ANY(?::int[])
        ), joined AS (
          SELECT t.tower_id, f.ogc_fid, f.hs_class, f.geom
          FROM sp_data_footprint f
          INNER JOIN tower_buffer t ON f.geom && t.geom
          AND ST_Intersects(f.geom, t.geom)
        ) SELECT 
            j.tower_id,
            jsonb_build_object(
              'type',     'FeatureCollection',
              'features', jsonb_agg(
                jsonb_build_object(
                  'type',       'Feature',
                  'geometry',   ST_AsGeoJSON(j.geom)::jsonb,
                  'properties', jsonb_build_object(
                    'ogc_fid',  j.ogc_fid,
                    'hs_class', j.hs_class
                  )) ORDER BY j.hs_class)) AS geojson
          FROM joined j
          GROUP BY j.tower_id;`,
        [radius, tower_ids]
      );

      const finalResult = output.map((src) => {
        const { tower_id } = src;
        const fp = resultFp.find((b) => b.tower_id === tower_id);

        return {
          ...src,
          geojson_footprint: fp ? fp.geojson : null,
        };
      });

      return res.json({ data: finalResult });
    } catch (err) {
      next(err);
    }
  });
  router.post("/fwa-quadrant-direction/csv", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }

      const radius = Number(req.body.radius) || 100;
      const towerIds = req.body.tower_ids.map(Number);

      const { rows } = await database.raw(
        `WITH tower AS (
          SELECT sp.id AS tower_id, sp.geom AS tower_geom, ST_Buffer(sp.geom::geography,?)::geometry AS buffer_geom
          FROM site_points sp
          WHERE sp.id = ANY(?::int[])
        ), angles AS (
          SELECT
            t.tower_id,
            CASE
              WHEN (degrees(ST_Azimuth(t.tower_geom, ST_Centroid(f.geom))) + 360)::numeric % 360 < 120 THEN 1
              WHEN (degrees(ST_Azimuth(t.tower_geom, ST_Centroid(f.geom))) + 360)::numeric % 360 < 240 THEN 2
              ELSE 3
            END AS sector_id,
            CASE
              WHEN f.hs_class = 'A' THEN 'high'
              WHEN f.hs_class = 'B' THEN 'mid'
              WHEN f.hs_class = 'C' THEN 'low'
              WHEN f.hs_class = 'C1' THEN 'very_low'
              WHEN f.hs_class = 'Non-Residential' THEN 'non_residential'
              ELSE 'other'
            END AS hs_class,
            f.ogc_fid
        FROM tower t
        INNER JOIN sp_data_footprint f ON f.geom && t.buffer_geom
        AND ST_Intersects(f.geom, t.buffer_geom)
        WHERE f.hs_class IS NOT NULL
      ), tower_hs_summary_raw AS (
        SELECT tower_id, sector_id, hs_class, COUNT(DISTINCT ogc_fid) AS fp_count
        FROM angles
        GROUP BY tower_id, sector_id, hs_class
      ), tower_hs_summary AS (
        SELECT
          tower_id, sector_id,
          jsonb_object_agg(hs_class,fp_count) AS fp_by_hs_class
        FROM tower_hs_summary_raw
        GROUP BY tower_id, sector_id
      ) SELECT
          sp.id, sp.code, sp.name,
          ac.province, ac.city,
          s.sector_id,
          CASE
            WHEN s.sector_id = 1 THEN 0
            WHEN s.sector_id = 2 THEN 120
            ELSE 240
          END AS start_angle,
          CASE
            WHEN s.sector_id = 1 THEN 120
            WHEN s.sector_id = 2 THEN 240
            ELSE 360
          END AS end_angle,
          ST_X(sp.geom) AS longitude,
          ST_Y(sp.geom) AS latitude,
          sp.owner,
          COALESCE((s.fp_by_hs_class->>'high')::int,0) AS high,
          COALESCE((s.fp_by_hs_class->>'mid')::int,0) AS mid,
          COALESCE((s.fp_by_hs_class->>'low')::int,0) AS low,
          COALESCE((s.fp_by_hs_class->>'very_low')::int,0) AS very_low,
          COALESCE((s.fp_by_hs_class->>'non_residential')::int,0) AS non_residential,
          COALESCE((s.fp_by_hs_class->>'high')::int,0) +
          COALESCE((s.fp_by_hs_class->>'mid')::int,0) +
          COALESCE((s.fp_by_hs_class->>'low')::int,0) +
          COALESCE((s.fp_by_hs_class->>'very_low')::int,0) +
          COALESCE((s.fp_by_hs_class->>'non_residential')::int,0) +
          COALESCE((s.fp_by_hs_class->>'other')::int,0) AS total
      FROM tower_hs_summary s
      INNER JOIN site_points sp ON sp.id = s.tower_id
      INNER JOIN area_cities ac ON sp.area_city_id = ac.ogc_fid
      ORDER BY s.tower_id, s.sector_id
      ;`,
        [radius, towerIds]
      );

      if (!rows.length) {
        return next(new DataNotFoundError());
      }

      function buildDirectionByTower(rows = []) {
        const sectorDirection = {
          1: 60,
          2: 180,
          3: 300,
        };

        const result = [];
        // group per tower
        const map = new Map();
        for (const r of rows) {
          const key = r.id; // atau r.tower_id kalau beda
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(r);
        }

        // process per tower
        for (const [towerId, list] of map.entries()) {
          // 🔥 cari dominant sector
          let dominant = list[0];
          for (const r of list) {
            if (Number(r.total) > Number(dominant.total)) {
              dominant = r;
            }
          }
          // assign direction
          for (const r of list) {
            result.push({
              ...r,
              direction:
                r.sector_id === dominant.sector_id
                  ? sectorDirection[dominant.sector_id]
                  : null,
            });
          }
        }
        return result;
      }

      const finalData = buildDirectionByTower(rows);

      // =============================
      // CSV STREAM
      // =============================

      const csvStream = new Readable({ read() {} });

      res.setHeader(
        "Content-Disposition",
        `attachment; filename="fwa_quadrant_result.csv"`
      );

      res.setHeader("Content-Type", "text/csv");

      const headers = Object.keys(finalData[0]);

      csvStream.push(headers.join(",") + "\n");

      for (const row of finalData) {
        const values = headers.map((h) => row[h]);

        csvStream.push(values.join(",") + "\n");
      }

      csvStream.push(null);
      csvStream.pipe(res);
    } catch (error) {
      logger.error(error);

      return next(
        new ServiceUnavailableError({
          service: "analysis/fwa-quadrant-direction/csv",
          reason: `Failed to download csv ${error?.message || ""}`,
        })
      );
    }
  });
  router.post("/fwa-quick-market-insight", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      let {
        mode = "default",
        area_city_ids = [],
        file_id,
        radius = 0,
        priority = [],
        sector_count = 3,
        name,
      } = req.body;
      if (mode == "default") {
        mode = "default";
        if (area_city_ids.length < 1 || area_city_ids.length > 3) {
          return next(
            new InvalidPayloadError({ reason: "area_city_ids min 1 and max 3" })
          );
        }
      } else if (mode == "upload") {
        if (!file_id) {
          return next(
            new InvalidPayloadError({
              reason: "file_id required for upload mode",
            })
          );
        }
      } else {
        return next(
          new InvalidPayloadError({
            reason: "mode not allowed",
          })
        );
      }

      if (radius < 1 || radius > 500) {
        return next(
          new InvalidPayloadError({ reason: "radius min 1 and max 500" })
        );
      }
      if (sector_count < 2 || sector_count > 3) {
        return next(
          new InvalidPayloadError({
            sector_count: "sector_count min 2 and max 3",
          })
        );
      }
      if (priority.length < 1) {
        priority = null;
      }
      const messageId = crypto.randomUUID();
      const now = new Date();
      const task = "quick_market_insight";
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
              mode: mode,
              user: accountability.user,
              geoprocessing_uuid: messageId,
              radius: radius,
              area_city_ids: area_city_ids,
              file_id: file_id,
              priority: priority,
              sector_count: sector_count,
              analysis_name: name,
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
      return res.json({ message_id: messageId });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/fwa-quick-market-insight",
          reason: `Failed process fwa-quick-market-insight${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/fwa-quick-market-insight-merge", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      let { qmi_id = [], name } = req.body;

      if (qmi_id.length < 2) {
        return next(new InvalidPayloadError({ reason: "qmi_id min 2 " }));
      }

      const messageId = crypto.randomUUID();
      const now = new Date();
      const task = "quick_market_insight_merge";
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
              user: accountability.user,
              geoprocessing_uuid: messageId,
              qmi_id: qmi_id,
              analysis_name: name,
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
      return res.json({ message_id: messageId });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/fwa-quick-market-insight-merge",
          reason: `Failed process fwa-quick-market-insight-merge${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/route-insight", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      let { qmi_id, name } = req.body;

      if (!qmi_id) {
        return next(new InvalidPayloadError({ reason: "qmi_id required " }));
      }

      const messageId = crypto.randomUUID();
      const now = new Date();
      const task = "route_insight";
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
              qmi_id: qmi_id,
              user: accountability.user,
              geoprocessing_uuid: messageId,
              analysis_name: name,
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
      return res.json({ message_id: messageId });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/route-insight",
          reason: `Failed process route-insight${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/fwa-quick-potential-insight", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      let {
        mode = "default",
        area_city_ids = [],
        file_id,
        radius = 0,
        name,
      } = req.body;
      if (mode == "default") {
        mode = "default";
        if (area_city_ids.length < 1 || area_city_ids.length > 3) {
          return next(
            new InvalidPayloadError({ reason: "area_city_ids min 1 and max 3" })
          );
        }
      } else if (mode == "upload") {
        if (!file_id) {
          return next(
            new InvalidPayloadError({
              reason: "file_id required for upload mode",
            })
          );
        }
      } else {
        return next(
          new InvalidPayloadError({
            reason: "mode not allowed",
          })
        );
      }

      if (radius < 1 || radius > 500) {
        return next(
          new InvalidPayloadError({ reason: "radius min 1 and max 500" })
        );
      }
      const messageId = crypto.randomUUID();
      const now = new Date();
      const task = "quick_potential_insight";
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
              mode: mode,
              user: accountability.user,
              geoprocessing_uuid: messageId,
              radius: radius,
              area_city_ids: area_city_ids,
              file_id: file_id,
              analysis_name: name,
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
      return res.json({ message_id: messageId });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/fwa-quick-potential-insight",
          reason: `Failed process fwa-quick-potential-insight${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/poi-quick-insight", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      let { geojson_area, categories = [], name } = req.body;

      if (!geojson_area) {
        return next(
          new InvalidPayloadError({ reason: "geojson_area required " })
        );
      }

      //lanjutkan geojson area ubah menjadi file dan upload via minio
      const geojsonString = JSON.stringify(geojson_area);
      const geojsonBuffer = Buffer.from(geojsonString, "utf-8");

      const fileId = crypto.randomUUID();
      const fileKey = `${fileId}.geojson`;
      const fileSize = geojsonBuffer.length;
      const fileNameMinio = storageRoot + `${fileKey}`;

      await minioClient.putObject(
        storageBucket,
        fileNameMinio,
        geojsonBuffer,
        geojsonBuffer.length,
        { "Content-Type": "application/json" }
      );
      logger.info(`Uploaded GeoJSON to MinIO as ${fileKey}`);
      await database("directus_files").insert({
        id: fileId,
        storage: storageLocation,
        filename_disk: fileKey,
        filename_download: fileKey,
        type: "application/json",
        folder: ANALYSIS_FOLDER_ID,
        uploaded_by: accountability.user,
        uploaded_on: database.fn.now(),
        filesize: fileSize,
        title: fileId,
      });
      logger.info(`✔ Registered file in directus_files: ${fileId}`);

      const messageId = crypto.randomUUID();
      const now = new Date();
      const task = "poi_quick_insight";
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
              user: accountability.user,
              geoprocessing_uuid: messageId,
              // geojson_area: geojson_area,
              file_id: fileKey,
              categories: categories,
              analysis_name: name,
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
      return res.json({ message_id: messageId });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/poi-quick-insight",
          reason: `Failed process poi-quick-insight${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/poi-route-insight", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      let { poi_insight_result_id, name } = req.body;

      if (!poi_insight_result_id) {
        return next(
          new InvalidPayloadError({ reason: "poi_insight_result_id required " })
        );
      }

      const messageId = crypto.randomUUID();
      const now = new Date();
      const task = "poi_route_insight";
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
              poi_insight_result_id: poi_insight_result_id,
              user: accountability.user,
              geoprocessing_uuid: messageId,
              analysis_name: name,
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
      return res.json({ message_id: messageId });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/poi-route-insight",
          reason: `Failed process poi-route-insight${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.post("/fwa-antenna-direction", async (req, res, next) => {
    try {
      const { accountability } = req;
      if (!accountability.user) {
        return next(new ForbiddenError());
      }
      let {
        mode = "default",
        area_city_ids = [],
        file_id,
        radius = 0,
        name,
      } = req.body;
      if (mode == "default") {
        mode = "default";
        if (area_city_ids.length < 1 || area_city_ids.length > 3) {
          return next(
            new InvalidPayloadError({ reason: "area_city_ids min 1 and max 3" })
          );
        }
      } else if (mode == "upload") {
        if (!file_id) {
          return next(
            new InvalidPayloadError({
              reason: "file_id required for upload mode",
            })
          );
        }
      } else {
        return next(
          new InvalidPayloadError({
            reason: "mode not allowed",
          })
        );
      }

      if (radius < 1 || radius > 500) {
        return next(
          new InvalidPayloadError({ reason: "radius min 1 and max 500" })
        );
      }
      const messageId = crypto.randomUUID();
      const now = new Date();
      const task = "antenna_direction";
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
              mode: mode,
              user: accountability.user,
              geoprocessing_uuid: messageId,
              radius: radius,
              area_city_ids: area_city_ids,
              file_id: file_id,
              analysis_name: name,
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
      return res.json({ message_id: messageId });
    } catch (error) {
      logger.error(error);
      return next(
        new ServiceUnavailableError({
          service: "analysis/fwa-quick-potential-insight",
          reason: `Failed process fwa-quick-potential-insight${
            error?.message ? " : " + error.message : ""
          }`,
        })
      );
    }
  });
  router.get(
    "/fwa-antenna-direction/download/:format",
    async (req, res, next) => {
      try {
        const { accountability } = req;
        if (!accountability.user) {
          return next(new ForbiddenError());
        }

        const { format } = req.params;
        const allowedFormat = ["csv", "kml"];
        if (!allowedFormat.includes(format)) {
          return next(
            new InvalidPayloadError({
              reason: "allowed format is csv or kml",
            })
          );
        }

        const { antenna_direction_id } = req.query;
        if (!antenna_direction_id) {
          return next(
            new InvalidPayloadError({
              reason: "antenna_direction_id required",
            })
          );
        }

        const query = `
          SELECT
            d."name" AS analysis_name, d.radius_m,
            i.tower_source, i.tower_id, i.tower_name, i.tower_code, i.tower_owner,
            ST_Y(i.geom) AS latitude, ST_X(i.geom) AS longitude,
            i.s1_azimuth, i.s1_beam_width, i.s1_coverage_area_m2, i.s1_footprint_count, i.s1_footprint_details,
            i.s2_azimuth, i.s2_beam_width, i.s2_coverage_area_m2, i.s2_footprint_count, i.s2_footprint_details,
            i.s3_azimuth, i.s3_beam_width, i.s3_coverage_area_m2, i.s3_footprint_count, i.s3_footprint_details
          FROM antenna_direction d
          INNER JOIN antenna_direction_item i ON d.id = i.antenna_direction_id
          WHERE d.id = ?;
        `;

        const { rows } = await database.raw(query, [antenna_direction_id]);
        if (!rows.length) {
          return next(new DataNotFoundError());
        }

        const baseName = `antenna_direction_${antenna_direction_id}`;

        if (format === "csv") {
          const csvStream = new Readable({ read() {} });
          res.setHeader(
            "Content-Disposition",
            `attachment; filename="${baseName}.csv"`
          );
          res.setHeader("Content-Type", "text/csv");

          const columns = Object.keys(rows[0]);
          csvStream.push(columns.map((c) => `"${c}"`).join(",") + "\n");

          for (const row of rows) {
            const values = columns.map((col) => {
              let value = row[col];
              if (value === null || value === undefined) {
                return "";
              }
              if (typeof value === "object") {
                value = JSON.stringify(value);
              }
              return `"${String(value).replace(/"/g, '""')}"`;
            });
            csvStream.push(values.join(",") + "\n");
          }

          csvStream.push(null);
          return csvStream.pipe(res);
        }

        // format === "kml" : build two folders (Antenna points & Antenna Sector polygons)
        const steps = 32;

        // Antenna points (reuse geojson/fwa/antenna query)
        const { rows: antennaRows } = await database.raw(
          `SELECT jsonb_build_object(
              'type', 'FeatureCollection',
              'features', COALESCE(jsonb_agg(
                jsonb_build_object(
                  'type', 'Feature',
                  'id', item.id,
                  'geometry', ST_AsGeoJSON(item.geom)::jsonb,
                  'properties', jsonb_build_object(
                    'tower_id', item.tower_id,
                    'tower_name', item.tower_name,
                    'tower_code', item.tower_code,
                    'tower_owner', item.tower_owner,
                    'tower_source', item.tower_source
                  )
                )
              ), '[]'::jsonb)
            ) AS geojson
            FROM antenna_direction main
            INNER JOIN antenna_direction_item item ON main.id = item.antenna_direction_id
            WHERE main.id = ?
          ;`,
          [antenna_direction_id]
        );

        // Antenna sectors (reuse geojson/fwa/antenna_sector query)
        const { rows: sectorRows } = await database.raw(
          `WITH sectors AS (
            SELECT
              item.id AS item_id, 
              item.tower_id,
              item.tower_name, 
              item.geom,
              main.radius_m::double precision AS radius_m, -- Cast ke double precision
              s.sector_no, 
              s.azimuth, 
              s.beam_width
            FROM antenna_direction main
            INNER JOIN antenna_direction_item item ON main.id = item.antenna_direction_id
            CROSS JOIN LATERAL (VALUES
              (1, item.s1_azimuth, item.s1_beam_width),
              (2, item.s2_azimuth, item.s2_beam_width),
              (3, item.s3_azimuth, item.s3_beam_width)
            ) AS s(sector_no, azimuth, beam_width)
            WHERE main.id = ?
            AND s.beam_width IS NOT NULL 
            AND s.azimuth IS NOT NULL
          ), poly AS (
            SELECT
              item_id, tower_id, tower_name, sector_no, azimuth, beam_width, radius_m,
              -- Membuat polygon langsung per baris menggunakan ARRAY subquery
              ST_MakePolygon(
                  ST_MakeLine(
                      ARRAY(
                          -- Titik pusat (awal)
                          SELECT geom
                          UNION ALL
                          -- 33 Titik busur (arc)
                          SELECT ST_Project(
                              geom::geography,
                              radius_m,
                              radians(azimuth - beam_width / 2.0 + beam_width * g::numeric / ?)
                          )::geometry
                          FROM generate_series(0, ?) AS g
                          UNION ALL
                          -- Kembali ke titik pusat untuk menutup polygon
                          SELECT geom
                      )
                  )
              ) AS geom
            FROM sectors
          ) SELECT jsonb_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(jsonb_agg(
                jsonb_build_object(
                    'type', 'Feature',
                    'id', item_id || '-' || sector_no,
                    'geometry', ST_AsGeoJSON(geom)::jsonb,
                    'properties', jsonb_build_object(
                        'item_id', item_id,
                        'tower_id', tower_id,
                        'tower_name', tower_name,
                        'sector_no', sector_no,
                        'color', CASE sector_no
                            WHEN 1 THEN '#00B050'
                            WHEN 2 THEN '#0070C0'
                            ELSE '#ED7D31'
                        END,
                        'azimuth', azimuth,
                        'beam_width', beam_width,
                        'radius_m', radius_m
                    )
                )
            ), '[]'::jsonb)
            ) AS geojson
          FROM poly;`,
          [antenna_direction_id, steps, steps]
        );

        const antennaFC = antennaRows[0]?.geojson ?? {
          type: "FeatureCollection",
          features: [],
        };
        const sectorFC = sectorRows[0]?.geojson ?? {
          type: "FeatureCollection",
          features: [],
        };

        // map sector color -> simplestyle props so polygons render colored
        sectorFC.features = (sectorFC.features ?? []).map((feature) => ({
          ...feature,
          properties: {
            ...feature.properties,
            stroke: feature.properties?.color,
            "stroke-width": 2,
            fill: feature.properties?.color,
            "fill-opacity": 0.35,
          },
        }));

        // tokml emits a flat Document; extract its inner placemarks to wrap in folders
        const innerPlacemarks = (fc, opts) => {
          const kml = tokml(fc, opts);
          const match = kml.match(/<Document>([\s\S]*)<\/Document>/);
          return match ? match[1] : "";
        };

        const antennaPlacemarks = innerPlacemarks(antennaFC, {
          name: "tower_name",
        });
        const sectorPlacemarks = innerPlacemarks(sectorFC, {
          simplestyle: true,
          name: "tower_name",
        });

        const documentName = String(rows[0].analysis_name ?? baseName)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        const kmlString =
          '<?xml version="1.0" encoding="UTF-8"?>' +
          '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>' +
          `<name>${documentName}</name>` +
          `<Folder><name>Antenna</name>${antennaPlacemarks}</Folder>` +
          `<Folder><name>Antenna Sector</name>${sectorPlacemarks}</Folder>` +
          "</Document></kml>";

        res.setHeader("Content-Type", "application/vnd.google-earth.kml+xml");
        res.setHeader(
          "Content-Disposition",
          `attachment; filename="${baseName}.kml"`
        );
        return res.send(kmlString);
      } catch (error) {
        logger.error(error);
        return next(
          new ServiceUnavailableError({
            service: "analysis/fwa-antenna-direction/download",
            reason: `Failed download antenna direction${
              error?.message ? " : " + error.message : ""
            }`,
          })
        );
      }
    }
  );
};
