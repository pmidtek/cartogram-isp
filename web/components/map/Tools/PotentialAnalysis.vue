<script lang="ts" setup>
import { ref, computed, watch } from "vue";
import IcFilter from "~/assets/icons/ic-filter.svg";
import IcDownload from "~/assets/icons/ic-download.svg";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";

const authStore = useAuth();
const toast = useToast();
const featureStore = useFeature();
const mapRefStore = useMapRef();
const { mapInfo } = storeToRefs(featureStore);

// Filter state
const showFilterPopover = ref(false);
const selectedProvince = ref<string>("");
const selectedCity = ref<string>("");

// API data state
const isDataVisible = ref(true);
const LAYER_ID = "fwa-buffer-analysis";

// Queue / polling state
const isAnalyzing = ref(false);
const isQueued = ref(false);
const currentMessageId = ref<string | null>(null);
const potentialData = ref<any>(null);
const isLoadingData = computed(() => isAnalyzing.value);
const isError = ref(false);
const error = ref<any>(null);

// Province, City options from API
const provinceOptions = ref<any[]>([]);
const cityOptions = ref<any[]>([]);

// Store selected city data with coordinates
const selectedCityData = ref<any>(null);

const isLoadingProvinces = ref(false);
const isLoadingCities = ref(false);

// Keep track of the applied city for fetching
const appliedCity = ref<string>("");

// Buffer slider state
const bufferValue = ref<number>(300);
const appliedBuffer = ref<number>(300);

// File upload state
const uploadedFile = ref<File | null>(null);
const uploadedFileKey = ref<string>("");
const fileInputRef = ref<HTMLInputElement | null>(null);
const appliedCityId = ref<number | null>(null);
const resolvedFileId = ref<string>("");
const qmiResultId = ref<string | null>(null);
const fileReportId = ref<string | null>(null);
const isUploadingFile = ref(false);

// Fetch provinces
const fetchProvinces = async () => {
  isLoadingProvinces.value = true;
  try {
    const response = await $fetch<any>(
      "/panel/items/area_provinces?fields=ogc_fid,province,province_id",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    provinceOptions.value = response.data || [];
  } catch (error) {
    console.error("Error fetching provinces:", error);
    toast.add({
      title: "Failed to Load Provinces",
      description: "Please try again later",
      icon: "i-heroicons-x-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  } finally {
    isLoadingProvinces.value = false;
  }
};

// Fetch cities based on selected province
const fetchCities = async (province: string) => {
  if (!province) {
    cityOptions.value = [];
    return;
  }

  isLoadingCities.value = true;
  try {
    const response = await $fetch<any>(
      "/panel/items/area_cities?fields=ogc_fid,city,city_id,lat,lon",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        params: {
          filter: {
            province: {
              _eq: province,
            },
          },
        },
      },
    );
    cityOptions.value = response.data || [];
  } catch (error) {
    console.error("Error fetching cities:", error);
    toast.add({
      title: "Failed to Load Cities",
      description: "Please try again later",
      icon: "i-heroicons-x-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  } finally {
    isLoadingCities.value = false;
  }
};

// Filter is valid when both dropdowns are selected, or a file is uploaded
const isFilterValid = computed(() => {
  return (
    (!!selectedProvince.value && !!selectedCity.value) || !!uploadedFile.value
  );
});

// Poll geoprocessing queue until done
const pollQueueStatus = async (messageId: string) => {
  isQueued.value = true;
  try {
    const response = await $fetch<{ data: any }>(
      `/panel/items/geoprocessing_queue/${messageId}`,
      { headers: { Authorization: `Bearer ${authStore.accessToken}` } },
    );
    const { state, status, result } = response.data;

    if (state === "done" && status === "success") {
      const resultId = result?.result?.qmi_result_id;
      if (resultId) {
        const qmiResponse = await $fetch<{ data: any }>(
          `/panel/items/qpi_result/${resultId}`,
          { headers: { Authorization: `Bearer ${authStore.accessToken}` } },
        );
        potentialData.value = qmiResponse.data.result;
        qmiResultId.value = resultId;
        fileReportId.value = qmiResponse.data.excel ?? null;
      }
      isAnalyzing.value = false;
      isQueued.value = false;
      currentMessageId.value = null;
    } else if (state === "rejected" || status === "error") {
      isError.value = true;
      error.value = { message: "Analysis task failed" };
      isAnalyzing.value = false;
      isQueued.value = false;
      currentMessageId.value = null;
      toast.add({
        title: "Analysis Failed",
        description: "The analysis task failed to complete",
        icon: "i-heroicons-x-circle",
        color: "red",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
        },
      });
    } else {
      setTimeout(() => pollQueueStatus(messageId), 5000);
    }
  } catch (e: any) {
    isError.value = true;
    error.value = e;
    isAnalyzing.value = false;
    isQueued.value = false;
    toast.add({
      title: "Failed to Check Status",
      description: e?.data?.message || "Please try again later",
      icon: "i-heroicons-x-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
      },
    });
  }
};

// Computed properties for geojson_buffer data
const geojsonBuffer = computed(() => {
  return potentialData.value?.geojson_buffer || null;
});

const towersList = computed(() => {
  if (!geojsonBuffer.value?.features) return [];
  return geojsonBuffer.value.features.map((feature: any, index: number) => ({
    id: index,
    name: feature.properties?.site_name || `Tower ${index + 1}`,
    properties: feature.properties || {},
  }));
});

const totalTowers = computed(() => {
  return geojsonBuffer.value?.features?.length || 0;
});

// Color mapping for buffer owners
const getOwnerColor = (owner: string): { fill: string; stroke: string } => {
  const colors: Record<string, { fill: string; stroke: string }> = {
    TBG: { fill: "#F5C400", stroke: "#FFEA00" },
    Alfa: { fill: "#EF4444", stroke: "#dc2626" },
    Gihon: { fill: "#2563eb", stroke: "#2563eb" },
    Balcom: { fill: "#F59E0B", stroke: "#F59E0B" },
    CTM: { fill: "#10B981", stroke: "#10B981" },
    PKP: { fill: "#8B5CF6", stroke: "#8B5CF6" },
  };
  return colors[owner] || { fill: "#6b7280", stroke: "#4b5563" };
};

// Add buffer layer to map with owner-based colors
const addBufferLayerToMap = (geojson: any) => {
  if (!geojson || !mapRefStore.map) return;

  const map = mapRefStore.map;

  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  if (map.getSource(LAYER_ID)) map.removeSource(LAYER_ID);

  const uniqueOwners = new Set<string>();
  geojson.features?.forEach((f: any) => {
    if (f.properties?.owner) uniqueOwners.add(f.properties.owner);
  });

  const fillExpr: any = ["match", ["get", "owner"]];
  const strokeExpr: any = ["match", ["get", "owner"]];
  uniqueOwners.forEach((owner) => {
    const c = getOwnerColor(owner);
    fillExpr.push(owner, c.fill);
    strokeExpr.push(owner, c.stroke);
  });
  fillExpr.push("#6b7280");
  strokeExpr.push("#4b5563");

  map.addSource(LAYER_ID, { type: "geojson", data: geojson, promoteId: "id" });
  map.addLayer({
    id: LAYER_ID,
    type: "fill",
    source: LAYER_ID,
    paint: { "fill-color": fillExpr, "fill-opacity": 0.3 },
  });
  map.addLayer({
    id: `${LAYER_ID}-outline`,
    type: "line",
    source: LAYER_ID,
    paint: { "line-color": strokeExpr, "line-width": 2 },
  });
};

// Remove buffer layer from map
const removeBufferLayerFromMap = () => {
  if (!mapRefStore.map) return;

  const map = mapRefStore.map;

  if (map.getLayer(`${LAYER_ID}-outline`)) {
    map.removeLayer(`${LAYER_ID}-outline`);
  }
  if (map.getLayer(LAYER_ID)) {
    map.removeLayer(LAYER_ID);
  }
  if (map.getSource(LAYER_ID)) {
    map.removeSource(LAYER_ID);
  }
};

// Fly to city location
const flyToCity = (cityData: any) => {
  if (!mapRefStore.map || !cityData?.lat || !cityData?.lon) {
    console.warn("Cannot fly to city: map or coordinates not available");
    return;
  }

  const { lat, lon } = cityData;

  mapRefStore.map.flyTo({
    center: [lon, lat],
    zoom: 12, // City-level zoom
    duration: 2000, // 2 second animation
    padding: { right: 20 },
    essential: true,
  });
};

// Apply filter and trigger fetch
const applyFilter = async () => {
  if (!isFilterValid.value) {
    toast.add({
      title: "Incomplete Filter",
      description: "Please select province and city, or upload a file",
      icon: "i-heroicons-exclamation-triangle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
    return;
  }

  appliedBuffer.value = bufferValue.value;

  if (uploadedFile.value) {
    isUploadingFile.value = true;
    try {
      const formData = new FormData();
      formData.append("file", uploadedFile.value);
      const uploadRes = await $fetch<any>("/panel/files", {
        method: "POST",
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
        body: formData,
      });
      resolvedFileId.value = uploadRes.data.filename_disk;
      uploadedFileKey.value = `${uploadedFile.value.name}_${uploadedFile.value.size}`;
    } catch (e) {
      toast.add({
        title: "File Upload Failed",
        description: "Could not upload the file. Please try again.",
        icon: "i-heroicons-x-circle",
        color: "red",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-green-500",
        },
      });
      isUploadingFile.value = false;
      return;
    }
    isUploadingFile.value = false;
    appliedCity.value = "";
    appliedCityId.value = null;
  } else {
    const cityData = cityOptions.value.find(
      (city: any) => city.city === selectedCity.value,
    );
    selectedCityData.value = cityData;
    appliedCity.value = selectedCity.value;
    appliedCityId.value = cityData?.ogc_fid ?? null;
    resolvedFileId.value = "";
  }

  showFilterPopover.value = false;
  isAnalyzing.value = true;
  isError.value = false;
  potentialData.value = null;
  removeBufferLayerFromMap();

  const body = uploadedFile.value
    ? {
        mode: "upload",
        name: null,
        area_city_ids: [],
        file_id: resolvedFileId.value,
        radius: appliedBuffer.value,
      }
    : {
        mode: "default",
        name: null,
        area_city_ids: [appliedCityId.value],
        file_id: null,
        radius: appliedBuffer.value,
      };

  try {
    const response = await $fetch<{ message_id: string }>(
      "/panel/analysis/fwa-quick-potential-insight",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        body: JSON.stringify(body),
      },
    );
    currentMessageId.value = response.message_id;
    setTimeout(() => pollQueueStatus(response.message_id), 1000);
  } catch (e: any) {
    isAnalyzing.value = false;
    toast.add({
      title: "Failed to Start Analysis",
      description: e?.data?.message || "Please try again later",
      icon: "i-heroicons-x-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
      },
    });
  }
};

// Watch for successful data load and add to map
watch(potentialData, (newData) => {
  if (newData?.geojson_buffer) {
    // Enrich buffer features with owner from tower data (buffer only carries id)
    const ownerMap = new Map<number, string>();
    newData.geojson_tower?.features?.forEach((f: any) => {
      if (f.properties?.id != null)
        ownerMap.set(f.properties.id, f.properties.owner);
    });
    const enrichedBuffer = {
      ...newData.geojson_buffer,
      features: newData.geojson_buffer.features.map((f: any) => ({
        ...f,
        properties: {
          ...f.properties,
          owner: ownerMap.get(f.properties?.id) ?? null,
        },
      })),
    };

    // Add layer to map
    addBufferLayerToMap(enrichedBuffer);

    // Fly to city location
    if (selectedCityData.value) {
      flyToCity(selectedCityData.value);
    }

    toast.add({
      title: "Data Loaded Successfully",
      description: `Found ${potentialData.value?.analytics?.total_towers ?? 0} towers with ${appliedBuffer.value}m buffer analysis`,
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  }
});

// Reset filter
const resetFilter = () => {
  selectedProvince.value = "";
  selectedCity.value = "";
  bufferValue.value = 300;
  appliedBuffer.value = 300;
  uploadedFile.value = null;
  uploadedFileKey.value = "";
  if (fileInputRef.value) fileInputRef.value.value = "";
  appliedCityId.value = null;
  resolvedFileId.value = "";
  isAnalyzing.value = false;
  isQueued.value = false;
  currentMessageId.value = null;
  potentialData.value = null;
  qmiResultId.value = null;
  fileReportId.value = null;
  isError.value = false;
  error.value = null;
};

// Toggle visibility on map
const toggleVisibility = () => {
  isDataVisible.value = !isDataVisible.value;

  if (!mapRefStore.map) return;

  const map = mapRefStore.map;
  const visibility = isDataVisible.value ? "visible" : "none";

  // Toggle both layers
  if (map.getLayer(LAYER_ID)) {
    console.log(map.queryRenderedFeatures());
    map.setLayoutProperty(LAYER_ID, "visibility", visibility);
  }
  if (map.getLayer(`${LAYER_ID}-outline`)) {
    map.setLayoutProperty(`${LAYER_ID}-outline`, "visibility", visibility);
  }
};

// Download filtered data
const isDownloading = ref(false);

const downloadData = async () => {
  if (!fileReportId.value) {
    toast.add({
      title: "No Data to Download",
      description: "Please apply filter to load data first",
      icon: "i-heroicons-exclamation-triangle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
      },
    });
    return;
  }

  isDownloading.value = true;
  try {
    const link = document.createElement("a");
    link.href = `/panel/assets/${fileReportId.value}`;
    link.download = `fwa-potential-${appliedCity.value || qmiResultId.value}-${Date.now()}.xlsx`;
    link.click();
    toast.add({
      title: "Download Started",
      description: "Downloading Excel file",
      icon: "i-heroicons-arrow-down-tray",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
      },
    });
  } finally {
    isDownloading.value = false;
  }
};

// Watch for city change to clear buffer
watch(selectedCity, (newCity, oldCity) => {
  if (oldCity && newCity !== oldCity) {
    removeBufferLayerFromMap();
    appliedCity.value = "";
  }
});

// Watch for province change to fetch cities and reset city
watch(selectedProvince, (newProvince) => {
  selectedCity.value = "";
  cityOptions.value = [];

  if (newProvince) {
    fetchCities(newProvince);
  }
});

// Auto-show filter popover when mapInfo becomes 'analytic' and no filter is set
watch(
  () => mapInfo.value,
  (newVal) => {
    if (newVal === "analytic" && !isFilterValid.value) {
      // Use nextTick to ensure DOM is ready
      nextTick(() => {
        showFilterPopover.value = true;
      });
    }
  },
  { immediate: true },
);

// Also try on mount as a fallback
onMounted(() => {
  // Fetch provinces on component mount
  fetchProvinces();

  setTimeout(() => {
    if (!isFilterValid.value && !showFilterPopover.value) {
      showFilterPopover.value = true;
    }
  }, 100);
});

// Cleanup on unmount
onUnmounted(() => {
  // Remove buffer layer and legend when component is destroyed
  removeBufferLayerFromMap();
});
</script>

<template>
  <div class="py-3 flex flex-col gap-3">
    <!-- Section 1: Action Buttons -->
    <div class="flex flex-col gap-2">
      <div class="grid grid-cols-3 gap-2">
        <!-- Filter Button with Popover -->
        <UPopover
          v-model:open="showFilterPopover"
          :popper="{ placement: 'left-start', offsetDistance: 25 }"
        >
          <UButton
            size="xs"
            color="gray"
            variant="outline"
            block
            :ui="{ rounded: 'rounded-xxs', padding: { xs: 'px-2 py-2' } }"
            class="flex items-center gap-1"
          >
            <IcFilter class="w-4 h-4" />
            <span class="text-[10px]">Filter</span>
          </UButton>

          <template #panel>
            <div class="px-3 py-2 w-72">
              <div class="flex items-center justify-between mb-3">
                <h3 class="text-sm font-semibold text-gray-900">Filter Area</h3>
                <UButton
                  color="gray"
                  variant="ghost"
                  icon="i-heroicons-x-mark-20-solid"
                  size="xs"
                  @click="showFilterPopover = false"
                />
              </div>

              <div class="space-y-3">
                <p class="text-xs text-grey-600">
                  Select province and city to filter potential analysis data.
                </p>

                <!-- Province Dropdown -->
                <div>
                  <label class="block text-xs font-medium text-grey-700 mb-1">
                    Province
                  </label>
                  <USelect
                    v-model="selectedProvince"
                    :options="provinceOptions"
                    option-attribute="province"
                    value-attribute="province"
                    placeholder="Select province"
                    size="xs"
                    :loading="isLoadingProvinces"
                    :ui="{ rounded: 'rounded-xxs' }"
                  />
                </div>

                <!-- City Dropdown -->
                <div>
                  <label class="block text-xs font-medium text-grey-700 mb-1">
                    City
                  </label>
                  <USelect
                    v-model="selectedCity"
                    :options="cityOptions"
                    option-attribute="city"
                    value-attribute="city"
                    placeholder="Select city"
                    size="xs"
                    :disabled="!selectedProvince || isLoadingCities"
                    :loading="isLoadingCities"
                    :ui="{ rounded: 'rounded-xxs' }"
                  />
                </div>

                <!-- Buffer Distance Slider -->
                <div>
                  <label class="block text-xs font-medium text-grey-700 mb-2">
                    Buffer Distance:
                    <span class="font-semibold text-brand-600"
                      >{{ bufferValue }}m</span
                    >
                  </label>
                  <input
                    v-model.number="bufferValue"
                    type="range"
                    min="100"
                    max="500"
                    step="10"
                    class="w-full h-2 bg-grey-200 rounded-lg appearance-none cursor-pointer accent-brand-600"
                  />
                  <div class="flex justify-between text-2xs text-grey-500 mt-1">
                    <span>100</span>
                    <span>200</span>
                    <span>300</span>
                    <span>400</span>
                    <span>500</span>
                  </div>
                </div>

                <!-- File Upload -->
                <div>
                  <label class="block text-xs font-medium text-grey-700 mb-1">
                    Upload File
                  </label>
                  <div class="relative border border-grey-300 rounded-xxs">
                    <button
                      type="button"
                      class="w-full text-xs rounded-xxs p-2 bg-white flex items-center justify-between"
                      @click="fileInputRef?.click()"
                    >
                      <p v-if="!uploadedFile" class="text-grey-500">
                        Choose file...
                      </p>
                      <p v-else class="truncate text-grey-800">
                        {{ uploadedFile.name }}
                      </p>
                      <UButton
                        v-if="uploadedFile"
                        icon="i-heroicons-x-mark-20-solid"
                        size="2xs"
                        color="gray"
                        variant="ghost"
                        @click.stop="
                          uploadedFile = null;
                          if (fileInputRef) fileInputRef.value = '';
                        "
                      />
                    </button>
                    <input
                      ref="fileInputRef"
                      type="file"
                      class="hidden"
                      @change="
                        (e) => {
                          uploadedFile =
                            (e.target as HTMLInputElement).files?.[0] ?? null;
                        }
                      "
                    />
                  </div>
                </div>

                <!-- Reset Filter Button -->
                <div v-if="isFilterValid">
                  <UButton
                    color="gray"
                    variant="ghost"
                    size="xs"
                    class="flex justify-start"
                    icon="i-heroicons-arrow-path"
                    :ui="{ rounded: 'rounded-xxs' }"
                    @click="resetFilter"
                    block
                  >
                    Reset Filter
                  </UButton>
                </div>

                <!-- Apply Button -->
                <div class="flex justify-end gap-2 pt-2">
                  <UButton
                    color="gray"
                    variant="outline"
                    size="xs"
                    :ui="{ rounded: 'rounded-xxs' }"
                    @click="showFilterPopover = false"
                  >
                    Cancel
                  </UButton>
                  <UButton
                    color="brand"
                    size="xs"
                    :ui="{ rounded: 'rounded-xxs' }"
                    @click="applyFilter"
                    :disabled="!isFilterValid || isUploadingFile || isAnalyzing"
                    :loading="isUploadingFile || isAnalyzing"
                  >
                    Apply Filter
                  </UButton>
                </div>
              </div>
            </div>
          </template>
        </UPopover>

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

        <!-- Download Button -->
        <UButton
          size="xs"
          color="gray"
          variant="outline"
          :ui="{ rounded: 'rounded-xxs', padding: { xs: 'px-2 py-2' } }"
          @click="downloadData"
          :disabled="
            !potentialData ||
            (Array.isArray(potentialData) && potentialData.length === 0) ||
            isDownloading
          "
          :loading="isDownloading"
          block
          class="flex items-center gap-1"
        >
          <IcDownload v-if="!isDownloading" class="w-4 h-4" />
          <span class="text-[10px]">{{
            isDownloading ? "Downloading..." : "Download"
          }}</span>
        </UButton>
      </div>

      <!-- Filter Summary -->
      <div v-if="isFilterValid" class="flex items-center flex-wrap gap-1 mt-2">
        <UBadge
          :label="selectedProvince"
          color="primary"
          variant="soft"
          size="xs"
          :ui="{ rounded: 'rounded-full' }"
        >
          <template #trailing>
            <UButton
              color="primary"
              variant="link"
              icon="i-heroicons-x-mark-20-solid"
              size="2xs"
              :padded="false"
              @click="selectedProvince = ''"
            />
          </template>
        </UBadge>
        <UBadge
          :label="selectedCity"
          color="primary"
          variant="soft"
          size="xs"
          :ui="{ rounded: 'rounded-full' }"
        >
          <template #trailing>
            <UButton
              color="primary"
              variant="link"
              icon="i-heroicons-x-mark-20-solid"
              size="2xs"
              :padded="false"
              @click="selectedCity = ''"
            />
          </template>
        </UBadge>
      </div>
    </div>

    <UDivider />

    <!-- Section 2: Data List -->
    <div class="flex flex-col gap-2">
      <p class="text-md text-grey-700 font-semibold">Potential Analysis Data</p>

      <!-- Polling loading state -->
      <div
        v-if="isAnalyzing"
        class="flex flex-col items-center gap-2 py-6 text-center"
      >
        <UIcon
          name="i-heroicons-arrow-path"
          class="w-6 h-6 text-brand-500 animate-spin"
        />
        <p class="text-xs font-medium text-grey-700">Running analysis...</p>
        <p class="text-2xs text-grey-500">This may take a few moments</p>
      </div>

      <MapToolsPotentialAnalysisQpiContent
        v-else
        :data="potentialData"
        :is-loading="isLoadingData"
        :is-error="isError"
        :error="error"
        :radius="appliedBuffer"
      />
    </div>
  </div>
</template>

<style scoped>
input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

input[type="range"]::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}
</style>
