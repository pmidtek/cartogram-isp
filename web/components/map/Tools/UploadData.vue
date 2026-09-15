<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";

interface Props {
  taskType: "import_site_point" | "register_asset";
}

const props = defineProps<Props>();

// State
const uploadFile = ref<File | null>(null);
const fileName = ref<string>("");
const isUploading = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const uploadedTaskId = ref<string | null>(null);

// Stores
const authStore = useAuth();
const queueStore = useGeoprocessingQueue();
const featureStore = useFeature();
const toolsStore = useMapTools();
const toast = useToast();
const mapRefStore = useMapRef();
const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);
const layerStore = useMapLayer();
const { fetchActiveLayers } = layerStore;

// Poll for task completion
const { data: taskStatus } = useQuery({
  queryKey: ["upload_task_status", uploadedTaskId],
  queryFn: async () => {
    if (!uploadedTaskId.value) return null;

    const response = await fetch(
      `/panel/items/geoprocessing_queue/${uploadedTaskId.value}?` +
        new URLSearchParams({ fields: "message_id,state,status,message" }),
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return await response.json();
  },
  refetchInterval: (query) => {
    // Stop polling when task is complete
    const state = query.state.data?.data?.state;
    return ["done", "rejected"].includes(state) ? false : 5000;
  },
  enabled: computed(() => !!uploadedTaskId.value),
});

// Watch for task completion
watch(
  () => taskStatus.value?.data?.state,
  async (state) => {
    if (state && ["done", "rejected"].includes(state)) {
      // Show completion toast
      queueStore.checkQueueState(uploadedTaskId.value!);

      // Reset layers if task was successful
      if (taskStatus.value?.data?.status === "success") {
        try {
          const map = mapRefStore.map;
          if (map) {
            const style = map.getStyle();
            const allLayers: any[] = style?.layers || [];

            // Determine which layers to refresh based on task type
            const layerFilter =
              props.taskType === "import_site_point" ? "site_points" : "assets";

            // Filter for relevant layers
            const targetLayers = allLayers.filter((ly: any) =>
              ly["source-layer"]?.includes(layerFilter),
            );

            // Remove layers first
            targetLayers.forEach((ly: any) => {
              if (map.getLayer(ly.id)) map.removeLayer(ly.id);
            });

            // Extract unique source IDs and remove sources
            const sourceIds = Array.from(
              new Set(
                targetLayers
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
          await fetchActiveLayers(currentModule.value?.slug);
        } catch (e) {
          console.warn("Failed to refetch active layers:", e);
        }
      }

      // Stop tracking
      uploadedTaskId.value = null;
    }
  },
);

// Handle file selection
const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target.files?.[0];

  if (!file) return;

  const allowedExtensions = [".xlsx", ".kml", ".kmz"];

  // Validate extension
  if (!allowedExtensions.some((ext) => file.name.toLowerCase().endsWith(ext))) {
    toast.add({
      title: "Invalid File Type",
      description: "Please select an allowed file type (.xlsx, .kml, .kmz)",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-grey-800",
        description: "text-grey-800",
      },
    });
    return;
  }

  // Validate size (10MB max)
  if (file.size > 10 * 1024 * 1024) {
    toast.add({
      title: "File Too Large",
      description: "File must be less than 10MB",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-grey-800",
        description: "text-grey-800",
      },
    });
    return;
  }

  uploadFile.value = file;
  fileName.value = file.name;
};

// Clear selected file
const clearFile = () => {
  uploadFile.value = null;
  fileName.value = "";
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }
};

// Handle upload
const handleUpload = async () => {
  if (!uploadFile.value) {
    toast.add({
      title: "No File Selected",
      description: "Please select a file to upload",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-grey-800",
        description: "text-grey-800",
      },
    });
    return;
  }

  isUploading.value = true;

  try {
    // Create FormData
    const formData = new FormData();
    formData.append("file", uploadFile.value);
    formData.append("task", props.taskType);

    const extension = uploadFile.value.name
      .slice(uploadFile.value.name.lastIndexOf("."))
      .toLowerCase();

    if ([".kml", ".kmz"].includes(extension)) {
      formData.append("site_point_type_id", "4");
    }

    // Upload to backend
    const response = await $fetch<{
      data: {
        message_id: string;
        filename: string;
        message: string;
        site_point_type_id: string;
      };
    }>("/panel/import/data", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: formData,
    });

    // Start polling for task completion
    uploadedTaskId.value = response.data.message_id;

    // Switch to geoprocessing sidebar
    featureStore.setMapInfo("geoprocessing");

    // Close tools card
    toolsStore.showCard = false;
    toolsStore.showTools = true;

    // Show success toast
    toast.add({
      title: "Upload Successful",
      description:
        "Processing data in background. You'll be notified when complete.",
      icon: "i-heroicons-check-circle",
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-grey-800",
        description: "text-grey-800",
      },
    });

    // Clear file
    clearFile();
  } catch (error: any) {
    console.error("Upload error:", error);
    toast.add({
      title: "Upload Failed",
      description: error?.data?.message || "Failed to upload file",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-grey-800",
        description: "text-grey-800",
      },
    });
  } finally {
    isUploading.value = false;
  }
};
</script>

<template>
  <div class="space-y-1.5">
    <!-- File Input Button -->
    <div
      class="border border-dashed border-grey-400 rounded-xxs p-2 text-center hover:border-brand-500 transition-colors"
    >
      <input
        ref="fileInputRef"
        type="file"
        accept=".xlsx,.kml,.kmz"
        class="hidden"
        @change="handleFileSelect"
      />

      <div
        v-if="!fileName"
        @click="fileInputRef?.click()"
        class="cursor-pointer flex items-center justify-center gap-2"
      >
        <div class="flex justify-center mb-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-5 h-5 text-grey-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>
        </div>
        <p class="text-2xs text-grey-600">Upload File</p>
      </div>

      <div v-else class="space-y-1">
        <div class="flex items-center justify-center gap-1">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            class="w-4 h-4 text-green-500"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p class="text-3xs text-grey-900 font-medium truncate">
            {{ fileName }}
          </p>
        </div>
        <button
          @click="clearFile"
          class="text-3xs text-grey-600 hover:text-brand-500 underline"
        >
          Change
        </button>
      </div>
    </div>

    <!-- Upload Button -->
    <UButton
      label="Upload & Process"
      icon="i-heroicons-cloud-arrow-up"
      color="brand"
      size="2xs"
      block
      :disabled="!uploadFile || isUploading"
      :loading="isUploading"
      @click="handleUpload"
      :ui="{ rounded: 'rounded-xxs' }"
    />
  </div>
</template>
