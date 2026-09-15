<script lang="ts" setup>
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";
import IcMarkerStyle from "~/assets/icons/ic-marker-style.svg";
import { TransitionRoot } from "@headlessui/vue";
import type { RasterTiles } from "~/utils/types";
import { uncategorizedAlias } from "~/constants";
import { storeToRefs } from "pinia";
import { provide } from "vue";

const props = defineProps<{
  order: number;
  groupOrder: number;
  filtered: boolean;
  layerItem: RasterTiles;
}>();

const emit = defineEmits<{
  updateDragItem: [order: { groupOrder: number; itemOrder: number }];
  updateDragOverItem: [order: { groupOrder: number; itemOrder: number }];
  handleChangeOrder: [];
}>();

const store = useMapRef();
const { map } = storeToRefs(store);

const storeLayer = useMapLayer();
const { handleVisibility } = storeLayer;

const groupIndex = computed(() => {
  if (storeLayer.groupedActiveLayers)
    if (props.layerItem.category) {
      return storeLayer.groupedActiveLayers.findIndex(
        (el) => el.label === props.layerItem.category?.category_name
      );
    } else {
      return storeLayer.groupedActiveLayers.findIndex(
        (el) => el.label === uncategorizedAlias
      );
    }
});

provide("groupIndexProvider", groupIndex.value);

const layerIndex = computed(() => {
  if (groupIndex.value !== undefined) {
    if (storeLayer?.groupedActiveLayers?.[groupIndex.value]?.layerLists)
      return storeLayer.groupedActiveLayers[
        groupIndex.value
      ].layerLists.findIndex((el) => el.layer_id === props.layerItem.layer_id);
  }
});

provide("layerIndexProvider", layerIndex.value);

const isShowStyling = ref(false);
const visibility = ref(props.layerItem.layer_style.layout_visibility);

const toggleVisibility = () => {
  if (props.layerItem.terrain_rgb) {
    if (visibility.value === "visible") {
      map.value?.setTerrain(null);
    } else {
      map.value?.setTerrain({
        source: props.layerItem.layer_id + "_terrain",
        exaggeration: 2,
      });
    }
  }
  if (groupIndex.value !== undefined && layerIndex.value !== undefined) {
    const currentVisibility =
      visibility.value === "visible" ? "none" : "visible";
    handleVisibility(groupIndex.value, layerIndex.value, currentVisibility);
    visibility.value = currentVisibility;
  }
  if (map.value) {
    if (
      map.value.getLayoutProperty(props.layerItem.layer_id, "visibility") ===
      "none"
    ) {
      map.value.setLayoutProperty(
        props.layerItem.layer_id,
        "visibility",
        "visible"
      );
    } else {
      map.value.setLayoutProperty(
        props.layerItem.layer_id,
        "visibility",
        "none"
      );
    }
  }
};

const opacity = ref<number>(props.layerItem.opacity || 0);
const updateOpacity = (value: number) => {
  opacity.value = value / 100;
};
</script>

<template>
  <div
    @dragenter="
      () => {
        emit('updateDragOverItem', {
          groupOrder,
          itemOrder: order,
        });
      }
    "
    @drop="
      () => {
        emit('handleChangeOrder');
      }
    "
    @dragover="(e) => e.preventDefault()"
  >
    <div
      :draggable="filtered ? false : true"
      @dragstart="
        (ev) => {
          emit('updateDragItem', {
            groupOrder,
            itemOrder: order,
          });
        }
      "
      :class="[
        isShowStyling
          ? 'bg-grey-700'
          : 'bg-transparent hover:ring-1 hover:ring-grey-500',
        filtered ? 'cursor-pointer' : 'cursor-grab',
        'rounded-xxs p-2 flex justify-between items-center gap-2 w-full ',
      ]"
    >
      <div class="w-8/12">
        <p
          :class="[
            visibility === 'visible' ? 'text-grey-200' : 'text-grey-500',
            'truncate',
          ]"
        >
          {{ layerItem.layer_alias }}
        </p>
        <p
          :class="[
            visibility === 'visible' ? 'text-grey-400' : 'text-grey-500',
            'truncate',
          ]"
        >
          {{ layerItem.geometry_type }}
        </p>
      </div>
      <div class="flex gap-2 items-center justify-end w-4/12">
        <button
          :disabled="visibility === 'none'"
          @click="isShowStyling = !isShowStyling"
        >
          <IcMarkerStyle
            :class="[
              visibility === 'visible'
                ? isShowStyling
                  ? 'text-brand-500'
                  : 'text-grey-400'
                : 'text-grey-500',
              ,
              'w-3 h-3',
            ]"
            :fontControlled="false"
          />
        </button>
        <button
          :disabled="isShowStyling"
          @click="toggleVisibility"
          :class="isShowStyling ? 'text-grey-600' : 'text-grey-400'"
        >
          <IcEyeCrossed
            v-if="visibility === 'none'"
            class="w-3 h-3"
            :fontControlled="false"
          />
          <IcEye v-else class="w-3 h-3" :fontControlled="false" />
        </button>
        <MapManagementMenu :item="layerItem" :disabled="isShowStyling" />
      </div>
    </div>
    <TransitionRoot
      :show="isShowStyling"
      enter="transition duration-500 ease-in-out"
      enterFrom="transform max-h-0 opacity-0"
      enterTo="transform max-h-96 opacity-100"
      leave="transition duration-500 ease-in-out"
      leaveFrom="transform max-h-96 opacity-100"
      leaveTo="transform max-h-0 opacity-0"
      class="transition-all duration-500 ease-in-out"
    >
      <MapManagementStyling
        :source="layerItem.source"
        :opacity="layerItem.opacity"
        :layerId="layerItem.layer_id"
        @update-opacity="updateOpacity"
      />
    </TransitionRoot>
  </div>
</template>
