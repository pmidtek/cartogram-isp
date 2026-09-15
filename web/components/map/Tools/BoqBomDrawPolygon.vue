<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import IcDrawSquare from "~/assets/icons/ic-draw-square.svg";
import IcSpinner from "~/assets/icons/ic-spinner.svg";
import type { Feature, GeoJsonProperties, Geometry, Position } from "geojson";
import bbox from "@turf/bbox";

const mapRefStore = useMapRef();
const authStore = useAuth();
const featureStore = useFeature();
const toast = useToast();
const analysisStore = useAnalysisResult();
const toolsStore = useMapTools();
const mapLayerStore = useMapLayer();
const { showCard, showTools } = storeToRefs(toolsStore);

// Local state
const drawnPolygon = ref<Feature<Geometry, GeoJsonProperties> | null>(null);
const isAnalyzing = ref(false);

// Selected features by category
const selectedFeatures = ref<{
  site_points: number[];
  assets: number[];
  routes: number[];
  cables: number[];
}>({
  site_points: [],
  assets: [],
  routes: [],
  cables: [],
});

const totalSelectedCount = computed(() => {
  return (
    selectedFeatures.value.site_points.length +
    selectedFeatures.value.assets.length +
    selectedFeatures.value.routes.length +
    selectedFeatures.value.cables.length
  );
});

const hasSelectedFeatures = computed(() => totalSelectedCount.value > 0);

const canAnalyze = computed(() => {
  return hasSelectedFeatures.value && !isAnalyzing.value;
});

// Ray-casting point-in-polygon check (no extra dependency)
const isPointInPolygon = (
  point: [number, number],
  polygon: Position[],
): boolean => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0],
      yi = polygon[i][1];
    const xj = polygon[j][0],
      yj = polygon[j][1];
    const intersect =
      yi > point[1] !== yj > point[1] &&
      point[0] < ((xj - xi) * (point[1] - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
};

// Map from project layer ID suffix to feature category
const layerSuffixToCategory: Record<
  string,
  keyof typeof selectedFeatures.value
> = {
  "site-points-layer": "site_points",
  "assets-layer": "assets",
  "routes-layer": "routes",
  "cables-layer": "cables",
};

// Resolve a feature's category from either sourceLayer (vector tiles) or layer ID (GeoJSON project layers)
const resolveCategory = (
  feature: any,
): keyof typeof selectedFeatures.value | null => {
  // Vector tile layers have sourceLayer
  const relevantSourceLayers = ["site_points", "assets", "routes", "cables"];
  if (
    feature.sourceLayer &&
    relevantSourceLayers.includes(feature.sourceLayer)
  ) {
    return feature.sourceLayer as keyof typeof selectedFeatures.value;
  }
  // GeoJSON project layers: layer ID like "project-{id}-{type}-layer"
  if (feature.layer?.id) {
    for (const [suffix, category] of Object.entries(layerSuffixToCategory)) {
      if (feature.layer.id.endsWith(suffix)) {
        return category;
      }
    }
  }
  return null;
};

// Collect all queryable layer IDs (vector tile + GeoJSON project layers)
const getQueryableLayerIds = (): string[] => {
  const map = mapRefStore.map;
  if (!map) return [];

  const ids: string[] = [];

  // Vector tile layers from groupedActiveLayers
  const filterLayers = mapLayerStore.groupedActiveLayers
    ?.map(({ layerLists }) => layerLists)
    .flat();
  if (filterLayers) {
    for (const l of filterLayers) {
      if (map.getLayer(l.layer_id)) {
        ids.push(l.layer_id);
      }
    }
  }

  // GeoJSON project layers (project-{id}-{type}-layer)
  const allLayers = map.getStyle()?.layers || [];
  for (const layer of allLayers) {
    if (
      /^project-\d+-(site-points|assets|routes|cables)-layer$/.test(layer.id)
    ) {
      if (!ids.includes(layer.id)) {
        ids.push(layer.id);
      }
    }
  }

  return ids;
};

// Query map features within the drawn polygon
const queryFeaturesInPolygon = () => {
  if (!mapRefStore.map || !drawnPolygon.value) return;

  const polygonGeometry = drawnPolygon.value.geometry;
  if (polygonGeometry.type !== "Polygon") return;

  const polygonCoords = polygonGeometry.coordinates[0];

  // Get bounding box of polygon for initial broad query
  const bounds = bbox(drawnPolygon.value);
  const sw = mapRefStore.map.project([bounds[0], bounds[1]]);
  const ne = mapRefStore.map.project([bounds[2], bounds[3]]);

  const layerIds = getQueryableLayerIds();

  if (layerIds.length === 0) {
    toast.add({
      title: "No Active Layers",
      description: "Please activate map layers before drawing a polygon",
      icon: "i-heroicons-exclamation-triangle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
    return;
  }

  // Query rendered features within the bounding box
  const features = mapRefStore.map.queryRenderedFeatures(
    [
      [Math.min(sw.x, ne.x), Math.min(sw.y, ne.y)],
      [Math.max(sw.x, ne.x), Math.max(sw.y, ne.y)],
    ],
    { layers: layerIds },
  );

  const result: typeof selectedFeatures.value = {
    site_points: [],
    assets: [],
    routes: [],
    cables: [],
  };

  const seenIds = new Set<string>();

  for (const feature of features) {
    const category = resolveCategory(feature);
    if (!category) continue;

    // Use feature.id or properties.id for identification
    const featureId = feature.id ?? feature.properties?.id;
    if (featureId == null) continue;

    const uniqueKey = `${category}-${featureId}`;
    if (seenIds.has(uniqueKey)) continue;

    const geomType = feature.geometry.type;
    let isInside = false;

    if (geomType === "Point") {
      const coords = (feature.geometry as any).coordinates as [number, number];
      isInside = isPointInPolygon(coords, polygonCoords);
    } else if (geomType === "LineString") {
      const coords = (feature.geometry as any).coordinates as [
        number,
        number,
      ][];
      isInside = coords.some((coord) => isPointInPolygon(coord, polygonCoords));
    } else if (geomType === "MultiLineString") {
      const lines = (feature.geometry as any).coordinates as [
        number,
        number,
      ][][];
      isInside = lines.some((line) =>
        line.some((coord) => isPointInPolygon(coord, polygonCoords)),
      );
    }

    if (isInside) {
      seenIds.add(uniqueKey);
      result[category].push(Number(featureId));
    }
  }

  selectedFeatures.value = result;

  // Add highlight on map
  displayHighlight(
    features.filter((f) => {
      const cat = resolveCategory(f);
      const fid = f.id ?? f.properties?.id;
      if (!cat || fid == null) return false;
      return seenIds.has(`${cat}-${fid}`);
    }),
  );
};

// Display polygon overlay and selected feature highlights
const displayHighlight = (features: any[]) => {
  if (!mapRefStore.map) return;

  removeHighlights();

  if (features.length === 0) return;

  const pointFeatures = features.filter((f) =>
    ["Point"].includes(f.geometry.type),
  );
  const lineFeatures = features.filter((f) =>
    ["LineString", "MultiLineString"].includes(f.geometry.type),
  );

  if (pointFeatures.length > 0) {
    mapRefStore.map.addSource("boq-bom-polygon-selected-points", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: pointFeatures.map((f) => ({
          type: "Feature" as const,
          geometry: f.geometry,
          properties: {},
        })),
      },
    });

    mapRefStore.map.addLayer({
      id: "boq-bom-polygon-selected-points-stroke",
      type: "circle",
      source: "boq-bom-polygon-selected-points",
      paint: {
        "circle-radius": 12,
        "circle-color": "#3B82F6",
        "circle-opacity": 0.4,
      },
    });

    mapRefStore.map.addLayer({
      id: "boq-bom-polygon-selected-points",
      type: "circle",
      source: "boq-bom-polygon-selected-points",
      paint: {
        "circle-radius": 8,
        "circle-color": "#3B82F6",
        "circle-stroke-width": 3,
        "circle-stroke-color": "#FFFFFF",
      },
    });
  }

  if (lineFeatures.length > 0) {
    mapRefStore.map.addSource("boq-bom-polygon-selected-lines", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: lineFeatures.map((f) => ({
          type: "Feature" as const,
          geometry: f.geometry,
          properties: {},
        })),
      },
    });

    mapRefStore.map.addLayer({
      id: "boq-bom-polygon-selected-lines",
      type: "line",
      source: "boq-bom-polygon-selected-lines",
      paint: {
        "line-color": "#3B82F6",
        "line-width": 5,
        "line-opacity": 0.9,
      },
    });
  }
};

// Remove highlight layers
const removeHighlights = () => {
  if (!mapRefStore.map) return;

  const layers = [
    "boq-bom-polygon-selected-points",
    "boq-bom-polygon-selected-points-stroke",
    "boq-bom-polygon-selected-lines",
  ];

  layers.forEach((layerId) => {
    if (mapRefStore.map!.getLayer(layerId)) {
      mapRefStore.map!.removeLayer(layerId);
    }
  });

  const sources = [
    "boq-bom-polygon-selected-points",
    "boq-bom-polygon-selected-lines",
  ];

  sources.forEach((sourceId) => {
    if (mapRefStore.map!.getSource(sourceId)) {
      mapRefStore.map!.removeSource(sourceId);
    }
  });
};

// Initialize draw control
let drawerInstance: any = null;
const initDrawControl = () => {
  const { drawer } = useDrawControl({
    mode: "draw_polygon",
    onCreated: (feature) => {
      drawnPolygon.value = feature;
      queryFeaturesInPolygon();
    },
    onUpdated: (feature) => {
      drawnPolygon.value = feature;
      queryFeaturesInPolygon();
    },
  });

  drawerInstance = drawer;
};

// Handle BOQ/BOM analysis
const handleAnalyze = async () => {
  if (!hasSelectedFeatures.value) {
    toast.add({
      title: "Error",
      description: "Please draw a polygon that contains features",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
    return;
  }

  isAnalyzing.value = true;

  try {
    const response = await $fetch<any>("/panel/boq-bom/generate-boq-bom", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: {
        generate_type: "selection",
        is_price_default: analysisStore.isPriceDefault,
        site_points: selectedFeatures.value.site_points,
        assets: selectedFeatures.value.assets,
        routes: selectedFeatures.value.routes,
        cables: selectedFeatures.value.cables,
      },
    });

    if (response.data) {
      analysisStore.setBoqBomAnalysisData(response.data);
      analysisStore.setCurrentAnalysisType("boq_bom_analysis");

      featureStore.setMapInfo("analytic");

      showCard.value = false;
      showTools.value = true;
      analysisStore.clearBoqBomToolActive();

      toast.add({
        title: "Analysis Complete",
        description: "BOQ/BOM calculation completed successfully",
        color: "green",
        icon: "i-heroicons-chart-bar",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-green-500",
        },
      });
    }
  } catch (error: any) {
    console.error("Analysis error:", error);
    toast.add({
      title: "Analysis Failed",
      description:
        error.message || "Failed to analyze BOQ/BOM. Please try again.",
      color: "red",
      icon: "i-heroicons-x-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
  } finally {
    isAnalyzing.value = false;
  }
};

// Reset
const handleReset = () => {
  drawnPolygon.value = null;
  selectedFeatures.value = {
    site_points: [],
    assets: [],
    routes: [],
    cables: [],
  };

  removeHighlights();

  if (drawerInstance && typeof drawerInstance.deleteAll === "function") {
    try {
      drawerInstance.deleteAll();
      drawerInstance.changeMode("draw_polygon");
    } catch (error) {
      console.warn("Failed to reset draw control:", error);
    }
  }
};

// Close tool
const handleClose = () => {
  handleReset();
  showCard.value = false;
  analysisStore.clearBoqBomToolActive();
};

onMounted(() => {
  mapRefStore.setDrawMode(true);
  initDrawControl();
});

onUnmounted(() => {
  mapRefStore.setDrawMode(false);
  removeHighlights();
});
</script>

<template>
  <MapToolsCard
    :active="true"
    label="Draw Polygon"
    :icon="IcDrawSquare"
    :onClose="handleClose"
  >
    <div class="p-3 space-y-3">
      <!-- Instructions -->
      <div class="p-2 bg-blue-50 border border-blue-200 rounded-xs">
        <div class="flex gap-2">
          <UIcon
            name="i-heroicons-information-circle"
            class="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5"
          />
          <p class="text-2xs text-blue-700">
            Click on the map to draw a polygon area. Double-click to finish
            drawing. Features inside the polygon will be selected for BOQ/BOM
            analysis.
          </p>
        </div>
      </div>

      <!-- Draw prompt (before polygon is drawn) -->
      <div
        v-if="!drawnPolygon"
        class="p-2 bg-amber-50 border border-amber-200 rounded-xs"
      >
        <div class="flex items-center gap-2">
          <UIcon
            name="i-heroicons-pencil-square"
            class="w-4 h-4 text-amber-600"
          />
          <p class="text-2xs text-amber-700 font-medium">
            Draw a polygon on the map to select features
          </p>
        </div>
      </div>

      <!-- Selected Features Summary (after polygon is drawn) -->
      <template v-if="drawnPolygon">
        <div
          v-if="hasSelectedFeatures"
          class="p-2 bg-green-50 border border-green-200 rounded-xs"
        >
          <div class="flex items-center gap-2 mb-2">
            <UIcon
              name="i-heroicons-check-circle"
              class="w-4 h-4 text-green-600"
            />
            <span class="text-xs font-semibold text-green-700">
              {{ totalSelectedCount }} Feature(s) Found
            </span>
          </div>

          <div class="space-y-1">
            <div
              v-if="selectedFeatures.site_points.length > 0"
              class="flex items-center justify-between text-2xs"
            >
              <span class="text-grey-600">Site Points</span>
              <span class="font-semibold text-grey-700">{{
                selectedFeatures.site_points.length
              }}</span>
            </div>
            <div
              v-if="selectedFeatures.assets.length > 0"
              class="flex items-center justify-between text-2xs"
            >
              <span class="text-grey-600">Assets</span>
              <span class="font-semibold text-grey-700">{{
                selectedFeatures.assets.length
              }}</span>
            </div>
            <div
              v-if="selectedFeatures.routes.length > 0"
              class="flex items-center justify-between text-2xs"
            >
              <span class="text-grey-600">Routes</span>
              <span class="font-semibold text-grey-700">{{
                selectedFeatures.routes.length
              }}</span>
            </div>
            <div
              v-if="selectedFeatures.cables.length > 0"
              class="flex items-center justify-between text-2xs"
            >
              <span class="text-grey-600">Cables</span>
              <span class="font-semibold text-grey-700">{{
                selectedFeatures.cables.length
              }}</span>
            </div>
          </div>
        </div>

        <div v-else class="p-2 bg-amber-50 border border-amber-200 rounded-xs">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-heroicons-exclamation-triangle"
              class="w-4 h-4 text-amber-600"
            />
            <p class="text-2xs text-amber-700 font-medium">
              No features found inside the polygon. Try drawing in an area with
              active layers.
            </p>
          </div>
        </div>
      </template>

      <!-- Action Buttons -->
      <div class="pt-2">
        <div class="grid grid-cols-2 gap-2">
          <!-- Reset Button -->
          <button
            @click="handleReset"
            :disabled="!drawnPolygon"
            class="flex items-center justify-center gap-2 px-3 py-2 rounded-xs text-xs font-semibold bg-grey-100 text-grey-700 hover:bg-grey-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-3 h-3" />
            <span>Reset</span>
          </button>

          <!-- Analyze Button -->
          <button
            @click="handleAnalyze"
            :disabled="!canAnalyze"
            :class="[
              'flex items-center justify-center gap-2 px-3 py-2 rounded-xs text-xs font-semibold transition-all',
              canAnalyze
                ? 'bg-brand-500 text-white hover:bg-brand-600'
                : 'bg-grey-200 text-grey-400 cursor-not-allowed',
            ]"
          >
            <IcSpinner v-if="isAnalyzing" class="w-3 h-3 animate-spin" />
            <UIcon v-else name="i-heroicons-chart-bar" class="w-3 h-3" />
            <span>{{ isAnalyzing ? "Analyzing..." : "Analyze" }}</span>
          </button>
        </div>
      </div>
    </div>
  </MapToolsCard>
</template>
