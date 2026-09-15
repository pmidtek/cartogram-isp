<script lang="ts" setup>
import { inject } from "vue";

const props = defineProps<{
  layerItem: VectorTiles | LoadedGeoJson;
}>();
const style = props.layerItem.layer_style as LineStyles;

const groupIndex = inject("groupIndexProvider");
const layerIndex = inject("layerIndexProvider");

const lineWidth = ref(style.paint_line_width);
const lineDash = ref(style.paint_line_dasharray ?? "");
const dashWidth = ref(
  style.paint_line_dasharray ? JSON.parse(style.paint_line_dasharray)[0] : null
);

const dashGap = ref(
  style.paint_line_dasharray?.length
    ? JSON.parse(style.paint_line_dasharray)[1]
    : null
);
const lineOpacity = ref(parseFloat(style.paint_line_opacity ?? "1") * 100);
const lineColor = ref(style.paint_line_color ?? "#000000");

const store = useMapLayer();
const { updateLayerProperty } = store;

const handleChangeProperty = (
  propType: "paint" | "layout",
  value: string | number | boolean | null,
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
      <p class="text-grey-400 text-2xs">Stroke</p>
      <div class="grid grid-cols-4 gap-1">
        <div class="col-span-3">
          <CoreInputDash
            v-model="lineDash"
            :updateLineDash="
              (value) => {
                if (value !== null) {
                  let dashArray = [];
                  if (dashWidth) {
                    dashArray.push(dashWidth);
                    if (dashGap) {
                      dashArray.push(dashGap);
                    }
                  } else {
                    dashWidth = value[0];
                    dashGap = value[1];
                    dashArray = value;
                  }
                  handleChangeProperty(
                    'paint',
                    JSON.stringify(dashArray),
                    'line-dasharray'
                  );
                } else {
                  handleChangeProperty('paint', value, 'line-dasharray');
                }
              }
            "
          />
        </div>
        <UInput
          v-model="lineWidth"
          @blur="
            (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string), 'line-width');
            }
          "
          type="number"
          color="gray"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Line Width"
          size="2xs"
          min="0"
          max="100"
        >
          <template #trailing>
            <span class="text-grey-400 text-2xs">px</span>
          </template>
        </UInput>
      </div>
      <div class="grid grid-cols-2 gap-1">
        <UInput
          :disabled="!lineDash"
          v-model="dashWidth"
          @blur="
            (e:Event) => {
              let newDashArray = [parseFloat((e.target as HTMLInputElement).value)]
              if(dashGap){newDashArray.push(dashGap)}
              handleChangeProperty('paint', JSON.stringify(newDashArray), 'line-dasharray');
            }
          "
          type="number"
          color="gray"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Dash"
          size="2xs"
          min="0"
          max="100"
        >
          <template #trailing>
            <span class="text-grey-400 text-2xs">Dash</span>
          </template>
        </UInput>
        <UInput
          :disabled="!lineDash"
          v-model="dashGap"
          @blur="
            (e:Event) => {
              let newDashArray = [dashWidth, parseFloat((e.target as HTMLInputElement).value)]
              handleChangeProperty('paint',  JSON.stringify(newDashArray), 'line-dasharray');
            }
          "
          type="number"
          color="gray"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Gap"
          size="2xs"
          min="0"
          max="100"
        >
          <template #trailing>
            <span class="text-grey-400 text-2xs">Gap</span>
          </template>
        </UInput>
      </div>
    </div>
    <div class="bg-grey-800 rounded-xxs p-2 space-y-1">
      <p class="text-grey-50 text-2xs">Color</p>
      <p class="text-grey-400 text-2xs">Line Color Opacity</p>
      <div class="grid grid-cols-4 gap-1">
        <URange
          v-model="lineOpacity"
          @input="
            (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string)/100, 'line-opacity');
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
          v-model="lineOpacity"
          @blur="
             (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string)/100, 'line-opacity');
            }
          "
          type="number"
          color="gray"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Line Opacity"
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
        v-model="lineColor"
        :updateColor="
          (color:string) => {
            handleChangeProperty('paint',color, 'line-color');
          }
        "
      />
    </div>
  </div>
</template>
