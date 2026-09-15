<script setup lang="ts">
import { useAnalysisResult } from "~/stores/useAnalysisResult";
import { storeToRefs } from "pinia";
import { computed, ref, watch } from "vue";
import IcLayer from "~/assets/icons/ic-map-layer.svg";
import IcTrash from "~/assets/icons/ic-trash.svg";
import IcInfo from "~/assets/icons/ic-info.svg";

const analysisStore = useAnalysisResult();
const { dataMarketAnalysis } = storeToRefs(analysisStore);
const mapStore = useMapRef();
const { map } = mapStore;
const toast = useToast();
const layerVisibility = ref<Record<string, boolean>>({});
const bufferVisibility = ref<Record<string, boolean>>({});
const individualLayerVisibility = ref<Record<string, boolean>>({});

const accordionItems = [
  {
    label: "Backbone & Backhaul Analysis",
    icon: "i-heroicons-information-circle",
    slot: "backhaul",
  },
  {
    label: "Market Potential Analysis",
    icon: "i-heroicons-arrow-down-tray",
    slot: "market",
    defaultOpen: true,
  },
];

const marketAnalysisItems = computed(() => {
  if (!dataMarketAnalysis.value) return [];
  return dataMarketAnalysis.value.map((item: any, index: number) => ({
    id: item.code || `market_${index}`,
    label: item.code || `Market Analysis ${index + 1}`,
    geojsonBuffer: item.geojson_buffer,
    geojson_source: item.geojson_source,
    result: item.result,
    slot: "getting-started",
    defaultOpen: index === 0,
  }));
});

function formatLayers(layers: any, tab: string) {
  console.log("formatLayers called with:", { layers, tab });

  if (!layers) return [];

  return Object.keys(layers).map((key) => {
    const layer = layers[key];
    const name = key.replace(/_/g, " ");

    console.log(`Processing layer ${key}:`, layer);

    console.log(layer);
    // Market analysis data structure - no tab filtering needed
    if (layer.summary && Array.isArray(layer.summary)) {
      // Use 'summary' (note the typo in API response)
      const totalCount = layer.summary.reduce(
        (acc: number, curr: any) => acc + parseInt(curr.count, 10),
        0,
      );

      return {
        name,
        count: totalCount,
        features: layer.summary.map((feature: any) => ({
          class: feature.group,
          count: feature.count,
        })),
        disabled: totalCount === 0,
        layerKey: key,
        layerData: layer,
      };
    }

    // Handle direct count or other simple structures
    if (layer.count !== undefined) {
      return {
        name,
        count: parseInt(layer.count, 10) || 0,
        features: [
          {
            class: name,
            count: layer.count,
          },
        ],
        disabled: parseInt(layer.count, 10) === 0,
        layerKey: key,
        layerData: layer,
      };
    }

    // Fallback for empty or unsupported structures
    return {
      name,
      count: 0,
      features: [],
      disabled: true,
      layerKey: key,
      layerData: layer,
    };
  });
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
  if (!dataMarketAnalysis.value || !map) return;

  dataMarketAnalysis.value.forEach((item: any, index: number) => {
    const itemLabel = item.code || `market_${index}`;

    if (item.geojson_buffer) {
      if (!isValidGeoJSON(item.geojson_buffer)) {
        return;
      }
      const layer_id = `${itemLabel}_buffer`;

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
      if (!bufferVisibility.value.hasOwnProperty(itemLabel)) {
        const isFirstItem = index === 0;
        bufferVisibility.value[itemLabel] = isFirstItem;

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
            console.warn(
              `Invalid GeoJSON for layer ${itemLabel}_${layerKey}:`,
              layer.geojson,
            );
            return;
          }
          const layerId = `${itemLabel}_${layerKey}`;

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

          // No filtering needed for market analysis

          // Initialize individual layer visibility - first item visible by default
          if (!individualLayerVisibility.value.hasOwnProperty(layerId)) {
            const isFirstItem = index === 0;
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
      if (!layerVisibility.value.hasOwnProperty(itemLabel)) {
        const isFirstItem = index === 0;
        layerVisibility.value[itemLabel] = isFirstItem;
      }
    }
  });
}

async function deleteAnalysisResult(item: any, index: number) {
  try {
    // Remove from store
    analysisStore.dataMarketAnalysis.splice(index, 1);

    toast.add({
      title: "Delete Success",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: `Market analysis ${item.label} has been removed successfully.`,
      icon: "i-heroicons-check-circle",
    });
  } catch (error) {
    console.log(error);
    toast.add({
      title: "Error Delete Market Analysis",
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

function toggleLayerVisibility(item: any) {
  if (!map) return;
  const isCurrentlyVisible = layerVisibility.value[item.label] ?? true;
  const newVisibility = !isCurrentlyVisible;

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

watch(
  dataMarketAnalysis,
  (newValue) => {
    console.log("Market Analysis data changed:", newValue);
    if (newValue && newValue.length > 0) {
      console.log("First item structure:", newValue[0]);
      if (newValue[0].result) {
        console.log("First item result.layers:", newValue[0].result.layers);
        console.log("First item result.buffer:", newValue[0].result.buffer);
      }
    }
    addMapLayers();
  },
  { immediate: true },
);
</script>

<template>
  <UAccordion
    class="rounded-xs"
    :items="accordionItems"
    multiple
    :ui="{
      container: 'border-[1px] border-grey-200 rounded-xs mb-[12px]',
      wrapper: 'rounded-xs',
    }"
  >
    <template #default="{ item, open }">
      <UButton
        color="gray"
        variant="ghost"
        class="hover:bg-transparent"
        :ui="{ rounded: 'rounded-none', padding: { sm: 'px-3 py-2' } }"
      >
        <p class="text-[12px] text-black font-normal">{{ item.label }}</p>
        <template #trailing>
          <UIcon
            name="i-heroicons-chevron-down-20-solid"
            class="w-5 h-5 ms-auto transform transition-transform duration-200"
            :class="[open && 'rotate-180']"
          />
        </template>
      </UButton>
    </template>
    <template #backhaul>
      <div class="px-2">
        <MapAnalysisBackhaul mode="exclusive" />
      </div>
    </template>
    <template #market>
      <div class="px-2">
        <div
          v-if="!dataMarketAnalysis || dataMarketAnalysis.length === 0"
          class="flex flex-col gap-2 items-center justify-center p-3"
        >
          <IcInfo class="text-lg" />
          <p>No Market Analysis Data</p>
        </div>
        <UAccordion
          v-else
          :items="marketAnalysisItems"
          :ui="{ wrapper: 'flex flex-col w-full' }"
        >
          <template #default="{ item, open }">
            <UButton
              color="gray"
              variant="ghost"
              class="mb-2 flex items-center justify-between"
              :ui="{ rounded: 'rounded-none', padding: { sm: 'p-2' } }"
            >
              <div class="flex flex-col justify-center item-start text-start">
                <p class="truncate text-xs">{{ item.label }}</p>
                <p class="text-xs text-grey-500">Market Analysis</p>
              </div>

              <template #trailing>
                <div class="flex items-center">
                  <UButton
                    size="2xs"
                    :ui="{ padding: { '2xs': 'p-0' } }"
                    color="red"
                    variant="ghost"
                    @click.stop="
                      deleteAnalysisResult(
                        item,
                        marketAnalysisItems.indexOf(item),
                      )
                    "
                  >
                    <IcTrash />
                  </UButton>
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
                        {{ (item.result.buffer?.length_m || 0).toFixed(2) }}
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
                        {{ (item.result.buffer?.area_m2 || 0).toFixed(2) }}
                      </p>
                      <p>m²</p>
                    </div>
                  </div>
                </div>
              </div>
              <div class="w-full p-2 rounded-xs border-[1px] border-grey-300">
                <p class="text-[10px]">Layers in Buffer Area</p>
                <UAccordion
                  :items="formatLayers(item.result.layers, '')"
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
                              toggleIndividualLayerVisibility(
                                item,
                                layer.layerKey,
                              )
                            "
                            :title="
                              individualLayerVisibility[
                                `${item.label}_${layer.layerKey}`
                              ] !== false
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
      </div>
    </template>
  </UAccordion>
</template>
