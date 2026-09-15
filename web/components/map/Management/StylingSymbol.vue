<script lang="ts" setup>
import { inject } from "vue";
import type { SymbolStylesAdjusted } from "~/utils/types";

const props = defineProps<{
  layerItem: VectorTiles;
}>();

const groupIndex = inject("groupIndexProvider");
const layerIndex = inject("layerIndexProvider");

const iconOpacity = ref(
  parseFloat(
    (props.layerItem.layer_style as SymbolStylesAdjusted).paint_icon_opacity ??
      "1"
  ) * 100
);
const iconColor = ref(
  (props.layerItem.layer_style as SymbolStylesAdjusted).paint_icon_color ??
    "#000000"
);
const iconSize = ref(
  (props.layerItem.layer_style as SymbolStylesAdjusted).layout_icon_size ?? 1
);
const iconImage = ref({
  id: (props.layerItem.layer_style as SymbolStylesAdjusted).icon_image_id ?? "",
  title:
    (props.layerItem.layer_style as SymbolStylesAdjusted).icon_image_title ??
    "",
});

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
const updateIconTitle = (title: string) => {
  if (store.groupedActiveLayers) {
    const prev = store.groupedActiveLayers;
    const selected =
      prev[groupIndex as number].layerLists[layerIndex as number];
    (selected.layer_style as Record<string, string>)["icon_image_title"] =
      title;

    store.groupedActiveLayers = prev;
  }
};
</script>

<template>
  <div>
    <div class="bg-grey-800 rounded-xxs p-2 space-y-1">
      <p class="text-grey-50 text-2xs">Appearance</p>
      <p class="text-grey-400 text-2xs">Size</p>
      <div class="grid grid-cols-4 gap-2">
        <UButton
          v-for="items in [1, 1.5, 2, 3]"
          :color="items === iconSize ? 'brand' : 'grey'"
          variant="outline"
          :ui="{ rounded: 'rounded-[4px]' }"
          :class="[items === iconSize ? 'bg-brand-950' : '', 'p-1']"
          @click="
            () => {
              iconSize = items;
              handleChangeProperty('layout', items, 'icon-size');
            }
          "
        >
          <template #leading>
            <div
              :class="[
                items === iconSize ? 'bg-brand-500' : 'bg-grey-400',
                'w-3 h-3 rounded-full',
              ]"
            />
          </template>
          <p class="text-2xs">{{ items }}x</p>
        </UButton>
      </div>
    </div>
    <div class="bg-grey-800 rounded-xxs p-2 space-y-1">
      <p class="text-grey-50 text-2xs">Fill Color</p>
      <p class="text-grey-400 text-2xs">Fill Color Opacity</p>
      <div class="grid grid-cols-4 gap-1">
        <URange
          v-model="iconOpacity"
          @input="
            (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string)/100, 'icon-opacity');
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
          v-model="iconOpacity"
          @blur="
             (e:Event) => {
              handleChangeProperty('paint',parseFloat((e.target as HTMLInputElement).value as string)/100, 'icon-opacity');
            }
          "
          type="number"
          color="gray"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Symbol Opacity"
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
        v-model="iconColor"
        :updateColor="
          (color:string) => {
            handleChangeProperty('paint',color, 'icon-color');
          }
        "
      />
    </div>
    <div class="bg-grey-800 rounded-xxs p-2 space-y-1">
      <p class="text-grey-50 text-2xs">Symbology Icons</p>
      <CoreIconPicker
        v-model="iconImage"
        :updateIconImage="
          (iconImageId:string,iconImageTitle:string) => {
            handleChangeProperty('layout', iconImageId, 'icon-image');
            updateIconTitle(iconImageTitle)
          }
        "
      />
    </div>
  </div>
</template>
