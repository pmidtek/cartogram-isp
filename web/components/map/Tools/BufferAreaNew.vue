<script lang="ts" setup>
import { useDrawControl } from "~/utils/useDrawControl";
import { useAnalysisResult } from "~/stores/useAnalysisResult";
import buffer from "@turf/buffer";
import { featureCollection } from "@turf/helpers";
import type { GeoJSONFeature } from "maplibre-gl";

const areaCount = ref<number>(0);
const areaUnit = ref<string>("meters");
const mapStore = useMapRef();
const authStore = useAuth();
const featureStore = useFeature();
const { map } = storeToRefs(mapStore);
const analysisStore = useAnalysisResult();
const { dataBufferLineAnalysis, currentAnalysisType } =
  storeToRefs(analysisStore);
const bufferedFeaturesData = ref<GeoJSONFeature>();
const isLoadingAnalysis = ref(false);
// Selected features for buffering
const selectedFeatures = ref<any[]>([]);
const selectedFeaturesCount = ref(0);

const { drawer } = useDrawControl({
  mode: "simple_select",
  onCreated: () => {
    // Handle created features if needed
  },
  onUpdated: () => {
    // Handle updated features if needed
  },
});

const handleReset = () => {
  areaCount.value = 0;
  selectedFeatures.value = [];
  selectedFeaturesCount.value = 0;
  drawer?.deleteAll();
  clearBufferLayer();
  clearHighlightLayer();
  isBufferVisible.value = false;
};

const people = [
  "Buffer Area Based on Points",
  "Buffer Area Based on Route/Line",
];

const selected = ref(people[0]);
const toogleSelected = ref(false);
const toast = useToast();
// Distance selection
const selectedDistance = ref("100 m");
const customDistance = ref<number>();
const distanceOptions = ["100 m", "200 m", "300 m", "500 m"];

// Buffer color selection
const bufferColor = ref("#3B82F6"); // Default blue color

const selectDistance = (distance: string) => {
  selectedDistance.value = distance;
  toogleSelected.value = false; // Disable custom distance when preset is selected
};

// Get current buffer distance and unit
const getCurrentBufferDistanceAndUnit = () => {
  if (toogleSelected.value && customDistance.value) {
    // Use custom distance with selected unit
    return {
      distance: customDistance.value,
      unit: areaUnit.value,
    };
  } else {
    // Use selected preset distance (always in meters)
    return {
      distance: parseInt(selectedDistance.value.replace(" m", "")),
      unit: "meters",
    };
  }
};

// Map click handler for selecting features
const handleMapClick = (e: any) => {
  if (!map.value) return;

  const features = map.value.queryRenderedFeatures(e.point);

  if (selected.value === "Buffer Area Based on Points") {
    // For points, find point features on the map
    const pointFeatures = features.filter((f) => f.geometry.type === "Point");
    if (pointFeatures.length > 0) {
      // Check if this feature is already selected
      const isAlreadySelected = selectedFeatures.value.some(
        (selected) => selected.id === pointFeatures[0].id
      );
      if (!isAlreadySelected) {
        selectedFeatures.value.push(pointFeatures[0]);
      }
    }
  } else {
    // For lines, find line features
    const lineFeatures = features.filter(
      (f) =>
        f.geometry.type === "LineString" ||
        f.geometry.type === "MultiLineString"
    );
    if (lineFeatures.length > 0) {
      // Check if this feature is already selected
      const isAlreadySelected = selectedFeatures.value.some(
        (selected) => selected.id === lineFeatures[0].id
      );
      if (!isAlreadySelected) {
        selectedFeatures.value.push(lineFeatures[0]);
      }
    }
  }

  selectedFeaturesCount.value = selectedFeatures.value.length;

  // Update highlight visualization
  updateHighlight();
};

// Clear existing buffer layer
const clearBufferLayer = () => {
  if (!map.value) return;

  // Remove both buffer layers
  if (map.value.getLayer("buffer-layer")) {
    map.value.removeLayer("buffer-layer");
  }
  if (map.value.getLayer("buffer-outline")) {
    map.value.removeLayer("buffer-outline");
  }
  // Remove source
  if (map.value.getSource("buffer-source")) {
    map.value.removeSource("buffer-source");
  }
};

// Clear highlight layer
const clearHighlightLayer = () => {
  if (!map.value) return;

  // Remove highlight layers
  if (map.value.getLayer("selected-features-highlight")) {
    map.value.removeLayer("selected-features-highlight");
  }
  if (map.value.getLayer("selected-features-outline")) {
    map.value.removeLayer("selected-features-outline");
  }
  // Remove source
  if (map.value.getSource("selected-features-source")) {
    map.value.removeSource("selected-features-source");
  }
};

// Update highlight for selected features
const updateHighlight = () => {
  if (!map.value || selectedFeatures.value.length === 0) {
    clearHighlightLayer();
    return;
  }

  try {
    // Clear existing highlight
    clearHighlightLayer();

    // Create highlight features
    const highlightFeatures = selectedFeatures.value.map((feature) => {
      if (feature.geometry.type === "Point") {
        return feature;
      } else {
        // For lines, create a slightly buffered version for visibility
        return feature;
      }
    });

    // Add highlight source
    map.value.addSource("selected-features-source", {
      type: "geojson",
      data: featureCollection(highlightFeatures),
    });

    // Add highlight layer for points
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

    // Add highlight layer for lines
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

// Preview buffer function
const previewBuffer = () => {
  if (!map.value || selectedFeatures.value.length === 0) {
    return;
  }

  const { distance, unit } = getCurrentBufferDistanceAndUnit();

  try {
    // Create buffer for all selected features using the selected unit directly
    const bufferedFeatures = selectedFeatures.value.map((feature) => {
      return buffer(feature, distance, { units: unit as any });
    });

    bufferedFeaturesData.value = featureCollection(bufferedFeatures);
    // Clear existing buffer
    clearBufferLayer();

    // Add buffer to map
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

    // Mark buffer as visible
    isBufferVisible.value = true;
  } catch (error) {
    console.error("Error creating buffer:", error);
    isBufferVisible.value = false;
  }
};

// Apply analysis function
const applyAnalysis = async () => {
  isLoadingAnalysis.value = true;
  const allBufferFeatures = [];

  if (
    bufferedFeaturesData.value &&
    (bufferedFeaturesData.value as any).features
  ) {
    allBufferFeatures.push(...(bufferedFeaturesData.value as any).features);
  }

  if (dataBufferLineAnalysis.value && dataBufferLineAnalysis.value.bufferData) {
    if (dataBufferLineAnalysis.value.bufferData.type === "FeatureCollection") {
      allBufferFeatures.push(
        ...(dataBufferLineAnalysis.value.bufferData as any).features
      );
    } else if (dataBufferLineAnalysis.value.bufferData.type === "Feature") {
      allBufferFeatures.push(dataBufferLineAnalysis.value.bufferData);
    }
  }

  const allSourceFeatures = [];

  if (selectedFeatures.value && selectedFeatures.value.length > 0) {
    allSourceFeatures.push(...selectedFeatures.value);
  }

  if (dataBufferLineAnalysis.value && dataBufferLineAnalysis.value.sourceData) {
    if (dataBufferLineAnalysis.value.sourceData.type === "FeatureCollection") {
      allSourceFeatures.push(
        ...dataBufferLineAnalysis.value.sourceData.features
      );
    } else if (dataBufferLineAnalysis.value.sourceData.type === "Feature") {
      allSourceFeatures.push(dataBufferLineAnalysis.value.sourceData);
    }
  }

  // Get current buffer distance in meters
  const { distance, unit } = getCurrentBufferDistanceAndUnit();
  let radiusInMeters = distance;

  // Convert to meters if needed
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

  // Extract tower IDs from selected features (assuming they have an 'id' property)
  const towerIds = allSourceFeatures
    .filter((feature) => feature.id || feature.properties?.id)
    .map((feature) => feature.id || feature.properties?.id);

  const payload = {
    options: {
      radius: Math.round(radiusInMeters), // buffer radius in meters
      data_source: towerIds, // id selected towers
    },
  };

  try {
    const { data } = await $fetch<any>(
      "/panel/analysis/fixed-wireless-access",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        body: JSON.stringify(payload),
      }
    );

    analysisStore.addDataBufferAnalysis(data);
    if (featureStore.mapInfo !== "analytic") {
      featureStore.mapInfo = "analytic";
    }

    currentAnalysisType.value = "fwa_analysis";
    isLoadingAnalysis.value = false;
  } catch (error) {
    console.log(error);
    toast.add({
      title: "Failed to analysis",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: "Please try again later",
    });
  } finally {
    isLoadingAnalysis.value = false;
  }
};

// Mouse move handler for cursor feedback
const handleMouseMove = (e: any) => {
  if (!map.value) return;

  const features = map.value.queryRenderedFeatures(e.point);

  if (selected.value === "Buffer Area Based on Points") {
    const pointFeatures = features.filter((f) => f.geometry.type === "Point");
    map.value.getCanvas().style.cursor =
      pointFeatures.length > 0 ? "pointer" : "";
  } else {
    const lineFeatures = features.filter(
      (f) =>
        f.geometry.type === "LineString" ||
        f.geometry.type === "MultiLineString"
    );
    map.value.getCanvas().style.cursor =
      lineFeatures.length > 0 ? "pointer" : "";
  }
};

// Setup map click listener when component mounts
onMounted(() => {
  if (map.value) {
    map.value.on("click", handleMapClick);
    map.value.on("mousemove", handleMouseMove);
  }
});

// Cleanup map listener when component unmounts
onUnmounted(() => {
  if (map.value) {
    map.value.off("click", handleMapClick);
    map.value.off("mousemove", handleMouseMove);
    map.value.getCanvas().style.cursor = ""; // Reset cursor
    clearBufferLayer();
    clearHighlightLayer();
  }
});

// Track if buffer is currently shown
const isBufferVisible = ref(false);

// Watch for selection type changes
watch(selected, () => {
  // Reset selected features when changing selection type
  selectedFeatures.value = [];
  selectedFeaturesCount.value = 0;
  clearBufferLayer();
  clearHighlightLayer();
  isBufferVisible.value = false;
});

// Watch for distance and color changes and update buffer if visible
watch(
  [selectedDistance, customDistance, areaUnit, toogleSelected, bufferColor],
  () => {
    if (isBufferVisible.value && selectedFeatures.value.length > 0) {
      // Automatically update buffer when distance or color changes
      previewBuffer();
    }
  }
);
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <p class="text-2xs text-grey-400">
      {{
        selected === "Buffer Area Based on Points"
          ? "Click on existing point features on the map to select for buffering."
          : "Click on existing line/route features on the map to select for buffering."
      }}
    </p>
    <div class="flex items-center justify-between">
      <p class="text-[10px] text-grey-700">
        {{ selectedFeaturesCount }}
        {{
          selected === "Buffer Area Based on Points" ? "Point(s)" : "Line(s)"
        }}
        Selected
      </p>
      <UButton
        v-if="selectedFeaturesCount > 0"
        variant="ghost"
        color="red"
        size="2xs"
        :ui="{ rounded: 'rounded-xxs', padding: { '2xs': 'px-2 py-1' } }"
        @click="handleReset"
      >
        Reset
      </UButton>
    </div>
    <div class="flex gap-2 items-center">
      <USelectMenu
        :ui="{ rounded: 'rounded-xxs' }"
        :uiMenu="{ rounded: 'rounded-xxs' }"
        v-model="selected"
        :options="people"
      />
      <div class="flex items-center gap-2">
        <UToggle size="md" v-model="toogleSelected" />
        <p class="text-[12px]">Custom Distance</p>
      </div>
    </div>
    <UDivider label="Buffer Setting" :ui="{ label: 'text-[10px]' }" />

    <!-- Distance Selection -->
    <div class="flex items-center gap-2">
      <div class="flex items-center gap-1">
        <UButton
          v-for="distance in distanceOptions"
          :key="distance"
          :label="distance"
          size="2xs"
          :variant="
            selectedDistance === distance && !toogleSelected
              ? 'solid'
              : 'outline'
          "
          :color="
            selectedDistance === distance && !toogleSelected ? 'brand' : 'gray'
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

    <!-- Custom Distance Input (shown when toggle is true) -->
    <div v-if="toogleSelected" class="grid grid-cols-5 gap-3 items-center mt-1">
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
        :options="[
          'meters',
          'kilometers',
          'miles',
          'feet',
          'yards',
          'inches',
          'nauticalmiles',
          'centimeters',
        ]"
        class="col-span-2"
        v-model="areaUnit"
      />
    </div>
    <UDivider />
    <div class="grid grid-cols-2 gap-x-3">
      <UButton
        variant="outline"
        color="base"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="w-full justify-center text-sm"
        :disabled="selectedFeaturesCount === 0"
        @click="previewBuffer"
      >
        Preview Buffer
      </UButton>
      <UButton
        :loading="isLoadingAnalysis"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="w-full justify-center text-sm"
        :disabled="selectedFeaturesCount === 0"
        @click="applyAnalysis"
      >
        Apply Analysis
      </UButton>
    </div>
  </div>
</template>
