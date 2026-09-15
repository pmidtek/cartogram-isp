<script setup lang="ts">
import IcCross from "~/assets/icons/ic-cross.svg";
import IcFileAdd from "~/assets/icons/ic-file-add.svg";
import IcFileSort from "~/assets/icons/ic-file-sort.svg";
import IcCloudUpload from "~/assets/icons/ic-cloud-upload.svg";
import IcArrow from "~/assets/icons/ic-arrow-square.svg";
import type { LayerConfigLists, UploadModeEnum } from "~/utils/types";
import { staticKey } from "~/constants";

const authStore = useAuth();
const { getAllLoadedGeoJsonData } = useIDB();
const mapLayerStore = useMapLayer();
const { getLayersArr } = mapLayerStore;
const catalogueStore = useCatalogue();
const { toggleCatalogue } = catalogueStore;
const { selectedCategory } = storeToRefs(catalogueStore);
const mode = ref<UploadModeEnum>("");
const isOption = ref(false);

const changeMode = (value: UploadModeEnum) => {
  mode.value = value;
};

const isFetching = ref(false);
const catalogueData = ref<any[]>([]);
const fetchData = async (categoryId: string) => {
  isFetching.value = true;
  if (categoryId === staticKey.loadedData) {
    const loadedData = await getAllLoadedGeoJsonData();
    if (loadedData) {
      catalogueData.value = loadedData;
    }
    isFetching.value = false;
  } else {
    const [vectorTiles, rasterTiles, threeDTiles] = await Promise.all([
      $fetch<{
        data: LayerConfigLists;
      }>(
        `/panel/items/vector_tiles?fields=layer_id,layer_name,geometry_type,bounds,minzoom,maxzoom,layer_alias,hover_popup_columns,click_popup_columns,image_columns,active,description,preview,category.*,fill_style.*,line_style.*,circle_style.*,symbol_style.*&sort=layer_name&${
          categoryId === staticKey.other
            ? `filter[category][_null]=true`
            : `filter[category][category_id][_eq]=${categoryId}`
        }`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + authStore.accessToken,
          },
        }
      ),
      $fetch<{
        data: LayerConfigLists;
      }>(
        `/panel/items/raster_tiles?fields=layer_id,bounds,minzoom,maxzoom,terrain_rgb,layer_alias,active,visible,category.*,preview,description&sort=layer_alias&${
          categoryId === staticKey.other
            ? `filter[category][_null]=true`
            : `filter[category][category_id][_eq]=${categoryId}`
        }`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + authStore.accessToken,
          },
        }
      ),
      $fetch<{
        data: LayerConfigLists;
      }>(
        `/panel/items/three_d_tiles?fields=layer_id,layer_alias,active,visible,opacity,point_color,point_size,category.*,preview,description&sort=layer_alias&${
          categoryId === staticKey.other
            ? `filter[category][_null]=true`
            : `filter[category][category_id][_eq]=${categoryId}`
        }`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + authStore.accessToken,
          },
        }
      ),
    ]);
    catalogueData.value = getLayersArr({
      vectorTiles,
      rasterTiles,
      threeDTiles,
    });
    isFetching.value = false;
  }
};

watchEffect(async () => {
  if (selectedCategory.value) {
    fetchData(selectedCategory.value);
  }
});
</script>

<template>
  <div class="flex flex-col gap-3 p-5 h-full max-h-full">
    <div class="flex justify-between">
      <div class="flex items-center gap-3">
        <IcFileSort
          v-if="mode === ''"
          class="text-grey-300 w-4 h-4"
          :fontControlled="false"
        />
        <IcFileAdd
          v-else
          class="text-grey-300 w-4 h-4"
          :fontControlled="false"
        />
        <h1 class="text-grey-50 text-xs">
          {{
            mode === "loadlocal"
              ? "Load Local Data"
              : mode === "upload"
              ? "Upload Data"
              : isOption
              ? "Load Local Data/Upload Data"
              : "Data Catalogue"
          }}
        </h1>
      </div>
      <button
        @click="
          () => {
            toggleCatalogue();
          }
        "
      >
        <IcCross class="w-4 h-4 text-grey-400" :fontControlled="false" />
      </button>
    </div>
    <div v-if="!mode" class="h-full flex max-h-[calc(100%-2.25rem)]">
      <div
        class="flex flex-col text-white border border-grey-700 rounded-l-xs gap-2 overflow-hidden w-60"
      >
        <MapManagementCatalogueCategories :disabled="isOption" />
        <div class="flex flex-col p-2 gap-2">
          <div class="border-t border-grey-700" />
          <UButton
            :ui="{ rounded: 'rounded-xxs' }"
            :label="!isOption ? 'Load Local/Upload Data' : 'Back to Catalogue'"
            variant="outline"
            color="brand"
            class="w-full justify-between text-xs"
            @click="
              () => {
                isOption = !isOption;
              }
            "
          >
            <template #trailing>
              <IcCloudUpload
                v-if="!isOption"
                class="w-3 h-3"
                :fontControlled="false"
              />
              <IcArrow v-else class="w-3 h-3" :fontControlled="false" />
            </template>
          </UButton>
        </div>
      </div>
      <MapManagementCatalogueLists
        :isOption="isOption"
        :isFetching="isFetching"
        :mode="mode"
        :changeMode="changeMode"
        :catalogueData="catalogueData"
      />
    </div>
    <MapManagementCatalogueLoadLocalData
      v-if="mode === 'loadlocal'"
      @handle-success="
        () => {
          changeMode('');
          isOption = false;
          fetchData(staticKey.loadedData);
        }
      "
      @handle-cancel="changeMode('')"
    />
    <MapManagementCatalogueUpload
      v-if="mode === 'upload'"
      @refresh-listed-layers="
        () => {
          if (selectedCategory) fetchData(selectedCategory);
        }
      "
      @handle-success="
        () => {
          changeMode('');
          isOption = false;
        }
      "
      @handle-cancel="changeMode('')"
    />
  </div>
</template>
