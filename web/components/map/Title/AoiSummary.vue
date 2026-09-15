<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { Doughnut } from "vue-chartjs";
import {
  Chart as ChartJS,
  ArcElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
} from "chart.js";

// Register Chart.js components
ChartJS.register(ArcElement, CategoryScale, LinearScale, Tooltip, Legend);

// Stores
const authStore = useAuth();
const mapRefStore = useMapRef();
const mapLayerStore = useMapLayer();

// State
const selectedProvince = ref<number | null>(null);
const selectedCity = ref<number | null>(null);
const selectedIsp = ref<string | null>(null);
const selectedIspForMap = ref<string | null>(null);

// ISP color palette
const ispColors: Record<string, string> = {
  Linknet: "#EF4444",
  Surge: "#3B82F6",
  TBG: "#F59E0B",
  Telkom: "#10B981",
  Indihome: "#F97316",
  XL: "#8B5CF6",
  Smartfren: "#EC4899",
  Tri: "#14B8A6",
  Axis: "#6366F1",
};
const fallbackColors = ["#6B7280", "#9CA3AF", "#D1D5DB", "#A855F7", "#06B6D4"];

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

interface IspItem {
  owner: string;
  owner_type: string;
  count: number;
  count_type: string;
  percentage: number;
  color?: string;
}

interface IspCountResponse {
  data: {
    bbox: number[];
    total: number;
    list: IspItem[];
  };
}

interface FootprintSummary {
  low: number;
  mid: number;
  high: number;
  very_low: number;
  non_residential: number;
}

interface PoiSummaryItem {
  category: string;
  jumlah: number;
}

interface IspDetailItem {
  ogc_fid: number;
  name: string;
  category: string;
  coverage: string;
  isp: string;
  footprint_summary: FootprintSummary;
  poi_summary: PoiSummaryItem[];
  total_poi: number;
  total_footprint: number;
}

interface IspDetailResponse {
  data: {
    isp: string;
    total_footprint: number;
    total_poi: number;
    footprint_summary: FootprintSummary;
    poi_summary: PoiSummaryItem[];
    list: IspDetailItem[];
  };
}

const { data: ispData, isLoading: isLoadingIsp } = useQuery({
  queryKey: ["/panel/chart/count/isp", selectedProvince, selectedCity],
  queryFn: async () => {
    let url = "/panel/chart/count/isp?limit=1000";
    if (selectedProvince.value) url += `&province_id=${selectedProvince.value}`;
    if (selectedCity.value) url += `&city_id=${selectedCity.value}`;

    return await $fetch<IspCountResponse>(url, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
  },
});

const { data: ispDetailData, isLoading: isLoadingIspDetail } = useQuery({
  queryKey: [
    "/panel/chart/count/isp-detail",
    selectedIsp,
    selectedProvince,
    selectedCity,
  ],
  queryFn: async () => {
    if (!selectedIsp.value) return null;
    let url = `/panel/chart/count/isp-detail/${selectedIsp.value?.label}?`;
    if (selectedProvince.value) url += `&province_id=${selectedProvince.value}`;
    if (selectedCity.value) url += `&city_id=${selectedCity.value}`;

    return await $fetch<IspDetailResponse>(url, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
  },
  enabled: computed(() => !!selectedIsp.value),
});

// Computed options
const provinceOptions = computed(() => provincesData.value || []);
const cityOptions = computed(() => citiesData.value || []);
const ispOptions = computed(() => {
  return (
    ispData.value?.data?.list.map((item) => ({
      value: item.owner,
      label: item.owner,
    })) || []
  );
});

// Doughnut Chart Configuration
const doughnutChartData = computed(() => ({
  labels: ispData.value?.data?.list.map((item) => item.owner) || [],
  datasets: [
    {
      data: ispData.value?.data?.list.map((item) => item.count) || [],
      backgroundColor:
        ispData.value?.data?.list.map((item, index) => {
          // Use color from API if available, otherwise fallback to hardcoded colors
          const baseColor =
            item.color ||
            ispColors[item.owner] ||
            fallbackColors[index % fallbackColors.length];
          // Dim unselected segments to 15% opacity
          if (
            selectedIspForMap.value &&
            selectedIspForMap.value !== item.owner
          ) {
            return baseColor + "26"; // 15% opacity
          }
          return baseColor;
        }) || [],
      borderColor:
        ispData.value?.data?.list.map((item) =>
          selectedIspForMap.value === item.owner ? "#FFFFFF" : "#000",
        ) || [],
      borderWidth:
        ispData.value?.data?.list.map((item) =>
          selectedIspForMap.value === item.owner ? 4 : 2,
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
      display: false,
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
            ispData.value?.data?.list[context.dataIndex]?.percentage || 0;
          return `${label}: ${value.toLocaleString()} (${percentage.toFixed(1)}%)`;
        },
      },
    },
    datalabels: false,
  },
};

const formatNumber = (num: number) => {
  return num.toLocaleString();
};

const getIspColor = (ispName: string): string => {
  // Find the color from the API data first
  const ispItem = ispData.value?.data?.list.find(
    (item) => item.owner === ispName,
  );
  if (ispItem?.color) {
    return ispItem.color;
  }
  // Fallback to hardcoded colors
  return ispColors[ispName] || fallbackColors[0];
};

const handleClearFilters = () => {
  selectedProvince.value = null;
  selectedCity.value = null;
  selectedIspForMap.value = null;
};

const handleChartClick = (event: any, elements: any[]) => {
  // Empty click = reset filter
  if (!elements || elements.length === 0) {
    selectedIspForMap.value = null;
    applyIspFilter(null);
    return;
  }

  const element = elements[0];
  const dataIndex = element.index;
  const ispName = ispData.value?.data?.list?.[dataIndex]?.owner || null;

  if (!ispName) return;

  // Toggle: clicking same ISP again shows all
  if (selectedIspForMap.value === ispName) {
    selectedIspForMap.value = null;
    applyIspFilter(null);
  } else {
    selectedIspForMap.value = ispName;
    applyIspFilter(ispName);
  }
};

const applyIspFilter = async (ispName: string | null) => {
  if (!mapRefStore.map) return;

  const aoiLayerId = "aoi_area_line";
  const poiLayerId = "poi_circle";

  // Check if layer exists
  if (!mapRefStore.map.getLayer(aoiLayerId)) {
    console.warn(`Layer ${aoiLayerId} not found`);
    return;
  }

  try {
    if (ispName) {
      // Apply filter to show only selected ISP
      mapRefStore.map.setFilter(aoiLayerId, ["==", ["get", "isp"], ispName]);

      // Apply color to the polygon line
      const ispColor = getIspColor(ispName);
      mapRefStore.map.setPaintProperty(aoiLayerId, "line-color", ispColor);

      // Get the filtered AOI features to find their ogc_fid values
      const aoiFeatures = mapRefStore.map.querySourceFeatures("aoi_area", {
        sourceLayer: "aoi_area",
        filter: ["==", ["get", "isp"], ispName],
      });

      console.log("AOI Features:", aoiFeatures);

      // Extract ogc_fid values from filtered AOI features
      const aoiIds = aoiFeatures
        .map((feature) => feature.properties?.ogc_fid)
        .filter((id) => id !== undefined && id !== null);

      console.log("AOI IDs for ISP", ispName, ":", aoiIds);

      // Apply filter to POI layer if it exists
      if (mapRefStore.map.getLayer(poiLayerId)) {
        // Make POI layer visible if it's hidden
        const currentVisibility = mapRefStore.map.getLayoutProperty(
          poiLayerId,
          "visibility",
        );
        if (currentVisibility === "none") {
          mapRefStore.map.setLayoutProperty(
            poiLayerId,
            "visibility",
            "visible",
          );
        }

        if (aoiIds.length > 0) {
          // Show POIs where aoi_area_id matches any of the filtered AOI ogc_fid values
          mapRefStore.map.setFilter(poiLayerId, [
            "in",
            ["get", "aoi_area_id"],
            ["literal", aoiIds],
          ]);
        } else {
          // Hide all POIs if no AOI features found
          mapRefStore.map.setFilter(poiLayerId, [
            "==",
            ["get", "aoi_area_id"],
            "",
          ]);
        }
      }
    } else {
      // Remove filter to show all
      mapRefStore.map.setFilter(aoiLayerId, null);
      // Reset line color to default (you may need to adjust this based on your original color)
      mapRefStore.map.setPaintProperty(aoiLayerId, "line-color", "#3B82F6");

      if (mapRefStore.map.getLayer(poiLayerId)) {
        mapRefStore.map.setFilter(poiLayerId, null);
      }
      const currentVisibility = mapRefStore.map.getLayoutProperty(
        poiLayerId,
        "visibility",
      );
      if (currentVisibility === "visible") {
        mapRefStore.map.setLayoutProperty(poiLayerId, "visibility", "none");
      }
    }
  } catch (error) {
    console.error("Failed to apply ISP filter:", error);
  }
};

// Accordion state for coverage cards
const expandedCards = ref<Set<number>>(new Set());
const selectedAreaId = ref<number | null>(null);

const toggleCard = (id: number) => {
  if (expandedCards.value.has(id)) {
    expandedCards.value.delete(id);
  } else {
    expandedCards.value.add(id);
  }
};

const handleCardClick = async (item: IspDetailItem) => {
  if (!mapRefStore.map) return;

  // Toggle selection
  if (selectedAreaId.value === item.ogc_fid) {
    selectedAreaId.value = null;
    // Remove highlight filter
    const aoiLayerId = "aoi_area_line";
    if (mapRefStore.map.getLayer(aoiLayerId)) {
      // Reset to ISP filter only
      if (selectedIspForMap.value) {
        mapRefStore.map.setFilter(aoiLayerId, [
          "==",
          ["get", "isp"],
          selectedIspForMap.value,
        ]);
      } else {
        mapRefStore.map.setFilter(aoiLayerId, null);
      }
    }

    // Reset POI filter back to ISP-level filter
    const poiLayerId = "poi_circle";
    if (mapRefStore.map.getLayer(poiLayerId)) {
      if (selectedIspForMap.value) {
        // Reapply the ISP filter from applyIspFilter
        applyIspFilter(selectedIspForMap.value);
      } else {
        // Remove all filters
        mapRefStore.map.setFilter(poiLayerId, null);
      }
    }
    return;
  }

  selectedAreaId.value = item.ogc_fid;

  // Fetch geometry from API and calculate bbox
  try {
    const url = `/panel/items/aoi_area/${item.ogc_fid}?fields=geom`;
    const response = await $fetch<{
      data: {
        geom: {
          type: string;
          coordinates: number[][][] | number[][][][];
        };
      };
    }>(url, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });

    const geom = response?.data?.geom;
    if (geom && geom.coordinates && geom.coordinates.length > 0) {
      // Calculate bounding box from coordinates
      let minLng = Infinity,
        minLat = Infinity;
      let maxLng = -Infinity,
        maxLat = -Infinity;

      // Handle both Polygon and MultiPolygon geometries
      const processCoordinates = (coords: number[][]) => {
        coords.forEach((coord) => {
          const [lng, lat] = coord;
          minLng = Math.min(minLng, lng);
          minLat = Math.min(minLat, lat);
          maxLng = Math.max(maxLng, lng);
          maxLat = Math.max(maxLat, lat);
        });
      };

      if (geom.type === "MultiPolygon") {
        // For MultiPolygon: coordinates is [polygon1, polygon2, ...]
        // Each polygon is [outerRing, hole1, hole2, ...]
        (geom.coordinates as number[][][][]).forEach((polygon) => {
          processCoordinates(polygon[0]); // Process outer ring of each polygon
        });
      } else if (geom.type === "Polygon") {
        // For Polygon: coordinates is [outerRing, hole1, hole2, ...]
        processCoordinates((geom.coordinates as number[][][])[0]);
      }

      if (
        isFinite(minLng) &&
        isFinite(minLat) &&
        isFinite(maxLng) &&
        isFinite(maxLat)
      ) {
        mapRefStore.map.fitBounds(
          [
            [minLng, minLat], // Southwest [lng, lat]
            [maxLng, maxLat], // Northeast [lng, lat]
          ],
          {
            padding: 80,
            duration: 3000,
            zoom: 14,
            maxZoom: 17,
          },
        );
      }
    }
  } catch (error) {
    console.error("Failed to fetch geometry:", error);
  }

  // Highlight the selected area
  const aoiLayerId = "aoi_area_line";
  if (mapRefStore.map.getLayer(aoiLayerId)) {
    // Create a filter that shows both the ISP filter AND highlights the selected area
    if (selectedIspForMap.value) {
      mapRefStore.map.setFilter(aoiLayerId, [
        "all",
        ["==", ["get", "isp"], selectedIspForMap.value],
        ["==", ["get", "ogc_fid"], item.ogc_fid],
      ]);
    } else {
      mapRefStore.map.setFilter(aoiLayerId, [
        "==",
        ["get", "ogc_fid"],
        item.ogc_fid,
      ]);
    }
  }

  // Filter POI layer to show only POIs inside this specific area
  const poiLayerId = "poi_circle";
  if (mapRefStore.map.getLayer(poiLayerId)) {
    // Make POI layer visible if it's hidden
    const currentVisibility = mapRefStore.map.getLayoutProperty(
      poiLayerId,
      "visibility",
    );
    if (currentVisibility === "none") {
      mapRefStore.map.setLayoutProperty(poiLayerId, "visibility", "visible");
    }

    // Filter to show only POIs where aoi_area_id matches the clicked area's ogc_fid
    mapRefStore.map.setFilter(poiLayerId, [
      "==",
      ["get", "aoi_area_id"],
      item.ogc_fid,
    ]);
  }
};

// Watch for province change to reset city
watch(selectedProvince, () => {
  selectedCity.value = null;
});

// Auto-reset ISP filter when province or city changes
watch([selectedProvince, selectedCity], () => {
  if (selectedIspForMap.value) {
    selectedIspForMap.value = null;
    applyIspFilter(null);
  }
});

// Cleanup on unmount
onUnmounted(() => {
  if (selectedIspForMap.value) {
    applyIspFilter(null);
  }
});

// Fly to bbox when filter changes
watch(
  () => ispData.value?.data?.bbox,
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
            duration: 3000,
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

// Fly to ISP detail bbox when ISP is selected
watch(
  () => ispDetailData.value?.data?.list,
  (list) => {
    if (!list || list.length === 0 || !mapRefStore.map) return;

    // Calculate bbox from all coverage areas
    const allBboxes = list
      .map((item) => item.bbox)
      .filter((bbox) => bbox && Array.isArray(bbox) && bbox.length === 4);

    if (allBboxes.length === 0) return;

    // Find overall bounds
    const minLng = Math.min(...allBboxes.map((bbox) => bbox[0]));
    const minLat = Math.min(...allBboxes.map((bbox) => bbox[1]));
    const maxLng = Math.max(...allBboxes.map((bbox) => bbox[2]));
    const maxLat = Math.max(...allBboxes.map((bbox) => bbox[3]));

    try {
      mapRefStore.map.fitBounds(
        [
          [minLng, minLat], // Southwest [lng, lat]
          [maxLng, maxLat], // Northeast [lng, lat]
        ],
        {
          padding: 50,
          duration: 2000,
          maxZoom: 15,
        },
      );
    } catch (error) {
      console.error("Failed to fit bounds:", error);
    }
  },
  { immediate: false },
);
</script>

<template>
  <!-- Loading Skeleton -->
  <div
    v-if="isLoadingIsp"
    class="animate-pulse space-y-3 px-3 py-3 bg-white h-screen"
  >
    <div class="w-full h-8 bg-grey-200 rounded-xs"></div>
    <div class="w-full h-8 bg-grey-200 rounded-xs"></div>
    <div class="w-full h-[280px] bg-grey-200 rounded-xs"></div>
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
    </div>

    <!-- Scrollable Content Area -->
    <div class="flex-1 overflow-y-auto px-3 pb-3 max-h-[calc(100vh-24rem)]">
      <div class="space-y-4">
        <!-- Total Count -->
        <div class="bg-grey-50 rounded-xs p-3 border border-grey-200">
          <p class="text-grey-600 text-xs">Total ISP</p>
          <p class="text-grey-900 text-2xl font-bold">
            {{ formatNumber(ispData?.data?.total || 0) }}
          </p>
        </div>

        <!-- Pie Chart Display -->
        <div v-if="ispData?.data?.list && ispData.data.list.length > 0">
          <!-- Doughnut Chart -->
          <div>
            <p class="text-grey-900 text-sm mb-2 font-semibold">
              Distribution Chart
            </p>
            <div class="h-[280px]">
              <Doughnut
                :data="doughnutChartData"
                :options="doughnutChartOptions"
              />
            </div>
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="text-center py-8">
          <p class="text-grey-600 text-sm">No ISP data available</p>
          <p class="text-grey-500 text-xs mt-1">Try adjusting your filters</p>
        </div>

        <!-- ISP Selection -->
        <div
          v-if="ispData?.data?.list && ispData.data.list.length > 0"
          class="space-y-3"
        >
          <div class="flex items-center justify-between">
            <p class="text-grey-900 text-sm font-semibold">Select ISP</p>
            <button
              v-if="selectedIsp"
              @click="selectedIsp = null"
              class="text-xs text-brand-500 hover:text-brand-600 font-medium"
            >
              Clear
            </button>
          </div>

          <USelectMenu
            v-model="selectedIsp"
            searchable
            searchable-placeholder="Search ISP..."
            :options="ispOptions"
            placeholder="Select ISP"
            size="sm"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <!-- Detail ISP Section -->
        <div v-if="selectedIsp && ispDetailData?.data" class="space-y-4">
          <p class="text-grey-900 text-sm font-semibold">Detail ISP</p>

          <!-- Total Cards -->
          <div class="grid grid-cols-2 gap-3">
            <div class="bg-blue-50 rounded-xs p-3 border border-blue-200">
              <p class="text-blue-700 text-[10px] font-medium mb-1">
                Total Footprint
              </p>
              <p class="text-blue-900 text-xl font-bold">
                {{ formatNumber(ispDetailData.data.total_footprint) }}
              </p>
            </div>
            <div class="bg-green-50 rounded-xs p-3 border border-green-200">
              <p class="text-green-700 text-[10px] font-medium mb-1">
                Total POI
              </p>
              <p class="text-green-900 text-xl font-bold">
                {{ formatNumber(ispDetailData.data.total_poi) }}
              </p>
            </div>
          </div>

          <!-- Footprint Summary -->
          <div class="bg-white border border-grey-200 rounded-xs p-2.5">
            <p class="text-grey-900 text-xs font-semibold mb-1.5">
              Footprint Summary
            </p>
            <div class="space-y-1">
              <div
                class="flex items-center justify-between py-1.5 px-2 bg-grey-50 rounded hover:bg-grey-100 transition-colors"
              >
                <div class="flex items-center gap-1.5">
                  <div class="w-1.5 h-1.5 rounded-full bg-red-500"></div>
                  <span class="text-grey-900 text-[11px] font-medium"
                    >Very Low</span
                  >
                </div>
                <span class="text-grey-900 text-xs font-bold">{{
                  formatNumber(
                    ispDetailData.data.footprint_summary.very_low || 0,
                  )
                }}</span>
              </div>
              <div
                class="flex items-center justify-between py-1.5 px-2 bg-grey-50 rounded hover:bg-grey-100 transition-colors"
              >
                <div class="flex items-center gap-1.5">
                  <div class="w-1.5 h-1.5 rounded-full bg-brand-500"></div>
                  <span class="text-grey-900 text-[11px] font-medium">Low</span>
                </div>
                <span class="text-grey-900 text-xs font-bold">{{
                  formatNumber(ispDetailData.data.footprint_summary.low || 0)
                }}</span>
              </div>
              <div
                class="flex items-center justify-between py-1.5 px-2 bg-grey-50 rounded hover:bg-grey-100 transition-colors"
              >
                <div class="flex items-center gap-1.5">
                  <div class="w-1.5 h-1.5 rounded-full bg-yellow-500"></div>
                  <span class="text-grey-900 text-[11px] font-medium">Mid</span>
                </div>
                <span class="text-grey-900 text-xs font-bold">{{
                  formatNumber(ispDetailData.data.footprint_summary.mid || 0)
                }}</span>
              </div>
              <div
                class="flex items-center justify-between py-1.5 px-2 bg-grey-50 rounded hover:bg-grey-100 transition-colors"
              >
                <div class="flex items-center gap-1.5">
                  <div class="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                  <span class="text-grey-900 text-[11px] font-medium"
                    >High</span
                  >
                </div>
                <span class="text-grey-900 text-xs font-bold">{{
                  formatNumber(ispDetailData.data.footprint_summary.high || 0)
                }}</span>
              </div>
              <div
                class="flex items-center justify-between py-1.5 px-2 bg-grey-50 rounded hover:bg-grey-100 transition-colors"
              >
                <div class="flex items-center gap-1.5">
                  <div class="w-1.5 h-1.5 rounded-full bg-grey-500"></div>
                  <span class="text-grey-900 text-[11px] font-medium"
                    >Non Residential</span
                  >
                </div>
                <span class="text-grey-900 text-xs font-bold">{{
                  formatNumber(
                    ispDetailData.data.footprint_summary.non_residential || 0,
                  )
                }}</span>
              </div>
            </div>
          </div>

          <!-- POI Summary -->
          <div
            v-if="
              ispDetailData.data.poi_summary &&
              ispDetailData.data.poi_summary.length > 0
            "
            class="bg-white border border-grey-200 rounded-xs p-2.5"
          >
            <p class="text-grey-900 text-xs font-semibold mb-1.5">
              POI Summary
            </p>
            <div class="space-y-1">
              <div
                v-for="(poi, index) in ispDetailData.data.poi_summary"
                :key="index"
                class="flex items-center justify-between py-1.5 px-2 bg-grey-50 rounded hover:bg-grey-100 transition-colors"
              >
                <div class="flex items-center gap-1.5">
                  <div class="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                  <span
                    class="text-grey-900 text-[11px] font-medium capitalize"
                    >{{ poi.category }}</span
                  >
                </div>
                <span class="text-grey-900 text-xs font-bold">{{
                  formatNumber(poi.jumlah)
                }}</span>
              </div>
            </div>
          </div>

          <!-- Coverage List -->
          <div>
            <div class="flex items-center justify-between mb-3">
              <p class="text-grey-900 text-sm font-semibold">Coverage Areas</p>
              <span
                class="text-[10px] text-grey-500 bg-grey-100 px-2 py-1 rounded-full"
              >
                {{ ispDetailData.data.list.length }} areas
              </span>
            </div>
            <div class="space-y-3">
              <div
                v-for="item in ispDetailData.data.list"
                :key="item.ogc_fid"
                class="space-y-2"
              >
                <!-- Main Card (Clickable to fly to and highlight) -->
                <div
                  @click="handleCardClick(item)"
                  :class="[
                    'bg-white border rounded-xs overflow-hidden cursor-pointer transition-all',
                    selectedAreaId === item.ogc_fid
                      ? 'border-brand-500 shadow-lg ring-2 ring-brand-200'
                      : 'border-grey-200 hover:shadow-md hover:border-brand-200',
                  ]"
                >
                  <div class="flex items-start justify-between p-4">
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-2 mb-1">
                        <div
                          :class="[
                            'w-2 h-2 rounded-full',
                            selectedAreaId === item.ogc_fid
                              ? 'bg-brand-500 ring-2 ring-brand-300'
                              : 'bg-brand-500',
                          ]"
                        ></div>
                        <h4
                          class="text-grey-900 text-sm font-semibold truncate"
                        >
                          {{ item.name || "Unnamed Area" }}
                        </h4>
                      </div>
                      <p
                        class="text-grey-600 text-[11px] flex items-center gap-1"
                      >
                        <UIcon name="i-heroicons-map-pin" class="w-3 h-3" />
                        {{ item.coverage }}
                      </p>
                    </div>
                    <div class="flex flex-col items-end gap-1 ml-2">
                      <span class="text-xs text-grey-500 font-medium"
                        >Total</span
                      >
                      <span class="text-lg font-bold text-grey-900">{{
                        formatNumber(item.total_footprint)
                      }}</span>
                    </div>
                  </div>

                  <!-- Quick Stats (Always Visible) -->
                  <div class="px-4 pb-3">
                    <div
                      class="grid grid-cols-4 gap-2 bg-grey-50 rounded-xs p-2"
                    >
                      <div class="text-center">
                        <div class="text-[10px] text-grey-600 mb-0.5">POI</div>
                        <div class="text-sm font-bold text-green-700">
                          {{ item.total_poi }}
                        </div>
                      </div>
                      <div class="text-center">
                        <div class="text-[10px] text-grey-600 mb-0.5">Low</div>
                        <div class="text-sm font-bold text-blue-600">
                          {{ item.footprint_summary.low || 0 }}
                        </div>
                      </div>
                      <div class="text-center">
                        <div class="text-[10px] text-grey-600 mb-0.5">Mid</div>
                        <div class="text-sm font-bold text-yellow-600">
                          {{ item.footprint_summary.mid || 0 }}
                        </div>
                      </div>
                      <div class="text-center">
                        <div class="text-[10px] text-grey-600 mb-0.5">High</div>
                        <div class="text-sm font-bold text-red-600">
                          {{ item.footprint_summary.high || 0 }}
                        </div>
                      </div>
                    </div>
                  </div>

                  <!-- Accordion Button (Inside Card) -->
                  <div class="px-4 pb-1">
                    <button
                      @click.stop="toggleCard(item.ogc_fid)"
                      class="w-full flex items-center justify-center gap-2 py-2 text-xs font-medium text-grey-700 bg-grey-50 hover:bg-grey-100 rounded-xs border border-grey-200 transition-colors"
                    >
                      <span>{{
                        expandedCards.has(item.ogc_fid)
                          ? "Hide Details"
                          : "Show Details"
                      }}</span>
                      <UIcon
                        :name="
                          expandedCards.has(item.ogc_fid)
                            ? 'i-heroicons-chevron-up'
                            : 'i-heroicons-chevron-down'
                        "
                        class="w-4 h-4 transition-transform"
                      />
                    </button>
                  </div>
                  <div class="px-4 pb-4">
                    <div
                      v-if="expandedCards.has(item.ogc_fid)"
                      class="bg-white border border-grey-200 rounded-xs p-4 space-y-3"
                    >
                      <!-- Detailed Footprint Summary -->
                      <div class="bg-grey-50 rounded-xs p-2.5">
                        <p class="text-grey-900 text-xs font-semibold mb-1.5">
                          Footprint Breakdown
                        </p>
                        <div class="space-y-1">
                          <div
                            class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white"
                          >
                            <div class="flex items-center gap-1.5">
                              <div
                                class="w-1.5 h-1.5 rounded-full bg-red-500"
                              ></div>
                              <span
                                class="text-grey-700 text-[11px] font-medium"
                                >Very Low</span
                              >
                            </div>
                            <span class="text-grey-900 text-xs font-bold">{{
                              formatNumber(item.footprint_summary.very_low || 0)
                            }}</span>
                          </div>
                          <div
                            class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white"
                          >
                            <div class="flex items-center gap-1.5">
                              <div
                                class="w-1.5 h-1.5 rounded-full bg-red-300"
                              ></div>
                              <span
                                class="text-grey-700 text-[11px] font-medium"
                                >Low</span
                              >
                            </div>
                            <span class="text-grey-900 text-xs font-bold">{{
                              formatNumber(item.footprint_summary.low || 0)
                            }}</span>
                          </div>
                          <div
                            class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white"
                          >
                            <div class="flex items-center gap-1.5">
                              <div
                                class="w-1.5 h-1.5 rounded-full bg-yellow-500"
                              ></div>
                              <span
                                class="text-grey-700 text-[11px] font-medium"
                                >Mid</span
                              >
                            </div>
                            <span class="text-grey-900 text-xs font-bold">{{
                              formatNumber(item.footprint_summary.mid || 0)
                            }}</span>
                          </div>
                          <div
                            class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white"
                          >
                            <div class="flex items-center gap-1.5">
                              <div
                                class="w-1.5 h-1.5 rounded-full bg-green-500"
                              ></div>
                              <span
                                class="text-grey-700 text-[11px] font-medium"
                                >High</span
                              >
                            </div>
                            <span class="text-grey-900 text-xs font-bold">{{
                              formatNumber(item.footprint_summary.high || 0)
                            }}</span>
                          </div>
                          <div
                            class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white"
                          >
                            <div class="flex items-center gap-1.5">
                              <div
                                class="w-1.5 h-1.5 rounded-full bg-grey-400"
                              ></div>
                              <span
                                class="text-grey-700 text-[11px] font-medium"
                                >Non Residential</span
                              >
                            </div>
                            <span class="text-grey-900 text-xs font-bold">{{
                              formatNumber(
                                item.footprint_summary.non_residential || 0,
                              )
                            }}</span>
                          </div>
                        </div>
                      </div>

                      <!-- Detailed POI Summary -->
                      <div class="bg-grey-50 rounded-xs p-2.5">
                        <p class="text-grey-900 text-xs font-semibold mb-1.5">
                          POI Breakdown
                        </p>
                        <div
                          v-if="item.poi_summary.length > 0"
                          class="space-y-1"
                        >
                          <div
                            v-for="poi in item.poi_summary"
                            :key="poi.category"
                            class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-white"
                          >
                            <div class="flex items-center gap-1.5">
                              <div
                                class="w-1.5 h-1.5 rounded-full bg-green-500"
                              ></div>
                              <span
                                class="text-grey-700 text-[11px] font-medium capitalize"
                                >{{ poi.category }}</span
                              >
                            </div>
                            <span class="text-grey-900 text-xs font-bold">{{
                              formatNumber(poi.jumlah)
                            }}</span>
                          </div>
                        </div>
                        <div v-else>
                          <p class="text-xs">No POI data</p>
                        </div>
                      </div>

                      <!-- Category Info -->
                      <div
                        class="text-[10px] text-grey-600 pt-2 border-t border-grey-200"
                      >
                        Category:
                        <span class="text-grey-900 font-medium">{{
                          item.category
                        }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Expandable Details (Accordion Content) -->
              </div>
            </div>
          </div>
        </div>

        <!-- Loading State for Detail -->
        <div
          v-else-if="selectedIsp && isLoadingIspDetail"
          class="text-center py-8 bg-grey-50 rounded-xs border border-grey-200"
        >
          <div
            class="inline-block w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"
          ></div>
          <p class="text-grey-600 text-sm mt-3">Loading ISP details...</p>
        </div>
      </div>
    </div>
  </div>
</template>
