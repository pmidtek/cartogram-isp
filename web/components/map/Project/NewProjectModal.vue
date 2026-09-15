<script setup lang="ts">
import * as tj from "@mapbox/togeojson";
import {
  Map as MaplibreMap,
  type StyleSpecification,
  type LngLatBoundsLike,
} from "maplibre-gl";
import bbox from "@turf/bbox";
import { useQueryClient } from "@tanstack/vue-query";

const emit = defineEmits<{
  (e: "close"): void;
  (e: "created"): void;
  (e: "openGeoprocessing"): void;
  (e: "requestDraw"): void;
  (e: "requestSelectOlt", mode: "input" | "tower"): void;
}>();

const authStore = useAuth();
const toast = useToast();
const queryClient = useQueryClient();
const draftStore = useNewProjectDraft();
const {
  projectName,
  projectDescription,
  uploadedFile,
  parsedGeometry,
  currentStep,
  analysisResult,
  oltMode,
  oltCoordinates,
  oltTowers,
  oltTotalLines,
  oltLastLineFull,
} = storeToRefs(draftStore);

// Step management
const steps = [
  { number: 1, label: "Project Info" },
  { number: 2, label: "Select Area" },
  { number: 3, label: "Analysis" },
  { number: 4, label: "Start Point" },
  { number: 5, label: "Generate" },
];

const isDragging = ref(false);

// Step 3: Analysis (analysisResult lives in the draft store so it survives the
// modal being unmounted while the user picks start points)
const isAnalyzing = ref(false);
const analysisError = ref<string | null>(null);

const selectedCableType = ref<string | null>(null);

// Restore the auto-calculated cable type if the modal was remounted (e.g. after
// returning from picking start points) while an analysis result already exists.
onMounted(() => {
  if (!selectedCableType.value && analysisResult.value?.lines.length) {
    selectedCableType.value = analysisResult.value.lines[0].cable;
  }
});

const cableTypeOptions = computed(() => {
  if (!analysisResult.value || !analysisResult.value.lines.length) {
    return [];
  }
  return analysisResult.value.lines.map((line) => ({
    value: line.cable,
    label: `${line.cable} (for ${line.odc} ODC)`,
  }));
});

// Validation
const canProceedStep1 = computed(() => {
  return projectName.value.trim().length > 0;
});

const canProceedStep2 = computed(() => {
  return parsedGeometry.value !== null;
});

// Number of start points required, derived from the line analysis.
// The 90% "+1" buffer applies to both tower and draw-point (input) modes.
const requiredOltCount = computed(() => {
  return oltTotalLines.value + (oltLastLineFull.value ? 1 : 0);
});

const canProceedStartPoint = computed(() => {
  if (oltMode.value === "input")
    return oltCoordinates.value.length === requiredOltCount.value;
  if (oltMode.value === "tower")
    return oltTowers.value.length === requiredOltCount.value;
  return true; // "site" (default) — always allowed
});

const canGenerate = computed(() => {
  return analysisResult.value !== null;
});

// OLT start point helpers
const setOltMode = (mode: "site" | "input" | "tower") => {
  oltMode.value = mode;
  if (mode === "site") draftStore.resetOltSelection();
};

const clearOltSelection = () => {
  draftStore.resetOltSelection();
};

const geometrySource = computed<"file" | "drawn" | null>(() => {
  if (!parsedGeometry.value) return null;
  return uploadedFile.value ? "file" : "drawn";
});

// File upload handlers
const handleDragOver = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = true;
};

const handleDragLeave = () => {
  isDragging.value = false;
};

const handleDrop = (e: DragEvent) => {
  e.preventDefault();
  isDragging.value = false;
  const files = e.dataTransfer?.files;
  if (files && files.length > 0) {
    handleFileSelect(files[0]);
  }
};

// Parse GeoJSON file
const parseGeoJSON = async (file: File): Promise<any> => {
  const text = await file.text();
  const geojson = JSON.parse(text);

  if (geojson.type === "FeatureCollection" && geojson.features?.length > 0) {
    const feature = geojson.features[0];
    if (
      feature.geometry &&
      (feature.geometry.type === "Polygon" ||
        feature.geometry.type === "MultiPolygon")
    ) {
      return feature.geometry;
    }
  } else if (geojson.type === "Feature" && geojson.geometry) {
    if (
      geojson.geometry.type === "Polygon" ||
      geojson.geometry.type === "MultiPolygon"
    ) {
      return geojson.geometry;
    }
  } else if (geojson.type === "Polygon" || geojson.type === "MultiPolygon") {
    return geojson;
  }

  throw new Error("No valid Polygon or MultiPolygon geometry found in file");
};

// Parse KML file
const parseKML = async (file: File): Promise<any> => {
  const text = await file.text();
  const parser = new DOMParser();
  const kml = parser.parseFromString(text, "text/xml");

  const geojson = tj.kml(kml);

  if (geojson.features?.length > 0) {
    for (const feature of geojson.features) {
      if (
        feature.geometry &&
        (feature.geometry.type === "Polygon" ||
          feature.geometry.type === "MultiPolygon")
      ) {
        return feature.geometry;
      }
    }
  }

  throw new Error("No valid Polygon geometry found in KML file");
};

const handleFileSelect = async (file: File) => {
  const allowedTypes = [".geojson", ".json", ".kml"];
  const fileExtension = "." + file.name.split(".").pop()?.toLowerCase();

  if (!allowedTypes.includes(fileExtension)) {
    toast.add({
      title: "Invalid File",
      description: "Please upload a valid GeoJSON or KML file",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
    return;
  }

  try {
    let geometry: any;

    if (fileExtension === ".kml") {
      geometry = await parseKML(file);
    } else {
      geometry = await parseGeoJSON(file);
    }

    uploadedFile.value = file;
    parsedGeometry.value = geometry;

    toast.add({
      title: "File Uploaded",
      description: "Geometry parsed successfully",
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
  } catch (error: any) {
    console.error("Error parsing file:", error);
    toast.add({
      title: "Parse Error",
      description: error.message || "Failed to parse file",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
    uploadedFile.value = null;
    parsedGeometry.value = null;
  }
};

const triggerFileInput = () => {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".geojson,.json,.kml";
  input.onchange = (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) handleFileSelect(file);
  };
  input.click();
};

const removeFile = () => {
  uploadedFile.value = null;
  parsedGeometry.value = null;
};

const clearDrawnGeometry = () => {
  parsedGeometry.value = null;
};

const requestDraw = () => {
  emit("requestDraw");
};

// Area Analysis API call
const fetchAreaAnalysis = async () => {
  if (!parsedGeometry.value) {
    analysisError.value = "No geometry available for analysis";
    return;
  }

  isAnalyzing.value = true;
  analysisError.value = null;

  try {
    const response = await $fetch<{
      data: {
        total_rumah: number;
        total_odc: number;
        total_lines: number;
        lines: Array<{ line: number; odc: number; cable: string }>;
      };
    }>("/panel/ftth-process/area-analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: {
        name: projectName.value,
        description: projectDescription.value || null,
        geometry: parsedGeometry.value,
      },
    });

    analysisResult.value = {
      totalHomes: response.data.total_rumah,
      odcNeeded: response.data.total_odc,
      totalLines: response.data.total_lines,
      lines: response.data.lines,
    };

    if (response.data.lines.length > 0) {
      selectedCableType.value = response.data.lines[0].cable;
    }

    // Derive how many OLT start points are required from the line result.
    const totalLines = response.data.total_lines;
    const lastOdc = totalLines > 0 ? response.data.lines[totalLines - 1].odc : 0;
    oltTotalLines.value = totalLines;
    oltLastLineFull.value = totalLines > 0 && lastOdc / 288 >= 0.9;
    // Re-running the analysis invalidates any prior start point picks
    draftStore.resetOltSelection();
  } catch (error: any) {
    console.error("Error fetching area analysis:", error);
    analysisError.value =
      error.data?.message || "Failed to analyze area. Please try again.";
    toast.add({
      title: "Analysis Error",
      description: analysisError.value,
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
  } finally {
    isAnalyzing.value = false;
  }
};

// Navigation
const nextStep = async () => {
  if (currentStep.value === 2) {
    currentStep.value = 3;
    await fetchAreaAnalysis();
  } else if (currentStep.value < 5) {
    currentStep.value++;
  }
};

const prevStep = () => {
  if (currentStep.value > 1) {
    // Leaving the Generate/Analysis step (3 -> 2) drops the analysis result
    if (currentStep.value === 3) {
      analysisResult.value = null;
      analysisError.value = null;
      draftStore.resetOltSelection();
    }
    currentStep.value--;
  }
};

const closeModal = () => {
  emit("close");
};

// Generate network
const isGenerating = ref(false);

const generateNetwork = async () => {
  if (!parsedGeometry.value) {
    toast.add({
      title: "Error",
      description: "No geometry available for network generation",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
    return;
  }

  isGenerating.value = true;
  try {
    const body: Record<string, any> = {
      name: projectName.value,
      description: projectDescription.value || null,
      olt_mode: oltMode.value,
      geometry: parsedGeometry.value,
    };
    if (oltMode.value === "tower" && oltTowers.value.length) {
      body.tower_ids = oltTowers.value.map((t) => t.id);
    } else if (oltMode.value === "input" && oltCoordinates.value.length) {
      body.coordinates = oltCoordinates.value;
    }

    await $fetch("/panel/ftth-process/generate-network", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body,
    });

    toast.add({
      title: "Success",
      description: "Process running, check geoprocessing panel",
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });

    emit("created");
    emit("openGeoprocessing");
    emit("close");
    queryClient.refetchQueries({
      queryKey: ["geoprocessing_queue_query_key"],
      type: "active",
      exact: true,
    });
  } catch (error: any) {
    console.error("Error generating network:", error);
    toast.add({
      title: "Error",
      description:
        error.data?.message || "Failed to generate network. Please try again.",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
  } finally {
    isGenerating.value = false;
  }
};

// Preview map
const isPreviewOpen = ref(false);
const previewMapContainer = ref<HTMLElement | null>(null);
let previewMap: MaplibreMap | null = null;

const openPreview = async () => {
  if (!parsedGeometry.value) return;
  isPreviewOpen.value = true;

  await nextTick();

  if (!previewMapContainer.value) return;

  const style: StyleSpecification = {
    version: 8,
    sources: {
      "basemap-sources": {
        type: "raster",
        tiles: ["https://mt0.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}"],
        tileSize: 256,
      },
    },
    glyphs: "/font/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "basemap-tiles",
        type: "raster",
        source: "basemap-sources",
        minzoom: 0,
        maxzoom: 24,
      },
    ],
  };

  previewMap = new MaplibreMap({
    container: previewMapContainer.value,
    style,
    center: [118.0, -2.5],
    zoom: 4,
    maxZoom: 18,
  });

  previewMap.on("load", () => {
    if (!previewMap || !parsedGeometry.value) return;

    const geojsonData = {
      type: "FeatureCollection" as const,
      features: [
        {
          type: "Feature" as const,
          properties: {},
          geometry: parsedGeometry.value,
        },
      ],
    };

    previewMap.addSource("preview-area", {
      type: "geojson",
      data: geojsonData,
    });

    previewMap.addLayer({
      id: "preview-fill",
      type: "fill",
      source: "preview-area",
      paint: {
        "fill-color": "#7C3AED",
        "fill-opacity": 0.2,
      },
    });

    previewMap.addLayer({
      id: "preview-outline",
      type: "line",
      source: "preview-area",
      paint: {
        "line-color": "#7C3AED",
        "line-width": 2,
        "line-opacity": 0.8,
      },
    });

    const bounds = bbox(geojsonData) as LngLatBoundsLike;
    previewMap.fitBounds(bounds, {
      padding: 80,
      duration: 1000,
    });
  });
};

const closePreview = () => {
  if (previewMap) {
    previewMap.remove();
    previewMap = null;
  }
  isPreviewOpen.value = false;
};

onUnmounted(() => {
  if (previewMap) {
    previewMap.remove();
    previewMap = null;
  }
});
</script>

<template>
  <div class="bg-white rounded-lg w-full max-w-lg">
    <!-- Header -->
    <div class="flex items-center justify-between p-4 border-b">
      <div class="flex items-center gap-2">
        <UIcon name="i-heroicons-squares-2x2" class="w-5 h-5 text-brand-500" />
        <h2 class="text-lg font-semibold text-grey-900">
          {{
            currentStep === 1
              ? "Create New Project"
              : currentStep === 2
                ? "Select Area of Interest"
                : currentStep === 3
                  ? "Network Analysis"
                  : currentStep === 4
                    ? "Select Start Point (OLT)"
                    : "Generate FTTH Network"
          }}
        </h2>
      </div>
      <button @click="closeModal" class="text-grey-400 hover:text-grey-600">
        <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
      </button>
    </div>

    <!-- Stepper -->
    <div class="px-6 py-4">
      <div class="flex items-center justify-center">
        <template v-for="(step, index) in steps" :key="step.number">
          <div class="flex items-center">
            <div
              :class="[
                'w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium',
                currentStep === step.number
                  ? 'bg-brand-500 text-white'
                  : currentStep > step.number
                    ? 'bg-green-500 text-white'
                    : 'bg-grey-200 text-grey-500',
              ]"
            >
              <template v-if="currentStep > step.number">
                <UIcon name="i-heroicons-check" class="w-4 h-4" />
              </template>
              <template v-else>
                {{ step.number }}
              </template>
            </div>
            <span
              v-if="currentStep === step.number"
              class="ml-2 text-sm text-brand-500 font-medium whitespace-nowrap"
            >
              {{ step.label }}
            </span>
          </div>
          <div
            v-if="index < steps.length - 1"
            :class="[
              'w-8 h-0.5 mx-2',
              currentStep > step.number ? 'bg-green-500' : 'bg-grey-200',
            ]"
          ></div>
        </template>
      </div>
    </div>

    <!-- Content -->
    <div class="px-6 pb-6">
      <!-- Step 1: Project Info -->
      <div v-if="currentStep === 1" class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-grey-700 mb-1">
            Project Name
          </label>
          <UInput
            v-model="projectName"
            placeholder="Enter project name..."
            :ui="{ rounded: 'rounded-xs' }"
          />
        </div>
        <div>
          <label class="block text-sm font-medium text-grey-700 mb-1">
            Description (Optional)
          </label>
          <UTextarea
            v-model="projectDescription"
            placeholder="Enter description..."
            :ui="{ rounded: 'rounded-xs' }"
            :rows="3"
          />
        </div>
      </div>

      <!-- Step 2: Select Area -->
      <div v-if="currentStep === 2" class="space-y-4">
        <!-- File Upload -->
        <div
          :class="[
            'border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors',
            isDragging
              ? 'border-brand-500 bg-brand-50'
              : 'border-grey-300 hover:border-grey-400',
          ]"
          @dragover="handleDragOver"
          @dragleave="handleDragLeave"
          @drop="handleDrop"
          @click="triggerFileInput"
        >
          <template v-if="!uploadedFile">
            <UIcon
              name="i-heroicons-cloud-arrow-up"
              class="w-12 h-12 text-brand-500 mx-auto mb-3"
            />
            <p class="text-sm font-medium text-grey-900">Upload AOI File</p>
            <p class="text-xs text-grey-500 mt-1">
              Drag & drop or click to upload
            </p>
            <p class="text-xs text-grey-400">GeoJSON or KML file</p>
          </template>
          <template v-else>
            <div class="flex items-center justify-center gap-2">
              <UIcon
                name="i-heroicons-document-check"
                class="w-8 h-8 text-green-500"
              />
              <div class="text-left">
                <p class="text-sm font-medium text-grey-900">
                  {{ uploadedFile.name }}
                </p>
                <p class="text-xs text-grey-500">
                  {{ (uploadedFile.size / 1024).toFixed(1) }} KB
                </p>
              </div>
              <button
                @click.stop="removeFile"
                class="ml-2 text-red-500 hover:text-red-700"
              >
                <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
              </button>
            </div>
          </template>
        </div>

        <!-- OR Divider -->
        <div class="flex items-center gap-4">
          <div class="flex-1 border-t border-grey-200"></div>
          <span class="text-sm text-grey-400">OR</span>
          <div class="flex-1 border-t border-grey-200"></div>
        </div>

        <!-- Draw on Map trigger -->
        <UButton
          block
          color="primary"
          variant="soft"
          size="md"
          :ui="{ rounded: 'rounded-xs' }"
          @click="requestDraw"
        >
          <UIcon name="i-heroicons-pencil-square" class="w-4 h-4 mr-2" />
          {{
            geometrySource === "drawn" ? "Edit Drawing on Map" : "Draw on Map"
          }}
        </UButton>

        <!-- Drawn-geometry status -->
        <div
          v-if="geometrySource === 'drawn'"
          class="bg-green-50 border border-green-200 rounded-xs p-3 flex items-center justify-between"
        >
          <div class="flex items-center gap-2">
            <UIcon
              name="i-heroicons-check-circle"
              class="w-5 h-5 text-green-600"
            />
            <span class="text-sm text-green-700">
              Geometry ready (drawn on map)
            </span>
          </div>
          <button
            type="button"
            class="text-xs text-red-600 hover:text-red-800"
            @click="clearDrawnGeometry"
          >
            Clear
          </button>
        </div>
      </div>

      <!-- Step 4: Start Point (OLT) -->
      <div v-if="currentStep === 4" class="space-y-4">
        <p class="text-sm text-grey-500">
          Choose where the network starts. Leave the default to let the system
          pick the optimal site.
        </p>
        <p v-if="oltMode !== 'site'" class="text-xs text-grey-600">
          This network needs
          <span class="font-semibold text-grey-800">{{ requiredOltCount }}</span>
          start point{{ requiredOltCount === 1 ? "" : "s" }}.
        </p>

        <!-- Option: Use Site (default) -->
        <button
          type="button"
          :class="[
            'w-full text-left px-3 py-2.5 rounded-xxs border transition-colors',
            oltMode === 'site'
              ? 'bg-brand-50 border-brand-500'
              : 'bg-white border-grey-200 hover:border-grey-300',
          ]"
          @click="setOltMode('site')"
        >
          <div class="flex items-center gap-2">
            <UIcon
              name="i-heroicons-sparkles"
              :class="[
                'w-4 h-4',
                oltMode === 'site' ? 'text-brand-600' : 'text-grey-400',
              ]"
            />
            <span
              :class="[
                'text-sm font-medium',
                oltMode === 'site' ? 'text-brand-600' : 'text-grey-700',
              ]"
            >
              Use Site (Default)
            </span>
          </div>
          <p class="text-xs text-grey-500 mt-0.5 ml-6">
            Automatically choose the start site.
          </p>
        </button>

        <!-- Option: Select on Map -->
        <div
          :class="[
            'rounded-xxs border transition-colors',
            oltMode === 'input'
              ? 'bg-brand-50 border-brand-500'
              : 'bg-white border-grey-200',
          ]"
        >
          <button
            type="button"
            class="w-full text-left px-3 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="oltTotalLines === 0"
            @click="setOltMode('input')"
          >
            <div class="flex items-center gap-2">
              <UIcon
                name="i-heroicons-map-pin"
                :class="[
                  'w-4 h-4',
                  oltMode === 'input' ? 'text-brand-600' : 'text-grey-400',
                ]"
              />
              <span
                :class="[
                  'text-sm font-medium',
                  oltMode === 'input' ? 'text-brand-600' : 'text-grey-700',
                ]"
              >
                Select on Map
              </span>
            </div>
            <p class="text-xs text-grey-500 mt-0.5 ml-6">
              Draw the start point(s) on the map.
            </p>
          </button>
          <div v-if="oltMode === 'input'" class="px-3 pb-3 space-y-2">
            <p class="text-xs text-grey-500">
              <span class="font-medium text-grey-700">
                {{ oltCoordinates.length }}/{{ requiredOltCount }}
              </span>
              point(s) selected
            </p>
            <UButton
              block
              color="primary"
              variant="soft"
              size="sm"
              :ui="{ rounded: 'rounded-xxs' }"
              @click="emit('requestSelectOlt', 'input')"
            >
              <UIcon name="i-heroicons-pencil-square" class="w-4 h-4 mr-2" />
              {{ oltCoordinates.length ? "Edit Points on Map" : "Pick Points on Map" }}
            </UButton>
            <div v-if="oltCoordinates.length" class="space-y-1">
              <div
                v-for="(c, i) in oltCoordinates"
                :key="i"
                class="bg-green-50 border border-green-200 rounded-xxs p-2 text-xs text-green-700"
              >
                Point {{ i + 1 }}: {{ c[0].toFixed(5) }}, {{ c[1].toFixed(5) }}
              </div>
              <button
                type="button"
                class="text-xs text-red-600 hover:text-red-800"
                @click="clearOltSelection"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>

        <!-- Option: Select Tower -->
        <div
          :class="[
            'rounded-xxs border transition-colors',
            oltMode === 'tower'
              ? 'bg-brand-50 border-brand-500'
              : 'bg-white border-grey-200',
          ]"
        >
          <button
            type="button"
            class="w-full text-left px-3 py-2.5 disabled:opacity-50 disabled:cursor-not-allowed"
            :disabled="oltTotalLines === 0"
            @click="setOltMode('tower')"
          >
            <div class="flex items-center gap-2">
              <UIcon
                name="i-heroicons-signal"
                :class="[
                  'w-4 h-4',
                  oltMode === 'tower' ? 'text-brand-600' : 'text-grey-400',
                ]"
              />
              <span
                :class="[
                  'text-sm font-medium',
                  oltMode === 'tower' ? 'text-brand-600' : 'text-grey-700',
                ]"
              >
                Select Tower
              </span>
            </div>
            <p class="text-xs text-grey-500 mt-0.5 ml-6">
              Pick existing tower(s) from the FTTH tower layer.
            </p>
          </button>
          <div v-if="oltMode === 'tower'" class="px-3 pb-3 space-y-2">
            <p class="text-xs text-grey-500">
              <span class="font-medium text-grey-700">
                {{ oltTowers.length }}/{{ requiredOltCount }}
              </span>
              tower(s) selected
            </p>
            <UButton
              block
              color="primary"
              variant="soft"
              size="sm"
              :ui="{ rounded: 'rounded-xxs' }"
              @click="emit('requestSelectOlt', 'tower')"
            >
              <UIcon name="i-heroicons-cursor-arrow-rays" class="w-4 h-4 mr-2" />
              {{ oltTowers.length ? "Change Towers" : "Select Towers on Map" }}
            </UButton>
            <div v-if="oltTowers.length" class="space-y-1">
              <div
                v-for="(t, i) in oltTowers"
                :key="i"
                class="bg-green-50 border border-green-200 rounded-xxs p-2 text-xs text-green-700"
              >
                Tower {{ i + 1 }}: {{ t.label }}
              </div>
              <button
                type="button"
                class="text-xs text-red-600 hover:text-red-800"
                @click="clearOltSelection"
              >
                Clear all
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 3: Analysis -->
      <div v-if="currentStep === 3" class="space-y-4">
        <!-- Loading State -->
        <div v-if="isAnalyzing" class="text-center py-8">
          <UIcon
            name="i-heroicons-arrow-path"
            class="w-12 h-12 text-brand-500 mx-auto mb-3 animate-spin"
          />
          <p class="text-sm font-medium text-grey-700">Analyzing area...</p>
          <p class="text-xs text-grey-500 mt-1">This may take a few moments</p>
        </div>

        <!-- Error State -->
        <div
          v-else-if="analysisError"
          class="bg-red-50 border border-red-200 rounded-lg p-4 text-center"
        >
          <UIcon
            name="i-heroicons-exclamation-triangle"
            class="w-10 h-10 text-red-500 mx-auto mb-2"
          />
          <p class="text-sm font-medium text-red-700">Analysis Failed</p>
          <p class="text-xs text-red-600 mt-1">{{ analysisError }}</p>
          <UButton
            size="sm"
            color="red"
            variant="soft"
            class="mt-3"
            @click="fetchAreaAnalysis"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-4 h-4 mr-1" />
            Retry
          </UButton>
        </div>

        <!-- Analysis Result -->
        <template v-else-if="analysisResult">
          <div class="bg-green-50 border border-green-200 rounded-xxs p-4">
            <div class="flex items-center gap-2 mb-3">
              <UIcon
                name="i-heroicons-check-circle"
                class="w-5 h-5 text-green-600"
              />
              <span class="text-sm font-medium text-green-700">
                Area Analysis Complete
              </span>
            </div>
            <div class="grid grid-cols-3 gap-4 text-center">
              <div>
                <p class="text-2xl font-bold text-green-600">
                  {{ analysisResult.totalHomes.toLocaleString() }}
                </p>
                <p class="text-xs text-grey-600">Total Footprint</p>
              </div>
              <div>
                <p class="text-2xl font-bold text-green-600">
                  {{ analysisResult.odcNeeded }}
                </p>
                <p class="text-xs text-grey-600">ODC Needed</p>
              </div>
              <div>
                <p class="text-2xl font-bold text-green-600">
                  {{ analysisResult.totalLines }}
                </p>
                <p class="text-xs text-grey-600">Total Lines</p>
              </div>
            </div>
          </div>

          <UButton
            size="sm"
            color="primary"
            variant="soft"
            class="cursor-pointer"
            block
            :ui="{ rounded: 'rounded-xxs' }"
            :disabled="!parsedGeometry"
            @click="openPreview"
          >
            <UIcon name="i-heroicons-map" class="w-4 h-4 mr-1" />
            Preview Area
          </UButton>

          <div v-if="analysisResult.lines.length > 0" class="space-y-2">
            <p class="text-sm font-medium text-grey-700">Cable Requirements</p>
            <div class="border rounded-xxs divide-y">
              <div
                v-for="line in analysisResult.lines"
                :key="line.line"
                class="p-3 flex justify-between items-center text-sm"
              >
                <span class="text-grey-600">Line {{ line.line }}</span>
                <div class="flex items-center gap-4">
                  <span class="text-grey-500">{{ line.odc }} ODC</span>
                  <span
                    class="px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-medium"
                  >
                    {{ line.cable }}
                  </span>
                </div>
              </div>
            </div>
          </div>

          <div>
            <label class="block text-sm font-medium text-grey-700 mb-1">
              Cable Type (Auto-calculated)
            </label>
            <USelectMenu
              v-model="selectedCableType"
              :options="cableTypeOptions"
              placeholder="Select cable type..."
              value-attribute="value"
              option-attribute="label"
              disabled
              :ui="{ rounded: 'rounded-xs' }"
            />
          </div>
        </template>
      </div>

      <!-- Step 5: Generate -->
      <div v-if="currentStep === 5" class="space-y-4">
        <div class="bg-grey-50 border border-grey-200 rounded-xxs p-4 space-y-1">
          <div class="flex items-center gap-2">
            <UIcon name="i-heroicons-cpu-chip" class="w-5 h-5 text-brand-500" />
            <span class="text-sm font-medium text-grey-800">
              Ready to Generate
            </span>
          </div>
          <p class="text-xs text-grey-600">
            Review the summary and start network generation.
          </p>
        </div>

        <div class="border rounded-xxs divide-y text-sm">
          <div class="p-3 flex justify-between items-center">
            <span class="text-grey-500">Project</span>
            <span class="text-grey-800 font-medium">{{ projectName }}</span>
          </div>
          <div class="p-3 flex justify-between items-center">
            <span class="text-grey-500">Total Lines</span>
            <span class="text-grey-800">{{
              analysisResult?.totalLines ?? "-"
            }}</span>
          </div>
          <div class="p-3 flex justify-between items-center">
            <span class="text-grey-500">ODC Needed</span>
            <span class="text-grey-800">{{
              analysisResult?.odcNeeded ?? "-"
            }}</span>
          </div>
          <div class="p-3 flex justify-between items-center">
            <span class="text-grey-500">Start Point</span>
            <span class="text-grey-800">
              {{
                oltMode === "site"
                  ? "Auto (Site)"
                  : oltMode === "tower"
                    ? `${oltTowers.length} tower(s)`
                    : `${oltCoordinates.length} point(s)`
              }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="flex items-center justify-end gap-3 p-4 border-t">
      <UButton
        v-if="currentStep === 1"
        color="gray"
        variant="ghost"
        @click="closeModal"
        :ui="{ rounded: 'rounded-xs' }"
      >
        Cancel
      </UButton>
      <UButton
        v-else
        color="gray"
        variant="ghost"
        @click="prevStep"
        :disabled="isAnalyzing"
        :ui="{ rounded: 'rounded-xs' }"
      >
        Back
      </UButton>

      <UButton
        v-if="currentStep < 5"
        color="primary"
        :disabled="
          (currentStep === 1 && !canProceedStep1) ||
          (currentStep === 2 && !canProceedStep2) ||
          (currentStep === 3 && (!canGenerate || isAnalyzing)) ||
          (currentStep === 4 && !canProceedStartPoint)
        "
        @click="nextStep"
        :ui="{ rounded: 'rounded-xs' }"
      >
        Next
        <template #trailing>
          <UIcon name="i-heroicons-arrow-right" class="w-4 h-4" />
        </template>
      </UButton>
      <UButton
        v-else
        color="green"
        :disabled="!canGenerate || !canProceedStartPoint"
        :loading="isGenerating"
        @click="generateNetwork"
        :ui="{ rounded: 'rounded-xs' }"
      >
        <template #leading>
          <UIcon name="i-heroicons-cpu-chip" class="w-4 h-4" />
        </template>
        Generate Network
      </UButton>
    </div>

    <!-- Fullscreen Preview Modal -->
    <UModal v-model="isPreviewOpen" fullscreen prevent-close>
      <div class="h-full flex flex-col">
        <div class="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <h3 class="text-sm font-medium text-black">Area Preview</h3>
            <p class="text-[10px] text-grey-500">{{ projectName }}</p>
          </div>
          <button
            @click="closePreview"
            class="text-grey-500 hover:text-grey-700 transition-colors"
          >
            <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
          </button>
        </div>
        <div ref="previewMapContainer" class="flex-1" />
      </div>
    </UModal>
  </div>
</template>
