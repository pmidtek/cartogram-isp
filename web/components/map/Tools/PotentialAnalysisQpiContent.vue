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

const geojsonBuffer = computed(() => props.data?.geojson_buffer || null);
const geojsonTower = computed(() => props.data?.geojson_tower || null);
const cityIds = computed(() => props.data?.options?.area_city_ids || []);
const cityIdsParam = computed(() => cityIds.value.join(","));

const towersList = computed<Tower[]>(() => {
  if (!geojsonTower.value?.features) return [];
  return geojsonTower.value.features.map((f: any, i: number) => ({
    id: f.properties?.id ?? i,
    name: f.properties?.name || `Tower ${i + 1}`,
    geometry: f.geometry,
    properties: f.properties || {},
  }));
});

const totalTowers = computed(
  () => props.data?.analytics?.total_towers ?? towersList.value.length,
);
const totalFootprint = computed(
  () => props.data?.analytics?.total_footprint ?? 0,
);
const hasData = computed(() => totalTowers.value > 0);

const formatNumber = (value: number): string =>
  new Intl.NumberFormat("en-US").format(value);

// Derive fp_by_owner from tower features
const fpByOwner = computed(() => {
  const acc: Record<string, number> = {};
  geojsonTower.value?.features?.forEach((f: any) => {
    const owner = f.properties?.owner || "Unknown";
    acc[owner] = (acc[owner] || 0) + (f.properties?.final_footprint_count || 0);
  });
  return Object.entries(acc).map(([owner, count]) => ({
    owner,
    footprint_count: count,
  }));
});

const towerColors: Record<string, string> = {
  CTM: "#10B981",
  TBG: "#F5C400",
  Alfa: "#EF4444",
  Balcom: "#F59E0B",
  Gihon: "#3B82F6",
  PKP: "#8B5CF6",
};
const fallbackColors = ["#6B7280", "#9CA3AF", "#D1D5DB"];

const selectedTowerOwner = ref<string | null>(null);

const fpByOwnerChartData = computed(() => ({
  labels: fpByOwner.value.map((item) => item.owner),
  datasets: [
    {
      label: "Footprint Count",
      data: fpByOwner.value.map((item) => item.footprint_count),
      backgroundColor: fpByOwner.value.map((item) => {
        const baseColor = towerColors[item.owner] || fallbackColors[0];
        if (
          selectedTowerOwner.value &&
          selectedTowerOwner.value !== item.owner
        ) {
          return baseColor + "26";
        }
        return baseColor;
      }),
      borderRadius: 8,
      borderWidth: fpByOwner.value.map((item) =>
        selectedTowerOwner.value === item.owner ? 3 : 0,
      ),
      borderColor: fpByOwner.value.map((item) =>
        selectedTowerOwner.value === item.owner ? "#FFFFFF" : "transparent",
      ),
      barThickness: 24,
    },
  ],
}));

const fpByOwnerChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  onClick: (event: any, elements: any[]) => handleChartClick(event, elements),
  plugins: {
    legend: { display: false },
    datalabels: {
      anchor: "end" as const,
      align: "top" as const,
      formatter: (value: number) => `${value.toFixed(1)}`,
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
          return `Footprint: ${value.toLocaleString()}`;
        },
      },
    },
  },
  scales: {
    x: {
      grid: { display: false },
      ticks: { color: "#AFAEAF", font: { size: 10 } },
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

const handleChartClick = (_event: any, elements: any[]) => {
  if (!elements || elements.length === 0) {
    selectedTowerOwner.value = null;
    highlightTowersByOwner(null);
    return;
  }
  const ownerName = fpByOwner.value[elements[0].index]?.owner ?? null;
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
    showHighlightLayer(map, [], "fwa-buffer-analysis");
    return;
  }

  const filteredFeatures = geojsonTower.value.features.filter(
    (f: any) => f.properties?.owner === ownerName,
  );
  if (filteredFeatures.length === 0) return;

  const formattedFeatures = filteredFeatures.map((f: any) => ({
    geom: f.geometry,
    ...f.properties,
  }));
  showHighlightLayer(map, formattedFeatures, "fwa-buffer-analysis", true);

  const coordinates = filteredFeatures
    .map((f: any) => f.geometry?.coordinates)
    .filter(Boolean);

  if (coordinates.length > 0) {
    const bounds = coordinates.reduce(
      (b: any, coord: any) => b.extend(coord),
      new maplibregl.LngLatBounds(coordinates[0], coordinates[0]),
    );
    map.fitBounds(bounds, { padding: 100, duration: 1000, maxZoom: 14 });
  }
};

// Hide/show existing tower layers
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
    if (isTowerLayer && layer.layer_id && map.getLayer(layer.layer_id)) {
      map.setLayoutProperty(layer.layer_id, "visibility", "none");
    }
  });
};

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
    if (isTowerLayer && layer.layer_id && map.getLayer(layer.layer_id)) {
      const originalVisibility =
        layer.layer_style.layout_visibility || "visible";
      map.setLayoutProperty(layer.layer_id, "visibility", originalVisibility);
    }
  });
};

// City boundary layer
const CITY_LAYER_ID = "potential-analysis-city-boundaries";

const fetchCityBoundaries = async (ogcFidArray: string) => {
  if (!ogcFidArray) return null;
  try {
    const authStore = useAuth();
    return await $fetch<any>(
      `/panel/geojson/area_cities?options=area&ogc_fid=${ogcFidArray}`,
      { headers: { Authorization: `Bearer ${authStore.accessToken}` } },
    );
  } catch {
    return null;
  }
};

const addCityBoundariesToMap = async () => {
  const map = mapRefStore.map;
  if (!map || !cityIdsParam.value) return;
  const cityBoundaries = await fetchCityBoundaries(cityIdsParam.value);
  if (!cityBoundaries) return;
  removeCityBoundariesFromMap();
  map.addSource(CITY_LAYER_ID, { type: "geojson", data: cityBoundaries });
  map.addLayer({
    id: CITY_LAYER_ID,
    type: "line",
    source: CITY_LAYER_ID,
    paint: { "line-color": "#FFFFFF", "line-width": 2, "line-opacity": 0.8 },
  });
};

const removeCityBoundariesFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;
  if (map.getLayer(CITY_LAYER_ID)) map.removeLayer(CITY_LAYER_ID);
  if (map.getSource(CITY_LAYER_ID)) map.removeSource(CITY_LAYER_ID);
};

// Tower symbol layer
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
    img.onerror = reject;
    img.src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(towerIconSvg2);
  });
};

const addTowerLayerToMap = async () => {
  const map = mapRefStore.map;
  if (!map || !geojsonTower.value) return;
  await ensureTowerIconLoaded();
  removeTowerLayerFromMap();
  map.addSource(TOWER_LAYER_ID, { type: "geojson", data: geojsonTower.value });
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
    paint: { "icon-color": colorExpression, "icon-opacity": 0.9 },
  });
};

const removeTowerLayerFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;
  if (map.getLayer(TOWER_LAYER_ID)) map.removeLayer(TOWER_LAYER_ID);
  if (map.getSource(TOWER_LAYER_ID)) map.removeSource(TOWER_LAYER_ID);
};

watch(
  () => props.data,
  async (newData) => {
    if (!newData || !mapRefStore.map) return;
    hideExistingTowerLayers();
    if (newData.options?.area_city_ids?.length > 0) {
      await addCityBoundariesToMap();
    }
    if (newData.geojson_tower) {
      await addTowerLayerToMap();
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  const map = mapRefStore.map;
  if (!map) return;
  showHighlightLayer(map, [], "fwa-buffer-analysis");
  removeTowerLayerFromMap();
  removeCityBoundariesFromMap();
  showExistingTowerLayers();
});

const zoomToTower = (tower: Tower) => {
  if (!mapRefStore.map || !tower.geometry) return;
  try {
    const map = mapRefStore.map;
    const towerFeature = feature(tower.geometry);
    const bounds = bbox(towerFeature);
    const center: [number, number] = [
      (bounds[0] + bounds[2]) / 2,
      (bounds[1] + bounds[3]) / 2,
    ];
    map.flyTo({ center, zoom: 16.3, offset: [-170, 0], duration: 1500 });
  } catch {}
};

// Helpers for footprint progress bars
const fpPercent = (value: number, total: number) => {
  if (!total) return 0;
  return ((value / total) * 100).toFixed(0);
};

const fpWidth = (value: number, total: number) => {
  if (!total) return "0%";
  return `${(value / total) * 100}%`;
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
              <p v-if="totalFootprint" class="text-lg font-bold text-grey-900">
                {{ formatNumber(totalFootprint) }} Footprints
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

              <!-- Explicit meta rows -->
              <div class="mt-2 space-y-2">
                <div
                  v-if="tower.properties.code"
                  class="flex items-start gap-2 text-xs"
                >
                  <span class="text-grey-500 font-medium min-w-[80px]"
                    >Code:</span
                  >
                  <span class="text-grey-700 flex-1 break-words">{{
                    tower.properties.code
                  }}</span>
                </div>
                <div
                  v-if="tower.properties.owner"
                  class="flex items-start gap-2 text-xs"
                >
                  <span class="text-grey-500 font-medium min-w-[80px]"
                    >Owner:</span
                  >
                  <span class="text-grey-700 flex-1 break-words">{{
                    tower.properties.owner
                  }}</span>
                </div>
              </div>

              <!-- Footprint Accordion -->
              <UAccordion
                v-if="tower.properties.fp_by_hs_class"
                multiple
                :items="[
                  {
                    label: 'Footprint Details',
                    icon: 'i-heroicons-chart-bar',
                    slot: `footprint-${tower.id}`,
                    defaultOpen: false,
                  },
                  {
                    label: 'Shared Towers',
                    icon: 'i-heroicons-share',
                    slot: `shared-${tower.id}`,
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
                          v-if="item.slot === `footprint-${tower.id}`"
                          :label="`${tower.properties.final_footprint_count || 0} Foot Print`"
                          color="gray"
                          size="xs"
                          :ui="{ rounded: 'rounded-xs' }"
                          variant="subtle"
                        />
                        <UBadge
                          v-if="item.slot === `shared-${tower.id}`"
                          :label="`${tower.properties.footprint_shared_tower_count?.length || 0}`"
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

                <!-- Footprint Details slot: 3 sub-sections -->
                <template #[`footprint-${tower.id}`]>
                  <div class="space-y-3 bg-grey-50/50">
                    <!-- Total -->
                    <div>
                      <p class="text-2xs font-semibold text-grey-600 mb-1 px-1">
                        Total
                      </p>
                      <div class="space-y-2">
                        <template
                          v-for="(val, cls) in tower.properties.fp_by_hs_class"
                          :key="`total-${cls}`"
                        >
                          <div
                            v-if="val"
                            class="flex items-center gap-2 p-2 bg-white rounded-xs border border-grey-200"
                          >
                            <div class="flex items-center gap-2 flex-1 min-w-0">
                              <span
                                class="text-xs font-medium text-grey-600 min-w-[100px] capitalize"
                              >
                                {{ String(cls).replace(/_/g, " ") }}
                              </span>
                              <div
                                class="flex-1 h-1.5 bg-grey-100 rounded-full overflow-hidden"
                              >
                                <div
                                  class="h-full bg-blue-500 rounded-full transition-all duration-500"
                                  :style="{
                                    width: fpWidth(
                                      val,
                                      tower.properties.final_footprint_count,
                                    ),
                                  }"
                                ></div>
                              </div>
                            </div>
                            <div class="flex items-center gap-1.5 shrink-0">
                              <span class="text-sm font-bold text-grey-900">{{
                                val
                              }}</span>
                              <span
                                class="text-xs text-grey-500 min-w-[35px] text-right"
                              >
                                {{
                                  fpPercent(
                                    val,
                                    tower.properties.final_footprint_count,
                                  )
                                }}%
                              </span>
                            </div>
                          </div>
                        </template>
                      </div>
                    </div>

                    <!-- Main -->
                    <div v-if="tower.properties.fp_by_hs_class_main">
                      <p class="text-2xs font-semibold text-grey-600 mb-1 px-1">
                        Main
                      </p>
                      <div class="space-y-2">
                        <template
                          v-for="(val, cls) in tower.properties
                            .fp_by_hs_class_main"
                          :key="`main-${cls}`"
                        >
                          <div
                            v-if="val"
                            class="flex items-center gap-2 p-2 bg-white rounded-xs border border-grey-200"
                          >
                            <div class="flex items-center gap-2 flex-1 min-w-0">
                              <span
                                class="text-xs font-medium text-grey-600 min-w-[100px] capitalize"
                              >
                                {{ String(cls).replace(/_/g, " ") }}
                              </span>
                              <div
                                class="flex-1 h-1.5 bg-grey-100 rounded-full overflow-hidden"
                              >
                                <div
                                  class="h-full bg-emerald-500 rounded-full transition-all duration-500"
                                  :style="{
                                    width: fpWidth(
                                      val,
                                      tower.properties.final_footprint_count,
                                    ),
                                  }"
                                ></div>
                              </div>
                            </div>
                            <div class="flex items-center gap-1.5 shrink-0">
                              <span class="text-sm font-bold text-grey-900">{{
                                val
                              }}</span>
                              <span
                                class="text-xs text-grey-500 min-w-[35px] text-right"
                              >
                                {{
                                  fpPercent(
                                    val,
                                    tower.properties.final_footprint_count,
                                  )
                                }}%
                              </span>
                            </div>
                          </div>
                        </template>
                      </div>
                    </div>

                    <!-- Shared -->
                    <div v-if="tower.properties.fp_by_hs_class_shared">
                      <p class="text-2xs font-semibold text-grey-600 mb-1 px-1">
                        Shared
                      </p>
                      <div class="space-y-2">
                        <template
                          v-for="(val, cls) in tower.properties
                            .fp_by_hs_class_shared"
                          :key="`shared-cls-${cls}`"
                        >
                          <div
                            v-if="val"
                            class="flex items-center gap-2 p-2 bg-white rounded-xs border border-grey-200"
                          >
                            <div class="flex items-center gap-2 flex-1 min-w-0">
                              <span
                                class="text-xs font-medium text-grey-600 min-w-[100px] capitalize"
                              >
                                {{ String(cls).replace(/_/g, " ") }}
                              </span>
                              <div
                                class="flex-1 h-1.5 bg-grey-100 rounded-full overflow-hidden"
                              >
                                <div
                                  class="h-full bg-amber-500 rounded-full transition-all duration-500"
                                  :style="{
                                    width: fpWidth(
                                      val,
                                      tower.properties.final_footprint_count,
                                    ),
                                  }"
                                ></div>
                              </div>
                            </div>
                            <div class="flex items-center gap-1.5 shrink-0">
                              <span class="text-sm font-bold text-grey-900">{{
                                val
                              }}</span>
                              <span
                                class="text-xs text-grey-500 min-w-[35px] text-right"
                              >
                                {{
                                  fpPercent(
                                    val,
                                    tower.properties.final_footprint_count,
                                  )
                                }}%
                              </span>
                            </div>
                          </div>
                        </template>
                      </div>
                    </div>
                  </div>
                </template>

                <!-- Shared Towers slot -->
                <template #[`shared-${tower.id}`]>
                  <div class="p-1 pt-0 space-y-2 bg-grey-50/50">
                    <div
                      v-if="
                        !tower.properties.footprint_shared_tower_count?.length
                      "
                      class="text-xs text-grey-500 py-2 text-center"
                    >
                      No shared towers
                    </div>
                    <div
                      v-for="shared in tower.properties
                        .footprint_shared_tower_count"
                      :key="shared.id"
                      class="flex items-center gap-2 p-2.5 bg-white rounded-xs border border-grey-200"
                    >
                      <div class="flex-1 min-w-0">
                        <p class="text-xs font-semibold text-grey-800 truncate">
                          {{ shared.name }}
                        </p>
                        <div class="flex items-center gap-2 mt-0.5">
                          <span class="text-2xs text-grey-500">{{
                            shared.owner
                          }}</span>
                        </div>
                      </div>
                      <UBadge
                        :label="`${shared.count}`"
                        color="blue"
                        size="xs"
                        variant="subtle"
                        :ui="{ rounded: 'rounded-xs' }"
                      />
                    </div>
                  </div>
                </template>
              </UAccordion>
            </div>

            <!-- Action Buttons -->
            <div class="flex-shrink-0 flex">
              <UButton
                icon="i-heroicons-map-pin"
                size="xs"
                color="gray"
                variant="ghost"
                @click="zoomToTower(tower)"
                :ui="{ rounded: 'rounded-xs' }"
                title="Zoom to tower"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
