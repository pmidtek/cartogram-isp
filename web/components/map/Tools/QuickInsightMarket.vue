<script lang="ts" setup>
import { ref } from "vue";
import maplibregl from "maplibre-gl";

import IcSpinner from "~/assets/icons/ic-spinner.svg";
import { useToast } from "#imports";
import { load } from "@loaders.gl/core";
import { KMLLoader } from "@loaders.gl/kml";
import FilePicker from "~/components/core/FilePicker.vue";
import GeojsonWorker from "~/utils/worker/geojson?worker";
import ShapefileWorker from "~/utils/worker/shapefile?worker";
import SheetsWorker from "~/utils/worker/sheets?worker";
import KmlWorker from "~/utils/worker/kml?worker";
import GpxWorker from "~/utils/worker/gpx?worker";
import TcxWorker from "~/utils/worker/tcx?worker";
import GeopackageWorker from "~/utils/worker/geopackage?worker";
import FlatgeobufWorker from "~/utils/worker/flatgeobuf?worker";

import {
  geomTypeCircle,
  geomTypeLine,
  geomTypePolygon,
  uncategorizedLoadedData,
} from "~/constants";

interface IParseResult {
  geojsonObj: GeoJSON.GeoJSON;
  bounds: GeoJSON.Polygon;
}
interface IParseResultWithFileName extends IParseResult {
  fileName: string;
}

interface DataResult {
  class_ts: string | null;
  count: string;
}

const selectedFile = ref<File | null>(null);
const datasetName = ref<HTMLInputElement | null>(null);
const datasetDesc = ref<HTMLInputElement | null>(null);
const thumbnailFile = ref<File | null>(null);

const selectedOption = ref<string>("KML");
const optionUpload = ["KML"];
const toast = useToast();
const kmlData = ref<any>(null);
const selectedKmlFeatures = ref<string[]>([]);
const selectedCategories = ref<string[]>([]);
const analysisName = ref<string>("");
const showKmlSelector = ref(false);
const isLoading = ref(false);
const uploading = ref(false);
const uploaded = ref(false);
const isAnalyzing = ref(false);
const isQueued = ref(false);
const currentMessageId = ref<string | null>(null);
const authStore = useAuth();
const digitizeStore = useDigitizeStore();
const featureStore = useFeature();
const analysisStore = useAnalysisResult();
const { addLoadedGeoJsonData } = useIDB();
const mapStore = useMapRef();
const { map } = storeToRefs(mapStore);

const categoryOptions = [
  { label: "Government Office", value: "government_office" },
  { label: "Hospital", value: "hospital" },
  { label: "Hospital Emergency Room", value: "hospital_emergency_room" },
  { label: "Market", value: "market" },
  { label: "Medical Services", value: "medical_services" },
  { label: "School", value: "school" },
];

const fileTypeMappings: Record<string, string[]> = {
  KML: [".kml"],
  SHP: [".zip", ".rar"],
  GeoJson: [".json", ".geojson"],
};

const showToast = (
  message: string,
  type: "error" | "success" | "info" = "info",
) => {
  toast.add({
    title:
      type === "error"
        ? "Error Uploading File"
        : type === "success"
          ? "Success Uploading File"
          : "",
    description: message,
    icon: "i-heroicons-information-circle",
    ui: {
      background: "bg-white",
      title: "text-gray-900 text-md font-semibold",
      description: "text-gray-500",
      icon: "text-red-500",
    },
  });
};

// Updated function to safely extract feature name
const getFeatureName = (feature: any): string => {
  return (
    feature.properties?.name ||
    feature.properties?.Name ||
    feature.properties?.title ||
    feature.properties?.Title ||
    feature.id ||
    "Unnamed Feature"
  );
};

const extractUniqueFeatures = (features: any[]) => {
  const uniqueFeatures = new Map();

  features.forEach((feature, index) => {
    if (!feature.geometry) {
      console.warn(`Feature at index ${index} has no geometry, skipping...`);
      return;
    }

    const geometryType = feature.geometry.type;
    if (geometryType !== "Polygon" && geometryType !== "MultiPolygon") {
      return;
    }

    const name = getFeatureName(feature);

    if (!uniqueFeatures.has(name)) {
      uniqueFeatures.set(name, {
        name,
        geometryType,
        originalFeature: feature,
      });
    }
  });

  return Array.from(uniqueFeatures.values());
};

const processKmlFile = async (file: File) => {
  try {
    isLoading.value = true;
    const data = await load(file, KMLLoader);

    if (!data || !Array.isArray(data.features)) {
      throw new Error("Invalid KML data structure");
    }

    const processedFeatures = extractUniqueFeatures(data.features);
    kmlData.value = {
      features: processedFeatures,
      originalData: data,
    };

    if (processedFeatures.length > 0) {
      showKmlSelector.value = true;
      selectedKmlFeatures.value = [];
    } else {
      showToast("No valid features found in KML file", "error");
    }
  } catch (error) {
    showToast(
      `Error processing KML file: ${
        error instanceof Error ? error.message : "Unknown error"
      }`,
      "error",
    );
    console.error(error);
  } finally {
    isLoading.value = false;
  }
};

const handleFileUpload = async (files: FileList | null) => {
  if (!selectedOption.value) {
    showToast("Please select a data type before uploading a file", "error");
    return;
  }

  if (!files || files.length === 0) {
    showToast("No file selected", "error");
    return;
  }

  const file = files[0];
  const fileExtension = `.${file.name.split(".").pop()?.toLowerCase()}`;
  selectedFile.value = file;

  const allowedExtensions = fileTypeMappings[selectedOption.value];
  if (!allowedExtensions.includes(fileExtension)) {
    showToast(
      `Invalid file format for ${
        selectedOption.value
      }. Please upload ${allowedExtensions.join(" or ")} file.`,
      "error",
    );
    return;
  }

  if (selectedOption.value === "KML") {
    await processKmlFile(file);
  } else {
    showToast(`Successfully uploaded: ${file.name}`, "success");
  }
};

const toggleSelection = (layer: string) => {
  selectedOption.value = selectedOption.value === layer ? "" : layer;
  if (selectedOption.value) {
    showToast(
      `Selected format: ${layer}. Please upload a ${fileTypeMappings[
        layer
      ].join(" or ")} file.`,
      "info",
    );
  }
  showKmlSelector.value = false;
  kmlData.value = null;
  selectedKmlFeatures.value = [];
};

const toggleKmlFeature = (featureName: string) => {
  const index = selectedKmlFeatures.value.indexOf(featureName);
  if (index === -1) {
    selectedKmlFeatures.value.push(featureName);
  } else {
    selectedKmlFeatures.value.splice(index, 1);
  }
};

const resetSelections = () => {
  selectedOption.value = "";
  showKmlSelector.value = false;
  kmlData.value = null;
  selectedKmlFeatures.value = [];
  selectedCategories.value = [];

  // Remove preview layer from map if it exists
  if (map.value) {
    const previewLayerId = "kml-preview-layer";
    const previewStrokeLayerId = "kml-preview-stroke-layer";

    if (map.value.getLayer(previewLayerId)) {
      map.value.removeLayer(previewLayerId);
    }
    if (map.value.getLayer(previewStrokeLayerId)) {
      map.value.removeLayer(previewStrokeLayerId);
    }
    if (map.value.getSource(previewLayerId)) {
      map.value.removeSource(previewLayerId);
    }
  }

  showToast("All selections have been reset", "info");
};

const handlePreviewData = () => {
  if (!kmlData.value || !selectedKmlFeatures.value.length) {
    toast.add({
      title: "No Data to Preview",
      description: "Please upload a KML file and select features first",
      icon: "i-heroicons-information-circle",
    });
    return;
  }

  try {
    const selectedFeatures = kmlData.value.features
      .filter((feature) => selectedKmlFeatures.value.includes(feature.name))
      .map((feature) => feature.originalFeature);

    if (!selectedFeatures.length) {
      toast.add({
        title: "No Features Selected",
        description: "Please select at least one feature to preview",
        icon: "i-heroicons-information-circle",
      });
      return;
    }

    const geojsonData = {
      type: "FeatureCollection",
      features: selectedFeatures.map((feature: any) => ({
        type: "Feature",
        geometry: {
          type: feature.geometry.type,
          coordinates: feature.geometry.coordinates,
        },
        properties: feature.properties || {},
      })),
    };

    console.log(geojsonData);
    const previewLayerId = "kml-preview-layer";
    const previewStrokeLayerId = "kml-preview-stroke-layer";

    // Remove existing preview layers
    if (map.value?.getLayer(previewLayerId)) {
      map.value.removeLayer(previewLayerId);
    }
    if (map.value?.getLayer(previewStrokeLayerId)) {
      map.value.removeLayer(previewStrokeLayerId);
    }
    if (map.value?.getSource(previewLayerId)) {
      map.value.removeSource(previewLayerId);
    }

    // Add source
    map.value?.addSource(previewLayerId, {
      type: "geojson",
      data: geojsonData as any,
    });

    // Add fill layer
    map.value?.addLayer({
      id: previewLayerId,
      type: "fill",
      source: previewLayerId,
      layout: {},
      paint: {
        "fill-color": "#3B82F6",
        "fill-opacity": 0.3,
      },
    });

    // Add stroke layer
    map.value?.addLayer({
      id: previewStrokeLayerId,
      type: "line",
      source: previewLayerId,
      layout: {},
      paint: {
        "line-color": "#2563EB",
        "line-width": 2,
        "line-opacity": 1,
      },
    });

    // Calculate bounds and fly to the features
    const coordinates = geojsonData.features.flatMap((feature: any) => {
      if (feature.geometry.type === "Polygon") {
        return feature.geometry.coordinates[0];
      } else if (feature.geometry.type === "MultiPolygon") {
        return feature.geometry.coordinates.flatMap((poly: any) => poly[0]);
      }
      return [];
    });

    if (coordinates.length > 0) {
      // Calculate center point from all coordinates
      const lngs = coordinates.map((coord: any) => coord[0]);
      const lats = coordinates.map((coord: any) => coord[1]);

      const minLng = Math.min(...lngs);
      const maxLng = Math.max(...lngs);
      const minLat = Math.min(...lats);
      const maxLat = Math.max(...lats);

      const centerLng = (minLng + maxLng) / 2;
      const centerLat = (minLat + maxLat) / 2;

      console.log("Flying to:", centerLng, centerLat);

      // Fly to center of the polygon
      map.value?.flyTo({
        center: [centerLng, centerLat],
        padding: {
          bottom: 300,
        },
        zoom: 14,
        duration: 2000,
        essential: true,
      });
    }

    toast.add({
      title: "Preview Loaded",
      description: `Showing ${selectedFeatures.length} feature(s) on the map`,
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
  } catch (error: any) {
    toast.add({
      title: "Preview Failed",
      description: error?.message || "Failed to preview data",
      icon: "i-heroicons-x-circle",
    });
    console.error(error);
  }
};

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
      // Get poi_insight_result_id from result
      const poiInsightResultId = result?.poi_insight_result_id;

      if (poiInsightResultId) {
        // Fetch the actual result data
        const poiResponse = await $fetch<{ data: any }>(
          `/panel/items/poi_insight_result/${poiInsightResultId}`,
          {
            headers: {
              Authorization: `Bearer ${authStore.accessToken}`,
            },
          },
        );

        // Store the result data for POI Insight analysis panel
        analysisStore.setQmiResultData(poiResponse.data);
        analysisStore.setCurrentAnalysisType("poi_insight_analysis");

        toast.add({
          title: "Analysis Complete",
          description: "POI Insight results are ready to view",
          icon: "i-heroicons-check-circle",
          ui: {
            background: "bg-white",
            title: "text-gray-900 text-md font-semibold",
            description: "text-gray-500",
            icon: "text-red-500",
          },
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
      });
      isAnalyzing.value = false;
      isQueued.value = false;
      currentMessageId.value = null;
    } else {
      // Still processing, poll again after 1 second
      setTimeout(() => pollQueueStatus(messageId), 1000);
    }
  } catch (error: any) {
    toast.add({
      title: "Error",
      description: error?.data?.message || "Failed to check queue status",
      icon: "i-heroicons-x-circle",
    });
    isAnalyzing.value = false;
    isQueued.value = false;
    currentMessageId.value = null;
  }
};

const getWorker = (file: File) => {
  if (file.type === "application/geo+json" || file.name.endsWith(".geojson")) {
    return new GeojsonWorker();
  } else if (
    ["application/zip", "application/x-zip-compressed"].includes(file.type) ||
    file.name.endsWith(".zip")
  ) {
    return new ShapefileWorker();
  } else if (
    [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ].includes(file.type) ||
    [".csv", ".xls", ".xlsx"].some((el) => file.name.endsWith(el))
  ) {
    return new SheetsWorker();
  } else if (
    file.type === "application/vnd.google-earth.kml+xml" ||
    file.name.endsWith(".kml")
  ) {
    return new KmlWorker();
  } else if (
    file.type === "application/gpx+xml" ||
    file.name.endsWith(".gpx")
  ) {
    return new GpxWorker();
  } else if (
    file.type === "application/vnd.garmin.tcx+xml" ||
    file.name.endsWith(".tcx")
  ) {
    return new TcxWorker();
  } else if (
    file.type === "application/geopackage+sqlite3" ||
    file.name.endsWith(".gpkg")
  ) {
    return new GeopackageWorker();
  } else if (file.name.endsWith(".fgb")) {
    return new FlatgeobufWorker();
  } else {
    return null;
  }
};

const getGeomTypeAndStyle = (
  geojsonGeomType: GeoJSON.GeoJsonGeometryTypes,
): {
  geomType:
    | typeof geomTypeCircle
    | typeof geomTypeLine
    | typeof geomTypePolygon;
  layerStyle: CircleStyles | LineStyles | FillStyles;
} | null => {
  const randomColor = `#${Math.floor(Math.random() * 16777216).toString(16)}`;
  if (geojsonGeomType === "Point" || geojsonGeomType === "MultiPoint") {
    return {
      geomType: geomTypeCircle,
      layerStyle: {
        paint_circle_color: randomColor,
        paint_circle_radius: 5,
        paint_circle_stroke_width: 1,
        layout_visibility: "visible",
      },
    };
  } else if (
    geojsonGeomType === "LineString" ||
    geojsonGeomType === "MultiLineString"
  ) {
    return {
      geomType: geomTypeLine,
      layerStyle: {
        paint_line_color: randomColor,
        paint_line_width: 2,
        layout_visibility: "visible",
      },
    };
  } else if (
    geojsonGeomType === "Polygon" ||
    geojsonGeomType === "MultiPolygon"
  ) {
    return {
      geomType: geomTypePolygon,
      layerStyle: {
        paint_fill_color: randomColor,
        paint_fill_outline_color: "#000000",
        layout_visibility: "visible",
      },
    };
  } else {
    return null;
  }
};

const addToIDBAndLayerList = async (
  fileName: string,
  geojsonObj: GeoJSON.GeoJSON,
  bounds: GeoJSON.Polygon,
  layerAlias: string | null,
  description: string | null,
) => {
  let geojsonGeomType: GeoJSON.GeoJsonGeometryTypes;
  if (geojsonObj.type === "Feature") {
    geojsonGeomType = geojsonObj.geometry.type;
  } else if (geojsonObj.type === "FeatureCollection") {
    if (!geojsonObj.features.length) {
      return {
        title: "Data has no feature",
        description: fileName,
        icon: "i-heroicons-x-mark",
      };
    }
    geojsonGeomType = geojsonObj.features[0].geometry.type;
  } else {
    geojsonGeomType = geojsonObj.type;
  }
  const typeAndStyle = getGeomTypeAndStyle(geojsonGeomType);
  if (!typeAndStyle) {
    return {
      title: "Data with mixed geometry per feature is not supported",
      description: fileName,
      icon: "i-heroicons-x-mark",
    };
  }

  const newLayer: LoadedGeoJson = {
    source: "loaded_geojson",
    layer_id: `__local_${crypto.randomUUID()}`,
    layer_alias: layerAlias || fileName,
    description: description || "",
    preview: (thumbnailFile?.value as File) || null,
    category: { category_name: uncategorizedLoadedData },
    bounds,
    layer_style: typeAndStyle.layerStyle,
    geometry_type: typeAndStyle.geomType,
    dimension: "2D",
  };

  const newLayerWithData = {
    ...newLayer,
    data: geojsonObj,
  };
  await addLoadedGeoJsonData(newLayerWithData);
};
const handleApply = async (
  layerAlias: string | null,
  description: string | null,
) => {
  if (!selectedOption.value) {
    showToast("Please select a data type first", "error");
    return;
  }

  if (
    selectedOption.value === "KML" &&
    (!selectedKmlFeatures.value.length || !kmlData.value)
  ) {
    showToast("Please select at least one KML feature", "error");
    return;
  }

  if (!selectedCategories.value.length) {
    showToast("Please select at least one category", "error");
    return;
  }

  if (selectedOption.value === "KML" && kmlData.value) {
    try {
      isAnalyzing.value = true;

      const selectedFeatures = kmlData.value.features
        .filter((feature) => selectedKmlFeatures.value.includes(feature.name))
        .map((feature) => feature.originalFeature);

      if (!selectedFeatures.length) {
        showToast("No valid features selected", "error");
        isAnalyzing.value = false;
        return;
      }

      const geometries = selectedFeatures.map((feature: any) => ({
        type: feature.geometry.type,
        coordinates: feature.geometry.coordinates,
      }));

      const geojsonArea = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "GeometryCollection",
              geometries,
            },
          },
        ],
      };

      console.log("GeoJSON Area Data:", geojsonArea);
      console.log("Selected Categories:", selectedCategories.value);

      const token = authStore.accessToken;
      const response = await $fetch<{ data: { message_id: string } }>(
        `/panel/analysis/poi-quick-insight`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            geojson_area: geojsonArea,
            categories: selectedCategories.value,
            name: analysisName.value,
          }),
        },
      );

      const messageId = response?.message_id;

      if (!messageId) {
        throw new Error("No message_id received from API");
      }

      toast.add({
        title: "Analysis Started",
        description: "Processing your Quick Market Insight analysis...",
        icon: "i-heroicons-information-circle",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });

      currentMessageId.value = messageId;

      // Start polling for queue status
      await pollQueueStatus(messageId);
    } catch (error: any) {
      toast.add({
        title: "Analysis Failed",
        description:
          error?.data?.message || error?.message || "Unknown error occurred",
        icon: "i-heroicons-x-circle",
      });
      console.error(error);
      isAnalyzing.value = false;
      isQueued.value = false;
      currentMessageId.value = null;
    }
  }
};

const handleResult = () => {
  const toolsStore = useMapTools();
  resetSelections();
  // Close the tools card
  toolsStore.showCard = false;
  toolsStore.showTools = true;

  // Open the list drawer for POI analysis results
  featureStore.setMapInfo("analytic");
};
</script>

<template>
  <div class="flex flex-col h-full overscroll-y-auto">
    <div
      class="flex-1 overflow-y-auto p-2 flex flex-col gap-2 scrollbar-thin scrollbar-thumb-grey-400 scrollbar-track-grey-100"
    >
      <div class="flex items-center">
        <h3 class="text-brand-800 text-2xs w-1/2">Select Data Type</h3>
      </div>

      <div class="flex flex-wrap gap-2">
        <UButton
          v-for="layer in optionUpload"
          :key="layer"
          size="xs"
          :class="{
            'bg-white hover:bg-brand-50 cursor-pointer bg-opacity-30 border-brand-600 border text-brand-500 font-medium':
              selectedOption === layer,
            'bg-[#232221] border border-grey-500 text-white':
              selectedOption !== layer,
          }"
          class="rounded-xxs cursor-pointer text-[10px]"
          @click="toggleSelection(layer)"
        >
          {{ layer }}
        </UButton>
      </div>

      <h3 class="text-brand-800 text-2xs">Name Analysis</h3>
      <UInput
        v-model="analysisName"
        placeholder="Enter analysis name"
        class="rounded-xxs cursor-pointer text-[10px]"
        size="xs"
      />
      <h3 class="text-brand-800 text-2xs">Select Categories</h3>
      <USelectMenu
        v-model="selectedCategories"
        :options="categoryOptions"
        multiple
        placeholder="Select POI categories"
        value-attribute="value"
        option-attribute="label"
        :ui="{ rounded: 'rounded-xxs' }"
        size="xs"
      />

      <h3 class="text-brand-800 text-2xs">Apply Analysis From</h3>
      <FilePicker @files-selected="handleFileUpload" />

      <div v-if="isLoading" class="flex justify-center items-center py-4">
        <IcSpinner class="w-6 h-6 animate-spin" />
      </div>

      <div v-if="showKmlSelector && kmlData" class="mt-2">
        <h3 class="text-brand-800 text-2xs mb-1">Select KML Features</h3>
        <div
          class="max-h-20 overflow-y-auto bg-white rounded-xs p-2 border border-grey-300 scrollbar-thin scrollbar-thumb-grey-400 scrollbar-track-grey-100"
        >
          <div
            v-for="feature in kmlData.features"
            :key="feature.name"
            class="flex items-center gap-2 py-2 hover:bg-grey-50 rounded px-1 cursor-pointer"
          >
            <UCheckbox
              :model-value="selectedKmlFeatures.includes(feature.name)"
              @update:model-value="toggleKmlFeature(feature.name)"
            />
            <div
              class="text-grey-800 text-xs flex justify-between w-full items-center"
            >
              <p class="flex-1 truncate">{{ feature.name }}</p>
              <p class="text-[10px] text-grey-500 ml-2">
                {{ feature.geometryType }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div class="flex flex-col gap-2 justify-between w-full">
        <UButton
          color="primary"
          block
          size="xs"
          :ui="{ rounded: 'rounded-[4px]' }"
          class="justify-center text-sm"
          :disabled="!selectedKmlFeatures.length"
          @click="handlePreviewData"
        >
          Preview Data
        </UButton>
        <div class="flex justify-between w-full gap-2">
          <UButton
            color="primary"
            size="xs"
            :ui="{ rounded: 'rounded-[4px]' }"
            class="w-[49%] justify-center text-sm"
            :disabled="isAnalyzing || isQueued"
            :loading="isAnalyzing || isQueued"
            @click="handleApply"
          >
            {{ isAnalyzing || isQueued ? "Analyzing..." : "Analyze" }}
          </UButton>
          <UButton
            color="grey"
            size="xs"
            :disabled="isAnalyzing || isQueued"
            :loading="isAnalyzing || isQueued"
            :ui="{ rounded: 'rounded-[4px]' }"
            class="w-[49%] justify-center text-sm"
            @click="handleResult"
          >
            Result
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
