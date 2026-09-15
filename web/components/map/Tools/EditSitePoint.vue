<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import type { Map, GeoJSONSource } from "maplibre-gl";

const emit = defineEmits(["on-close"]);

// Stores
const mapRefStore = useMapRef();
const authStore = useAuth();
const featureStore = useFeature();
const layerStore = useMapLayer();
const toast = useToast();

const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);

// Site point data
const sitePointData = ref<any>(null);
const isLoading = ref(false);
const isSaving = ref(false);

// Drag state
const isDragging = ref(false);
const newPosition = ref<[number, number] | null>(null);
const originalCoordinates = ref<[number, number] | null>(null);
const dragSourceId = "draggable-site-point";
const dragLayerId = "draggable-site-point-layer";

// Track if site point is selected
const isSiteSelected = computed(() => !!sitePointData.value);

// Check if user can save
const canSave = computed(() => {
  return newPosition.value !== null && !isSaving.value;
});

// Fetch site point data
const fetchSitePointData = async (sitePointId: number) => {
  isLoading.value = true;

  try {
    const response = await $fetch(
      `/panel/items/site_points/${sitePointId}?fields=*`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    // Handle both response formats
    sitePointData.value = (response as any).data || response;

    if (!sitePointData.value) {
      throw new Error("No site point data received");
    }

    // Setup draggable site point
    await nextTick();
    setupDraggableSitePoint();
  } catch (error: any) {
    console.error("Failed to fetch site point data:", error);
    toast.add({
      title: "Error",
      description: error?.message || "Could not load site point data",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    handleClose();
  } finally {
    isLoading.value = false;
  }
};

// Setup draggable site point
const setupDraggableSitePoint = () => {
  const map = mapRefStore.map as Map;
  if (!map || !sitePointData.value) return;

  // Extract coordinates
  let lng: number, lat: number;

  if (sitePointData.value.geom) {
    const geom =
      typeof sitePointData.value.geom === "string"
        ? JSON.parse(sitePointData.value.geom)
        : sitePointData.value.geom;

    lng = geom.coordinates[0];
    lat = geom.coordinates[1];
  } else if (sitePointData.value.longitude && sitePointData.value.latitude) {
    lng = sitePointData.value.longitude;
    lat = sitePointData.value.latitude;
  } else {
    console.error(
      "No coordinates found in site point data:",
      sitePointData.value,
    );
    toast.add({
      title: "Error",
      description: "Could not find coordinates in site point data",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  const coords: [number, number] = [lng, lat];
  originalCoordinates.value = coords;

  // Hide the selected site point from original layers
  hideSitePointLayer();

  // Create draggable GeoJSON source
  map.addSource(dragSourceId, {
    type: "geojson",
    data: {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: coords,
      },
      properties: {},
    },
  });

  // Add draggable layer
  map.addLayer({
    id: dragLayerId,
    type: "circle",
    source: dragSourceId,
    paint: {
      "circle-radius": 8,
      "circle-color": "#10B981",
      "circle-stroke-width": 1,
      "circle-stroke-color": "#ffffff",
    },
  });

  // Setup drag functionality
  setupDragHandlers();

  // Fly to site point
  map.flyTo({
    center: coords,
    zoom: 17,
    duration: 1000,
  });

  toast.add({
    title: "Edit Mode Active",
    description: "Drag the site point to move it.",
    icon: "i-heroicons-hand-raised",
    ui: { background: "bg-white", title: "text-grey-800" },
  });
};

// Hide the selected site point from original layers
const hideSitePointLayer = () => {
  const map = mapRefStore.map as Map;
  if (!map || !sitePointData.value) return;

  const sitePointId = sitePointData.value.id;
  const style = map.getStyle();
  if (!style || !style.layers) return;

  // Find site point layers and apply filter to hide selected site point
  style.layers.forEach((layer: any) => {
    if (layer.id.includes("site_points_") && layer.type === "circle") {
      map.setFilter(layer.id, ["!=", ["id"], sitePointId]);
    }
  });
};

// Show the site point layer again
const showSitePointLayer = () => {
  const map = mapRefStore.map as Map;
  if (!map) return;

  const style = map.getStyle();
  if (!style || !style.layers) return;

  // Remove filters to show all site points again
  style.layers.forEach((layer: any) => {
    if (layer.id.includes("site_points_") && layer.type === "circle") {
      const originalFilter = layer.filter;
      if (originalFilter) {
        map.setFilter(layer.id, originalFilter);
      } else {
        map.setFilter(layer.id, null);
      }
    }
  });
};

// Setup drag handlers
const setupDragHandlers = () => {
  const map = mapRefStore.map as Map;
  if (!map) return;

  let startCoords: [number, number] | null = null;

  const onMouseDown = (e: any) => {
    e.preventDefault();
    const features = map.queryRenderedFeatures(e.point, {
      layers: [dragLayerId],
    });

    if (features.length === 0) return;

    isDragging.value = true;
    startCoords = [e.lngLat.lng, e.lngLat.lat];

    map.getCanvas().style.cursor = "grab";

    map.on("mousemove", onMouseMove);
    map.once("mouseup", onMouseUp);
  };

  const onMouseMove = (e: any) => {
    if (!isDragging.value) return;

    map.getCanvas().style.cursor = "grabbing";

    const coords: [number, number] = [e.lngLat.lng, e.lngLat.lat];

    // Update the draggable point position
    const source = map.getSource(dragSourceId) as GeoJSONSource;
    if (source) {
      source.setData({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: coords,
        },
        properties: {},
      });
    }

    newPosition.value = coords;
  };

  const onMouseUp = () => {
    if (!isDragging.value) return;

    isDragging.value = false;
    map.getCanvas().style.cursor = "";

    map.off("mousemove", onMouseMove);
  };

  map.on("mousedown", dragLayerId, onMouseDown);
  map.on("mouseenter", dragLayerId, () => {
    map.getCanvas().style.cursor = "grab";
  });
  map.on("mouseleave", dragLayerId, () => {
    if (!isDragging.value) {
      map.getCanvas().style.cursor = "";
    }
  });
};

// Reset to original position
const handleReset = () => {
  const map = mapRefStore.map as Map;
  if (!map || !originalCoordinates.value) return;

  const source = map.getSource(dragSourceId) as GeoJSONSource;
  if (source) {
    source.setData({
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: originalCoordinates.value,
      },
      properties: {},
    });
  }

  newPosition.value = null;

  toast.add({
    title: "Position Reset",
    description: "Site point moved back to original position",
    icon: "i-heroicons-arrow-path",
    ui: { background: "bg-white", title: "text-grey-800" },
  });
};

// Save new position
const saveSitePoint = async () => {
  if (!newPosition.value || !sitePointData.value) return;

  isSaving.value = true;

  try {
    await $fetch(`/panel/data/move-site-point/${sitePointData.value.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: {
        geom: {
          type: "Point",
          coordinates: newPosition.value,
        },
      },
    });

    toast.add({
      title: "Site Point Updated",
      description: "Site point position has been updated successfully",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });

    // Refresh site points, routes, and cables layers
    try {
      const map = mapRefStore.map;
      if (map) {
        const style = map.getStyle();
        const allLayers: any[] = style?.layers || [];

        const layersToRefresh = allLayers.filter((ly: any) => {
          const sourceLayer = ly["source-layer"];
          return (
            sourceLayer?.includes("site_points") ||
            sourceLayer?.includes("routes") ||
            sourceLayer?.includes("cables")
          );
        });

        layersToRefresh.forEach((ly: any) => {
          if (map.getLayer(ly.id)) map.removeLayer(ly.id);
        });

        const sourceIds = Array.from(
          new Set(
            layersToRefresh
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
      }
    } catch (e) {
      console.warn("Failed to remove layers:", e);
    }

    // Refetch active layers to reload with new data
    try {
      await layerStore.fetchActiveLayers(currentModule.value?.slug);
    } catch (e) {
      console.warn("Failed to refetch active layers:", e);
    }

    // Wait for layers to load
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Clean up and close
    cleanup();
    emit("on-close");
  } catch (error) {
    console.error("Save failed:", error);
    toast.add({
      title: "Save Failed",
      description: "Could not update site point. Please try again.",
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

// Cleanup
const cleanup = () => {
  const map = mapRefStore.map as Map;
  if (!map) return;

  // Remove draggable layer and source
  if (map.getLayer(dragLayerId)) {
    map.removeLayer(dragLayerId);
  }
  if (map.getSource(dragSourceId)) {
    map.removeSource(dragSourceId);
  }

  // Show site point layer again
  showSitePointLayer();

  // Remove event listeners
  map.off("mousedown", dragLayerId);
  map.off("mouseenter", dragLayerId);
  map.off("mouseleave", dragLayerId);

  sitePointData.value = null;
  newPosition.value = null;
  originalCoordinates.value = null;

  // Re-enable popups
  mapRefStore.setDrawMode(false);

  // Clear feature store
  featureStore.featureIdEdit = null;
};

// Setup site point selection handler
const setupSitePointSelection = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const handleSitePointClick = (e: any) => {
    const sitePointLayers =
      layerStore.groupedActiveLayers
        ?.flatMap((group) => group.layerLists)
        .filter(
          (layer: any) =>
            layer.layer_id &&
            (layer.layer_id.includes("site_points_") ||
              layer.table_name === "site_points"),
        )
        .map((layer: any) => layer.layer_id) || [];

    const features = map.queryRenderedFeatures(e.point, {
      layers: sitePointLayers,
    });

    if (features.length > 0) {
      const sitePointFeature = features[0];
      const sitePointId = sitePointFeature.id;

      if (sitePointId) {
        featureStore.featureIdEdit = sitePointId as number;
        map.off("click", handleSitePointClick);
      }
    }
  };

  map.on("click", handleSitePointClick);
};

// Watch for featureIdEdit changes
watch(
  () => featureStore.featureIdEdit,
  (newId) => {
    if (newId) {
      fetchSitePointData(newId);
    }
  },
  { immediate: true },
);

// Lifecycle
onMounted(async () => {
  mapRefStore.setDrawMode(true);

  await nextTick();

  if (featureStore.featureIdEdit) {
    fetchSitePointData(featureStore.featureIdEdit);
  } else {
    setupSitePointSelection();
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
        <p class="text-xs text-grey-600">Loading site point...</p>
      </div>
    </div>

    <!-- Step 1: Site Point Selection -->
    <template v-else-if="!isSiteSelected">
      <div class="flex items-center gap-3 mb-2">
        <p class="text-2xs text-[#626264]">
          Click on a site point in the map to edit its position
        </p>
      </div>

      <div class="mb-3 border rounded-xxs p-3 bg-blue-50">
        <p class="text-xs font-medium text-blue-900 mb-2">Instructions:</p>
        <ul class="text-xs text-blue-700 space-y-1 ml-4 list-disc">
          <li>Click on any site point in the map</li>
          <li>Site point will be loaded for editing</li>
          <li>Drag the site point to move it</li>
          <li>Click Save to update the position</li>
        </ul>
      </div>
    </template>

    <!-- Step 2: Editing Site Point -->
    <template v-else>
      <!-- Site Point Info -->
      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block"
          >Editing Site Point</label
        >
        <div class="border rounded-xxs p-2 bg-grey-50">
          <p class="text-xs font-medium text-grey-900">
            {{
              sitePointData.name ||
              sitePointData.code ||
              `Site Point ${sitePointData.id}`
            }}
          </p>
          <p v-if="originalCoordinates" class="text-2xs text-grey-600 mt-1">
            Original Position: {{ originalCoordinates[0].toFixed(6) }},
            {{ originalCoordinates[1].toFixed(6) }}
          </p>
        </div>
      </div>

      <!-- New Position Display -->
      <div v-if="newPosition" class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block">New Position</label>
        <div class="border rounded-xxs p-2 bg-green-50">
          <p class="text-2xs text-green-700">
            {{ newPosition[0].toFixed(6) }}, {{ newPosition[1].toFixed(6) }}
          </p>
        </div>
      </div>

      <!-- Editing Status -->
      <div class="mb-3 border rounded-xxs p-2 bg-yellow-50">
        <p class="text-xs text-yellow-700">
          ✏️ Drag the blue site point on the map to move it
        </p>
      </div>

      <!-- Action Buttons -->
      <div class="grid grid-cols-2 gap-2">
        <UButton
          variant="outline"
          color="gray"
          label="Reset"
          block
          size="xs"
          @click="handleReset"
          :disabled="!newPosition"
          :ui="{ rounded: 'rounded-xxs' }"
        />
        <UButton
          variant="solid"
          color="brand"
          label="Save"
          block
          size="xs"
          :disabled="!canSave"
          :loading="isSaving"
          @click="saveSitePoint"
          :ui="{ rounded: 'rounded-xxs' }"
        />
      </div>
    </template>
  </div>
</template>
