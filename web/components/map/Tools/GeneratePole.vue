<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from "vue";
import type { GeoJSONSource } from "maplibre-gl";

const emit = defineEmits(["on-close"]);

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();
const layerStore = useMapLayer();
const { fetchActiveLayers } = layerStore;
const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);

// Form state
const poleSpacing = ref<number>(100);
const selectedSitePointType = ref<number | null>(null);
const selectedRouteType = ref<number | null>(null);
const selectedRouteId = ref<number | null>(null);
const selectedRouteName = ref<string>("");

// Loading states
const isLoadingPreview = ref(false);
const isGeneratingPoles = ref(false);
const isLoadingTypes = ref(false);

// Options from API
const sitePointTypes = ref<Array<{ label: string; value: number }>>([]);
const routeTypes = ref<Array<{ label: string; value: number }>>([]);

// Preview data
const previewData = ref<any>(null);

// Fetch site point types
const fetchSitePointTypes = async () => {
  try {
    isLoadingTypes.value = true;
    const response = await $fetch<{
      data: Array<{ id: number; name: string }>;
    }>("/panel/items/site_point_types?sort=name", {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    const data = Array.isArray(response) ? response : response.data;
    sitePointTypes.value = data.map((type) => ({
      label: type.name,
      value: type.id,
    }));
  } catch (error) {
    console.error("Error fetching site point types:", error);
    toast.add({
      title: "Error",
      description: "Failed to load site point types",
      icon: "i-heroicons-exclamation-triangle",
      color: "red",
    });
  } finally {
    isLoadingTypes.value = false;
  }
};

// Fetch route types
const fetchRouteTypes = async () => {
  try {
    isLoadingTypes.value = true;
    const response = await $fetch<{
      data: Array<{ id: number; name: string }>;
    }>("/panel/items/route_types?sort=name", {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    const data = Array.isArray(response) ? response : response.data;
    routeTypes.value = data.map((type) => ({
      label: type.name,
      value: type.id,
    }));
  } catch (error) {
    console.error("Error fetching route types:", error);
    toast.add({
      title: "Error",
      description: "Failed to load route types",
      icon: "i-heroicons-exclamation-triangle",
      color: "red",
    });
  } finally {
    isLoadingTypes.value = false;
  }
};

// Enable preview when route and spacing are set
const canPreview = computed(() => {
  return (
    selectedRouteId.value !== null &&
    poleSpacing.value > 0 &&
    !isLoadingPreview.value
  );
});

// Enable generate when preview exists and types are selected
const canGenerate = computed(() => {
  return (
    previewData.value !== null &&
    selectedSitePointType.value !== null &&
    selectedRouteType.value !== null &&
    !isGeneratingPoles.value
  );
});

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

// Handle route click
const handleRouteClick = (e: any) => {
  const map = mapRefStore.map;
  if (!map) return;

  const style = map.getStyle();
  const routeLayers = style.layers
    .filter((layer: any) => layer["source-layer"]?.includes("routes"))
    .map((layer: any) => layer.id);

  const features = map.queryRenderedFeatures(e.point, {
    layers: routeLayers,
  });

  if (features.length > 0) {
    const feature = features[0];
    const properties = feature.properties;

    selectedRouteId.value = properties.ogc_fid || feature.id;
    selectedRouteName.value =
      properties.name ||
      properties.route_name ||
      `Route ${selectedRouteId.value}`;

    // Highlight selected route
    if (map.getSource("highlight")) {
      (map.getSource("highlight") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: [feature],
      });
    }
  }
};

// Preview poles
const handlePreview = async () => {
  if (!canPreview.value) return;

  try {
    isLoadingPreview.value = true;

    const response = await $fetch<any>(
      "/panel/data-process/generate-asset-on-route-preview",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        body: {
          route_id: selectedRouteId.value,
          spacing: poleSpacing.value,
        },
      },
    );

    const geojsonData = response.data?.geojson_site || response.geojson_site;
    previewData.value = geojsonData;

    // Show preview on map
    const map = mapRefStore.map;
    if (map && geojsonData) {
      // Add preview layer if not exists
      if (!map.getSource("pole-preview")) {
        map.addSource("pole-preview", {
          type: "geojson",
          data: geojsonData,
        });

        map.addLayer({
          id: "pole-preview-layer",
          type: "circle",
          source: "pole-preview",
          paint: {
            "circle-radius": 6,
            "circle-color": "#FF0000",
            "circle-stroke-width": 2,
            "circle-stroke-color": "#ffffff",
            "circle-opacity": 0.8,
          },
        });
      } else {
        (map.getSource("pole-preview") as GeoJSONSource).setData(geojsonData);
      }
    }
  } catch (error: any) {
    console.error("Error previewing poles:", error);
    toast.add({
      title: "Error",
      description: error.data?.message || "Failed to preview poles",
      icon: "i-heroicons-exclamation-triangle",
      color: "red",
    });
  } finally {
    isLoadingPreview.value = false;
  }
};

// Generate poles
const handleGenerate = async () => {
  if (!canGenerate.value) return;

  try {
    isGeneratingPoles.value = true;

    await $fetch("/panel/data-process/generate-asset-on-route", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: {
        route_id: selectedRouteId.value,
        spacing: poleSpacing.value,
        site_point_type_id: selectedSitePointType.value,
        route_type_id: selectedRouteType.value,
      },
    });

    toast.add({
      title: "Success",
      description: "Poles generated successfully",
      icon: "i-heroicons-check-circle",
      color: "green",
    });

    // Clear preview
    cleanupPreview();

    try {
      const map = mapRefStore.map;
      if (map) {
        const style = map.getStyle();
        const allLayers: any[] = style?.layers || [];

        // Filter layers related to assets (site points)
        const assetLayers = allLayers.filter(
          (ly: any) =>
            ly["source-layer"]?.includes("assets") ||
            ly["source-layer"]?.includes("site_point"),
        );

        // Remove matched layers
        assetLayers.forEach((ly: any) => {
          if (map.getLayer(ly.id)) map.removeLayer(ly.id);
        });

        // Remove unique sources afterwards
        const assetSourceIds = Array.from(
          new Set(
            assetLayers
              .map((ly: any) => ly.source)
              .filter((s: any) => typeof s === "string"),
          ),
        );
        assetSourceIds.forEach((srcId) => {
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
      console.warn("Failed to remove asset layers:", e);
    }

    try {
      await fetchActiveLayers(currentModule.value?.slug);
    } catch (e) {
      console.warn("Failed to refetch active layers:", e);
    }

    // Close the tool
    setTimeout(() => {
      emit("on-close");
    }, 1000);
  } catch (error: any) {
    console.error("Error generating poles:", error);
    toast.add({
      title: "Error",
      description: error.data?.message || "Failed to generate poles",
      icon: "i-heroicons-exclamation-triangle",
      color: "red",
    });
  } finally {
    isGeneratingPoles.value = false;
  }
};

// Clear preview
const cleanupPreview = () => {
  const map = mapRefStore.map;
  if (!map) return;

  if (map.getLayer("pole-preview-layer")) {
    map.removeLayer("pole-preview-layer");
  }
  if (map.getSource("pole-preview")) {
    map.removeSource("pole-preview");
  }

  if (map.getSource("highlight")) {
    (map.getSource("highlight") as GeoJSONSource).setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  previewData.value = null;
};

// Reset form
const handleReset = () => {
  selectedRouteId.value = null;
  selectedRouteName.value = "";
  poleSpacing.value = 100;
  selectedSitePointType.value = null;
  selectedRouteType.value = null;
  cleanupPreview();
};

onMounted(() => {
  // Disable popup by enabling draw mode
  mapRefStore.setDrawMode(true);

  const map = mapRefStore.map;
  if (map) {
    // Hide cable layer
    hideCableLayer();

    // Add click handler for route selection
    map.on("click", handleRouteClick);

    // Change cursor on route hover
    const style = map.getStyle();
    const routeLayers = style.layers
      .filter((layer: any) => layer["source-layer"]?.includes("routes"))
      .map((layer: any) => layer.id);

    routeLayers.forEach((layerId) => {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    });
  }

  // Fetch initial data
  fetchSitePointTypes();
  fetchRouteTypes();
});

onBeforeUnmount(() => {
  // Re-enable popup by disabling draw mode
  mapRefStore.setDrawMode(false);

  const map = mapRefStore.map;
  if (map) {
    // Show cable layer again
    showCableLayer();

    // Remove click handler
    map.off("click", handleRouteClick);

    // Cleanup preview
    cleanupPreview();
  }
});
</script>

<template>
  <div class="p-2">
    <!-- Instructions -->

    <!-- Pole Spacing Input -->
    <div class="mb-3">
      <label class="text-2xs text-[#626264] mb-1 block">
        Pole Spacing (meters) <span class="text-red-500">*</span>
      </label>
      <UInput
        v-model.number="poleSpacing"
        type="number"
        :min="10"
        :max="1000"
        size="2xs"
        placeholder="Enter spacing"
        :disabled="isLoadingPreview || isGeneratingPoles"
        :ui="{ rounded: 'rounded-xxs' }"
      >
        <template #trailing>
          <span class="text-2xs text-grey-600">m</span>
        </template>
      </UInput>
      <!-- <p class="text-3xs text-grey-500 mt-1">
        Distance between poles (10-1000 meters)
      </p> -->
    </div>

    <!-- Site Point Type -->
    <div class="mb-3">
      <label class="text-2xs text-[#626264] mb-1 block">
        Site Point Type <span class="text-red-500">*</span>
      </label>
      <USelect
        v-model="selectedSitePointType"
        :options="sitePointTypes"
        option-attribute="label"
        value-attribute="value"
        size="2xs"
        placeholder="Select site point type"
        :loading="isLoadingTypes"
        :disabled="isGeneratingPoles"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Route Type -->
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
        :loading="isLoadingTypes"
        :disabled="isGeneratingPoles"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Preview Button -->
    <div class="mb-2">
      <UButton
        label="Preview Poles"
        icon="i-heroicons-eye"
        size="xs"
        color="gray"
        block
        :disabled="!canPreview"
        :loading="isLoadingPreview"
        @click="handlePreview"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>
  </div>

  <!-- Action Buttons -->
  <div class="grid grid-cols-2 p-2 gap-2">
    <UButton
      variant="outline"
      color="gray"
      label="Reset"
      size="xs"
      block
      :disabled="isLoadingPreview || isGeneratingPoles"
      @click="handleReset"
      :ui="{ rounded: 'rounded-xxs' }"
    />
    <UButton
      variant="solid"
      color="brand"
      label="Generate Poles"
      size="xs"
      block
      :disabled="!canGenerate"
      :loading="isGeneratingPoles"
      @click="handleGenerate"
      :ui="{ rounded: 'rounded-xxs' }"
    />
  </div>
</template>
