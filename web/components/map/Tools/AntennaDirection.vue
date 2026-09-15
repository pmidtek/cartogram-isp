<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";

const authStore = useAuth();
const analysisStore = useAnalysisResult();
const featureStore = useFeature();
const toast = useToast();

// Form state
const formData = ref({
  analysisName: "",
  workingLevel: [] as any[], // area_city_ids (max 3)
  radius: 300,
  towerDataType: "existing", // "upload" or "existing"
  uploadFile: null as File | null,
  uploadFileId: null as string | null,
});

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

  if (formData.value.towerDataType === "upload") {
    return !formData.value.uploadFileId;
  }

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
      const antennaDirectionId = result?.result?.antenna_direction_id;

      if (antennaDirectionId) {
        // Fetch the actual result data
        const antennaResponse = await $fetch<{ data: any }>(
          `/panel/items/antenna_direction/${antennaDirectionId}`,
          {
            headers: {
              Authorization: `Bearer ${authStore.accessToken}`,
            },
          },
        );

        // Store the result data for antenna direction analysis panel
        analysisStore.setAntennaDirectionData(antennaResponse.data);
        analysisStore.setCurrentAnalysisType("antenna_direction_analysis");
      }

      toast.add({
        title: "Analysis Complete",
        description: "Antenna direction results are ready to view",
        icon: "i-heroicons-check-circle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });

      isAnalyzing.value = false;
      isQueued.value = false;
      currentMessageId.value = null;
    } else if (state === "rejected" || status === "error") {
      toast.add({
        title: "Analysis Failed",
        description: "The antenna direction analysis failed to complete",
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
  // Validation
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

  isAnalyzing.value = true;

  try {
    const isUpload = formData.value.towerDataType === "upload";
    const payload = {
      mode: isUpload ? "upload" : "default",
      name: formData.value.analysisName || null,
      area_city_ids: isUpload
        ? []
        : formData.value.workingLevel.map((city: any) =>
            typeof city === "object" ? city.value : city,
          ),
      file_id: isUpload ? formData.value.uploadFileId : null,
      radius: formData.value.radius,
    };

    const response = await $fetch<{ message_id: string }>(
      "/panel/analysis/fwa-antenna-direction",
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
      description: "Processing your antenna direction request...",
      icon: "i-heroicons-arrow-path",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    toast.add({
      title: "Analysis On Process",
      description: "Don't close Antenna Direction window",
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
</script>

<template>
  <div class="p-2 flex flex-col gap-3">
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

    <!-- Tower Type & File Upload -->
    <div class="space-y-2">
      <label class="block text-xs font-medium text-grey-700"> Tower Type </label>
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
      </div>
      <input
        ref="fileInput"
        type="file"
        class="hidden"
        accept=".csv"
        @change="handleFileUpload"
      />
      <p v-if="formData.uploadFile" class="text-2xs text-grey-600 mt-1">
        Selected: {{ formData.uploadFile.name }}
      </p>
    </div>

    <!-- Working Level (default mode only) -->
    <div v-if="formData.towerDataType === 'existing'">
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
          <span v-if="selectedCities.length === 0" class="text-grey-500">
            Select up to 3 cities
          </span>
          <span v-else class="truncate">
            {{
              selectedCities
                .map((c: any) =>
                  typeof c === "object"
                    ? c.label
                    : citiesData?.find((city) => city.value === c)?.label || c,
                )
                .join(", ")
            }}
          </span>
        </template>
      </USelectMenu>
      <p v-if="selectedCities.length > 0" class="text-2xs text-grey-600">
        {{ selectedCities.length }} / 3 cities selected
      </p>
    </div>

    <!-- Radius Slider -->
    <div>
      <label class="block text-xs font-medium text-grey-700 mb-2">
        Radius:
        <span class="font-semibold text-brand-600">{{ formData.radius }}m</span>
      </label>
      <input
        v-model.number="formData.radius"
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
