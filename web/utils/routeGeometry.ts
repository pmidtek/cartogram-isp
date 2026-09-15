/**
 * Route Geometry Utilities
 * Helper functions for route geometry editing, validation, and calculations
 */

import distance from "@turf/distance";
import length from "@turf/length";
import { point, lineString } from "@turf/helpers";

/**
 * Validate that route geometry starts and ends near specified site points
 * @param geometry - LineString geometry of the route
 * @param siteFrom - Starting site point coordinates
 * @param siteTo - Ending site point coordinates
 * @param toleranceMeters - Maximum allowed distance from site points (default: 100m)
 * @returns true if route endpoints are within tolerance
 */
export function validateRouteEndpoints(
  geometry: GeoJSON.LineString,
  siteFrom: { longitude: number; latitude: number },
  siteTo: { longitude: number; latitude: number },
  toleranceMeters: number = 100
): boolean {
  const coords = geometry.coordinates;

  if (!coords || coords.length < 2) {
    return false;
  }

  const startPoint = point(coords[0] as [number, number]);
  const endPoint = point(coords[coords.length - 1] as [number, number]);

  const siteFromPoint = point([siteFrom.longitude, siteFrom.latitude]);
  const siteToPoint = point([siteTo.longitude, siteTo.latitude]);

  const distanceFromStart = distance(startPoint, siteFromPoint, {
    units: "meters",
  });
  const distanceFromEnd = distance(endPoint, siteToPoint, {
    units: "meters",
  });

  return (
    distanceFromStart <= toleranceMeters && distanceFromEnd <= toleranceMeters
  );
}

/**
 * Calculate route length in kilometers
 * @param geometry - LineString geometry of the route
 * @returns Length in kilometers, rounded to 2 decimal places
 */
export function calculateRouteLength(geometry: GeoJSON.LineString): number {
  if (!geometry || !geometry.coordinates || geometry.coordinates.length < 2) {
    return 0;
  }

  const line = lineString(geometry.coordinates as Array<[number, number]>);
  const lengthKm = length(line, { units: "kilometers" });

  return Math.round(lengthKm * 100) / 100; // Round to 2 decimal places
}

/**
 * Snap route endpoints to exact site point coordinates
 * Ensures route starts and ends precisely at site points
 * @param geometry - LineString geometry of the route
 * @param siteFrom - Starting site point coordinates
 * @param siteTo - Ending site point coordinates
 * @returns Updated LineString with snapped endpoints
 */
export function snapRouteToSites(
  geometry: GeoJSON.LineString,
  siteFrom: { longitude: number; latitude: number },
  siteTo: { longitude: number; latitude: number }
): GeoJSON.LineString {
  const coords = [...geometry.coordinates];

  // Snap first point to site_from
  coords[0] = [siteFrom.longitude, siteFrom.latitude];

  // Snap last point to site_to
  coords[coords.length - 1] = [siteTo.longitude, siteTo.latitude];

  return {
    type: "LineString",
    coordinates: coords,
  };
}

/**
 * Convert route geometry to GeoJSON Feature format for API
 * @param geometry - LineString geometry
 * @param properties - Optional properties to include
 * @returns GeoJSON Feature
 */
export function geometryToFeature(
  geometry: GeoJSON.LineString,
  properties: Record<string, any> = {}
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    geometry: geometry,
    properties: properties,
  };
}

/**
 * Extract geometry from GeoJSON Feature or Feature Collection
 * @param geojson - GeoJSON object from API
 * @returns LineString geometry or null
 */
export function extractGeometry(
  geojson: any
): GeoJSON.LineString | GeoJSON.MultiLineString | null {
  if (!geojson) return null;

  // Handle Feature
  if (geojson.type === "Feature") {
    return geojson.geometry;
  }

  // Handle FeatureCollection (take first feature)
  if (geojson.type === "FeatureCollection" && geojson.features?.length > 0) {
    return geojson.features[0].geometry;
  }

  // Handle direct geometry
  if (geojson.type === "LineString" || geojson.type === "MultiLineString") {
    return geojson;
  }

  return null;
}
