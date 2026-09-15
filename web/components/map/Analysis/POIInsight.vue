<script setup lang="ts">
import { storeToRefs } from "pinia";
import type { GeoJSONSource } from "maplibre-gl";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";
import tokml from "tokml";

const analysisStore = useAnalysisResult();
const { qmiResultData, currentAnalysisType } = storeToRefs(analysisStore);
const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();

const poiData = computed(() => qmiResultData.value?.result);
const analytics = computed(() => poiData.value?.analytics);
const geojsonArea = computed(() => poiData.value?.geojson_area);
const geojsonPoi = computed(() => poiData.value?.geojson_poi);
const boundingBox = computed(() => poiData.value?.bounding_box);

// Visibility state
const isDataVisible = ref(true);

// Excel and KML file IDs
const excelFileId = computed(() => qmiResultData.value?.excel);

// POI features list
const poiFeatures = computed(() => {
  return geojsonPoi.value?.features || [];
});

// Remove layers from map
const removeLayersFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;

  // Remove POI area layers
  if (map.getLayer("poi-area-fill")) map.removeLayer("poi-area-fill");
  if (map.getLayer("poi-area-stroke")) map.removeLayer("poi-area-stroke");
  if (map.getSource("poi-area")) map.removeSource("poi-area");

  // Remove POI points layers
  if (map.getLayer("poi-points")) map.removeLayer("poi-points");
  if (map.getSource("poi-points")) map.removeSource("poi-points");

  // Remove highlight layer
  if (map.getLayer("poi-highlight")) map.removeLayer("poi-highlight");
  if (map.getSource("poi-highlight")) map.removeSource("poi-highlight");
};

// Toggle layer visibility
const toggleVisibility = () => {
  isDataVisible.value = !isDataVisible.value;
  const map = mapRefStore.map;
  if (!map) return;

  const visibility = isDataVisible.value ? "visible" : "none";

  if (map.getLayer("poi-area-fill")) {
    map.setLayoutProperty("poi-area-fill", "visibility", visibility);
  }
  if (map.getLayer("poi-area-stroke")) {
    map.setLayoutProperty("poi-area-stroke", "visibility", visibility);
  }
  if (map.getLayer("poi-points")) {
    map.setLayoutProperty("poi-points", "visibility", visibility);
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
    link.download = `poi-insight-${Date.now()}.xlsx`;
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
  if (!geojsonPoi.value) {
    toast.add({
      title: "No Data",
      description: "No POI data available to export",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-900" },
    });
    return;
  }

  isDownloadingKML.value = true;
  try {
    const kmlString = tokml(geojsonPoi.value);
    const blob = new Blob([kmlString], {
      type: "application/vnd.google-earth.kml+xml",
    });
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = `poi-insight-${Date.now()}.kml`;
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

// Fly to POI feature with highlight
const flyToPOI = (feature: any) => {
  const map = mapRefStore.map;
  if (!map || !feature.geometry?.coordinates) return;

  try {
    const [lng, lat] = feature.geometry.coordinates;

    // Remove existing highlight layer if any
    if (map.getLayer("poi-highlight")) {
      map.removeLayer("poi-highlight");
    }
    if (map.getSource("poi-highlight")) {
      map.removeSource("poi-highlight");
    }

    // Create highlight point
    const highlightGeoJSON = {
      type: "Feature",
      geometry: {
        type: "Point",
        coordinates: [lng, lat],
      },
      properties: feature.properties,
    };

    // Add highlight source and layer
    map.addSource("poi-highlight", {
      type: "geojson",
      data: highlightGeoJSON as any,
    });

    map.addLayer({
      id: "poi-highlight",
      type: "circle",
      source: "poi-highlight",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 10, 10, 16, 20],
        "circle-color": getCategoryColor(feature.properties?.category),
        "circle-opacity": 0.3,
        "circle-stroke-width": 1,
        "circle-stroke-color": getCategoryColor(feature.properties?.category),
        "circle-stroke-opacity": 0.5,
      },
    });

    // Fly to the POI
    map.flyTo({
      center: [lng, lat],
      zoom: 17,
      duration: 1500,
    });
  } catch (error) {
    console.error("Error flying to POI:", error);
  }
};

// Add layers to map when data is available
watch(
  [geojsonArea, geojsonPoi, boundingBox],
  ([area, poi, bbox]) => {
    const mapInstance = mapRefStore.map;
    if (!mapInstance || !area || !poi) return;

    // Add POI area polygon
    if (!mapInstance.getSource("poi-area")) {
      mapInstance.addSource("poi-area", {
        type: "geojson",
        data: area as any,
      });

      mapInstance.addLayer({
        id: "poi-area-fill",
        type: "fill",
        source: "poi-area",
        paint: {
          "fill-color": "#3B82F6",
          "fill-opacity": 0.2,
        },
      });

      mapInstance.addLayer({
        id: "poi-area-stroke",
        type: "line",
        source: "poi-area",
        paint: {
          "line-color": "#2563EB",
          "line-width": 2,
        },
      });
    }

    // Add POI points
    if (!mapInstance.getSource("poi-points")) {
      mapInstance.addSource("poi-points", {
        type: "geojson",
        data: poi as any,
      });

      mapInstance.addLayer({
        id: "poi-points",
        type: "circle",
        source: "poi-points",
        paint: {
          "circle-radius": 6,
          "circle-color": [
            "match",
            ["get", "category"],
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
            padding: { top: 100, bottom: 150, left: 350, right: 500 },
            duration: 2000,
            zoom: 14,
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

const getCategoryColor = (category: string) => {
  const colors: Record<string, string> = {
    hospital: "#EF4444",
    school: "#10B981",
    government_office: "#F59E0B",
    market: "#8B5CF6",
    medical_services: "#EC4899",
    hospital_emergency_room: "#DC2626",
  };
  return colors[category] || "#6366F1";
};

// Cleanup on unmount
onUnmounted(() => {
  removeLayersFromMap();
  qmiResultData.value = null;
  currentAnalysisType.value = null;
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
          :disabled="!poiData"
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
          :disabled="!geojsonPoi || isDownloadingKML"
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
      <p class="text-md text-grey-700 font-semibold">POI Insight Analysis</p>

      <!-- Overview Cards -->
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-brand-50 rounded-xxs p-2">
          <p class="text-[10px] text-brand-600 font-medium">Total POI</p>
          <p class="text-sm font-bold text-brand-700 mt-0.5">
            {{ formatNumber(analytics?.total_poi || 0) }}
          </p>
        </div>
        <div class="bg-green-50 rounded-xxs p-2">
          <p class="text-[10px] text-green-600 font-medium">Total Footprint</p>
          <p class="text-sm font-bold text-green-700 mt-0.5">
            {{ formatNumber(analytics?.total_footprint || 0) }}
          </p>
        </div>
      </div>

      <!-- POI by Category -->
      <div class="bg-white border border-grey-200 rounded-xxs p-2">
        <h3 class="text-[10px] font-semibold text-grey-900 mb-2">
          POI by Category
        </h3>
        <div class="space-y-1.5">
          <div
            v-for="item in analytics?.poi_by_category || []"
            :key="item.category"
            class="flex items-center justify-between"
          >
            <div class="flex items-center gap-1.5">
              <div
                class="w-2.5 h-2.5 rounded-full"
                :style="{ backgroundColor: getCategoryColor(item.category) }"
              ></div>
              <span class="text-[10px] text-grey-700 capitalize">
                {{ item.category.replace(/_/g, " ") }}
              </span>
            </div>
            <span class="text-[10px] font-semibold text-grey-900">
              {{ formatNumber(item.count) }}
            </span>
          </div>
        </div>
      </div>

      <!-- Footprint by Housing Class -->
      <div class="bg-white border border-grey-200 rounded-xxs p-2">
        <h3 class="text-[10px] font-semibold text-grey-900 mb-2">
          Footprint by Housing Class
        </h3>
        <div class="space-y-1.5">
          <div
            v-for="(value, key) in analytics?.fp_by_hs_class || {}"
            :key="key"
            class="flex items-center justify-between"
          >
            <span class="text-[10px] text-grey-700 capitalize">
              {{ String(key).replace(/_/g, " ") }}
            </span>
            <span class="text-[10px] font-semibold text-grey-900">
              {{ formatNumber(value) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <UDivider />

    <!-- Section 3: POI List -->
    <div class="flex flex-col gap-2">
      <p class="text-md text-grey-700 font-semibold">POI Details</p>

      <div class="space-y-1.5 max-h-[calc(100vh-44rem)] overflow-y-auto">
        <div
          v-for="(feature, index) in poiFeatures"
          :key="feature.properties?.ogc_fid || index"
          @click="flyToPOI(feature)"
          class="bg-white border border-grey-200 rounded-xxs p-2 hover:border-brand-400 hover:shadow-sm transition-all cursor-pointer"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 mb-1">
                <UIcon
                  name="i-heroicons-map-pin"
                  class="w-3.5 h-3.5 flex-shrink-0"
                  :style="{
                    color: getCategoryColor(feature.properties?.category),
                  }"
                />
                <h4 class="text-[10px] font-semibold text-grey-900 truncate">
                  {{ feature.properties?.poi_name || `POI #${index + 1}` }}
                </h4>
              </div>
              <p class="text-[9px] text-grey-600 capitalize">
                {{
                  feature.properties?.category?.replace(/_/g, " ") || "Unknown"
                }}
              </p>
            </div>
            <UIcon
              name="i-heroicons-chevron-right"
              class="w-3.5 h-3.5 text-grey-400 flex-shrink-0"
            />
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-if="poiFeatures.length === 0"
          class="flex flex-col items-center justify-center py-6"
        >
          <UIcon
            name="i-heroicons-map-pin"
            class="w-10 h-10 text-grey-300 mb-2"
          />
          <p class="text-[10px] text-grey-600 font-medium">
            No POI features found
          </p>
        </div>
      </div>
    </div>
  </div>
</template>
