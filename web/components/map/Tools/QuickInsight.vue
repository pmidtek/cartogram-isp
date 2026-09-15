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
const showKmlSelector = ref(false);
const isLoading = ref(false);
const uploading = ref(false);
const uploaded = ref(false);
const authStore = useAuth();
const digitizeStore = useDigitizeStore();
const featureStore = useFeature();
const { addLoadedGeoJsonData } = useIDB();
const mapStore = useMapRef();
const { map } = mapStore;

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
  showToast("All selections have been reset", "info");
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

  if (selectedOption.value === "KML" && kmlData.value) {
    try {
      const selectedFeatures = kmlData.value.features
        .filter((feature) => selectedKmlFeatures.value.includes(feature.name))
        .map((feature) => feature.originalFeature);

      if (!selectedFeatures.length) {
        showToast("No valid features selected", "error");
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

      console.log("Converted GeoJSON Data:", geojsonData);

      const geometries = geojsonData.features.map((feature: any) => ({
        type: feature.geometry.type,
        coordinates: feature.geometry.coordinates,
      }));

      const apiBody = {
        area: {
          type: "GeometryCollection",
          geometries,
        },
      };

      console.log("API Body Data:", apiBody);

      const token = authStore.accessToken;
      const response = await fetch("/panel/chart/count/digitize/house_class", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(apiBody),
      });

      if (!response.ok) {
        throw new Error(`API Error: ${response.statusText}`);
      }

      const dataResult: DataResult[] = await response.json();

      showToast(`Data successfully analyzed and stored`, "success");

      console.log("API Response:", dataResult);
      const layerId = `geojson-layer-${Date.now()}`;

      digitizeStore.addDigitizedData({
        name: "House Class",
        area: "Quick Insight",
        coordinates: geojsonData.features.flatMap(
          (feature: any) => feature.geometry.coordinates,
        ),
        data: { "House Class": dataResult },
        layer: "KML File",
        layerId: layerId,
      });

      if (!map?.getSource(layerId)) {
        map?.addSource(layerId, {
          type: "geojson",
          data: geojsonData,
        });

        map?.addLayer({
          id: layerId,
          type: "fill",
          source: layerId,
          layout: {},
          paint: {
            "fill-color": "#EE2627",
            "fill-opacity": 0.65,
            "fill-outline-color": "#A11B1C",
          },
        });
        map?.addLayer({
          id: `${layerId}-stroke`,
          type: "line",
          source: layerId,
          layout: {},
          paint: {
            "line-color": "#A11B1C",
            "line-width": 3,
            "line-opacity": 1,
          },
        });

        let flyTo = geojsonData.features[0].geometry.coordinates[0][0];

        map?.flyTo({
          center: [flyTo[0], flyTo[1]],
          zoom: 16,
          speed: 1.2,
        });

        showToast("GeoJSON layer added to the map", "success");
      } else {
        showToast("GeoJSON layer already exists", "info");
      }

      if (!window.Worker) {
        toast.add({
          title: "Feature not supported in this browser",
          description: "Please use a browser that supports Web Worker",
          icon: "i-heroicons-x-mark",
        });
        return;
      }

      console.log(selectedFile.value!);

      featureStore.setMapInfo("analytic");
    } catch (error) {
      showToast(
        `Error: ${error instanceof Error ? error.message : "Unknown error"}`,
        "error",
      );
      console.error(error);
    }
  }
};
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <div class="flex items-center">
      <h3 class="text-brand-50 text-2xs w-1/2">Select Data Type</h3>
      <div class="h-[1px] w-full bg-grey-700" />
    </div>

    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="layer in optionUpload"
        :key="layer"
        size="xs"
        :class="{
          'bg-brand-400 bg-opacity-30 border-brand-600 border text-brand-500 font-medium':
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

    <h3 class="text-brand-50 text-2xs">Apply Analysis From</h3>
    <FilePicker @files-selected="handleFileUpload" />

    <div v-if="isLoading" class="flex justify-center items-center py-4">
      <IcSpinner class="w-6 h-6 animate-spin" />
    </div>

    <div v-if="showKmlSelector && kmlData" class="mt-4">
      <h3 class="text-brand-50 text-2xs mb-2">Select KML Features</h3>
      <div class="max-h-60 overflow-y-auto bg-grey-800 rounded-md p-2">
        <div
          v-for="feature in kmlData.features"
          :key="feature.name"
          class="flex items-center gap-2 py-1"
        >
          <UCheckbox
            :model-value="selectedKmlFeatures.includes(feature.name)"
            @update:model-value="toggleKmlFeature(feature.name)"
          />
          <div
            class="text-white text-xs flex justify-between w-full items-center"
          >
            <p>{{ feature.name }}</p>
            <p class="text-[10px]">{{ feature.geometryType }}</p>
          </div>
        </div>
      </div>
    </div>

    <div class="p-2 flex gap-2 justify-between">
      <UButton
        color="grey"
        variant="outline"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="w-[49%] justify-center text-sm"
        @click="resetSelections"
      >
        Reset
      </UButton>
      <UButton
        color="primary"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="w-[49%] justify-center text-sm"
        @click="handleApply"
      >
        Generate Insight
      </UButton>
    </div>
  </div>
</template>
