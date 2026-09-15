<script lang="ts" setup>
import { Menu, MenuButton, MenuItems, MenuItem } from "@headlessui/vue";
import { useFloating, offset, flip, size } from "@floating-ui/vue";
import IcArrow from "~/assets/icons/ic-arrow-reg.svg";
import IcMarkerStyle from "~/assets/icons/ic-marker-style.svg";
import { inject } from "vue";
import { geomTypeCircle, geomTypeLine, geomTypePolygon } from "~/constants";

const props = defineProps<{
  source: string;
  opacity: number;
  layerId: string;
  geometryType?: string;
}>();

const emit = defineEmits<{
  updateOpacity: [opacity: number];
}>();

const rangeValue = ref(props.opacity * 100);
const colorValue = ref("");
const groupIndex = inject("groupIndexProvider");
const layerIndex = inject("layerIndexProvider");

const reference = ref(null);
const floating = ref(null);
const { floatingStyles } = useFloating(reference, floating, {
  placement: "bottom-start",
  middleware: [
    offset(10),
    flip(),
    size({
      apply({ rects, elements }) {
        Object.assign(elements.floating.style, {
          width: `${rects.reference.width}px`,
        });
      },
    }),
  ],
});

const store = useMapLayer();
const { updateLayerOpacity } = store;
const mapStore = useMapRef();
const { map } = storeToRefs(mapStore);

const paintPropertyName = () => {
  switch (true) {
    case props.source === "raster_tiles":
      return "raster-opacity";
    case props.source === "vector_tiles" &&
      props.geometryType === geomTypeCircle:
      return "circle-opacity";
    case props.source === "vector_tiles" && props.geometryType === geomTypeLine:
      return "line-opacity";
    case props.source === "vector_tiles" &&
      props.geometryType === geomTypePolygon:
      return "fill-opacity";
    default:
      return "";
  }
};

const handleChangeOpacity = (e: Event) => {
  emit("updateOpacity", parseInt((e.target as HTMLInputElement).value));

  const decimalOpacity = parseInt((e.target as HTMLInputElement).value) / 100;
  updateLayerOpacity(
    groupIndex as number,
    layerIndex as number,
    decimalOpacity
  );
  if (map.value && props.source !== "three_d_tiles") {
    map.value.setPaintProperty(
      props.layerId,
      paintPropertyName(),
      decimalOpacity
    );
  }
};
</script>

<template>
  <div>
    <div class="bg-grey-800 rounded-xxs">
      <div class="p-2 space-y-2">
        <div class="flex justify-between items-center text-2xs">
          <p class="text-grey-200">Opacity</p>
          <p class="text-grey-400">Styling</p>
        </div>
        <div class="flex items-center justify-between gap-2">
          <URange
            v-model="rangeValue"
            @change="handleChangeOpacity"
            name="range"
            size="sm"
            :ui="{
              background: 'bg-grey-800',
              progress: { background: 'bg-grey-500 dark:bg-grey-400' },
              thumb: {
                background:
                  '[&::-webkit-slider-thumb]:bg-grey-400 [&::-webkit-slider-thumb]:dark:bg-grey-400',
                ring: '[&::-webkit-slider-thumb]:ring-0 [&::-webkit-slider-thumb]:ring-current',
              },
              track: {
                background:
                  '[&::-webkit-slider-runnable-track]:bg-grey-700 [&::-moz-range-track]:bg-grey-700 [&::-webkit-slider-runnable-track]:dark:bg-grey-700 [&::-moz-range-track]:dark:bg-grey-700',
              },
            }"
          />
          <div
            class="w-10 text-center p-1 text-2xs text-grey-200 font-medium rounded-xxs border border-grey-600 bg-grey-700"
          >
            {{ rangeValue }}%
          </div>
        </div>
      </div>
      <!-- <div class="p-2 space-y-2">
        <div class="flex justify-between items-center text-2xs">
          <p class="text-grey-200">Fill Color</p>
          <p class="text-grey-400">Styling</p>
        </div>
        <Menu as="div" class="relative inline-block w-full">
          <MenuButton
            ref="reference"
            class="w-full p-2 bg-grey-700 text-2xs flex items-center justify-between rounded-xxs"
          >
            Selection
            <IcArrow class="w-4 h-4 rotate-180" :fontControlled="false" />
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
                class="absolute overflow-scroll p-2 flex flex-col gap-2 rounded-xxs bg-white shadow-lg ring-1 ring-grey-700 focus:outline-none"
              >
                <MenuItem v-slot="{ active }">
                  <button
                    @click="() => {}"
                    :class="[
                      active ? 'bg-grey-700' : 'bg-transparent text-grey-200',
                      'group flex w-full items-center gap-3 rounded-xxs p-2 text-xs text-white',
                    ]"
                  >
                    Option 1
                  </button>
                </MenuItem>
                <MenuItem v-slot="{ active }">
                  <button
                    @click="() => {}"
                    :class="[
                      active ? 'bg-grey-700' : 'bg-transparent text-grey-200',
                      'group flex w-full items-center gap-3 rounded-xxs p-2 text-xs text-white',
                    ]"
                  >
                    Option 2
                  </button>
                </MenuItem>
                <MenuItem v-slot="{ active }">
                  <button
                    @click="() => {}"
                    :class="[
                      active ? 'bg-grey-700' : 'bg-transparent text-grey-200',
                      'group flex w-full items-center gap-3 rounded-xxs p-2 text-xs text-white',
                    ]"
                  >
                    Option 3
                  </button>
                </MenuItem>
              </MenuItems>
            </teleport>
          </transition>
        </Menu>
      </div> -->
      <!-- <div class="p-2 space-y-2">
        <div class="flex justify-between items-center text-2xs">
          <p class="text-grey-200">Stroke</p>
          <p class="text-grey-400">Styling</p>
        </div>
        <div class="flex justify-between items-center text-2xs">
          <p class="text-grey-200">Color</p>
          <UInput
            v-model="colorValue"
            type="color"
            variant="none"
            :padded="false"
            :ui="{ rounded: 'rounded-xxs' }"
            inputClass="cursor-pointer [&::-webkit-color-swatch]:rounded-[2px] [&::-webkit-color-swatch]:border-0 bg-grey-700 w-28 focus:ring-0 focus:border-none border-none pl-2 py-1"
          >
            <template #trailing>
              <IcArrow
                class="w-4 h-4 rotate-180"
                :fontControlled="false"
              /> </template
          ></UInput>
        </div>
      </div> -->
    </div>
  </div>
</template>
