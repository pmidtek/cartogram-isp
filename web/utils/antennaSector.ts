// Geometry helpers for editing antenna sectors on the map.
// Kept dependency-free (the installed @turf set has no bearing/destination).
// Formulas are great-circle; accurate enough at the sector radii used here (<=500 m).

export type LngLat = [number, number];

const EARTH_RADIUS_M = 6371008.8; // mean Earth radius (meters), matches turf
const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/** Initial bearing (degrees, 0-360, clockwise from north) from `from` to `to`. */
export function bearing(from: LngLat, to: LngLat): number {
  const lon1 = toRad(from[0]);
  const lat1 = toRad(from[1]);
  const lon2 = toRad(to[0]);
  const lat2 = toRad(to[1]);
  const dLon = lon2 - lon1;
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  const brng = toDeg(Math.atan2(y, x));
  return (brng + 360) % 360;
}

/** Point reached from `from` going `distanceMeters` along `bearingDeg`. */
export function destination(
  from: LngLat,
  distanceMeters: number,
  bearingDeg: number,
): LngLat {
  const angular = distanceMeters / EARTH_RADIUS_M;
  const brng = toRad(bearingDeg);
  const lat1 = toRad(from[1]);
  const lon1 = toRad(from[0]);

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angular) +
      Math.cos(lat1) * Math.sin(angular) * Math.cos(brng),
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angular) * Math.cos(lat1),
      Math.cos(angular) - Math.sin(lat1) * Math.sin(lat2),
    );

  return [(toDeg(lon2) + 540) % 360 - 180, toDeg(lat2)];
}

/** Shortest signed difference `a - b` normalized to (-180, 180]. */
export function angularDelta(a: number, b: number): number {
  return ((((a - b) % 360) + 540) % 360) - 180;
}

/**
 * GeoJSON Polygon wedge centered at `center`, spanning `beamWidth` degrees
 * around `azimuth`, out to `radiusM`. Mirrors the server's ST_Project arc so
 * the client preview lines up with the saved sector.
 */
export function buildSectorWedge(
  center: LngLat,
  azimuth: number,
  beamWidth: number,
  radiusM: number,
  steps = 32,
): GeoJSON.Polygon {
  const start = azimuth - beamWidth / 2;
  const ring: LngLat[] = [center];
  for (let g = 0; g <= steps; g++) {
    ring.push(destination(center, radiusM, start + (beamWidth * g) / steps));
  }
  ring.push(center);
  return { type: "Polygon", coordinates: [ring] };
}
