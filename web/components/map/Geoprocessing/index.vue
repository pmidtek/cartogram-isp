<script lang="ts" setup>
import IcCross from "~/assets/icons/ic-cross.svg";
import { TabGroup, TabList, Tab, TabPanels, TabPanel } from "@headlessui/vue";

const featureStore = useFeature();
const tabItems = [
  {
    key: "onprocess",
    label: "On Process",
  },
  {
    key: "completed",
    label: "Completed",
  },
];
</script>

<template>
  <div class="flex justify-between items-center m-3">
    <h2 class="text-grey-800">Geoprocessing Queue</h2>
    <IcCross
      role="button"
      @click="featureStore.setMapInfo('')"
      :fontControlled="false"
      class="w-3 h-3 rotate-180 text-grey-900"
    />
  </div>
  <hr class="mx-3" />

  <div class="grow overflow-hidden px-3 my-3">
    <TabGroup>
      <TabList
        class="grid grid-cols-2 gap-2 text-center cursor-pointer divide-x-2 text-xs"
      >
        <Tab
          v-for="item in tabItems"
          as="template"
          :key="item.key"
          v-slot="{ selected }"
        >
          <p :class="[selected ? 'text-grey-800' : 'text-grey-300']">
            {{ item.label }}
          </p>
        </Tab>
      </TabList>
      <TabPanels class="mt-3 overflow-y-auto h-full pb-10">
        <TabPanel>
          <MapGeoprocessingQueue />
        </TabPanel>
        <TabPanel>
          <MapGeoprocessingHistory />
        </TabPanel>
      </TabPanels>
    </TabGroup>
  </div>
</template>
