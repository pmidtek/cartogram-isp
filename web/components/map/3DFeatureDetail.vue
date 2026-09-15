<script setup lang="ts">
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";

const featureStore = useFeature();
</script>

<template>
  <div class="flex justify-between items-center m-3">
    <h2 class="text-white">3D Feature Detail</h2>
    <IcArrowLeft
      role="button"
      @click="
        () => {
          featureStore.setRightSidebar('');
          featureStore.set3DFeature(undefined);
        }
      "
      :fontControlled="false"
      class="w-3 h-3 rotate-180 text-grey-50"
    />
  </div>
  <hr class="mx-3" />
  <div class="grow overflow-y-auto px-3 my-3 text-grey-50 space-y-6">
    <div>
      <h5>Header Detail</h5>
      <pre class="bg-grey-700 overflow-x-scroll p-2 rounded-xs mt-2">{{
        "{\n" +
        JSON.stringify(featureStore.threeDfeature?.header, null, 2).slice(1)
      }}</pre>
    </div>

    <div>
      <h5>Content Detail</h5>
      <pre class="bg-grey-700 overflow-x-scroll p-2 rounded-xs mt-2">{{
        "{\n" +
        JSON.stringify(featureStore.threeDfeature?.content, null, 2).slice(1)
      }}</pre>
    </div>
  </div>
</template>
