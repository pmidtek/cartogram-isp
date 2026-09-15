<script setup lang="ts">
import { computed, ref, watch } from "vue";

const analysisStore = useAnalysisResult();
const mapRefStore = useMapRef();
const toast = useToast();

// Modal state
const isDetailModalOpen = ref(false);

// Active tab for the side panel
const activeTab = ref<"detail" | "summary">("detail");

// Get data from store
const boqBomData = computed(() => analysisStore.boqBomAnalysisData);
const routeGeometry = computed(() => analysisStore.boqBomRouteGeometry);
const pointsData = computed(() => analysisStore.boqBomPointsData);

// Layer visibility toggle
const isLayersVisible = ref(true);

// Watch for visibility changes and update map layers
watch(isLayersVisible, (newValue) => {
  if (!mapRefStore.map) return;
  const layerId = "boq-bom-route-layer";

  try {
    if (mapRefStore.map.getLayer(layerId)) {
      mapRefStore.map.setLayoutProperty(
        layerId,
        "visibility",
        newValue ? "visible" : "none",
      );
    }
  } catch (error) {
    console.warn("Failed to toggle route visibility:", error);
  }
});

// Format number helper
const formatNumber = (value: number) => {
  return new Intl.NumberFormat("en-US").format(value);
};

// Humanize a snake_case key — e.g. "cost_service_homepass" → "Cost Service Homepass".
const humanizeKey = (key: string) =>
  key
    .replace(/_/g, " ")
    .replace(/\b(\w)/g, (m) => m.toUpperCase())
    .replace(/\bCpa\b/i, "CPA")
    .replace(/\bJia\b/i, "JIA")
    .replace(/\bLda\b/i, "LDA");

// A summary field is a currency value when its key references cost / price / cpa / a material- or service-amount.
const isCurrencyKey = (key: string) => {
  const k = key.toLowerCase();
  if (k.startsWith("cost_") || k === "total_cost") return true;
  if (k.startsWith("cpa_") || k === "total_cpa") return true;
  if (k.startsWith("service_")) return true;
  if (k.startsWith("material_")) return true;
  return false;
};

const formatSummaryValue = (key: string, value: any): string => {
  const num = Number(value) || 0;
  if (isCurrencyKey(key)) return `IDR ${formatNumber(num)}`;
  return formatNumber(num);
};

// Build a flat [{ label, value }] list per category for the executive summary.
const summaryEntriesOf = (category: any): { label: string; value: string }[] => {
  const entries: { label: string; value: string }[] = [];
  // material has both `description` (counts) and `summary` (mostly money).
  const desc = category?.description as Record<string, any> | undefined;
  if (desc) {
    Object.entries(desc).forEach(([k, v]) => {
      entries.push({ label: humanizeKey(k), value: formatNumber(Number(v) || 0) });
    });
  }
  const summary = category?.summary as Record<string, any> | undefined;
  if (summary) {
    Object.entries(summary).forEach(([k, v]) => {
      entries.push({ label: humanizeKey(k), value: formatSummaryValue(k, v) });
    });
  }
  return entries;
};

// Get BOQ data — API returns combined BOQ/BOM totals under `boq`.
const boqData = computed(() => boqBomData.value?.boq || null);

// Sub-categories of BOQ from the new response (material / homepass / homeconnect).
// Each has { group_name, group_total, groups: [{ name, rows, total }], summary }.
const boqCategories = computed(() => {
  if (!boqData.value) return [] as any[];
  const order = ["material", "homepass", "homeconnect"];
  return order
    .map((key) => {
      const cat = (boqData.value as any)[key];
      if (!cat) return null;
      return { key, ...cat };
    })
    .filter(Boolean) as any[];
});

// Total cost = sum of group_total across categories (fallback to material summary).
const totalCost = computed(() => {
  if (!boqData.value) return 0;
  const fromMaterial = boqData.value?.material?.summary?.total_cost;
  if (typeof fromMaterial === "number") return fromMaterial;
  return boqCategories.value.reduce(
    (acc, c: any) => acc + (Number(c?.group_total) || 0),
    0,
  );
});

// Calculate route distance
const routeDistance = computed(() => {
  if (!routeGeometry.value?.features?.[0]?.properties?.summary?.distance)
    return 0;
  return routeGeometry.value.features[0].properties.summary.distance;
});

// Number of points
const pointsCount = computed(() => pointsData.value?.length || 0);

// Check if we came from FTTH analysis
const canGoBackToFtth = computed(() => !!analysisStore.ftthAnalysisData);

const handleBackToFtth = () => {
  analysisStore.setCurrentAnalysisType("ftth_analysis");
};

// Action handlers
const handleDelete = () => {
  toast.add({
    title: "Delete Confirmation",
    description: "Are you sure you want to delete this analysis?",
    icon: "i-heroicons-trash",
    ui: {
      background: "bg-white",
      title: "text-gray-900 text-md font-semibold",
      description: "text-gray-500",
      icon: "text-blue-500",
    },
  });
};

const handleDownload = () => {
  toast.add({
    title: "Download Started",
    description: "Downloading BOQ/BOM report...",
    icon: "i-heroicons-arrow-down-tray",
    ui: {
      background: "bg-white",
      title: "text-gray-900 text-md font-semibold",
      description: "text-gray-500",
      icon: "text-blue-500",
    },
  });
};

const handleView = () => {
  isLayersVisible.value = !isLayersVisible.value;
};

const handleShare = () => {
  toast.add({
    title: "Share",
    description: "Sharing BOQ/BOM analysis",
    icon: "i-heroicons-share",
    ui: {
      background: "bg-white",
      title: "text-gray-900 text-md font-semibold",
      description: "text-gray-500",
      icon: "text-blue-500",
    },
  });
};

const handleViewDetailForm = () => {
  isDetailModalOpen.value = true;
};

// Clear analysis and remove layers
const handleClearAnalysis = () => {
  // Remove layers from map
  if (mapRefStore.map) {
    const layerId = "boq-bom-route-layer";
    const sourceId = "boq-bom-route";

    try {
      if (mapRefStore.map.getLayer(layerId)) {
        mapRefStore.map.removeLayer(layerId);
      }
      if (mapRefStore.map.getSource(sourceId)) {
        mapRefStore.map.removeSource(sourceId);
      }
    } catch (error) {
      console.warn("Failed to remove layers:", error);
    }
  }

  // Clear store data
  analysisStore.clearBoqBomAnalysisData();
  analysisStore.clearCurrentAnalysisType();

  toast.add({
    title: "Analysis Cleared",
    description: "BOQ/BOM analysis has been cleared",
    icon: "i-heroicons-trash",
    ui: {
      background: "bg-white",
      title: "text-gray-900 text-md font-semibold",
      description: "text-gray-500",
      icon: "text-blue-500",
    },
  });
};
</script>

<template>
  <div v-if="!boqBomData" class="flex flex-col items-center justify-center p-6">
    <div
      class="w-16 h-16 mx-auto bg-grey-100 rounded-full flex items-center justify-center mb-3"
    >
      <svg
        class="w-8 h-8 text-grey-400"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          stroke-width="2"
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
    </div>
    <p class="text-xs text-grey-600">No BOQ/BOM results available</p>
  </div>

  <div v-else class="space-y-2">
    <!-- Header Card -->
    <div class="bg-white rounded-xs border border-grey-200">
      <div class="p-3 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <button
            v-if="canGoBackToFtth"
            @click="handleBackToFtth"
            class="text-grey-500 hover:text-grey-900 transition-colors"
            title="Back to Network Summary"
          >
            <UIcon name="i-heroicons-arrow-left" class="w-4 h-4" />
          </button>
          <div class="flex flex-col">
            <p class="text-sm font-medium text-grey-900">
              BOQ/BOM Analysis Result
            </p>
            <p class="text-xs text-grey-500">
              {{ boqBomData.analysis_type || "Draw Polygon" }}
            </p>
          </div>
        </div>

        <div class="flex items-center gap-1">
          <!-- Delete Button -->
          <UButton
            icon="i-heroicons-trash-20-solid"
            size="2xs"
            color="red"
            variant="ghost"
            :ui="{ padding: { '2xs': 'p-1' } }"
            @click="handleClearAnalysis"
            title="Clear Analysis"
          />

          <!-- Download Button -->
          <UButton
            icon="i-heroicons-arrow-down-tray-20-solid"
            size="2xs"
            color="gray"
            variant="ghost"
            :ui="{ padding: { '2xs': 'p-1' } }"
            @click="handleDownload"
            title="Download"
          />

          <!-- View Button -->
          <UButton
            :icon="
              isLayersVisible
                ? 'i-heroicons-eye-20-solid'
                : 'i-heroicons-eye-slash-20-solid'
            "
            size="2xs"
            :color="isLayersVisible ? 'gray' : 'gray'"
            variant="ghost"
            :ui="{ padding: { '2xs': 'p-1' } }"
            @click="handleView"
            :title="isLayersVisible ? 'Hide Layers' : 'Show Layers'"
          />
        </div>
      </div>
    </div>

    <!-- Results Content -->
    <div
      class="bg-white h-[calc(100vh-21.5rem)] rounded-xs border border-grey-200 flex flex-col"
    >
      <!-- Tab Switcher -->
      <div class="flex gap-2 border-b border-grey-200 px-3 pt-2">
        <button
          @click="activeTab = 'detail'"
          :class="[
            'px-3 py-2 text-xs font-medium transition-colors relative',
            activeTab === 'detail'
              ? 'text-brand-600'
              : 'text-grey-600 hover:text-grey-900',
          ]"
        >
          Detail
          <div
            v-if="activeTab === 'detail'"
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600"
          />
        </button>
        <button
          @click="activeTab = 'summary'"
          :class="[
            'px-3 py-2 text-xs font-medium transition-colors relative',
            activeTab === 'summary'
              ? 'text-brand-600'
              : 'text-grey-600 hover:text-grey-900',
          ]"
        >
          Executive Summary
          <div
            v-if="activeTab === 'summary'"
            class="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600"
          />
        </button>
      </div>

      <!-- Scrollable Content Area -->
      <div
        v-if="activeTab === 'detail'"
        class="overflow-y-auto flex-1 p-3 space-y-3"
      >
        <!-- Total Cost Card (BOQ Only) -->
        <div v-if="boqData" class="bg-brand-50 rounded-xs p-3">
          <div class="flex items-center justify-between mb-2">
            <span class="text-xs text-grey-600"
              >Total Estimated Project Cost</span
            >
            <UButton
              icon="i-heroicons-information-circle-20-solid"
              size="2xs"
              color="gray"
              variant="ghost"
              :ui="{ padding: { '2xs': 'p-0' } }"
            />
          </div>
          <p class="text-lg font-semibold text-grey-900">
            IDR {{ formatNumber(totalCost) }}
          </p>
        </div>

        <!-- BOQ/BOM Combined Result -->
        <div v-if="boqData" class="space-y-3">
          <p class="text-sm font-semibold text-grey-900">Estimated BOQ / BOM</p>

          <div
            v-for="category in boqCategories"
            :key="category.key"
            class="space-y-2"
          >
            <div class="flex items-center justify-between">
              <p class="text-xs font-semibold text-grey-900">
                {{ category.group_name }}
              </p>
              <p class="text-xs font-medium text-grey-700">
                IDR {{ formatNumber(category.group_total || 0) }}
              </p>
            </div>

            <div
              v-for="group in category.groups"
              :key="`${category.key}-${group.name}`"
              class="border border-grey-200 rounded-xs overflow-hidden"
            >
              <div
                class="px-3 py-2 bg-grey-100 flex items-center justify-between"
              >
                <p class="text-xs font-semibold text-grey-900">
                  {{ group.name }}
                </p>
                <p class="text-[11px] text-grey-700">
                  IDR {{ formatNumber(group.total || 0) }}
                </p>
              </div>

              <!-- Table Header -->
              <div
                class="grid grid-cols-[1.5fr_0.8fr_0.6fr_1.2fr_1.2fr] bg-grey-200 border-b border-grey-300"
              >
                <div class="px-3 py-2.5 text-xs font-semibold text-grey-900">
                  Item
                </div>
                <div
                  class="px-1 py-2 text-xs font-semibold text-grey-900 text-center"
                >
                  Quantity
                </div>
                <div
                  class="px-3 py-2.5 text-xs font-semibold text-grey-900 text-center"
                >
                  Unit
                </div>
                <div
                  class="px-3 py-2.5 text-xs font-semibold text-grey-900 text-center"
                >
                  Unit Cost (IDR)
                </div>
                <div
                  class="px-3 py-2.5 text-xs font-semibold text-grey-900 text-center"
                >
                  Total Cost (IDR)
                </div>
              </div>

              <!-- Table Body -->
              <div class="divide-y divide-grey-200 bg-white">
                <div
                  v-for="(row, index) in group.rows"
                  :key="`${category.key}-${group.name}-${row.code}-${index}`"
                  class="grid grid-cols-[1.5fr_0.8fr_0.6fr_1.2fr_1.2fr] hover:bg-grey-50 transition-colors"
                >
                  <div class="px-3 py-2.5 text-xs text-grey-900">
                    {{ row.description || row.code }} <br />
                    <span class="text-grey-700 text-[10px]">
                      {{ row.code }}
                    </span>
                  </div>
                  <div
                    class="px-3 py-2.5 text-xs text-grey-900 text-center flex items-center justify-center"
                  >
                    {{ formatNumber(Number(row.qty) || 0) }}
                  </div>
                  <div
                    class="px-3 py-2.5 text-xs text-grey-700 text-center flex items-center justify-center"
                  >
                    {{ row.uom }}
                  </div>
                  <div
                    class="px-3 py-2.5 text-xs text-grey-900 text-right flex items-center justify-end"
                  >
                    IDR {{ formatNumber(Number(row.price) || 0) }}
                  </div>
                  <div
                    class="px-3 py-2.5 text-xs text-grey-900 text-right font-medium flex items-center justify-end"
                  >
                    IDR {{ formatNumber(Number(row.total) || 0) }}
                  </div>
                </div>
                <div
                  v-if="!group.rows || group.rows.length === 0"
                  class="px-3 py-3 text-[11px] text-grey-500 text-center"
                >
                  No items
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Executive Summary tab -->
      <div
        v-else
        class="overflow-y-auto flex-1 p-3 space-y-3"
      >
        <div v-if="boqData" class="bg-brand-50 rounded-xs p-3">
          <span class="text-xs text-grey-600">Total Estimated Project Cost</span>
          <p class="text-lg font-semibold text-grey-900">
            IDR {{ formatNumber(totalCost) }}
          </p>
        </div>

        <div
          v-for="category in boqCategories"
          :key="`summary-${category.key}`"
          class="border border-grey-200 rounded-xs overflow-hidden"
        >
          <div
            class="px-3 py-2 bg-grey-100 flex items-center justify-between"
          >
            <p class="text-xs font-semibold text-grey-900">
              {{ category.group_name }}
            </p>
            <p class="text-[11px] font-medium text-grey-700">
              IDR {{ formatNumber(category.group_total || 0) }}
            </p>
          </div>
          <div class="divide-y divide-grey-200 bg-white">
            <div
              v-for="(entry, idx) in summaryEntriesOf(category)"
              :key="`${category.key}-summary-${idx}`"
              class="px-3 py-2 flex items-center justify-between text-xs"
            >
              <span class="text-grey-600">{{ entry.label }}</span>
              <span class="text-grey-900 font-medium">{{ entry.value }}</span>
            </div>
            <div
              v-if="summaryEntriesOf(category).length === 0"
              class="px-3 py-3 text-[11px] text-grey-500 text-center"
            >
              No summary data
            </div>
          </div>
        </div>
      </div>

      <!-- Sticky Button at Bottom -->
      <div class="p-3">
        <UButton
          block
          color="brand"
          variant="solid"
          size="lg"
          label="View Detail Form"
          :ui="{ rounded: 'rounded-xs' }"
          @click="handleViewDetailForm"
        />
      </div>
    </div>

    <!-- Detail Modal -->
    <MapAnalysisBoqBomDetailModal
      v-model="isDetailModalOpen"
      :boq-bom-data="boqBomData"
      :is-price-default="analysisStore.isPriceDefault"
      :route-distance="routeDistance"
      :points-count="pointsCount"
      :analysis-type="boqBomData?.analysis_type"
    />
  </div>
</template>
