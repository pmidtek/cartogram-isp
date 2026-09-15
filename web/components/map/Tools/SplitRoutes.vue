<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import type { GeoJSONSource } from "maplibre-gl";

const emit = defineEmits(["on-close"]);

// Stores
const mapRefStore = useMapRef();
const authStore = useAuth();
const layerStore = useMapLayer();
const toast = useToast();
const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);

// State
const selectedRouteId = ref<number | null>(null);
const selectedRouteName = ref<string>("");
const selectedSitePointId = ref<number | null>(null);
const selectedSitePointName = ref<string>("");
const routeData = ref<any>(null);
const isSplitting = ref(false);
const isLoadingRoute = ref(false);

// Site data
const siteFromData = ref<any>(null);
const siteToData = ref<any>(null);

// Computed
const routeSelected = computed(() => selectedRouteId.value !== null);

const canSplit = computed(
  () =>
    routeSelected.value &&
    selectedSitePointId.value !== null &&
    !isSplitting.value,
);

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

// Fetch route data
const fetchRouteData = async (routeId: number) => {
  isLoadingRoute.value = true;

  try {
    const response = await $fetch(`/panel/items/routes/${routeId}?fields=*`, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    routeData.value = (response as any).data;

    // Fetch site points
    await fetchSitePoints();

    toast.add({
      title: "Route Selected",
      description: "Now click on a site point to set split location",
      icon: "i-heroicons-cursor-arrow-rays",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } catch (error) {
    console.error("Failed to fetch route data:", error);
    toast.add({
      title: "Error",
      description: "Could not load route data",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isLoadingRoute.value = false;
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

// Handle map click
const handleMapClick = (e: any) => {
  const map = mapRefStore.map;
  if (!map) return;

  const style = map.getStyle();

  // If route not selected, look for route click
  if (!selectedRouteId.value) {
    const routeLayers = style.layers
      .filter((layer: any) => layer["source-layer"]?.includes("routes"))
      .map((layer: any) => layer.id);

    const routeFeatures = map.queryRenderedFeatures(e.point, {
      layers: routeLayers,
    });

    if (routeFeatures.length > 0) {
      const feature = routeFeatures[0];
      const properties = feature.properties;

      selectedRouteId.value = properties.ogc_fid || feature.id;
      selectedRouteName.value =
        properties.name ||
        properties.route_name ||
        `Route ${selectedRouteId.value}`;

      // Highlight selected route
      highlightRoute(feature);

      // Fetch route details
      fetchRouteData(selectedRouteId.value);
    }
  } else if (!selectedSitePointId.value) {
    // Route already selected, look for site point click
    const sitePointLayers = style.layers
      .filter(
        (layer: any) =>
          layer["source-layer"]?.includes("assets") ||
          layer["source-layer"]?.includes("site_point"),
      )
      .map((layer: any) => layer.id);

    const sitePointFeatures = map.queryRenderedFeatures(e.point, {
      layers: sitePointLayers,
    });

    if (sitePointFeatures.length > 0) {
      const feature = sitePointFeatures[0];
      const properties = feature.properties;

      selectedSitePointId.value = properties.ogc_fid || feature.id;
      selectedSitePointName.value =
        properties.name ||
        properties.code ||
        `Site Point ${selectedSitePointId.value}`;

      // Highlight selected site point
      highlightSitePoint(feature);

      toast.add({
        title: "Split Point Set",
        description: `Selected: ${selectedSitePointName.value}`,
        icon: "i-heroicons-check",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
    }
  }
};

// Split route
const handleSplitRoute = async () => {
  if (!canSplit.value || !selectedRouteId.value || !selectedSitePointId.value)
    return;

  isSplitting.value = true;

  try {
    await $fetch("/panel/data-process/split-route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: {
        route_id: selectedRouteId.value,
        site_point_id: selectedSitePointId.value,
      },
    });

    toast.add({
      title: "Route Split Successfully",
      description: "Route has been split into two segments",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });

    // Clean up and refresh
    cleanupMarkers();
    await refreshRouteLayers();

    // Close after brief delay
    setTimeout(() => {
      emit("on-close");
    }, 1000);
  } catch (error: any) {
    console.error("Split failed:", error);
    toast.add({
      title: "Split Failed",
      description:
        error.data?.message || "Could not split route. Please try again.",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
  } finally {
    isSplitting.value = false;
  }
};

// Highlight route
const highlightRoute = (feature: any) => {
  const map = mapRefStore.map;
  if (!map) return;

  console.log("Highlighting route feature:", feature);

  // Use the showHighlightLayer utility function
  showHighlightLayer(
    map,
    [{ geom: feature.geometry }],
    "routes_line_highlight",
    false,
  );
};

// Highlight site point
const highlightSitePoint = (feature: any) => {
  const map = mapRefStore.map;
  if (!map) return;

  if (map.getSource("split-point-marker")) {
    (map.getSource("split-point-marker") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [feature],
    });
  } else {
    map.addSource("split-point-marker", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: [feature],
      },
    });

    map.addLayer({
      id: "split-point-marker-layer",
      type: "circle",
      source: "split-point-marker",
      paint: {
        "circle-radius": 10,
        "circle-color": "#FF0000",
        "circle-stroke-width": 2,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0.4,
      },
    });
  }
};

// Reset selection
const handleReset = () => {
  selectedRouteId.value = null;
  selectedRouteName.value = "";
  selectedSitePointId.value = null;
  selectedSitePointName.value = "";
  routeData.value = null;
  siteFromData.value = null;
  siteToData.value = null;

  cleanupMarkers();
};

// Clean up markers
const cleanupMarkers = () => {
  const map = mapRefStore.map;
  if (!map) return;

  // Remove split point label layer
  if (map.getLayer("split-point-label-layer")) {
    map.removeLayer("split-point-label-layer");
  }

  // Remove split point marker layer
  if (map.getLayer("split-point-marker-layer")) {
    map.removeLayer("split-point-marker-layer");
  }

  // Remove split point marker source
  if (map.getSource("split-point-marker")) {
    map.removeSource("split-point-marker");
  }

  // Clear highlight
  if (map.getSource("highlight")) {
    (map.getSource("highlight") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [],
    });
  }
};

// Refresh route layers
const refreshRouteLayers = async () => {
  try {
    const map = mapRefStore.map;
    if (map) {
      const style = map.getStyle();
      const allLayers: any[] = style?.layers || [];

      const routeLayers = allLayers.filter(
        (ly: any) =>
          ly["source-layer"]?.includes("routes") ||
          ly["source-layer"]?.includes("highlight"),
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

  try {
    await layerStore.fetchActiveLayers(currentModule.value?.slug);
  } catch (e) {
    console.warn("Failed to refetch active layers:", e);
  }
};

// Hide cable layer
const hideCableLayer = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const style = map.getStyle();
  const cableLayers = style.layers.filter((layer: any) =>
    layer.id.toLowerCase().includes("cable"),
  );

  cableLayers.forEach((layer: any) => {
    map.setLayoutProperty(layer.id, "visibility", "none");
  });
};

// Show cable layer
const showCableLayer = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const style = map.getStyle();
  const cableLayers = style.layers.filter((layer: any) =>
    layer.id.toLowerCase().includes("cable"),
  );

  cableLayers.forEach((layer: any) => {
    map.setLayoutProperty(layer.id, "visibility", "visible");
  });
};

// Cleanup on unmount
const cleanup = () => {
  const map = mapRefStore.map;
  if (map) {
    map.off("click", handleMapClick);
    showCableLayer();
    cleanupMarkers();
  }

  mapRefStore.setDrawMode(false);
};

// Lifecycle
onMounted(() => {
  mapRefStore.setDrawMode(true);

  const map = mapRefStore.map;
  if (map) {
    hideCableLayer();
    map.on("click", handleMapClick);

    // Change cursor on route/site point hover
    const style = map.getStyle();
    const routeLayers = style.layers
      .filter((layer: any) => layer["source-layer"]?.includes("routes"))
      .map((layer: any) => layer.id);

    const sitePointLayers = style.layers
      .filter(
        (layer: any) =>
          layer["source-layer"]?.includes("assets") ||
          layer["source-layer"]?.includes("site_point"),
      )
      .map((layer: any) => layer.id);

    const interactiveLayers = [...routeLayers, ...sitePointLayers];

    interactiveLayers.forEach((layerId) => {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    });
  }
});

onBeforeUnmount(() => {
  cleanup();
});
</script>

<template>
  <div class="p-2">
    <!-- Step 1: Select Route -->
    <template v-if="!routeSelected">
      <div class="mb-3">
        <p class="text-2xs text-[#626264] mb-2">
          Click on a route in the map to select it for splitting
        </p>
      </div>

      <div class="border rounded-xxs p-3 bg-blue-50">
        <p class="text-xs font-medium text-blue-900 mb-2">Instructions:</p>
        <ul class="text-xs text-blue-700 space-y-1 ml-4 list-disc">
          <li>Step 1: Click on a route line in the map</li>
          <li>Step 2: Click on a site point to set split location</li>
          <li>Step 3: Confirm to split route into two segments</li>
        </ul>
      </div>
    </template>

    <!-- Step 2: Route Selected, Choose Site Point -->
    <template v-else-if="routeSelected && !selectedSitePointId">
      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block">Selected Route</label>
        <div class="border rounded-xxs p-2 bg-grey-50">
          <p class="text-xs font-medium text-grey-900">
            {{ selectedRouteName }}
          </p>
          <p v-if="routeData" class="text-2xs text-grey-600 mt-1">
            {{ siteFromName }} → {{ siteToName }}
          </p>
        </div>
      </div>

      <div class="border rounded-xxs p-3 bg-yellow-50 mb-3">
        <p class="text-xs text-yellow-700">
          📍 Click on a site point in the map to set the split location
        </p>
      </div>

      <UButton
        variant="outline"
        color="gray"
        label="Cancel & Select Different Route"
        block
        size="xs"
        @click="handleReset"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </template>

    <!-- Step 3: Site Point Selected, Ready to Split -->
    <template v-else-if="routeSelected && selectedSitePointId">
      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block">Selected Route</label>
        <div class="border rounded-xxs p-2 bg-grey-50">
          <p class="text-xs font-medium text-grey-900">
            {{ selectedRouteName }}
          </p>
          <p v-if="routeData" class="text-2xs text-grey-600 mt-1">
            {{ siteFromName }} → {{ siteToName }}
          </p>
        </div>
      </div>

      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block"
          >Split at Site Point</label
        >
        <div class="border rounded-xxs p-2 bg-grey-50">
          <p class="text-xs font-medium text-grey-900">
            {{ selectedSitePointName }}
          </p>
          <p class="text-2xs text-grey-600 mt-1">
            ID: {{ selectedSitePointId }}
          </p>
        </div>
      </div>

      <div class="border rounded-xxs p-3 bg-green-50 mb-3">
        <p class="text-xs text-green-700">
          Ready to split. This will create two separate route <br />
          segments at the selected site point.
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
          :disabled="isSplitting"
          @click="handleReset"
          :ui="{ rounded: 'rounded-xxs' }"
        />
        <UButton
          variant="solid"
          color="brand"
          label="Split Route"
          block
          size="xs"
          :disabled="!canSplit"
          :loading="isSplitting"
          @click="handleSplitRoute"
          :ui="{ rounded: 'rounded-xxs' }"
        />
      </div>
    </template>
  </div>
</template>
