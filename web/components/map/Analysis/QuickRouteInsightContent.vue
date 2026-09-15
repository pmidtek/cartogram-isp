<script lang="ts" setup>
import IcPin from "~/assets/icons/ic-pin.svg";
import IcSignal from "~/assets/icons/ic-signal.svg";
import { computed, ref, onUnmounted } from "vue";
import { feature } from "@turf/helpers";
import bbox from "@turf/bbox";
import maplibregl from "maplibre-gl";
import { Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";

// Register Chart.js components
ChartJS.register(
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  ChartDataLabels,
);

interface Tower {
  id: number;
  name: string;
  properties: any;
  geometry?: any;
  sectors?: any[];
}

interface Props {
  data: any;
  isLoading: boolean;
  isError: boolean;
  error: Error | null;
  radius: number;
}

const props = defineProps<Props>();

const mapRefStore = useMapRef();
const toast = useToast();

const geojsonRoute = computed(() => {
  return props.data?.geojson_route || null;
});

const geojsonBuffer = computed(() => {
  return props.data?.geojson_buffer || null;
});

const geojsonSector = computed(() => {
  return props.data?.geojson_sector || null;
});

const towersList = computed<Tower[]>(() => {
  if (!geojsonBuffer.value?.features) return [];

  const sectorsMap = new Map<number, any[]>();

  if (geojsonSector.value?.features) {
    const sectorFeatures = geojsonSector.value?.features;
    sectorFeatures.forEach((feature: any) => {
      const towerId = feature.properties?.tower_id;
      if (towerId !== undefined) {
        if (!sectorsMap.has(towerId)) {
          sectorsMap.set(towerId, []);
        }
        sectorsMap.get(towerId)?.push(feature.properties);
      }
    });

    geojsonBuffer.value.features.forEach((feature: any) => {
      const towerId = feature.properties?.id || feature.properties?.tower_id;
      if (towerId !== undefined) {
        feature.properties.sector = sectorsMap.get(towerId)?.[0];
      }
    });
  }

  return geojsonBuffer.value.features.map((feature: any, index: number) => {
    const towerId = feature.properties?.id || index;
    const sectors = sectorsMap.get(towerId) || [];

    return {
      id: towerId,
      name: feature.properties?.site_name || `Tower ${index + 1}`,
      properties: feature.properties || {},
      geometry: feature.geometry,
      sectors: sectors,
    };
  });
});

const totalTowers = computed(() => {
  return towersList.value.length;
});

const hasData = computed(() => {
  return totalTowers.value > 0;
});

const analyticsData = computed(() => props.data?.analytics);

// Route list from geojson_route
const routesList = computed(() => {
  if (!geojsonRoute.value?.features) return [];

  return geojsonRoute.value.features.map((feature: any, index: number) => ({
    id: feature.properties?.id || index,
    geometry: feature.geometry,
    properties: feature.properties || {},
    source: feature.properties?.source_info || {},
    destination: feature.properties?.destination_info || {},
    distance: feature.properties?.distance || 0,
    fpByHsClass: feature.properties?.fp_by_hs_class || {},
    finalFootprintCount: feature.properties?.final_footprint_count || 0,
    poiByCategory: feature.properties?.poi_by_category || [],
    finalPoiCount: feature.properties?.final_poi_count || 0,
  }));
});

const totalRoutes = computed(() => routesList.value.length);

// Tower colors
const towerColors: Record<string, string> = {
  CTM: "#10B981",
  TBG: "#F5C400",
  Alfa: "#EF4444",
  Balcom: "#F59E0B",
  Gihon: "#3B82F6",
  PKP: "#8B5CF6",
};
const fallbackColors = ["#6B7280", "#9CA3AF", "#D1D5DB"];

// Bar chart data for footprint by owner
const fpByOwnerChartData = computed(() => ({
  labels:
    analyticsData.value?.fp_by_owner?.map((item: any) => item.owner) || [],
  datasets: [
    {
      label: "Footprint Count",
      data:
        analyticsData.value?.fp_by_owner?.map(
          (item: any) => item.footprint_count,
        ) || [],
      backgroundColor:
        analyticsData.value?.fp_by_owner?.map((item: any) => {
          const baseColor = towerColors[item.owner] || fallbackColors[0];
          if (
            selectedTowerOwner.value &&
            selectedTowerOwner.value !== item.owner
          ) {
            return baseColor + "26";
          }
          return baseColor;
        }) || [],
      borderRadius: 8,
      borderWidth:
        analyticsData.value?.fp_by_owner?.map((item: any) =>
          selectedTowerOwner.value === item.owner ? 3 : 0,
        ) || [],
      borderColor:
        analyticsData.value?.fp_by_owner?.map((item: any) =>
          selectedTowerOwner.value === item.owner ? "#FFFFFF" : "transparent",
        ) || [],
      barThickness: 24,
    },
  ],
}));

const fpByOwnerChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  onClick: (event: any, elements: any[]) => {
    handleChartClick(event, elements);
  },
  plugins: {
    legend: { display: false },
    datalabels: {
      anchor: "end" as const,
      align: "top" as const,
      formatter: (value: number, context: any) => {
        const percentage =
          analyticsData.value?.fp_by_owner?.[context.dataIndex]
            ?.footprint_count || 0;
        return `${percentage.toFixed(1)}`;
      },
      color: "#000",
      font: { size: 9, weight: "bold" as const },
    },
    tooltip: {
      backgroundColor: "#1E1D1E",
      titleColor: "#FEFEFE",
      bodyColor: "#E4E3E4",
      borderColor: "#4C4B4C",
      borderWidth: 1,
      padding: 12,
      callbacks: {
        label: (context: any) => {
          const value = context.parsed.y || 0;
          const percentage =
            analyticsData.value?.fp_by_owner?.[context.dataIndex]?.percentage ||
            0;
          return `Footprint: ${value.toLocaleString()} (${percentage.toFixed(1)}%)`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: {
        color: "#AFAEAF",
        font: { size: 10 },
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: "#AFAEAF",
        font: { size: 10 },
        callback: (value: any) => value.toLocaleString(),
      },
    },
  },
};

const formatNumber = (value: number): string => {
  return new Intl.NumberFormat("en-US").format(value);
};

const selectedTowerOwner = ref<string | null>(null);
const geojsonTower = computed(() => props.data?.geojson_tower);

const handleChartClick = (event: any, elements: any[]) => {
  if (!elements || elements.length === 0) {
    selectedTowerOwner.value = null;
    highlightTowersByOwner(null);
    return;
  }

  const element = elements[0];
  const dataIndex = element.index;
  const ownerName =
    analyticsData.value?.fp_by_owner?.[dataIndex]?.owner || null;

  if (!ownerName) return;

  if (selectedTowerOwner.value === ownerName) {
    selectedTowerOwner.value = null;
    highlightTowersByOwner(null);
  } else {
    selectedTowerOwner.value = ownerName;
    highlightTowersByOwner(ownerName);
  }
};

const highlightTowersByOwner = (ownerName: string | null) => {
  const map = mapRefStore.map;
  if (!map || !geojsonTower.value) return;

  if (!ownerName) {
    showHighlightLayer(map, [], "quick-route-insight-buffer-analysis");
    return;
  }

  const filteredFeatures = geojsonTower.value.features.filter(
    (feature: any) => feature.properties?.owner === ownerName,
  );

  if (filteredFeatures.length === 0) return;

  const formattedFeatures = filteredFeatures.map((feature: any) => ({
    geom: feature.geometry,
    ...feature.properties,
  }));

  showHighlightLayer(
    map,
    formattedFeatures,
    "quick-route-insight-buffer-analysis",
    true,
  );

  const coordinates = filteredFeatures
    .map((feature: any) => feature.geometry?.coordinates)
    .filter((coord: any) => coord);

  if (coordinates.length > 0) {
    const bounds = coordinates.reduce(
      (bounds: any, coord: any) => {
        return bounds.extend(coord);
      },
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );

    map.fitBounds(bounds, {
      padding: 100,
      duration: 1000,
      maxZoom: 14,
    });
  }
};

onUnmounted(() => {
  const map = mapRefStore.map;
  if (!map) return;
  showHighlightLayer(map, [], "quick-route-insight-buffer-analysis");
});

const zoomToTower = (tower: Tower) => {
  if (!mapRefStore.map || !tower.geometry) {
    console.warn("Cannot zoom to tower: map or geometry not available");
    return;
  }

  try {
    const map = mapRefStore.map;
    const towerFeature = feature(tower.geometry);
    const bounds = bbox(towerFeature);

    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {
        padding: 100,
        duration: 1500,
      },
    );
  } catch (error) {
    console.error("Error zooming to tower:", error);
  }
};

const zoomToRoute = (route: any) => {
  if (!mapRefStore.map || !route.geometry) {
    console.warn("Cannot zoom to route: map or geometry not available");
    return;
  }

  try {
    const map = mapRefStore.map;
    const routeFeature = feature(route.geometry);
    const bounds = bbox(routeFeature);

    // Highlight the route
    const formattedRoute = {
      geom: route.geometry,
      ...route.properties,
    };

    showHighlightLayer(
      map,
      [formattedRoute],
      "quick-route-insight-route-highlight",
      true,
    );

    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {
        padding: 100,
        duration: 1500,
        zoom: 17,
      },
    );
  } catch (error) {
    console.error("Error zooming to route:", error);
  }
};
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Loading State -->
    <div
      v-if="isLoading"
      class="h-[calc(100dvh-30rem)] flex flex-col items-center justify-center py-8 gap-2 text-grey-500"
    >
      <UIcon name="i-heroicons-arrow-path" class="w-8 h-8 animate-spin" />
      <p class="text-xs text-grey-600">Loading data...</p>
    </div>

    <!-- Error State -->
    <div
      v-else-if="isError"
      class="h-[calc(100dvh-30rem)] flex flex-col items-center justify-center py-8 gap-2 text-red-500"
    >
      <UIcon name="i-heroicons-exclamation-circle" class="w-8 h-8" />
      <p class="text-xs text-center">
        Failed to load data<br />
        <span class="text-grey-500">{{
          error?.message || "Please try again"
        }}</span>
      </p>
    </div>

    <!-- Empty State -->
    <div
      v-else-if="!hasData"
      class="h-[calc(100dvh-30rem)] flex flex-col items-center justify-center py-8 gap-2 text-grey-500"
    >
      <UIcon name="i-heroicons-funnel" class="w-8 h-8" />
      <p class="text-xs text-center">
        No data available.<br />Run analysis to see results.
      </p>
    </div>

    <!-- Summary Statistics -->
    <div v-else class="flex flex-col gap-3">
      <!-- Analysis Summary Card -->
      <div
        class="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xs border border-blue-200"
      >
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-4">
            <div class="p-2 bg-blue-500 rounded-lg">
              <IcSignal class="w-5 h-5 text-white" />
            </div>
            <div>
              <p class="text-xs text-grey-600">Route Insight Analysis</p>
              <p class="text-md font-bold text-grey-900">
                {{ formatNumber(data?.analytics?.total_footprint) || 0 }}
                meters Cable
              </p>
              <p class="text-md font-bold text-grey-900">
                {{ formatNumber(data?.analytics?.total_tower) || 0 }} Towers
              </p>
              <p class="text-md font-bold text-grey-900">
                {{ formatNumber(data?.analytics?.total_footprint) || 0 }}
                Footprints
              </p>
              <p class="text-md font-bold text-grey-900">
                <!-- {{ formatNumber(data?.analytics?.total_poi) || 0 }} POI -->
                745 POI
              </p>
            </div>
          </div>
          <div class="text-right">
            <p class="text-xs text-grey-600">Buffer Radius</p>
            <p class="text-lg font-bold text-blue-600">
              {{ data?.options?.radius || 0 }} m
            </p>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs text-grey-600">
          <UIcon name="i-heroicons-information-circle" class="w-4 h-4" />
          <span>Quick Route Insight with backbone and POI analysis</span>
        </div>
      </div>

      <!-- Footprint by Owner Chart -->
      <div
        v-if="
          analyticsData?.fp_by_owner && analyticsData?.fp_by_owner.length > 0
        "
      >
        <p class="text-grey-900 text-sm mb-2 font-semibold">
          Footprint by Tower Owner
        </p>
        <div class="h-[200px]" style="cursor: pointer">
          <Bar :data="fpByOwnerChartData" :options="fpByOwnerChartOptions" />
        </div>
      </div>

      <!-- Route List Header -->
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-grey-800">Route Detail</h3>
        <UBadge
          :label="`${totalRoutes} routes`"
          size="sm"
          color="blue"
          variant="subtle"
        />
      </div>

      <!-- Route List -->
      <div
        class="flex flex-col gap-2 max-h-[calc(100dvh-31rem)] overflow-y-auto pr-1"
      >
        <div
          v-for="(route, index) in routesList"
          :key="route.id"
          class="group relative bg-white p-3 rounded-lg border border-grey-200 hover:border-blue-400 hover:shadow-md transition-all duration-200"
        >
          <!-- Route Header -->
          <div class="flex items-start gap-1">
            <!-- Index Badge -->
            <div
              class="flex-shrink-0 w-5 h-5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center"
            >
              <span class="text-xs font-bold text-white">{{ index + 1 }}</span>
            </div>

            <!-- Route Info -->
            <div class="flex-1 min-w-0">
              <!-- Route Source and Destination -->
              <div class="space-y-2 mb-3">
                <!-- Source -->
                <div class="flex items-start gap-2">
                  <UIcon
                    name="i-heroicons-arrow-right-circle"
                    class="w-4 h-4 text-green-600 flex-shrink-0 mt-0.5"
                  />
                  <div class="flex-1 min-w-0">
                    <p class="text-xs font-medium text-grey-600 mb-1">Source</p>
                    <p class="text-sm font-semibold text-grey-900 truncate">
                      {{ route.source?.name || "-" }}
                    </p>
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                      <UBadge
                        v-if="route.source?.type"
                        :label="route.source.type"
                        size="xs"
                        color="green"
                        variant="subtle"
                      />
                      <UBadge
                        v-if="route.source?.code"
                        :label="route.source.code"
                        size="xs"
                        color="gray"
                        variant="subtle"
                      />
                      <UBadge
                        v-if="route.source?.owner"
                        :label="route.source.owner"
                        size="xs"
                        color="gray"
                        variant="subtle"
                      />
                    </div>
                  </div>
                </div>

                <!-- Destination -->
                <div class="flex items-start gap-2">
                  <UIcon
                    name="i-heroicons-map-pin"
                    class="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5"
                  />
                  <div class="flex-1 min-w-0">
                    <p class="text-xs font-medium text-grey-600 mb-1">
                      Destination
                    </p>
                    <p class="text-sm font-semibold text-grey-900 truncate">
                      {{ route.destination?.name || "-" }}
                    </p>
                    <div class="flex items-center gap-2 mt-1 flex-wrap">
                      <UBadge
                        v-if="route.destination?.type"
                        :label="route.destination.type"
                        size="xs"
                        color="red"
                        variant="subtle"
                      />
                      <UBadge
                        v-if="route.destination?.code"
                        :label="route.destination.code"
                        size="xs"
                        color="gray"
                        variant="subtle"
                      />
                      <UBadge
                        v-if="route.destination?.owner"
                        :label="route.destination.owner"
                        size="xs"
                        color="gray"
                        variant="subtle"
                      />
                    </div>
                  </div>
                </div>
              </div>

              <!-- Route Distance -->
              <div
                class="flex items-center gap-2 p-2 bg-blue-50 rounded-xs mb-3"
              >
                <UIcon
                  name="i-heroicons-arrow-long-right"
                  class="w-4 h-4 text-blue-600"
                />
                <div class="flex-1">
                  <p class="text-xs text-grey-600">Route Distance</p>
                  <p class="text-sm font-bold text-blue-900">
                    {{ (route.distance / 1000).toFixed(2) }} km
                  </p>
                </div>
              </div>

              <!-- Footprint Details Accordion -->
              <UAccordion
                v-if="route.fpByHsClass && route.finalFootprintCount > 0"
                :items="[
                  {
                    label: 'Footprint Details',
                    icon: 'i-heroicons-chart-bar',
                    slot: `footprint-${route.id}`,
                    defaultOpen: false,
                  },
                ]"
                class="mt-3"
                :ui="{ item: { padding: 'p-2' } }"
              >
                <template #default="{ item, open }">
                  <UButton
                    color="gray"
                    variant="ghost"
                    class="w-full px-0 pt-2 hover:bg-grey-50"
                  >
                    <div class="flex items-center justify-between w-full">
                      <div class="flex items-center gap-2">
                        <UIcon
                          :name="item.icon"
                          class="w-4 h-4 text-grey-600"
                        />
                        <span class="text-xs font-semibold text-grey-800">{{
                          item.label
                        }}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <UBadge
                          :label="`${route.finalFootprintCount} Footprints`"
                          color="gray"
                          size="xs"
                          :ui="{ rounded: 'rounded-xs' }"
                          variant="subtle"
                        />
                        <UIcon
                          :name="
                            open
                              ? 'i-heroicons-chevron-up'
                              : 'i-heroicons-chevron-down'
                          "
                          class="w-4 h-4 text-grey-500 transition-transform"
                        />
                      </div>
                    </div>
                  </UButton>
                </template>

                <template #[`footprint-${route.id}`]>
                  <div class="space-y-2 bg-grey-50/50">
                    <!-- High Class -->
                    <div
                      v-if="route.fpByHsClass.high"
                      class="flex items-center gap-2 p-2 bg-white rounded-xs border border-grey-200"
                    >
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span
                          class="text-xs font-medium text-grey-600 min-w-[100px]"
                          >High</span
                        >
                        <div
                          class="flex-1 h-1.5 bg-grey-100 rounded-full overflow-hidden"
                        >
                          <div
                            class="h-full bg-blue-500 rounded-full transition-all duration-500"
                            :style="{
                              width: `${
                                (route.fpByHsClass.high /
                                  route.finalFootprintCount) *
                                100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          route.fpByHsClass.high
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            (
                              (route.fpByHsClass.high /
                                route.finalFootprintCount) *
                              100
                            ).toFixed(0)
                          }}%</span
                        >
                      </div>
                    </div>

                    <!-- Mid -->
                    <div
                      v-if="route.fpByHsClass.mid"
                      class="flex items-center gap-2 p-2 bg-white rounded-xs border border-grey-200"
                    >
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span
                          class="text-xs font-medium text-grey-600 min-w-[100px]"
                          >Mid</span
                        >
                        <div
                          class="flex-1 h-1.5 bg-grey-100 rounded-full overflow-hidden"
                        >
                          <div
                            class="h-full bg-blue-500 rounded-full transition-all duration-500"
                            :style="{
                              width: `${
                                (route.fpByHsClass.mid /
                                  route.finalFootprintCount) *
                                100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          route.fpByHsClass.mid
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            (
                              (route.fpByHsClass.mid /
                                route.finalFootprintCount) *
                              100
                            ).toFixed(0)
                          }}%</span
                        >
                      </div>
                    </div>

                    <!-- Low -->
                    <div
                      v-if="route.fpByHsClass.low"
                      class="flex items-center gap-2 p-2 bg-white rounded-xs border border-grey-200"
                    >
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span
                          class="text-xs font-medium text-grey-600 min-w-[100px]"
                          >Low</span
                        >
                        <div
                          class="flex-1 h-1.5 bg-grey-100 rounded-full overflow-hidden"
                        >
                          <div
                            class="h-full bg-blue-500 rounded-full transition-all duration-500"
                            :style="{
                              width: `${
                                (route.fpByHsClass.low /
                                  route.finalFootprintCount) *
                                100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          route.fpByHsClass.low
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            (
                              (route.fpByHsClass.low /
                                route.finalFootprintCount) *
                              100
                            ).toFixed(0)
                          }}%</span
                        >
                      </div>
                    </div>

                    <!-- Very Low -->
                    <div
                      v-if="route.fpByHsClass.very_low"
                      class="flex items-center gap-2 p-2 bg-white rounded-xs border border-grey-200"
                    >
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span
                          class="text-xs font-medium text-grey-600 min-w-[100px]"
                          >Very Low</span
                        >
                        <div
                          class="flex-1 h-1.5 bg-grey-100 rounded-full overflow-hidden"
                        >
                          <div
                            class="h-full bg-blue-500 rounded-full transition-all duration-500"
                            :style="{
                              width: `${
                                (route.fpByHsClass.very_low /
                                  route.finalFootprintCount) *
                                100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          route.fpByHsClass.very_low
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            (
                              (route.fpByHsClass.very_low /
                                route.finalFootprintCount) *
                              100
                            ).toFixed(0)
                          }}%</span
                        >
                      </div>
                    </div>

                    <!-- Non-Residential -->
                    <div
                      v-if="route.fpByHsClass.non_residential"
                      class="flex items-center gap-2 p-2 bg-white rounded-xs border border-grey-200"
                    >
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span
                          class="text-xs font-medium text-grey-600 min-w-[100px]"
                          >Non-Residential</span
                        >
                        <div
                          class="flex-1 h-1.5 bg-grey-100 rounded-full overflow-hidden"
                        >
                          <div
                            class="h-full bg-blue-500 rounded-full transition-all duration-500"
                            :style="{
                              width: `${
                                (route.fpByHsClass.non_residential /
                                  route.finalFootprintCount) *
                                100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          route.fpByHsClass.non_residential
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            (
                              (route.fpByHsClass.non_residential /
                                route.finalFootprintCount) *
                              100
                            ).toFixed(0)
                          }}%</span
                        >
                      </div>
                    </div>
                  </div>
                </template>
              </UAccordion>

              <!-- POI Details Accordion -->
              <UAccordion
                v-if="route.poiByCategory && route.finalPoiCount > 0"
                :items="[
                  {
                    label: 'POI Details',
                    icon: 'i-heroicons-building-storefront',
                    slot: `poi-${route.id}`,
                    defaultOpen: false,
                  },
                ]"
                class="mt-3"
                :ui="{ item: { padding: 'p-2' } }"
              >
                <template #default="{ item, open }">
                  <UButton
                    color="gray"
                    variant="ghost"
                    class="w-full px-0 pt-2 hover:bg-grey-50"
                  >
                    <div class="flex items-center justify-between w-full">
                      <div class="flex items-center gap-2">
                        <UIcon
                          :name="item.icon"
                          class="w-4 h-4 text-grey-600"
                        />
                        <span class="text-xs font-semibold text-grey-800">{{
                          item.label
                        }}</span>
                      </div>
                      <div class="flex items-center gap-2">
                        <UBadge
                          :label="`${route.finalPoiCount} POI`"
                          color="gray"
                          size="xs"
                          :ui="{ rounded: 'rounded-xs' }"
                          variant="subtle"
                        />
                        <UIcon
                          :name="
                            open
                              ? 'i-heroicons-chevron-up'
                              : 'i-heroicons-chevron-down'
                          "
                          class="w-4 h-4 text-grey-500 transition-transform"
                        />
                      </div>
                    </div>
                  </UButton>
                </template>

                <template #[`poi-${route.id}`]>
                  <div class="space-y-2 bg-grey-50/50">
                    <div
                      v-for="(poi, poiIndex) in route.poiByCategory"
                      :key="`poi-${route.id}-${poiIndex}`"
                      class="flex items-center gap-2 p-2 bg-white rounded-xs border border-grey-200"
                    >
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <span
                          class="text-xs font-medium text-grey-600 min-w-[100px] truncate"
                          :title="poi.category"
                          >{{ poi.category }}</span
                        >
                        <div
                          class="flex-1 h-1.5 bg-grey-100 rounded-full overflow-hidden"
                        >
                          <div
                            class="h-full bg-blue-500 rounded-full transition-all duration-500"
                            :style="{
                              width: `${
                                (poi.count / route.finalPoiCount) * 100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          poi.count
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            ((poi.count / route.finalPoiCount) * 100).toFixed(
                              0,
                            )
                          }}%</span
                        >
                      </div>
                    </div>
                  </div>
                </template>
              </UAccordion>
            </div>

            <!-- Action Buttons -->
            <div class="flex-shrink-0 flex">
              <UButton
                size="xs"
                color="gray"
                variant="ghost"
                class="p-0"
                @click="zoomToRoute(route)"
                :ui="{ rounded: 'rounded-xs' }"
                title="Zoom to route"
              >
                <IcPin class="text-lg text-grey-500" />
              </UButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
