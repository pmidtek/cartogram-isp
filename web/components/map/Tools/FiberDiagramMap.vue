<script setup lang="ts">
import { Map } from "maplibre-gl";
import type { StyleSpecification, LngLatBoundsLike } from "maplibre-gl";
import { shallowRef, onMounted, onBeforeUnmount, markRaw, watch } from "vue";
import bbox from "@turf/bbox";

const props = defineProps<{
  assetId: string | number;
  connectionData?: any;
  readOnly?: boolean;
}>();

const mapContainer = shallowRef<HTMLElement | null>(null);
const localMap = shallowRef<Map | null>(null);
const isMapReady = ref(false);
const addedLayerIds = ref<string[]>([]);

// Add connection layer to map
const addConnectionLayer = async (geojsonData: any) => {
  if (!localMap.value || !geojsonData) return;

  // Remove previously added layers
  addedLayerIds.value.forEach((id) => {
    if (localMap.value?.getLayer(id)) localMap.value.removeLayer(id);
    if (localMap.value?.getSource(id)) localMap.value.removeSource(id);
  });
  addedLayerIds.value = [];

  // Handle nested geojson structure
  const geojsonObj = geojsonData.geojson || geojsonData;

  // Add each geojson layer
  for (const key of Object.keys(geojsonObj)) {
    const featureCollection = geojsonObj[key];
    if (!featureCollection.features || featureCollection.features.length === 0)
      continue;

    const layerId = `fiber-${key}`;
    const sourceId = `fiber-${key}`;

    addedLayerIds.value.push(layerId);

    // Add source
    localMap.value?.addSource(sourceId, {
      type: "geojson",
      data: featureCollection,
    });

    // Determine geometry type and add appropriate layer
    const firstFeature = featureCollection.features[0];
    const geometryType = firstFeature.geometry.type;

    if (key === "site_point" || geometryType.includes("Point")) {
      // Check if this is an asset layer with icons
      const hasIcons = featureCollection.features.some(
        (f: any) => f.properties?.icon || f.properties?.asset_type_icon,
      );

      if (hasIcons && key === "asset") {
        // Icons are resolved from the map sprite (sprite@2x) via icon-image

        // Add symbol layer for assets with icons
        localMap.value?.addLayer({
          id: layerId,
          type: "symbol",
          source: sourceId,
          layout: {
            "icon-image": [
              "coalesce",
              ["get", "icon"],
              ["get", "asset_type_icon"],
            ],
            "icon-size": 0.3,
            "icon-allow-overlap": true,
            "icon-ignore-placement": false,
            "icon-anchor": "center",
          },
          paint: {
            "icon-opacity": 0.9,
          },
        });
      } else {
        // Use circle layer for site points or assets without icons
        localMap.value?.addLayer({
          id: layerId,
          type: "circle",
          source: sourceId,
          paint: {
            "circle-color": "#EF4444",
            "circle-radius": 8,
            "circle-opacity": 0.8,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 2,
          },
        });
      }
    } else {
      // Line layer
      const lineColors = {
        asset: "#3B82F6",
        asset_spider: "#808080",
        cable: "#10B981",
      };

      const paintProps: any = {
        "line-color": lineColors[key] || "#3B82F6",
        "line-width": key === "asset_spider" ? 2 : 3,
        "line-opacity": 0.8,
      };

      localMap.value?.addLayer({
        id: layerId,
        type: "line",
        source: sourceId,
        paint: paintProps,
      });
    }
  }
};

// Fly to data bounds
const flyToData = (geojsonData: any) => {
  console.log("[FiberDiagramMap] flyToData called", {
    hasMap: !!localMap.value,
    hasData: !!geojsonData,
    isReady: isMapReady.value,
    dataKeys: geojsonData ? Object.keys(geojsonData) : [],
  });

  if (!localMap.value || !geojsonData) {
    console.warn("[FiberDiagramMap] Cannot fly to data - missing map or data");
    return;
  }

  try {
    // Handle nested geojson structure
    const geojsonObj = geojsonData.geojson || geojsonData;

    // Try to get bbox from site_point first, or calculate from all features
    let bounds: any;

    if (geojsonObj.site_point?.bbox) {
      // Use existing bbox array [minLng, minLat, maxLng, maxLat]
      bounds = geojsonObj.site_point.bbox;
    } else {
      // Calculate bbox from all available FeatureCollections
      const allFeatures: any[] = [];
      Object.values(geojsonObj).forEach((featureCollection: any) => {
        if (featureCollection?.features) {
          allFeatures.push(...featureCollection.features);
        }
      });

      console.log("[FiberDiagramMap] Calculating bbox from features:", {
        featureCount: allFeatures.length,
      });

      if (allFeatures.length > 0) {
        const combinedCollection = {
          type: "FeatureCollection",
          features: allFeatures,
        };
        bounds = bbox(combinedCollection);
        console.log("[FiberDiagramMap] Calculated bbox:", bounds);
      }
    }

    if (bounds) {
      console.log("[FiberDiagramMap] Flying to bounds:", bounds);
      localMap.value.fitBounds(bounds as LngLatBoundsLike, {
        padding: { top: 300, bottom: 300, left: 300, right: 300 },
        duration: 3000,
      });
    } else {
      console.warn(
        "[FiberDiagramMap] No bounds calculated - cannot fly to data",
      );
    }
  } catch (error) {
    console.error("[FiberDiagramMap] Error fitting bounds:", error);
  }
};

onMounted(() => {
  if (!mapContainer.value) return;

  const style: StyleSpecification = {
    version: 8,
    sprite: window.location.origin + "/panel/sprites/sprite",
    sources: {
      "basemap-sources": {
        type: "raster",
        tiles: ["https://mt0.google.com/vt/lyrs=m&hl=en&x={x}&y={y}&z={z}"],
        tileSize: 256,
      },
    },
    glyphs: "/font/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "basemap-tiles",
        type: "raster",
        source: "basemap-sources",
        minzoom: 0,
        maxzoom: 24,
      },
    ],
  };

  localMap.value = markRaw(
    new Map({
      container: mapContainer.value,
      style,
      center: [118.0, -2.5], // Center of Indonesia
      zoom: 4,
      maxZoom: 18,
      interactive: !props.readOnly, // Disable interactions in read-only mode
      dragPan: !props.readOnly,
      dragRotate: false,
      scrollZoom: !props.readOnly,
      boxZoom: !props.readOnly,
      doubleClickZoom: !props.readOnly,
      touchZoomRotate: !props.readOnly,
      touchPitch: false,
      keyboard: !props.readOnly,
    }),
  );

  localMap.value.on("load", async () => {
    isMapReady.value = true;

    // Add initial connection data if available
    if (props.connectionData) {
      await addConnectionLayer(props.connectionData);
      localMap.value?.getStyle();
      flyToData(props.connectionData);
    }
  });
});

// Watch for connection data changes
watch(
  () => props.connectionData,
  async (newData) => {
    if (!newData || !localMap.value) return;

    // Wait for map to be ready (with timeout)
    let attempts = 0;
    const maxAttempts = 30; // 3 seconds max wait

    while (!isMapReady.value && attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      attempts++;
    }

    if (isMapReady.value) {
      await addConnectionLayer(newData);
      localMap.value?.getStyle();

      // Add small delay before flying to ensure layers are rendered
      setTimeout(() => {
        flyToData(newData);
      }, 300);
    } else {
      console.warn(
        "[FiberDiagramMap] Map not ready after waiting, skipping fly-to",
      );
    }
  },
  { immediate: true }, // Ensure watcher fires even if data exists on mount
);

onBeforeUnmount(() => {
  if (localMap.value) {
    localMap.value.remove();
    localMap.value = null;
  }
  isMapReady.value = false;
});

defineExpose({ localMap });
</script>

<template>
  <div class="relative w-full h-full">
    <div ref="mapContainer" class="w-full h-full" />

    <!-- Read-only overlay indicator -->
    <div
      v-if="readOnly && isMapReady"
      class="absolute top-2 right-2 z-10 bg-grey-900/80 text-white px-3 py-1.5 rounded-xs text-xs font-medium flex items-center gap-1.5"
    >
      <UIcon name="i-heroicons-eye" class="w-3.5 h-3.5" />
      <span>View Only</span>
    </div>

    <!-- Loading State -->
    <div
      v-if="!isMapReady"
      class="absolute inset-0 flex items-center justify-center bg-grey-100"
    >
      <div class="flex flex-col items-center gap-2">
        <div
          class="w-8 h-8 border-4 border-brand-500 border-t-transparent rounded-full animate-spin"
        />
        <p class="text-sm text-grey-600">Loading map...</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css";
</style>
