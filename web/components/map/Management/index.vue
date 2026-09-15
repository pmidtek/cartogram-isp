<script setup lang="ts">
import { ref, computed } from "vue";
import IcFileSort from "~/assets/icons/ic-file-sort.svg";
import IcArrow from "@/assets/icons/ic-arrow-fat.svg";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";
import type { LayerGroupedByCategory } from "~/utils/types";

const store = useMapLayer();
const storeCatalogue = useCatalogue();
const mapRefStore = useMapRef();
const { toggleCatalogue } = storeCatalogue;
const { toggleCategoryVisibility } = store;

const filterRef = ref("");

const groupedByCategory = computed(() => {
  if (!store.groupedActiveLayers) return [];

  return store.groupedActiveLayers.map((layerGroup) => {
    // Sort layers alphabetically by alias or layer_id
    const sortedLayers = [...layerGroup.layerLists].sort((a, b) => {
      const aLabel = (a.layer_alias || a.layer_id).toUpperCase();
      const bLabel = (b.layer_alias || b.layer_id).toUpperCase();
      return aLabel.localeCompare(bLabel);
    });

    return {
      category: layerGroup.label,
      layers: sortedLayers,
    };
  });
});

const filteredGroupedLayers = computed(() => {
  const filter = filterRef.value.toLowerCase();
  if (!filter) return groupedByCategory.value;

  return groupedByCategory.value
    .map((group) => ({
      category: group.category,
      layers: group.layers.filter(
        (layer) =>
          layer.layer_alias?.toLowerCase().includes(filter) ||
          layer.layer_id?.toLowerCase().includes(filter) ||
          layer.category?.category_name?.toLowerCase().includes(filter) ||
          layer.category?.parent?.category_name?.toLowerCase().includes(filter)
      ),
    }))
    .filter((group) => group.layers.length > 0);
});

const expandedCategories = ref<Set<string>>(new Set());

const toggleCategory = (category: string) => {
  if (expandedCategories.value.has(category)) {
    expandedCategories.value.delete(category);
  } else {
    expandedCategories.value.add(category);
  }
};

const categoryHasData = (group: { layers: any[] }) => {
  return group.layers.some((layer) => layer.layer_id && layer.layer_alias);
};

// Check if all layers in a category are visible
const isCategoryVisible = (layers: any[]) => {
  if (!layers || layers.length === 0) return true;
  return layers.every(
    (layer) =>
      layer.layer_style.layout_visibility === "visible" ||
      !layer.layer_style.layout_visibility
  );
};

// Toggle visibility for all layers in a category
const toggleCategoryVisibilityHandler = (category: string, event: Event) => {
  event.stopPropagation(); // Prevent category expand/collapse
  toggleCategoryVisibility(category);
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
  if (dragItem.value === null || dragOverItem.value === null) return;

  const copiedGroupedActiveLayers: LayerGroupedByCategory[] = JSON.parse(
    JSON.stringify(store.groupedActiveLayers)
  );
  const movedItem =
    copiedGroupedActiveLayers[dragItem.value.groupOrder].layerLists[
      dragItem.value.itemOrder
    ];
  if (mapRefStore.map?.getLayer(movedItem.layer_id)) {
    mapRefStore.map?.removeLayer(movedItem.layer_id);
  }

  copiedGroupedActiveLayers[dragItem.value.groupOrder].layerLists.splice(
    dragItem.value.itemOrder,
    1
  );
  copiedGroupedActiveLayers[dragOverItem.value.groupOrder].layerLists.splice(
    dragOverItem.value.itemOrder,
    0,
    movedItem
  );

  store.groupedActiveLayers = copiedGroupedActiveLayers;
};
</script>

<template>
  <div class="p-3 space-y-1">
    <h2 class="text-md text-black">Layer Management</h2>
    <p
      class="text-[10px] font-normal font-['Raleway'] leading-none text-grey-700"
    >
      Manage active layer to be displayed on map
    </p>
  </div>
  <hr class="mx-3" />
  <div class="p-3">
    <UInput
      v-model="filterRef"
      :ui="{ rounded: 'rounded-xxs' }"
      placeholder="Filter layers..."
    />
  </div>
  <hr class="mx-3" />

  <div class="px-3 py-1 my-3 flex-1 overflow-y-auto hide-scrollbar">
    <div
      v-for="(group, index) in filteredGroupedLayers"
      :key="group.category"
      class="mb-4 border-[1px] rounded-xs"
    >
      <div
        v-if="categoryHasData(group)"
        class="p-2 cursor-pointer flex justify-between items-center text-black text-sm font-normal font-raleway"
        @click="toggleCategory(group.category)"
      >
        <span class="text-normal">{{ group.category }}</span>
        <span
          class="transition-transform duration-300 ease-in-out"
          :class="{
            'transform rotate-180': expandedCategories.has(group.category),
          }"
        >
          <IcArrow class="rotate-90" />
        </span>
      </div>
      <div
        v-if="categoryHasData(group)"
        class="overflow-hidden transition-all duration-300 ease-in-out"
        :class="{
          'max-h-0': !expandedCategories.has(group.category),
          'max-h-[2000rem] overflow-y-auto': expandedCategories.has(
            group.category
          ),
        }"
      >
        <div class="p-2 space-y-2">
          <template
            v-for="(layer, layerIndex) in group.layers"
            :key="layer.layer_id"
          >
            <MapManagementLayerVector
              v-if="
                layer.source === 'vector_tiles' ||
                layer.source === 'loaded_geojson'
              "
              :filtered="!!filterRef"
              :order="layerIndex"
              :groupOrder="index"
              :layerItem="layer"
              @update-drag-item="updateDragItem"
              @update-drag-over-item="updateDragOverItem"
              @handle-change-order="handleChangeOrder"
            />
            <MapManagementLayerRaster
              v-else-if="layer.source === 'raster_tiles'"
              :filtered="!!filterRef"
              :order="layerIndex"
              :groupOrder="index"
              :layerItem="layer"
              @update-drag-item="updateDragItem"
              @update-drag-over-item="updateDragOverItem"
              @handle-change-order="handleChangeOrder"
            />
            <MapManagementLayerThreeD
              v-else-if="layer.source === 'three_d_tiles'"
              :filtered="!!filterRef"
              :order="layerIndex"
              :groupOrder="index"
              :layerItem="layer"
            />
          </template>
        </div>
      </div>
    </div>
  </div>
</template>
