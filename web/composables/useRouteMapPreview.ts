import type {
  GeoJSONSource,
  LngLatBoundsLike,
  Map as MaplibreMap,
} from "maplibre-gl";
import bbox from "@turf/bbox";
import turfLength from "@turf/length";
import { lineString } from "@turf/helpers";
import type { RouteOption } from "~/utils/types";
import { showHighlightLayer, emptyFeatureCollection } from "~/utils/index";
import {
  pointAlongLine,
  generateWaypoints,
  DEFAULT_POLE_SPACING_M,
} from "~/utils/route";

const ROUTE_OTHER_SOURCE = "site_points_route_other_source";
const ROUTE_OTHER_LAYER = "site_points_route_other_layer";
const ROUTE_SELECTED_SOURCE = "site_points_route_selected_source";
const ROUTE_SOLID_LAYER = "site_points_route_solid_layer";
const ROUTE_DASH_LAYER = "site_points_route_dash_layer";
const ROUTE_GLOW_SOURCE = "site_points_route_glow_source";
const ROUTE_GLOW_LAYER = "site_points_route_glow_layer";
const ROUTE_WAYPOINT_SOURCE = "site_points_route_waypoint_source";
const ROUTE_WAYPOINT_LAYER = "site_points_route_waypoint_layer";

const ROUTE_BLUE = "#2563EB";
const ROUTE_BLUE_LIGHT = "#93C5FD";
const ROUTE_GLOW_DURATION_MS = 3000;

// cycling dasharray to simulate movement, kept local so it doesn't touch the shared "highlight"
const ROUTE_DASH_SEQUENCE = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];

const HIGHLIGHT_LAYER_IDS = [
  "highlight-point-pulsing",
  "highlight-line-background",
  "highlight-line-dashed",
  "highlight-fill-background",
  "highlight-fill-outline",
];

let routeAnimationFrameId: number | null = null;
let routeAnimationStart: number | null = null;
let routeDashStep = -1;
let selectedRouteCoords: [number, number][] = [];
let selectedRouteLengthKm = 0;

const activeOwnerId = ref<number | null>(null);

function moveHighlightBelowSitePoints(map: MaplibreMap) {
  const siteLayer = map
    .getStyle()
    ?.layers?.find((layer) => layer.id.startsWith("site_points_"));
  if (!siteLayer) return;
  for (const id of HIGHLIGHT_LAYER_IDS) {
    if (map.getLayer(id)) map.moveLayer(id, siteLayer.id);
  }
}

function ensureRouteLayers(map: MaplibreMap) {
  if (!map.getSource(ROUTE_OTHER_SOURCE)) {
    map.addSource(ROUTE_OTHER_SOURCE, {
      type: "geojson",
      data: emptyFeatureCollection,
    });
    map.addLayer({
      id: ROUTE_OTHER_LAYER,
      type: "line",
      source: ROUTE_OTHER_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_BLUE,
        "line-width": 3,
        "line-opacity": 0.35,
      },
    });
  }
  if (!map.getSource(ROUTE_SELECTED_SOURCE)) {
    map.addSource(ROUTE_SELECTED_SOURCE, {
      type: "geojson",
      data: emptyFeatureCollection,
    });
    map.addLayer({
      id: ROUTE_SOLID_LAYER,
      type: "line",
      source: ROUTE_SELECTED_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": ROUTE_BLUE, "line-width": 5 },
    });
    map.addLayer({
      id: ROUTE_DASH_LAYER,
      type: "line",
      source: ROUTE_SELECTED_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: {
        "line-color": ROUTE_BLUE_LIGHT,
        "line-width": 5,
        "line-dasharray": ROUTE_DASH_SEQUENCE[0],
      },
    });
  }
  if (!map.getSource(ROUTE_GLOW_SOURCE)) {
    map.addSource(ROUTE_GLOW_SOURCE, {
      type: "geojson",
      data: emptyFeatureCollection,
    });
    map.addLayer({
      id: ROUTE_GLOW_LAYER,
      type: "circle",
      source: ROUTE_GLOW_SOURCE,
      paint: {
        "circle-radius": 7,
        "circle-color": ROUTE_BLUE_LIGHT,
        "circle-blur": 1,
        "circle-opacity": 0.85,
      },
    });
  }
  if (!map.getSource(ROUTE_WAYPOINT_SOURCE)) {
    map.addSource(ROUTE_WAYPOINT_SOURCE, {
      type: "geojson",
      data: emptyFeatureCollection,
    });
    map.addLayer({
      id: ROUTE_WAYPOINT_LAYER,
      type: "circle",
      source: ROUTE_WAYPOINT_SOURCE,
      paint: {
        "circle-radius": 4,
        "circle-color": "#ffffff",
        "circle-stroke-width": 2,
        "circle-stroke-color": ROUTE_BLUE,
      },
    });
  }
}

function stopRouteAnimation() {
  if (routeAnimationFrameId !== null) {
    cancelAnimationFrame(routeAnimationFrameId);
    routeAnimationFrameId = null;
  }
  routeAnimationStart = null;
  routeDashStep = -1;
}

function animateRoutePreview(timestamp: number) {
  const map = useMapRef().map;
  if (!map || selectedRouteCoords.length < 2) {
    stopRouteAnimation();
    return;
  }

  if (routeAnimationStart === null) routeAnimationStart = timestamp;

  const dashStep = Math.floor((timestamp / 60) % ROUTE_DASH_SEQUENCE.length);
  if (dashStep !== routeDashStep) {
    if (map.getLayer(ROUTE_DASH_LAYER)) {
      map.setPaintProperty(
        ROUTE_DASH_LAYER,
        "line-dasharray",
        ROUTE_DASH_SEQUENCE[dashStep],
      );
    }
    routeDashStep = dashStep;
  }

  const elapsed = timestamp - routeAnimationStart;
  const progress = (elapsed % ROUTE_GLOW_DURATION_MS) / ROUTE_GLOW_DURATION_MS;
  const glowCoord = pointAlongLine(
    selectedRouteCoords,
    progress * selectedRouteLengthKm,
  );
  const glowSource = map.getSource(ROUTE_GLOW_SOURCE) as
    | GeoJSONSource
    | undefined;
  glowSource?.setData({
    type: "Feature",
    properties: {},
    geometry: { type: "Point", coordinates: glowCoord },
  });

  routeAnimationFrameId = requestAnimationFrame(animateRoutePreview);
}

function clearHighlight(map: MaplibreMap) {
  (map.getSource("highlight") as GeoJSONSource | undefined)?.setData(
    emptyFeatureCollection,
  );
}

export function useRouteMapPreview() {
  function showRoutePreview(
    ownerId: number,
    options: RouteOption[],
    selectedId: number | null,
  ) {
    const map = useMapRef().map;
    if (!map) return;

    activeOwnerId.value = ownerId;

    if (!options.length) {
      clearRoutePreview();
      return;
    }

    ensureRouteLayers(map);

    const otherFeatures = options
      .filter((o) => o.id !== selectedId)
      .flatMap((o) => o.geojson_route.features);
    (map.getSource(ROUTE_OTHER_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: otherFeatures,
    });

    const selected = options.find((o) => o.id === selectedId);
    stopRouteAnimation();
    if (!selected) {
      (map.getSource(ROUTE_SELECTED_SOURCE) as GeoJSONSource).setData(
        emptyFeatureCollection,
      );
      (map.getSource(ROUTE_GLOW_SOURCE) as GeoJSONSource).setData(
        emptyFeatureCollection,
      );
      (map.getSource(ROUTE_WAYPOINT_SOURCE) as GeoJSONSource).setData(
        emptyFeatureCollection,
      );
      selectedRouteCoords = [];
      return;
    }

    (map.getSource(ROUTE_SELECTED_SOURCE) as GeoJSONSource).setData(
      selected.geojson_route,
    );

    const lineFeatures = selected.geojson_route.features.filter(
      (f): f is GeoJSON.Feature<GeoJSON.LineString> =>
        f.geometry.type === "LineString",
    );
    selectedRouteCoords = lineFeatures.flatMap(
      (f) => f.geometry.coordinates as [number, number][],
    );
    selectedRouteLengthKm =
      selectedRouteCoords.length > 1
        ? turfLength(lineString(selectedRouteCoords), { units: "kilometers" })
        : 0;

    const waypoints = generateWaypoints(
      selectedRouteCoords,
      DEFAULT_POLE_SPACING_M,
    );
    (map.getSource(ROUTE_WAYPOINT_SOURCE) as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: waypoints.map((coordinates) => ({
        type: "Feature",
        properties: {},
        geometry: { type: "Point", coordinates },
      })),
    });

    if (selectedRouteCoords.length > 1) {
      const routeBounds = bbox(lineString(selectedRouteCoords)) as [
        number,
        number,
        number,
        number,
      ];
      map.fitBounds(routeBounds as LngLatBoundsLike, {
        padding: { top: 100, bottom: 100, left: 100, right: 100 },
        duration: 1000,
      });
      routeAnimationFrameId = requestAnimationFrame(animateRoutePreview);
    }
  }

  function showPointHighlight(ownerId: number, points: [number, number][]) {
    const map = useMapRef().map;
    if (!map) return;

    activeOwnerId.value = ownerId;

    if (!points.length) {
      clearPointPreview();
      return;
    }

    showHighlightLayer(
      map,
      points.map((coordinates) => ({
        geom: { type: "Point", coordinates } as GeoJSON.Point,
      })),
      "site_points_highlight",
      true,
    );
    moveHighlightBelowSitePoints(map);
  }

  function showPointPreview(
    ownerId: number,
    coordsA: [number, number],
    coordsB: [number, number],
  ) {
    const map = useMapRef().map;
    if (!map) return;

    activeOwnerId.value = ownerId;

    const points = [coordsA, coordsB].map((coordinates) => ({
      geom: { type: "Point", coordinates } as GeoJSON.Point,
    }));
    const connection = {
      geom: {
        type: "LineString",
        coordinates: [coordsA, coordsB],
      } as GeoJSON.LineString,
    };
    showHighlightLayer(
      map,
      [...points, connection],
      "site_points_highlight",
      true,
    );
    moveHighlightBelowSitePoints(map);

    const bounds = bbox(lineString([coordsA, coordsB])) as [
      number,
      number,
      number,
      number,
    ];
    map.fitBounds(bounds as LngLatBoundsLike, {
      padding: { top: 100, bottom: 100, left: 100, right: 100 },
      duration: 1000,
    });
  }

  function clearRoutePreview() {
    stopRouteAnimation();
    selectedRouteCoords = [];
    const map = useMapRef().map;
    if (!map) return;
    for (const id of [
      ROUTE_OTHER_LAYER,
      ROUTE_SOLID_LAYER,
      ROUTE_DASH_LAYER,
      ROUTE_GLOW_LAYER,
      ROUTE_WAYPOINT_LAYER,
    ]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [
      ROUTE_OTHER_SOURCE,
      ROUTE_SELECTED_SOURCE,
      ROUTE_GLOW_SOURCE,
      ROUTE_WAYPOINT_SOURCE,
    ]) {
      if (map.getSource(id)) map.removeSource(id);
    }
  }

  function clearPointPreview() {
    const map = useMapRef().map;
    if (map) clearHighlight(map);
  }

  function clearPreview() {
    clearRoutePreview();
    clearPointPreview();
  }

  function clearIfOwner(ownerId: number) {
    if (activeOwnerId.value !== ownerId) return;
    clearPreview();
    activeOwnerId.value = null;
  }

  return {
    activeOwnerId,
    showRoutePreview,
    showPointPreview,
    showPointHighlight,
    clearRoutePreview,
    clearPointPreview,
    clearPreview,
    clearIfOwner,
  };
}
