<script lang="ts" setup>
import { ref, computed } from "vue";
import { storeToRefs } from "pinia";
import bbox from "@turf/bbox";
import { featureCollection } from "@turf/helpers";
import maplibregl from "maplibre-gl";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";

const authStore = useAuth();
const toast = useToast();
const mapRefStore = useMapRef();
const analysisStore = useAnalysisResult();
const { quickRouteInsightData } = storeToRefs(analysisStore);

// Data visibility state
const isDataVisible = ref(true);
const LAYER_ID = "quick-route-insight-buffer-analysis";
const ROUTE_LAYER_ID = "quick-route-insight-routes";
const BUFFER_LAYER_ID = "quick-route-insight-buffers";
const TOWER_LAYER_ID = "quick-route-insight-towers";

// Compute data from store
const potentialData = computed(() => quickRouteInsightData.value?.result);
const isLoading = computed(() => false); // No loading since data comes from store
const isError = computed(() => false);
const error = computed(() => null);

const geojsonSector = computed(() => {
  return potentialData.value?.geojson_sector;
});

const geojsonRoute = computed(() => {
  return potentialData.value?.geojson_route;
});

const geojsonBuffer = computed(() => {
  return potentialData.value?.geojson_buffer;
});

const geojsonTower = computed(() => {
  return potentialData.value?.geojson_tower;
});

const analysisRadius = computed(
  () => potentialData.value?.options?.radius || 0,
);

// Excel file ID from the response
const excelFileId = computed(() => quickRouteInsightData.value?.excel);

// Add sector layer to map
const addSectorLayerToMap = (geojson: any) => {
  if (!geojson) return;

  const map = mapRefStore.map;
  if (!map) return;

  // Remove existing layers
  removeSectorLayerFromMap();

  // Add source
  map.addSource(LAYER_ID, {
    type: "geojson",
    data: geojson,
    promoteId: "id",
  });

  // Add fill layer using the fill property from each feature
  map.addLayer({
    id: `${LAYER_ID}-fill`,
    type: "fill",
    source: LAYER_ID,
    paint: {
      "fill-color": ["get", "fill"],
      "fill-opacity": 0.3,
    },
  });

  // Add line layer using the fill property for stroke as well
  map.addLayer({
    id: `${LAYER_ID}-line`,
    type: "line",
    source: LAYER_ID,
    paint: {
      "line-color": ["get", "fill"],
      "line-width": 2,
    },
  });

  // Add label layer for percentage (visible at zoom 13+)
  map.addLayer({
    id: `${LAYER_ID}-label`,
    type: "symbol",
    source: LAYER_ID,
    minzoom: 15,
    layout: {
      "text-field": ["concat", ["to-string", ["get", "percentage"]], "%"],
      "text-size": 14,
      "text-anchor": "center",
      "text-offset": [0, 0],
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
};

// Remove sector layer from map
const removeSectorLayerFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;

  if (map.getLayer(`${LAYER_ID}-label`)) {
    map.removeLayer(`${LAYER_ID}-label`);
  }
  if (map.getLayer(`${LAYER_ID}-line`)) {
    map.removeLayer(`${LAYER_ID}-line`);
  }
  if (map.getLayer(`${LAYER_ID}-fill`)) {
    map.removeLayer(`${LAYER_ID}-fill`);
  }
  if (map.getSource(LAYER_ID)) {
    map.removeSource(LAYER_ID);
  }
};

// Add route layer to map
const addRouteLayerToMap = (geojson: any) => {
  if (!geojson) return;

  const map = mapRefStore.map;
  if (!map) return;

  // Remove existing layers
  removeRouteLayerFromMap();

  // Add source
  map.addSource(ROUTE_LAYER_ID, {
    type: "geojson",
    data: geojson,
    promoteId: "id",
  });

  // Add line layer for routes
  map.addLayer({
    id: `${ROUTE_LAYER_ID}-line`,
    type: "line",
    source: ROUTE_LAYER_ID,
    paint: {
      "line-color": "#3B82F6", // Blue color for routes
      "line-width": 3,
      "line-opacity": 0.8,
    },
  });

  // Add line outline for better visibility
  map.addLayer({
    id: `${ROUTE_LAYER_ID}-outline`,
    type: "line",
    source: ROUTE_LAYER_ID,
    paint: {
      "line-color": "#1E40AF", // Darker blue for outline
      "line-width": 5,
      "line-opacity": 0.3,
    },
  });
};

// Remove route layer from map
const removeRouteLayerFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;

  if (map.getLayer(`${ROUTE_LAYER_ID}-outline`)) {
    map.removeLayer(`${ROUTE_LAYER_ID}-outline`);
  }
  if (map.getLayer(`${ROUTE_LAYER_ID}-line`)) {
    map.removeLayer(`${ROUTE_LAYER_ID}-line`);
  }
  if (map.getSource(ROUTE_LAYER_ID)) {
    map.removeSource(ROUTE_LAYER_ID);
  }
};

// Add buffer layer to map
const addBufferLayerToMap = (geojson: any) => {
  if (!geojson) return;

  const map = mapRefStore.map;
  if (!map) return;

  // Remove existing layers
  removeBufferLayerFromMap();

  // Add source
  map.addSource(BUFFER_LAYER_ID, {
    type: "geojson",
    data: geojson,
    promoteId: "id",
  });

  // Add fill layer for buffers
  map.addLayer({
    id: `${BUFFER_LAYER_ID}-fill`,
    type: "fill",
    source: BUFFER_LAYER_ID,
    paint: {
      "fill-color": "#8B5CF6", // Purple color for buffers
      "fill-opacity": 0.1,
    },
  });

  // Add line layer for buffer outlines
  map.addLayer({
    id: `${BUFFER_LAYER_ID}-line`,
    type: "line",
    source: BUFFER_LAYER_ID,
    paint: {
      "line-color": "#8B5CF6",
      "line-width": 1,
      "line-opacity": 0.4,
      "line-dasharray": [2, 2],
    },
  });
};

// Remove buffer layer from map
const removeBufferLayerFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;

  if (map.getLayer(`${BUFFER_LAYER_ID}-line`)) {
    map.removeLayer(`${BUFFER_LAYER_ID}-line`);
  }
  if (map.getLayer(`${BUFFER_LAYER_ID}-fill`)) {
    map.removeLayer(`${BUFFER_LAYER_ID}-fill`);
  }
  if (map.getSource(BUFFER_LAYER_ID)) {
    map.removeSource(BUFFER_LAYER_ID);
  }
};

// Tower colors mapping
const towerColors: Record<string, string> = {
  CTM: "#10B981",
  TBG: "#F5C400",
  Alfa: "#EF4444",
  Balcom: "#F59E0B",
  Gihon: "#3B82F6",
  PKP: "#8B5CF6",
};

// Ensure tower icon is loaded
const ensureTowerIconLoaded = async () => {
  const map = mapRefStore.map;
  if (!map || map.hasImage("tower-icon")) return;

  const { towerIconSvg2 } = await import("~/constants");

  return new Promise<void>((resolve, reject) => {
    const img = new Image(25, 25);
    img.onload = () => {
      if (map && !map.hasImage("tower-icon")) {
        map.addImage("tower-icon", img, { sdf: true });
      }
      resolve();
    };
    img.onerror = (error) => {
      console.error("Failed to load tower icon:", error);
      reject(error);
    };
    img.src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(towerIconSvg2);
  });
};

// Add tower layer to map
const addTowerLayerToMap = async () => {
  const map = mapRefStore.map;
  if (!map || !geojsonTower.value) return;

  await ensureTowerIconLoaded();
  removeTowerLayerFromMap();

  map.addSource(TOWER_LAYER_ID, {
    type: "geojson",
    data: geojsonTower.value,
  });

  const colorExpression: any = ["match", ["get", "owner"]];
  Object.entries(towerColors).forEach(([owner, color]) => {
    colorExpression.push(owner, color);
  });
  colorExpression.push("#F97316");

  map.addLayer({
    id: TOWER_LAYER_ID,
    type: "symbol",
    source: TOWER_LAYER_ID,
    minzoom: 12,
    maxzoom: 18,
    layout: {
      "icon-image": "tower-icon",
      "icon-size": 1.2,
      "icon-allow-overlap": true,
      visibility: "visible",
    },
    paint: {
      "icon-color": colorExpression,
      "icon-opacity": 0.9,
    },
  });
};

// Remove tower layer from map
const removeTowerLayerFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;

  if (map.getLayer(TOWER_LAYER_ID)) {
    map.removeLayer(TOWER_LAYER_ID);
  }
  if (map.getSource(TOWER_LAYER_ID)) {
    map.removeSource(TOWER_LAYER_ID);
  }
};

// Fly to extent of all layers
const flyToExtent = () => {
  const map = mapRefStore.map;
  if (!map) return;

  // Collect all features from all geojson layers
  const allFeatures = [];

  if (geojsonRoute.value?.features) {
    allFeatures.push(...geojsonRoute.value.features);
  }
  if (geojsonBuffer.value?.features) {
    allFeatures.push(...geojsonBuffer.value.features);
  }
  if (geojsonTower.value?.features) {
    allFeatures.push(...geojsonTower.value.features);
  }
  if (geojsonSector.value?.features) {
    allFeatures.push(...geojsonSector.value.features);
  }

  if (allFeatures.length === 0) return;

  try {
    // Create a feature collection and calculate bounds
    const fc = featureCollection(allFeatures);
    const bounds = bbox(fc);

    // Fly to bounds
    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {
        padding: 80,
        duration: 1500,
        maxZoom: 16,
      },
    );
  } catch (error) {
    console.error("Error flying to extent:", error);
  }
};

// Hide existing tower layers (from main map)
const hideExistingTowerLayers = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const mapLayerStore = useMapLayer();
  const { groupedActiveLayers } = storeToRefs(mapLayerStore);

  if (!groupedActiveLayers.value) return;

  const sitePointsGroup = groupedActiveLayers.value.find(
    (group) => group.label === "Site Points",
  );

  if (!sitePointsGroup) return;

  sitePointsGroup.layerLists.forEach((layer) => {
    const isTowerLayer =
      layer.category?.category_id === 3 && layer.geometry_type === "Symbol";

    if (isTowerLayer && layer.layer_id) {
      if (map.getLayer(layer.layer_id)) {
        map.setLayoutProperty(layer.layer_id, "visibility", "none");
      }
    }
  });
};

// Show existing tower layers (restore visibility)
const showExistingTowerLayers = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const mapLayerStore = useMapLayer();
  const { groupedActiveLayers } = storeToRefs(mapLayerStore);

  if (!groupedActiveLayers.value) return;

  const sitePointsGroup = groupedActiveLayers.value.find(
    (group) => group.label === "Site Points",
  );

  if (!sitePointsGroup) return;

  sitePointsGroup.layerLists.forEach((layer) => {
    const isTowerLayer =
      layer.category?.category_id === 3 && layer.geometry_type === "Symbol";

    if (isTowerLayer && layer.layer_id) {
      if (map.getLayer(layer.layer_id)) {
        // Restore to original visibility state
        const originalVisibility =
          layer.layer_style.layout_visibility || "visible";
        map.setLayoutProperty(layer.layer_id, "visibility", originalVisibility);
      }
    }
  });
};

// Watch for data changes and add to map
watch(
  potentialData,
  async (newData) => {
    if (!newData) return;

    // Hide existing tower layers first
    hideExistingTowerLayers();

    // Add all layers
    if (newData.geojson_sector) {
      addSectorLayerToMap(newData.geojson_sector);
    }
    if (newData.geojson_route) {
      addRouteLayerToMap(newData.geojson_route);
    }
    if (newData.geojson_buffer) {
      addBufferLayerToMap(newData.geojson_buffer);
    }
    if (newData.geojson_tower) {
      await addTowerLayerToMap();
    }

    // Fly to extent after adding all layers
    nextTick(() => {
      flyToExtent();
    });
  },
  { immediate: true },
);

// Cleanup on unmount
onUnmounted(() => {
  removeSectorLayerFromMap();
  removeRouteLayerFromMap();
  removeBufferLayerFromMap();
  removeTowerLayerFromMap();

  // Restore existing tower layers
  showExistingTowerLayers();
});

// Toggle layer visibility
const toggleVisibility = () => {
  isDataVisible.value = !isDataVisible.value;
  const map = mapRefStore.map;
  if (!map) return;

  const visibility = isDataVisible.value ? "visible" : "none";

  // Toggle sector layers
  if (map.getLayer(`${LAYER_ID}-fill`)) {
    map.setLayoutProperty(`${LAYER_ID}-fill`, "visibility", visibility);
  }
  if (map.getLayer(`${LAYER_ID}-line`)) {
    map.setLayoutProperty(`${LAYER_ID}-line`, "visibility", visibility);
  }
  if (map.getLayer(`${LAYER_ID}-label`)) {
    map.setLayoutProperty(`${LAYER_ID}-label`, "visibility", visibility);
  }

  // Toggle route layers
  if (map.getLayer(`${ROUTE_LAYER_ID}-outline`)) {
    map.setLayoutProperty(
      `${ROUTE_LAYER_ID}-outline`,
      "visibility",
      visibility,
    );
  }
  if (map.getLayer(`${ROUTE_LAYER_ID}-line`)) {
    map.setLayoutProperty(`${ROUTE_LAYER_ID}-line`, "visibility", visibility);
  }

  // Toggle buffer layers
  if (map.getLayer(`${BUFFER_LAYER_ID}-fill`)) {
    map.setLayoutProperty(`${BUFFER_LAYER_ID}-fill`, "visibility", visibility);
  }
  if (map.getLayer(`${BUFFER_LAYER_ID}-line`)) {
    map.setLayoutProperty(`${BUFFER_LAYER_ID}-line`, "visibility", visibility);
  }

  // Toggle tower layers
  if (map.getLayer(TOWER_LAYER_ID)) {
    map.setLayoutProperty(TOWER_LAYER_ID, "visibility", visibility);
  }
};

// Download Excel file
const isDownloadingExcel = ref(false);

const downloadExcel = async () => {
  if (!excelFileId.value) {
    toast.add({
      title: "No Excel File",
      description: "No Excel file available for this analysis",
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

  isDownloadingExcel.value = true;
  try {
    // Create download URL for the asset
    const downloadUrl = `/panel/assets/${excelFileId.value}`;

    // Trigger download
    const link = document.createElement("a");
    link.href = downloadUrl;
    link.download = `quick-route-insight-${Date.now()}.xlsx`;
    link.target = "_blank";
    link.click();

    toast.add({
      title: "Download Started",
      description: "Excel file is being downloaded",
      icon: "i-heroicons-arrow-down-tray",
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  } catch (error) {
    console.error("Excel download error:", error);
    toast.add({
      title: "Download Failed",
      description: "Failed to download Excel file",
      icon: "i-heroicons-x-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
  } finally {
    isDownloadingExcel.value = false;
  }
};
</script>

<template>
  <div class="py-3 flex flex-col gap-3">
    <!-- Section 1: Action Buttons -->
    <div class="flex flex-col gap-2">
      <div class="grid grid-cols-2 gap-2">
        <!-- Visible on Map Button -->
        <UButton
          size="xs"
          :color="isDataVisible ? 'gray' : 'gray'"
          variant="outline"
          :ui="{ rounded: 'rounded-xxs', padding: { xs: 'px-2 py-2' } }"
          @click="toggleVisibility"
          :disabled="
            !potentialData ||
            (Array.isArray(potentialData) && potentialData.length === 0)
          "
          block
          class="flex items-center gap-1"
        >
          <component
            :is="isDataVisible ? IcEye : IcEyeCrossed"
            class="w-4 h-4"
          />
          <span class="text-[10px]">{{
            isDataVisible ? "Visible" : "Hidden"
          }}</span>
        </UButton>

        <!-- Download Excel Button -->
        <UButton
          size="xs"
          color="gray"
          variant="outline"
          :ui="{ rounded: 'rounded-xxs', padding: { xs: 'px-2 py-2' } }"
          @click="downloadExcel"
          :disabled="!excelFileId || isDownloadingExcel"
          :loading="isDownloadingExcel"
          block
          class="flex items-center gap-1"
        >
          <UIcon
            v-if="!isDownloadingExcel"
            name="i-heroicons-table-cells"
            class="w-4 h-4"
          />
          <span class="text-[10px]">{{
            isDownloadingExcel ? "Downloading..." : "Download"
          }}</span>
        </UButton>
      </div>
    </div>

    <UDivider />

    <!-- Section 2: Data List -->
    <div class="flex flex-col gap-2">
      <p class="text-md text-grey-700 font-semibold">
        Quick Route Insight Result
      </p>

      <MapAnalysisQuickRouteInsightContent
        :data="potentialData"
        :is-loading="isLoading"
        :is-error="isError"
        :error="error"
        :radius="analysisRadius"
      />
    </div>
  </div>
</template>
