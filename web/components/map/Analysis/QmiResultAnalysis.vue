<script lang="ts" setup>
import { ref, computed } from "vue";
import { storeToRefs } from "pinia";
import IcDownload from "~/assets/icons/ic-download.svg";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";

const authStore = useAuth();
const toast = useToast();
const mapRefStore = useMapRef();
const analysisStore = useAnalysisResult();
const { qmiResultData } = storeToRefs(analysisStore);

// Data visibility state
const isDataVisible = ref(true);
const LAYER_ID = "qmi-result-buffer-analysis";

// Compute data from store
const potentialData = computed(() => qmiResultData.value?.result);
const isLoading = computed(() => false); // No loading since data comes from store
const isError = computed(() => false);
const error = computed(() => null);

const geojsonSector = computed(() => {
  return potentialData.value?.geojson_sector;
});

const analysisRadius = computed(
  () => potentialData.value?.options?.radius || 0,
);

// Excel file ID from the response
const excelFileId = computed(() => qmiResultData.value?.excel);

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

// Watch for data changes and add to map
watch(
  potentialData,
  (newData) => {
    if (newData?.geojson_sector) {
      addSectorLayerToMap(newData.geojson_sector);
    }
  },
  { immediate: true },
);

// Cleanup on unmount
onUnmounted(() => {
  removeSectorLayerFromMap();
});

// Toggle layer visibility
const toggleVisibility = () => {
  isDataVisible.value = !isDataVisible.value;
  const map = mapRefStore.map;
  if (!map) return;

  const visibility = isDataVisible.value ? "visible" : "none";

  if (map.getLayer(`${LAYER_ID}-fill`)) {
    map.setLayoutProperty(`${LAYER_ID}-fill`, "visibility", visibility);
  }
  if (map.getLayer(`${LAYER_ID}-line`)) {
    map.setLayoutProperty(`${LAYER_ID}-line`, "visibility", visibility);
  }
  if (map.getLayer(`${LAYER_ID}-label`)) {
    map.setLayoutProperty(`${LAYER_ID}-label`, "visibility", visibility);
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
    link.download = `qmi-result-${Date.now()}.xlsx`;
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
        Quick Market Insight Result
      </p>

      <MapToolsPotentialAnalysisContent
        :data="potentialData"
        :is-loading="isLoading"
        :is-error="isError"
        :error="error"
        :radius="analysisRadius"
      />
    </div>
  </div>
</template>
