<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { storeToRefs } from "pinia";
import { useAuth } from "~/stores/useAuth";
import { useAnalysisResult } from "~/stores/useAnalysisResult";
import { featureCollection } from "@turf/helpers";
import bbox from "@turf/bbox";
import IcInfo from "~/assets/icons/ic-info.svg";

const authStore = useAuth();
const analysisStore = useAnalysisResult();
const { dataBufferAnalysis } = storeToRefs(analysisStore);
const mapStore = useMapRef();
const { map } = mapStore;
const toast = useToast();

// Visibility state management
const towerVisibility = ref<Record<string, boolean>>({});
const footprintVisibility = ref<Record<string, boolean>>({});
const quadrantGroupVisibility = ref<Record<string, boolean>>({});
const individualQuadrantVisibility = ref<Record<string, string>>({});
const allLayersVisible = ref<boolean>(true);

// Download state
const isDownloading = ref<boolean>(false);

// Transform data to items for display
const items = computed(() => {
  if (!dataBufferAnalysis.value) return [];

  return dataBufferAnalysis.value
    .filter((item: any) => item.geojson_quadrant) // Only show quadrant-based analyses
    .map((item: any, index: number) => {
      const towerId = item.tower_id || `tower_${index}`;
      const label = `Tower ${index + 1}`;

      // Extract quadrants data
      let quadrants: any[] = [];
      if (item.geojson_quadrant?.type === "FeatureCollection") {
        quadrants = item.geojson_quadrant.features.map((f: any) => ({
          id: f.properties?.id || f.properties?.quadrant_id,
          angle_percentage: f.properties?.angle_percentage || 0,
          count_footprint: f.properties?.count_footprint || 0,
          fill: f.properties?.fill || "#3B82F6",
          geometry: f,
        }));
      }

      // Extract directions data
      let directions: any[] = [];
      if (item.geojson_direction?.type === "FeatureCollection") {
        directions = item.geojson_direction.features.map(
          (f: any, i: number) => ({
            id: i + 1,
            direction: f.properties?.direction || 0,
          }),
        );
      } else if (item.geojson_direction?.type === "Feature") {
        directions = [
          {
            id: 1,
            direction: item.geojson_direction.properties?.direction || 0,
          },
        ];
      }

      return {
        id: towerId,
        label,
        tower_id: item.tower_id,
        geojson_footprint: item.geojson_footprint,
        geojson_quadrant: item.geojson_quadrant,
        geojson_direction: item.geojson_direction,
        quadrants,
        directions,
        properties: item.properties || {},
        slot: "tower-details",
        defaultOpen: false,
      };
    });
});

// Calculate total towers
const totalTowers = computed(() => items.value.length);

// Calculate buffer radius from first item
const bufferRadius = computed(() => {
  if (items.value.length === 0) return 0;
  // Assuming radius is stored in properties or calculate from geometry
  return items.value[0]?.properties?.radius || 500;
});

// Initialize visibility states from existing map layers
function initializeVisibilityStates() {
  if (!map) return;

  items.value.forEach((item: any) => {
    const towerId = item.id;

    // Check if footprint layer exists and initialize state
    const footprintFillId = `quadrant-footprint-fill`;
    if (map.getLayer(footprintFillId)) {
      footprintVisibility.value[towerId] = true;
    }

    // Check quadrant layers and initialize states
    if (item.quadrants && item.quadrants.length > 0) {
      item.quadrants.forEach((quadrant: any) => {
        const visKey = `${towerId}_q${quadrant.id}`;
        individualQuadrantVisibility.value[visKey] = "visible";
      });
      quadrantGroupVisibility.value[towerId] = true;
    }

    // Initialize tower visibility
    towerVisibility.value[towerId] = true;
  });
}

// Toggle tower visibility (all layers)
// Note: FixQuadrantBased creates shared layers for all towers, so we toggle them all together
function toggleTowerVisibility(item: any) {
  if (!map) return;

  const towerId = item.id;
  const isCurrentlyVisible = towerVisibility.value[towerId] ?? true;
  const newVisibility = !isCurrentlyVisible;
  const visibilityValue = newVisibility ? "visible" : "none";

  towerVisibility.value[towerId] = newVisibility;
  footprintVisibility.value[towerId] = newVisibility;
  quadrantGroupVisibility.value[towerId] = newVisibility;

  // Toggle the shared footprint layers
  if (map.getLayer("quadrant-footprint-fill")) {
    map.setLayoutProperty(
      "quadrant-footprint-fill",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-footprint-outline")) {
    map.setLayoutProperty(
      "quadrant-footprint-outline",
      "visibility",
      visibilityValue,
    );
  }

  // Toggle the shared quadrant layers
  if (map.getLayer("quadrant-analysis-layer")) {
    map.setLayoutProperty(
      "quadrant-analysis-layer",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-analysis-outline")) {
    map.setLayoutProperty(
      "quadrant-analysis-outline",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-analysis-labels")) {
    map.setLayoutProperty(
      "quadrant-analysis-labels",
      "visibility",
      visibilityValue,
    );
  }

  // Update individual quadrant visibility states
  item.quadrants?.forEach((quadrant: any) => {
    const visKey = `${towerId}_q${quadrant.id}`;
    individualQuadrantVisibility.value[visKey] = visibilityValue;
  });

  // Zoom to tower if making visible
  if (newVisibility) {
    zoomToTower(item);
  }
}

// Toggle footprint visibility
function toggleFootprintVisibility(item: any) {
  if (!map) return;

  const towerId = item.id;
  const isCurrentlyVisible = footprintVisibility.value[towerId] ?? true;
  const newVisibility = !isCurrentlyVisible;
  const visibilityValue = newVisibility ? "visible" : "none";

  if (map.getLayer("quadrant-footprint-fill")) {
    map.setLayoutProperty(
      "quadrant-footprint-fill",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-footprint-outline")) {
    map.setLayoutProperty(
      "quadrant-footprint-outline",
      "visibility",
      visibilityValue,
    );
  }

  footprintVisibility.value[towerId] = newVisibility;
}

// Toggle quadrant group visibility
function toggleQuadrantGroupVisibility(item: any) {
  if (!map) return;

  const towerId = item.id;
  const isCurrentlyVisible = quadrantGroupVisibility.value[towerId] ?? true;
  const newVisibility = !isCurrentlyVisible;
  const visibilityValue = newVisibility ? "visible" : "none";

  if (map.getLayer("quadrant-analysis-layer")) {
    map.setLayoutProperty(
      "quadrant-analysis-layer",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-analysis-outline")) {
    map.setLayoutProperty(
      "quadrant-analysis-outline",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-analysis-labels")) {
    map.setLayoutProperty(
      "quadrant-analysis-labels",
      "visibility",
      visibilityValue,
    );
  }

  // Update individual quadrant visibility states
  item.quadrants?.forEach((quadrant: any) => {
    const visKey = `${towerId}_q${quadrant.id}`;
    individualQuadrantVisibility.value[visKey] = visibilityValue;
  });

  quadrantGroupVisibility.value[towerId] = newVisibility;
}

// Toggle individual quadrant visibility
// Note: Since FixQuadrantBased creates shared layers, this toggles all quadrants
// To support per-quadrant visibility, FixQuadrantBased would need to create separate layers per quadrant
function toggleIndividualQuadrantVisibility(item: any, quadrant: any) {
  if (!map) return;

  const towerId = item.id;
  const quadrantId = quadrant.id;
  const visKey = `${towerId}_q${quadrantId}`;

  const isCurrentlyVisible =
    individualQuadrantVisibility.value[visKey] === "visible";
  const newVisibility = !isCurrentlyVisible;
  const visibilityValue = newVisibility ? "visible" : "none";

  // For now, toggle the shared quadrant layers
  // TODO: To support per-quadrant visibility, FixQuadrantBased needs to create separate layers
  if (map.getLayer("quadrant-analysis-layer")) {
    map.setLayoutProperty(
      "quadrant-analysis-layer",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-analysis-outline")) {
    map.setLayoutProperty(
      "quadrant-analysis-outline",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-analysis-labels")) {
    map.setLayoutProperty(
      "quadrant-analysis-labels",
      "visibility",
      visibilityValue,
    );
  }

  individualQuadrantVisibility.value[visKey] = visibilityValue;
}

// Zoom functions
function zoomToTower(item: any) {
  if (!map) return;

  try {
    const features: any[] = [];

    if (item.geojson_footprint) {
      if (item.geojson_footprint.type === "FeatureCollection") {
        features.push(...item.geojson_footprint.features);
      } else if (item.geojson_footprint.type === "Feature") {
        features.push(item.geojson_footprint);
      }
    }

    if (item.geojson_quadrant) {
      if (item.geojson_quadrant.type === "FeatureCollection") {
        features.push(...item.geojson_quadrant.features);
      } else if (item.geojson_quadrant.type === "Feature") {
        features.push(item.geojson_quadrant);
      }
    }

    if (features.length > 0) {
      const bounds = bbox(featureCollection(features));
      map.fitBounds(bounds as any, {
        padding: 100,
        duration: 1000,
      });
    }
  } catch (error) {
    console.error("Error zooming to tower:", error);
  }
}

function zoomToFootprint(item: any) {
  if (!map || !item.geojson_footprint) return;

  try {
    const bounds = bbox(item.geojson_footprint);
    map.fitBounds(bounds as any, {
      padding: 100,
      duration: 1000,
    });
  } catch (error) {
    console.error("Error zooming to footprint:", error);
  }
}

function zoomToQuadrantGroup(item: any) {
  if (!map || !item.geojson_quadrant) return;

  try {
    const bounds = bbox(item.geojson_quadrant);
    map.fitBounds(bounds as any, {
      padding: 100,
      duration: 1000,
    });
  } catch (error) {
    console.error("Error zooming to quadrant group:", error);
  }
}

function zoomToQuadrant(item: any, quadrant: any) {
  if (!map || !quadrant.geometry) return;

  try {
    const bounds = bbox(quadrant.geometry);
    map.fitBounds(bounds as any, {
      padding: 100,
      duration: 1000,
    });
  } catch (error) {
    console.error("Error zooming to quadrant:", error);
  }
}

// Toggle all layers visibility
function toggleAllLayersVisibility() {
  if (!map) return;

  allLayersVisible.value = !allLayersVisible.value;
  const visibilityValue = allLayersVisible.value ? "visible" : "none";

  // Toggle all shared layers
  if (map.getLayer("quadrant-footprint-fill")) {
    map.setLayoutProperty(
      "quadrant-footprint-fill",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-footprint-outline")) {
    map.setLayoutProperty(
      "quadrant-footprint-outline",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-analysis-layer")) {
    map.setLayoutProperty(
      "quadrant-analysis-layer",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-analysis-outline")) {
    map.setLayoutProperty(
      "quadrant-analysis-outline",
      "visibility",
      visibilityValue,
    );
  }
  if (map.getLayer("quadrant-analysis-labels")) {
    map.setLayoutProperty(
      "quadrant-analysis-labels",
      "visibility",
      visibilityValue,
    );
  }

  // Update all visibility states
  items.value.forEach((item: any) => {
    towerVisibility.value[item.id] = allLayersVisible.value;
    footprintVisibility.value[item.id] = allLayersVisible.value;
    quadrantGroupVisibility.value[item.id] = allLayersVisible.value;

    item.quadrants?.forEach((quadrant: any) => {
      const visKey = `${item.id}_q${quadrant.id}`;
      individualQuadrantVisibility.value[visKey] = visibilityValue;
    });
  });
}

// Download quadrant analysis data
async function downloadData(item: any) {
  if (!item || !item.geojson_quadrant) {
    toast.add({
      title: "No Data to Download",
      description: "No quadrant data available for this tower",
      icon: "i-heroicons-exclamation-triangle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
    return;
  }

  isDownloading.value = true;

  try {
    // Prepare payload for single tower
    const payload = {
      tower_id: item.tower_id,
      geojson_quadrant: item.geojson_quadrant,
    };

    // Call API endpoint to get CSV
    const response = await fetch("/panel/analysis/fwa-quadrant/csv", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Get CSV blob from response
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `quadrant-analysis-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.add({
      title: "Download Started",
      description: `Downloading CSV for ${items.value.length} tower(s)`,
      icon: "i-heroicons-arrow-down-tray",
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  } catch (error) {
    console.error("Error downloading data:", error);
    toast.add({
      title: "Download Failed",
      description: "Failed to download CSV file. Please try again.",
      icon: "i-heroicons-x-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  } finally {
    isDownloading.value = false;
  }
}

// Cleanup layers
function cleanupLayers() {
  if (!map) return;

  items.value.forEach((item: any) => {
    const towerId = item.id;

    // Remove footprint layers
    const footprintSourceId = `quadrant_${towerId}_footprint`;
    const footprintFillId = `${footprintSourceId}_fill`;
    const footprintOutlineId = `${footprintSourceId}_outline`;

    if (map.getLayer(footprintFillId)) map.removeLayer(footprintFillId);
    if (map.getLayer(footprintOutlineId)) map.removeLayer(footprintOutlineId);
    if (map.getSource(footprintSourceId)) map.removeSource(footprintSourceId);

    // Remove quadrant layers
    item.quadrants?.forEach((quadrant: any) => {
      const quadrantId = quadrant.id;
      const sourceId = `quadrant_${towerId}_q${quadrantId}`;
      const fillId = `${sourceId}_fill`;
      const outlineId = `${sourceId}_outline`;
      const labelId = `${sourceId}_label`;

      if (map.getLayer(labelId)) map.removeLayer(labelId);
      if (map.getLayer(outlineId)) map.removeLayer(outlineId);
      if (map.getLayer(fillId)) map.removeLayer(fillId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
    });
  });
}

// Watch for data changes and initialize visibility states
watch(
  dataBufferAnalysis,
  (newData, oldData) => {
    if (newData && newData !== oldData) {
      initializeVisibilityStates();
    }
  },
  { immediate: true, deep: true },
);

// Cleanup on unmount
onBeforeUnmount(() => {
  cleanupLayers();
});
</script>

<template>
  <div class="flex flex-col gap-2">
    <!-- Loading State -->
    <div
      v-if="items.length === 0"
      class="h-[calc(100dvh-30rem)] flex flex-col items-center justify-center py-8 gap-2 text-grey-500"
    >
      <UIcon name="i-heroicons-funnel" class="w-8 h-8" />
      <p class="text-xs text-center">
        No Quadrant Analysis Data.<br />Please apply analysis to load data.
      </p>
    </div>

    <!-- Summary Statistics -->
    <div v-else class="flex flex-col gap-3">
      <!-- Analysis Summary Card -->
      <div
        class="bg-gradient-to-br from-blue-50 to-indigo-50 p-4 rounded-xs border border-blue-200 mt-2"
      >
        <div class="flex items-center justify-between mb-3">
          <div class="flex items-center gap-2">
            <div class="p-2 bg-blue-500 rounded-lg">
              <UIcon name="i-heroicons-signal" class="w-5 h-5 text-white" />
            </div>
            <div>
              <p class="text-xs text-grey-600">Quadrant Analysis</p>
              <p class="text-lg font-bold text-grey-900">
                {{ totalTowers }} Towers
              </p>
            </div>
          </div>
          <div class="text-right">
            <p class="text-xs text-grey-600">Buffer Radius</p>
            <p class="text-lg font-bold text-blue-600">{{ bufferRadius }}m</p>
          </div>
        </div>
        <div class="flex items-center gap-2 text-xs text-grey-600">
          <UIcon name="i-heroicons-information-circle" class="w-4 h-4" />
          <span
            >FWA Fixed Wireless Access quadrant-based coverage analysis</span
          >
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="flex justify-end items-center gap-2">
        <UButton
          :icon="allLayersVisible ? 'i-heroicons-eye' : 'i-heroicons-eye-slash'"
          size="xs"
          color="brand"
          variant="solid"
          @click="toggleAllLayersVisibility"
          :ui="{ rounded: 'rounded-xs' }"
        >
          <span class="text-xs">{{
            allLayersVisible ? "Hide All" : "Show All"
          }}</span>
        </UButton>
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
          v-for="(item, index) in items"
          :key="item.id"
          class="group relative bg-white rounded-lg border border-grey-200 hover:border-blue-400 hover:shadow-md transition-all duration-200"
        >
          <!-- Tower Header -->
          <div class="p-3 border-b border-grey-100">
            <div class="flex items-start gap-3">
              <!-- Index Badge -->
              <div
                class="flex-shrink-0 w-7 h-7 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center"
              >
                <span class="text-xs font-bold text-white">{{
                  index + 1
                }}</span>
              </div>

              <!-- Tower Info -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2 mb-2">
                  <UIcon
                    name="i-heroicons-building-office-2"
                    class="w-4 h-4 text-grey-500 flex-shrink-0"
                  />
                  <p class="text-sm font-semibold text-grey-900 truncate">
                    {{ item.label }}
                  </p>
                </div>

                <!-- Tower Properties -->
                <div class="space-y-1.5 text-xs">
                  <div class="flex items-start gap-1">
                    <span class="text-grey-500 font-medium min-w-[20px]"
                      >ID:</span
                    >
                    <span class="text-grey-700 flex-1">{{
                      item.tower_id
                    }}</span>
                  </div>
                  <div
                    v-if="item.properties.code"
                    class="flex items-start gap-2"
                  >
                    <span class="text-grey-500 font-medium min-w-[60px]"
                      >Code:</span
                    >
                    <span class="text-grey-700 flex-1">{{
                      item.properties.code
                    }}</span>
                  </div>
                  <div
                    v-if="item.properties.name"
                    class="flex items-start gap-2"
                  >
                    <span class="text-grey-500 font-medium min-w-[60px]"
                      >Name:</span
                    >
                    <span class="text-grey-700 flex-1">{{
                      item.properties.name
                    }}</span>
                  </div>
                  <div
                    v-if="item.properties.owner"
                    class="flex items-start gap-2"
                  >
                    <span class="text-grey-500 font-medium min-w-[60px]"
                      >Owner:</span
                    >
                    <span class="text-grey-700 flex-1">{{
                      item.properties.owner
                    }}</span>
                  </div>
                </div>
              </div>

              <!-- Tower Actions -->
              <div class="flex">
                <UButton
                  icon="i-heroicons-magnifying-glass-plus"
                  size="xs"
                  color="gray"
                  variant="ghost"
                  @click="zoomToTower(item)"
                  title="Zoom to tower"
                />
                <UButton
                  :icon="
                    towerVisibility[item.id] !== false
                      ? 'clarity:eye-show-line'
                      : 'clarity:eye-hide-line'
                  "
                  size="xs"
                  color="gray"
                  variant="ghost"
                  @click="toggleTowerVisibility(item)"
                  :title="
                    towerVisibility[item.id] !== false
                      ? 'Hide all layers'
                      : 'Show all layers'
                  "
                />
                <UButton
                  icon="i-heroicons-arrow-down-tray"
                  size="xs"
                  color="brand"
                  variant="ghost"
                  :loading="isDownloading"
                  @click="downloadData(item)"
                  :ui="{ rounded: 'rounded-xs' }"
                />
              </div>
            </div>
          </div>

          <!-- Footprint Section -->
          <div class="p-3 border-b border-grey-100 bg-grey-50/30">
            <div class="flex items-center justify-between">
              <div class="flex items-center gap-2">
                <UIcon
                  name="i-heroicons-chart-pie"
                  class="w-4 h-4 text-blue-600"
                />
                <span class="text-xs font-semibold text-grey-800"
                  >Buffer Footprint</span
                >
              </div>
              <div class="flex items-center gap-1">
                <UButton
                  :icon="
                    footprintVisibility[item.id] !== false
                      ? 'clarity:eye-show-line'
                      : 'clarity:eye-hide-line'
                  "
                  size="xs"
                  color="gray"
                  variant="ghost"
                  @click="toggleFootprintVisibility(item)"
                  :title="
                    footprintVisibility[item.id] !== false
                      ? 'Hide footprint'
                      : 'Show footprint'
                  "
                />
              </div>
            </div>
          </div>

          <!-- Quadrant Accordion -->
          <UAccordion
            :items="[
              {
                label: 'Quadrant Details',
                icon: 'i-heroicons-squares-2x2',
                slot: `quadrants-${item.id}`,
                defaultOpen: false,
              },
            ]"
            class="border-0"
          >
            <template #default="{ item: accordionItem, open }">
              <UButton
                color="gray"
                variant="ghost"
                class="w-full p-3 hover:bg-transparent"
              >
                <div class="flex items-center justify-between w-full">
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="accordionItem.icon"
                      class="w-4 h-4 text-grey-600"
                    />
                    <span class="text-xs font-semibold text-grey-800">{{
                      accordionItem.label
                    }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UBadge
                      :label="`${item.quadrants.length} quadrants`"
                      color="blue"
                      size="xs"
                      variant="subtle"
                    />
                    <UButton
                      :icon="
                        quadrantGroupVisibility[item.id] !== false
                          ? 'clarity:eye-show-line'
                          : 'clarity:eye-hide-line'
                      "
                      size="xs"
                      color="gray"
                      variant="ghost"
                      @click.stop="toggleQuadrantGroupVisibility(item)"
                      :title="
                        quadrantGroupVisibility[item.id] !== false
                          ? 'Hide all quadrants'
                          : 'Show all quadrants'
                      "
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

            <template #[`quadrants-${item.id}`]>
              <div class="p-3 pt-0 space-y-2 bg-grey-50/50">
                <div
                  v-for="quadrant in item.quadrants"
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
                    </div>
                  </div>

                  <!-- Quadrant Actions -->
                </div>
              </div>
            </template>
          </UAccordion>

          <!-- Direction Accordion (only for directional quadrant analysis) -->
          <UAccordion
            v-if="item.directions && item.directions.length > 0"
            :items="[
              {
                label: 'Quadrant Direction',
                icon: 'i-heroicons-arrow-trending-up',
                slot: `directions-${item.id}`,
                defaultOpen: true,
              },
            ]"
            class="border-0"
          >
            <template #default="{ item: accordionItem, open }">
              <UButton
                color="gray"
                variant="ghost"
                class="w-full p-3 hover:bg-transparent"
              >
                <div class="flex items-center justify-between w-full">
                  <div class="flex items-center gap-2">
                    <UIcon
                      :name="accordionItem.icon"
                      class="w-4 h-4 text-grey-600"
                    />
                    <span class="text-xs font-semibold text-grey-800">{{
                      accordionItem.label
                    }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <UBadge
                      :label="`${item.directions.length} direction(s)`"
                      color="yellow"
                      size="xs"
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

            <template #[`directions-${item.id}`]>
              <div class="p-3 pt-0 space-y-2 bg-grey-50/50">
                <div
                  v-for="dir in item.directions"
                  :key="dir.id"
                  class="flex items-center gap-3 p-2.5 bg-white rounded-xs border border-grey-200"
                >
                  <div
                    class="w-7 h-7 rounded-xs flex-shrink-0 bg-yellow-400 flex items-center justify-center"
                  >
                    <UIcon
                      name="i-heroicons-arrow-up"
                      class="w-4 h-4 text-white"
                      :style="{ transform: `rotate(${dir.direction}deg)` }"
                    />
                  </div>
                  <div class="flex-1">
                    <p class="text-xs font-semibold text-grey-800">
                      Direction {{ dir.id }}
                    </p>
                    <p class="text-2xs text-grey-600">
                      {{ dir.direction }}° from North
                    </p>
                  </div>
                </div>
              </div>
            </template>
          </UAccordion>
        </div>
      </div>
    </div>
  </div>
</template>
