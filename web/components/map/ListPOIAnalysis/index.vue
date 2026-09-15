<script setup lang="ts">
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import bbox from "@turf/bbox";
import type { LngLatBoundsLike } from "maplibre-gl";
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";

const featureStore = useFeature();
const authStore = useAuth();
const mapRefStore = useMapRef();
const queryClient = useQueryClient();

const closePOIAnalysis = () => {
  featureStore.setMapInfo("");
};

// Active tab state
const activeTab = ref(0);
const tabs = [
  {
    label: "POI Insights",
    icon: "i-heroicons-map-pin",
  },
  {
    label: "Route Insights",
    icon: "i-heroicons-map",
  },
];

// Fetch poi_insight_result list
const { data: poiResults, isLoading: isLoadingPoi } = useQuery({
  queryKey: ["poi_insight_result_list"],
  queryFn: async () => {
    const response = await $fetch<{ data: any[] }>(
      "/panel/items/poi_insight_result?fields=id,geoprocessing_uuid,date_created,name,excel&sort=-date_created&limit=-1",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return response.data;
  },
});

// Fetch route_insight_result list (for market-potential module)
const { data: routeInsights, isLoading: isLoadingRoute } = useQuery({
  queryKey: ["market_route_insight_result_list"],
  queryFn: async () => {
    const response = await $fetch<{ data: any[] }>(
      "/panel/items/poi_route_insight_result?fields=id,geoprocessing_uuid,date_created,name,excel&sort=-date_created&limit=-1",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return response.data;
  },
});

const isLoading = computed(() =>
  activeTab.value === 0 ? isLoadingPoi.value : isLoadingRoute.value,
);

const currentResults = computed(() =>
  activeTab.value === 0 ? poiResults.value : routeInsights.value,
);

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

const handleCardClick = async (item: any) => {
  loadingItemId.value = item.id;

  try {
    if (activeTab.value === 0) {
      // POI Insight Result
      const response = await $fetch<{ data: any }>(
        `/panel/items/poi_insight_result/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        },
      );

      // Store the result data for POI Insight analysis panel
      analysisStore.setQmiResultData(response.data);
      analysisStore.setCurrentAnalysisType("poi_insight_analysis");

      // Fly to analysis area on map using bounding_box from API
      await nextTick();

      const boundingBox = response.data?.result?.bounding_box;
      if (
        boundingBox &&
        Array.isArray(boundingBox) &&
        boundingBox.length === 4
      ) {
        const map = mapRefStore.map;
        if (map) {
          try {
            map.fitBounds(
              [
                [boundingBox[0], boundingBox[1]], // southwest [minLng, minLat]
                [boundingBox[2], boundingBox[3]], // northeast [maxLng, maxLat]
              ] as LngLatBoundsLike,
              {
                padding: { top: 100, bottom: 150, left: 350, right: 100 },
                duration: 1500,
              },
            );
          } catch (error) {
            console.error("Error during fitBounds:", error);
          }
        }
      }
    } else {
      // POI Route Insight Result
      const response = await $fetch<{ data: any }>(
        `/panel/items/poi_route_insight_result/${item.id}`,
        {
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        },
      );

      // Store the result data for POI Route Insight analysis panel
      analysisStore.setQuickRouteInsightData(response.data);
      analysisStore.setCurrentAnalysisType("quick_route_insight_analysis");

      // Fly to analysis area on map using bounding_box from API
      await nextTick();

      const boundingBox = response.data?.result?.bounding_box;
      if (
        boundingBox &&
        Array.isArray(boundingBox) &&
        boundingBox.length === 4
      ) {
        const map = mapRefStore.map;
        if (map) {
          try {
            map.fitBounds(
              [
                [boundingBox[0], boundingBox[1]], // southwest [minLng, minLat]
                [boundingBox[2], boundingBox[3]], // northeast [maxLng, maxLat]
              ] as LngLatBoundsLike,
              {
                padding: { top: 100, bottom: 150, left: 350, right: 100 },
                duration: 1500,
              },
            );
          } catch (error) {
            console.error("Error during fitBounds:", error);
          }
        }
      }
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

const handleDownloadExcel = async (item: any, event: Event) => {
  event.stopPropagation();

  if (!item.excel) {
    toast.add({
      title: "No Excel File",
      description: "This analysis does not have an Excel export",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  try {
    const link = document.createElement("a");
    link.href = `/panel/assets/${item.excel}`;
    link.download = `${item.name || "poi_analysis"}.xlsx`;
    link.click();

    toast.add({
      title: "Download Started",
      description: "Excel file is being downloaded",
      icon: "i-heroicons-arrow-down-tray",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } catch (error: any) {
    toast.add({
      title: "Download Failed",
      description: error?.message || "Could not download Excel file",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  }
};
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Header -->
    <div class="flex justify-between items-center">
      <div>
        <h2 class="text-grey-900 text-xs font-semibold">
          Market Potential Analysis
        </h2>
        <p class="text-[10px] font-raleway text-grey-600 text-xxs">
          POI insights and route analysis results
        </p>
      </div>
      <IcArrowLeft
        role="button"
        @click="closePOIAnalysis"
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
      <p class="text-xs text-grey-500 mt-2">Loading POI insights...</p>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!currentResults || currentResults.length === 0"
      class="flex flex-col items-center justify-center py-8"
    >
      <UIcon
        :name="activeTab === 0 ? 'i-heroicons-map-pin' : 'i-heroicons-map'"
        class="w-12 h-12 text-grey-300 mb-2"
      />
      <p class="text-xs text-grey-600 font-medium">No analysis found</p>
      <p class="text-2xs text-grey-500 mt-1">
        Run an analysis to see results here
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
                    : activeTab === 0
                      ? 'i-heroicons-map-pin'
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
  </div>
</template>
