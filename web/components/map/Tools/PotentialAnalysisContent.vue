<script lang="ts" setup>
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
  sectors?: any[]; // Array of 3 sector properties
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

// Per-tower visibility state
const towerVisibility = ref<Record<number, boolean>>({});

const geojsonBuffer = computed(() => {
  return props.data?.geojson_buffer || null;
});

const geojsonSector = computed(() => {
  return props.data?.geojson_sector || null;
});

const towersList = computed<Tower[]>(() => {
  if (!geojsonBuffer.value?.features) return [];

  // Create a map of tower_id -> array of sector properties
  const sectorsMap = new Map<number, any[]>();

  if (geojsonSector.value?.features) {
    const sectorFeatures = geojsonSector.value?.features;

    sectorFeatures.forEach((feature: any) => {
      const towerId = feature.properties?.tower_id;
      if (towerId !== undefined) {
        // Collect all sector properties for this tower
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
    // Use database tower ID from properties
    const towerId = feature.properties?.id || index;

    // Initialize visibility for each tower as true
    if (towerVisibility.value[towerId] === undefined) {
      towerVisibility.value[towerId] = true;
    }

    // Get sectors array for this tower (or empty array if none)
    const sectors = sectorsMap.get(towerId) || [];

    return {
      id: towerId,
      name: feature.properties?.site_name || `Tower ${index + 1}`,
      properties: feature.properties || {},
      geometry: feature.geometry,
      sectors: sectors, // Array of 3 sector properties
    };
  });
});

const totalTowers = computed(() => {
  return towersList.value.length;
});

const hasData = computed(() => {
  return totalTowers.value > 0;
});

// Analytics data
const analyticsData = computed(() => props.data?.analytics);

// Tower colors (matching TowerSummary.vue)
const towerColors: Record<string, string> = {
  CTM: "#10B981", // Green
  TBG: "#F5C400", // Yellow
  Alfa: "#EF4444", // Red
  Balcom: "#F59E0B", // Amber
  Gihon: "#3B82F6", // Blue
  PKP: "#8B5CF6", // Purple
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
          // Dim unselected bars to 15% opacity
          if (
            selectedTowerOwner.value &&
            selectedTowerOwner.value !== item.owner
          ) {
            return baseColor + "26"; // 15% opacity
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

// Bar chart options
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

// Format number with thousands separator
const formatNumber = (value: number): string => {
  return new Intl.NumberFormat("en-US").format(value);
};

// Selected tower owner for highlighting
const selectedTowerOwner = ref<string | null>(null);

// GeoJSON tower data
const geojsonTower = computed(() => props.data?.geojson_tower);

// City administration IDs
const cityIds = computed(() => props.data?.options?.area_city_ids || []);
const cityIdsParam = computed(() => cityIds.value.join(","));

// Handle bar chart click
const handleChartClick = (event: any, elements: any[]) => {
  if (!elements || elements.length === 0) {
    // Click on empty area - reset selection
    selectedTowerOwner.value = null;
    highlightTowersByOwner(null);
    return;
  }

  const element = elements[0];
  const dataIndex = element.index;
  const ownerName =
    analyticsData.value?.fp_by_owner?.[dataIndex]?.owner || null;

  if (!ownerName) return;

  // Toggle: clicking same owner again resets
  if (selectedTowerOwner.value === ownerName) {
    selectedTowerOwner.value = null;
    highlightTowersByOwner(null);
  } else {
    selectedTowerOwner.value = ownerName;
    highlightTowersByOwner(ownerName);
  }
};

// Highlight towers by owner on map
const highlightTowersByOwner = (ownerName: string | null) => {
  const map = mapRefStore.map;
  if (!map || !geojsonTower.value) return;

  // If no owner selected, clear highlights
  if (!ownerName) {
    showHighlightLayer(map, [], "fwa-buffer-analysis");
    return;
  }

  // Filter towers by owner
  const filteredFeatures = geojsonTower.value.features.filter(
    (feature: any) => feature.properties?.owner === ownerName,
  );

  if (filteredFeatures.length === 0) return;

  // Convert features to format expected by showHighlightLayer
  const formattedFeatures = filteredFeatures.map((feature: any) => ({
    geom: feature.geometry,
    ...feature.properties,
  }));

  // Use existing utility to show highlights with pulsing animation
  showHighlightLayer(map, formattedFeatures, "fwa-buffer-analysis", true);

  // Fit map to highlighted towers
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

// Hide existing tower layers
const hideExistingTowerLayers = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const mapLayerStore = useMapLayer();
  const { groupedActiveLayers } = storeToRefs(mapLayerStore);

  if (!groupedActiveLayers.value) return;

  const sitePointsGroup = groupedActiveLayers.value.find(
    (group) => group.label === "Site Points",
  );

  if (!sitePointsGroup) return;

  sitePointsGroup.layerLists.forEach((layer) => {
    const isTowerLayer =
      layer.category?.category_id === 3 && layer.geometry_type === "Symbol";

    if (isTowerLayer && layer.layer_id) {
      if (map.getLayer(layer.layer_id)) {
        map.setLayoutProperty(layer.layer_id, "visibility", "none");
      }
    }
  });
};

// City boundary layer management
const CITY_LAYER_ID = "potential-analysis-city-boundaries";

const fetchCityBoundaries = async (ogcFidArray: string) => {
  if (!ogcFidArray) return null;
  try {
    const authStore = useAuth();
    const response = await $fetch<any>(
      `/panel/geojson/area_cities?options=area&ogc_fid=${ogcFidArray}`,
      {
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
      },
    );
    return response;
  } catch (error) {
    console.error("Error fetching city boundaries:", error);
    return null;
  }
};

const addCityBoundariesToMap = async () => {
  const map = mapRefStore.map;
  if (!map || !cityIdsParam.value) return;

  const cityBoundaries = await fetchCityBoundaries(cityIdsParam.value);
  if (!cityBoundaries) return;

  removeCityBoundariesFromMap();

  map.addSource(CITY_LAYER_ID, {
    type: "geojson",
    data: cityBoundaries,
  });

  // Only outline, no fill
  map.addLayer({
    id: CITY_LAYER_ID,
    type: "line",
    source: CITY_LAYER_ID,
    paint: {
      "line-color": "#FFFFFF",
      "line-width": 2,
      "line-opacity": 0.8,
    },
  });
};

const removeCityBoundariesFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;

  if (map.getLayer(CITY_LAYER_ID)) {
    map.removeLayer(CITY_LAYER_ID);
  }
  if (map.getSource(CITY_LAYER_ID)) {
    map.removeSource(CITY_LAYER_ID);
  }
};

// Tower symbol layer management
const TOWER_LAYER_ID = "potential-analysis-towers";

const ensureTowerIconLoaded = async () => {
  const map = mapRefStore.map;
  if (!map || map.hasImage("tower-icon")) return;

  const { towerIconSvg2 } = await import("~/constants");

  return new Promise<void>((resolve, reject) => {
    const img = new Image(25, 25);
    img.onload = () => {
      if (map && !map.hasImage("tower-icon")) {
        map.addImage("tower-icon", img, { sdf: true });
      }
      resolve();
    };
    img.onerror = (error) => {
      console.error("Failed to load tower icon:", error);
      reject(error);
    };
    img.src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(towerIconSvg2);
  });
};

const addTowerLayerToMap = async () => {
  const map = mapRefStore.map;
  if (!map || !geojsonTower.value) return;

  await ensureTowerIconLoaded();
  removeTowerLayerFromMap();

  map.addSource(TOWER_LAYER_ID, {
    type: "geojson",
    data: geojsonTower.value,
  });

  const colorExpression: any = ["match", ["get", "owner"]];
  Object.entries(towerColors).forEach(([owner, color]) => {
    colorExpression.push(owner, color);
  });
  colorExpression.push("#F97316");

  map.addLayer({
    id: TOWER_LAYER_ID,
    type: "symbol",
    source: TOWER_LAYER_ID,
    minzoom: 12,
    maxzoom: 18,
    layout: {
      "icon-image": "tower-icon",
      "icon-size": 1.2,
      "icon-allow-overlap": true,
      visibility: "visible",
    },
    paint: {
      "icon-color": colorExpression,
      "icon-opacity": 0.9,
    },
  });
};

const removeTowerLayerFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;

  if (map.getLayer(TOWER_LAYER_ID)) {
    map.removeLayer(TOWER_LAYER_ID);
  }
  if (map.getSource(TOWER_LAYER_ID)) {
    map.removeSource(TOWER_LAYER_ID);
  }
};

// Watch for data changes and add layers
watch(
  () => props.data,
  async (newData) => {
    if (!newData || !mapRefStore.map) return;

    // Hide existing tower layers first
    hideExistingTowerLayers();

    // Add city boundaries (bottom layer)
    if (
      newData.options?.area_city_ids &&
      newData.options.area_city_ids.length > 0
    ) {
      await addCityBoundariesToMap();
    }

    // Add tower layer (top layer)
    if (newData.geojson_tower) {
      await addTowerLayerToMap();
    }
  },
  { immediate: true },
);

// Show back existing tower layers
const showExistingTowerLayers = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const mapLayerStore = useMapLayer();
  const { groupedActiveLayers } = storeToRefs(mapLayerStore);

  if (!groupedActiveLayers.value) return;

  const sitePointsGroup = groupedActiveLayers.value.find(
    (group) => group.label === "Site Points",
  );

  if (!sitePointsGroup) return;

  sitePointsGroup.layerLists.forEach((layer) => {
    const isTowerLayer =
      layer.category?.category_id === 3 && layer.geometry_type === "Symbol";

    if (isTowerLayer && layer.layer_id) {
      if (map.getLayer(layer.layer_id)) {
        // Restore to original visibility state
        const originalVisibility =
          layer.layer_style.layout_visibility || "visible";
        map.setLayoutProperty(layer.layer_id, "visibility", originalVisibility);
      }
    }
  });
};

// Cleanup highlight layer on unmount
onUnmounted(() => {
  const map = mapRefStore.map;
  if (!map) return;

  // Clear highlights managed by showHighlightLayer utility
  showHighlightLayer(map, [], "fwa-buffer-analysis");

  // Remove tower and city boundary layers
  removeTowerLayerFromMap();
  removeCityBoundariesFromMap();

  // Show back existing tower layers
  showExistingTowerLayers();
});

// Fly to tower location
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

// Toggle per-tower visibility
const hiddenTowers = new Set<number>();

const toggleTowerVisibility = (towerId: number) => {
  if (!mapRefStore.map) return;
  const map = mapRefStore.map;
  const LAYER_ID = "fwa-buffer-analysis";

  if (hiddenTowers.has(towerId)) {
    // unhide tower
    hiddenTowers.delete(towerId);
  } else {
    // hide tower
    hiddenTowers.add(towerId);
  }

  if (hiddenTowers.size === 0) {
    // show all if none hidden
    map.setFilter(LAYER_ID, null);
  } else {
    // show only features whose id is not in hiddenTowers
    map.setFilter(LAYER_ID, [
      "!",
      ["in", ["get", "id"], ["literal", Array.from(hiddenTowers)]],
    ]);
  }
};

// Update layer filters based on visibility state
const updateLayerFilters = () => {
  if (!mapRefStore.map) return;

  const map = mapRefStore.map;
  const LAYER_ID = "fwa-buffer-analysis";

  // Get visible tower indices
  const visibleTowerIndices = Object.entries(towerVisibility.value)
    .filter(([_, visible]) => visible)
    .map(([id]) => parseInt(id));

  // Build filter expression to show only visible towers
  let filterExpression: any;
  if (visibleTowerIndices.length === 0) {
    // Hide all
    filterExpression = ["!=", ["get", "$id"], -1]; // No feature has $id = -1
  } else if (visibleTowerIndices.length === towersList.value.length) {
    // Show all - no filter needed
    filterExpression = null;
  } else {
    // Show specific towers using feature index
    filterExpression = ["in", ["id"], ["literal", visibleTowerIndices]];
  }

  console.log(filterExpression);
  // Apply filter to both layers
  if (map.getLayer(LAYER_ID)) {
    if (filterExpression) {
      console.log(LAYER_ID, filterExpression);
      map.setFilter(LAYER_ID, filterExpression);
    } else {
      map.setFilter(LAYER_ID, null);
    }
  }

  if (map.getLayer(`${LAYER_ID}-outline`)) {
    if (filterExpression) {
      map.setFilter(`${LAYER_ID}-outline`, filterExpression);
    } else {
      map.setFilter(`${LAYER_ID}-outline`, null);
    }
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
        No data available.<br />Please apply filter to load data.
      </p>
    </div>

    <!-- Summary Statistics -->
    <div v-else class="flex flex-col gap-3">
      <!-- Analysis Summary Card -->
      <div
        class="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xs border border-blue-200"
      >
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="p-2 bg-blue-500 rounded-lg">
              <UIcon name="i-heroicons-signal" class="w-5 h-5 text-white" />
            </div>
            <div>
              <p class="text-xs text-grey-600">Coverage Analysis</p>
              <p class="text-lg font-bold text-grey-900">
                {{ totalTowers }} Towers
              </p>
              <p
                v-if="analyticsData?.total_footprint"
                class="text-lg font-bold text-grey-900"
              >
                {{ formatNumber(analyticsData?.total_footprint || 0) }}
                Footprints
              </p>
            </div>
          </div>
          <div class="text-right">
            <p class="text-xs text-grey-600">Buffer Radius</p>
            <p class="text-lg font-bold text-blue-600">{{ radius }}m</p>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs text-grey-600">
          <UIcon name="i-heroicons-information-circle" class="w-4 h-4" />
          <span>FWA Fixed Wireless Access coverage buffer zones</span>
        </div>
      </div>

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

      <!-- Tower List Header -->
      <div class="flex items-center justify-between">
        <h3 class="text-sm font-semibold text-grey-800">Tower Detail</h3>
        <UBadge
          :label="`${totalTowers} sites`"
          size="sm"
          color="blue"
          variant="subtle"
        />
      </div>

      <!-- Tower List -->
      <div
        class="flex flex-col gap-2 max-h-[calc(100dvh-31rem)] overflow-y-auto pr-1"
      >
        <div
          v-for="(tower, index) in towersList"
          :key="tower.id"
          class="group relative bg-white p-3 rounded-lg border border-grey-200 hover:border-blue-400 hover:shadow-md transition-all duration-200"
        >
          <!-- Tower Header -->
          <div class="flex items-start gap-1">
            <!-- Index Badge -->
            <div
              class="flex-shrink-0 w-5 h-5 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center"
            >
              <span class="text-xs font-bold text-white">{{ index + 1 }}</span>
            </div>

            <!-- Tower Info -->
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-2 mb-1">
                <UIcon
                  name="i-heroicons-building-office-2"
                  class="w-4 h-4 text-grey-500 flex-shrink-0"
                />
                <p class="text-sm font-semibold text-grey-900 truncate">
                  {{ tower.name }}
                </p>
              </div>

              <!-- Additional Properties -->
              <div v-if="tower.properties" class="mt-2 space-y-2">
                <div
                  v-for="(value, key) in tower.properties"
                  :key="key"
                  v-show="
                    String(key) !== 'fp_by_hs_class' &&
                    String(key) !== 'final_footprint_count' &&
                    String(key) !== 'sector'
                  "
                  class="flex items-start gap-2 text-xs"
                >
                  <span
                    class="text-grey-500 font-medium min-w-[80px] capitalize"
                    >{{ String(key).replace(/_/g, " ") }}:</span
                  >
                  <span class="text-grey-700 flex-1 break-words">{{
                    value || "-"
                  }}</span>
                </div>
              </div>

              <!-- Footprint by HS Class Accordion -->
              <UAccordion
                v-if="tower.properties?.fp_by_hs_class"
                multiple
                :items="
                  geojsonSector?.features
                    ? [
                        {
                          label: 'Footprint Details',
                          icon: 'i-heroicons-chart-bar',
                          slot: `footprint-${tower.id}`,
                          defaultOpen: false,
                        },
                        {
                          label: 'Quadrant Details',
                          icon: 'i-heroicons-chart-bar',
                          slot: `sector-${tower.id}`,
                          defaultOpen: false,
                        },
                      ]
                    : [
                        {
                          label: 'Footprint Details',
                          icon: 'i-heroicons-chart-bar',
                          slot: `footprint-${tower.id}`,
                          defaultOpen: false,
                        },
                      ]
                "
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
                          v-if="item.slot === `footprint-${tower.id}`"
                          :label="`${
                            tower.properties.final_footprint_count || 0
                          } Foot Print`"
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

                <template #[`footprint-${tower.id}`]>
                  <div class="space-y-2 bg-grey-50/50">
                    <!-- High Class -->
                    <div
                      v-if="tower.properties.fp_by_hs_class.high"
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
                                (tower.properties.fp_by_hs_class.high /
                                  tower.properties.final_footprint_count) *
                                100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          tower.properties.fp_by_hs_class.high
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            (
                              (tower.properties.fp_by_hs_class.high /
                                tower.properties.final_footprint_count) *
                              100
                            ).toFixed(0)
                          }}%</span
                        >
                      </div>
                    </div>

                    <!-- Mid Class -->
                    <div
                      v-if="tower.properties.fp_by_hs_class.mid"
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
                                (tower.properties.fp_by_hs_class.mid /
                                  tower.properties.final_footprint_count) *
                                100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          tower.properties.fp_by_hs_class.mid
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            (
                              (tower.properties.fp_by_hs_class.mid /
                                tower.properties.final_footprint_count) *
                              100
                            ).toFixed(0)
                          }}%</span
                        >
                      </div>
                    </div>

                    <!-- Low Class -->
                    <div
                      v-if="tower.properties.fp_by_hs_class.low"
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
                                (tower.properties.fp_by_hs_class.low /
                                  tower.properties.final_footprint_count) *
                                100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          tower.properties.fp_by_hs_class.low
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            (
                              (tower.properties.fp_by_hs_class.low /
                                tower.properties.final_footprint_count) *
                              100
                            ).toFixed(0)
                          }}%</span
                        >
                      </div>
                    </div>

                    <!-- Very Low Class -->
                    <div
                      v-if="tower.properties.fp_by_hs_class.very_low"
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
                                (tower.properties.fp_by_hs_class.very_low /
                                  tower.properties.final_footprint_count) *
                                100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          tower.properties.fp_by_hs_class.very_low
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            (
                              (tower.properties.fp_by_hs_class.very_low /
                                tower.properties.final_footprint_count) *
                              100
                            ).toFixed(0)
                          }}%</span
                        >
                      </div>
                    </div>

                    <!-- Non-Residential -->
                    <div
                      v-if="tower.properties.fp_by_hs_class.non_residential"
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
                                (tower.properties.fp_by_hs_class
                                  .non_residential /
                                  tower.properties.final_footprint_count) *
                                100
                              }%`,
                            }"
                          ></div>
                        </div>
                      </div>
                      <div class="flex items-center gap-1.5 shrink-0">
                        <span class="text-sm font-bold text-grey-900">{{
                          tower.properties.fp_by_hs_class.non_residential
                        }}</span>
                        <span
                          class="text-xs text-grey-500 min-w-[35px] text-right"
                          >{{
                            (
                              (tower.properties.fp_by_hs_class.non_residential /
                                tower.properties.final_footprint_count) *
                              100
                            ).toFixed(0)
                          }}%</span
                        >
                      </div>
                    </div>
                  </div>
                </template>
                <template #[`sector-${tower.id}`]>
                  <div class="p-3 pt-0 space-y-2 bg-grey-50/50">
                    <div
                      v-for="quadrant in tower.sectors"
                      :key="quadrant.id"
                      class="flex items-center gap-2 p-2.5 bg-white rounded-xs border border-grey-200 hover:border-blue-300 transition-colors"
                    >
                      <!-- Quadrant Color & Info -->
                      <div class="flex items-center gap-2 flex-1 min-w-0">
                        <div
                          class="w-7 h-7 rounded rounded-xs flex-shrink-0 border-2 border-white shadow-sm"
                          :style="{ backgroundColor: quadrant.fill }"
                        ></div>
                        <div class="flex-1 min-w-0">
                          <p class="text-xs font-semibold text-grey-800">
                            Quadrant {{ quadrant.id }}
                          </p>
                          <p class="text-2xs text-grey-600">
                            {{ quadrant.count_footprint || 0 }} footprints
                          </p>
                          <p class="text-2xs text-grey-600">
                            {{ quadrant.percentage || 0 }} %
                          </p>
                        </div>
                      </div>

                      <!-- Quadrant Actions -->
                    </div>
                  </div>
                </template>
              </UAccordion>
            </div>

            <!-- Action Buttons -->
            <div class="flex-shrink-0 flex">
              <!-- Zoom to Tower Button -->
              <UButton
                icon="i-heroicons-map-pin"
                size="xs"
                color="gray"
                variant="ghost"
                @click="zoomToTower(tower)"
                :ui="{ rounded: 'rounded-xs' }"
                title="Zoom to tower"
              />

              <!-- Toggle Visibility Button -->
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
