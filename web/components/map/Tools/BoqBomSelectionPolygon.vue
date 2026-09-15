<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import IcDrawSquare from "~/assets/icons/ic-draw-square.svg";
import IcSpinner from "~/assets/icons/ic-spinner.svg";

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();
const analysisStore = useAnalysisResult();
const featureStore = useFeature();
const toolsStore = useMapTools();
const mapLayerStore = useMapLayer();
const { showCard } = storeToRefs(toolsStore);

// Local state for feature selection
const isAnalyzing = ref(false);

// Interface for feature details
interface FeatureDetail {
  id: number;
  name?: string;
  code?: string;
}

// Selected features by category with details
const selectedFeatures = ref<{
  site_points: FeatureDetail[];
  assets: FeatureDetail[];
  routes: FeatureDetail[];
  cables: FeatureDetail[];
}>({
  site_points: [],
  assets: [],
  routes: [],
  cables: [],
});

// Check if any features are selected
const hasSelectedFeatures = computed(() => {
  return (
    selectedFeatures.value.site_points.length > 0 ||
    selectedFeatures.value.assets.length > 0 ||
    selectedFeatures.value.routes.length > 0 ||
    selectedFeatures.value.cables.length > 0
  );
});

// Get total count of selected features
const totalSelectedCount = computed(() => {
  return (
    selectedFeatures.value.site_points.length +
    selectedFeatures.value.assets.length +
    selectedFeatures.value.routes.length +
    selectedFeatures.value.cables.length
  );
});

// Enable Analyze button when features are selected
const canAnalyze = computed(() => {
  return hasSelectedFeatures.value && !isAnalyzing.value;
});

// Remove all highlight layers
const removeAllHighlights = () => {
  if (!mapRefStore.map) return;

  const highlightLayers = [
    "boq-bom-selected-points",
    "boq-bom-selected-points-stroke",
    "boq-bom-selected-lines",
  ];

  highlightLayers.forEach((layerId) => {
    if (mapRefStore.map!.getLayer(layerId)) {
      mapRefStore.map!.removeLayer(layerId);
    }
  });

  if (mapRefStore.map.getSource("boq-bom-selected-points")) {
    mapRefStore.map.removeSource("boq-bom-selected-points");
  }

  if (mapRefStore.map.getSource("boq-bom-selected-lines")) {
    mapRefStore.map.removeSource("boq-bom-selected-lines");
  }
};

// Update visual highlights for selected features
const updateHighlight = () => {
  if (!mapRefStore.map) return;

  removeAllHighlights();

  if (!hasSelectedFeatures.value) return;

  // Collect all selected features from all layers
  const allSelectedGeoJsonFeatures: any[] = [];

  // Query each layer type
  const layerTypes = ["site_points", "assets", "routes", "cables"];

  layerTypes.forEach((layerName) => {
    const selectedIds =
      selectedFeatures.value[layerName as keyof typeof selectedFeatures.value];
    if (selectedIds.length === 0) return;

    // Query features from this source layer
    const allFeatures = mapRefStore.map!.querySourceFeatures(layerName, {
      sourceLayer: layerName,
    });

    // Filter to only selected features - use feature.id (not properties.id)
    const layerSelectedFeatures = allFeatures
      .filter((f) => f.id && selectedIds.some((s) => s.id === Number(f.id)))
      .map((f) => ({
        type: "Feature" as const,
        geometry: f.geometry,
        properties: { ...f.properties, layerType: layerName },
      }));

    allSelectedGeoJsonFeatures.push(...layerSelectedFeatures);
  });

  if (allSelectedGeoJsonFeatures.length === 0) return;

  // Separate points and lines
  const pointFeatures = allSelectedGeoJsonFeatures.filter((f) =>
    ["site_points", "assets"].includes(f.properties.layerType)
  );
  const lineFeatures = allSelectedGeoJsonFeatures.filter((f) =>
    ["routes", "cables"].includes(f.properties.layerType)
  );

  // Add highlights for points
  if (pointFeatures.length > 0) {
    mapRefStore.map.addSource("boq-bom-selected-points", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: pointFeatures,
      },
    });

    // Add outer glow/stroke layer
    mapRefStore.map.addLayer({
      id: "boq-bom-selected-points-stroke",
      type: "circle",
      source: "boq-bom-selected-points",
      paint: {
        "circle-radius": 12,
        "circle-color": "#3B82F6",
        "circle-opacity": 0.4,
      },
    });

    // Add main highlight layer
    mapRefStore.map.addLayer({
      id: "boq-bom-selected-points",
      type: "circle",
      source: "boq-bom-selected-points",
      paint: {
        "circle-radius": 8,
        "circle-color": "#3B82F6",
        "circle-stroke-width": 3,
        "circle-stroke-color": "#FFFFFF",
      },
    });
  }

  // Add highlights for lines
  if (lineFeatures.length > 0) {
    mapRefStore.map.addSource("boq-bom-selected-lines", {
      type: "geojson",
      data: {
        type: "FeatureCollection",
        features: lineFeatures,
      },
    });

    mapRefStore.map.addLayer({
      id: "boq-bom-selected-lines",
      type: "line",
      source: "boq-bom-selected-lines",
      paint: {
        "line-color": "#3B82F6",
        "line-width": 5,
        "line-opacity": 0.9,
      },
    });
  }
};

// Handle feature click on map - select/deselect features
const handleMapClick = (e: any) => {
  if (!mapRefStore.map) return;

  // Define relevant source layers for BOQ/BOM
  const relevantSourceLayers = ["site_points", "assets", "routes", "cables"];

  // Get all active layers that might be clickable (similar to Popup.vue approach)
  const filterLayers = mapLayerStore.groupedActiveLayers
    ?.map(({ layerLists }) => layerLists)
    .flat();

  // If no active layers, return early
  if (!filterLayers || filterLayers.length === 0) return;

  // Query features at click point
  const features = mapRefStore.map.queryRenderedFeatures(e.point, {
    layers: filterLayers.map(({ layer_id }) => layer_id),
  });

  // Filter to only relevant features (site_points, assets, routes, cables)
  const relevantFeatures = features.filter(
    (f) => f.id && f.sourceLayer && relevantSourceLayers.includes(f.sourceLayer)
  );

  if (relevantFeatures.length === 0) return;

  // Determine what type of feature was clicked (priority: points > lines)
  // Points (site_points, assets) take precedence over lines (routes, cables)
  const pointFeatures = relevantFeatures.filter(
    (f) => f.sourceLayer && ["site_points", "assets"].includes(f.sourceLayer)
  );
  const lineFeatures = relevantFeatures.filter(
    (f) => f.sourceLayer && ["routes", "cables"].includes(f.sourceLayer)
  );

  let featuresToProcess: typeof relevantFeatures = [];

  if (pointFeatures.length > 0) {
    // If user clicked on a point, only select that point (ignore overlapping lines)
    featuresToProcess = [pointFeatures[0]];
  } else if (lineFeatures.length > 0) {
    // If user clicked on a line, select all overlapping lines (routes + cables)
    featuresToProcess = lineFeatures;
  }

  // Group features by category and check their selection status
  const featuresByCategory: {
    [K in keyof typeof selectedFeatures.value]?: Array<{
      id: number;
      name?: string;
      code?: string;
      isSelected: boolean;
    }>;
  } = {};

  featuresToProcess.forEach((feature) => {
    const category = feature.sourceLayer as keyof typeof selectedFeatures.value;
    const numericId = Number(feature.id);
    const currentFeatures = selectedFeatures.value[category];
    const isSelected = currentFeatures.some((f) => f.id === numericId);

    if (!featuresByCategory[category]) {
      featuresByCategory[category] = [];
    }

    featuresByCategory[category]!.push({
      id: numericId,
      name: feature.properties?.name,
      code: feature.properties?.code,
      isSelected,
    });
  });

  // Determine action: if any feature is NOT selected, select all. Otherwise, deselect all.
  const hasUnselected = Object.values(featuresByCategory).some((features) =>
    features?.some((f) => !f.isSelected)
  );

  const action = hasUnselected ? "select" : "deselect";
  let totalProcessed = 0;
  const processedByCategory: { [key: string]: number } = {};

  // Process each category
  Object.entries(featuresByCategory).forEach(([category, features]) => {
    const cat = category as keyof typeof selectedFeatures.value;
    let currentFeatures = selectedFeatures.value[cat];

    features?.forEach((feature) => {
      if (action === "select" && !feature.isSelected) {
        // Add to selection
        const featureDetail: FeatureDetail = {
          id: feature.id,
          name: feature.name,
          code: feature.code,
        };
        currentFeatures = [...currentFeatures, featureDetail];
        totalProcessed++;
        processedByCategory[category] =
          (processedByCategory[category] || 0) + 1;
      } else if (action === "deselect" && feature.isSelected) {
        // Remove from selection
        currentFeatures = currentFeatures.filter((f) => f.id !== feature.id);
        totalProcessed++;
        processedByCategory[category] =
          (processedByCategory[category] || 0) + 1;
      }
    });

    selectedFeatures.value[cat] = currentFeatures;
  });

  // Show toast notification
  if (totalProcessed > 0) {
    const categoryLabels = Object.entries(processedByCategory)
      .map(([cat, count]) => `${count} ${cat.replace("_", " ")}`)
      .join(", ");

    // Update visual highlight
    updateHighlight();
  }
};

// Setup map event listeners on mount
onMounted(() => {
  if (mapRefStore.map) {
    // Add click handler to map
    mapRefStore.map.on("click", handleMapClick);

    // Change cursor on hover for all active layers
    const filterLayers = mapLayerStore.groupedActiveLayers
      ?.map(({ layerLists }) => layerLists)
      .flat();

    if (filterLayers && filterLayers.length > 0) {
      filterLayers.forEach((layer) => {
        const layerId = layer.layer_id;
        if (mapRefStore.map!.getLayer(layerId)) {
          mapRefStore.map!.on("mouseenter", layerId, () => {
            if (mapRefStore.map) {
              mapRefStore.map.getCanvas().style.cursor = "pointer";
            }
          });
          mapRefStore.map!.on("mouseleave", layerId, () => {
            if (mapRefStore.map) {
              mapRefStore.map.getCanvas().style.cursor = "";
            }
          });
        }
      });
    }
  }
});

// Handle BOQ/BOM analysis
const handleAnalyze = async () => {
  if (!hasSelectedFeatures.value) {
    toast.add({
      title: "Error",
      description: "Please select at least one feature",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
    return;
  }

  isAnalyzing.value = true;

  try {
    // Call backend API for BOQ/BOM analysis
    const response = await $fetch<any>("/panel/boq-bom/generate-boq-bom", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: {
        generate_type: "selection",
        is_price_default: analysisStore.isPriceDefault,
        site_points: selectedFeatures.value.site_points.map((f) => f.id),
        assets: selectedFeatures.value.assets.map((f) => f.id),
        routes: selectedFeatures.value.routes.map((f) => f.id),
        cables: selectedFeatures.value.cables.map((f) => f.id),
      },
    });

    if (response.data) {
      // Store results in analysis store
      analysisStore.setBoqBomAnalysisData(response.data);
      analysisStore.setCurrentAnalysisType("boq_bom_analysis");

      // Open analysis panel
      featureStore.setMapInfo("analytic");

      // Close tool card
      showCard.value = false;
      analysisStore.clearBoqBomToolActive();

      toast.add({
        title: "Analysis Complete",
        description: "BOQ/BOM calculation completed successfully",
        color: "green",
        icon: "i-heroicons-chart-bar",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });
    }
  } catch (error: any) {
    console.error("Analysis error:", error);
    toast.add({
      title: "Analysis Failed",
      description:
        error.message || "Failed to analyze BOQ/BOM. Please try again.",
      color: "red",
      icon: "i-heroicons-x-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isAnalyzing.value = false;
  }
};

// Reset functionality
const handleReset = () => {
  selectedFeatures.value = {
    site_points: [],
    assets: [],
    routes: [],
    cables: [],
  };

  // Remove highlights from map
  removeAllHighlights();

  toast.add({
    title: "Reset Complete",
    description: "Selection has been cleared",
    icon: "i-heroicons-arrow-path",
    ui: {
      background: "bg-white",
      title: "text-gray-900 text-md font-semibold",
      description: "text-gray-500",
      icon: "text-blue-500",
    },
  });
};

// Close tool
const handleClose = () => {
  handleReset();
  showCard.value = false;
  analysisStore.clearBoqBomToolActive();
};

// Cleanup on unmount
onUnmounted(() => {
  // Remove highlights from map
  removeAllHighlights();

  // Remove event listeners
  if (mapRefStore.map) {
    mapRefStore.map.off("click", handleMapClick);
  }
});
</script>

<template>
  <MapToolsCard
    :active="true"
    label="Select Features for BOQ/BOM"
    :icon="IcDrawSquare"
    :onClose="handleClose"
  >
    <div class="p-3 space-y-3">
      <!-- Instructions -->
      <div class="p-2 bg-blue-50 border border-blue-200 rounded-xs">
        <div class="flex gap-2">
          <UIcon
            name="i-heroicons-information-circle"
            class="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5"
          />
          <p class="text-2xs text-blue-700">
            Click on any site points, assets, routes, or cables on the map to
            select them for analysis. Click selected features again to deselect.
          </p>
        </div>
      </div>

      <!-- Click to Select Instruction -->
      <div
        v-if="!hasSelectedFeatures"
        class="p-2 bg-amber-50 border border-amber-200 rounded-xs"
      >
        <div class="flex items-center gap-2">
          <UIcon
            name="i-heroicons-cursor-arrow-rays"
            class="w-4 h-4 text-amber-600"
          />
          <p class="text-2xs text-amber-700 font-medium">
            Click features on the map to start selecting
          </p>
        </div>
      </div>

      <!-- Selected Features Summary -->
      <div v-if="hasSelectedFeatures" class="space-y-2">
        <div class="p-2 bg-green-50 border border-green-200 rounded-xs">
          <div class="flex items-center gap-2 mb-2">
            <UIcon
              name="i-heroicons-check-circle"
              class="w-4 h-4 text-green-600"
            />
            <span class="text-xs font-semibold text-green-700"
              >{{ totalSelectedCount }} Feature(s) Selected</span
            >
          </div>

          <div class="space-y-2 max-h-48 overflow-y-auto">
            <!-- Site Points -->
            <div
              v-if="selectedFeatures.site_points.length > 0"
              class="space-y-1"
            >
              <div class="text-2xs font-semibold text-grey-700">
                Site Points ({{ selectedFeatures.site_points.length }}):
              </div>
              <div class="pl-2 space-y-0.5">
                <div
                  v-for="feature in selectedFeatures.site_points"
                  :key="feature.id"
                  class="text-2xs text-grey-600"
                >
                  • {{ feature.name || feature.code || `ID: ${feature.id}` }}
                </div>
              </div>
            </div>

            <!-- Assets -->
            <div v-if="selectedFeatures.assets.length > 0" class="space-y-1">
              <div class="text-2xs font-semibold text-grey-700">
                Assets ({{ selectedFeatures.assets.length }}):
              </div>
              <div class="pl-2 space-y-0.5">
                <div
                  v-for="feature in selectedFeatures.assets"
                  :key="feature.id"
                  class="text-2xs text-grey-600"
                >
                  • {{ feature.name || feature.code || `ID: ${feature.id}` }}
                </div>
              </div>
            </div>

            <!-- Routes -->
            <div v-if="selectedFeatures.routes.length > 0" class="space-y-1">
              <div class="text-2xs font-semibold text-grey-700">
                Routes ({{ selectedFeatures.routes.length }}):
              </div>
              <div class="pl-2 space-y-0.5">
                <div
                  v-for="feature in selectedFeatures.routes"
                  :key="feature.id"
                  class="text-2xs text-grey-600"
                >
                  • {{ feature.name || feature.code || `ID: ${feature.id}` }}
                </div>
              </div>
            </div>

            <!-- Cables -->
            <div v-if="selectedFeatures.cables.length > 0" class="space-y-1">
              <div class="text-2xs font-semibold text-grey-700">
                Cables ({{ selectedFeatures.cables.length }}):
              </div>
              <div class="pl-2 space-y-0.5">
                <div
                  v-for="feature in selectedFeatures.cables"
                  :key="feature.id"
                  class="text-2xs text-grey-600"
                >
                  • {{ feature.name || feature.code || `ID: ${feature.id}` }}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div class="pt-2">
        <!-- Reset and Analyze Buttons - 2 Column Grid -->
        <div class="grid grid-cols-2 gap-2">
          <!-- Reset Button -->
          <button
            @click="handleReset"
            :disabled="!hasSelectedFeatures"
            class="flex items-center justify-center gap-2 px-3 py-2 rounded-xs text-xs font-semibold bg-grey-100 text-grey-700 hover:bg-grey-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <UIcon name="i-heroicons-arrow-path" class="w-3 h-3" />
            <span>Reset</span>
          </button>

          <!-- Analyze Button -->
          <button
            @click="handleAnalyze"
            :disabled="!canAnalyze"
            :class="[
              'flex items-center justify-center gap-2 px-3 py-2 rounded-xs text-xs font-semibold transition-all',
              canAnalyze
                ? 'bg-brand-500 text-white hover:bg-brand-600'
                : 'bg-grey-200 text-grey-400 cursor-not-allowed',
            ]"
          >
            <IcSpinner v-if="isAnalyzing" class="w-3 h-3 animate-spin" />
            <UIcon v-else name="i-heroicons-chart-bar" class="w-3 h-3" />
            <span>{{ isAnalyzing ? "Analyzing..." : "Analyze" }}</span>
          </button>
        </div>
      </div>
    </div>
  </MapToolsCard>
</template>
