<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { storeToRefs } from "pinia";
import buffer from "@turf/buffer";
import bbox from "@turf/bbox";
import { featureCollection, point } from "@turf/helpers";
import type { GeoJSONFeature } from "maplibre-gl";

const mapRefStore = useMapRef();
const featureStore = useFeature();
const analysisStore = useAnalysisResult();
const { currentAnalysisType } = storeToRefs(analysisStore);
const authStore = useAuth();
const toast = useToast();

const { map } = storeToRefs(mapRefStore);

// Common state
const selectedTowers = ref<any[]>([]);
const bufferColor = ref<string>("#3B82F6");
const isLoading = ref<boolean>(false);
const isBufferVisible = ref<boolean>(false);
const bufferedFeaturesData = ref<GeoJSONFeature>();

// Distance configuration
const toogleCustomDistance = ref<boolean>(false);
const selectedDistance = ref("100 m");
const customDistance = ref<number>(100);
const customUnit = ref<string>("meters");

// Preset distance options
const distanceOptions = ["100 m", "200 m", "300 m", "500 m"];

// Buffer unit options for custom distance
const unitOptions = [
  "meters",
  "kilometers",
  "miles",
  "feet",
  "yards",
  "inches",
  "nauticalmiles",
  "centimeters",
];

const canPreview = computed(() => {
  return selectedTowers.value.length > 0;
});

const selectedTowersCount = computed(() => selectedTowers.value.length);

// Get current buffer distance and unit
const getCurrentBufferDistanceAndUnit = () => {
  if (toogleCustomDistance.value && customDistance.value) {
    return {
      distance: customDistance.value,
      unit: customUnit.value,
    };
  } else {
    return {
      distance: parseInt(selectedDistance.value.replace(" m", "")),
      unit: "meters",
    };
  }
};

// Select preset distance
const selectDistance = (distance: string) => {
  selectedDistance.value = distance;
  toogleCustomDistance.value = false;
};

// Map click handler for tower selection
const handleMapClick = (e: any) => {
  if (!map.value) return;

  const features = map.value.queryRenderedFeatures(e.point);

  // For points, find point features on the map
  const pointFeatures = features.filter((f) => f.geometry.type === "Point");
  if (pointFeatures.length > 0) {
    // Check if this feature is already selected
    const isAlreadySelected = selectedTowers.value.some(
      (selected) => selected.id === pointFeatures[0].id
    );
    if (!isAlreadySelected) {
      selectedTowers.value.push(pointFeatures[0]);
    }
  }

  // Update highlight visualization
  updateHighlight();
};

// Mouse move handler for cursor feedback
const handleMouseMove = (e: any) => {
  if (!map.value) return;

  const features = map.value.queryRenderedFeatures(e.point);

  const pointFeatures = features.filter((f) => f.geometry.type === "Point");
  map.value.getCanvas().style.cursor =
    pointFeatures.length > 0 ? "pointer" : "";
};

// Remove selected tower
const removeTower = (towerId: number) => {
  const index = selectedTowers.value.findIndex((t) => t.id === towerId);
  if (index > -1) {
    selectedTowers.value.splice(index, 1);
    updateHighlight();
  }
};

// Clear existing buffer layer
const clearBufferLayer = () => {
  if (!map.value) return;

  if (map.value.getLayer("buffer-layer")) {
    map.value.removeLayer("buffer-layer");
  }
  if (map.value.getLayer("buffer-outline")) {
    map.value.removeLayer("buffer-outline");
  }
  if (map.value.getSource("buffer-source")) {
    map.value.removeSource("buffer-source");
  }
};

// Clear highlight layer
const clearHighlightLayer = () => {
  if (!map.value) return;

  if (map.value.getLayer("selected-features-highlight")) {
    map.value.removeLayer("selected-features-highlight");
  }
  if (map.value.getLayer("selected-features-outline")) {
    map.value.removeLayer("selected-features-outline");
  }
  if (map.value.getSource("selected-features-source")) {
    map.value.removeSource("selected-features-source");
  }
};

// Update highlight for selected towers
const updateHighlight = () => {
  if (!map.value || selectedTowers.value.length === 0) {
    clearHighlightLayer();
    return;
  }

  try {
    clearHighlightLayer();

    const highlightFeatures = selectedTowers.value.map((feature) => {
      return feature;
    });

    map.value.addSource("selected-features-source", {
      type: "geojson",
      data: featureCollection(highlightFeatures),
    });

    map.value.addLayer({
      id: "selected-features-highlight",
      type: "circle",
      source: "selected-features-source",
      filter: ["==", "$type", "Point"],
      paint: {
        "circle-color": "#FF6B35",
        "circle-radius": 8,
        "circle-opacity": 0.8,
        "circle-stroke-width": 2,
        "circle-stroke-color": "#FFFFFF",
      },
    });

    map.value.addLayer({
      id: "selected-features-outline",
      type: "line",
      source: "selected-features-source",
      filter: ["==", "$type", "LineString"],
      paint: {
        "line-color": "#FF6B35",
        "line-width": 4,
        "line-opacity": 0.8,
      },
    });
  } catch (error) {
    console.error("Error updating highlight:", error);
  }
};

// Clear analysis result layers
const clearAnalysisLayers = () => {
  if (!map.value) return;

  if (map.value.getLayer("quadrant-footprint-fill")) {
    map.value.removeLayer("quadrant-footprint-fill");
  }
  if (map.value.getLayer("quadrant-footprint-outline")) {
    map.value.removeLayer("quadrant-footprint-outline");
  }
  if (map.value.getSource("quadrant-footprint-source")) {
    map.value.removeSource("quadrant-footprint-source");
  }

  if (map.value.getLayer("quadrant-analysis-labels")) {
    map.value.removeLayer("quadrant-analysis-labels");
  }
  if (map.value.getLayer("quadrant-analysis-outline")) {
    map.value.removeLayer("quadrant-analysis-outline");
  }
  if (map.value.getLayer("quadrant-analysis-layer")) {
    map.value.removeLayer("quadrant-analysis-layer");
  }
  if (map.value.getSource("quadrant-analysis-source")) {
    map.value.removeSource("quadrant-analysis-source");
  }

  if (map.value.getLayer("quadrant-direction-arrow")) {
    map.value.removeLayer("quadrant-direction-arrow");
  }
  if (map.value.getSource("quadrant-direction-arrow-source")) {
    map.value.removeSource("quadrant-direction-arrow-source");
  }
  if (map.value.getLayer("quadrant-direction-line")) {
    map.value.removeLayer("quadrant-direction-line");
  }
  if (map.value.getSource("quadrant-direction-source")) {
    map.value.removeSource("quadrant-direction-source");
  }
};

// Add analysis result layers to map
const addAnalysisLayers = (analysisData: any) => {
  if (!map.value || !analysisData) return;

  try {
    clearAnalysisLayers();

    const allFootprints: any[] = [];
    const allQuadrants: any[] = [];
    const allDirections: any[] = [];

    analysisData.forEach((towerData: any) => {
      if (towerData.geojson_footprint) {
        if (towerData.geojson_footprint.type === "FeatureCollection") {
          allFootprints.push(...towerData.geojson_footprint.features);
        } else if (towerData.geojson_footprint.type === "Feature") {
          allFootprints.push(towerData.geojson_footprint);
        }
      }

      if (towerData.geojson_quadrant) {
        if (towerData.geojson_quadrant.type === "FeatureCollection") {
          allQuadrants.push(...towerData.geojson_quadrant.features);
        } else if (towerData.geojson_quadrant.type === "Feature") {
          allQuadrants.push(towerData.geojson_quadrant);
        }
      }

      if (towerData.geojson_direction) {
        if (towerData.geojson_direction.type === "FeatureCollection") {
          allDirections.push(...towerData.geojson_direction.features);
        } else if (towerData.geojson_direction.type === "Feature") {
          allDirections.push(towerData.geojson_direction);
        }
      }
    });

    if (allFootprints.length > 0) {
      map.value.addSource("quadrant-footprint-source", {
        type: "geojson",
        data: featureCollection(allFootprints),
      });

      map.value.addLayer({
        id: "quadrant-footprint-fill",
        type: "fill",
        source: "quadrant-footprint-source",
        paint: {
          "fill-color": "#0000FF",
          "fill-opacity": 0.2,
        },
      });

      map.value.addLayer({
        id: "quadrant-footprint-outline",
        type: "line",
        source: "quadrant-footprint-source",
        paint: {
          "line-color": bufferColor.value,
          "line-width": 1.5,
          "line-opacity": 0.8,
        },
      });
    }

    if (allQuadrants.length > 0) {
      map.value.addSource("quadrant-analysis-source", {
        type: "geojson",
        data: featureCollection(allQuadrants),
      });

      map.value.addLayer({
        id: "quadrant-analysis-layer",
        type: "fill",
        source: "quadrant-analysis-source",
        paint: {
          "fill-color": ["get", "fill"],
          "fill-opacity": 0.1,
        },
      });

      map.value.addLayer({
        id: "quadrant-analysis-outline",
        type: "line",
        source: "quadrant-analysis-source",
        paint: {
          "line-color": ["get", "fill"],
          "line-width": 2,
          "line-opacity": 0.8,
        },
      });

      map.value.addLayer({
        id: "quadrant-analysis-labels",
        type: "symbol",
        source: "quadrant-analysis-source",
        layout: {
          "text-field": ["to-string", ["get", "angle_percentage"]],
          "text-size": 14,
          "text-anchor": "center",
          "text-allow-overlap": true,
          "text-padding": 4,
        },
        paint: {
          "text-color": "#FFFFFF",
          "text-halo-color": "#000000",
          "text-halo-width": 4,
          "text-halo-blur": 0.5,
        },
      });
    }

    // Add direction line layer (green, thick)
    if (allDirections.length > 0) {
      map.value.addSource("quadrant-direction-source", {
        type: "geojson",
        data: featureCollection(allDirections),
      });

      map.value.addLayer({
        id: "quadrant-direction-line",
        type: "line",
        source: "quadrant-direction-source",
        paint: {
          "line-color": "#FACC15",
          "line-width": 4,
          "line-opacity": 1,
        },
      });

      // Create arrow image if it doesn't exist
      if (!map.value.hasImage("direction-arrow")) {
        const size = 32;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        ctx.fillStyle = "#FACC15";
        ctx.beginPath();
        ctx.moveTo(size, size / 2);
        ctx.lineTo(0, 0);
        ctx.lineTo(size * 0.3, size / 2);
        ctx.lineTo(0, size);
        ctx.closePath();
        ctx.fill();
        const imageData = ctx.getImageData(0, 0, size, size);
        map.value.addImage("direction-arrow", imageData, { sdf: false });
      }

      // Create point features at the end of each direction line with bearing
      const arrowPoints = allDirections
        .filter((f: any) => f.geometry?.type === "LineString" && f.geometry.coordinates.length >= 2)
        .map((f: any) => {
          const coords = f.geometry.coordinates;
          const end = coords[coords.length - 1];
          const prev = coords[coords.length - 2];
          const dx = end[0] - prev[0];
          const dy = end[1] - prev[1];
          // atan2(dx, dy) gives angle from north; subtract 90 because arrow image points east
          const bearing = (Math.atan2(dx, dy) * 180) / Math.PI - 90;
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: end },
            properties: { bearing },
          };
        });

      map.value.addSource("quadrant-direction-arrow-source", {
        type: "geojson",
        data: featureCollection(arrowPoints),
      });

      map.value.addLayer({
        id: "quadrant-direction-arrow",
        type: "symbol",
        source: "quadrant-direction-arrow-source",
        layout: {
          "icon-image": "direction-arrow",
          "icon-size": 1,
          "icon-rotate": ["get", "bearing"],
          "icon-rotation-alignment": "map",
          "icon-allow-overlap": true,
        },
      });
    }
  } catch (error) {
    console.error("Error adding analysis layers:", error);
  }
};

// Preview buffer on map
const previewBuffer = () => {
  if (!map.value || selectedTowers.value.length === 0) {
    return;
  }

  const { distance, unit } = getCurrentBufferDistanceAndUnit();

  try {
    const bufferedFeatures = selectedTowers.value.map((feature) => {
      return buffer(feature, distance, { units: unit as any });
    });

    bufferedFeaturesData.value = featureCollection(bufferedFeatures);
    clearBufferLayer();

    map.value.addSource("buffer-source", {
      type: "geojson",
      data: featureCollection(bufferedFeatures),
    });

    map.value.addLayer({
      id: "buffer-layer",
      type: "fill",
      source: "buffer-source",
      paint: {
        "fill-color": bufferColor.value,
        "fill-opacity": 0.3,
      },
    });

    map.value.addLayer({
      id: "buffer-outline",
      type: "line",
      source: "buffer-source",
      paint: {
        "line-color": bufferColor.value,
        "line-width": 2,
      },
    });

    isBufferVisible.value = true;
  } catch (error) {
    console.error("Error creating buffer:", error);
    isBufferVisible.value = false;
  }
};

// Apply and send to API
const applyAnalysis = async () => {
  if (!canPreview.value) return;

  isLoading.value = true;

  try {
    const { distance, unit } = getCurrentBufferDistanceAndUnit();

    // Convert to meters
    let radiusInMeters = distance;
    if (unit === "kilometers") {
      radiusInMeters = distance * 1000;
    } else if (unit === "miles") {
      radiusInMeters = distance * 1609.34;
    } else if (unit === "feet") {
      radiusInMeters = distance * 0.3048;
    } else if (unit === "yards") {
      radiusInMeters = distance * 0.9144;
    } else if (unit === "inches") {
      radiusInMeters = distance * 0.0254;
    } else if (unit === "nauticalmiles") {
      radiusInMeters = distance * 1852;
    } else if (unit === "centimeters") {
      radiusInMeters = distance * 0.01;
    }

    const payload = {
      tower_ids: selectedTowers.value.map((t) => t.id),
      radius: Math.round(radiusInMeters),
    };

    const { data } = await $fetch<any>(
      "/panel/analysis/fwa-quadrant-direction",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        body: JSON.stringify(payload),
      }
    );

    addAnalysisLayers(data);

    analysisStore.addDataBufferAnalysis(data);

    featureStore.setMapInfo("analytic");

    currentAnalysisType.value = "directional_quadrant_analysis";

    toast.add({
      title: "Analysis Complete",
      description:
        "Directional quadrant analysis has been successfully applied",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
      },
    });

    clearBufferLayer();
    clearHighlightLayer();
    selectedTowers.value = [];
    isBufferVisible.value = false;
  } catch (error) {
    console.error("Error applying directional quadrant analysis:", error);
    toast.add({
      title: "Analysis Failed",
      description: "Please try again later",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
      },
    });
  } finally {
    isLoading.value = false;
  }
};

// Reset all selections
const handleReset = () => {
  selectedTowers.value = [];
  clearBufferLayer();
  clearHighlightLayer();
  clearAnalysisLayers();
  isBufferVisible.value = false;
};

onMounted(() => {
  if (map.value) {
    map.value.on("click", handleMapClick);
    map.value.on("mousemove", handleMouseMove);
  }
  analysisStore.setBufferToolActive(true);
});

onUnmounted(() => {
  if (map.value) {
    map.value.off("click", handleMapClick);
    map.value.off("mousemove", handleMouseMove);
    map.value.getCanvas().style.cursor = "default";
    clearBufferLayer();
    clearHighlightLayer();
    clearAnalysisLayers();
  }
  analysisStore.setBufferToolActive(false);
});

watch(
  [
    selectedDistance,
    customDistance,
    customUnit,
    toogleCustomDistance,
    bufferColor,
  ],
  () => {
    if (isBufferVisible.value && selectedTowers.value.length > 0) {
      previewBuffer();
    }
  }
);
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <!-- Description -->
    <p class="text-2xs text-grey-400">
      Click on tower features on the map to select for directional quadrant
      analysis.
    </p>

    <!-- Selected count and reset -->
    <div class="flex items-center justify-between">
      <p class="text-[10px] text-grey-700">
        {{ selectedTowersCount }} Tower(s) Selected
      </p>
      <UButton
        v-if="selectedTowersCount > 0"
        variant="ghost"
        color="red"
        size="2xs"
        :ui="{ rounded: 'rounded-xxs', padding: { '2xs': 'px-2 py-1' } }"
        @click="handleReset"
      >
        Reset
      </UButton>
    </div>

    <UDivider label="Buffer Setting" :ui="{ label: 'text-[10px]' }" />

    <!-- Distance and Color Selection -->
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1">
        <UButton
          v-for="distance in distanceOptions"
          :key="distance"
          :label="distance"
          size="2xs"
          :variant="
            selectedDistance === distance && !toogleCustomDistance
              ? 'solid'
              : 'outline'
          "
          :color="
            selectedDistance === distance && !toogleCustomDistance
              ? 'brand'
              : 'gray'
          "
          :ui="{ rounded: 'rounded-xxs' }"
          @click="selectDistance(distance)"
        />
      </div>

      <div class="h-6 w-px bg-gray-300"></div>

      <UInput
        :ui="{ rounded: 'rounded-xxs' }"
        size="2xs"
        type="color"
        class="min-w-32 h-6"
        v-model="bufferColor"
      />
    </div>

    <!-- Custom Distance Toggle -->
    <div class="flex items-center gap-2">
      <UToggle size="md" v-model="toogleCustomDistance" />
      <p class="text-[12px]">Custom Distance</p>
    </div>

    <!-- Custom Distance Input -->
    <div
      v-if="toogleCustomDistance"
      class="grid grid-cols-5 gap-3 items-center"
    >
      <UInput
        :ui="{ rounded: 'rounded-xxs' }"
        size="xs"
        placeholder="Enter distance"
        type="number"
        class="flex-1 col-span-3"
        v-model="customDistance"
      />
      <USelectMenu
        :ui="{ rounded: 'rounded-xxs' }"
        :uiMenu="{ rounded: 'rounded-xxs' }"
        size="xs"
        :options="unitOptions"
        class="col-span-2"
        v-model="customUnit"
      />
    </div>

    <UDivider />

    <!-- Action Buttons -->
    <div class="grid grid-cols-2 gap-x-3">
      <UButton
        variant="outline"
        color="base"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="w-full justify-center text-sm"
        :disabled="!canPreview"
        @click="previewBuffer"
      >
        Preview Buffer
      </UButton>
      <UButton
        :loading="isLoading"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="w-full justify-center text-sm"
        :disabled="!canPreview"
        @click="applyAnalysis"
      >
        Apply Analysis
      </UButton>
    </div>
  </div>
</template>
