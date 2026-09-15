<script setup lang="ts">
import { ref, computed, watch } from "vue";
import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { emptyFeatureCollection } from "~/utils/index";

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();
const featureStore = useFeature();
const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);
const layerStore = useMapLayer();
const { fetchActiveLayers } = layerStore;

// Local state
const selectedSitePoints = ref<
  Array<{
    ogc_fid: number;
    name: string;
    coordinates: [number, number];
    id: string;
  }>
>([]);

const routeRecommendations = ref<
  Array<{
    geojson: any;
    routes: number[];
    site_points: string[];
    length: string;
  }>
>([]);

const selectedRouteOption = ref<{
  geojson: any;
  routes: number[];
  site_points: string[];
  length: string;
} | null>(null);

const routeTypes = ref<Array<{ label: string; value: number }>>([
  { label: "Aerial", value: 1 },
  { label: "Underground", value: 2 },
]);
const selectedRouteType = ref<number>(1);

const cableTypes = ref<Array<{ label: string; value: number }>>([]);
const selectedCableType = ref<number | undefined>(1);
const cableName = ref<string>("");
const cableCode = ref<string>("");

const isLoadingRoutes = ref<boolean>(false);
const isLoadingCableTypes = ref<boolean>(false);
const isSavingCable = ref<boolean>(false);

let routePreviewAnimationInterval: any = null;

// Computed
const canSelectMorePoints = computed(() => {
  return selectedSitePoints.value.length < 2;
});

const routeOptions = computed(() => {
  return routeRecommendations.value.map((route, index) => ({
    label: route.site_points.join(" → "),
    value: index,
  }));
});

const canAddCable = computed(() => {
  return (
    selectedSitePoints.value.length === 2 &&
    selectedRouteOption.value !== null &&
    selectedCableType.value !== undefined &&
    cableName.value.trim() !== "" &&
    cableCode.value.trim() !== "" &&
    !isSavingCable.value
  );
});

// Initialize draw control
let drawerInstance: any = null;
const initDrawControl = () => {
  const { drawer } = useDrawControl({
    mode: "draw_point",
    onCreated: handlePointCreated,
  });

  drawerInstance = drawer;
  return drawer;
};

// Handle point creation from map
const handlePointCreated = (feature: Feature<Geometry, GeoJsonProperties>) => {
  if (feature.geometry.type === "Point") {
    if (!canSelectMorePoints.value) {
      if (drawerInstance) {
        drawerInstance.delete(feature.id);
      }
      return;
    }

    const coords = feature.geometry.coordinates as [number, number];

    // Check if clicked on a visible backbone point
    if (mapRefStore.map) {
      const backboneLayers = mapRefStore.map
        .getStyle()
        .layers.filter((layer: any) => {
          return (
            layer["source-layer"]?.includes("site_points") &&
            layer.layout &&
            layer.layout.visibility !== "none"
          );
        })
        .map((layer: any) => layer.id);

      if (backboneLayers.length > 0) {
        const pixel = mapRefStore.map.project(coords as any);
        const nearby = mapRefStore.map.queryRenderedFeatures(pixel, {
          layers: backboneLayers,
        });

        if (nearby.length > 0 && nearby[0].geometry.type === "Point") {
          const backboneFeature: any = nearby[0];
          const ogcFid =
            backboneFeature.properties?.ogc_fid ??
            backboneFeature.properties?.id ??
            backboneFeature.id;
          const name = backboneFeature.properties?.name || `Site ${ogcFid}`;
          const featureId = String(ogcFid ?? `selected-${Date.now()}`);

          const alreadySelected = selectedSitePoints.value.some(
            (pt) => pt.id === featureId,
          );

          if (!alreadySelected && ogcFid) {
            selectedSitePoints.value.push({
              ogc_fid: ogcFid,
              name: name,
              coordinates: coords,
              id: featureId,
            });

            updateHighlightLayer();
          }

          if (drawerInstance) {
            drawerInstance.delete(feature.id);
          }
          return;
        }
      }
    }
  }
};

// Update highlight layer for selected points
const updateHighlightLayer = () => {
  if (mapRefStore.map) {
    const map = mapRefStore.map;

    // Add or update highlight source
    if (!map.getSource("highlight")) {
      map.addSource("highlight", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [],
        },
      });
    }

    const highlightData = {
      type: "FeatureCollection",
      features: selectedSitePoints.value.map((pt) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: pt.coordinates,
        },
        properties: {},
      })),
    };

    (map.getSource("highlight") as any).setData(highlightData);

    // Add highlight layer if it doesn't exist
    if (!map.getLayer("highlight-points")) {
      map.addLayer({
        id: "highlight-points",
        type: "circle",
        source: "highlight",
        paint: {
          "circle-radius": 12,
          "circle-color": "#FF6B00",
          "circle-opacity": 0.6,
          "circle-stroke-width": 3,
          "circle-stroke-color": "#FF6B00",
          "circle-stroke-opacity": 1,
        },
      });
    }
  }
};

// Fetch route recommendations
const fetchRouteRecommendations = async () => {
  if (selectedSitePoints.value.length !== 2) return;

  const siteFrom = selectedSitePoints.value[0].ogc_fid;
  const siteTo = selectedSitePoints.value[1].ogc_fid;

  isLoadingRoutes.value = true;

  try {
    const response: { data: any[] } = await $fetch(
      `/panel/analysis/route-recomendations?site_from=${siteFrom}&site_to=${siteTo}&route_type_id=${selectedRouteType.value}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    routeRecommendations.value = response.data;
  } catch (error) {
    console.error("Error fetching route recommendations:", error);
    toast.add({
      title: "Error",
      description: "Failed to load route recommendations",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isLoadingRoutes.value = false;
  }
};

// Fetch cable types
const fetchCableTypes = async () => {
  isLoadingCableTypes.value = true;

  try {
    const response: { data: Array<{ id: number; name: string }> } =
      await $fetch(
        "/panel/items/cable_types?fields=name,id&filter[_and][0][id][_in][0]=1&filter[_and][0][id][_in][1]=2",
        {
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        },
      );

    cableTypes.value = response.data.map((type) => ({
      label: type.name,
      value: type.id,
    }));
  } catch (error) {
    console.error("Error fetching cable types:", error);
    toast.add({
      title: "Error",
      description: "Failed to load cable types",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isLoadingCableTypes.value = false;
  }
};

// Watch for 2 selected points to fetch routes
watch(
  () => selectedSitePoints.value.length,
  (newLength) => {
    if (newLength === 2) {
      fetchRouteRecommendations();
    }
  },
);

// Re-fetch routes when route type changes (if both points already selected)
watch(selectedRouteType, () => {
  if (selectedSitePoints.value.length === 2) {
    selectedRouteOption.value = null;
    fetchRouteRecommendations();
  }
});

// Keep Cable Type mirrored to Route Type
watch(
  selectedRouteType,
  (newType) => {
    selectedCableType.value = newType;
  },
  { immediate: true },
);

// Add route preview to map
const addRoutePreviewToMap = () => {
  if (!mapRefStore.map || !selectedRouteOption.value) return;

  removeRoutePreviewFromMap();

  const map = mapRefStore.map;

  // Add source
  if (!map.getSource("cable-route-preview")) {
    map.addSource("cable-route-preview", {
      type: "geojson",
      data: selectedRouteOption.value.geojson,
    });
  } else {
    (map.getSource("cable-route-preview") as any).setData(
      selectedRouteOption.value.geojson,
    );
  }

  // Add layer
  if (!map.getLayer("cable-route-preview")) {
    map.addLayer({
      id: "cable-route-preview",
      type: "line",
      source: "cable-route-preview",
      paint: {
        "line-color": "#FF6B00",
        "line-width": 4,
        "line-dasharray": [2, 2],
      },
    });
  }

  // Animate dashes
  let dashOffset = 0;
  routePreviewAnimationInterval = setInterval(() => {
    if (map.getLayer("cable-route-preview")) {
      dashOffset = (dashOffset + 0.1) % 4;
      map.setPaintProperty("cable-route-preview", "line-dasharray", [2, 2]);
    }
  }, 50);
};

// Remove route preview from map
const removeRoutePreviewFromMap = () => {
  if (routePreviewAnimationInterval) {
    clearInterval(routePreviewAnimationInterval);
    routePreviewAnimationInterval = null;
  }

  if (mapRefStore.map) {
    const map = mapRefStore.map;
    if (map.getLayer("cable-route-preview")) {
      map.removeLayer("cable-route-preview");
    }
    if (map.getSource("cable-route-preview")) {
      map.removeSource("cable-route-preview");
    }
  }
};

// Remove highlight layer
const removeHighlightLayer = () => {
  if (mapRefStore.map) {
    const map = mapRefStore.map;
    if (map.getLayer("highlight-points")) {
      map.removeLayer("highlight-points");
    }
    if (map.getSource("highlight")) {
      (map.getSource("highlight") as any).setData(emptyFeatureCollection);
    }
  }
};

// Watch selected route option to update preview
watch(selectedRouteOption, (newRoute) => {
  if (newRoute) {
    addRoutePreviewToMap();
  } else {
    removeRoutePreviewFromMap();
  }
});

// Handle route selection from dropdown
const handleRouteSelection = (index: number | undefined) => {
  if (index !== undefined && routeRecommendations.value[index]) {
    selectedRouteOption.value = routeRecommendations.value[index];
  } else {
    selectedRouteOption.value = null;
  }
};

// Save cable
const handleAddCable = async () => {
  if (!canAddCable.value) {
    toast.add({
      title: "Validation Error",
      description: "Please fill in all required fields",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
    return;
  }

  isSavingCable.value = true;

  try {
    const requestBody = [
      {
        site_from: selectedSitePoints.value[0].ogc_fid,
        site_to: selectedSitePoints.value[1].ogc_fid,
        cable_type_id: selectedCableType.value,
        routes: {
          create: selectedRouteOption.value!.routes.map((id) => ({
            route_id: id,
          })),
        },
        name: cableName.value.trim(),
        code: cableCode.value.trim(),
      },
    ];

    await $fetch("/panel/items/cables", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    toast.add({
      title: "Success",
      description: "Cable added successfully",
      icon: "i-heroicons-check-circle",
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });

    // Clear form fields but keep site points and routes
    cableName.value = "";
    cableCode.value = "";
    selectedCableType.value = undefined;
    selectedRouteOption.value = null;

    // Remove cable layers and refetch
    try {
      const map = mapRefStore.map;
      if (map) {
        const style = map.getStyle();
        const allLayers: any[] = style?.layers || [];

        const cableLayers = allLayers.filter(
          (ly: any) =>
            ly["source-layer"]?.includes("cables") ||
            ly["source-layer"]?.includes("cable"),
        );

        cableLayers.forEach((ly: any) => {
          if (map.getLayer(ly.id)) map.removeLayer(ly.id);
        });

        const sourceIds = Array.from(
          new Set(
            cableLayers
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
      console.warn("Failed to remove cable layers:", e);
    }

    try {
      await fetchActiveLayers(currentModule.value?.slug);
    } catch (e) {
      console.warn("Failed to refetch active layers:", e);
    }
  } catch (error: any) {
    console.error("Error adding cable:", error);
    toast.add({
      title: "Error",
      description: error?.data?.message || "Failed to add cable",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isSavingCable.value = false;
  }
};

// Reset functionality
const handleReset = () => {
  selectedSitePoints.value = [];
  routeRecommendations.value = [];
  selectedRouteOption.value = null;
  cableName.value = "";
  cableCode.value = "";
  selectedRouteType.value = 1;

  if (drawerInstance) {
    drawerInstance.deleteAll();
  }

  removeHighlightLayer();
  removeRoutePreviewFromMap();

  if (featureStore.newFeatureGeometry) {
    featureStore.clearNewFeatureGeometry();
  }
};

// Handle map click for site point selection
const handleMapClick = (e: any) => {
  if (!mapRefStore.map || !canSelectMorePoints.value) return;

  const backboneLayers = mapRefStore.map
    .getStyle()
    .layers.filter((layer: any) => {
      return (
        layer["source-layer"]?.includes("site_points") &&
        layer.layout &&
        layer.layout.visibility !== "none"
      );
    })
    .map((layer: any) => layer.id);

  if (backboneLayers.length === 0) return;

  const features = mapRefStore.map.queryRenderedFeatures(e.point, {
    layers: backboneLayers,
  });

  if (features.length > 0) {
    const feature = features[0];

    if (feature.geometry.type === "Point") {
      const coords = feature.geometry.coordinates as [number, number];
      const ogcFid =
        feature.properties?.ogc_fid ?? feature.properties?.id ?? feature.id;
      const name = feature.properties?.name || `Site ${ogcFid}`;
      const featureId = String(ogcFid ?? `selected-${Date.now()}`);

      const alreadySelected = selectedSitePoints.value.some(
        (pt) => pt.id === featureId,
      );

      if (alreadySelected || !ogcFid) {
        return;
      }

      selectedSitePoints.value.push({
        ogc_fid: ogcFid,
        name: name,
        coordinates: coords,
        id: featureId,
      });

      updateHighlightLayer();
    }
  }
};

// Change cursor on hover
const handleMapMouseMove = (e: any) => {
  if (!mapRefStore.map || !canSelectMorePoints.value) return;

  const backboneLayers = mapRefStore.map
    .getStyle()
    .layers.filter((layer: any) => {
      return (
        layer["source-layer"]?.includes("site_points") &&
        layer.layout &&
        layer.layout.visibility !== "none"
      );
    })
    .map((layer: any) => layer.id);

  if (backboneLayers.length === 0) return;

  const features = mapRefStore.map.queryRenderedFeatures(e.point, {
    layers: backboneLayers,
  });

  const canvas = mapRefStore.map.getCanvas();
  if (features.length > 0 && features[0].geometry.type === "Point") {
    canvas.style.cursor = "pointer";
  } else if (!mapRefStore.drawMode) {
    canvas.style.cursor = "";
  }
};

// Lifecycle hooks
onMounted(() => {
  mapRefStore.setDrawMode(true);
  initDrawControl();
  fetchCableTypes();

  if (mapRefStore.map) {
    mapRefStore.map.on("click", handleMapClick);
    mapRefStore.map.on("mousemove", handleMapMouseMove);
  }
});

onUnmounted(() => {
  mapRefStore.setDrawMode(false);
  removeRoutePreviewFromMap();
  removeHighlightLayer();

  if (mapRefStore.map) {
    mapRefStore.map.off("click", handleMapClick);
    mapRefStore.map.off("mousemove", handleMapMouseMove);
  }
});
</script>

<template>
  <div class="p-2">
    <!-- Instructions -->
    <div class="flex items-center gap-3 mb-2">
      <p class="text-2xs text-[#626264]">
        <template v-if="selectedSitePoints.length < 2">
          Select 2 site points to create cable route.
        </template>
        <template v-else-if="!selectedRouteOption">
          Choose a route option from the dropdown below.
        </template>
        <template v-else>
          Fill in cable details and click "Add Cable" to save.
        </template>
      </p>
    </div>

    <!-- Site Points Selection -->
    <div class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Selected Site Points: {{ selectedSitePoints.length }}/2
      </label>
      <div
        v-if="selectedSitePoints.length > 0"
        class="space-y-1 border border-gray-200 rounded p-2"
      >
        <div
          v-for="(point, index) in selectedSitePoints"
          :key="point.id"
          class="flex items-center justify-between text-2xs"
        >
          <span class="font-medium">{{ index + 1 }}. {{ point.name }}</span>
        </div>
      </div>
      <div v-else class="text-center text-2xs text-gray-400 py-2">
        Click on site points on the map
      </div>
    </div>

    <!-- Route Type Selection -->
    <div v-if="selectedSitePoints.length === 2" class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Route Type <span class="text-red-500">*</span>
      </label>
      <USelect
        v-model="selectedRouteType"
        :options="routeTypes"
        option-attribute="label"
        value-attribute="value"
        variant="outline"
        size="2xs"
        placeholder="Select route type"
        :disabled="isLoadingRoutes"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Route Selection -->
    <div v-if="selectedSitePoints.length === 2" class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Route Selection <span class="text-red-500">*</span>
      </label>
      <USelect
        :model-value="
          selectedRouteOption
            ? routeRecommendations.indexOf(selectedRouteOption)
            : undefined
        "
        @update:model-value="handleRouteSelection"
        :options="routeOptions"
        option-attribute="label"
        value-attribute="value"
        variant="outline"
        size="2xs"
        placeholder="Select route"
        :loading="isLoadingRoutes"
        :disabled="isLoadingRoutes || routeOptions.length === 0"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Cable Type Selection -->
    <div v-if="selectedRouteOption" class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Cable Type <span class="text-red-500">*</span>
        <span class="text-grey-400">(follows Route Type)</span>
      </label>
      <USelect
        v-model="selectedCableType"
        :options="cableTypes"
        option-attribute="label"
        value-attribute="value"
        variant="outline"
        size="2xs"
        placeholder="Select cable type"
        :loading="isLoadingCableTypes"
        disabled
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Cable Name -->
    <div v-if="selectedRouteOption" class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Cable Name <span class="text-red-500">*</span>
      </label>
      <UInput
        v-model="cableName"
        variant="outline"
        size="2xs"
        placeholder="e.g., Cable-001"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Cable Code -->
    <div v-if="selectedRouteOption" class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Cable Code <span class="text-red-500">*</span>
      </label>
      <UInput
        v-model="cableCode"
        variant="outline"
        size="2xs"
        placeholder="e.g., Cable-001"
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
      label="Add Cable"
      block
      :disabled="!canAddCable"
      :loading="isSavingCable"
      @click="handleAddCable"
      :ui="{ rounded: 'rounded-xxs' }"
    />
  </div>
</template>
