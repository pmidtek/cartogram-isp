<script setup lang="ts">
import IcMapLayerB from "~/assets/icons/ic-map-layer-b.svg";
import IcPlus from "~/assets/icons/ic-plus.svg";
const uploadLayer = () => {
  console.log("upload");
};
</script>

<template>
  <div
    class="flex flex-col justify-between gap-2 border border-grey-700 bg-grey-800 rounded-xs p-2"
  >
    <div class="flex flex-col flex-1 items-center justify-center py-8">
      <IcMapLayerB class="h-6 w-6 text-brand-500" :fontControlled="false" />
      <p class="line-clamp-3 text-grey-50 text-center">Upload Data</p>
      <p class="line-clamp-3 text-grey-400 text-sm text-center">
        Upload new dataset to this catalogue
      </p>
    </div>
    <UButton
      :ui="{ rounded: 'rounded-xxs' }"
      label="Upload Data"
      class="w-full h-9 justify-between"
      variant="outline"
      color="brand"
      @click="uploadLayer"
    >
      <template #trailing>
        <IcPlus />
      </template>
      <!-- <IcSpinner
        :class="[
          isActive ? 'text-brand-500' : 'text-white',
          'w-4 h-4 animate-spin',
        ]"
        :fontControlled="false"
        v-if="isLoad"
      /> -->
    </UButton>
  </div>
</template>
