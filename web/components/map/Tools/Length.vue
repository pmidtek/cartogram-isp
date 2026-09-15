<script lang="ts" setup>
import { useDrawControl } from "~/utils/useDrawControl";
import { addHighlightLayer } from "~/utils";
import length from "@turf/length";

const store = useMapRef();

const lengthCount = ref<number>(0);
const lengthUnit = ref<string>("m");

const { drawer } = useDrawControl({
  mode: "draw_line_string",
  onCreated: (feature) => {
    lengthCount.value = parseFloat(
      length(feature, {
        units: lengthUnit.value === "m" ? "meters" : "kilometers",
      }).toFixed(2),
    );
  },
  onUpdated: (feature) => {
    lengthCount.value = parseFloat(
      length(feature, {
        units: lengthUnit.value === "m" ? "meters" : "kilometers",
      }).toFixed(2),
    );
  },
});
const handleReset = () => {
  lengthCount.value = 0;
  drawer?.deleteAll();
  drawer?.changeMode("draw_line_string");
};
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <p class="text-2xs text-grey-400">
      Click on the map to start measuring length and Double click to finish.
    </p>
    <div class="flex gap-1">
      <UInput
        v-model="lengthCount"
        readonly
        :ui="{ rounded: 'rounded-xxs' }"
        placeholder="0"
        class="w-full"
        size="2xs"
      >
        <template #trailing>
          <span class="text-grey-500 dark:text-grey-400 text-xs"
            >Distance Result ({{ lengthUnit }})</span
          >
        </template>
      </UInput>
      <UButton
        @click="
          () => {
            if (lengthUnit === 'km') {
              lengthCount = parseFloat((lengthCount * 1000).toFixed(2));
              lengthUnit = 'm';
            }
          }
        "
        :color="lengthUnit === 'm' ? 'brand' : 'grey'"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="text-2xs p-1 gap-0"
      >
        Meter
      </UButton>
      <UButton
        @click="
          () => {
            if (lengthUnit === 'm') {
              lengthCount = parseFloat((lengthCount / 1000).toFixed(2));
              lengthUnit = 'km';
            }
          }
        "
        :color="lengthUnit === 'km' ? 'brand' : 'grey'"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="text-2xs p-1 gap-0"
        >Kilometer</UButton
      >
    </div>
  </div>
  <div class="p-2">
    <UButton
      :disabled="lengthCount === 0"
      @click="handleReset"
      color="grey"
      :ui="{ rounded: 'rounded-[4px]' }"
      class="w-full justify-center text-sm"
      >Reset</UButton
    >
  </div>
</template>
