<script lang="ts" setup>
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";
import IcMarkerStyle from "~/assets/icons/ic-marker-style.svg";
import { TransitionRoot } from "@headlessui/vue";
import type {
  LineStyles,
  FillStyles,
  CircleStyles,
  VectorTiles,
} from "~/utils/types";
import {
  geomTypeCircle,
  geomTypeLine,
  geomTypePolygon,
  geomTypeSymbol,
} from "~/constants";
import { storeToRefs } from "pinia";
import { provide, watchEffect } from "vue";

const props = defineProps<{
  order: number;
  groupOrder: number;
  filtered: boolean;
  layerItem: VectorTiles | LoadedGeoJson;
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
  if (!storeLayer.groupedActiveLayers) return undefined;

  // Find the group that contains this layer by searching through all groups
  return storeLayer.groupedActiveLayers.findIndex((group) =>
    group.layerLists.some(
      (layer) => layer.layer_id === props.layerItem.layer_id
    )
  );
});

watchEffect(() => {
  if (!map.value || !props.layerItem.category) return;

  const categoryName = props.layerItem.category.category_name.toLowerCase();
  const layerId = props.layerItem.layer_id;
  const mapInstance = map.value;

  const allLayers = mapInstance.getStyle().layers;

  if (!allLayers.some((layer) => layer.id === layerId)) return;

  if (categoryName === "others") {
    // Force "others" layers to the absolute top
    mapInstance.moveLayer(layerId);
  } else {
    const othersLayers = allLayers.filter((layer) => {
      const layerMeta = storeLayer.groupedActiveLayers?.find((group) =>
        group.layerLists.some((item) => item.layer_id === layer.id)
      );
      return layerMeta?.label.toLowerCase() === "others";
    });

    if (othersLayers.length > 0) {
      const lastOthersLayer = othersLayers[0].id;
      mapInstance.moveLayer(layerId, lastOthersLayer);
    }
  }
});

provide("groupIndexProvider", groupIndex.value);

const layerIndex = computed(() => {
  if (groupIndex.value !== undefined && groupIndex.value !== -1) {
    const layerLists =
      storeLayer.groupedActiveLayers?.[groupIndex.value]?.layerLists;
    if (layerLists) {
      return layerLists.findIndex(
        (el) => el.layer_id === props.layerItem.layer_id
      );
    }
  }
  return undefined;
});

provide("layerIndexProvider", layerIndex.value);

const isShowStyling = ref(false);
const visibility = ref<string>(
  props.layerItem.layer_style.layout_visibility ?? "visible"
);
const opacity = ref<string>(
  props.layerItem.geometry_type === geomTypeCircle
    ? (props.layerItem.layer_style as CircleStyles).paint_circle_opacity ?? "1"
    : props.layerItem.geometry_type === geomTypePolygon
    ? (props.layerItem.layer_style as FillStyles).paint_fill_opacity ?? "1"
    : props.layerItem.geometry_type === geomTypeLine
    ? (props.layerItem.layer_style as LineStyles).paint_line_opacity ?? "1"
    : "1"
);

// Sync local visibility ref when props change (e.g., from "hide all" action)
watch(
  () => props.layerItem.layer_style.layout_visibility,
  (newVisibility) => {
    visibility.value = newVisibility ?? "visible";
  }
);

const updateOpacity = (value: number) => {
  opacity.value = (value / 100).toString();
};

const toggleVisibility = () => {
  const newVisibility = visibility.value === "visible" ? "none" : "visible";

  // Update local reactive state
  visibility.value = newVisibility;

  // Update store state - the Vector.vue watcher will sync to the map
  if (
    groupIndex.value !== undefined &&
    groupIndex.value !== -1 &&
    layerIndex.value !== undefined &&
    layerIndex.value !== -1
  ) {
    handleVisibility(groupIndex.value, layerIndex.value, newVisibility);
  }
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
          ? 'bg-transparent'
          : 'bg-transparent hover:ring-1 hover:ring-grey-500',
        filtered ? 'cursor-pointer' : 'cursor-grab',
        'rounded-xxs p-2 flex justify-between items-center gap-2 w-full transition-all duration-500 ease',
        layerItem.category?.category_name.toLowerCase() === 'others'
          ? 'border-l-2 border-brand-500'
          : '',
      ]"
    >
      <div class="w-8/12">
        <UTooltip
          :text="
            layerItem.layer_alias
              ? layerItem.layer_alias.replace(/_/g, ' ')
              : ''
          "
          :popper="{ placement: 'right-end', offsetDistance: 10 }"
          class="flex flex-col rounded-lg text-green-300"
        >
          <p
            :class="[
              visibility === 'visible' ? 'text-grey-700' : 'text-grey-500',
              'truncate text-sm',
            ]"
          >
            {{ layerItem.layer_alias }}
          </p>
          <p
            :class="[
              visibility === 'visible' ? 'text-grey-700' : 'text-grey-500',
              'truncate text-xs',
            ]"
          >
            {{ layerItem.geometry_type }}
          </p>
        </UTooltip>
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
                  : 'text-grey-700'
                : 'text-grey-500',
              'w-3 h-3',
            ]"
            :fontControlled="false"
          />
        </button>
        <button
          :disabled="isShowStyling"
          @click="toggleVisibility"
          :class="isShowStyling ? 'text-grey-600' : 'text-grey-700'"
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
      <MapManagementStylingCircle
        v-if="layerItem.geometry_type === geomTypeCircle"
        :layerItem="layerItem"
      />
      <MapManagementStylingLine
        v-else-if="layerItem.geometry_type === geomTypeLine"
        :layerItem="layerItem"
      />
      <MapManagementStylingFill
        v-else-if="layerItem.geometry_type === geomTypePolygon"
        :layerItem="layerItem"
      />
      <MapManagementStylingSymbol
        v-else-if="layerItem.geometry_type === geomTypeSymbol"
        :layerItem="layerItem"
      />
      <MapManagementStyling
        v-else
        :source="layerItem.source"
        :opacity="opacity ? parseFloat(opacity) : 0"
        :layerId="layerItem.layer_id"
        :geometryType="layerItem.geometry_type"
        @update-opacity="updateOpacity"
      />
    </TransitionRoot>
  </div>
</template>
