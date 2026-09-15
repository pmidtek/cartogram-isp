<script setup lang="ts">
import type { LayerGroupedByCategory, LayerLists } from "~/utils/types";
import {
  Disclosure,
  DisclosureButton,
  DisclosurePanel,
  TransitionRoot,
} from "@headlessui/vue";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";
import { geomTypeThreeD } from "~/constants";

const props = defineProps<{
  order: number;
  filtered: boolean;
  defaultOpen: boolean;
  label: string;
  layerLists: LayerLists[];
  parentGroupLabel?: string;
}>();

const emit = defineEmits<{
  updateDragGroup: [order: number];
  updateDragOverGroup: [order: number];
  handleChangeGroupOrder: [];
}>();

const isPanelOpen = ref(props.defaultOpen);

const store = useMapLayer();
const { toggleCategoryVisibility } = store;
const mapRefStore = useMapRef();

// Compute if all layers in this category are visible
const allLayersVisible = computed(() => {
  if (!props.layerLists || props.layerLists.length === 0) return true;
  return props.layerLists.every(
    (layer) =>
      layer.layer_style.layout_visibility === "visible" ||
      !layer.layer_style.layout_visibility
  );
});

const toggleAllVisibility = (event: Event) => {
  event.stopPropagation(); // Prevent disclosure toggle
  toggleCategoryVisibility(props.label, props.parentGroupLabel);
};

const dragItem = ref<null | { groupOrder: number; itemOrder: number }>(null);
const updateDragItem = (order: { groupOrder: number; itemOrder: number }) => {
  dragItem.value = order;
};
const dragOverItem = ref<null | { groupOrder: number; itemOrder: number }>(
  null
);
const updateDragOverItem = (order: {
  groupOrder: number;
  itemOrder: number;
}) => {
  dragOverItem.value = order;
};
const handleChangeOrder = () => {
  const copiedGroupedActiveLayers: LayerGroupedByCategory[] = JSON.parse(
    JSON.stringify(store.groupedActiveLayers)
  );
  const movedItem =
    copiedGroupedActiveLayers[dragItem.value!.groupOrder].layerLists[
      dragItem.value!.itemOrder
    ];
  if (mapRefStore.map?.getLayer(movedItem.layer_id)) {
    mapRefStore.map?.removeLayer(movedItem.layer_id);
  }

  copiedGroupedActiveLayers[dragItem.value!.groupOrder].layerLists.splice(
    dragItem.value!.itemOrder,
    1
  );
  copiedGroupedActiveLayers[dragItem.value!.groupOrder].layerLists.splice(
    dragOverItem.value!.itemOrder,
    0,
    movedItem
  );

  store.groupedActiveLayers = copiedGroupedActiveLayers;
};
</script>

<template>
  <Disclosure v-slot="{ open }">
    <DisclosureButton
      @click="() => (isPanelOpen = !isPanelOpen)"
      :draggable="
        label === geomTypeThreeD || label === 'Terrain'
          ? false
          : filtered
          ? false
          : true
      "
      @dragstart="
        (e) => {
          emit('updateDragGroup', order);
        }
      "
      @dragenter="
        () => {
          if (label !== geomTypeThreeD && label !== 'Terrain') {
            emit('updateDragOverGroup', order);
          }
        }
      "
      @drop="
        () => {
          if (label !== geomTypeThreeD && label !== 'Terrain') {
            emit('handleChangeGroupOrder');
          }
        }
      "
      @dragover="
        (e) => {
          e.preventDefault();
        }
      "
      :class="[
        filtered || label === geomTypeThreeD || label === 'Terrain'
          ? 'cursor-pointer'
          : 'cursor-grab',
        'text-sm text-grey-700 flex items-center justify-between w-full py-2',
      ]"
    >
      <span>{{ label }}</span>
      <div class="flex items-center gap-2">
        <button
          @click="toggleAllVisibility"
          class="text-grey-700 hover:text-brand-500 transition-colors"
          :title="allLayersVisible ? 'Hide all layers' : 'Show all layers'"
        >
          <IcEyeCrossed
            v-if="!allLayersVisible"
            class="w-3 h-3"
            :fontControlled="false"
          />
          <IcEye v-else class="w-3 h-3" :fontControlled="false" />
        </button>
        <div
          :class="[
            isPanelOpen ? '' : 'rotate-180',
            'text-grey-50 transition-all duration-300',
          ]"
        >
          <IcArrowReg :fontControlled="false" class="w-4 h-4 text-grey-400" />
        </div>
      </div>
    </DisclosureButton>
    <TransitionRoot
      appear
      :show="isPanelOpen"
      as="div"
      className="overflow-hidden"
      enter="transition-all ease-in duration-300"
      enterFrom="max-h-0"
      enterTo="max-h-[100rem]"
      leave="transition-all ease-out duration-300"
      leaveFrom="max-h-[100rem]"
      leaveTo="max-h-0"
    >
      <DisclosurePanel class="space-y-2 p-[1px] text-xs">
        <template
          v-for="(item, index) in props.layerLists"
          :key="item.layer_id"
        >
          <MapManagementLayerVector
            v-if="
              item.source === 'vector_tiles' || item.source === 'loaded_geojson'
            "
            :filtered="filtered"
            :order="index"
            :groupOrder="order"
            :layerItem="item"
            @update-drag-item="updateDragItem"
            @update-drag-over-item="updateDragOverItem"
            @handle-change-order="handleChangeOrder"
          />
          <MapManagementLayerRaster
            v-else-if="item.source === 'raster_tiles'"
            :filtered="filtered"
            :order="index"
            :groupOrder="order"
            :layerItem="item"
            @update-drag-item="updateDragItem"
            @update-drag-over-item="updateDragOverItem"
            @handle-change-order="handleChangeOrder"
          />
          <MapManagementLayerThreeD
            v-else-if="item.source === 'three_d_tiles'"
            :filtered="filtered"
            :order="index"
            :groupOrder="order"
            :layerItem="item"
          />
        </template>
      </DisclosurePanel>
    </TransitionRoot>
  </Disclosure>
</template>
