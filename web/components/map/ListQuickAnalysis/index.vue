<script setup lang="ts">
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import bbox from "@turf/bbox";
import type { LngLatBoundsLike } from "maplibre-gl";
import MergeAnalysisModal from "./MergeAnalysisModal.vue";
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";

const featureStore = useFeature();
const authStore = useAuth();
const mapRefStore = useMapRef();
const queryClient = useQueryClient();

const closeCoreTransaction = () => {
  featureStore.setMapInfo("");
};

// Active tab state
const activeTab = ref(0);
const tabs = [
  {
    label: "QMI Results",
    icon: "i-heroicons-chart-bar",
  },
  {
    label: "Route Insights",
    icon: "i-heroicons-map",
  },
  {
    label: "Antenna Direction",
    icon: "i-heroicons-signal",
  },
];

// Fetch qmi_result list
const { data: qmiResults, isLoading: isLoadingQmi } = useQuery({
  queryKey: ["qmi_result_list"],
  queryFn: async () => {
    const response = await $fetch<{ data: any[] }>(
      "/panel/items/qmi_result?fields=id,geoprocessing_uuid,date_created,name,excel&sort=-date_created&limit=-1",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return response.data;
  },
});

// Fetch quick_route_insight list
const { data: routeInsights, isLoading: isLoadingRoute } = useQuery({
  queryKey: ["route_insight_result_list"],
  queryFn: async () => {
    const response = await $fetch<{ data: any[] }>(
      "/panel/items/route_insight_result?fields=id,geoprocessing_uuid,date_created,name,excel&sort=-date_created&limit=-1",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return response.data;
  },
});

// Fetch antenna_direction list
const { data: antennaDirections, isLoading: isLoadingAntenna } = useQuery({
  queryKey: ["antenna_direction_result_list"],
  queryFn: async () => {
    const response = await $fetch<{ data: any[] }>(
      "/panel/items/antenna_direction?fields=id,geoprocessing_uuid,date_created,name,radius_m&sort=-date_created&limit=-1",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return response.data;
  },
});

const isLoading = computed(() => {
  if (activeTab.value === 0) return isLoadingQmi.value;
  if (activeTab.value === 1) return isLoadingRoute.value;
  return isLoadingAntenna.value;
});

const currentResults = computed(() => {
  if (activeTab.value === 0) return qmiResults.value;
  if (activeTab.value === 1) return routeInsights.value;
  return antennaDirections.value;
});

const formatDate = (dateString: string) => {
  try {
    const date = new Date(dateString);
    return date.toLocaleString("en-US", {
      month: "short",
      day: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
};

const analysisStore = useAnalysisResult();
const toast = useToast();
const loadingItemId = ref<string | number | null>(null);

// Merge analysis state
const isMergeModalOpen = ref(false);
const selectedQmiIds = ref<Set<number>>(new Set());
const mergeName = ref("");
const isMerging = ref(false);
const currentMergeMessageId = ref<string | null>(null);

const flyToAnalysis = (geojsonBuffer: any) => {
  if (!mapRefStore.map || !geojsonBuffer) {
    return;
  }

  try {
    const bounds = bbox(geojsonBuffer);
    mapRefStore.map.fitBounds(
      [
        [bounds[0], bounds[1]], // southwest corner [lng, lat]
        [bounds[2], bounds[3]], // northeast corner [lng, lat]
      ] as LngLatBoundsLike,
      {
        padding: { top: 100, bottom: 150, left: 350, right: 100 },
        duration: 1500,
      },
    );
  } catch (error) {
    console.error("Error flying to analysis:", error);
  }
};

const handleCardClick = async (item: any) => {
  loadingItemId.value = item.id;

  try {
    if (activeTab.value === 0) {
      // QMI Result
      const response = await $fetch<{ data: any }>(
        `/panel/items/qmi_result/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        },
      );

      // Store the result data for QMI result analysis panel
      analysisStore.setQmiResultData(response.data);
      analysisStore.setCurrentAnalysisType("qmi_result_analysis");

      // Fly to analysis area on map
      const geojsonBuffer = response.data?.result?.geojson_buffer;
      if (geojsonBuffer) {
        flyToAnalysis(geojsonBuffer);
      }
    } else if (activeTab.value === 1) {
      // Quick Route Insight
      const response = await $fetch<{ data: any }>(
        `/panel/items/route_insight_result/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        },
      );

      // Store the result data for Quick Route Insight analysis panel
      analysisStore.setQuickRouteInsightData(response.data);
      analysisStore.setCurrentAnalysisType("quick_route_insight_analysis");

      // Fly to analysis area on map
      const geojsonBuffer = response.data?.result?.geojson_buffer;
      if (geojsonBuffer) {
        flyToAnalysis(geojsonBuffer);
      }
    } else {
      // Antenna Direction
      const response = await $fetch<{ data: any }>(
        `/panel/items/antenna_direction/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        },
      );

      // Store the result data for Antenna Direction analysis panel.
      // The panel fetches its geojson on demand and flies to the extent.
      analysisStore.setAntennaDirectionData(response.data);
      analysisStore.setCurrentAnalysisType("antenna_direction_analysis");
    }

    toast.add({
      title: "Analysis Loaded",
      description: "View results in the analysis panel",
      icon: "i-heroicons-check-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    featureStore.setMapInfo("analytic");
  } catch (error: any) {
    toast.add({
      title: "Failed to Load",
      description: error?.data?.message || "Could not load analysis result",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    loadingItemId.value = null;
  }
};

// Merge analysis functions
const toggleQmiSelection = (qmiId: number) => {
  if (selectedQmiIds.value.has(qmiId)) {
    selectedQmiIds.value.delete(qmiId);
  } else {
    selectedQmiIds.value.add(qmiId);
  }
};

const clearSelection = () => {
  selectedQmiIds.value.clear();
  mergeName.value = "";
};

const handleMergeAnalysis = async () => {
  // Validation
  if (selectedQmiIds.value.size < 2) {
    toast.add({
      title: "Validation Error",
      description: "Please select at least 2 QMI results to merge",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  if (!mergeName.value.trim()) {
    toast.add({
      title: "Validation Error",
      description: "Please enter a name for the merged analysis",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  isMerging.value = true;

  try {
    const payload = {
      qmi_id: Array.from(selectedQmiIds.value),
      name: mergeName.value.trim(),
    };

    const response = await $fetch<{ message_id: string }>(
      "/panel/analysis/fwa-quick-market-insight-merge",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        body: payload,
      },
    );

    currentMergeMessageId.value = response.message_id;

    toast.add({
      title: "Merge Started",
      description: "Your merge analysis has been queued for processing",
      icon: "i-heroicons-clock",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    // Start polling queue status
    pollMergeQueueStatus(response.message_id);
  } catch (error: any) {
    toast.add({
      title: "Merge Failed",
      description: error?.data?.message || "Failed to start merge analysis",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    isMerging.value = false;
  }
};

const pollMergeQueueStatus = async (messageId: string) => {
  try {
    const response = await $fetch<{ data: any }>(
      `/panel/items/geoprocessing_queue/${messageId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    const { state, status } = response.data;

    // Check if processing is complete
    if (state === "done" && status === "success") {
      toast.add({
        title: "Merge Complete",
        description: "Your merge analysis has been successfully processed",
        icon: "i-heroicons-check-circle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });

      // Refetch QMI list to show new merged result
      queryClient.refetchQueries({ queryKey: ["qmi_result_list"] });

      // Reset state
      isMerging.value = false;
      currentMergeMessageId.value = null;
      isMergeModalOpen.value = false;
      clearSelection();
    } else if (state === "rejected" || status === "error") {
      toast.add({
        title: "Merge Failed",
        description: "The merge analysis task failed to complete",
        icon: "i-heroicons-x-circle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });

      isMerging.value = false;
      currentMergeMessageId.value = null;
    } else {
      // Still processing, poll again after 5 seconds
      setTimeout(() => pollMergeQueueStatus(messageId), 5000);
    }
  } catch (error: any) {
    toast.add({
      title: "Error",
      description: error?.data?.message || "Failed to check merge status",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    isMerging.value = false;
    currentMergeMessageId.value = null;
  }
};
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Header -->
    <div class="flex justify-between items-center">
      <div>
        <h2 class="text-grey-900 text-xs font-semibold">Quick Request List</h2>
        <p class="text-[10px] font-raleway text-grey-600 text-xxs">
          List of quick requests for analysis
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

    <!-- Tabs -->
    <div class="flex gap-1 p-1 bg-grey-100 rounded-xxs">
      <button
        v-for="(tab, index) in tabs"
        :key="index"
        @click="activeTab = index"
        :class="[
          'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-xxs text-xs font-medium transition-all',
          activeTab === index
            ? 'bg-white text-brand-600 shadow-sm'
            : 'text-grey-600 hover:text-grey-900',
        ]"
      >
        <UIcon :name="tab.icon" class="w-3.5 h-3.5" />
        <span>{{ tab.label }}</span>
      </button>
    </div>

    <!-- Loading State -->
    <div
      v-if="isLoading"
      class="flex flex-col items-center justify-center py-8"
    >
      <div
        class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"
      ></div>
      <p class="text-xs text-grey-500 mt-2">Loading results...</p>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!currentResults || currentResults.length === 0"
      class="flex flex-col items-center justify-center py-8"
    >
      <UIcon
        name="i-heroicons-document-text"
        class="w-12 h-12 text-grey-300 mb-2"
      />
      <p class="text-xs text-grey-600 font-medium">No analysis found</p>
      <p class="text-2xs text-grey-500 mt-1">
        Run a quick request to see results here
      </p>
    </div>

    <!-- Results List -->
    <div v-else class="space-y-2 h-[calc(100vh-23rem)] overflow-y-auto">
      <div
        v-for="item in currentResults"
        :key="item.id"
        @click="handleCardClick(item)"
        :class="[
          'bg-white border border-grey-200 rounded-xxs p-3 hover:border-brand-400 hover:shadow-sm transition-all',
          loadingItemId === item.id
            ? 'cursor-wait opacity-60'
            : 'cursor-pointer',
        ]"
      >
        <div class="flex items-start justify-between gap-2">
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 mb-1">
              <UIcon
                :name="
                  loadingItemId === item.id
                    ? 'i-heroicons-arrow-path'
                    : 'i-heroicons-document-chart-bar'
                "
                :class="[
                  'w-4 h-4 flex-shrink-0',
                  loadingItemId === item.id
                    ? 'text-brand-600 animate-spin'
                    : 'text-brand-500',
                ]"
              />
              <h3 class="text-xs font-semibold text-grey-900 truncate">
                {{ item.name || `Analysis ${item.geoprocessing_uuid}` }}
              </h3>
            </div>
            <div class="flex items-center gap-2 text-2xs text-grey-600">
              <UIcon name="i-heroicons-calendar" class="w-3 h-3" />
              <span>{{ formatDate(item.date_created) }}</span>
            </div>
          </div>
          <UIcon
            v-if="loadingItemId !== item.id"
            name="i-heroicons-chevron-right"
            class="w-4 h-4 text-grey-400 flex-shrink-0"
          />
          <div
            v-else
            class="animate-spin rounded-full h-4 w-4 border-b-2 border-brand-500 flex-shrink-0"
          ></div>
        </div>
      </div>
    </div>

    <!-- Sticky Merge Button (QMI Only) -->
    <div
      v-if="
        !isLoading && activeTab === 0 && qmiResults && qmiResults.length > 0
      "
      class="sticky bottom-0 bg-white border-t border-grey-200 pt-3 -mx-3 px-3 -mb-3 pb-3"
    >
      <UButton
        @click="isMergeModalOpen = true"
        color="primary"
        variant="solid"
        size="sm"
        block
        :disabled="isMerging"
        :ui="{ rounded: 'rounded-xxs' }"
      >
        <template #leading>
          <UIcon name="i-heroicons-arrows-pointing-in" />
        </template>
        {{ isMerging ? "Merging..." : "Merge Analysis" }}
      </UButton>
    </div>

    <!-- Merge Analysis Modal -->
    <UModal
      v-model="isMergeModalOpen"
      :ui="{ rounded: 'rounded-xs', width: 'sm:max-w-lg' }"
    >
      <MergeAnalysisModal
        :qmi-results="qmiResults || []"
        :selected-ids="selectedQmiIds"
        :merge-name="mergeName"
        :is-merging="isMerging"
        @update:selected-ids="selectedQmiIds = $event"
        @update:merge-name="mergeName = $event"
        @merge="handleMergeAnalysis"
        @cancel="
          isMergeModalOpen = false;
          clearSelection();
        "
      />
    </UModal>
  </div>
</template>
