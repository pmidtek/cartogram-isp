<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch } from "vue";
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
const selectedCableId = ref<number | null>(null);
const selectedCableName = ref<string>("");
const selectedSitePointId = ref<number | null>(null);
const selectedSitePointName = ref<string>("");
const selectedSpliceAssetId = ref<number | null>(null);
const cableData = ref<any>(null);
const isSplitting = ref(false);
const isLoadingCables = ref(false);
const isLoadingSpliceAssets = ref(false);

// Cable options for dropdown
const cableOptions = ref<Array<{ label: string; value: number; geom: any }>>(
  [],
);

// Splice assets options
const spliceAssets = ref<Array<{ label: string; value: number }>>([]);

// Computed
const sitePointSelected = computed(() => selectedSitePointId.value !== null);
const cableSelected = computed(() => selectedCableId.value !== null);

const canSplit = computed(
  () =>
    cableSelected.value &&
    sitePointSelected.value &&
    selectedSpliceAssetId.value !== null &&
    !isSplitting.value,
);

// Fetch cables for selected site point
const fetchCablesForSitePoint = async (
  sitePointId: number,
  locType: "on_site" | "passing_site" = "passing_site",
) => {
  isLoadingCables.value = true;
  cableOptions.value = [];

  try {
    const response = await $fetch<{
      data: Array<{ id: number; name: string; geom: any }>;
    }>(`/panel/data/cables?site_point_id=${sitePointId}&loc_type=${locType}`, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    const data = Array.isArray(response) ? response : response.data;
    cableOptions.value = data.map((cable) => ({
      label: cable.name || `Cable ${cable.id}`,
      value: cable.id,
      geom: cable.geom,
    }));

    if (cableOptions.value.length === 0) {
      toast.add({
        title: "No Cables Found",
        description: "No cables found passing this site point",
        icon: "i-heroicons-exclamation-triangle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
    } else {
      toast.add({
        title: "Cables Loaded",
        description: `Found ${cableOptions.value.length} cable(s) passing this site point`,
        icon: "i-heroicons-check",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
    }
  } catch (error) {
    console.error("Failed to fetch cables:", error);
    toast.add({
      title: "Error",
      description: "Could not load cables for this site point",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isLoadingCables.value = false;
  }
};

// Fetch cable data
const fetchCableData = async (cableId: number) => {
  try {
    const response = await $fetch(`/panel/data/cables/${cableId}`, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    cableData.value = (response as any).data;
  } catch (error) {
    console.error("Failed to fetch cable data:", error);
    toast.add({
      title: "Error",
      description: "Could not load cable data",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  }
};

// Fetch splice assets for selected site point
const fetchSpliceAssets = async (sitePointId: number) => {
  isLoadingSpliceAssets.value = true;
  spliceAssets.value = [];

  try {
    const response = await $fetch<{
      data: Array<{ id: number; name: string }>;
    }>(
      `/panel/items/assets?filter[site_point_id][_eq]=${sitePointId}&filter[asset_type_id][terminate_type][_eq]=passive_splice`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    const data = Array.isArray(response) ? response : response.data;
    spliceAssets.value = data.map((asset) => ({
      label: asset.name || `Asset ${asset.id}`,
      value: asset.id,
    }));

    if (spliceAssets.value.length === 0) {
      toast.add({
        title: "No Splice Assets Found",
        description: "No passive splice assets found at this site point",
        icon: "i-heroicons-exclamation-triangle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
    }
  } catch (error) {
    console.error("Failed to fetch splice assets:", error);
    toast.add({
      title: "Error",
      description: "Could not load splice assets",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isLoadingSpliceAssets.value = false;
  }
};

// Handle map click - only for site point selection
const handleMapClick = (e: any) => {
  const map = mapRefStore.map;
  if (!map) return;

  // Only handle site point selection if not yet selected
  if (!selectedSitePointId.value) {
    const style = map.getStyle();

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

      // Fetch cables passing this site point
      fetchCablesForSitePoint(selectedSitePointId.value);

      // Fetch splice assets for this site point
      fetchSpliceAssets(selectedSitePointId.value);

      toast.add({
        title: "Site Point Selected",
        description: `Selected: ${selectedSitePointName.value}`,
        icon: "i-heroicons-check",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
    }
  }
};

// Handle cable selection from dropdown
const handleCableSelect = async (cableId: number) => {
  console.log("Cable selected from dropdown:", cableId);
  console.log("Available cable options:", cableOptions.value);

  const selectedCable = cableOptions.value.find(
    (cable) => cable.value === cableId,
  );

  console.log("Found cable:", selectedCable);

  if (selectedCable) {
    selectedCableId.value = cableId;
    selectedCableName.value = selectedCable.label;

    console.log("Set selectedCableId:", selectedCableId.value);
    console.log("Set selectedCableName:", selectedCableName.value);

    // Fetch cable details
    await fetchCableData(cableId);

    toast.add({
      title: "Cable Selected",
      description: selectedCable.label,
      icon: "i-heroicons-check",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  }
};

// Split cable
const handleSplitCable = async () => {
  if (
    !canSplit.value ||
    !selectedCableId.value ||
    !selectedSitePointId.value ||
    !selectedSpliceAssetId.value
  )
    return;

  isSplitting.value = true;

  try {
    await $fetch("/panel/data-process/split-cable", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: {
        cable_id: selectedCableId.value,
        site_point_id: selectedSitePointId.value,
        splice_asset_id: selectedSpliceAssetId.value,
      },
    });

    toast.add({
      title: "Cable Split Successfully",
      description: "Cable has been split into two segments",
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
    await refreshCableLayers();

    // Close after brief delay
    setTimeout(() => {
      emit("on-close");
    }, 1000);
  } catch (error: any) {
    console.error("Split failed:", error);
    toast.add({
      title: "Split Failed",
      description:
        error.data?.message || "Could not split cable. Please try again.",
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

// Reset selection
const handleReset = () => {
  selectedCableId.value = null;
  selectedCableName.value = "";
  selectedSitePointId.value = null;
  selectedSitePointName.value = "";
  selectedSpliceAssetId.value = null;
  cableData.value = null;
  cableOptions.value = [];
  spliceAssets.value = [];

  cleanupMarkers();
};

// Highlight cable from map layers
// Highlight site point
const highlightSitePoint = (feature: any) => {
  const map = mapRefStore.map;
  if (!map) return;

  console.log("Highlighting site point feature:", feature);

  const featureData = {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: feature.geometry,
        properties: feature.properties || {},
      },
    ],
  };

  if (map.getSource("split-point-marker")) {
    (map.getSource("split-point-marker") as GeoJSONSource).setData(featureData);
  } else {
    map.addSource("split-point-marker", {
      type: "geojson",
      data: featureData,
    });

    map.addLayer({
      id: "split-point-marker-layer",
      type: "circle",
      source: "split-point-marker",
      paint: {
        "circle-radius": 12,
        "circle-color": "#FF0000",
        "circle-stroke-width": 3,
        "circle-stroke-color": "#ffffff",
        "circle-opacity": 0.8,
      },
    });

    // Add label layer for site point
    map.addLayer({
      id: "split-point-label-layer",
      type: "symbol",
      source: "split-point-marker",
      layout: {
        "text-field": ["get", "name"],
        "text-size": 12,
        "text-offset": [0, 1.5],
        "text-anchor": "top",
      },
      paint: {
        "text-color": "#000000",
        "text-halo-color": "#ffffff",
        "text-halo-width": 2,
      },
    });
  }
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

// Refresh cable layers
const refreshCableLayers = async () => {
  try {
    const map = mapRefStore.map;
    if (map) {
      const style = map.getStyle();
      const allLayers: any[] = style?.layers || [];

      const cableLayers = allLayers.filter(
        (ly: any) =>
          ly["source-layer"]?.includes("cables") ||
          ly["source-layer"]?.includes("highlight"),
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

      (map!.getSource("highlight") as GeoJSONSource).setData(
        emptyFeatureCollection,
      );
    }

    pauseAllAnimation();
  } catch (e) {
    console.warn("Failed to remove cable layers:", e);
  }

  try {
    await layerStore.fetchActiveLayers(currentModule.value?.slug);
  } catch (e) {
    console.warn("Failed to refetch active layers:", e);
  }
};

// Hide route layer
const hideRouteLayer = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const style = map.getStyle();
  const routeLayers = style.layers.filter((layer: any) =>
    layer.id.toLowerCase().includes("route"),
  );

  routeLayers.forEach((layer: any) => {
    map.setLayoutProperty(layer.id, "visibility", "none");
  });
};

// Show route layer
const showRouteLayer = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const style = map.getStyle();
  const routeLayers = style.layers.filter((layer: any) =>
    layer.id.toLowerCase().includes("route"),
  );

  routeLayers.forEach((layer: any) => {
    map.setLayoutProperty(layer.id, "visibility", "visible");
  });
};

// Cleanup on unmount
const cleanup = () => {
  const map = mapRefStore.map;
  if (map) {
    map.off("click", handleMapClick);
    showRouteLayer();
    cleanupMarkers();
  }

  mapRefStore.setDrawMode(false);
};

// Lifecycle
onMounted(() => {
  mapRefStore.setDrawMode(true);

  const map = mapRefStore.map;
  if (map) {
    hideRouteLayer();
    map.on("click", handleMapClick);

    // Change cursor on site point hover only
    const style = map.getStyle();

    const sitePointLayers = style.layers
      .filter(
        (layer: any) =>
          layer["source-layer"]?.includes("assets") ||
          layer["source-layer"]?.includes("site_point"),
      )
      .map((layer: any) => layer.id);

    sitePointLayers.forEach((layerId) => {
      map.on("mouseenter", layerId, () => {
        if (!selectedSitePointId.value) {
          map.getCanvas().style.cursor = "pointer";
        }
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
    <!-- Step 1: Select Site Point -->
    <template v-if="!sitePointSelected">
      <div class="mb-3">
        <p class="text-2xs text-[#626264] mb-2">
          Click on a site point in the map to start cable splitting
        </p>
      </div>

      <div class="border rounded-xxs p-3 bg-blue-50">
        <p class="text-xs font-medium text-blue-900 mb-2">Instructions:</p>
        <ul class="text-xs text-blue-700 space-y-1 ml-4 list-disc">
          <li>Step 1: Click on a site point in the map</li>
          <li>Step 2: Select a cable from dropdown</li>
          <li>Step 3: Select a splice asset from dropdown</li>
          <li>Step 4: Confirm to split cable into two segments</li>
        </ul>
      </div>
    </template>

    <!-- Step 2: Site Point Selected, Choose Cable -->
    <template v-else-if="sitePointSelected && !cableSelected">
      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block"
          >Selected Site Point</label
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

      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block">
          Select Cable <span class="text-red-500">*</span>
        </label>
        <USelect
          v-model="selectedCableId"
          :options="cableOptions"
          option-attribute="label"
          value-attribute="value"
          size="2xs"
          placeholder="Select cable to split"
          :loading="isLoadingCables"
          :disabled="isSplitting || cableOptions.length === 0"
          @update:model-value="handleCableSelect"
          :ui="{ rounded: 'rounded-xxs' }"
        />
        <p
          v-if="cableOptions.length === 0 && !isLoadingCables"
          class="text-3xs text-red-500 mt-1"
        >
          No cables found passing this site point
        </p>
      </div>

      <UButton
        variant="outline"
        color="gray"
        label="Cancel & Select Different Site Point"
        block
        size="xs"
        @click="handleReset"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </template>

    <!-- Step 3: Cable Selected, Choose Splice Asset -->
    <template v-else-if="cableSelected && sitePointSelected">
      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block"
          >Selected Site Point</label
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

      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block">Selected Cable</label>
        <div class="border rounded-xxs p-2 bg-grey-50">
          <p class="text-xs font-medium text-grey-900">
            {{ selectedCableName || `Cable ${selectedCableId}` }}
          </p>
          <p class="text-2xs text-grey-600 mt-1">ID: {{ selectedCableId }}</p>
        </div>
      </div>

      <div class="mb-3">
        <label class="text-2xs text-[#626264] mb-1 block">
          Splice Asset <span class="text-red-500">*</span>
        </label>
        <USelect
          v-model="selectedSpliceAssetId"
          :options="spliceAssets"
          option-attribute="label"
          value-attribute="value"
          size="2xs"
          placeholder="Select splice asset"
          :loading="isLoadingSpliceAssets"
          :disabled="isSplitting || spliceAssets.length === 0"
          :ui="{ rounded: 'rounded-xxs' }"
        />
        <p
          v-if="spliceAssets.length === 0 && !isLoadingSpliceAssets"
          class="text-3xs text-red-500 mt-1"
        >
          No passive splice assets found at this site point
        </p>
      </div>

      <div
        v-if="selectedSpliceAssetId"
        class="border rounded-xxs p-3 bg-green-50 mb-3"
      >
        <p class="text-xs text-green-700">
          Ready to split. This will create two separate <br />
          cable segments at the selected splice asset.
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
          label="Split Cable"
          block
          size="xs"
          :disabled="!canSplit"
          :loading="isSplitting"
          @click="handleSplitCable"
          :ui="{ rounded: 'rounded-xxs' }"
        />
      </div>
    </template>
  </div>
</template>
