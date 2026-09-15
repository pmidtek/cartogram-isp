<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from "vue";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Map, GeoJSONSource } from "maplibre-gl";
import {
  calculateRouteLength,
  geometryToFeature,
  extractGeometry,
} from "~/utils/routeGeometry";

const emit = defineEmits(["on-close"]);

// Stores
const mapRefStore = useMapRef();
const authStore = useAuth();
const featureStore = useFeature();
const layerStore = useMapLayer();
const toast = useToast();

const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);

// Route data
const routeData = ref<any>(null);
const isLoading = ref(false);

// State
const isSaving = ref(false);
const newRouteGeometry = ref<GeoJSON.LineString | null>(null);
const mapDraw = ref<MapboxDraw | null>(null);
const drawFeatureId = ref<string | null>(null);
const originalLineCoords = ref<[number, number][]>([]);

// Site points (fetched)
const siteFromData = ref<any>(null);
const siteToData = ref<any>(null);

// Calculate new route length
const routeLength = computed(() => {
  if (newRouteGeometry.value) {
    return (calculateRouteLength(newRouteGeometry.value) * 1000).toFixed(2);
  }
  if (routeData.value?.geom) {
    const geometry = extractGeometry(routeData.value.geom);
    if (geometry && geometry.type === "LineString") {
      return (calculateRouteLength(geometry) * 1000).toFixed(2);
    }
  }
  return "0.00";
});

// Site names for display
const siteFromName = computed(() => {
  return (
    siteFromData.value?.name ||
    siteFromData.value?.code ||
    `Site ${routeData.value?.site_from}`
  );
});

const siteToName = computed(() => {
  return (
    siteToData.value?.name ||
    siteToData.value?.code ||
    `Site ${routeData.value?.site_to}`
  );
});

// Check if user can save
const canSave = computed(() => {
  return newRouteGeometry.value !== null && !isSaving.value;
});

// Fetch route data
const fetchRouteData = async (routeId: number) => {
  isLoading.value = true;

  try {
    const response = await $fetch(`/panel/items/routes/${routeId}?fields=*`, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    routeData.value = (response as any).data;

    // Fetch site points
    await fetchSitePoints();

    // Immediately start editing after route is loaded
    await nextTick();
    startEditingMode();
  } catch (error) {
    console.error("Failed to fetch route data:", error);
    toast.add({
      title: "Error",
      description: "Could not load route data",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    handleClose();
  } finally {
    isLoading.value = false;
  }
};

// Fetch site point data
const fetchSitePoints = async () => {
  if (!routeData.value) return;

  try {
    const [siteFromResponse, siteToResponse] = await Promise.all([
      $fetch(`/panel/items/site_points/${routeData.value.site_from}`, {
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
      }),
      $fetch(`/panel/items/site_points/${routeData.value.site_to}`, {
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
      }),
    ]);

    siteFromData.value = (siteFromResponse as any).data;
    siteToData.value = (siteToResponse as any).data;
  } catch (error) {
    console.error("Failed to fetch site points:", error);
  }
};

// Start editing mode - hide route and show vertices
const startEditingMode = () => {
  const map = mapRefStore.map as Map;
  if (!map || !routeData.value) return;

  try {
    // Hide the original route layers
    hideRouteLayer();

    // Initialize MapBox Draw
    mapDraw.value = new MapboxDraw({
      displayControlsDefault: false,
      controls: {
        trash: true,
      },
      defaultMode: "simple_select",
    });

    // Add draw control to map
    map.addControl(mapDraw.value as any);

    // Get the existing route geometry
    const geometry = extractGeometry(routeData.value.geom);
    if (geometry && geometry.type === "LineString") {
      // Store original coordinates
      originalLineCoords.value = [...geometry.coordinates] as [
        number,
        number,
      ][];

      // Add the existing route as a feature to edit
      const featureId = mapDraw.value.add({
        type: "Feature",
        properties: {},
        geometry: geometry,
      });

      drawFeatureId.value = featureId[0];

      // Switch to direct_select mode to allow vertex editing
      mapDraw.value.changeMode("direct_select", {
        featureId: featureId[0],
      });
    }

    // Listen for draw events
    map.on("draw.update", handleDrawUpdate);

    toast.add({
      title: "Edit Mode Active",
      description: "Drag middle vertices to edit. Start/end points are locked.",
      icon: "i-heroicons-pencil",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } catch (error) {
    console.error("Failed to initialize editing:", error);
    toast.add({
      title: "Error",
      description: "Could not enable editing mode",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  }
};

// Hide only the selected route by filtering it out
const hideRouteLayer = () => {
  const map = mapRefStore.map as Map;
  if (!map || !routeData.value) return;

  const routeId = routeData.value.id;
  const style = map.getStyle();
  if (!style || !style.layers) return;

  // Find route layers and apply filter to hide only the selected route
  style.layers.forEach((layer: any) => {
    if (layer.id.includes("routes_") && layer.type === "line") {
      // Set filter to exclude the selected route by feature ID
      // Use ["id"] to access the feature's ID directly (not a property)
      map.setFilter(layer.id, ["!=", ["id"], routeId]);
    }
  });
};

// Show the selected route again by removing the filter
const showRouteLayer = () => {
  const map = mapRefStore.map as Map;
  if (!map) return;

  const style = map.getStyle();
  if (!style || !style.layers) return;

  // Remove filters to show all routes again
  style.layers.forEach((layer: any) => {
    if (layer.id.includes("routes_") && layer.type === "line") {
      // Reset filter to show all routes (use original filter if it exists)
      const originalFilter = layer.filter;
      if (originalFilter) {
        map.setFilter(layer.id, originalFilter);
      } else {
        map.setFilter(layer.id, null);
      }
    }
  });
};

// Handle draw update events
const handleDrawUpdate = (e: any) => {
  const feature = e.features[0];
  if (!feature || feature.geometry.type !== "LineString") return;

  const coords = feature.geometry.coordinates;
  const changed = e.action === "change_coordinates";

  if (changed && originalLineCoords.value.length > 0) {
    // Lock start and end points to original coordinates
    coords[0] = originalLineCoords.value[0];
    coords[coords.length - 1] =
      originalLineCoords.value[originalLineCoords.value.length - 1];

    // Overwrite the edited feature with locked endpoints
    if (mapDraw.value) {
      mapDraw.value.add(feature);
    }
  }

  // Update the new geometry
  newRouteGeometry.value = feature.geometry as GeoJSON.LineString;
};

// Reset to route selection
const handleReset = () => {
  // Clean up draw
  const map = mapRefStore.map as Map;
  if (map && mapDraw.value) {
    map.removeControl(mapDraw.value as any);
    map.off("draw.update", handleDrawUpdate);
    map.off("draw.selectionchange", handleDrawUpdate);
  }

  mapDraw.value = null;
  drawFeatureId.value = null;
  newRouteGeometry.value = null;
  routeData.value = null;
  siteFromData.value = null;
  siteToData.value = null;

  // Show route layers again
  showRouteLayer();

  // Clear feature store
  featureStore.featureIdEdit = null;

  // Setup route selection again
  setupRouteSelection();
};

// Save new geometry
const saveGeometry = async () => {
  if (!newRouteGeometry.value || !routeData.value) return;

  isSaving.value = true;

  try {
    await $fetch(`/panel/items/routes/${routeData.value.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: {
        geom: geometryToFeature(newRouteGeometry.value),
      },
    });

    toast.add({
      title: "Route Updated",
      description: "Route path has been updated successfully",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });

    try {
      const map = mapRefStore.map;
      if (map) {
        const style = map.getStyle();
        const allLayers: any[] = style?.layers || [];

        const keywords = ["routes", "cables", "highlight"];
        const routeLayers = allLayers.filter((ly: any) =>
          keywords.some((key) => ly["source-layer"]?.includes(key)),
        );

        routeLayers.forEach((ly: any) => {
          if (map.getLayer(ly.id)) map.removeLayer(ly.id);
        });

        const sourceIds = Array.from(
          new Set(
            routeLayers
              .map((ly: any) => ly.source)
              .filter((s: any) => typeof s === "string"),
          ),
        );

        sourceIds.forEach((srcId) => {
          if (map.getSource(srcId)) {
            try {
              map.removeSource(srcId);
            } catch (e) {
              console.warn("Failed to remove source", srcId, e);
            }
          }
        });

        (map!.getSource("highlight") as GeoJSONSource).setData(
          emptyFeatureCollection,
        );
      }

      pauseAllAnimation();
    } catch (e) {
      console.warn("Failed to remove route layers:", e);
    }

    // Refetch active layers to reload with new data
    try {
      await layerStore.fetchActiveLayers(currentModule.value?.slug);
    } catch (e) {
      console.warn("Failed to refetch active layers:", e);
    }

    // Wait a bit for layers to load before cleanup
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Clean up and close
    cleanupAfterSave();
    emit("on-close");
  } catch (error) {
    console.error("Save failed:", error);
    toast.add({
      title: "Save Failed",
      description: "Could not update route path. Please try again.",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isSaving.value = false;
  }
};

// Close editor
const handleClose = () => {
  cleanup();
  emit("on-close");
};

// Track original cable visibility state
const cableLayersHidden = ref(false);

// Hide cables layer
const hideCablesLayer = () => {
  const cablesGroup = layerStore.groupedActiveLayers?.find(
    (group) => group.label === "Cables",
  );

  if (cablesGroup && cablesGroup.layerLists.length > 0) {
    const hasVisibleCables = cablesGroup.layerLists.some(
      (layer) => layer.layer_style.layout_visibility === "visible",
    );

    if (hasVisibleCables) {
      layerStore.toggleCategoryVisibility("Cables");
      cableLayersHidden.value = true;

      const map = mapRefStore.map;
      if (map) {
        nextTick(() => {
          cablesGroup.layerLists.forEach((layer) => {
            if (map.getLayer(layer.layer_id)) {
              map.setLayoutProperty(layer.layer_id, "visibility", "none");
            }
          });
        });
      }
    }
  }
};

// Restore cables layer
const restoreCablesLayer = () => {
  if (cableLayersHidden.value) {
    layerStore.toggleCategoryVisibility("Cables");
    cableLayersHidden.value = false;
  }
};

// Cleanup after save (route layers already refreshed)
const cleanupAfterSave = () => {
  const map = mapRefStore.map as Map;

  // Remove draw control
  if (map && mapDraw.value) {
    try {
      map.removeControl(mapDraw.value as any);
      map.off("draw.update", handleDrawUpdate);
      map.off("draw.selectionchange", handleDrawUpdate);
    } catch (e) {
      console.warn("Failed to remove draw control:", e);
    }
  }

  mapDraw.value = null;
  drawFeatureId.value = null;
  newRouteGeometry.value = null;
  routeData.value = null;
  siteFromData.value = null;
  siteToData.value = null;

  // Restore cables
  restoreCablesLayer();

  // Re-enable popups
  mapRefStore.setDrawMode(false);

  // Clear feature store
  featureStore.featureIdEdit = null;
};

// Cleanup on component unmount or close
const cleanup = () => {
  const map = mapRefStore.map as Map;

  // Remove draw control
  if (map && mapDraw.value) {
    try {
      map.removeControl(mapDraw.value as any);
      map.off("draw.update", handleDrawUpdate);
      map.off("draw.selectionchange", handleDrawUpdate);
    } catch (e) {
      console.warn("Failed to remove draw control:", e);
    }
  }

  mapDraw.value = null;
  drawFeatureId.value = null;
  newRouteGeometry.value = null;
  routeData.value = null;
  siteFromData.value = null;
  siteToData.value = null;

  // Show route layers back (if not already saved)
  showRouteLayer();

  // Restore cables
  restoreCablesLayer();

  // Re-enable popups
  mapRefStore.setDrawMode(false);

  // Clear feature store
  featureStore.featureIdEdit = null;
};

// Setup route selection handler
const setupRouteSelection = () => {
  const map = mapRefStore.map;
  if (!map) return;

  // Add click handler for route selection
  const handleRouteClick = (e: any) => {
    // Get all route layer IDs
    const routeLayers =
      layerStore.groupedActiveLayers
        ?.flatMap((group) => group.layerLists)
        .filter(
          (layer: any) =>
            layer.layer_id &&
            (layer.layer_id.includes("routes_") ||
              layer.table_name === "routes"),
        )
        .map((layer: any) => layer.layer_id) || [];

    const features = map.queryRenderedFeatures(e.point, {
      layers: routeLayers,
    });

    if (features.length > 0) {
      const routeFeature = features[0];
      const routeId = routeFeature.id;

      if (routeId) {
        // Set the feature ID and fetch route data
        featureStore.featureIdEdit = routeId as number;

        // Remove the click handler after selection
        map.off("click", handleRouteClick);
      }
    }
  };

  map.on("click", handleRouteClick);
};

// Watch for featureIdEdit changes
watch(
  () => featureStore.featureIdEdit,
  (newId) => {
    if (newId) {
      fetchRouteData(newId);
    }
  },
  { immediate: true },
);

// Lifecycle
onMounted(async () => {
  // Disable popups
  mapRefStore.setDrawMode(true);

  await nextTick();

  setTimeout(() => {
    hideCablesLayer();
  }, 200);

  if (featureStore.featureIdEdit) {
    fetchRouteData(featureStore.featureIdEdit);
  } else {
    setupRouteSelection();
  }
});

onUnmounted(() => {
  cleanup();
});
</script>

<template>
  <div class="p-2">
    <!-- Loading State -->
    <div v-if="isLoading" class="flex items-center justify-center py-8">
      <div class="text-center space-y-3">
        <div
          class="w-10 h-10 border-3 border-grey-200 border-t-brand-500 rounded-full animate-spin mx-auto"
        ></div>
        <p class="text-xs text-grey-600">Loading route...</p>
      </div>
    </div>

    <!-- Step 1: Route Selection -->
    <template v-else-if="!routeData">
      <div class="flex items-center gap-3 mb-2">
        <p class="text-2xs text-[#626264]">
          Click on a route in the map to start editing
        </p>
      </div>

      <div class="mb-3 border rounded-xxs p-3 bg-blue-50">
        <p class="text-xs font-medium text-blue-900 mb-2">Instructions:</p>
        <ul class="text-xs text-blue-700 space-y-1 ml-4 list-disc">
          <li>Click on any route line in the map</li>
          <li>Route will be loaded for editing</li>
          <li>Drag middle vertices to edit the route path</li>
          <li>Start and end points are locked to site locations</li>
          <li>Click on line to add new vertices</li>
          <li>Select vertex and press delete to remove (except start/end)</li>
        </ul>
      </div>
    </template>

    <!-- Step 2: Editing Route -->
    <template v-else>
      <!-- Route Info -->
      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block">Editing Route</label>
        <div class="border rounded-xxs p-2 bg-grey-50">
          <p class="text-xs font-medium text-grey-900">
            {{ routeData.name || routeData.code || `Route ${routeData.id}` }}
          </p>
          <p class="text-2xs text-grey-600 mt-1">
            {{ siteFromName }} → {{ siteToName }}
          </p>
        </div>
      </div>

      <!-- Route Length Display -->
      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block">Route Length</label>
        <UInput v-model="routeLength" size="2xs" variant="outline" readonly>
          <template #trailing>
            <span class="text-2xs text-grey-600">meters</span>
          </template>
        </UInput>
      </div>

      <!-- Editing Status -->
      <div class="mb-3 border rounded-xxs p-2 bg-yellow-50">
        <p class="text-xs text-yellow-700">
          ✏️ Editing mode: Drag middle vertices or click line to add. Start/end
          locked.
        </p>
      </div>

      <!-- Action Buttons -->
      <div class="grid grid-cols-2 gap-2">
        <UButton
          variant="outline"
          color="gray"
          label="Cancel"
          block
          size="xs"
          @click="handleReset"
          :ui="{ rounded: 'rounded-xxs' }"
        />
        <UButton
          variant="solid"
          color="brand"
          label="Save Route"
          block
          size="xs"
          :disabled="!canSave"
          :loading="isSaving"
          @click="saveGeometry"
          :ui="{ rounded: 'rounded-xxs' }"
        />
      </div>
    </template>
  </div>
</template>
