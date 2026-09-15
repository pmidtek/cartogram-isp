<script setup lang="ts">
import { Menu, MenuButton, MenuItems } from "@headlessui/vue";
import { storeToRefs } from "pinia";
import IcAction from "~/assets/icons/ic-action.svg";
import IcArrow from "~/assets/icons/ic-arrow-reg.svg";
import { useQuery } from "@tanstack/vue-query";

const toolsStore = useMapTools();
const { expandTools } = storeToRefs(toolsStore);
const authStore = useAuth();
const analysisStore = useAnalysisResult();
const featureStore = useFeature();
const queueStore = useGeoprocessingQueue();
const toast = useToast();
// Form state
const formData = ref({
  // FWA Variables
  analysisName: "", // New field for analysis name
  workingLevel: [] as any[], // Changed to array for multiple cities (max 3)
  towerPriority: [] as any[], // Array of ranked towers
  bufferType: "fixed",
  bufferDistance: 300,
  sectorCount: 3, // New field: 2 or 3 for fixed mode, null for dynamic
  towerDataType: "existing", // upload or existing
  uploadFile: null as File | null,
  uploadFileId: null as string | null, // New field for uploaded file ID

  // Demography Variables
  housingCategory: "",
  housingSizeMin: "",
  housingSizeMax: "",

  // FTTH Variables
  nearestBackbone: "yes",
  nearestFTTH: "no",
  poiCategory: "",
});

// Tower priority modal state
const isTowerPriorityModalOpen = ref(false);

// Analysis loading state
const isAnalyzing = ref(false);
const isQueued = ref(false);
const currentMessageId = ref<string | null>(null);

// Fetch cities list
const { data: citiesData, isLoading: isLoadingCities } = useQuery({
  queryKey: ["/panel/items/area_cities"],
  queryFn: async () => {
    const res = await $fetch<{ data: any[] }>(
      "/panel/items/area_cities?fields=ogc_fid,city&sort=city_id&limit=-1",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return res.data.map((item) => ({
      value: item.ogc_fid,
      label: item.city,
    }));
  },
});

// Computed to limit selection to max 3 cities
const selectedCities = computed({
  get: () => formData.value.workingLevel,
  set: (value) => {
    if (value.length <= 3) {
      formData.value.workingLevel = value;
    }
  },
});

// Computed to check if analyze button should be disabled
const isAnalyzeDisabled = computed(() => {
  if (isAnalyzing.value) return true;

  // For upload mode, check if file is uploaded
  if (formData.value.towerDataType === "upload") {
    return !formData.value.uploadFileId;
  }

  // For existing data mode, check if cities are selected
  return formData.value.workingLevel.length === 0;
});

const pollQueueStatus = async (messageId: string) => {
  isQueued.value = true;

  try {
    const response = await $fetch<{ data: any }>(
      `/panel/items/geoprocessing_queue/${messageId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    const { state, status, result } = response.data;

    // Check if processing is complete
    if (state === "done" && status === "success") {
      // Get qmi_result_id from result
      const qmiResultId = result?.result?.qmi_result_id;

      if (qmiResultId) {
        // Fetch the actual result data
        const qmiResponse = await $fetch<{ data: any }>(
          `/panel/items/qmi_result/${qmiResultId}`,
          {
            headers: {
              Authorization: `Bearer ${authStore.accessToken}`,
            },
          },
        );

        // Store the result data for QMI result analysis panel
        analysisStore.setQmiResultData(qmiResponse.data);
        analysisStore.setCurrentAnalysisType("qmi_result_analysis");

        toast.add({
          title: "Analysis Complete",
          description: "Results are ready to view",
          icon: "i-heroicons-check-circle",
          ui: { background: "bg-white", title: "text-grey-800" },
        });

        isAnalyzing.value = false;
        isQueued.value = false;
        currentMessageId.value = null;
      }
    } else if (state === "rejected" || status === "error") {
      toast.add({
        title: "Analysis Failed",
        description: "The analysis task failed to complete",
        icon: "i-heroicons-x-circle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
      isAnalyzing.value = false;
      isQueued.value = false;
      currentMessageId.value = null;
    } else {
      // Still processing, poll again after 5 seconds
      setTimeout(() => pollQueueStatus(messageId), 5000);
    }
  } catch (error: any) {
    toast.add({
      title: "Error",
      description: error?.data?.message || "Failed to check queue status",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    isAnalyzing.value = false;
    isQueued.value = false;
    currentMessageId.value = null;
  }
};

const handleAnalyze = async () => {
  // Validation for upload mode
  if (formData.value.towerDataType === "upload") {
    if (!formData.value.uploadFileId) {
      toast.add({
        title: "Validation Error",
        description: "Please upload a data file",
        icon: "i-heroicons-exclamation-triangle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
      return;
    }
  } else {
    // Validation for default mode
    if (formData.value.workingLevel.length === 0) {
      toast.add({
        title: "Validation Error",
        description: "Please select at least one city",
        icon: "i-heroicons-exclamation-triangle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
      return;
    }
  }

  if (formData.value.towerPriority.length === 0) {
    toast.add({
      title: "Validation Error",
      description: "Please set tower priority ranking",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  isAnalyzing.value = true;

  try {
    // Extract tower codes in priority order
    const priority = formData.value.towerPriority.map(
      (tower: any) => tower.code,
    );

    // Build payload based on mode
    const payload: any = {
      mode: formData.value.towerDataType === "upload" ? "upload" : "default",
      name: formData.value.analysisName || null,
      radius: formData.value.bufferDistance,
      sector_mode: formData.value.bufferType,
      sector_count:
        formData.value.bufferType === "fixed"
          ? formData.value.sectorCount
          : null,
      priority,
    };

    if (formData.value.towerDataType === "upload") {
      // Upload mode
      payload.area_city_ids = [];
      payload.file_id = formData.value.uploadFileId;
    } else {
      // Default mode
      payload.area_city_ids = formData.value.workingLevel.map((city: any) =>
        typeof city === "object" ? city.value : city,
      );
      payload.file_id = null;
    }

    const response = await $fetch<{ message_id: string }>(
      "/panel/analysis/fwa-quick-market-insight",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        body: JSON.stringify(payload),
      },
    );

    currentMessageId.value = response.message_id;

    toast.add({
      title: "Analysis Started",
      description: "Processing your request...",
      icon: "i-heroicons-arrow-path",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    toast.add({
      title: "Analysis On Process",
      description: "Dont close Quick Request Window",
      icon: "i-heroicons-arrow-path",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    // Start polling queue status
    setTimeout(() => pollQueueStatus(response.message_id), 1000);
  } catch (error: any) {
    toast.add({
      title: "Analysis Failed",
      description: error?.data?.message || "Failed to start analysis",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isAnalyzing.value = false;
  }
};

const handleShowResult = () => {
  featureStore.setMapInfo("quick-request-list");
};

const handleFileUpload = async (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files[0]) {
    const file = target.files[0];
    formData.value.uploadFile = file;

    // Upload file to get file_id
    try {
      const uploadFormData = new FormData();
      uploadFormData.append("file", file);

      const response = await $fetch<{
        data: { id: string; filename_disk: string };
      }>("/panel/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        body: uploadFormData,
      });

      formData.value.uploadFileId = response.data.filename_disk;

      toast.add({
        title: "File Uploaded",
        description: `${file.name} uploaded successfully`,
        icon: "i-heroicons-check-circle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
    } catch (error: any) {
      toast.add({
        title: "Upload Failed",
        description: error?.data?.message || "Failed to upload file",
        icon: "i-heroicons-x-circle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
      formData.value.uploadFile = null;
      formData.value.uploadFileId = null;
    }
  }
};

const openTowerPriorityModal = () => {
  isTowerPriorityModalOpen.value = true;
};

const handleSaveTowerRanking = (towers: any[]) => {
  formData.value.towerPriority = towers;
};

const handleUpdateRanking = (ranking: any[]) => {
  formData.value.towerPriority = ranking;
};

const handleClose = () => {
  isTowerPriorityModalOpen.value = false;
};

const handleDownloadTemplate = async () => {
  try {
    // Fetch the template file from Directus
    const response = await $fetch(
      "/panel/assets/f987403d-96ea-4f33-b339-d26df0013b12?download",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        responseType: "blob",
      },
    );

    // Create blob and download
    const blob = new Blob([response], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "Template Upload FWA Tower QMI Analysis.xlsx";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.add({
      title: "Template Downloaded",
      description: "Tower template file has been downloaded",
      icon: "i-heroicons-arrow-down-tray",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } catch (error: any) {
    toast.add({
      title: "Download Failed",
      description: error?.data?.message || "Failed to download template",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  }
};
</script>

<template>
  <Menu as="div" v-slot="{ open }" class="relative inline-block text-left">
    <div>
      <MenuButton
        :class="[
          open
            ? 'bg-gradient-to-r from-blue-200/80 to-blue-600 text-white'
            : 'bg-transparent enabled:hover:bg-gradient-to-r enabled:hover:from-blue-200/80 enabled:hover:to-blue-600 enabled:hover:text-white text-grey-700 disabled:hover:bg-transparent',
          'inline-flex w-full items-center h-9 gap-3 rounded-xxs px-2 py-2 text-sm font-normal focus:outline-none disabled:text-grey-200',
        ]"
      >
        <IcAction class="w-4 h-4" :fontControlled="false" />
        <div
          :class="[
            expandTools ? 'w-72' : 'w-0',
            'max-w-max whitespace-nowrap overflow-hidden',
          ]"
        >
          Quick Request
        </div>
        <IcArrow class="w-4 h-4" :fontControlled="false" />
      </MenuButton>
    </div>

    <transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="transform scale-95 opacity-0"
      enter-to-class="transform scale-100 opacity-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="transform scale-100 opacity-100"
      leave-to-class="transform scale-95 opacity-0"
    >
      <MenuItems
        class="absolute right-0 bottom-12 mt-2 p-4 w-96 max-h-[64vh] overflow-y-auto hide-scrollbar origin-top-right rounded-sm bg-white shadow-xl ring-1 ring-grey-300 focus:outline-none"
      >
        <div class="space-y-4">
          <!-- FWA Variable Section -->
          <div class="space-y-3">
            <h3
              class="text-sm font-semibold text-grey-900 border-b border-grey-200 pb-2"
            >
              FWA Variable
            </h3>

            <!-- Analysis Name -->
            <div>
              <label class="block text-xs font-medium text-grey-700 mb-1.5">
                Analysis Name (Optional)
              </label>
              <UInput
                v-model="formData.analysisName"
                type="text"
                placeholder="Auto-generated if empty"
                size="sm"
                :ui="{ rounded: 'rounded-xxs' }"
              />
            </div>

            <!-- Working Level -->
            <div>
              <label class="block text-xs font-medium text-grey-700 mb-1.5">
                Working Level
              </label>
              <USelectMenu
                v-model="selectedCities"
                :options="citiesData || []"
                :loading="isLoadingCities"
                placeholder="Select up to 3 cities"
                multiple
                size="sm"
                value-attribute="value"
                option-attribute="label"
                searchable
                :ui="{ rounded: 'rounded-xxs' }"
                :uiMenu="{ rounded: 'rounded-xxs' }"
              >
                <template #label>
                  <span
                    v-if="selectedCities.length === 0"
                    class="text-grey-500"
                  >
                    Select up to 3 cities
                  </span>
                  <span v-else class="truncate">
                    {{
                      selectedCities
                        .map((c: any) =>
                          typeof c === "object"
                            ? c.label
                            : citiesData?.find((city) => city.value === c)
                                ?.label || c,
                        )
                        .join(", ")
                    }}
                  </span>
                </template>
              </USelectMenu>

              <p
                v-if="selectedCities.length > 0"
                class="text-2xs text-grey-600"
              >
                {{ selectedCities.length }} / 3 cities selected
              </p>
            </div>

            <!-- Tower Priority -->
            <div>
              <label class="block text-xs font-medium text-grey-700 mb-1.5">
                Tower Priority
              </label>
              <UPopover
                v-model:open="isTowerPriorityModalOpen"
                :popper="{ placement: 'left', offsetDistance: 20 }"
              >
                <UButton
                  label="Set Tower Ranking"
                  color="gray"
                  variant="outline"
                  size="sm"
                  block
                  :ui="{ rounded: 'rounded-xxs' }"
                />

                <template #panel>
                  <MapToolsQuickRequestTowerPriority
                    :savedRanking="formData.towerPriority"
                    @update:ranking="handleUpdateRanking"
                    @close="handleClose"
                  />
                </template>
              </UPopover>
              <p
                v-if="formData.towerPriority.length > 0"
                class="text-2xs text-grey-600 mt-1"
              >
                {{ formData.towerPriority.length }} towers ranked
              </p>
            </div>

            <!-- Buffer Type -->
            <div>
              <label class="block text-xs font-medium text-grey-700 mb-1.5">
                Buffer type
              </label>
              <USelectMenu
                v-model="formData.bufferType"
                :options="[
                  { label: 'Dynamic Quadrant', value: 'dynamic' },
                  { label: 'Fixed', value: 'fixed' },
                ]"
                placeholder="Select buffer type"
                size="sm"
                value-attribute="value"
                option-attribute="label"
                :ui="{ rounded: 'rounded-xxs' }"
                :uiMenu="{
                  rounded: 'rounded-xxs',
                  option: { rounded: 'rounded-xxs' },
                }"
              />
            </div>

            <!-- Sector Count (only for Fixed buffer type) -->
            <div v-if="formData.bufferType === 'fixed'">
              <label class="block text-xs font-medium text-grey-700 mb-1.5">
                Sector Count
              </label>
              <div class="grid grid-cols-2 gap-4">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    v-model.number="formData.sectorCount"
                    type="radio"
                    :value="2"
                    class="w-4 h-4 text-brand-600 border-grey-300 focus:ring-brand-500"
                  />
                  <span class="text-xs text-grey-700">2 Sectors</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    v-model.number="formData.sectorCount"
                    type="radio"
                    :value="3"
                    class="w-4 h-4 text-brand-600 border-grey-300 focus:ring-brand-500"
                  />
                  <span class="text-xs text-grey-700">3 Sectors</span>
                </label>
              </div>
            </div>

            <!-- Buffer Distance Slider -->
            <div>
              <label class="block text-xs font-medium text-grey-700 mb-2">
                Buffer Distance:
                <span class="font-semibold text-brand-600"
                  >{{ formData.bufferDistance }}m</span
                >
              </label>
              <input
                v-model.number="formData.bufferDistance"
                type="range"
                min="10"
                max="500"
                step="10"
                class="w-full h-2 bg-grey-200 rounded-lg appearance-none cursor-pointer accent-brand-600"
              />
              <div class="flex justify-between text-2xs text-grey-500 mt-1">
                <span>10</span>
                <span>100</span>
                <span>200</span>
                <span>300</span>
                <span>400</span>
                <span>500</span>
              </div>
            </div>

            <!-- Tower Type & File Upload -->
            <div class="space-y-2">
              <label class="block text-xs font-medium text-grey-700">
                Tower Type
              </label>
              <div class="grid grid-cols-2 gap-4">
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    v-model="formData.towerDataType"
                    type="radio"
                    value="upload"
                    class="w-4 h-4 text-brand-600 border-grey-300 focus:ring-brand-500"
                  />
                  <span class="text-xs text-grey-700">Upload data</span>
                </label>
                <label class="flex items-center gap-2 cursor-pointer">
                  <input
                    v-model="formData.towerDataType"
                    type="radio"
                    value="existing"
                    class="w-4 h-4 text-brand-600 border-grey-300 focus:ring-brand-500"
                  />
                  <span class="text-xs text-grey-700">Existing data</span>
                </label>
              </div>

              <div v-if="formData.towerDataType === 'upload'" class="space-y-2">
                <UButton
                  label="Choose File"
                  icon="i-heroicons-arrow-up-tray"
                  color="gray"
                  variant="outline"
                  size="sm"
                  block
                  @click="($refs.fileInput as HTMLInputElement)?.click()"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
                <UButton
                  label="Download Template"
                  color="brand"
                  variant="ghost"
                  size="sm"
                  @click="handleDownloadTemplate"
                  class="p-0 text-[10px]"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
              </div>
              <input
                ref="fileInput"
                type="file"
                class="hidden"
                accept=".geojson,.kml,.shp,.csv"
                @change="handleFileUpload"
              />
              <p v-if="formData.uploadFile" class="text-2xs text-grey-600 mt-1">
                Selected: {{ formData.uploadFile.name }}
              </p>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="grid grid-cols-2 gap-2 pt-2 border-t border-grey-200">
            <UButton
              label="Analyze"
              color="brand"
              size="sm"
              block
              :loading="isAnalyzing"
              :disabled="isAnalyzeDisabled"
              @click="handleAnalyze"
              :ui="{ rounded: 'rounded-xxs' }"
            />
            <UButton
              label="Result"
              color="gray"
              variant="outline"
              size="sm"
              block
              :disabled="isQueued"
              :loading="isQueued"
              @click="handleShowResult"
              :ui="{ rounded: 'rounded-xxs' }"
            />
          </div>
        </div>
      </MenuItems>
    </transition>
  </Menu>
</template>

<style scoped>
/* Custom slider styling */
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
