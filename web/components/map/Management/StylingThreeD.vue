<script lang="ts" setup>
import { inject } from "vue";

const props = defineProps<{
  layerItem: ThreeDTiles;
}>();

const emit = defineEmits<{
  updateOpacity: [opacity: number];
}>();

const rangeValue = ref(props.layerItem.opacity * 100);
const pointSize = ref(props.layerItem.point_size ?? 1);
const fillColor = ref(props.layerItem.point_color ?? "#000000");
const groupIndex = inject("groupIndexProvider");
const layerIndex = inject("layerIndexProvider");

const store = useMapLayer();
const { updateLayerProperty } = store;

const handleChangeProperty = (
  propType: "paint" | "layout" | "3d",
  value: string | number,
  propName: string
) => {
  updateLayerProperty(
    groupIndex as number,
    layerIndex as number,
    propType,
    propName,
    value,
    props.layerItem.layer_id
  );
};
</script>

<template>
  <div>
    <div class="bg-grey-800 rounded-xxs p-2 space-y-1">
      <p class="text-grey-50 text-2xs">Appearance</p>
      <div class="grid grid-cols-2 gap-1">
        <p class="text-grey-400 text-2xs self-center">Size</p>
        <UInput
          v-model="pointSize"
          @blur="
            (e:Event) => {
              handleChangeProperty('3d',parseFloat((e.target as HTMLInputElement).value as string), 'point_size');
            }
          "
          type="number"
          color="gray"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Point Size"
          size="2xs"
          min="0"
          max="100"
        >
          <template #trailing>
            <span class="text-grey-400 text-2xs">px</span>
          </template>
        </UInput>
      </div>
    </div>
    <div class="bg-grey-800 rounded-xxs p-2 space-y-1">
      <p class="text-grey-50 text-2xs">Color</p>
      <p class="text-grey-400 text-2xs">Point Color Opacity</p>
      <div class="grid grid-cols-4 gap-1">
        <URange
          v-model="rangeValue"
          @input="
            (e:Event) => {
              handleChangeProperty('3d',parseFloat((e.target as HTMLInputElement).value as string)/100, 'opacity');
            }
          "
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
          :min="0"
          :max="100"
          class="self-center col-span-3"
        />
        <UInput
          v-model="rangeValue"
          @blur="
             (e:Event) => {
              handleChangeProperty('3d',parseFloat((e.target as HTMLInputElement).value as string)/100, 'opacity');
            }
          "
          type="number"
          color="gray"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Point Opacity"
          size="2xs"
          min="0"
          max="100"
        >
          <template #trailing>
            <span class="text-grey-400 text-2xs">%</span>
          </template>
        </UInput>
      </div>
      <CoreInputColor
        v-model="fillColor"
        :updateColor="
          (color:string) => {
            handleChangeProperty('3d', color, 'point_color');
          }
        "
      />
    </div>
  </div>
</template>
