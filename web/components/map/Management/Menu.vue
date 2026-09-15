<script setup lang="ts">
import { Menu, MenuButton, MenuItems, MenuItem } from "@headlessui/vue";
import { useFloating, offset, flip } from "@floating-ui/vue";
import IcMenuDots from "~/assets/icons/ic-menu-dots.svg";
import type { LngLatBoundsLike } from "maplibre-gl";
import bbox from "@turf/bbox";

defineProps<{
  disabled: boolean;
  item: LayerLists;
}>();

const store = useTableData();
const { toggleTable } = store;

const mapStore = useMapRef();
const { map } = storeToRefs(mapStore);

const mapLayerStore = useMapLayer();
const tableDataStore = useTableData();

const reference = ref(null);
const floating = ref(null);
const { floatingStyles } = useFloating(reference, floating, {
  placement: "right-start",
  middleware: [offset(10), flip()],
});
</script>

<template>
  <Menu as="div" class="relative inline-block">
    <MenuButton :disabled="disabled" ref="reference" class="align-middle">
      <IcMenuDots
        :class="['w-3 h-3', disabled ? 'text-grey-600' : 'text-grey-400']"
        :fontControlled="false"
      />
    </MenuButton>

    <transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="transform scale-95 opacity-0"
      enter-to-class="transform scale-100 opacity-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="transform scale-100 opacity-100"
      leave-to-class="transform scale-95 opacity-0"
    >
      <teleport to="body">
        <MenuItems
          ref="floating"
          :style="floatingStyles"
          class="absolute -right-2 translate-x-full translate-y-full bottom-5 w-56 h-fit p-2 flex flex-col gap-2 rounded-xxs bg-white shadow-lg ring-1 ring-grey-700 focus:outline-none z-50"
        >
          <MenuItem v-slot="{ active }">
            <button
              @click="
                () => {
                  if (item.source === 'three_d_tiles') {
                    const data = mapLayerStore.threeDLayerCenter;
                    const current =
                      data[data.findIndex((el) => el.id === item.layer_id)];
                    map?.flyTo({ center: current.center, zoom: current.zoom });
                  } else {
                    if ((item as VectorTiles | RasterTiles).bounds) {
                      map?.fitBounds(bbox(item.bounds) as LngLatBoundsLike, {
                        padding: {
                          top: 100,
                          bottom: 150,
                          left: 300,
                          right: 50,
                        },
                      });
                    }
                  }
                }
              "
              :class="[
                active ? 'bg-grey-700' : 'bg-transparent text-grey-900',
                'group flex w-full items-center gap-3 rounded-xxs p-2 text-xs text-gray-800 hover:bg-grey-100',
              ]"
            >
              Zoom To Fit
            </button>
          </MenuItem>
          <MenuItem v-slot="{ active, close }" as="div">
            <button
              :disabled="item.source !== 'vector_tiles'"
              @click="
                () => {
                  tableDataStore.setActiveCollection(
                    (item as VectorTiles).layer_name,
                  );
                  toggleTable();
                  close();
                }
              "
              :class="[
                active && item.source === 'vector_tiles'
                  ? 'bg-grey-700'
                  : 'bg-transparent text-grey-200',
                item.source !== 'vector_tiles'
                  ? 'text-grey-500'
                  : 'text-grey-900',
                'group flex w-full items-center gap-3 rounded-xxs p-2 text-xs text-gray-800 hover:bg-grey-100',
              ]"
            >
              View Data Table
            </button>
          </MenuItem>
        </MenuItems>
      </teleport>
    </transition>
  </Menu>
</template>
