<script setup lang="ts">
import { storeToRefs } from "pinia";
import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";
import tokml from "tokml";

const analysisStore = useAnalysisResult();
const { quickRouteInsightData } = storeToRefs(analysisStore);
const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();

const routeData = computed(() => quickRouteInsightData.value?.result);
const analytics = computed(() => routeData.value?.analytics);
const geojsonRoute = computed(() => routeData.value?.geojson_route);
const geojsonPoi = computed(() => routeData.value?.geojson_poi);
const geojsonBuffer = computed(() => routeData.value?.geojson_buffer);
const boundingBox = computed(() => routeData.value?.bounding_box);

// Visibility state
const isDataVisible = ref(true);

// Excel and KML file IDs
const excelFileId = computed(() => quickRouteInsightData.value?.excel);

// Route features list
const routeFeatures = computed(() => {
  return geojsonRoute.value?.features || [];
});

// Remove layers from map
const removeLayersFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;

  // Remove route layers
  if (map.getLayer("route-lines")) map.removeLayer("route-lines");
  if (map.getSource("route-lines")) map.removeSource("route-lines");

  // Remove POI points layers
  if (map.getLayer("route-poi-points")) map.removeLayer("route-poi-points");
  if (map.getSource("route-poi-points")) map.removeSource("route-poi-points");

  // Remove buffer layers
  if (map.getLayer("route-buffer-fill")) map.removeLayer("route-buffer-fill");
  if (map.getLayer("route-buffer-stroke"))
    map.removeLayer("route-buffer-stroke");
  if (map.getSource("route-buffer")) map.removeSource("route-buffer");

  // Remove highlight layer
  if (map.getLayer("route-highlight")) map.removeLayer("route-highlight");
  if (map.getSource("route-highlight")) map.removeSource("route-highlight");
};

// Toggle layer visibility
const toggleVisibility = () => {
  isDataVisible.value = !isDataVisible.value;
  const map = mapRefStore.map;
  if (!map) return;

  const visibility = isDataVisible.value ? "visible" : "none";

  if (map.getLayer("route-buffer-fill")) {
    map.setLayoutProperty("route-buffer-fill", "visibility", visibility);
  }
  if (map.getLayer("route-buffer-stroke")) {
    map.setLayoutProperty("route-buffer-stroke", "visibility", visibility);
  }
  if (map.getLayer("route-lines")) {
    map.setLayoutProperty("route-lines", "visibility", visibility);
  }
  if (map.getLayer("route-poi-points")) {
    map.setLayoutProperty("route-poi-points", "visibility", visibility);
  }
};

// Download Excel file
const isDownloadingExcel = ref(false);
const downloadExcel = async () => {
  if (!excelFileId.value) {
    toast.add({
      title: "No Excel File",
      description: "No Excel file available for this analysis",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-900" },
    });
    return;
  }

  isDownloadingExcel.value = true;
  try {
    const link = document.createElement("a");
    link.href = `/panel/assets/${excelFileId.value}`;
    link.download = `route-insight-${Date.now()}.xlsx`;
    link.target = "_blank";
    link.click();

    toast.add({
      title: "Download Started",
      description: "Excel file is being downloaded",
      icon: "i-heroicons-arrow-down-tray",
      ui: { background: "bg-white", title: "text-grey-900" },
    });
  } catch (error) {
    console.error("Excel download error:", error);
    toast.add({
      title: "Download Failed",
      description: "Failed to download Excel file",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-900" },
    });
  } finally {
    isDownloadingExcel.value = false;
  }
};

// Download KML file
const isDownloadingKML = ref(false);
const downloadKML = async () => {
  if (!geojsonRoute.value) {
    toast.add({
      title: "No Data",
      description: "No route data available to export",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-900" },
    });
    return;
  }

  isDownloadingKML.value = true;
  try {
    const kmlString = tokml(geojsonRoute.value);
    const blob = new Blob([kmlString], {
      type: "application/vnd.google-earth.kml+xml",
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `route-insight-${Date.now()}.kml`;
    link.click();

    URL.revokeObjectURL(url);

    toast.add({
      title: "Download Started",
      description: "KML file is being downloaded",
      icon: "i-heroicons-arrow-down-tray",
      ui: { background: "bg-white", title: "text-grey-900" },
    });
  } catch (error) {
    console.error("KML download error:", error);
    toast.add({
      title: "Download Failed",
      description: "Failed to download KML file",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-900" },
    });
  } finally {
    isDownloadingKML.value = false;
  }
};

// Fly to route feature with highlight
const flyToRoute = (feature: any) => {
  const map = mapRefStore.map;
  if (!map || !feature.geometry?.coordinates) return;

  try {
    // Remove existing highlight layer if any
    if (map.getLayer("route-highlight")) {
      map.removeLayer("route-highlight");
    }
    if (map.getSource("route-highlight")) {
      map.removeSource("route-highlight");
    }

    // Create highlight line
    const highlightGeoJSON = {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: feature.geometry.coordinates,
      },
      properties: feature.properties,
    };

    // Add highlight source and layer
    map.addSource("route-highlight", {
      type: "geojson",
      data: highlightGeoJSON as any,
    });

    map.addLayer({
      id: "route-highlight",
      type: "line",
      source: "route-highlight",
      paint: {
        "line-color": "#F59E0B",
        "line-width": 6,
        "line-opacity": 0.8,
      },
    });

    // Calculate bounds for the route
    const coordinates = feature.geometry.coordinates;
    const bounds = new maplibregl.LngLatBounds();
    coordinates.forEach((coord: number[]) => {
      bounds.extend(coord as [number, number]);
    });

    // Fly to the route
    map.fitBounds(bounds, {
      padding: { top: 100, bottom: 150, left: 350, right: 400 },
      duration: 1500,
    });
  } catch (error) {
    console.error("Error flying to route:", error);
  }
};

// Add layers to map when data is available
watch(
  [geojsonRoute, geojsonPoi, geojsonBuffer, boundingBox],
  ([route, poi, buffer, bbox]) => {
    const mapInstance = mapRefStore.map;
    if (!mapInstance) return;

    // Add buffer polygon
    if (buffer && !mapInstance.getSource("route-buffer")) {
      mapInstance.addSource("route-buffer", {
        type: "geojson",
        data: buffer as any,
      });

      mapInstance.addLayer({
        id: "route-buffer-fill",
        type: "fill",
        source: "route-buffer",
        paint: {
          "fill-color": "#93C5FD",
          "fill-opacity": 0.15,
        },
      });

      mapInstance.addLayer({
        id: "route-buffer-stroke",
        type: "line",
        source: "route-buffer",
        paint: {
          "line-color": "#3B82F6",
          "line-width": 1,
          "line-dasharray": [2, 2],
        },
      });
    }

    // Add route lines
    if (route && !mapInstance.getSource("route-lines")) {
      mapInstance.addSource("route-lines", {
        type: "geojson",
        data: route as any,
      });

      mapInstance.addLayer({
        id: "route-lines",
        type: "line",
        source: "route-lines",
        paint: {
          "line-color": "#EF4444",
          "line-width": 3,
        },
      });
    }

    // Add POI points
    if (poi && !mapInstance.getSource("route-poi-points")) {
      mapInstance.addSource("route-poi-points", {
        type: "geojson",
        data: poi as any,
      });

      mapInstance.addLayer({
        id: "route-poi-points",
        type: "circle",
        source: "route-poi-points",
        paint: {
          "circle-radius": 5,
          "circle-color": [
            "match",
            ["get", "code"],
            "government_office",
            "#F59E0B",
            "hospital",
            "#EF4444",
            "hospital_emergency_room",
            "#DC2626",
            "market",
            "#8B5CF6",
            "medical_services",
            "#EC4899",
            "school",
            "#10B981",
            "#6366F1", // default color
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#FFFFFF",
        },
      });
    }

    // Fly to the analysis area using bounding_box from API
    if (bbox && Array.isArray(bbox) && bbox.length === 4) {
      try {
        mapInstance.fitBounds(
          [
            [bbox[0], bbox[1]], // southwest [minLng, minLat]
            [bbox[2], bbox[3]], // northeast [maxLng, maxLat]
          ] as any,
          {
            padding: { top: 100, bottom: 150, left: 350, right: 100 },
            duration: 1500,
          },
        );
      } catch (error) {
        console.error("Error flying to analysis area:", error);
      }
    }
  },
  { immediate: true },
);

const formatNumber = (num: number) => {
  return new Intl.NumberFormat("en-US").format(num);
};

const formatDistance = (meters: number) => {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  return `${meters.toFixed(0)} m`;
};

// Cleanup on unmount
onUnmounted(() => {
  removeLayersFromMap();
});
</script>

<template>
  <div class="py-3 flex flex-col gap-3">
    <!-- Section 1: Action Buttons -->
    <div class="flex flex-col gap-2">
      <div class="grid grid-cols-3 gap-2">
        <!-- Visible on Map Button -->
        <UButton
          size="xs"
          :color="isDataVisible ? 'gray' : 'gray'"
          variant="outline"
          :ui="{ rounded: 'rounded-xxs', padding: { xs: 'px-2 py-2' } }"
          @click="toggleVisibility"
          :disabled="!routeData"
          block
          class="flex items-center gap-1"
        >
          <component
            :is="isDataVisible ? IcEye : IcEyeCrossed"
            class="w-4 h-4"
          />
          <span class="text-[10px]">{{
            isDataVisible ? "Visible" : "Hidden"
          }}</span>
        </UButton>

        <!-- Download Excel Button -->
        <UButton
          size="xs"
          color="gray"
          variant="outline"
          :ui="{ rounded: 'rounded-xxs', padding: { xs: 'px-2 py-2' } }"
          @click="downloadExcel"
          :disabled="!excelFileId || isDownloadingExcel"
          :loading="isDownloadingExcel"
          block
          class="flex items-center gap-1"
        >
          <UIcon
            v-if="!isDownloadingExcel"
            name="i-heroicons-table-cells"
            class="w-4 h-4"
          />
          <span class="text-[10px]">Download Excel</span>
        </UButton>

        <!-- Download KML Button -->
        <UButton
          size="xs"
          color="gray"
          variant="outline"
          :ui="{ rounded: 'rounded-xxs', padding: { xs: 'px-2 py-2' } }"
          @click="downloadKML"
          :disabled="!geojsonRoute || isDownloadingKML"
          :loading="isDownloadingKML"
          block
          class="flex items-center gap-1"
        >
          <UIcon
            v-if="!isDownloadingKML"
            name="i-heroicons-map"
            class="w-4 h-4"
          />
          <span class="text-[10px]">Download KML</span>
        </UButton>
      </div>
    </div>

    <UDivider />

    <!-- Section 2: Analytics -->
    <div class="flex flex-col gap-2">
      <p class="text-md text-grey-700 font-semibold">Route Insight Analysis</p>

      <!-- Combined Analytics Card -->
      <div class="bg-white border border-grey-200 rounded-xxs p-2 space-y-2">
        <!-- Overview Stats -->
        <div class="grid grid-cols-4 gap-1.5">
          <div class="text-center">
            <p class="text-[8px] text-grey-500 font-medium">Routes</p>
            <p class="text-[11px] font-bold text-red-600">
              {{ formatNumber(analytics?.total_routes || 0) }}
            </p>
          </div>
          <div class="text-center">
            <p class="text-[8px] text-grey-500 font-medium">Cable</p>
            <p class="text-[11px] font-bold text-blue-600">
              {{ formatDistance(analytics?.cable_length || 0) }}
            </p>
          </div>
          <div class="text-center">
            <p class="text-[8px] text-grey-500 font-medium">POI</p>
            <p class="text-[11px] font-bold text-purple-600">
              {{ formatNumber(analytics?.total_poi || 0) }}
            </p>
          </div>
          <div class="text-center">
            <p class="text-[8px] text-grey-500 font-medium">Foot Print</p>
            <p class="text-[11px] font-bold text-green-600">
              {{ formatNumber(analytics?.total_footprint || 0) }}
            </p>
          </div>
        </div>

        <!-- POI by Category (if available) -->
        <div
          v-if="
            analytics?.poi_by_category && analytics.poi_by_category.length > 0
          "
          class="pt-2 border-t border-grey-100"
        >
          <h3 class="text-[9px] font-semibold text-grey-900 mb-1.5">
            POI by Category
          </h3>
          <div class="space-y-1">
            <div
              v-for="item in analytics.poi_by_category"
              :key="item.category"
              class="flex items-center justify-between"
            >
              <div class="flex items-center gap-1">
                <div class="w-2 h-2 rounded-full bg-purple-500"></div>
                <span class="text-[9px] text-grey-700 capitalize">
                  {{ item.category.replace(/_/g, " ") }}
                </span>
              </div>
              <span class="text-[9px] font-semibold text-grey-900">
                {{ formatNumber(item.count) }}
              </span>
            </div>
          </div>
        </div>

        <!-- Footprint by Housing Class -->
        <div class="pt-2 border-t border-grey-100">
          <h3 class="text-[9px] font-semibold text-grey-900 mb-1.5">
            Footprint by Housing Class
          </h3>
          <div class="space-y-1">
            <div
              v-for="(value, key) in analytics?.fp_by_hs_class || {}"
              :key="key"
              class="flex items-center justify-between"
            >
              <span class="text-[9px] text-grey-700 capitalize">
                {{ String(key).replace(/_/g, " ") }}
              </span>
              <span class="text-[9px] font-semibold text-grey-900">
                {{ formatNumber(value) }}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <UDivider />

    <!-- Section 3: Route List -->
    <div class="flex flex-col gap-2">
      <p class="text-md text-grey-700 font-semibold">Route Details</p>

      <div class="space-y-1.5 max-h-[350px] overflow-y-auto">
        <div
          v-for="(feature, index) in routeFeatures"
          :key="feature.properties?.id || index"
          @click="flyToRoute(feature)"
          class="bg-white border border-grey-200 rounded-xxs p-2 hover:border-brand-400 hover:shadow-sm transition-all cursor-pointer"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <!-- Route Header -->
              <div class="flex items-center gap-1.5 mb-1">
                <UIcon
                  name="i-heroicons-arrow-long-right"
                  class="w-3.5 h-3.5 flex-shrink-0 text-red-500"
                />
                <h4 class="text-[10px] font-semibold text-grey-900 truncate">
                  {{ feature.properties?.source_info?.name || "Unknown" }} →
                  {{ feature.properties?.destination_info?.name || "Unknown" }}
                </h4>
              </div>

              <!-- Route Details -->
              <div
                class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[9px] text-grey-600"
              >
                <div class="flex items-center gap-1">
                  <UIcon
                    name="i-heroicons-arrow-trending-up"
                    class="w-2.5 h-2.5"
                  />
                  <span>{{
                    formatDistance(feature.properties?.distance || 0)
                  }}</span>
                </div>
                <div class="flex items-center gap-1">
                  <UIcon name="i-heroicons-home" class="w-2.5 h-2.5" />
                  <span
                    >{{
                      formatNumber(
                        feature.properties?.final_footprint_count || 0,
                      )
                    }}
                    Footprint</span
                  >
                </div>
              </div>

              <!-- Housing Class Breakdown (if available) -->
              <div
                v-if="feature.properties?.fp_by_hs_class"
                class="mt-1.5 pt-1.5 border-t border-grey-100"
              >
                <div class="grid grid-cols-3 gap-1 text-[8px]">
                  <div
                    v-for="(value, key) in feature.properties.fp_by_hs_class"
                    :key="key"
                    class="flex flex-col"
                  >
                    <span class="text-grey-500 capitalize">{{
                      String(key).replace(/_/g, " ")
                    }}</span>
                    <span class="font-semibold text-grey-900">{{
                      formatNumber(value)
                    }}</span>
                  </div>
                </div>
              </div>
            </div>
            <UIcon
              name="i-heroicons-chevron-right"
              class="w-3.5 h-3.5 text-grey-400 flex-shrink-0"
            />
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-if="routeFeatures.length === 0"
          class="flex flex-col items-center justify-center py-6"
        >
          <UIcon name="i-heroicons-map" class="w-10 h-10 text-grey-300 mb-2" />
          <p class="text-[10px] text-grey-600 font-medium">
            No route features found
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
