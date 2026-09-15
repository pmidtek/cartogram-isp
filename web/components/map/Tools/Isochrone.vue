<script setup lang="ts">
import IcMapLayer from "~/assets/icons/ic-map-layer.svg";
</script>

<template>
  <div class="p-2">
    <p class="text-2xs text-grey-400">
      Click on the map or input coordinate manually to begin isochrone analysis
      tool.
    </p>
  </div>
  <div class="p-2 grid grid-cols-2 gap-[6px]">
    <div class="flex gap-[6px]">
      <CoreButtonIcon
        :onClick="() => console.log('tes')"
        :active="true"
        :icon="IcMapLayer"
      >
      </CoreButtonIcon>
      <CoreButtonIcon
        :onClick="() => console.log('tes')"
        :active="false"
        :icon="IcMapLayer"
      >
      </CoreButtonIcon>
      <CoreButtonIcon
        :onClick="() => console.log('tes')"
        :active="true"
        :icon="IcMapLayer"
      >
      </CoreButtonIcon>
      <div
        class="flex items-center justify-center w-full h-full border border-grey-700 py-1 px-2 rounded-xxs text-2xs text-grey-400"
      >
        3mph
      </div>
    </div>

    <button
      class="w-full text-white text-xs rounded-xxs bg-brand-600 hover:bg-brand-700 p-1 h-full"
    >
      Analyze
    </button>
  </div>
</template>
