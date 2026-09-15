<script lang="ts" setup>
import { onUnmounted, watch, ref, watchEffect } from "vue";
import type { GeoJSONSource, MapLayerTouchEvent } from "maplibre-gl";
import { storeToRefs } from "pinia";
import buffer from "@turf/buffer";
import IcSpinner from "~/assets/icons/ic-spinner.svg";
import {
  featureCollection,
  point,
  lineString,
  type Feature,
  type Point,
  type LineString,
  type MultiLineString,
} from "@turf/helpers";
import { useQueryClient } from "@tanstack/vue-query";

const queryClient = useQueryClient();
const mapStore = useMapRef();
const { map } = storeToRefs(mapStore);
const mapLayerStore = useMapLayer();
const toast = useToast();
const selectedPoints = ref<Feature<Point>[]>([]);
const tspLineString = ref<Feature<LineString> | null>(null);
const isLoading = ref(false);
const isFetching = ref<boolean>(false);

const digit = ref<number | undefined>(undefined);
const units = [
  "meters",
  "kilometers",
  "miles",
  "feet",
  "yards",
  "inches",
  "nauticalmiles",
  "centimeters",
] as const;
type BufferUnits = (typeof units)[number];
const unit = ref<BufferUnits>(units[0]);
const colour = ref("#ffffff");

const layerStore = useMapLayer();
const authStore = useAuth();
const featureStore = useFeature();
const { mapInfo } = storeToRefs(featureStore);
const analysisStore = useAnalysisResult();
const { dataBufferLineAnalysis } = storeToRefs(analysisStore);
const isAnalyze = ref(false);
const isEnableAnalysis = ref(false);
const geoJsonSource = ref<any>(null);
const geoJsonBuffer = ref<any>(null);

const BUFFER_SOURCE_ID = "line-buffer-preview-source";
const BUFFER_LAYER_ID = "line-buffer-preview-layer";
const POINTS_SOURCE_ID = "line-buffer-points-source";
const POINTS_LAYER_ID = "line-buffer-points-layer";
const TSP_LINE_SOURCE_ID = "tsp-line-source";
const TSP_LINE_LAYER_ID = "tsp-line-layer";

const handleTSP = async () => {
  if (selectedPoints.value.length < 2) {
    toast.add({
      title: "Not enough points",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: "Please select at least 2 points on the map.",
    });
    return null;
  }

  const locations = selectedPoints.value.map((point: any) => [
    point.geometry.coordinates[0],
    point.geometry.coordinates[1],
  ]);
  const payload = {
    profile: "foot-walking",
    locations: locations,
  };

  try {
    const resp = await $fetch<any>("/panel/analysis/tsp", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: payload,
    });

    if (resp && resp.data && resp.data.geojson_route) {
      const routeData = resp.data.geojson_route;

      // Check if it's a FeatureCollection
      if (
        routeData.type === "FeatureCollection" &&
        routeData.features &&
        routeData.features.length > 0
      ) {
        // Extract the first LineString feature
        const lineStringFeature = routeData.features.find(
          (f: any) => f.geometry && f.geometry.type === "LineString"
        );
        if (lineStringFeature && lineStringFeature.geometry.coordinates) {
          const lineFeature = lineString(
            lineStringFeature.geometry.coordinates,
            {
              id: "tsp-route",
              source: "tsp-api",
            }
          );
          tspLineString.value = lineFeature;
          return lineFeature;
        }
      }

      console.error("Unexpected route data format:", routeData);
      return null;
    }

    return null;
  } catch (error) {
    console.log(error);
    toast.add({
      title: "Error Route",
      description: "Error generate optimal route, please try again.",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
      icon: "i-heroicons-x-mark",
    });
    return null;
  }
};

const handleGetRoute = async () => {
  if (selectedPoints.value.length === 0) {
    toast.add({
      title: "No points selected",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: "Please select points on the map first.",
    });
    return;
  }

  isLoading.value = true;
  try {
    // Get the TSP route line
    const tspLine = await handleTSP();
    if (!tspLine) {
      toast.add({
        title: "Route Error",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-green-500",
        },
        description: "Could not generate route from points.",
      });
      return;
    }

    // Store the route line for reuse
    const line = featureCollection([tspLine]);
    geoJsonSource.value = line;

    // Display the route on the map
    const mapInstance = map.value;
    if (mapInstance) {
      const routeSource = mapInstance.getSource(
        TSP_LINE_SOURCE_ID
      ) as GeoJSONSource;
      if (routeSource) {
        routeSource.setData(line);
      } else {
        mapInstance.addSource(TSP_LINE_SOURCE_ID, {
          type: "geojson",
          data: line,
        });
      }

      if (!mapInstance.getLayer(TSP_LINE_LAYER_ID)) {
        mapInstance.addLayer({
          id: TSP_LINE_LAYER_ID,
          type: "line",
          source: TSP_LINE_SOURCE_ID,
          paint: {
            "line-color": "#3B82F6", // Blue color for the route
            "line-width": 4,
            "line-opacity": 0.8,
          },
        });
      }
    }

    // Enable analysis after getting route
    isEnableAnalysis.value = true;

    toast.add({
      title: "Route Generated",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description:
        "Route successfully created. You can now adjust buffer settings.",
    });
  } catch (error) {
    console.error("Error getting route:", error);
    toast.add({
      title: "Route Error",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: "Could not generate route from points.",
    });
  } finally {
    isLoading.value = false;
  }
};

const handleBufferLine = async () => {
  // Check if we have a route already
  if (!geoJsonSource.value) {
    toast.add({
      title: "No route available",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: "Please generate a route first by clicking 'Get Route'.",
    });
    return;
  }

  if (typeof digit.value !== "number" || digit.value <= 0) {
    toast.add({
      title: "Invalid distance",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: "Please enter a positive buffer distance.",
    });
    return;
  }

  try {
    // Create buffer from existing route
    const buffered = buffer(geoJsonSource.value, digit.value, {
      units: unit.value,
    });
    geoJsonBuffer.value = buffered;

    const mapInstance = map.value;
    if (!mapInstance) return;

    const source = mapInstance.getSource(BUFFER_SOURCE_ID) as GeoJSONSource;
    if (source) {
      source.setData(buffered);
    } else {
      mapInstance.addSource(BUFFER_SOURCE_ID, {
        type: "geojson",
        data: buffered,
      });
    }

    const bufferLayer = mapInstance.getLayer(BUFFER_LAYER_ID);
    if (bufferLayer) {
      mapInstance.setPaintProperty(BUFFER_LAYER_ID, "fill-color", colour.value);
    } else {
      mapInstance.addLayer({
        id: BUFFER_LAYER_ID,
        type: "fill",
        source: BUFFER_SOURCE_ID,
        paint: {
          "fill-color": colour.value,
          "fill-opacity": 0.5,
        },
      });
    }
  } catch (error) {
    console.error("Error creating buffer:", error);
    toast.add({
      title: "Buffer Error",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: "Could not generate the buffer.",
    });
  } finally {
    isLoading.value = false;
    isEnableAnalysis.value = true;
  }
};

const handleAnalysis = async () => {
  isAnalyze.value = true;
  const payload = JSON.stringify({
    geojson_source: geoJsonSource.value,
    geojson_buffer: geoJsonBuffer.value,
  });
  try {
    const res = await $fetch<any>("/panel/analysis/backhaul-backbound", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: payload,
    });
    dataBufferLineAnalysis.value = res.data;
    if (featureStore.mapInfo !== "analytic") {
      featureStore.mapInfo = "analytic";
      queryClient.invalidateQueries({
        queryKey: ["analysis_result_backhaul"],
      });
    }
    queryClient.invalidateQueries({
      queryKey: ["analysis_result_backhaul"],
    });

    setTimeout(() => {}, 1000);
  } catch (error) {
    console.log(error);
    toast.add({
      title: "Failed to analysis",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: "Please try again later",
    });
  } finally {
    isAnalyze.value = false;
  }
};

watchEffect((onInvalidate) => {
  const mapInstance = map.value;
  if (!mapInstance) return;

  const handleMapClick = (e: MapLayerTouchEvent) => {
    const clickedPoint = point([e.lngLat.lng, e.lngLat.lat]);
    selectedPoints.value.push(clickedPoint);
  };

  mapInstance.on("click", handleMapClick);

  onInvalidate(() => {
    mapInstance.off("click", handleMapClick);
  });
});

watch(
  selectedPoints,
  (newPoints) => {
    const mapInstance = map.value;
    if (!mapInstance) return;

    const pointsSource = mapInstance.getSource(
      POINTS_SOURCE_ID
    ) as GeoJSONSource;
    const pointsData = featureCollection(newPoints);

    if (pointsSource) {
      pointsSource.setData(pointsData);
    } else {
      mapInstance.addSource(POINTS_SOURCE_ID, {
        type: "geojson",
        data: pointsData,
      });
    }

    if (!mapInstance.getLayer(POINTS_LAYER_ID)) {
      mapInstance.addLayer({
        id: POINTS_LAYER_ID,
        type: "circle",
        source: POINTS_SOURCE_ID,
        paint: {
          "circle-color": "#F87171", // Red color for points
          "circle-radius": 6,
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 2,
        },
      });
    }
  },
  { deep: true }
);

const handleReset = () => {
  if (!map.value) return;

  selectedPoints.value = [];
  if (map.value.getLayer(TSP_LINE_LAYER_ID)) {
    map.value.removeLayer(TSP_LINE_LAYER_ID);
  }
  if (map.value.getLayer(BUFFER_LAYER_ID)) {
    map.value.removeLayer(BUFFER_LAYER_ID);
  }
};

onUnmounted(() => {
  const mapInstance = map.value;
  if (mapInstance) {
    if (mapInstance.getLayer(BUFFER_LAYER_ID)) {
      mapInstance.removeLayer(BUFFER_LAYER_ID);
    }
    if (mapInstance.getSource(BUFFER_SOURCE_ID)) {
      mapInstance.removeSource(BUFFER_SOURCE_ID);
    }
    if (mapInstance.getLayer(POINTS_LAYER_ID)) {
      mapInstance.removeLayer(POINTS_LAYER_ID);
    }
    if (mapInstance.getSource(POINTS_SOURCE_ID)) {
      mapInstance.removeSource(POINTS_SOURCE_ID);
    }
    if (mapInstance.getLayer(TSP_LINE_LAYER_ID)) {
      mapInstance.removeLayer(TSP_LINE_LAYER_ID);
    }
    if (mapInstance.getSource(TSP_LINE_SOURCE_ID)) {
      mapInstance.removeSource(TSP_LINE_SOURCE_ID);
    }
  }
  selectedPoints.value = [];
});
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <p class="text-2xs text-grey-400">
      Click on the map to create points for route planning.
    </p>
    <div class="flex items-center justify-between">
      <p class="text-xs text-grey-400">
        {{ selectedPoints.length }} Points Selected
      </p>
      <div v-if="selectedPoints.length > 0" class="text-2xs text-grey-500">
        <button @click="handleReset" class="text-red-500 hover:text-red-700">
          Reset
        </button>
      </div>
    </div>
    <UDivider
      :ui="{ label: 'text-2xs text-grey-400' }"
      label="Buffer Setting"
      size="2xs"
    />
    <div class="grid grid-cols-3 gap-1">
      <UInput
        v-model="digit"
        placeholder="-Distance-"
        :ui="{ rounded: 'rounded-xxs' }"
        size="2xs"
        type="number"
      >
      </UInput>
      <USelect
        v-model="unit"
        :options="units"
        :ui="{ rounded: 'rounded-xxs' }"
        size="2xs"
      />
      <UInput
        v-model="colour"
        :ui="{ rounded: 'rounded-xxs' }"
        size="2xs"
        type="color"
      >
      </UInput>
    </div>
  </div>
  <div class="p-2 flex flex-col gap-2">
    <!-- Get Route Button -->
    <UButton
      @click="handleGetRoute"
      variant="outline"
      color="gray"
      :ui="{ rounded: 'rounded-[4px]' }"
      class="w-full justify-center text-sm"
      :loading="isLoading"
      :disabled="selectedPoints.length < 2"
    >
      Get Route ({{ selectedPoints.length }} points)
    </UButton>

    <!-- Buffer and Analysis Buttons -->
    <div class="grid grid-cols-2 gap-x-3">
      <UButton
        @click="handleBufferLine"
        variant="outline"
        color="base"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="w-full justify-center text-sm"
        :disabled="!geoJsonSource"
      >
        Preview Buffer
      </UButton>
      <UButton
        @click="handleAnalysis"
        :disabled="!isEnableAnalysis"
        color="brand"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="w-full justify-center text-sm"
        :loading="isAnalyze"
      >
        <template v-if="isFetching">
          <IcSpinner class="h-4 w-4 animate-spin" />
        </template>
        <template v-else> Apply Analysis</template>
      </UButton>
    </div>
  </div>
</template>
