<script setup lang="ts">
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

const POI_LAYER_ID = "poi_circle";

// Stores
const authStore = useAuth();
const mapRefStore = useMapRef();

// State
const selectedProvince = ref<number | null>(null);
const selectedCity = ref<number | null>(null);
const selectedSubGroupForMap = ref<string | null>(null);

// Fetch colors from API
const { data: subGroupColors } = useQuery({
  queryKey: ["/panel/items/poi_sub_group/colors"],
  queryFn: async () => {
    const res = await $fetch<{
      data: Array<{ id: string; color: string }>;
    }>("/panel/items/poi_sub_group?fields=id,color", {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
    const colorMap: Record<string, string> = {};
    res.data.forEach((item) => {
      if (item.id && item.color) {
        colorMap[item.id] = item.color;
      }
    });
    return colorMap;
  },
  staleTime: 1000 * 60 * 60,
});

const fallbackColor = "#6B7280";

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

const { data: rukoData, isLoading: isLoadingRuko } = useQuery({
  queryKey: ["/panel/chart/count/poi-ruko", selectedProvince, selectedCity],
  queryFn: async () => {
    let url = "/panel/chart/count/poi-ruko?";
    if (selectedProvince.value) url += `&province_id=${selectedProvince.value}`;
    if (selectedCity.value) url += `&city_id=${selectedCity.value}`;

    return await $fetch<TowerCountResponse>(url, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
  },
});

// Computed
const provinceOptions = computed(() => provincesData.value || []);
const cityOptions = computed(() => citiesData.value || []);

const getColor = (owner: string) =>
  subGroupColors.value?.[owner] || fallbackColor;

const doughnutChartData = computed(() => ({
  labels: rukoData.value?.data.list.map((item) => item.owner) || [],
  datasets: [
    {
      data: rukoData.value?.data.list.map((item) => item.count) || [],
      backgroundColor:
        rukoData.value?.data.list.map((item) => {
          const baseColor = getColor(item.owner);
          if (
            selectedSubGroupForMap.value &&
            selectedSubGroupForMap.value !== item.owner
          ) {
            return baseColor + "26";
          }
          return baseColor;
        }) || [],
      borderColor:
        rukoData.value?.data.list.map((item) =>
          selectedSubGroupForMap.value === item.owner ? "#FFFFFF" : "#000",
        ) || [],
      borderWidth:
        rukoData.value?.data.list.map((item) =>
          selectedSubGroupForMap.value === item.owner ? 4 : 2,
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
            rukoData.value?.data.list[context.dataIndex]?.percentage || 0;
          return `${label}: ${value.toLocaleString()} (${percentage.toFixed(1)}%)`;
        },
      },
    },
    datalabels: {
      formatter: (value: number, context: any) => {
        const percentage =
          rukoData.value?.data.list[context.dataIndex]?.percentage || 0;
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
  labels: rukoData.value?.data.list.map((item) => item.owner) || [],
  datasets: [
    {
      label: "Ruko Count",
      data: rukoData.value?.data.list.map((item) => item.count) || [],
      backgroundColor:
        rukoData.value?.data.list.map((item) => {
          const baseColor = getColor(item.owner);
          if (
            selectedSubGroupForMap.value &&
            selectedSubGroupForMap.value !== item.owner
          ) {
            return baseColor + "26";
          }
          return baseColor;
        }) || [],
      borderRadius: 8,
      borderWidth:
        rukoData.value?.data.list.map((item) =>
          selectedSubGroupForMap.value === item.owner ? 3 : 0,
        ) || [],
      borderColor:
        rukoData.value?.data.list.map((item) =>
          selectedSubGroupForMap.value === item.owner
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
          return `Ruko: ${value.toLocaleString()}`;
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

// Functions
const formatNumber = (value: number): string => {
  return new Intl.NumberFormat("en-US").format(value);
};

const applyMapFilter = (
  subGroup: string | null,
  provinceId: number | null,
  cityId: number | null,
) => {
  const map = mapRefStore.map;
  if (!map || !map.getLayer(POI_LAYER_ID)) return;

  const filters: any[] = [["==", ["get", "group"], "Ruko"]];

  if (subGroup !== null) {
    filters.push(["==", ["get", "sub_group"], subGroup]);
  }
  if (cityId !== null) {
    filters.push(["==", ["get", "city_id"], cityId]);
  } else if (provinceId !== null) {
    filters.push(["==", ["get", "province_id"], provinceId]);
  }

  if (filters.length === 1) {
    map.setFilter(POI_LAYER_ID, filters[0]);
  } else {
    map.setFilter(POI_LAYER_ID, ["all", ...filters]);
  }

  map.setLayoutProperty(POI_LAYER_ID, "visibility", "visible");
};

const handleClearFilters = () => {
  selectedProvince.value = null;
  selectedCity.value = null;
  selectedSubGroupForMap.value = null;
  applyMapFilter(null, null, null);
};

const handleChartClick = (event: any, elements: any[]) => {
  if (!elements || elements.length === 0) {
    selectedSubGroupForMap.value = null;
    applyMapFilter(null, selectedProvince.value, selectedCity.value);
    return;
  }

  const element = elements[0];
  const dataIndex = element.index;
  const ownerName = rukoData.value?.data?.list?.[dataIndex]?.owner || null;

  if (!ownerName) return;

  if (selectedSubGroupForMap.value === ownerName) {
    selectedSubGroupForMap.value = null;
    applyMapFilter(null, selectedProvince.value, selectedCity.value);
  } else {
    selectedSubGroupForMap.value = ownerName;
    applyMapFilter(ownerName, selectedProvince.value, selectedCity.value);
  }
};

// Watchers
watch(selectedProvince, () => {
  selectedCity.value = null;
});

// Auto-reset when province or city changes
watch([selectedProvince, selectedCity], () => {
  if (selectedSubGroupForMap.value) {
    selectedSubGroupForMap.value = null;
  }
  applyMapFilter(
    selectedSubGroupForMap.value,
    selectedProvince.value,
    selectedCity.value,
  );
});

// Cleanup on unmount
onUnmounted(() => {
  const map = mapRefStore.map;
  if (map && map.getLayer(POI_LAYER_ID)) {
    map.setFilter(POI_LAYER_ID, ["==", ["get", "group"], "Ruko"]);
  }
});

// Fly to bbox when filter changes
watch(
  () => rukoData.value?.data?.bbox,
  (bbox) => {
    if (!bbox || !mapRefStore.map) return;

    if (
      Array.isArray(bbox) &&
      bbox.length === 4 &&
      bbox.every((coord) => typeof coord === "number")
    ) {
      try {
        mapRefStore.map.fitBounds(
          [
            [bbox[0], bbox[1]],
            [bbox[2], bbox[3]],
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
    v-if="isLoadingRuko"
    class="animate-pulse space-y-3 px-3 py-3 bg-white h-screen"
  >
    <div class="w-full h-8 bg-grey-200 rounded-xs"></div>
    <div class="w-full h-8 bg-grey-200 rounded-xs"></div>
    <div class="w-full h-[280px] bg-grey-200 rounded-xs"></div>
    <div class="w-full h-32 bg-grey-200 rounded-xs"></div>
    <div class="w-full h-32 bg-grey-200 rounded-xs"></div>
  </div>

  <!-- Main Content -->
  <div v-else class="flex flex-col h-screen bg-white">
    <div class="px-2 pb-3 space-y-4 text-grey-900">
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
        v-if="selectedSubGroupForMap"
        class="bg-brand-50 border border-brand-200 rounded-xs p-3"
      >
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-2">
            <div
              class="w-4 h-4 rounded-xxs"
              :style="{
                backgroundColor: getColor(selectedSubGroupForMap),
              }"
            ></div>
            <p class="text-sm text-grey-900 font-medium">
              Showing: {{ selectedSubGroupForMap }}
            </p>
          </div>
          <button
            @click="
              () => {
                selectedSubGroupForMap = null;
                applyMapFilter(null, selectedProvince, selectedCity);
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
    <div class="flex-1 overflow-y-auto px-3 pb-3 max-h-[calc(100vh-26rem)]">
      <div class="space-y-4">
        <!-- Total Count -->
        <div class="bg-grey-50 rounded-xs p-3 border border-grey-200">
          <p class="text-grey-600 text-xs">Total Ruko</p>
          <p class="text-grey-900 text-2xl font-bold">
            {{ formatNumber(rukoData?.data.total || 0) }}
          </p>
        </div>
        <!-- Charts Display -->
        <div
          v-if="rukoData?.data.list && rukoData.data.list.length > 0"
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
          <p class="text-grey-600 text-sm">No ruko data available</p>
          <p class="text-grey-500 text-xs mt-1">Try adjusting your filters</p>
        </div>

        <!-- Data Table -->
        <div v-if="rukoData?.data.list && rukoData.data.list.length > 0">
          <p class="text-grey-900 text-sm mt-4 mb-1 font-semibold">
            Data Summary
          </p>
          <div class="divide-y divide-grey-200 text-xs">
            <!-- Header Row -->
            <div class="grid grid-cols-3 py-2 font-semibold text-grey-900">
              <p>Category</p>
              <p class="text-right">Count</p>
              <p class="text-right">Percentage</p>
            </div>
            <!-- Data Rows -->
            <div
              v-for="item in rukoData.data.list"
              :key="item.owner"
              class="grid grid-cols-3 py-2 text-grey-700"
            >
              <div class="flex items-center gap-2">
                <div
                  class="w-3 h-3 rounded-xxs"
                  :style="{
                    backgroundColor: getColor(item.owner),
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
                {{ formatNumber(rukoData?.data.total || 0) }}
              </p>
              <p class="text-right">100.0%</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
