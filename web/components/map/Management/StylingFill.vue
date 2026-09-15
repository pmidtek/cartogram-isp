<script lang="ts" setup>
import { inject } from "vue";

const props = defineProps<{
  layerItem: VectorTiles | LoadedGeoJson;
}>();

const groupIndex = inject("groupIndexProvider");
const layerIndex = inject("layerIndexProvider");
const fillOpacity = ref(
  parseFloat(
    (props.layerItem.layer_style as FillStyles).paint_fill_opacity ?? "1"
  ) * 100
);
const fillColor = ref(
  (props.layerItem.layer_style as FillStyles).paint_fill_color ?? "#000000"
);

const store = useMapLayer();
const { updateLayerProperty } = store;

const handleChangeProperty = (
  propType: "paint" | "layout",
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
    <!-- <div class="bg-grey-800 rounded-xxs p-2 space-y-1">
      <p class="text-grey-50 text-2xs">Appearance</p>
    </div> -->
    <div class="bg-grey-800 rounded-xxs p-2 space-y-1">
      <p class="text-grey-50 text-2xs">Color</p>
      <p class="text-grey-400 text-2xs">Fill Color Opacity</p>
      <div class="grid grid-cols-4 gap-1">
        <URange
          v-model="fillOpacity"
          @input="
            (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string)/100, 'fill-opacity');
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
          v-model="fillOpacity"
          @blur="
             (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string)/100, 'fill-opacity');
            }
          "
          type="number"
          color="gray"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Fill Opacity"
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
            handleChangeProperty('paint', color, 'fill-color');
          }
        "
      />
    </div>
  </div>
</template>
