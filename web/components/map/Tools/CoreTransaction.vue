<script setup lang="ts">
import { ref, onMounted, onUnmounted } from "vue";
import { showHighlightLayer } from "~/utils/index";

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();
const featureStore = useFeature();

// Selected site point state
const selectedSitePoint = ref<{
  coordinates: [number, number];
  id: string;
  ogc_fid: number;
  name?: string;
  code?: string;
  type?: string;
} | null>(null);

// Handle site point selection from map
const handlePointSelection = async (e: any) => {
  const map = mapRefStore.map;
  if (!map) return;

  // Query site_points layers
  const style = map.getStyle();
  const siteLayers = style.layers
    .filter((layer: any) => layer["source-layer"]?.includes("site_points"))
    .map((layer: any) => layer.id);

  const features = map.queryRenderedFeatures(e.point, {
    layers: siteLayers,
  });

  if (features.length > 0) {
    const feature = features[0];
    const coords = feature.geometry.coordinates;
    const ogcFid = feature.properties?.ogc_fid ?? feature.id;

    // Fetch full site point data to get the name
    try {
      const response: { data: any } = await $fetch(
        `/panel/data/site-point-info/${ogcFid}`,
        {
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        }
      );

      // Store selected point data with fetched name
      selectedSitePoint.value = {
        coordinates: [coords[0], coords[1]],
        id: String(feature.id ?? ogcFid),
        ogc_fid: ogcFid,
        name: response.data.name || feature.properties?.name,
        code: response.data.code || feature.properties?.code,
        type:
          feature.properties?.site_point_type_id === 1
            ? "Shelter"
            : feature.properties?.site_point_type_id === 2
            ? "Stasiun"
            : "Tower",
      };

      // Show highlight for selected point
      showHighlightLayer(
        map,
        [
          {
            geom: {
              type: "Point",
              coordinates: [coords[0], coords[1]],
            } as any,
          },
        ],
        "asset-point-highlight",
        true
      );

      toast.add({
        title: "Site Point Selected",
        description: `Selected: ${selectedSitePoint.value?.name || "Unknown"}`,
        icon: "i-heroicons-check-circle",
        ui: {
          background: "bg-white",
          title: "text-grey-800",
          description: "text-grey-800",
        },
      });
    } catch (error) {
      console.error("Error fetching site point data:", error);

      // Fallback to feature properties if API call fails
      selectedSitePoint.value = {
        coordinates: [coords[0], coords[1]],
        id: String(feature.id ?? ogcFid),
        ogc_fid: ogcFid,
        name: feature.properties?.name || `Site ${ogcFid}`,
        code: feature.properties?.code,
        type:
          feature.properties?.site_point_type_id === 1
            ? "Backbone"
            : feature.properties?.site_point_type_id === 2
            ? "Backhaul"
            : "Tower",
      };

      // Show highlight even if API fails
      showHighlightLayer(
        map,
        [
          {
            geom: {
              type: "Point",
              coordinates: [coords[0], coords[1]],
            } as any,
          },
        ],
        "asset-point-highlight",
        true
      );

      toast.add({
        title: "Site Point Selected",
        description: `Selected: ${selectedSitePoint.value?.name || "Unknown"}`,
        icon: "i-heroicons-check-circle",
        ui: {
          background: "bg-white",
          title: "text-grey-800",
          description: "text-grey-800",
        },
      });
    }
  }
};

// Handle Reset button
const handleReset = () => {
  selectedSitePoint.value = null;

  // Clear highlight from map
  const map = mapRefStore.map;
  if (map && map.getSource("highlight")) {
    (map.getSource("highlight") as any).setData({
      type: "FeatureCollection",
      features: [],
    });
  }
};

// Handle Continue button - opens right drawer
const handleContinue = () => {
  if (!selectedSitePoint.value) {
    toast.add({
      title: "No Site Point Selected",
      description: "Please select a site point first",
      icon: "i-heroicons-exclamation-triangle",
      ui: {
        background: "bg-white",
        title: "text-grey-800",
        description: "text-grey-800",
      },
    });
    return;
  }

  // Store the selected site point in the feature store
  featureStore.setSelectedCoreTransactionSite(selectedSitePoint.value);

  // Open the right drawer
  featureStore.setMapInfo("core-transaction");
};

// Enable map click handler and disable popup
onMounted(() => {
  // Enable draw mode to disable popup
  mapRefStore.setDrawMode(true);

  const map = mapRefStore.map;
  if (map) {
    map.on("click", handlePointSelection);

    // Change cursor on hover over site points
    const style = map.getStyle();
    const siteLayers = style.layers
      .filter((layer: any) => layer["source-layer"]?.includes("site_points"))
      .map((layer: any) => layer.id);

    siteLayers.forEach((layerId) => {
      map.on("mouseenter", layerId, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", layerId, () => {
        map.getCanvas().style.cursor = "";
      });
    });
  }
});

// Disable map click handler, cleanup, and re-enable popup
onUnmounted(() => {
  // Disable draw mode to re-enable popup
  mapRefStore.setDrawMode(false);

  const map = mapRefStore.map;
  if (map) {
    map.off("click", handlePointSelection);

    // Clear highlight data
    if (map.getSource("highlight")) {
      (map.getSource("highlight") as any).setData({
        type: "FeatureCollection",
        features: [],
      });
    }
  }
});
</script>

<template>
  <div class="p-2">
    <div class="flex items-center gap-3 mb-2">
      <p class="text-2xs text-[#626264]">
        Click on a site point to manage core transactions
      </p>
    </div>

    <!-- Selected Site Point Info -->
    <div v-if="selectedSitePoint" class="mb-3">
      <label class="text-2xs text-[#626264] mb-2 block"
        >Selected Site Point</label
      >
      <div class="border rounded-xxs p-2 bg-grey-50">
        <div class="space-y-1">
          <p class="text-xs font-medium text-grey-900">
            {{ selectedSitePoint.name || "Unnamed Site Point" }}
          </p>
          <p class="text-2xs text-grey-600">
            Type: {{ selectedSitePoint.type }}
          </p>
          <p class="text-2xs text-grey-600" v-if="selectedSitePoint.code">
            Code: {{ selectedSitePoint.code }}
          </p>
        </div>
      </div>
    </div>

    <!-- Action Buttons -->
    <div class="grid grid-cols-2 gap-2">
      <UButton
        variant="outline"
        color="gray"
        label="Reset"
        block
        @click="handleReset"
        :ui="{ rounded: 'rounded-xxs' }"
      />
      <UButton
        variant="solid"
        color="brand"
        label="Continue"
        block
        :disabled="!selectedSitePoint"
        @click="handleContinue"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>
  </div>
</template>
