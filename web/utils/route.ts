import turfDistance from "@turf/distance";
import turfLength from "@turf/length";
import { lineString, point } from "@turf/helpers";

// ~40m is a standard planning default for FTTH/telecom aerial pole spans
// (typical range is 20-60m depending on cable weight, sag, wind, road
// geometry and local regs) — actual pole generation against a saved route
// lives in web/components/map/Tools/GeneratePole.vue; this is only an
// estimate for comparing/previewing route options before one is committed to.
export const DEFAULT_POLE_SPACING_M = 40;

export function pointAlongLine(
  coords: [number, number][],
  targetDistanceKm: number,
): [number, number] {
  let traveled = 0;
  for (let i = 0; i < coords.length - 1; i++) {
    const segStart = coords[i];
    const segEnd = coords[i + 1];
    const segLength = turfDistance(point(segStart), point(segEnd), {
      units: "kilometers",
    });
    if (traveled + segLength >= targetDistanceKm) {
      const ratio =
        segLength === 0 ? 0 : (targetDistanceKm - traveled) / segLength;
      return [
        segStart[0] + (segEnd[0] - segStart[0]) * ratio,
        segStart[1] + (segEnd[1] - segStart[1]) * ratio,
      ];
    }
    traveled += segLength;
  }
  return coords[coords.length - 1];
}

export function routeLengthKm(coords: [number, number][]): number {
  return coords.length > 1
    ? turfLength(lineString(coords), { units: "kilometers" })
    : 0;
}

// Places waypoints every `spacingM` meters along the route's actual line
// segments (via pointAlongLine), deduplicated by rounded coordinate so
// overlapping/duplicate points — e.g. the shared vertex where two legs of a
// multi-leg route join — never produce the same waypoint twice.
export function generateWaypoints(
  coords: [number, number][],
  spacingM: number,
): [number, number][] {
  if (coords.length < 2 || spacingM <= 0) return [];

  const totalKm = routeLengthKm(coords);
  const spacingKm = spacingM / 1000;
  const seen = new Set<string>();
  const waypoints: [number, number][] = [];

  for (let d = spacingKm; d < totalKm; d += spacingKm) {
    const p = pointAlongLine(coords, d);
    const key = `${p[0].toFixed(6)},${p[1].toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    waypoints.push(p);
  }

  return waypoints;
}
