<script lang="ts" setup>
import { useDrawControl } from "~/utils/useDrawControl";
import area from "@turf/area";
import { convertArea } from "@turf/helpers";

const areaCount = ref<number>(0);
const areaUnit = ref<string>("m");

const { drawer } = useDrawControl({
  mode: "draw_polygon",
  onCreated: (feature) => {
    areaCount.value =
      areaUnit.value === "m"
        ? parseFloat(area(feature).toFixed(2))
        : parseFloat(
            convertArea(area(feature), "meters", "kilometers").toFixed(2),
          );
  },
  onUpdated: (feature) => {
    areaCount.value =
      areaUnit.value === "m"
        ? parseFloat(area(feature).toFixed(2))
        : parseFloat(
            convertArea(area(feature), "meters", "kilometers").toFixed(2),
          );
  },
});

const handleReset = () => {
  areaCount.value = 0;
  drawer?.deleteAll();
  drawer?.changeMode("draw_polygon");
};
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <p class="text-2xs text-grey-400">
      Click on the map to start measuring area and Double click to finish.
    </p>
    <div class="flex gap-1">
      <UInput
        v-model="areaCount"
        readonly
        :ui="{ rounded: 'rounded-xxs' }"
        placeholder="0"
        class="w-full"
        size="2xs"
      >
        <template #trailing>
          <span class="text-grey-500 dark:text-grey-400 text-xs"
            >Area Result ({{ areaUnit }}<span><sup>2</sup></span
            >)</span
          >
        </template>
      </UInput>
      <UButton
        @click="
          () => {
            if (areaUnit === 'km') {
              areaCount = parseFloat((areaCount * 1000000).toFixed(2));
              areaUnit = 'm';
            }
          }
        "
        :color="areaUnit === 'm' ? 'brand' : 'grey'"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="text-2xs p-1 gap-0"
      >
        Meter<sup>2</sup>
      </UButton>
      <UButton
        @click="
          () => {
            if (areaUnit === 'm') {
              areaCount = parseFloat((areaCount / 1000000).toFixed(2));
              areaUnit = 'km';
            }
          }
        "
        :color="areaUnit === 'km' ? 'brand' : 'grey'"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="text-2xs p-1 gap-0"
        >Kilometer<sup>2</sup></UButton
      >
    </div>
  </div>
  <div class="p-2">
    <UButton
      :disabled="areaCount === 0"
      @click="handleReset"
      color="grey"
      :ui="{ rounded: 'rounded-[4px]' }"
      class="w-full justify-center text-sm"
      >Reset</UButton
    >
  </div>
</template>
