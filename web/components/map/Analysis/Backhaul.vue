<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { useAuth } from "~/stores/useAuth";
import { useAnalysisResult } from "~/stores/useAnalysisResult";
import { storeToRefs } from "pinia";
import { computed, ref, watch, onBeforeUnmount } from "vue";
import IcLayer from "~/assets/icons/ic-map-layer.svg";
import IcSpinner from "~/assets/icons/ic-spinner.svg";
import IcTrash from "~/assets/icons/ic-trash.svg";
import { useQueryClient } from "@tanstack/vue-query";
import IcInfo from "~/assets/icons/ic-info.svg";

interface Props {
  mode?: "default" | "exclusive";
}

const props = withDefaults(defineProps<Props>(), {
  mode: "default",
});
import { CollisionGroups } from "maplibre-gl";

const authStore = useAuth();
const { dataUser } = storeToRefs(authStore);
const analysisStore = useAnalysisResult();
const queryClient = useQueryClient();
const mapStore = useMapRef();
const { map } = mapStore;
const toast = useToast();
const selectedTab = ref("All");
const layerVisibility = ref<Record<string, boolean>>({});
const bufferVisibility = ref<Record<string, boolean>>({});
const individualLayerVisibility = ref<Record<string, boolean>>({});
const TAB = ["All", "Primary Road", "Secondary Road", "Tertiary Road"];

const getAnalysisResult = async () => {
  const response = await $fetch<any>(
    `/panel/items/analysis_result?meta=*&filter[module][_eq]=backhaul_backbound&filter[user_created][_eq]=${dataUser.value?.id}&limit=10&sort=-date_created`,
    {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    },
  );
  return response.data;
};

const { data: analysisResult, isLoading } = useQuery({
  queryKey: ["analysis_result_backhaul"],
  queryFn: getAnalysisResult,
  enabled: computed(() => !!dataUser.value?.id),
});

const items = computed(() => {
  if (!analysisResult.value) return [];
  return analysisResult.value.map((item: any, index: number) => ({
    id: item.id,
    label: item.code,
    geojsonBuffer: item.geojson_buffer,
    geojson_source: item.geojson_source,
    result: item.result,
    slot: "getting-started",
    defaultOpen: index === 0,
  }));
});

function formatLayers(layers: any, tab: string) {
  if (!layers) return [];
  return Object.keys(layers).map((key) => {
    const layer = layers[key];
    const name = key.replace(/_/g, " ");

    if (!layer.summary || layer.summary.length === 0) {
      return {
        name,
        count: 0,
        features: [],
        disabled: true,
        layerKey: key,
        layerData: layer,
      };
    }

    const filteredSummary = layer.summary.filter(
      (s: any) => s.road_category === tab,
    );

    const totalCount = filteredSummary.reduce(
      (acc: number, curr: any) => acc + parseInt(curr.count, 10),
      0,
    );
    return {
      name,
      count: totalCount,
      features: filteredSummary.map((feature: any) => ({
        class: feature.group,
        count: feature.count,
      })),
      disabled: totalCount === 0,
      layerKey: key,
      layerData: layer,
    };
  });
}

function getBufferForTab(buffer: any, tab: string) {
  if (!buffer) return null;
  return buffer.find((b: any) => b.road_category === tab);
}

function createFilterExpression(selectedTab: string) {
  if (selectedTab === "All") {
    return null;
  }
  return ["in", selectedTab, ["get", "road_category"]] as any;
}

function isValidGeoJSON(data: any): boolean {
  if (!data || typeof data !== "object") return false;
  if (!data.type) return false;

  const validTypes = [
    "FeatureCollection",
    "Feature",
    "Point",
    "LineString",
    "Polygon",
    "MultiPoint",
    "MultiLineString",
    "MultiPolygon",
    "GeometryCollection",
  ];
  if (!validTypes.includes(data.type)) return false;

  // For FeatureCollection, check if features array exists and is not null
  if (data.type === "FeatureCollection") {
    return Array.isArray(data.features) && data.features !== null;
  }

  return true;
}

function addMapLayers() {
  if (!analysisResult.value || !map) return;

  analysisResult.value.forEach((item: any) => {
    if (item.geojson_buffer) {
      if (!isValidGeoJSON(item.geojson_buffer)) {
        return;
      }
      const layer_id = `${item.code}_buffer`;
      // Only add if layer doesn't already exist
      if (!map.getLayer(layer_id)) {
        const layer_config: any = {
          id: layer_id,
          source: layer_id,
          type: "fill",
          layout: {
            visibility: "none",
          },
          paint: {
            "fill-color": "#FFFFFF",
            "fill-opacity": 0.4,
          },
        };
        map.addSource(layer_id, {
          type: "geojson",
          data: item.geojson_buffer,
        });
        map.addLayer(layer_config);
      }

      // Initialize buffer visibility - first item visible by default
      if (!bufferVisibility.value.hasOwnProperty(item.code)) {
        const itemIndex =
          analysisResult.value?.findIndex(
            (result: any) => result.code === item.code,
          ) ?? -1;
        const isFirstItem = itemIndex === 0;
        bufferVisibility.value[item.code] = isFirstItem;

        // Set buffer layer visibility to match initial state
        if (map.getLayer(layer_id)) {
          map.setLayoutProperty(
            layer_id,
            "visibility",
            isFirstItem ? "visible" : "none",
          );
        }
      }
    }
    if (item.result?.layers) {
      const layers = item.result.layers;

      // Add each GeoJSON layer to the map
      Object.keys(layers).forEach((layerKey) => {
        const layer = layers[layerKey];
        if (layer.geojson) {
          if (!isValidGeoJSON(layer.geojson)) {
            return;
          }
          const layerId = `${item.code}_${layerKey}`;

          // Skip if layer already exists
          if (map.getLayer(layerId)) return;

          // Add source
          map.addSource(layerId, {
            type: "geojson",
            data: layer.geojson,
          });

          // Add layer with appropriate styling based on layer type
          let layerConfig: any = {
            id: layerId,
            source: layerId,
          };

          switch (layerKey) {
            case "house_class":
              layerConfig = {
                ...layerConfig,
                type: "fill",
                layout: {
                  visibility: "none",
                },
                paint: {
                  "fill-color": "#3B82F6",
                  "fill-opacity": 0.6,
                },
              };
              break;
            case "poi":
              layerConfig = {
                ...layerConfig,
                type: "circle",
                layout: {
                  visibility: "none",
                },
                paint: {
                  "circle-color": "#EF4444",
                  "circle-radius": 8,
                  "circle-opacity": 0.8,
                },
              };
              break;
            case "telecommunication":
              layerConfig = {
                ...layerConfig,
                type: "circle",
                layout: {
                  visibility: "none",
                },
                paint: {
                  "circle-color": "#10B981",
                  "circle-radius": 8,
                  "circle-opacity": 0.8,
                },
              };
              break;
            default:
              layerConfig = {
                ...layerConfig,
                type: "fill",
                layout: {
                  visibility: "none",
                },
                paint: {
                  "fill-color": "#6B7280",
                  "fill-opacity": 0.5,
                },
              };
          }

          map.addLayer(layerConfig);

          // Apply initial filter
          const filterExpression = createFilterExpression(selectedTab.value);
          if (filterExpression) {
            map.setFilter(layerId, filterExpression);
          }

          // Initialize individual layer visibility - first item visible by default
          if (!individualLayerVisibility.value.hasOwnProperty(layerId)) {
            const itemIndex =
              analysisResult.value?.findIndex(
                (result: any) => result.code === item.code,
              ) ?? -1;
            const isFirstItem = itemIndex === 0;
            individualLayerVisibility.value[layerId] = isFirstItem;

            // Set map layer visibility to match initial state
            if (map.getLayer(layerId)) {
              map.setLayoutProperty(
                layerId,
                "visibility",
                isFirstItem ? "visible" : "none",
              );
            }
          }
        }
      });

      // Initialize visibility state for this item - first item visible by default
      if (!layerVisibility.value.hasOwnProperty(item.code)) {
        const itemIndex =
          analysisResult.value?.findIndex(
            (result: any) => result.code === item.code,
          ) ?? -1;
        const isFirstItem = itemIndex === 0;
        layerVisibility.value[item.code] = isFirstItem;

        // Store first item data as active buffer data
        if (isFirstItem) {
          analysisStore.dataBufferLineAnalysis = {
            label: item.code,
            bufferData: item.geojson_buffer,
            analysisData: item.result,
            sourceData: item.geojson_source,
          };
        }
      }
    }
  });
}

function updateLayerFilters() {
  if (!analysisResult.value || !map) return;

  const filterExpression = createFilterExpression(selectedTab.value);

  analysisResult.value.forEach((item: any) => {
    if (item.result?.layers) {
      const layers = item.result.layers;

      Object.keys(layers).forEach((layerKey) => {
        const layer = layers[layerKey];
        if (layer.geojson) {
          const layerId = `${item.code}_${layerKey}`;

          // Only update filter if layer exists
          if (map.getLayer(layerId)) {
            map.setFilter(layerId, filterExpression);
          }
        }
      });
    }
  });
}

async function deleteAnalysisResult(item: any) {
  try {
    await $fetch(`/panel/items/analysis_result/${item.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    queryClient.invalidateQueries({
      queryKey: ["analysis_result_backhaul"],
    });
    toast.add({
      title: "Delete Success",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: `Backhaul analysis ${item.label} has been removed successfully.`,
      icon: "i-heroicons-check-circle",
    });
  } catch (error) {
    console.log(error);
    toast.add({
      title: "Error Delete Backhaul Analysis",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: "Please try again later.",
      icon: "i-heroicons-x-mark",
    });
  }
}

const downloadCsv = async (url: string, body: any, filename: string) => {
  try {
    const response = await $fetch<any>(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      responseType: "blob",
    });

    const blob = new Blob([response], { type: "text/csv" });
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);

    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error("Download error:", err);
  }
};
const downloadKml = async (url: string, body: any, filename: string) => {
  try {
    const response = await $fetch<any>(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      responseType: "blob",
    });

    const blob = new Blob([response], {
      type: "application/vnd.google-earth.kml+xml",
    });
    const link = document.createElement("a");
    const objectUrl = URL.createObjectURL(blob);

    link.href = objectUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    console.error("Download error:", err);
  }
};

async function downloadAnalysisResult(
  item: any,
  format: "csv" | "kml" | "kml-route" = "csv",
) {
  if (
    item.result.layers.house_class.length === 0 &&
    item.result.layers.poi.length === 0 &&
    item.result.layers.telecommunication.length === 0
  ) {
    toast.add({
      title: "No backhaul data",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      icon: "i-heroicons-x-mark",
    });
    return;
  }

  if (format === "csv") {
    if (item.result.layers.house_class.summary.length > 0) {
      await downloadCsv(
        `/panel/analysis/download/area/csv/sp_data_footprint`,
        { geojson_buffer: item.result.layers.house_class.geojson },
        `${item.label}_house_class.csv`,
      );
    }

    if (item.result.layers.poi.summary.length > 0) {
      await downloadCsv(
        `/panel/analysis/download/area/csv/poi`,
        { geojson_buffer: item.result.layers.poi.geojson },
        `${item.label}_poi.csv`,
      );
    }

    if (item.result.layers.telecommunication.summary.length > 0) {
      await downloadCsv(
        `/panel/analysis/download/area/csv/towers`,
        { geojson_buffer: item.result.layers.telecommunication.geojson },
        `${item.label}_telecomunication.csv`,
      );
    }
  } else if (format === "kml") {
    if (item.result.layers.house_class.summary.length > 0) {
      await downloadKml(
        `/panel/tools/geojson-to-kml`,
        item.geojsonBuffer,
        `${item.label}_Buffer.kml`,
      );
    }
  } else {
    if (format === "kml-route") {
      console.log(item);
      if (item.result.layers.house_class.summary.length > 0) {
        await downloadKml(
          `/panel/tools/geojson-to-kml`,
          item.geojson_source,
          `${item.label}_Route.kml`,
        );
      }
    }
  }
}

function toggleLayerVisibility(item: any) {
  if (!map) return;
  const isCurrentlyVisible = layerVisibility.value[item.label] ?? true;
  const newVisibility = !isCurrentlyVisible;

  // In exclusive mode, if making this layer visible, hide all other layers first
  if (props.mode === "exclusive" && newVisibility && analysisResult.value) {
    analysisResult.value.forEach((otherItem: any) => {
      // Skip the current item
      if (otherItem.code === item.label) return;

      // Hide other layers
      layerVisibility.value[otherItem.code] = false;
      bufferVisibility.value[otherItem.code] = false;

      // Hide buffer layer
      const otherBufferId = `${otherItem.code}_buffer`;
      if (map.getLayer(otherBufferId)) {
        map.setLayoutProperty(otherBufferId, "visibility", "none");
      }

      // Hide all individual layers of other items
      if (otherItem.result?.layers) {
        const otherLayers = otherItem.result.layers;
        Object.keys(otherLayers).forEach((layerKey) => {
          const layer = otherLayers[layerKey];
          if (layer.geojson) {
            const otherLayerId = `${otherItem.code}_${layerKey}`;
            individualLayerVisibility.value[otherLayerId] = false;

            if (map.getLayer(otherLayerId)) {
              map.setLayoutProperty(otherLayerId, "visibility", "none");
            }
          }
        });
      }
    });
  }

  // Update visibility state
  layerVisibility.value[item.label] = newVisibility;

  // Toggle buffer visibility
  const bufferId = `${item.label}_buffer`;
  bufferVisibility.value[item.label] = newVisibility;
  if (map.getLayer(bufferId)) {
    map.setLayoutProperty(
      bufferId,
      "visibility",
      newVisibility ? "visible" : "none",
    );
  }

  // Store active buffer data when layer is made visible
  if (newVisibility && item.geojsonBuffer) {
    analysisStore.dataBufferLineAnalysis = {
      label: item.label,
      bufferData: item.geojsonBuffer,
      analysisData: item.result,
      sourceData: item.geojson_source,
    };

    // Fly to the layer bounds when activated
    if (item.geojsonBuffer && map) {
      try {
        // Calculate bounds from GeoJSON
        const coordinates: [number, number][] = [];

        if (item.geojsonBuffer.type === "FeatureCollection") {
          item.geojsonBuffer.features.forEach((feature: any) => {
            if (feature.geometry.type === "Polygon") {
              feature.geometry.coordinates[0].forEach(
                (coord: [number, number]) => {
                  coordinates.push(coord);
                },
              );
            } else if (feature.geometry.type === "MultiPolygon") {
              feature.geometry.coordinates.forEach((polygon: any) => {
                polygon[0].forEach((coord: [number, number]) => {
                  coordinates.push(coord);
                });
              });
            } else if (feature.geometry.type === "LineString") {
              feature.geometry.coordinates.forEach(
                (coord: [number, number]) => {
                  coordinates.push(coord);
                },
              );
            } else if (feature.geometry.type === "MultiLineString") {
              feature.geometry.coordinates.forEach((line: any) => {
                line.forEach((coord: [number, number]) => {
                  coordinates.push(coord);
                });
              });
            }
          });
        }

        if (coordinates.length > 0) {
          // Calculate bounds
          const lons = coordinates.map((coord) => coord[0]);
          const lats = coordinates.map((coord) => coord[1]);

          const minLon = Math.min(...lons);
          const maxLon = Math.max(...lons);
          const minLat = Math.min(...lats);
          const maxLat = Math.max(...lats);

          // Fit bounds with padding
          map.fitBounds(
            [
              [minLon, minLat],
              [maxLon, maxLat],
            ],
            {
              padding: 300,
              duration: 3000,
            },
          );
        }
      } catch (error) {
        console.warn("Error flying to layer bounds:", error);
      }
    }
  } else if (!newVisibility) {
    // Clear buffer data when layer is hidden
    analysisStore.dataBufferLineAnalysis = null;
  }

  // Toggle visibility for all layers of this item
  if (item.result?.layers) {
    const layers = item.result.layers;
    Object.keys(layers).forEach((layerKey) => {
      const layer = layers[layerKey];
      if (layer.geojson) {
        const layerId = `${item.label}_${layerKey}`;

        // Sync individual layer visibility state with parent
        individualLayerVisibility.value[layerId] = newVisibility;

        if (map.getLayer(layerId)) {
          map.setLayoutProperty(
            layerId,
            "visibility",
            newVisibility ? "visible" : "none",
          );
        }
      }
    });
  }
}

function toggleIndividualLayerVisibility(item: any, layerKey: string) {
  if (!map) return;

  const layerId = `${item.label}_${layerKey}`;
  const isCurrentlyVisible = individualLayerVisibility.value[layerId] ?? true;
  const newVisibility = !isCurrentlyVisible;

  // Update individual visibility state
  individualLayerVisibility.value[layerId] = newVisibility;

  if (map.getLayer(layerId)) {
    map.setLayoutProperty(
      layerId,
      "visibility",
      newVisibility ? "visible" : "none",
    );
  }
}

async function downloadIndividualLayer(
  item: any,
  layerKey: string,
  layer: any,
  format: "csv" | "kml" = "csv",
) {
  if (!layer.geojson) return;

  let layerName;
  if (layerKey === "house_class") {
    layerName = "sp_data_footprint";
  } else if (layerKey === "telecommunication") {
    layerName = "towers";
  } else {
    layerName = "poi";
  }

  let response;
  try {
    if (format === "csv") {
      const res = await $fetch<any>(
        `/panel/analysis/download/area/${format}/${layerName}`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            geojson_buffer: layer.geojson,
          }),
          responseType: "blob",
        },
      );
      response = res;
    } else {
      const res = await $fetch("/panel/tools/geojson-to-kml", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(layer.geojson),
        responseType: "blob",
      });
      response = res;
    }

    const mimeType =
      format === "csv" ? "text/csv" : "application/vnd.google-earth.kml+xml";
    const blob = new Blob([response], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${item.label}_${layerKey}.${format}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toast.add({
      title: "Download Success",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: `${layerKey} layer downloaded as ${format.toUpperCase()} successfully.`,
      icon: "i-heroicons-check-circle",
    });
  } catch (error) {
    console.error("Download error:", error);
    toast.add({
      title: "Download Error",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
      description: `Failed to download ${format.toUpperCase()}. Please try again.`,
      icon: "i-heroicons-x-mark",
    });
  }
}

// Cleanup function to remove all backhaul analysis layers from the map
function cleanupLayers() {
  if (!analysisResult.value || !map) return;

  analysisResult.value.forEach((item: any) => {
    // Remove buffer layer
    const bufferLayerId = `${item.code}_buffer`;
    if (map.getLayer(bufferLayerId)) {
      map.removeLayer(bufferLayerId);
    }
    if (map.getSource(bufferLayerId)) {
      map.removeSource(bufferLayerId);
    }

    // Remove analysis result layers
    if (item.result?.layers) {
      const layers = item.result.layers;
      Object.keys(layers).forEach((layerKey) => {
        const layerId = `${item.code}_${layerKey}`;
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
        if (map.getSource(layerId)) {
          map.removeSource(layerId);
        }
      });
    }
  });
}

watch(analysisResult, addMapLayers, { immediate: true });

watch(selectedTab, updateLayerFilters);

// Clean up layers when component unmounts
onBeforeUnmount(() => {
  cleanupLayers();
});
</script>

<template>
  <div v-if="isLoading" class="flex items-center justify-center p-4">
    <IcSpinner class="animate-spin h-8 w-8 text-gray-500" />
  </div>
  <div
    v-else-if="items.length === 0"
    class="flex flex-col gap-2 items-center justify-center p-3"
  >
    <IcInfo class="text-lg" />
    <p>No Data</p>
  </div>
  <UAccordion v-else :items="items" :ui="{ wrapper: 'flex flex-col w-full' }">
    <template #default="{ item, open }">
      <UButton
        color="gray"
        variant="ghost"
        class="mb-2 flex items-center justify-between"
        :ui="{ rounded: 'rounded-none', padding: { sm: 'p-2' } }"
      >
        <div class="flex flex-col justify-center item-start text-start">
          <p class="truncate text-xs">{{ item.label }}</p>
          <p class="text-xs text-grey-500">Polyline</p>
        </div>

        <template #trailing>
          <div class="flex items-center">
            <UButton
              size="2xs"
              :ui="{ padding: { '2xs': 'p-0' } }"
              color="red"
              variant="ghost"
              @click.stop="deleteAnalysisResult(item)"
            >
              <IcTrash />
            </UButton>
            <UDropdown
              :items="[
                [
                  {
                    label: 'CSV',
                    click: () => downloadAnalysisResult(item, 'csv'),
                  },
                  {
                    label: 'KML Buffer',
                    click: () => downloadAnalysisResult(item, 'kml'),
                  },
                  {
                    label: 'KML Route',
                    click: () => downloadAnalysisResult(item, 'kml-route'),
                  },
                ],
              ]"
              :popper="{ placement: 'bottom-start' }"
              :ui="{
                width: 'w-20',
                rounded: 'rounded-xxs',
                item: {
                  base: 'rounded-xxs',
                  size: 'text-[10px]',
                },
              }"
              @click.stop
            >
              <UButton
                icon="i-heroicons-arrow-down-tray-20-solid"
                :ui="{ padding: { '2xs': 'p-0' } }"
                size="2xs"
                color="gray"
                variant="ghost"
              />
            </UDropdown>
            <UButton
              :icon="
                layerVisibility[item.label] !== false
                  ? 'clarity:eye-show-line'
                  : 'clarity:eye-hide-line'
              "
              size="2xs"
              :ui="{ padding: { '2xs': 'p-0' } }"
              color="gray"
              variant="ghost"
              @click.stop="toggleLayerVisibility(item)"
              :title="
                layerVisibility[item.label] !== false
                  ? 'Hide layer'
                  : 'Show layer'
              "
            />
            <UIcon
              name="i-heroicons-chevron-down-20-solid"
              class="w-5 h-5 ms-auto transform transition-transform duration-200"
              :class="[open && 'rotate-180']"
            />
          </div>
        </template>
      </UButton>
    </template>
    <template #getting-started="{ item }">
      <div v-if="item.result" class="p-2 space-y-3">
        <h1 class="text-gray-800 text-xs">Road Categories</h1>
        <div class="flex items-center gap-2">
          <UButton
            v-for="tab in TAB"
            :key="tab"
            :label="tab"
            size="2xs"
            :ui="{ rounded: 'rounded-xxs' }"
            @click="selectedTab = tab"
            :variant="selectedTab === tab ? 'solid' : 'outline'"
            :color="selectedTab === tab ? 'brand' : 'gray'"
          />
        </div>
        <div class="w-full p-2 rounded-xs border-[1px] border-grey-300">
          <div class="flex items-center justify-between">
            <p class="text-[10px]">Buffer Properties</p>
          </div>
          <div class="space-y-1">
            <div
              class="flex items-center justify-between text-[10px] text-grey-800"
            >
              <p>Length</p>
              <div class="flex items-center gap-[8px]">
                <p>
                  {{
                    (
                      getBufferForTab(item.result.buffer, selectedTab)
                        ?.length_m || 0
                    ).toFixed(2)
                  }}
                </p>
                <p>m</p>
              </div>
            </div>
            <div
              class="flex items-center justify-between text-[10px] text-grey-800"
            >
              <p>Area</p>
              <div class="flex items-center gap-[8px]">
                <p>
                  {{
                    (
                      getBufferForTab(item.result.buffer, selectedTab)
                        ?.area_m2 || 0
                    ).toFixed(2)
                  }}
                </p>
                <p>m²</p>
              </div>
            </div>
          </div>
        </div>
        <div class="w-full p-2 rounded-xs border-[1px] border-grey-300">
          <p class="text-[10px]">Layers in Buffer Area</p>
          <UAccordion
            :items="formatLayers(item.result.layers, selectedTab)"
            multiple
            :ui="{
              container: 'border-[1px] border-grey-200 rounded-xs mb-1',
              wrapper: 'rounded-xs',
            }"
          >
            <template #default="{ item: layer, open }">
              <UButton
                color="gray"
                variant="ghost"
                :disabled="layer.disabled"
                class="hover:bg-transparent flex items-center justify-between"
                :ui="{ rounded: 'rounded-none', padding: { sm: 'px-2' } }"
              >
                <div class="flex items-center text-start gap-2">
                  <p class="truncate text-[10px] capitalize">
                    {{ layer.name }}
                  </p>
                  <div
                    class="bg-grey-200 py-[1px] px-[4px] rounded-xs border-[1px] border-brand-500"
                  >
                    {{ layer.count }}
                  </div>
                </div>

                <template #trailing>
                  <div class="flex items-center">
                    <UButton
                      :disabled="layer.count === 0"
                      :icon="
                        individualLayerVisibility[
                          `${item.label}_${layer.layerKey}`
                        ] !== false
                          ? 'clarity:eye-show-line'
                          : 'clarity:eye-hide-line'
                      "
                      size="2xs"
                      :ui="{ padding: { '2xs': 'p-0' } }"
                      color="gray"
                      variant="ghost"
                      @click.stop="
                        toggleIndividualLayerVisibility(item, layer.layerKey)
                      "
                      :title="
                        individualLayerVisibility[
                          `${item.label}_${layer.layerKey}`
                        ] !== false
                          ? 'Hide layer'
                          : 'Show layer'
                      "
                    />
                    <UDropdown
                      :items="[
                        [
                          {
                            label: 'CSV',
                            click: () =>
                              downloadIndividualLayer(
                                item,
                                layer.layerKey,
                                layer.layerData,
                                'csv',
                              ),
                          },
                          {
                            label: 'KML',
                            click: () =>
                              downloadIndividualLayer(
                                item,
                                layer.layerKey,
                                layer.layerData,
                                'kml',
                              ),
                          },
                        ],
                      ]"
                      :popper="{ placement: 'bottom-start' }"
                      :ui="{
                        width: 'w-12',
                        rounded: 'rounded-xxs',
                        item: {
                          base: 'rounded-xxs',
                          size: 'text-[10px]',
                        },
                      }"
                      @click.stop
                    >
                      <UButton
                        :disabled="layer.count === 0"
                        icon="i-heroicons-arrow-down-tray-20-solid"
                        size="2xs"
                        :ui="{ padding: { '2xs': 'p-0' } }"
                        color="gray"
                        variant="ghost"
                        title="Download layer"
                      />
                    </UDropdown>

                    <UIcon
                      name="i-heroicons-chevron-down-20-solid"
                      class="w-5 h-5 ms-auto transform transition-transform duration-200"
                      :class="[open && 'rotate-180']"
                    />
                  </div>
                </template>
              </UButton>
            </template>
            <template #item="{ item: layer }">
              <div class="p-2 space-y-2">
                <div
                  v-for="feature in layer.features"
                  :key="feature.class"
                  class="flex items-center justify-between gap-3"
                >
                  <div class="flex items-center gap-2">
                    <IcLayer />
                    <p class="text-xs text-nowrap">{{ feature.class }}</p>
                  </div>
                  <UDivider />
                  <div class="flex items-center gap-2">
                    <div
                      class="bg-brand-500 py-[2px] px-[4px] rounded-xs border-[1px] border-brand-500 text-white"
                    >
                      {{ feature.count }}
                    </div>
                  </div>
                </div>
              </div>
            </template>
          </UAccordion>
        </div>
      </div>
    </template>
  </UAccordion>
</template>
