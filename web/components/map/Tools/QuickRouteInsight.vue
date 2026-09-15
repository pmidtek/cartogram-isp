<script setup lang="ts">
import { Menu, MenuButton, MenuItems } from "@headlessui/vue";
import { storeToRefs } from "pinia";
import IcInsight from "~/assets/icons/ic-insight.svg";
import IcArrow from "~/assets/icons/ic-arrow-reg.svg";
import { useQuery } from "@tanstack/vue-query";

const toolsStore = useMapTools();
const { expandTools } = storeToRefs(toolsStore);
const authStore = useAuth();
const analysisStore = useAnalysisResult();
const featureStore = useFeature();
const toast = useToast();

// Form state
const formData = ref({
  resultReference: null as any, // Selected QMI result
  analysisName: "", // Analysis name input
  existingProviders: [] as string[], // Selected backbone providers
  poiCategories: [] as string[], // Selected POI categories
  bufferDistance: 300, // Buffer distance in meters (10-400m)
});

// Analysis loading state
const isAnalyzing = ref(false);
const isQueued = ref(false);
const currentMessageId = ref<string | null>(null);

// Fetch QMI results list
const { data: qmiResultsData, isLoading: isLoadingQmiResults } = useQuery({
  queryKey: ["/panel/items/qmi_result"],
  queryFn: async () => {
    const res = await $fetch<{ data: any[] }>(
      "/panel/items/qmi_result?fields=id,name,date_created&sort=-date_created&limit=50",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return res.data.map((item) => ({
      value: item.id,
      label: item.name || `QMI Result ${item.id}`,
      date: item.date_created,
    }));
  },
});

// Provider options
const providerOptions = [{ label: "Surge (Dummy)", value: "Surge" }];

// POI category options
const poiCategoryOptions = [
  { label: "Stasiun", value: "stasiun" },
  { label: "Sekolah", value: "sekolah" },
  { label: "Shopping Mall", value: "shopping mall" },
  { label: "Government Office", value: "government office" },
  { label: "Rumah Sakit", value: "rumah sakit" },
  { label: "Pasar Tradisional", value: "pasar tradisional" },
];

// Computed to check if analyze button should be disabled
const isAnalyzeDisabled = computed(() => {
  if (isAnalyzing.value) return true;

  // Must have result reference selected
  if (!formData.value.resultReference) return true;

  // Must have at least one provider or POI category
  // if (
  //   formData.value.existingProviders.length === 0 &&
  //   formData.value.poiCategories.length === 0
  // ) {
  //   return true;
  // }

  return false;
});

const pollQueueStatus = async (messageId: string) => {
  isQueued.value = true;

  try {
    const response = await $fetch<{ data: any }>(
      `/panel/items/geoprocessing_queue/${messageId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    const { state, status, result } = response.data;

    // Check if processing is complete
    if (state === "done" && status === "success") {
      console.log("Processing complete");
      // Get route_insight_result_id from result
      const routeInsightResultId = result?.route_insight_result_id;

      if (routeInsightResultId) {
        // Fetch the actual result data
        const routeInsightResponse = await $fetch<{ data: any }>(
          `/panel/items/route_insight_result/${routeInsightResultId}`,
          {
            headers: {
              Authorization: `Bearer ${authStore.accessToken}`,
            },
          },
        );

        // Store the result data for route insight analysis panel
        analysisStore.setQuickRouteInsightData(routeInsightResponse.data);
        analysisStore.setCurrentAnalysisType("quick_route_insight_analysis");

        toast.add({
          title: "Analysis Complete",
          description: "Route insight results are ready to view",
          icon: "i-heroicons-check-circle",
          ui: { background: "bg-white", title: "text-grey-800" },
        });

        isAnalyzing.value = false;
        isQueued.value = false;
        currentMessageId.value = null;
      }
    } else if (state === "rejected" || status === "error") {
      toast.add({
        title: "Analysis Failed",
        description: "The route insight analysis failed to complete",
        icon: "i-heroicons-x-circle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
      isAnalyzing.value = false;
      isQueued.value = false;
      currentMessageId.value = null;
    } else {
      // Still processing, poll again after 1 second
      setTimeout(() => pollQueueStatus(messageId), 1000);
    }
  } catch (error: any) {
    toast.add({
      title: "Error",
      description: error?.data?.message || "Failed to check queue status",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    isAnalyzing.value = false;
    isQueued.value = false;
    currentMessageId.value = null;
  }
};

const handleAnalyze = async () => {
  // Validation
  // if (!formData.value.resultReference) {
  //   toast.add({
  //     title: "Validation Error",
  //     description: "Please select a QMI result",
  //     icon: "i-heroicons-exclamation-triangle",
  //     ui: { background: "bg-white", title: "text-grey-800" },
  //   });
  //   return;
  // }

  // if (
  //   formData.value.existingProviders.length === 0 &&
  //   formData.value.poiCategories.length === 0
  // ) {
  //   toast.add({
  //     title: "Validation Error",
  //     description: "Please select at least one provider or POI category",
  //     icon: "i-heroicons-exclamation-triangle",
  //     ui: { background: "bg-white", title: "text-grey-800" },
  //   });
  //   return;
  // }

  isAnalyzing.value = true;

  try {
    // Build payload
    const payload: any = {
      qmi_id:
        typeof formData.value.resultReference === "object"
          ? formData.value.resultReference.value
          : formData.value.resultReference,
      name: formData.value.analysisName || null,
      existing_providers: formData.value.existingProviders.map((p: any) =>
        typeof p === "object" ? p.value : p,
      ),
      poi_categories: formData.value.poiCategories.map((c: any) =>
        typeof c === "object" ? c.value : c,
      ),
      buffer_distance: formData.value.bufferDistance,
    };

    const response = await $fetch<{ message_id: string }>(
      "/panel/analysis/route-insight",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        body: JSON.stringify(payload),
      },
    );

    currentMessageId.value = response.message_id;

    toast.add({
      title: "Analysis Started",
      description: "Processing your route insight request...",
      icon: "i-heroicons-arrow-path",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    toast.add({
      title: "Analysis On Process",
      description: "Don't close Quick Route Insight window",
      icon: "i-heroicons-arrow-path",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    // Start polling queue status
    setTimeout(() => pollQueueStatus(response.message_id), 1000);
  } catch (error: any) {
    toast.add({
      title: "Analysis Failed",
      description: error?.data?.message || "Failed to start analysis",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    isAnalyzing.value = false;
  }
};

const handleShowResult = () => {
  featureStore.setMapInfo("quick-request-list");
};
</script>

<template>
  <Menu as="div" v-slot="{ open }" class="relative inline-block text-left">
    <div>
      <MenuButton
        :class="[
          open
            ? 'bg-gradient-to-r from-blue-200/80 to-blue-600 text-white'
            : 'bg-transparent enabled:hover:bg-gradient-to-r enabled:hover:from-blue-200/80 enabled:hover:to-blue-600 enabled:hover:text-white text-grey-700 disabled:hover:bg-transparent',
          'inline-flex w-full items-center h-9 gap-3 rounded-xxs px-2 py-2 text-sm font-normal focus:outline-none disabled:text-grey-200',
        ]"
      >
        <IcInsight class="w-4 h-4" :fontControlled="false" />
        <div
          :class="[
            expandTools ? 'w-72' : 'w-0',
            'max-w-max whitespace-nowrap overflow-hidden',
          ]"
        >
          Quick Route Insight
        </div>
        <IcArrow class="w-4 h-4" :fontControlled="false" />
      </MenuButton>
    </div>

    <transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="transform scale-95 opacity-0"
      enter-to-class="transform scale-100 opacity-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="transform scale-100 opacity-100"
      leave-to-class="transform scale-95 opacity-0"
    >
      <MenuItems
        class="absolute right-0 bottom-12 mt-2 p-4 w-96 max-h-[64vh] overflow-y-auto hide-scrollbar origin-top-right rounded-sm bg-white shadow-xl ring-1 ring-grey-300 focus:outline-none"
      >
        <div class="space-y-4">
          <!-- Quick Route Insight Section -->
          <div class="space-y-3">
            <h3
              class="text-sm font-semibold text-grey-900 border-b border-grey-200 pb-2"
            >
              Quick Route Insight
            </h3>

            <!-- Result Reference -->
            <div>
              <label class="block text-xs font-medium text-grey-700 mb-1.5">
                Result Reference
              </label>
              <USelectMenu
                v-model="formData.resultReference"
                :options="qmiResultsData || []"
                :loading="isLoadingQmiResults"
                placeholder="Choose a result"
                size="sm"
                value-attribute="value"
                option-attribute="label"
                searchable
                :ui="{ rounded: 'rounded-xxs' }"
                :uiMenu="{ rounded: 'rounded-xxs' }"
              />
            </div>

            <!-- Analysis Name -->
            <div>
              <label class="block text-xs font-medium text-grey-700 mb-1.5">
                Analysis Name (Optional)
              </label>
              <UInput
                v-model="formData.analysisName"
                type="text"
                placeholder="Auto-generated if empty"
                size="sm"
                :ui="{ rounded: 'rounded-xxs' }"
              />
            </div>

            <!-- Backbone & Backhaul Section -->
            <div class="space-y-2">
              <!-- <label class="block text-xs font-medium text-grey-700">
                Backbone & Backhaul
              </label> -->

              <!-- Existing Providers -->
              <div>
                <label class="block text-2xs text-grey-600 mb-1">
                  Backbone Route
                </label>
                <USelectMenu
                  v-model="formData.existingProviders"
                  :options="providerOptions"
                  placeholder="Select providers"
                  multiple
                  size="sm"
                  value-attribute="value"
                  option-attribute="label"
                  :ui="{ rounded: 'rounded-xxs' }"
                  :uiMenu="{ rounded: 'rounded-xxs' }"
                >
                  <template #label>
                    <span
                      v-if="formData.existingProviders.length === 0"
                      class="text-grey-500"
                    >
                      Select providers
                    </span>
                    <span v-else class="truncate">
                      {{
                        formData.existingProviders
                          .map((p: any) =>
                            typeof p === "object"
                              ? p.label
                              : providerOptions.find((opt) => opt.value === p)
                                  ?.label || p,
                          )
                          .join(", ")
                      }}
                    </span>
                  </template>
                </USelectMenu>
                <p
                  v-if="formData.existingProviders.length > 0"
                  class="text-2xs text-grey-600 mt-1"
                >
                  {{ formData.existingProviders.length }} provider(s) selected
                </p>
              </div>
            </div>

            <!-- Nearest POI -->
            <div>
              <label class="block text-xs font-medium text-grey-700 mb-1.5">
                Nearest POI
              </label>
              <USelectMenu
                v-model="formData.poiCategories"
                :options="poiCategoryOptions"
                placeholder="Select POI categories"
                multiple
                size="sm"
                value-attribute="value"
                option-attribute="label"
                :ui="{ rounded: 'rounded-xxs' }"
                :uiMenu="{
                  rounded: 'rounded-xxs',
                  option: { rounded: 'rounded-xxs' },
                }"
              >
                <template #label>
                  <span
                    v-if="formData.poiCategories.length === 0"
                    class="text-grey-500"
                  >
                    Select POI categories
                  </span>
                  <span v-else class="truncate">
                    {{
                      formData.poiCategories
                        .map((c: any) =>
                          typeof c === "object"
                            ? c.label
                            : poiCategoryOptions.find((opt) => opt.value === c)
                                ?.label || c,
                        )
                        .join(", ")
                    }}
                  </span>
                </template>
              </USelectMenu>
              <p
                v-if="formData.poiCategories.length > 0"
                class="text-2xs text-grey-600 mt-1"
              >
                {{ formData.poiCategories.length }} category(ies) selected
              </p>
            </div>

            <!-- Buffer Backbone Slider -->
            <div>
              <label class="block text-xs font-medium text-grey-700 mb-2">
                Buffer backbone:
                <span class="font-semibold text-brand-600"
                  >{{ formData.bufferDistance }}m</span
                >
              </label>
              <input
                v-model.number="formData.bufferDistance"
                type="range"
                min="10"
                max="400"
                step="10"
                class="w-full h-2 bg-grey-200 rounded-lg appearance-none cursor-pointer accent-brand-600"
              />
              <div class="flex justify-between text-2xs text-grey-500 mt-1">
                <span>10</span>
                <span>100</span>
                <span>200</span>
                <span>300</span>
                <span>400</span>
              </div>
            </div>
          </div>

          <!-- Action Buttons -->
          <div class="grid grid-cols-2 gap-2 pt-2 border-t border-grey-200">
            <UButton
              label="Analyze"
              color="brand"
              size="sm"
              block
              :loading="isAnalyzing"
              :disabled="isAnalyzeDisabled"
              @click="handleAnalyze"
              :ui="{ rounded: 'rounded-xxs' }"
            />
            <UButton
              label="Result"
              color="gray"
              variant="outline"
              size="sm"
              block
              :disabled="isQueued"
              :loading="isQueued"
              @click="handleShowResult"
              :ui="{ rounded: 'rounded-xxs' }"
            />
          </div>
        </div>
      </MenuItems>
    </transition>
  </Menu>
</template>

<style scoped>
/* Custom slider styling */
input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}

input[type="range"]::-moz-range-thumb {
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: #3b82f6;
  cursor: pointer;
  border: 2px solid white;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
}
</style>
