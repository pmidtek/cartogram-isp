<script setup lang="ts">
import { ref, computed } from "vue";
import { storeToRefs } from "pinia";
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";
import PortToCore from "./PortToCore.vue";
import CoreToCore from "./CoreToCore.vue";
import PortToPort from "./PortToPort.vue";

const featureStore = useFeature();

const { selectedCoreTransactionSite } = storeToRefs(featureStore);

const closeCoreTransaction = () => {
  featureStore.setMapInfo("");
};

// Check if we have a selected site
const hasSelectedSite = computed(() => !!selectedCoreTransactionSite.value);

// Configure link options
const configureLinkOptions = [
  { label: "Port to Core", value: "port_to_core" },
  { label: "Core to Core", value: "core_to_core" },
  { label: "Port to Port", value: "port_to_port" },
];

const selectedConfigureLink = ref<string | undefined>();

// Handle cancel action
const handleCancel = () => {
  selectedConfigureLink.value = undefined;
};

// Handle done action
const handleDone = () => {
  closeCoreTransaction();
};
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Header -->
    <div class="flex justify-between items-center">
      <div>
        <h2 class="text-grey-900 text-xs font-semibold">Core Config</h2>
        <p class="text-[10px] font-raleway text-grey-600 text-xxs">
          Manage core fiber transactions and allocations
        </p>
      </div>
      <IcArrowLeft
        role="button"
        @click="closeCoreTransaction"
        :fontControlled="false"
        class="w-4 h-4 rotate-180 text-grey-700 hover:text-brand-600 transition-colors cursor-pointer"
      />
    </div>
    <div class="w-full h-[1px] bg-grey-300"></div>

    <!-- Scrollable Content Area -->
    <div class="h-[calc(100dvh-18.2rem)] overflow-y-scroll space-y-2">
      <!-- Selected Site Point Information -->
      <div v-if="hasSelectedSite" class="space-y-2">
        <!-- Core Transaction Form/Interface -->
        <div class="rounded-xs px-3 space-y-2">
          <h3 class="text-sm font-semibold text-grey-800">
            Configure Core
            {{ selectedCoreTransactionSite?.name || "Unnamed" }}
          </h3>

          <div class="space-y-2">
            <label class="text-2xs text-grey-600 block"
              >Select Configure Link</label
            >
            <USelect
              v-model="selectedConfigureLink"
              :options="configureLinkOptions"
              placeholder="Choose link type"
              size="sm"
              :ui="{ rounded: 'rounded-xxs' }"
            />
          </div>

          <!-- Configuration Components - shows after selecting link type -->
          <div v-if="selectedConfigureLink" class="mt-4">
            <!-- Port to Core Component -->
            <PortToCore
              v-if="selectedConfigureLink === 'port_to_core'"
              :selected-site="selectedCoreTransactionSite"
              @cancel="handleCancel"
              @done="handleDone"
            />

            <!-- Core to Core Component -->
            <CoreToCore
              v-else-if="selectedConfigureLink === 'core_to_core'"
              :selected-site="selectedCoreTransactionSite"
              @cancel="handleCancel"
              @done="handleDone"
            />

            <!-- Port to Port Component -->
            <PortToPort
              v-else-if="selectedConfigureLink === 'port_to_port'"
              :selected-site="selectedCoreTransactionSite"
              @cancel="handleCancel"
              @done="handleDone"
            />
          </div>
        </div>
      </div>

      <!-- No Site Selected Message -->
      <div
        v-else
        class="flex flex-col items-center justify-center py-8 space-y-2"
      >
        <div
          class="w-12 h-12 rounded-full bg-grey-100 flex items-center justify-center"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke-width="1.5"
            stroke="currentColor"
            class="w-6 h-6 text-grey-400"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M15 10.5a3 3 0 11-6 0 3 3 0 016 0z"
            />
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1115 0z"
            />
          </svg>
        </div>
        <p class="text-xs text-grey-500 text-center">No site point selected</p>
        <p class="text-2xs text-grey-400 text-center">
          Please use the Core Transaction tool to select a site point first
        </p>
      </div>
    </div>
  </div>
</template>
