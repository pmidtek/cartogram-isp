<script lang="ts" setup>
import TowerSummary from "./TowerSummary.vue";

const featureStore = useFeature();
const { titleFeature, typeFeature } = storeToRefs(featureStore);
</script>

<template>
  <div
    v-if="typeFeature === 'backhaul' || typeFeature === 'ftth-mapping'"
    class="p-3 space-y-3"
  >
    <div
      class="w-full bg-brand-500 rounded-xs relative p-5 overflow-hidden h-[233px]"
    >
      <!-- radial blur -->
      <div
        class="absolute w-[800px] h-[800px] bg-white/15 -bottom-[650px] -left-[200px] rounded-full blur-2xl"
      ></div>
      <div class="flex flex-col justify-between h-full">
        <span class="text-sm font-bold text-white font-raleway">Dashboard</span>
        <div class="flex flex-col justify-end">
          <h1
            class="text-4xl lead font-semibold text-white font-raleway leading-tight"
          >
            {{ titleFeature }}
          </h1>
        </div>
      </div>
    </div>
    <p
      class="self-stretch justify-start text-grey-600 text-sm font-normal font-['Raleway'] leading-tight"
    >
      Precision routing for resilient, cost-efficient backhaul and backbone
      connectivity.
    </p>
  </div>
  <div v-else-if="typeFeature === 'FWA'">
    <TowerSummary />
  </div>
  <div v-else>
    <MapTitleSummaryMarket />
  </div>
</template>
