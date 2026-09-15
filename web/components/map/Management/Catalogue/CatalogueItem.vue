<script setup lang="ts">
import { TransitionRoot } from "@headlessui/vue";

import IcHelp from "~/assets/icons/ic-help.svg";
import IcSpinner from "~/assets/icons/ic-spinner.svg";
import IcCheck from "~/assets/icons/ic-check.svg";
import IcMapLayerA from "~/assets/icons/ic-map-layer-a.svg";
import IcCross from "~/assets/icons/ic-cross.svg";

import type {
  VectorTiles,
  RasterTiles,
  ThreeDTiles,
  LoadedGeoJson,
} from "~/utils/types";

defineProps<{
  item: VectorTiles | RasterTiles | ThreeDTiles | LoadedGeoJson;
  isActive: boolean;
}>();

const emit = defineEmits<{
  removeLoadedLayer: [layerId: string];
}>();

const mapLayerStore = useMapLayer();
const { deleteLoadedGeoJsonData } = useIDB();

const isLoad = ref(false);
const hover = ref(false);

const addLayer = (
  item: VectorTiles | RasterTiles | ThreeDTiles | LoadedGeoJson
) => {
  isLoad.value = true;
  setTimeout(() => {
    isLoad.value = false;
    mapLayerStore.addLayer(item);
  }, 750);
};

const removeLayer = (
  item: VectorTiles | RasterTiles | ThreeDTiles | LoadedGeoJson
) => {
  isLoad.value = true;
  setTimeout(() => {
    isLoad.value = false;
    mapLayerStore.removeLayer(item);
  }, 750);
};

const removeLoadedData = async (item: LoadedGeoJson) => {
  emit("removeLoadedLayer", item.layer_id);
  await deleteLoadedGeoJsonData(item.layer_id);
};

const getImageUrl = (file: File) => {
  return URL.createObjectURL(file);
};
</script>

<template>
  <div
    class="flex flex-col gap-2 border border-grey-700 rounded-xs p-2"
    @mouseover="hover = true"
    @mouseleave="hover = false"
  >
    <div class="flex items-center justify-between">
      <div class="flex items-center gap-1">
        <UBadge
          :ui="{ rounded: 'rounded-xxs' }"
          variant="outline"
          class="flex items-center gap-1 bg-grey-800 text-grey-50 mt-[1px]"
          color="grey"
        >
          <IcMapLayerA></IcMapLayerA>
          <p>{{ item.geometry_type }}</p>
        </UBadge>
        <TransitionRoot
          :show="isActive"
          enter="transition-all duration-1000 ease-in-out"
          enterFrom="transform opacity-0"
          enterTo="transform opacity-100"
          leave="transition-all duration-1000 ease-in-out"
          leaveFrom="transform opacity-100"
          leaveTo="transform opacity-0"
        >
          <UBadge
            :ui="{ rounded: 'rounded-xxs' }"
            variant="outline"
            color="green"
            class="gap-1 bg-grey-800"
          >
            <IcCheck></IcCheck>
            <p>In Map</p>
          </UBadge>
        </TransitionRoot>
      </div>
      <button v-if="item.source === 'loaded_geojson' && hover">
        <IcCross class="text-grey-50" @click="removeLoadedData(item)" />
      </button>
    </div>
    <NuxtImg
      v-if="item.preview && item.source !== 'loaded_geojson'"
      provider="directus"
      :src="item.preview"
      class="h-24 w-full object-cover object-center rounded-xxs"
    />
    <NuxtImg
      v-else-if="item.preview && item.source === 'loaded_geojson'"
      :src="getImageUrl(item.preview)"
      class="h-24 w-full object-cover object-center rounded-xxs"
    />
    <img
      v-else
      src="~/assets/images/catalogue-item.jpeg"
      alt="catalogue-item"
      class="h-24 w-full object-cover object-center rounded-xxs"
    />
    <article>
      <UTooltip
        class="flex items-center justify-between gap-2"
        :popper="{ placement: 'top-start', offsetDistance: 8 }"
        :text="
          item.source === vector_tiles
            ? item.layer_alias ?? item.layer_name
            : item.layer_alias
        "
      >
        <div class="flex items-center justify-between gap-2 w-full">
          <h5 class="text-xs text-grey-50 truncate">
            {{
              item.source === "vector_tiles"
                ? item.layer_alias ?? item.layer_name
                : item.layer_alias
            }}
          </h5>

          <button>
            <IcHelp class="w-3 h-3 hidden" :fontControlled="false" />
          </button>
        </div>
      </UTooltip>
      <p class="line-clamp-3 text-grey-500 text-2xs">Description</p>
    </article>
    <UButton
      :ui="{ rounded: 'rounded-xxs' }"
      :label="isActive ? 'Remove' : 'Add to Map'"
      :class="[
        !isActive ? 'transition-all duration-500 ease-in-out' : '',
        'w-full justify-center h-9',
      ]"
      :variant="isActive ? 'outline' : 'solid'"
      :color="isActive ? 'brand' : 'grey'"
      @click="isActive ? removeLayer(item) : addLayer(item)"
    >
      <IcSpinner
        :class="[
          isActive ? 'text-brand-500' : 'text-white',
          'w-4 h-4 animate-spin',
        ]"
        :fontControlled="false"
        v-if="isLoad"
      />
    </UButton>
  </div>
</template>
