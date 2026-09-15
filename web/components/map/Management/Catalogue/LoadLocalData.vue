<script lang="ts" setup>
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from "@headlessui/vue";
import IcSpinner from "~/assets/icons/ic-spinner.svg";
import IcCheck from "~/assets/icons/ic-check.svg";
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
import type { LoadedGeoJson } from "~/utils/types";

interface IParseResult {
  geojsonObj: GeoJSON.GeoJSON;
  bounds: GeoJSON.Polygon;
}
interface IParseResultWithFileName extends IParseResult {
  fileName: string;
}

const emit = defineEmits<{
  (e: "handleCancel"): void;
  (e: "handleSuccess"): void;
}>();

const uploading = ref(false);
const uploaded = ref(false);

const toast = useToast();

const selectedFile = ref<File | null>(null);
const thumbnailFile = ref<File | null>(null);

const datasetName = ref<HTMLInputElement | null>(null);
const datasetDesc = ref<HTMLInputElement | null>(null);

const mapLayerStore = useMapLayer();
const { addLoadedGeoJsonData } = useIDB();

const cancel = () => {
  emit("handleCancel");
};

const selectedTab = ref(0);

function changeTab(index: number) {
  selectedTab.value = index;
}

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
  geojsonGeomType: GeoJSON.GeoJsonGeometryTypes
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
  description: string | null
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

const handleFileUpload = async (
  layerAlias: string | null,
  description: string | null
) => {
  if (!window.Worker) {
    toast.add({
      title: "Feature not supported in this browser",
      description: "Please use browser that supports Web Worker",
      icon: "i-heroicons-x-mark",
    });
    return;
  }
  uploading.value = true;
  const worker = getWorker(selectedFile.value!);
  if (!worker) {
    toast.add({
      title: "Unable to identify selected file",
      icon: "i-heroicons-x-mark",
    });
    uploading.value = false;
    return;
  }

  worker.onerror = (e: ErrorEvent) => {
    toast.add({
      title: e.message,
      icon: "i-heroicons-x-mark",
    });
    console.error(e.error);
    uploading.value = false;
    worker.terminate();
  };
  worker.onmessage = async (
    e: MessageEvent<
      | { status: "error"; message: string; data?: any }
      | { status: "success"; data: IParseResult | IParseResultWithFileName[] }
    >
  ) => {
    if (e.data.status === "error") {
      toast.add({
        title: e.data.message,
        icon: "i-heroicons-x-mark",
      });
      if (e.data.data) {
        console.error(e.data.data);
      }
      uploading.value = false;
    } else {
      let toastErr;
      try {
        const result = e.data.data;

        if (Array.isArray(result)) {
          for (let i = 0; i < result.length; i++) {
            const data = result[i];
            toastErr = await addToIDBAndLayerList(
              data.fileName || `${selectedFile.value!.name}_${i}`,
              data.geojsonObj,
              data.bounds,
              layerAlias || null,
              description || null
            );
            if (toastErr) break;
          }
        } else {
          toastErr = await addToIDBAndLayerList(
            selectedFile.value!.name,
            result.geojsonObj,
            result.bounds,
            layerAlias || null,
            description || null
          );
        }
      } catch (error) {
        console.error(error);
        toastErr = {
          title: "An error occurred when attempting to input processed file",
          icon: "i-heroicons-x-mark",
        };
      }
      // emit("handleSuccess");
      if (!toastErr) {
        setTimeout(() => {
          toast.add({
            title: "File has been processed successfully",
            icon: "i-heroicons-check-circle",
          });
          uploading.value = false;
        }, 2000);
        uploaded.value = true;
      } else {
        uploading.value = false;
        toast.add(toastErr);
      }
    }
    worker.terminate();
  };
  worker.postMessage(selectedFile.value);
};
const handleBack = () => {
  if (selectedTab.value !== 0) {
    changeTab(selectedTab.value - 1);
  }
};
const handleNext = () => {
  if (selectedFile.value) {
    handleFileUpload(
      datasetName?.value?.value || null,
      datasetDesc?.value?.value || null
    );
  }
};
</script>

<template>
  <div class="h-full flex flex-col gap-4 max-h-[calc(100%-2.25rem)]">
    <div
      class="w-full h-full border border-grey-700 py-10 px-5 overflow-y-auto"
    >
      <div v-if="!uploading && !uploaded" class="m-auto max-w-2xl space-y-2">
        <p class="text-grey-50">Load Local Data</p>
        <TabGroup :selectedIndex="selectedTab" @change="changeTab">
          <TabList class="flex gap-3 justify-evenly mb-3">
            <Tab
              :disabled="!selectedFile"
              v-for="(item, index) in [{ step: 1, title: 'Select File' }]"
              v-slot="{ selected }"
              class="flex flex-col flex-1 text-grey-200 text-2xs"
            >
              <p>{{ item.step }}</p>
              <p>{{ item.title }}</p>
              <div
                :class="[
                  selected ? 'bg-brand-500' : 'bg-grey-400',
                  'h-[2px] w-full rounded-lg mt-2',
                ]"
              />
            </Tab>
          </TabList>
          <hr class="border-grey-700" />
          <TabPanels>
            <TabPanel class="space-y-3">
              <p class="text-sm text-grey-400">Select File</p>
              <MapManagementCatalogueLoadFileInput
                accept=".geojson,application/geo+json,.zip,application/zip,application/x-zip-compressed,.csv,text/csv,.xls,application/vnd.ms-excel,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.kml,application/vnd.google-earth.kml+xml,.gpx,application/gpx+xml,.tcx,application/vnd.garmin.tcx+xml,.gpkg,application/geopackage+sqlite3,.fgb"
                :selectedFile="selectedFile"
                @set-selected-file="
                  (value: File|null) => {
                    selectedFile = value;
                  }
                "
              />
              <hr class="border-grey-700" />
              <div class="flex flex-col text-grey-400 pt-1 pl-2 gap-1">
                <p class="text-sm">Load to Loaded Data</p>
                <p class="text-xs">
                  The file you choose from your storage will automatically be
                  displayed and categorized as the Loaded Data on User’s
                  Catalogue.
                </p>
              </div>
              <!-- <p class="text-sm text-grey-400">Load To</p>
              <div class="py-2">
                <p class="text-grey-50">Loaded Data</p>
                <p class="text-xs text-grey-400">
                  The dataset you load from your local storage will
                  automatically be displayed and categorized in the Loaded Data
                  Catalogue.
                </p>
              </div>
              <div class="flex flex-col gap-3">
                <p class="text-sm text-grey-400">Data Format</p>
                <div class="grid grid-cols-3 text-grey-400">
                  <button
                    v-for="item in [
                      { format: 'geojson' },
                      { format: 'csv' },
                      { format: 'xls' },
                      { format: 'kml' },
                    ]"
                    @click="
                      () => {
                        formatType = item.format;
                      }
                    "
                  >
                    {{ item.format }}
                  </button>
                </div>
              </div> -->
            </TabPanel>
            <TabPanel class="space-y-3">
              <p class="text-sm text-grey-400">Dataset Information</p>
              <MapManagementCatalogueLoadFileInput
                accept="image/*"
                :selectedFile="thumbnailFile"
                @set-selected-file="
                  (value: File|null) => {
                    thumbnailFile = value;
                  }
                "
              />
              <div class="relative">
                <input
                  ref="datasetName"
                  type="text"
                  id="floating_filled"
                  class="block rounded-xxs px-2.5 pb-2.5 pt-5 w-full text-sm text-grey-200 bg-grey-700 border border-grey-600 appearance-none focus:outline-none focus:ring-0 focus:border-grey-600 peer"
                  placeholder=" "
                />
                <label
                  for="floating_filled"
                  class="absolute text-sm text-grey-200 duration-300 transform -translate-y-3 scale-75 top-4 z-10 origin-[0] start-2.5 peer-focus:text-grey-400 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-3 rtl:peer-focus:translate-x-1/4 rtl:peer-focus:left-auto"
                >
                  Dataset Name
                </label>
              </div>
              <div class="relative">
                <textarea
                  ref="datasetDesc"
                  type="text"
                  rows="5"
                  id="floating_filled"
                  class="block rounded-xxs px-2.5 pb-2.5 pt-5 w-full text-sm text-grey-200 bg-grey-700 border border-grey-600 appearance-none focus:outline-none focus:ring-0 focus:border-grey-600 peer"
                  placeholder=" "
                />
                <label
                  for="floating_filled"
                  class="absolute text-sm text-grey-200 duration-300 transform -translate-y-3 scale-75 top-4 z-10 origin-[0] start-2.5 peer-focus:text-grey-400 peer-placeholder-shown:scale-100 peer-placeholder-shown:translate-y-0 peer-focus:scale-75 peer-focus:-translate-y-3 rtl:peer-focus:translate-x-1/4 rtl:peer-focus:left-auto"
                >
                  Dataset Description
                </label>
              </div>
            </TabPanel>
          </TabPanels>
        </TabGroup>
      </div>
      <div
        v-else-if="uploading"
        class="w-full h-full flex flex-col justify-center items-center"
      >
        <IcSpinner
          class="text-brand-500 animate-spin h-10 w-10 mb-3"
          :fontControlled="false"
        />
        <p class="text-grey-50">Uploading Data</p>
        <p class="text-grey-400 text-sm">
          This might take a few seconds. Please Wait.
        </p>
      </div>
      <div
        v-else-if="uploaded"
        class="w-full h-full flex flex-col justify-center items-center gap-3"
      >
        <IcCheck class="w-10 h-10 text-brand-500" :fontControlled="false" />
        <div class="flex flex-col items-center">
          <p class="text-grey-50">Data Loaded</p>
          <p class="text-grey-400 text-sm">
            Your Data is Successfully loaded to the catalogue.
          </p>
        </div>
        <UButton
          @click="() => emit('handleSuccess')"
          :ui="{ rounded: 'rounded-[4px]' }"
          color="brand"
          >Go To Catalogue</UButton
        >
      </div>
    </div>
    <div v-if="!uploading && !uploaded" class="flex justify-between">
      <UButton
        @click="cancel"
        :ui="{ rounded: 'rounded-xs' }"
        label="Cancel"
        variant="outline"
        color="brand"
        class="w-44 text-sm justify-center"
      >
      </UButton>
      <div class="space-x-2">
        <UButton
          :disabled="selectedTab === 0 && !selectedFile"
          @click="handleNext"
          :ui="{ rounded: 'rounded-xs' }"
          label="Next"
          :color="selectedTab === 0 && !selectedFile ? 'grey' : 'brand'"
          class="w-44 text-sm justify-center"
        >
        </UButton>
      </div>
    </div>
  </div>
</template>
