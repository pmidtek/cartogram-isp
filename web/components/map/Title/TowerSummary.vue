<script setup lang="ts">
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";
import { useQuery } from "@tanstack/vue-query";
import { Doughnut, Bar } from "vue-chartjs";
import {
  Chart as ChartJS,
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";
import ChartDataLabels from "chartjs-plugin-datalabels";

// Register Chart.js components
ChartJS.register(
  ArcElement,
  BarElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  ChartDataLabels,
);

// Stores
const authStore = useAuth();
const mapLayerStore = useMapLayer();
const { toggleTowerLayersByOwner } = mapLayerStore;
const mapRefStore = useMapRef();

// State
const selectedProvince = ref<number | null>(null);
const selectedCity = ref<number | null>(null);
const selectedTowerOwner = ref<string | null>(null);
const isTop10ModalOpen = ref(false);
const featureStore = useFeature();
const selectedTowerOwnerForMap = ref<string | null>(null);

const closeCoreTransaction = () => {
  featureStore.setMapInfo("");
};

// Tower color palette (from useMapLayer.ts lines 660-667)
const towerColors: Record<string, string> = {
  CTM: "#10B981", // Green
  TBG: "#F5C400", // Yellow
  Alfa: "#EF4444", // Red
  Balcom: "#F59E0B", // Amber
  Gihon: "#3B82F6", // Blue
  PKP: "#8B5CF6", // Purple
};
const fallbackColors = ["#6B7280", "#9CA3AF", "#D1D5DB"];

// Tower owner options for Top 10 filter
const towerOwnerOptions = [
  { value: "CTM", label: "CTM" },
  { value: "TBG", label: "TBG" },
  { value: "Alfa", label: "Alfa" },
  { value: "Balcom", label: "Balcom" },
  { value: "Gihon", label: "Gihon" },
  { value: "PKP", label: "PKP" },
];

// Queries
const { data: provincesData, isLoading: isLoadingProvinces } = useQuery({
  queryKey: ["/panel/items/area_provinces"],
  queryFn: async () => {
    const res = await $fetch<{ data: any[] }>(
      "/panel/items/area_provinces?fields=ogc_fid,province,province_id&sort=province",
      {
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
      },
    );
    return res.data.map((item) => ({
      value: item.province_id,
      label: item.province,
    }));
  },
});

const { data: citiesData, isLoading: isLoadingCities } = useQuery({
  queryKey: ["/panel/items/area_cities", selectedProvince],
  queryFn: async () => {
    if (!selectedProvince.value) return [];
    const res = await $fetch<{ data: any[] }>(
      `/panel/items/area_cities?fields=ogc_fid,city,city_id&filter[province_id][_eq]=${selectedProvince.value}&sort=city`,
      {
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
      },
    );
    return res.data.map((item) => ({
      value: item.city_id,
      label: item.city,
    }));
  },
  enabled: computed(() => !!selectedProvince.value),
});

const { data: towerData, isLoading: isLoadingTowers } = useQuery({
  queryKey: ["/panel/chart/count/tower-owner", selectedProvince, selectedCity],
  queryFn: async () => {
    let url = "/panel/chart/count/tower-owner?";
    if (selectedProvince.value) url += `&province_id=${selectedProvince.value}`;
    if (selectedCity.value) url += `&city_id=${selectedCity.value}`;

    return await $fetch<TowerCountResponse>(url, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
  },
});

// Top 10 Provinces by Tower Owner Query
const { data: top10Data, isLoading: isLoadingTop10 } = useQuery({
  queryKey: ["/panel/chart/count/tower-area", selectedTowerOwner],
  queryFn: async () => {
    if (!selectedTowerOwner.value) return null;
    return await $fetch<Top10Response>(
      `/panel/chart/count/tower-area?owner=${selectedTowerOwner.value}&group_by=province&limit=10`,
      {
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
      },
    );
  },
  enabled: computed(() => !!selectedTowerOwner.value),
});

// City Detail for Modal Query
const { data: cityDetailData, isLoading: isLoadingCityDetail } = useQuery({
  queryKey: [
    "/panel/chart/count/tower-area-city",
    selectedTowerOwner,
    isTop10ModalOpen,
  ],
  queryFn: async () => {
    if (!selectedTowerOwner.value || !isTop10ModalOpen.value) return null;
    return await $fetch<CityDetailResponse>(
      `/panel/chart/count/tower-area?owner=${selectedTowerOwner.value}&group_by=city&limit=1000`,
      {
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
      },
    );
  },
  enabled: computed(() => !!selectedTowerOwner.value && isTop10ModalOpen.value),
});

// Computed
const provinceOptions = computed(() => provincesData.value || []);
const cityOptions = computed(() => citiesData.value || []);

const doughnutChartData = computed(() => ({
  labels: towerData.value?.data.list.map((item) => item.owner) || [],
  datasets: [
    {
      data: towerData.value?.data.list.map((item) => item.count) || [],
      backgroundColor:
        towerData.value?.data.list.map((item) => {
          const baseColor = towerColors[item.owner] || fallbackColors[0];
          // Dim unselected segments to 15% opacity
          if (
            selectedTowerOwnerForMap.value &&
            selectedTowerOwnerForMap.value !== item.owner
          ) {
            return baseColor + "26"; // 15% opacity
          }
          return baseColor;
        }) || [],
      borderColor:
        towerData.value?.data.list.map((item) =>
          selectedTowerOwnerForMap.value === item.owner ? "#FFFFFF" : "#000",
        ) || [],
      borderWidth:
        towerData.value?.data.list.map((item) =>
          selectedTowerOwnerForMap.value === item.owner ? 4 : 2,
        ) || [],
      hoverOffset: 4,
    },
  ],
}));

const doughnutChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  onClick: (event: any, elements: any[]) => {
    handleChartClick(event, elements);
  },
  plugins: {
    legend: {
      display: true,
      position: "bottom" as const,
      labels: {
        color: "#000000",
        font: { size: 11 },
        padding: 12,
        usePointStyle: true,
      },
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
          const label = context.label || "";
          const value = context.parsed || 0;
          const percentage =
            towerData.value?.data.list[context.dataIndex]?.percentage || 0;
          return `${label}: ${value.toLocaleString()} (${percentage.toFixed(1)}%)`;
        },
      },
    },
    datalabels: {
      formatter: (value: number, context: any) => {
        const percentage =
          towerData.value?.data.list[context.dataIndex]?.percentage || 0;
        return `${percentage.toFixed(1)}%`;
      },
      color: "#fff",
      backgroundColor: "#000",
      borderRadius: 4,
      padding: { top: 6, bottom: 6, left: 8, right: 8 },
      anchor: "end" as const,
      align: "start" as const,
      offset: 10,
      font: { size: 10, weight: "bold" as const },
    },
  },
};

const barChartData = computed(() => ({
  labels: towerData.value?.data.list.map((item) => item.owner) || [],
  datasets: [
    {
      label: "Tower Count",
      data: towerData.value?.data.list.map((item) => item.count) || [],
      backgroundColor:
        towerData.value?.data.list.map((item) => {
          const baseColor = towerColors[item.owner] || fallbackColors[0];
          // Dim unselected bars to 15% opacity
          if (
            selectedTowerOwnerForMap.value &&
            selectedTowerOwnerForMap.value !== item.owner
          ) {
            return baseColor + "26"; // 15% opacity
          }
          return baseColor;
        }) || [],
      borderRadius: 8,
      borderWidth:
        towerData.value?.data.list.map((item) =>
          selectedTowerOwnerForMap.value === item.owner ? 3 : 0,
        ) || [],
      borderColor:
        towerData.value?.data.list.map((item) =>
          selectedTowerOwnerForMap.value === item.owner
            ? "#FFFFFF"
            : "transparent",
        ) || [],
      barThickness: 24,
    },
  ],
}));

const barChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  onClick: (event: any, elements: any[]) => {
    handleChartClick(event, elements);
  },
  plugins: {
    legend: { display: false },
    datalabels: { display: false },
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
          return `Towers: ${value.toLocaleString()}`;
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
      grid: {
        color: "#353435",
        borderDash: [5, 5],
      },
      ticks: {
        color: "#AFAEAF",
        font: { size: 10 },
        callback: (value: any) => value.toLocaleString(),
      },
    },
  },
};

// Top 10 Provinces Chart Configuration
const top10ChartData = computed(() => ({
  labels:
    top10Data.value?.data.list
      .filter((item) => item.area_name !== "Others")
      .map((item) => item.area_name) || [],
  datasets: [
    {
      label: "Tower Count",
      data:
        top10Data.value?.data.list
          .filter((item) => item.area_name !== "Others")
          .map((item) => item.count) || [],
      backgroundColor: selectedTowerOwner.value
        ? towerColors[selectedTowerOwner.value] || "#6B7280"
        : "#6B7280",
      borderRadius: 4,
      barThickness: 20,
    },
  ],
}));

const top10ChartOptions = {
  indexAxis: "y" as const,
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: false },
    datalabels: {
      anchor: "end" as const,
      align: "right" as const,
      formatter: (value: number) => value.toLocaleString(),
      color: "#374151",
      font: { size: 10, weight: "bold" as const },
    },
    tooltip: {
      backgroundColor: "#FFFFFF",
      titleColor: "#111827",
      bodyColor: "#374151",
      borderColor: "#E5E7EB",
      borderWidth: 1,
      padding: 12,
      callbacks: {
        label: (context: any) => {
          const item = top10Data.value?.data.list.filter(
            (i) => i.area_name !== "Others",
          )[context.dataIndex];
          return `${context.parsed.x.toLocaleString()} towers (${item?.percentage}%)`;
        },
      },
    },
  },
  scales: {
    x: {
      beginAtZero: true,
      grid: { color: "#E5E7EB" },
      ticks: {
        color: "#6B7280",
        font: { size: 10 },
      },
    },
    y: {
      grid: { display: false },
      ticks: {
        color: "#374151",
        font: { size: 11 },
      },
    },
  },
};

// Functions
const formatNumber = (value: number): string => {
  return new Intl.NumberFormat("en-US").format(value);
};

const handleClearFilters = () => {
  selectedProvince.value = null;
  selectedCity.value = null;
  selectedTowerOwnerForMap.value = null;
  toggleTowerLayersByOwner(null);
};

const handleChartClick = (event: any, elements: any[]) => {
  // Empty click = reset
  if (!elements || elements.length === 0) {
    selectedTowerOwnerForMap.value = null;
    toggleTowerLayersByOwner(null);
    return;
  }

  const element = elements[0];
  const dataIndex = element.index;
  const ownerName = towerData.value?.data.list[dataIndex]?.owner || null;

  if (!ownerName) return;

  // Toggle: clicking same owner again shows all
  if (selectedTowerOwnerForMap.value === ownerName) {
    selectedTowerOwnerForMap.value = null;
    toggleTowerLayersByOwner(null);
  } else {
    selectedTowerOwnerForMap.value = ownerName;
    toggleTowerLayersByOwner(ownerName);
  }
};

// Watchers
watch(selectedProvince, () => {
  selectedCity.value = null;
});

// Auto-reset when province or city changes
watch([selectedProvince, selectedCity], () => {
  if (selectedTowerOwnerForMap.value) {
    selectedTowerOwnerForMap.value = null;
    toggleTowerLayersByOwner(null);
  }
});

// Cleanup on unmount
onUnmounted(() => {
  if (selectedTowerOwnerForMap.value) {
    toggleTowerLayersByOwner(null);
  }
});

// Fly to bbox when filter changes
watch(
  () => towerData.value?.data?.bbox,
  (bbox) => {
    if (!bbox || !mapRefStore.map) return;

    // Check if bbox is valid [minLng, minLat, maxLng, maxLat]
    if (
      Array.isArray(bbox) &&
      bbox.length === 4 &&
      bbox.every((coord) => typeof coord === "number")
    ) {
      try {
        mapRefStore.map.fitBounds(
          [
            [bbox[0], bbox[1]], // Southwest [lng, lat]
            [bbox[2], bbox[3]], // Northeast [lng, lat]
          ],
          {
            padding: 50,
            duration: 1000,
            maxZoom: 15,
          },
        );
      } catch (error) {
        console.error("Failed to fit bounds:", error);
      }
    }
  },
  { immediate: false },
);
</script>

<template>
  <!-- Loading Skeleton -->
  <div
    v-if="isLoadingTowers"
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

  <!-- Main Content -->
  <div v-else class="flex flex-col h-screen bg-white p-2">
    <div class="px-3 py-3 space-y-4 text-grey-900">
      <!-- Header -->
      <div class="flex justify-between">
        <div class="space-y-1">
          <h3 class="text-grey-900 text-lg font-semibold">
            Tower Distribution
          </h3>
          <p class="text-grey-600 text-xs mt-1">
            Tower ownership distribution analysis
          </p>
        </div>
        <IcArrowLeft
          role="button"
          @click="closeCoreTransaction"
          :fontControlled="false"
          class="w-3 h-3 rotate-180 text-grey-700 hover:text-brand-600 transition-colors cursor-pointer"
        />
      </div>

      <!-- Filters -->
      <div class="space-y-2">
        <div class="flex items-center justify-between">
          <p class="text-grey-900 text-sm">Filters</p>
          <button
            v-if="selectedProvince || selectedCity"
            @click="handleClearFilters"
            class="text-xs text-brand-500 hover:text-brand-600 font-medium"
          >
            Reset
          </button>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <USelect
            v-model="selectedProvince"
            :options="provinceOptions"
            placeholder="Select Province"
            size="2xs"
            :ui="{ rounded: 'rounded-xxs' }"
            :loading="isLoadingProvinces"
          />
          <USelect
            v-model="selectedCity"
            :options="cityOptions"
            placeholder="Select City"
            size="2xs"
            :ui="{ rounded: 'rounded-xxs' }"
            :disabled="!selectedProvince"
            :loading="isLoadingCities"
          />
        </div>
      </div>

      <!-- Active Filter Indicator -->
      <div
        v-if="selectedTowerOwnerForMap"
        class="bg-brand-50 border border-brand-200 rounded-xs p-3"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div
              class="w-4 h-4 rounded-xxs"
              :style="{
                backgroundColor:
                  towerColors[selectedTowerOwnerForMap] || '#6B7280',
              }"
            ></div>
            <p class="text-sm text-grey-900 font-medium">
              Showing: {{ selectedTowerOwnerForMap }} Towers
            </p>
          </div>
          <button
            @click="
              () => {
                selectedTowerOwnerForMap = null;
                toggleTowerLayersByOwner(null);
              }
            "
            class="text-xs text-brand-600 hover:text-brand-700 font-semibold"
          >
            Show All
          </button>
        </div>
      </div>
    </div>

    <!-- Scrollable Content Area -->
    <div class="flex-1 overflow-y-auto px-3 pb-3 max-h-[calc(100vh-21rem)]">
      <div class="space-y-4">
        <!-- Total Count -->
        <div class="bg-grey-50 rounded-xs p-3 border border-grey-200">
          <p class="text-grey-600 text-xs">Total Towers</p>
          <p class="text-grey-900 text-2xl font-bold">
            {{ formatNumber(towerData?.data.total || 0) }}
          </p>
        </div>
        <!-- Charts Display -->
        <div
          v-if="towerData?.data.list && towerData.data.list.length > 0"
          class="space-y-4"
        >
          <!-- Doughnut Chart -->
          <div>
            <p class="text-grey-900 text-sm mb-2 font-semibold">
              Distribution Chart
            </p>
            <div class="h-[280px]" style="cursor: pointer">
              <Doughnut
                :data="doughnutChartData"
                :options="doughnutChartOptions"
              />
            </div>
          </div>

          <!-- Bar Chart -->
          <div>
            <p class="text-grey-900 text-sm mb-2 font-semibold">
              Comparison Chart
            </p>
            <div class="h-[200px]" style="cursor: pointer">
              <Bar :data="barChartData" :options="barChartOptions" />
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="text-center py-8">
          <p class="text-grey-600 text-sm">No tower data available</p>
          <p class="text-grey-500 text-xs mt-1">Try adjusting your filters</p>
        </div>

        <!-- Top 10 Provinces Section -->
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <p class="text-grey-900 text-sm font-semibold">
              Top 10 Provinces by Owner
            </p>
            <button
              v-if="selectedTowerOwner"
              @click="selectedTowerOwner = null"
              class="text-xs text-brand-500 hover:text-brand-600 font-medium"
            >
              Clear
            </button>
          </div>

          <USelect
            v-model="selectedTowerOwner"
            :options="towerOwnerOptions"
            placeholder="Select Tower Owner"
            size="sm"
            :ui="{ rounded: 'rounded-xxs' }"
          />

          <!-- Chart Display -->
          <div
            v-if="selectedTowerOwner && top10Data?.data.list"
            class="bg-grey-50 rounded-xs p-4 border border-grey-200"
          >
            <div class="flex items-center justify-between mb-3">
              <h4 class="text-grey-900 text-sm font-semibold">
                {{ selectedTowerOwner }} Distribution
              </h4>
              <div class="flex items-center gap-3">
                <span class="text-xs text-grey-600">
                  Total: {{ formatNumber(top10Data.data.total) }} towers
                </span>
                <UButton
                  size="xs"
                  variant="outline"
                  color="gray"
                  icon="i-heroicons-table-cells"
                  label="View Details"
                  @click="isTop10ModalOpen = true"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
              </div>
            </div>
            <div class="h-[350px]">
              <Bar :data="top10ChartData" :options="top10ChartOptions" />
            </div>
          </div>

          <!-- Loading State -->
          <div
            v-else-if="selectedTowerOwner && isLoadingTop10"
            class="text-center py-8 bg-grey-50 rounded-xs border border-grey-200"
          >
            <div
              class="inline-block w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"
            ></div>
            <p class="text-grey-600 text-sm mt-3">Loading data...</p>
          </div>

          <!-- Empty State -->
          <div
            v-else-if="selectedTowerOwner && !isLoadingTop10"
            class="text-center py-6 bg-grey-50 rounded-xs border border-grey-200"
          >
            <p class="text-grey-600 text-sm">
              No data available for {{ selectedTowerOwner }}
            </p>
          </div>
        </div>

        <!-- Data Table -->
        <div v-if="towerData?.data.list && towerData.data.list.length > 0">
          <p class="text-grey-900 text-sm mt-4 mb-1 font-semibold">
            Data Summary
          </p>
          <div class="divide-y divide-grey-200 text-xs">
            <!-- Header Row -->
            <div class="grid grid-cols-3 py-2 font-semibold text-grey-900">
              <p>Owner</p>
              <p class="text-right">Count</p>
              <p class="text-right">Percentage</p>
            </div>
            <!-- Data Rows -->
            <div
              v-for="item in towerData.data.list"
              :key="item.owner"
              class="grid grid-cols-3 py-2 text-grey-700"
            >
              <div class="flex items-center gap-2">
                <div
                  class="w-3 h-3 rounded-xxs"
                  :style="{
                    backgroundColor:
                      towerColors[item.owner] || fallbackColors[0],
                  }"
                ></div>
                <p>{{ item.owner }}</p>
              </div>
              <p class="text-right">{{ formatNumber(item.count) }}</p>
              <p class="text-right">{{ item.percentage.toFixed(1) }}%</p>
            </div>
            <!-- Total Row -->
            <div class="grid grid-cols-3 py-2 font-bold text-grey-900">
              <p>Total</p>
              <p class="text-right">
                {{ formatNumber(towerData?.data.total || 0) }}
              </p>
              <p class="text-right">100.0%</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Top 10 Detail Modal -->
  <UModal
    v-model="isTop10ModalOpen"
    :ui="{ width: 'sm:max-w-3xl', rounded: 'rounded-xs' }"
  >
    <UCard
      :ui="{
        base: 'overflow-hidden',
        rounded: 'rounded-xs',
        header: { padding: 'px-6 py-4' },
        body: { padding: 'px-6 py-4' },
      }"
    >
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-lg font-semibold text-grey-900">
            City Distribution - {{ selectedTowerOwner }} Towers
          </h3>
          <UButton
            color="gray"
            variant="ghost"
            icon="i-heroicons-x-mark"
            @click="isTop10ModalOpen = false"
            :ui="{ rounded: 'rounded-full' }"
          />
        </div>
      </template>

      <div
        v-if="isLoadingCityDetail"
        class="flex items-center justify-center py-12"
      >
        <div class="text-center">
          <div
            class="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-brand-600"
          ></div>
          <p class="text-sm text-grey-600 mt-2">Loading city data...</p>
        </div>
      </div>

      <div v-else-if="cityDetailData?.data.list" class="space-y-4">
        <!-- Summary Stats -->
        <div class="grid grid-cols-3 gap-4">
          <div class="bg-grey-50 rounded-lg p-4 border border-grey-200">
            <p class="text-xs text-grey-600 mb-1">Total Towers</p>
            <p class="text-2xl font-bold text-grey-900">
              {{ formatNumber(cityDetailData.data.total) }}
            </p>
          </div>
          <div class="bg-grey-50 rounded-lg p-4 border border-grey-200">
            <p class="text-xs text-grey-600 mb-1">Cities</p>
            <p class="text-2xl font-bold text-grey-900">
              {{
                cityDetailData.data.list.filter((i) => i.area_name !== "Others")
                  .length
              }}
            </p>
          </div>
          <div class="bg-grey-50 rounded-lg p-4 border border-grey-200">
            <p class="text-xs text-grey-600 mb-1">Owner</p>
            <div class="flex items-center gap-2">
              <div
                class="w-4 h-4 rounded"
                :style="{
                  backgroundColor:
                    towerColors[selectedTowerOwner || ''] || '#6B7280',
                }"
              ></div>
              <p class="text-2xl font-bold text-grey-900">
                {{ selectedTowerOwner }}
              </p>
            </div>
          </div>
        </div>

        <!-- Detail Table -->
        <div
          class="border border-grey-200 rounded-xs overflow-hidden max-h-96 overflow-y-auto"
        >
          <table class="w-full">
            <thead class="bg-grey-50 border-b border-grey-200 sticky top-0">
              <tr>
                <th
                  class="px-4 py-3 text-left text-xs font-semibold text-grey-900 uppercase tracking-wider"
                >
                  Rank
                </th>
                <th
                  class="px-4 py-3 text-left text-xs font-semibold text-grey-900 uppercase tracking-wider"
                >
                  Province
                </th>
                <th
                  class="px-4 py-3 text-left text-xs font-semibold text-grey-900 uppercase tracking-wider"
                >
                  City
                </th>
                <th
                  class="px-4 py-3 text-right text-xs font-semibold text-grey-900 uppercase tracking-wider"
                >
                  Tower Count
                </th>
                <th
                  class="px-4 py-3 text-right text-xs font-semibold text-grey-900 uppercase tracking-wider"
                >
                  Percentage
                </th>
              </tr>
            </thead>
            <tbody class="bg-white divide-y divide-grey-200">
              <tr
                v-for="(item, index) in cityDetailData.data.list.filter(
                  (i) => i.area_name !== 'Others',
                )"
                :key="item.area_id"
                class="hover:bg-grey-50 transition-colors"
              >
                <td class="px-4 py-3 text-sm text-grey-900 font-medium">
                  #{{ index + 1 }}
                </td>
                <td class="px-4 py-3 text-sm text-grey-700">
                  {{ item.province }}
                </td>
                <td class="px-4 py-3 text-sm text-grey-900">
                  {{ item.area_name }}
                </td>
                <td
                  class="px-4 py-3 text-sm text-grey-900 text-right font-semibold"
                >
                  {{ formatNumber(item.count) }}
                </td>
                <td class="px-4 py-3 text-sm text-grey-600 text-right">
                  {{ item.percentage.toFixed(2) }}%
                </td>
              </tr>
            </tbody>
            <tfoot
              class="bg-grey-50 border-t-2 border-grey-300 sticky bottom-0"
            >
              <tr>
                <td
                  colspan="3"
                  class="px-4 py-3 text-sm font-bold text-grey-900"
                >
                  Total
                </td>
                <td
                  class="px-4 py-3 text-sm font-bold text-grey-900 text-right"
                >
                  {{ formatNumber(cityDetailData.data.total) }}
                </td>
                <td
                  class="px-4 py-3 text-sm font-bold text-grey-900 text-right"
                >
                  100.00%
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </UCard>
  </UModal>
</template>
