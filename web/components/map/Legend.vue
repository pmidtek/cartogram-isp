<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { TransitionRoot } from "@headlessui/vue";
import {
  geomTypeCircle,
  geomTypeLine,
  geomTypePolygon,
  geomTypeSymbol,
} from "~/constants";
import SvgoIcTower2 from "~/assets/icons/ic-tower-2.svg";

const mapLayerStore = useMapLayer();
const mapRefStore = useMapRef();

// Buffer legend items
const bufferLegendItems = ref<
  Array<{ owner: string; color: string; strokeColor: string }>
>([]);

// Color mapping for buffer owners
const getOwnerColor = (owner: string): { fill: string; stroke: string } => {
  const colors: Record<string, { fill: string; stroke: string }> = {
    TBG: { fill: "#F5C400", stroke: "#FFEA00" }, // Blue
    Alfa: { fill: "#EF4444", stroke: "#dc2626" }, // Red
    Gihon: { fill: "#2563eb", stroke: "#2563eb" }, // Amber
    Baclom: { fill: "#F59E0B", stroke: "#F59E0B" },
    CTM: { fill: "#10B981", stroke: "#10B981" }, // Violet
    PKP: { fill: "#8B5CF6", stroke: "#8B5CF6" }, // Green
  };
  return colors[owner] || { fill: "#6b7280", stroke: "#4b5563" }; // Default gray
};

// Check if buffer layer exists and update legend
const updateBufferLegend = () => {
  if (!mapRefStore.map) return;

  const map = mapRefStore.map;
  const source = map.getSource("fwa-buffer-analysis");

  if (source && source.type === "geojson") {
    const data = (source as any)._data;
    if (data?.features) {
      // Collect unique owners
      const uniqueOwners = new Set<string>();
      data.features.forEach((feature: any) => {
        const owner = feature.properties?.owner;
        if (owner) uniqueOwners.add(owner);
      });

      // Update buffer legend items
      bufferLegendItems.value = Array.from(uniqueOwners).map((owner) => {
        const colors = getOwnerColor(owner);
        return {
          owner,
          color: colors.fill,
          strokeColor: colors.stroke,
        };
      });
    } else {
      bufferLegendItems.value = [];
    }
  } else {
    bufferLegendItems.value = [];
  }
};

// Watch for map changes
watch(
  () => mapRefStore.map,
  (newMap) => {
    if (newMap) {
      // Check immediately
      updateBufferLegend();

      // Listen for source changes
      newMap.on("sourcedata", (e) => {
        if (e.sourceId === "fwa-buffer-analysis" && e.isSourceLoaded) {
          updateBufferLegend();
        }
      });

      // Listen for layer removal
      newMap.on("styledata", () => {
        updateBufferLegend();
      });
    }
  },
  { immediate: true },
);

const getPropertyNameFromExpression = (expression: any[]): string | null => {
  if (Array.isArray(expression) && expression.length > 1) {
    const firstCondition = expression[1];
    if (
      Array.isArray(firstCondition) &&
      firstCondition[0] === "==" &&
      Array.isArray(firstCondition[1]) &&
      firstCondition[1][0] === "get"
    ) {
      return firstCondition[1][1];
    }
  }
  return null;
};

const parseMapboxExpression = (
  expression: string | any[],
): { grade: string; color: string }[] | null => {
  try {
    if (typeof expression === "string") {
      const cleanExpression = expression
        .replace(/\n/g, "")
        .replace(/'/g, '"')
        .trim();
      expression = JSON.parse(cleanExpression);
    }

    // Handle "match" expression (used for tower icons)
    if (Array.isArray(expression) && expression[0] === "match") {
      const cases = [];

      // Parse match pairs: value1, color1, value2, color2, ..., default
      for (let i = 2; i < expression.length - 1; i += 2) {
        const value = expression[i];
        const color = expression[i + 1];

        cases.push({
          grade: value,
          color: color,
        });
      }

      // Sort by grade
      cases.sort((a, b) => a.grade.localeCompare(b.grade));

      return cases;
    }

    // Handle "case" expression (used for polygon/circle layers)
    if (Array.isArray(expression) && expression[0] === "case") {
      const cases = [];
      const defaultColor = expression[expression.length - 1];
      // Get the property name from the first condition
      const propertyName = getPropertyNameFromExpression(expression);

      if (!propertyName) return null;

      for (let i = 1; i < expression.length - 1; i += 2) {
        const condition = expression[i];
        const color = expression[i + 1];

        if (
          Array.isArray(condition) &&
          condition[0] === "==" &&
          Array.isArray(condition[1]) &&
          condition[1][0] === "get" &&
          condition[1][1] === propertyName
        ) {
          cases.push({
            grade: condition[2],
            color: color,
          });
        }
      }

      // Sort  by grade
      cases.sort((a, b) => a.grade.localeCompare(b.grade));

      return cases;
    }
    return null;
  } catch (e) {
    console.error("Error parsing expression:", e);
    console.error("Original expression:", expression);
    return null;
  }
};

// Get all layers from store
const legendLists = computed(() => {
  return mapLayerStore.groupedActiveLayers
    ?.map(({ layerLists }) => layerLists)
    .flat()
    .filter((el) => el.source === "vector_tiles");
});

const getColorMappings = (
  layerStyle: any,
  geometryType: string,
  layerId?: string,
) => {
  // Special handling for school POI upload layer
  if (layerId === "poi_upload_sekolah_circle") {
    return [
      { grade: "SD", color: "#10B981" },
      { grade: "PAUD", color: "#F5C400" },
      { grade: "SMP", color: "#EF4444" },
      { grade: "SMA", color: "#F59E0B" },
      { grade: "SMK", color: "#3B82F6" },
      { grade: "PNFI", color: "#8B5CF6" },
      { grade: "SLB", color: "#8B7280" },
    ];
  }

  if (geometryType === geomTypePolygon && !layerStyle?.paint_fill_color) {
    return null;
  }
  if (geometryType === geomTypeCircle && !layerStyle?.paint_circle_color) {
    return null;
  }
  if (geometryType === geomTypeSymbol && !layerStyle?.paint_icon_color) {
    return null;
  }

  const expression =
    geometryType === geomTypePolygon
      ? layerStyle.paint_fill_color
      : geometryType === geomTypeCircle
        ? layerStyle.paint_circle_color
        : geometryType === geomTypeSymbol
          ? layerStyle.paint_icon_color
          : null;

  if (!expression) return null;

  return parseMapboxExpression(expression);
};

const getLegendStyle = (item: any, mapping?: { color: string }) => {
  const style: any = {};

  if (item.geometry_type === geomTypeCircle) {
    style.backgroundColor =
      mapping?.color || item.layer_style.paint_circle_color;
    style.opacity = item.layer_style.paint_circle_opacity;
    if (item.layer_style.paint_circle_stroke_width !== 0) {
      style.border = `2px solid ${item.layer_style.paint_circle_stroke_color}`;
    }
  } else if (item.geometry_type === geomTypePolygon) {
    style.backgroundColor = mapping?.color || item.layer_style.paint_fill_color;
    style.opacity = item.layer_style.paint_fill_opacity;
    // Add border for better visibility
    if (item.layer_style.paint_fill_outline_color) {
      style.border = `1px solid ${item.layer_style.paint_fill_outline_color}`;
    }
  } else if (item.geometry_type === geomTypeLine) {
    style.backgroundColor = item.layer_style.paint_line_color;
    style.opacity = item.layer_style.paint_line_opacity;
  } else if (item.geometry_type === geomTypeSymbol) {
    // For tower symbol layers
    style.backgroundColor = mapping?.color || item.layer_style.paint_icon_color;
    style.opacity = item.layer_style.paint_icon_opacity || 0.9;
  }

  return style;
};

const isLayerVisible = (item: any) => {
  return (
    item.layer_style.layout_visibility === "visible" &&
    !item.layer_alias?.includes("_footprint")
  );
};

const groupedLegend = computed(() => {
  const sitesPoint = legendLists.value.filter(
    (el) => el.layer_name === "site_points",
  );
  const assets = legendLists.value.filter((el) => el.layer_name === "assets");
  const cables = legendLists.value.filter((el) => el.layer_name === "cables");
  const routes = legendLists.value.filter((el) => el.layer_name === "routes");
  const administration = legendLists.value.filter(
    (el) => el.category?.category_name === "Administration",
  );
  const dataSupports = legendLists.value.filter(
    (el) => el.category?.category_name === "Data Supports",
  );

  return {
    sites_point: {
      name: "Sites Point",
      data: sitesPoint,
      hasVisibleLayers: sitesPoint.some((item) => isLayerVisible(item)),
    },
    assets: {
      name: "Assets",
      data: assets,
      hasVisibleLayers: assets.some((item) => isLayerVisible(item)),
    },
    cables: {
      name: "Cables",
      data: cables,
      hasVisibleLayers: cables.some((item) => isLayerVisible(item)),
    },
    routes: {
      name: "Routes",
      data: routes,
      hasVisibleLayers: routes.some((item) => isLayerVisible(item)),
    },
    administration: {
      name: "Administration",
      data: administration,
      hasVisibleLayers: administration.some((item) => isLayerVisible(item)),
    },
    data_supports: {
      name: "Data Supports",
      data: dataSupports,
      hasVisibleLayers: dataSupports.some((item) => isLayerVisible(item)),
    },
  };
});
</script>

<template>
  <h2 class="p-3 text-xs font-semibold text-grey-800">Legend</h2>
  <hr class="mx-3" />

  <div
    class="p-3 flex-1 overflow-y-auto transition-all duration-500 ease-in-out"
  >
    <!-- Empty State -->
    <div
      v-if="
        !legendLists?.length &&
        !bufferLegendItems.length &&
        (!groupedLegend ||
          Object.values(groupedLegend).every((g) => !g.hasVisibleLayers))
      "
      class="flex flex-col items-center justify-center py-8 px-4"
    >
      <div class="text-center space-y-3">
        <div
          class="w-16 h-16 mx-auto bg-grey-100 rounded-full flex items-center justify-center"
        >
          <svg
            class="w-8 h-8 text-grey-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
            />
          </svg>
        </div>
        <div>
          <h3 class="text-sm font-semibold text-grey-900">No Legend Items</h3>
          <p class="text-xs text-grey-600 mt-1 font-raleway">
            No visible layers to display in the legend
          </p>
        </div>
      </div>
    </div>

    <!-- Buffer Legend -->
    <div v-if="bufferLegendItems.length > 0" class="mb-4">
      <p class="text-xs font-semibold text-grey-800 mb-2">
        FWA Buffer Analysis
      </p>
      <div class="space-y-1.5">
        <div
          v-for="item in bufferLegendItems"
          :key="item.owner"
          class="flex items-center gap-2"
        >
          <div
            class="w-4 h-4 rounded flex-shrink-0"
            :style="{
              backgroundColor: item.color,
              border: `2px solid ${item.strokeColor}`,
              opacity: 0.7,
            }"
          ></div>
          <span class="text-2xs text-grey-700">{{ item.owner }}</span>
        </div>
      </div>
      <hr class="my-3" />
    </div>

    <div
      v-if="groupedLegend"
      v-for="(group, index) in groupedLegend"
      :key="index"
      class="space-y-2"
    >
      <p
        v-if="group.hasVisibleLayers"
        class="text-sm font-semibold mt-3 first:mt-0"
      >
        {{ group.name }}
      </p>
      <div class="flex flex-col">
        <template
          v-for="(item, index) in group.data as VectorTiles[]"
          :key="item.label"
        >
          <TransitionRoot
            :show="isLayerVisible(item)"
            enter="transition duration-500 ease-in-out"
            enterFrom="transform max-h-0 opacity-0"
            enterTo="transform max-h-96 opacity-100"
            leave="transition duration-500 ease-in-out"
            leaveFrom="transform max-h-96 opacity-100"
            leaveTo="transform max-h-0 opacity-0"
            class="transition-all duration-500 ease-in-out max-h-[500px] overflow-y-auto"
          >
            <div class="pb-2">
              <p class="text-xs text-grey-800">
                {{ item.layer_alias || item.layer_name }}
              </p>
              <p class="text-2xs text-grey-400">{{ item.geometry_type }}</p>

              <!-- Dynamic color mappings  -->
              <template
                v-if="
                  (item.geometry_type === geomTypePolygon ||
                    item.geometry_type === geomTypeCircle ||
                    item.geometry_type === geomTypeSymbol) &&
                  getColorMappings(
                    item.layer_style,
                    item.geometry_type,
                    item.layer_id,
                  )
                "
              >
                <div
                  v-for="(mapping, i) in getColorMappings(
                    item.layer_style,
                    item.geometry_type,
                    item.layer_id,
                  )"
                  :key="i"
                  class="flex items-center space-x-2"
                >
                  <!-- Tower icon for tower symbol layers with color mappings -->
                  <SvgoIcTower2
                    v-if="
                      item.geometry_type === geomTypeSymbol &&
                      (item.layer_alias?.toLowerCase().includes('tower') ||
                        item.layer_name === 'towers' ||
                        item.category?.category_name
                          ?.toLowerCase()
                          .includes('tower'))
                    "
                    :fontControlled="false"
                    class="h-5 w-5 mt-1 shrink-0"
                    :style="{ color: mapping.color || '#6B7280' }"
                  />
                  <!-- Regular colored indicators for other types -->
                  <div
                    v-else
                    :class="{
                      'h-4 w-4 mt-1': true,
                      'rounded-full': item.geometry_type === geomTypeCircle,
                      'rounded-xxs': item.geometry_type === geomTypePolygon,
                      'rounded-sm': item.geometry_type === geomTypeSymbol,
                    }"
                    :style="
                      mapping.color
                        ? { backgroundColor: mapping.color, opacity: 0.9 }
                        : {}
                    "
                  ></div>
                  <p class="text-2xs text-grey-400">{{ mapping.grade }}</p>
                </div>
              </template>

              <!-- Default  -->
              <template v-else>
                <div
                  v-if="item.geometry_type === geomTypeCircle"
                  class="h-4 w-4 rounded-full mt-1"
                  :style="getLegendStyle(item)"
                ></div>

                <div
                  v-else-if="item.geometry_type === geomTypePolygon"
                  class="h-4 w-4 mt-1"
                  :style="getLegendStyle(item)"
                ></div>

                <div
                  v-else-if="item.geometry_type === geomTypeLine"
                  class="flex items-center h-1 w-4 mt-1"
                  :style="getLegendStyle(item)"
                ></div>

                <!-- Tower icon for tower symbol layers -->
                <SvgoIcTower2
                  v-else-if="
                    item.geometry_type === geomTypeSymbol &&
                    (item.layer_alias?.toLowerCase().includes('tower') ||
                      item.layer_name === 'towers' ||
                      item.category?.category_name
                        ?.toLowerCase()
                        .includes('tower'))
                  "
                  :fontControlled="false"
                  class="h-5 w-5 mt-1 shrink-0"
                  :style="{
                    color:
                      (item.layer_style as any).paint_icon_color || '#6B7280',
                  }"
                />

                <!-- Symbol with icon (for assets) -->
                <div
                  v-else-if="
                    item.geometry_type === geomTypeSymbol &&
                    (item.layer_style as any).icon_image_id
                  "
                  class="h-4 w-4 mt-1 flex items-center justify-center"
                >
                  <img
                    :src="`/panel/assets/${(item.layer_style as any).icon_image_id}`"
                    :alt="item.layer_alias || item.layer_name"
                    class="h-5 w-5 object-contain"
                  />
                </div>

                <!-- Symbol without icon (fallback) -->
                <div
                  v-else-if="item.geometry_type === geomTypeSymbol"
                  class="h-4 w-4 rounded-xxs mt-1"
                  :style="getLegendStyle(item)"
                ></div>
              </template>
            </div>
          </TransitionRoot>
        </template>
      </div>
    </div>
  </div>
</template>
