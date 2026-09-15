<script setup lang="ts">
import { ref, computed } from "vue";
import IcHelp from "~/assets/icons/ic-info.svg";
import length from "@turf/length";
import { lineString } from "@turf/helpers";
import { showHighlightLayer } from "~/utils/index";

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();
const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);
const layerStore = useMapLayer();
const { fetchActiveLayers } = layerStore;

// Route type options - fetched from API
const routeTypes = ref<Array<{ label: string; value: number }>>([]);

// Fetch route types from API
const fetchRouteTypes = async () => {
  try {
    const response = await $fetch<{
      data: Array<{ id: number; name: string }>;
    }>(
      "/panel/items/route_types?sort=name&filter[_and][0][id][_in][0]=1&filter[_and][0][id][_in][1]=2",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    // Handle both direct array response or { data: [...] } format
    const data = Array.isArray(response) ? response : response.data;

    routeTypes.value = data.map((type) => ({
      label: type.name,
      value: type.id,
    }));
  } catch (error) {
    console.error("Error fetching route types:", error);
    toast.add({
      title: "Warning",
      description: "Failed to load route types",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  }
};

// Local state
const selectedRouteType = ref<number | null>(null);
const selectedPoints = ref<
  Array<{
    coordinates: [number, number];
    id: string;
    ogc_fid?: number | string;
    name?: string;
    code?: string;
    type?: string;
  }>
>([]);
const routeGeometry = ref<any>(null);
const routeLength = ref<string>("0");
const isGeneratingRoute = ref<boolean>(false);
const isDrawingManually = ref<boolean>(false);
const isAddingData = ref<boolean>(false);

// Enable Add Data button when we have route geometry and route type
const canAddData = computed(() => {
  return (
    routeGeometry.value !== null &&
    selectedRouteType.value !== null &&
    !isAddingData.value
  );
});

// Enable route generation when 2 points selected
const canGenerateRoute = computed(() => {
  return selectedPoints.value.length === 2 && !isGeneratingRoute.value;
});

// Handle point selection from map
const handlePointSelection = (e: any) => {
  if (selectedPoints.value.length >= 2) {
    return;
  }

  const map = mapRefStore.map;
  if (!map) return;

  // Query site_points layers
  const style = map.getStyle();
  const siteLayers = style.layers
    .filter((layer: any) => layer["source-layer"]?.includes("site_points"))
    .map((layer: any) => layer.id);

  const features = map.queryRenderedFeatures(e.point, {
    layers: siteLayers,
  });

  if (features.length > 0) {
    const feature = features[0];
    const siteTypeId = feature.properties?.site_point_type_id;

    // Check for duplicate
    const ogcFid = feature.properties?.ogc_fid ?? feature.id;
    if (selectedPoints.value.some((p) => p.ogc_fid === ogcFid)) {
      toast.add({
        title: "Point Already Selected",
        description: "Please select a different point",
        icon: "i-heroicons-exclamation-triangle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
      return;
    }

    // Add to selection
    const coords = feature.geometry.coordinates;
    selectedPoints.value.push({
      coordinates: [coords[0], coords[1]],
      id: feature.id,
      ogc_fid: ogcFid,
      name: feature.properties?.name,
      code: feature.properties?.code,
      type: siteTypeId === 1 ? "Shelter" : "Stasiun",
    });

    // Show highlight for all selected points
    showHighlightLayer(
      map,
      selectedPoints.value.map((pt) => ({
        geom: { type: "Point", coordinates: pt.coordinates } as any,
      })),
      "route-point-highlight",
      true, // Show all points, not just the first one
    );
  }
};

// Display route on map
const displayRouteOnMap = (geometry: any) => {
  const map = mapRefStore.map;
  if (!map) return;

  // Remove existing route preview if any
  if (map.getLayer("route-preview")) {
    map.removeLayer("route-preview");
  }
  if (map.getSource("route-preview")) {
    map.removeSource("route-preview");
  }

  // Add route source
  map.addSource("route-preview", {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: geometry,
    },
  });

  // Add route layer
  map.addLayer({
    id: "route-preview",
    type: "line",
    source: "route-preview",
    layout: {
      "line-join": "round",
      "line-cap": "round",
    },
    paint: {
      "line-color": "#FFBF00", // Blue color
      "line-width": 4,
      "line-opacity": 0.8,
    },
  });
};

// Auto generate route between two points
const handleAutoGenerateRoute = async () => {
  if (selectedPoints.value.length !== 2) return;

  isGeneratingRoute.value = true;

  const point1 = selectedPoints.value[0].coordinates;
  const point2 = selectedPoints.value[1].coordinates;

  try {
    try {
      const response: { data: { geojson_route: any } } = await $fetch(
        "/panel/analysis/generate-route",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
            "Content-Type": "application/json",
          },
          body: {
            locations: [point1, point2], // Send exact coordinates of selected points
            profile: "driving-car",
          },
        },
      );

      if (response.data?.geojson_route) {
        routeGeometry.value = response.data?.geojson_route?.features[0];

        // Display route on map
        displayRouteOnMap(response.data?.geojson_route?.features[0]?.geometry);

        // Calculate length
        const line = lineString(
          response.data?.geojson_route?.features[0]?.geometry.coordinates,
        );
        routeLength.value = length(line, { units: "meters" }).toFixed(2);

        toast.add({
          title: "Route Generated",
          description: "Route generated using road network",
          icon: "i-heroicons-check-circle",
          ui: { background: "bg-white", title: "text-grey-800" },
        });

        isGeneratingRoute.value = false;
        return;
      }
    } catch (e) {
      console.warn("ORS routing failed, using straight line:", e);
    }

    // Final fallback: straight line
    routeGeometry.value = {
      type: "LineString",
      coordinates: [point1, point2],
    };

    // Display route on map
    displayRouteOnMap(routeGeometry.value);

    // Calculate length
    const line = lineString([point1, point2]);
    routeLength.value = length(line, { units: "meters" }).toFixed(2);

    toast.add({
      title: "Route Generated",
      description: "Using direct line between points",
      icon: "i-heroicons-check-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } catch (error) {
    console.error("Error generating route:", error);
    toast.add({
      title: "Error",
      description: "Failed to generate route",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isGeneratingRoute.value = false;
  }
};

// Draw route manually with snapping
let drawerInstance: any = null;
const isDrawingActive = ref(false);
const hasStarted = ref(false);
const drawnCoordinates = ref<[number, number][]>([]);

// Helper function to check if click is near a point
const isNearPoint = (
  clickCoords: [number, number],
  targetCoords: [number, number],
  map: any,
) => {
  // Convert both to pixel coordinates
  const clickPixel = map.project(clickCoords);
  const targetPixel = map.project(targetCoords);

  // Calculate distance in pixels
  const dx = clickPixel.x - targetPixel.x;
  const dy = clickPixel.y - targetPixel.y;
  const distance = Math.sqrt(dx * dx + dy * dy);

  // Return true if within 20 pixels
  return distance < 20;
};

const handleDrawManually = () => {
  if (selectedPoints.value.length !== 2) return;

  isDrawingManually.value = true;
  isDrawingActive.value = false; // Not started yet
  hasStarted.value = false;
  drawnCoordinates.value = [];

  toast.add({
    title: "Draw Mode Active",
    description: "Click on the first point to start drawing",
    icon: "i-heroicons-pencil",
    ui: { background: "bg-white", title: "text-grey-800" },
  });

  const map = mapRefStore.map;
  if (!map) return;

  const handleDrawClick = (e: any) => {
    if (!isDrawingManually.value) return;

    const clickCoords: [number, number] = [e.lngLat.lng, e.lngLat.lat];

    // Step 1: Check if starting at Point 1
    if (!hasStarted.value) {
      if (isNearPoint(clickCoords, selectedPoints.value[0].coordinates, map)) {
        hasStarted.value = true;
        isDrawingActive.value = true;
        drawnCoordinates.value = [selectedPoints.value[0].coordinates];
      } else {
        toast.add({
          title: "Start at First Point",
          description: "Please click on the first selected point to start",
          icon: "i-heroicons-exclamation-triangle",
          ui: { background: "bg-white", title: "text-grey-800" },
        });
      }
      return;
    }

    // Step 2: Check if finishing at Point 2
    if (isNearPoint(clickCoords, selectedPoints.value[1].coordinates, map)) {
      // Finish drawing
      drawnCoordinates.value.push(selectedPoints.value[1].coordinates);

      routeGeometry.value = {
        type: "LineString",
        coordinates: drawnCoordinates.value,
      };

      // Display final route
      displayRouteOnMap(routeGeometry.value);

      // Calculate length
      const line = lineString(drawnCoordinates.value);
      routeLength.value = length(line, { units: "meters" }).toFixed(2);

      toast.add({
        title: "Route Drawn",
        description: "Route completed successfully",
        icon: "i-heroicons-check-circle",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });

      // Cleanup
      isDrawingManually.value = false;
      isDrawingActive.value = false;
      hasStarted.value = false;
      map.off("click", handleDrawClick);
      return;
    }

    // Step 3: Add intermediate point
    drawnCoordinates.value.push(clickCoords);

    // Show real-time preview
    const tempGeometry = {
      type: "LineString" as const,
      coordinates: drawnCoordinates.value,
    };
    displayRouteOnMap(tempGeometry);
  };

  map.on("click", handleDrawClick);
};

// Remove a specific point
const removePoint = (index: number) => {
  selectedPoints.value.splice(index, 1);

  // Update highlights for remaining points
  const map = mapRefStore.map;
  if (map) {
    // Remove existing highlight layer
    if (map.getLayer("route-point-highlight")) {
      map.removeLayer("route-point-highlight");
    }
    if (map.getSource("route-point-highlight")) {
      map.removeSource("route-point-highlight");
    }

    // Re-add highlight for remaining points
    if (selectedPoints.value.length > 0) {
      showHighlightLayer(
        map,
        selectedPoints.value.map((pt) => ({
          geom: { type: "Point", coordinates: pt.coordinates } as any,
        })),
        "route-point-highlight",
        true, // Show all remaining points
      );
    }
  }

  toast.add({
    title: "Point Removed",
    description: `${selectedPoints.value.length}/2 points selected`,
    icon: "i-heroicons-trash",
    ui: {
      background: "bg-white",
      title: "text-gray-900 text-md font-semibold",
      description: "text-gray-500",
      icon: "text-blue-500",
    },
  });

  // Clear route geometry if exists
  if (routeGeometry.value) {
    routeGeometry.value = null;
    routeLength.value = "0";

    // Remove route preview from map
    const map = mapRefStore.map;
    if (map) {
      if (map.getLayer("route-preview")) {
        map.removeLayer("route-preview");
      }
      if (map.getSource("route-preview")) {
        map.removeSource("route-preview");
      }
    }
  }
};

// Reset functionality
const handleReset = () => {
  selectedPoints.value = [];
  routeGeometry.value = null;
  routeLength.value = "0";
  isDrawingManually.value = false;
  isGeneratingRoute.value = false;

  // Remove all highlights and route preview
  const map = mapRefStore.map;
  if (map) {
    const style = map.getStyle();
    const highlightLayers = style.layers.filter((layer: any) =>
      layer.id.includes("route-point-highlight"),
    );
    highlightLayers.forEach((layer: any) => {
      if (map.getLayer(layer.id)) {
        map.removeLayer(layer.id);
      }
    });

    const highlightSources = Object.keys(style.sources).filter(
      (source: string) => source.includes("route-point-highlight"),
    );
    highlightSources.forEach((source: string) => {
      if (map.getSource(source)) {
        try {
          map.removeSource(source);
        } catch (e) {
          console.warn("Failed to remove source", source, e);
        }
      }
    });

    // Remove route preview
    if (map.getLayer("route-preview")) {
      map.removeLayer("route-preview");
    }
    if (map.getSource("route-preview")) {
      map.removeSource("route-preview");
    }
  }

  // Clear any drawn features
  if (drawerInstance) {
    drawerInstance.deleteAll();
  }
};

// Add data functionality - POST to API as array
const handleAddData = async () => {
  if (!routeGeometry.value || selectedPoints.value.length !== 2) {
    toast.add({
      title: "Incomplete Route",
      description: "Please select 2 points and generate a route",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
    return;
  }

  if (!selectedRouteType.value) {
    toast.add({
      title: "Route Type Required",
      description: "Please select a route type",
      icon: "i-heroicons-exclamation-triangle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
    return;
  }

  isAddingData.value = true;

  try {
    // POST as ARRAY with single route object
    await $fetch("/panel/items/routes", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: [
        {
          route_type_id: selectedRouteType.value,
          site_from: selectedPoints.value[0].ogc_fid,
          site_to: selectedPoints.value[1].ogc_fid,
          geom: routeGeometry.value,
        },
      ],
    });

    toast.add({
      title: "Success",
      description: "Route added successfully",
      icon: "i-heroicons-check-circle",
    });

    // Remove highlights and route preview before resetting
    const map = mapRefStore.map;
    if (map) {
      // Clear highlight data (don't remove layer, just clear the data)
      if (map.getSource("highlight")) {
        (map.getSource("highlight") as any).setData({
          type: "FeatureCollection",
          features: [],
        });
      }

      // Remove route preview
      if (map.getLayer("route-preview")) {
        map.removeLayer("route-preview");
      }
      if (map.getSource("route-preview")) {
        map.removeSource("route-preview");
      }
    }

    // Reset the form
    handleReset();

    // Remove route layers and refetch to show new data
    try {
      const map = mapRefStore.map;
      if (map) {
        const style = map.getStyle();
        const allLayers: any[] = style?.layers || [];

        // Filter for route layers
        const routeLayers = allLayers.filter((ly: any) =>
          ly["source-layer"]?.includes("routes"),
        );

        // Remove layers first
        routeLayers.forEach((ly: any) => {
          if (map.getLayer(ly.id)) map.removeLayer(ly.id);
        });

        // Extract unique source IDs and remove sources
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
      }
    } catch (e) {
      console.warn("Failed to remove route layers:", e);
    }

    // Refetch active layers to reload with new data
    try {
      await fetchActiveLayers(currentModule.value?.slug);
    } catch (e) {
      console.warn("Failed to refetch active layers:", e);
    }
  } catch (error: any) {
    console.error("Error adding route:", error);
    toast.add({
      title: "Error",
      description: error?.data?.message || "Failed to add route",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isAddingData.value = false;
  }
};

// Enable map click handler and disable popup
onMounted(() => {
  // Enable draw mode to disable popup
  mapRefStore.setDrawMode(true);

  const map = mapRefStore.map;
  if (map) {
    map.on("click", handlePointSelection);

    // Change cursor on hover over site points
    const style = map.getStyle();
    const siteLayers = style.layers
      .filter((layer: any) => layer["source-layer"]?.includes("site_points"))
      .map((layer: any) => layer.id);

    siteLayers.forEach((layerId) => {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    });
  }

  // Fetch route types
  fetchRouteTypes();
});

// Disable map click handler, cleanup, and re-enable popup
onUnmounted(() => {
  // Disable draw mode to re-enable popup
  mapRefStore.setDrawMode(false);

  const map = mapRefStore.map;
  if (map) {
    map.off("click", handlePointSelection);

    // Clear highlight data (don't remove layer, just clear the data)
    if (map.getSource("highlight")) {
      (map.getSource("highlight") as any).setData({
        type: "FeatureCollection",
        features: [],
      });
    }

    // Remove route preview
    if (map.getLayer("route-preview")) {
      map.removeLayer("route-preview");
    }
    if (map.getSource("route-preview")) {
      map.removeSource("route-preview");
    }
  }

  handleReset();
});
</script>

<template>
  <div class="p-2">
    <div class="flex items-center gap-3 mb-2">
      <p class="text-2xs text-[#626264]">
        Select route type and 2 backbone/backhaul points to create a route
      </p>
    </div>

    <!-- Route Type Selection -->
    <div class="mb-3">
      <label class="text-2xs text-[#626264] mb-1 block">
        Route Type <span class="text-red-500">*</span>
      </label>
      <USelect
        v-model="selectedRouteType"
        :options="routeTypes"
        option-attribute="label"
        value-attribute="value"
        size="2xs"
        placeholder="Select route type"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- List of Selected Points -->
    <div v-if="selectedPoints.length > 0" class="mb-3">
      <label class="text-2xs text-[#626264] mb-2 block">Selected Points</label>
      <div class="border rounded-xxs">
        <div
          v-for="(point, index) in selectedPoints"
          :key="index"
          class="flex items-center justify-between px-2"
        >
          <div class="flex-1">
            <p class="text-2xs font-medium text-grey-900">
              Point {{ index + 1 }}: {{ point.type }}
            </p>
          </div>
          <UButton
            icon="i-heroicons-trash"
            variant="ghost"
            color="red"
            size="xs"
            @click="removePoint(index)"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>
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

    <!-- Route Generation Buttons -->
    <div class="grid grid-cols-2 gap-2">
      <UButton
        label="Auto Generate Route"
        icon="i-material-symbols:alt-route-rounded"
        size="xs"
        color="gray"
        block
        :disabled="!canGenerateRoute"
        :loading="isGeneratingRoute"
        @click="handleAutoGenerateRoute"
        :ui="{ rounded: 'rounded-xxs' }"
      />
      <UButton
        :label="isDrawingManually ? 'Drawing...' : 'Draw Route Manually'"
        :icon="
          isDrawingManually ? 'i-heroicons-hand-raised' : 'i-heroicons-pencil'
        "
        block
        size="xs"
        :color="isDrawingManually ? 'brand' : 'gray'"
        :disabled="!canGenerateRoute || isDrawingManually"
        @click="handleDrawManually"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>
  </div>

  <div class="grid grid-cols-2 p-2 gap-2">
    <UButton
      variant="outline"
      color="gray"
      label="Reset"
      block
      @click="handleReset"
      :ui="{ rounded: 'rounded-xxs' }"
    />
    <UButton
      variant="solid"
      color="brand"
      label="Add Route"
      block
      :disabled="!canAddData"
      :loading="isAddingData"
      @click="handleAddData"
      :ui="{ rounded: 'rounded-xxs' }"
    />
  </div>
</template>
