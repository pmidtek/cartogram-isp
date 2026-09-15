<script setup lang="ts">
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";
const featureStore = useFeature();
const closeCoreTransaction = () => {
  featureStore.setMapInfo("");
};
const tabItems = [
  {
    key: "poi",
    label: "POI",
    icon: "i-solar:map-point-linear",
  },
  {
    key: "aoi",
    label: "AOI",
    icon: "i-streamline:interface-edit-select-area-rectangle-dash-select-area-object-work",
  },
  {
    key: "footprint",
    label: "Footprint",
    icon: "i-material-symbols:other-houses-outline",
  },
];
</script>
<template>
  <div
    v-if="loading"
    class="animate-pulse space-y-3 px-3 py-3 bg-white h-screen"
  >
    <div class="w-full h-8 bg-grey-200 rounded-xs"></div>
    <div class="w-full h-8 bg-grey-200 rounded-xs"></div>
    <div class="w-full h-[280px] bg-grey-200 rounded-xs"></div>
    <div class="w-full h-32 bg-grey-200 rounded-xs"></div>
    <div class="w-full h-32 bg-grey-200 rounded-xs"></div>
    <div class="w-full h-32 bg-grey-200 rounded-xs"></div>
    <div class="w-full h-32 bg-grey-200 rounded-xs"></div>
  </div>

  <div v-else class="flex flex-col h-screen bg-white p-2">
    <div class="flex justify-between p-2">
      <div class="space-y-1">
        <h3 class="text-grey-900 text-lg font-semibold">Summary Data</h3>
        <p class="text-grey-600 text-xs mt-1">
          Summary data for market potential analysis
        </p>
      </div>
      <IcArrowLeft
        role="button"
        @click="closeCoreTransaction"
        :fontControlled="false"
        class="w-3 h-3 rotate-180 text-grey-700 hover:text-brand-600 transition-colors cursor-pointer"
      />
    </div>
    <UTabs
      :ui="{
        list: {
          tab: { rounded: 'rounded-xxs', base: 'rounded-xxs' },
          rounded: 'rounded-xxs',
          marker: { rounded: 'rounded-xxs' },
        },
      }"
      :items="tabItems"
    >
      <template #item="{ item }">
        <div v-if="item.key === 'poi'">
          <MapTitlePOISummary />
        </div>
        <div v-else-if="item.key === 'aoi'">
          <MapTitleAoiSummary />
        </div>
        <div v-else>
          <MapTitleFootprintSummary />
        </div>
      </template>
    </UTabs>
  </div>
</template>
