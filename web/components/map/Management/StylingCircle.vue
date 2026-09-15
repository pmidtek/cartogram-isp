<script lang="ts" setup>
import { inject } from "vue";

const props = defineProps<{
  layerItem: VectorTiles | LoadedGeoJson;
}>();

const groupIndex = inject("groupIndexProvider");
const layerIndex = inject("layerIndexProvider");

const circleRadius = ref(
  (props.layerItem.layer_style as CircleStyles).paint_circle_radius
);
const circleStrokeDash = ref(null);
const circleStrokeWidth = ref(
  (props.layerItem.layer_style as CircleStyles).paint_circle_stroke_width
);
const fillOpacity = ref(
  parseFloat(
    (props.layerItem.layer_style as CircleStyles).paint_circle_opacity ?? "1"
  ) * 100
);
const strokeOpacity = ref(
  parseFloat(
    (props.layerItem.layer_style as CircleStyles).paint_circle_stroke_opacity ??
      "1"
  ) * 100
);
const fillColor = ref(
  (props.layerItem.layer_style as CircleStyles).paint_circle_color ?? "#000000"
);
const strokeColor = ref(
  (props.layerItem.layer_style as CircleStyles).paint_circle_stroke_color ??
    "#000000"
);

const store = useMapLayer();
const { updateLayerProperty } = store;
const mapStore = useMapRef();
const { map } = storeToRefs(mapStore);

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
    <div class="bg-white rounded-xxs border p-2 space-y-1">
      <p class="text-grey-800 text-2xs">Appearance</p>
      <div class="grid grid-cols-2 gap-1">
        <p class="text-grey-400 text-2xs self-center">Size</p>
        <UInput
          v-model="circleRadius"
          @blur="
            (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string), 'circle-radius');
            }
          "
          type="number"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Circle Radius"
          size="2xs"
          min="0"
          max="100"
        >
          <template #trailing>
            <span class="text-grey-400 text-2xs">px</span>
          </template>
        </UInput>
      </div>
      <p class="text-grey-400 text-2xs">Stroke</p>
      <div class="grid grid-cols-4 gap-1">
        <div class="col-span-3">
          <CoreInputDash
            disabled
            v-model="circleStrokeDash"
            :updateLineDash="(value) => {}"
          />
        </div>
        <UInput
          v-model="circleStrokeWidth"
          @blur="
            (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string), 'circle-stroke-width');
            }
          "
          type="number"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Circle Radius"
          size="2xs"
          min="0"
          max="100"
        >
          <template #trailing>
            <span class="text-grey-400 text-2xs">px</span>
          </template>
        </UInput>
      </div>
      <div class="grid grid-cols-4 gap-1">
        <URange
          v-model="strokeOpacity"
          @input="
            (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string)/100, 'circle-stroke-opacity');
            }
          "
          name="range"
          size="sm"
          :ui="{
            background: 'bg-white',
            thumb: {
              background:
                '[&::-webkit-slider-thumb]:bg-grey-200 [&::-webkit-slider-thumb]:dark:bg-grey-200',
              ring: '[&::-webkit-slider-thumb]:ring-0 [&::-webkit-slider-thumb]:ring-current',
            },
            track: {
              background:
                '[&::-webkit-slider-runnable-track]:bg-grey-200 [&::-moz-range-track]:bg-grey-200 [&::-webkit-slider-runnable-track]:dark:bg-grey-200 [&::-moz-range-track]:dark:bg-grey-200',
            },
          }"
          :min="0"
          :max="100"
          class="self-center col-span-3"
        />
        <UInput
          v-model="strokeOpacity"
          @blur="
             (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string)/100, 'circle-opacity');
            }
          "
          type="number"
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
        v-model="strokeColor"
        :updateColor="
          (color:string) => {
            handleChangeProperty('paint', color, 'circle-stroke-color');
          }
        "
      />
    </div>
    <div class="bg-white rounded-xxs border p-2 space-y-1">
      <p class="text-grey-800 text-2xs">Color</p>
      <p class="text-grey-400 text-2xs">Fill Color Opacity</p>
      <div class="grid grid-cols-4 gap-1">
        <URange
          v-model="fillOpacity"
          @input="
            (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string)/100, 'circle-opacity');
            }
          "
          name="range"
          size="sm"
          :ui="{
            background: 'bg-white',
            thumb: {
              background:
                '[&::-webkit-slider-thumb]:bg-grey-200 [&::-webkit-slider-thumb]:dark:bg-grey-200',
              ring: '[&::-webkit-slider-thumb]:ring-0 [&::-webkit-slider-thumb]:ring-current',
            },
            track: {
              background:
                '[&::-webkit-slider-runnable-track]:bg-grey-200 [&::-moz-range-track]:bg-grey-200 [&::-webkit-slider-runnable-track]:dark:bg-grey-200 [&::-moz-range-track]:dark:bg-grey-200',
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
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string)/100, 'circle-opacity');
            }
          "
          type="number"
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
            handleChangeProperty('paint', color, 'circle-color');
          }
        "
      />
    </div>
  </div>
</template>
