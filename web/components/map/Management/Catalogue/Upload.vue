<script lang="ts" setup>
import { RadioGroup, RadioGroupOption } from "@headlessui/vue";
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from "@headlessui/vue";
import IcMapLayerA from "~/assets/icons/ic-map-layer-a.svg";
import IcMapLayerB from "~/assets/icons/ic-map-layer-b.svg";
import Ic3d from "~/assets/icons/ic-3d.svg";
import IcSpinner from "~/assets/icons/ic-spinner.svg";
import IcCheck from "~/assets/icons/ic-check.svg";
import { layerDataFolderId, layerPreviewFolderId } from "~/constants";

const emit = defineEmits<{
  (e: "refreshListedLayers"): void;
  (e: "handleCancel"): void;
  (e: "handleSuccess"): void;
}>();

const cancel = () => {
  emit("handleCancel");
};

const authStore = useAuth();
const toast = useToast();

const uploading = ref(false);
const uploaded = ref(false);

const selectedFile = ref<File | null>(null);
const thumbnailFile = ref<File | null>(null);

const dataType = ref<string>("");
const isTerrain = ref<boolean>(false);
const hasColor = ref<boolean>(false);

const selectedTab = ref(0);

const formatData = ref<string>("");

const datasetName = ref<string>();
const datasetDesc = ref<string>();

function changeTab(index: number) {
  selectedTab.value = index;
}

const handleBack = () => {
  if (selectedTab.value !== 0) {
    changeTab(selectedTab.value - 1);
  }
};
const handleNext = () => {
  if (selectedTab.value !== 1) {
    changeTab(selectedTab.value + 1);
  }
};

const uploadPreviewImg = async () => {
  const form = new FormData();
  form.append("folder", layerPreviewFolderId);

  form.append("file", thumbnailFile.value as File);

  const res = await fetch("/panel/files", {
    credentials: "include",
    headers: {
      Authorization: `Bearer ${authStore.accessToken}`,
    },
    body: form,
    method: "POST",
  });

  const result = await res.json();

  if (result?.data?.id) {
    return result.data.id;
  } else {
    if (result.errors[0].message) {
      throw new Error(result.errors[0].message);
    } else {
      throw new Error("Error uploading preview image");
    }
  }
};

const upload = async () => {
  try {
    uploading.value = true;

    const additionalConfig: Record<string, any> = { listed: true };

    if (thumbnailFile.value) {
      const previewUploadResId = await uploadPreviewImg();

      if (previewUploadResId) {
        additionalConfig["preview"] = previewUploadResId;
      }
    }

    const form = new FormData();
    form.append("folder", layerDataFolderId);
    form.append("format_file", formatData.value);
    form.append(
      "is_zipped",
      selectedFile.value?.type === "application/zip" ? "true" : "false"
    );

    datasetDesc.value && (additionalConfig["description"] = datasetDesc.value);
    dataType.value === "vector" &&
      (additionalConfig["layer_alias"] =
        datasetName.value || selectedFile.value?.name);

    form.append("additional_config", JSON.stringify(additionalConfig));

    dataType.value === "raster" &&
      form.append(
        "raster_alias",
        JSON.stringify(datasetName.value || selectedFile.value?.name)
      );
    dataType.value === "raster" &&
      form.append("is_terrain", JSON.stringify(isTerrain.value));

    dataType.value === "3d" &&
      form.append(
        "three_d_alias",
        JSON.stringify(datasetName.value || selectedFile.value?.name)
      );
    dataType.value === "3d" &&
      form.append("has_color", JSON.stringify(hasColor.value));

    form.append("is_ready", "true");
    form.append("file", selectedFile.value as File);
    const res = await fetch("/panel/files", {
      credentials: "include",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: form,
      method: "POST",
    });

    const result = await res.json();

    if (result.data) {
      setTimeout(() => {
        toast.add({
          title: "File has been processed successfully",
          icon: "i-heroicons-check-circle",
        });
        uploading.value = false;
      }, 2000);
      uploaded.value = true;
    } else {
      setTimeout(() => {
        toast.add({
          title: result.errors[0].message,
          icon: "i-heroicons-check-circle",
        });
        uploading.value = false;
      }, 2000);
    }
  } catch (error) {
    uploading.value = false;
    const message =
      error instanceof Error
        ? error.message || "Error uploading file"
        : "Error uploading file";
    toast.add({
      title: message,
    });
  }
};

const threedOptions = [{ value: "las/laz", label: "las/laz" }];

const vectorOptions = [
  { value: "csv", label: "csv" },
  { value: "gdb", label: "gdb" },
  { value: "geojson", label: "geojson" },
  { value: "kml", label: "kml" },
  { value: "shapefile", label: "shapefile" },
  { value: "xls", label: "xls" },
  { value: "xlsx", label: "xlsx" },
];

const rasterOptions = [{ value: "tif", label: "tif" }];

const nextDisabled = computed(() => {
  return (
    (selectedTab.value === 0 && !formatData.value) ||
    (selectedTab.value === 1 && !selectedFile.value) ||
    (selectedTab.value === 2 && !selectedFile.value)
  );
});

watchEffect(() => {
  if (dataType.value) {
    formatData.value = "";
  }
});
</script>

<template>
  <div class="h-full flex flex-col gap-4 max-h-[calc(100%-2.25rem)]">
    <div
      class="w-full h-full border border-grey-700 py-10 px-5 overflow-y-auto"
    >
      <div v-if="!uploading && !uploaded" class="m-auto max-w-3xl space-y-2">
        <p class="text-grey-50">Upload Data</p>
        <TabGroup :selectedIndex="selectedTab" @change="changeTab" manual>
          <TabList class="flex gap-3 justify-evenly mb-3">
            <Tab
              v-for="(item, index) in [
                {
                  step: 1,
                  title: 'Select Data Type & Format',
                  disabled: false,
                },
                { step: 2, title: 'Select File', disabled: !formatData },
              ]"
              :disabled="item.disabled"
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
              <p class="text-sm text-grey-400">
                Upload to Default Data Catalogue
              </p>
              <p class="text-xs text-grey-400">
                The file you choose from your storage will automatically be
                displayed and categorized as Default Data Catalogue. You can
                choose to manage the file's category either at the final stage
                of the upload process or later through the data catalogue
                settings.
              </p>
              <div class="flex flex-col gap-3">
                <p class="text-sm text-grey-400">Data Type</p>
                <RadioGroup v-model="dataType">
                  <div class="grid grid-cols-3 gap-3">
                    <MapManagementCatalogueUploadTypeCard
                      :icon="Ic3d"
                      desc=".laz"
                      optLabel="Three Dimensions"
                      optValue="3d"
                    />
                    <MapManagementCatalogueUploadTypeCard
                      :icon="IcMapLayerA"
                      desc=".shp, .geojson, .kml, .gdb, .csv, .xlsx"
                      optLabel="Vector"
                      optValue="vector"
                    />
                    <MapManagementCatalogueUploadTypeCard
                      :icon="IcMapLayerB"
                      desc=".tif"
                      optLabel="Raster"
                      optValue="raster"
                    />
                  </div>
                </RadioGroup>
              </div>
              <div class="w-48">
                <CoreSelect
                  :disabled="!dataType"
                  placeholder="Data Format"
                  :value="formatData"
                  :options="
                    dataType === '3d'
                      ? threedOptions
                      : dataType === 'vector'
                      ? vectorOptions
                      : rasterOptions
                  "
                  @handle-change="
                    (value:string) => {
                      formatData = value
                    }
                  "
                />
              </div>
            </TabPanel>
            <TabPanel class="space-y-3">
              <p class="text-sm text-grey-400">Upload Data</p>
              <MapManagementCatalogueLoadFileInput
                :accept="
                  formatData
                    ? formatData !== 'xls'
                      ? formatData === 'tif'
                        ? `.${formatData},.tiff,.zip`
                        : formatData === 'las/laz'
                        ? '.las,.laz,.zip'
                        : `.${formatData},.zip`
                      : `.${formatData}`
                    : ''
                "
                :selectedFile="selectedFile"
                @set-selected-file="
                  (value: File|null) => {
                    selectedFile = value;
                  }
                "
              />
              <div v-if="dataType === 'raster'" class="space-y-3">
                <p class="text-sm text-grey-400">Is Terrain</p>
                <RadioGroup
                  v-model="isTerrain"
                  class="flex gap-2 w-full bg-grey-800 border border-grey-700 rounded-xs p-2"
                >
                  <RadioGroupOption
                    v-for="(item, index) in [
                      { value: true, label: 'Yes' },
                      { value: false, label: 'No' },
                    ]"
                    v-slot="{ checked }"
                    :value="item.value"
                    class="w-full"
                  >
                    <div
                      :class="[
                        checked ? 'bg-brand-950' : '',
                        'flex gap-2 hover:bg-brand-950 p-2 rounded-xxs text-2xs text-grey-50 cursor-pointer',
                      ]"
                    >
                      <div
                        :class="[
                          checked
                            ? 'border-brand-500'
                            : 'border-grey-600 bg-grey-700',
                          ,
                          'flex items-center justify-center w-4 h-4 border  rounded-full',
                        ]"
                      >
                        <div
                          v-if="checked"
                          class="w-3 h-3 border-2 border-brand-500 rounded-full"
                        ></div>
                      </div>
                      <p>{{ item.label }}</p>
                    </div>
                  </RadioGroupOption>
                </RadioGroup>
              </div>
              <div v-if="dataType === '3d'" class="space-y-3">
                <p class="text-sm text-grey-400">Has Color</p>
                <RadioGroup
                  v-model="hasColor"
                  class="flex gap-2 w-full bg-grey-800 border border-grey-700 rounded-xs p-2"
                >
                  <RadioGroupOption
                    v-for="(item, index) in [
                      { value: true, label: 'Yes' },
                      { value: false, label: 'No' },
                    ]"
                    v-slot="{ checked }"
                    :value="item.value"
                    class="w-full"
                  >
                    <div
                      :class="[
                        checked ? 'bg-brand-950' : '',
                        'flex gap-2 hover:bg-brand-950 p-2 rounded-xxs text-2xs text-grey-50 cursor-pointer',
                      ]"
                    >
                      <div
                        :class="[
                          checked
                            ? 'border-brand-500'
                            : 'border-grey-600 bg-grey-700',
                          ,
                          'flex items-center justify-center w-4 h-4 border  rounded-full',
                        ]"
                      >
                        <div
                          v-if="checked"
                          class="w-3 h-3 border-2 border-brand-500 rounded-full"
                        ></div>
                      </div>
                      <p>{{ item.label }}</p>
                    </div>
                  </RadioGroupOption>
                </RadioGroup>
              </div>
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
                  v-model="datasetName"
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
                  v-model="datasetDesc"
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
          @click="
            () => {
              emit('refreshListedLayers');
              emit('handleSuccess');
            }
          "
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
          :disabled="selectedTab === 0"
          @click="handleBack"
          :ui="{ rounded: 'rounded-xs' }"
          label="Back"
          variant="outline"
          :color="selectedTab === 0 ? 'grey' : 'brand'"
          class="w-44 text-sm justify-center"
        >
        </UButton>
        <UButton
          :disabled="nextDisabled"
          @click="selectedTab === 1 && selectedFile ? upload() : handleNext()"
          :ui="{ rounded: 'rounded-xs' }"
          :label="selectedTab === 1 ? 'Upload Data' : 'Next'"
          :color="nextDisabled ? 'grey' : 'brand'"
          class="w-44 text-sm justify-center"
        >
        </UButton>
      </div>
    </div>
  </div>
</template>
