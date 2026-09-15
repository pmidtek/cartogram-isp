<script setup lang="ts">
import { TransitionRoot } from "@headlessui/vue";
import IcBuffer from "~/assets/icons/ic-buffer.svg";
import { storeToRefs } from "pinia";
import type { ToolItem } from "~/utils/types";
import type { GeoJSONSource } from "maplibre-gl";
import IcConnection from "~/assets/icons/ic-connection.svg";
import IcAddData from "~/assets/icons/ic-layer-plus.svg";
import IcAsset from "~/assets/icons/ic-assets.svg";
import IcCable from "~/assets/icons/ic-cable.svg";
import IcArrowFat from "~/assets/icons/ic-arrow-fat.svg";
import IcChart from "~/assets/icons/ic-chart.svg";
import IcDrawFree from "~/assets/icons/ic-draw-free.svg";
import IcDrawSquare from "~/assets/icons/ic-draw-square.svg";
import IcMapFlat from "~/assets/icons/ic-map-flat.svg";
import IcRoute from "~/assets/icons/ic-route.svg";
import IcCore from "~/assets/icons/ic-core.svg";
import IcRuler from "~/assets/icons/ic-ruler.svg";
import IcRulerCorner from "~/assets/icons/ic-ruler-corner.svg";
import IcMapLayerB from "~/assets/icons/ic-map-layer-b.svg";
import IcIntersect from "~/assets/icons/ic-intersect.svg";
import IcDifference from "~/assets/icons/ic-difference.svg";
import IcInsight from "~/assets/icons/ic-insight.svg";
import IcPeopleTag from "~/assets/icons/ic-people-tag.svg";
import IcTools from "~/assets/icons/ic-tools.svg";
import IcTableJoin1 from "~/assets/icons/ic-tablejoin-1.svg";
import IcPole from "~/assets/icons/ic-pole.svg";
import IcScissors from "~/assets/icons/ic-scissors.svg";
import IcAttribute from "~/assets/icons/ic-attribute.svg";

import Icon from "~/components/core/Button/Icon.vue";
import { useMapModule } from "~/stores/useMapModule";

const featureStore = useFeature();
const { typeFeature } = storeToRefs(featureStore);
const mapModuleStore = useMapModule();
const { currentModule } = storeToRefs(mapModuleStore);
const showIsochroneCard = ref(false);
const store = useTableData();
const { showTable } = storeToRefs(store);

const mapRefStore = useMapRef();
const { map } = storeToRefs(mapRefStore);

const analysisStore = useAnalysisResult();

const toolsStore = useMapTools();
const { showCard, showTools } = storeToRefs(toolsStore);

const activeTools = shallowRef<ToolItem | null>(null);

const MODULE_TOOL_CONFIG: Record<
  string,
  Array<{ id: string; label: string; icon: any }>
> = {
  backbone: [
    {
      id: "add_data_sitepoint",
      label: "Add Sitepoint",
      icon: IcAddData,
    },
    {
      id: "add_assets",
      label: "Add Assets",
      icon: IcAsset,
    },
    {
      id: "edit_attribute_asset",
      label: "Edit Attribute Asset",
      icon: IcAttribute,
    },
    {
      id: "add_data_cable",
      label: "Add Cable",
      icon: IcCable,
    },
    {
      id: "add_data_routes",
      label: "Add Route",
      icon: IcRoute,
    },
    {
      id: "edit_route_geometry",
      label: "Edit Route",
      icon: IcRoute,
    },
    {
      id: "edit_site_point",
      label: "Edit Site Point",
      icon: IcAddData,
    },
    {
      id: "core_transaction",
      label: "Core Config",
      icon: IcCore,
    },
    {
      id: "generate_pole",
      label: "Generate Pole",
      icon: IcPole,
    },
  ],
  backhaul: [
    {
      id: "add_data_sitepoint",
      label: "Add Sitepoint",
      icon: IcAddData,
    },
    {
      id: "add_assets",
      label: "Add Assets",
      icon: IcAsset,
    },
    {
      id: "edit_attribute_asset",
      label: "Edit Attribute Asset",
      icon: IcAttribute,
    },
    {
      id: "add_data_cable",
      label: "Add Cable",
      icon: IcCable,
    },
    {
      id: "add_data_routes",
      label: "Add Route",
      icon: IcRoute,
    },
    {
      id: "edit_route_geometry",
      label: "Edit Route",
      icon: IcRoute,
    },
    {
      id: "edit_site_point",
      label: "Edit Site Point",
      icon: IcAddData,
    },
    {
      id: "split_routes",
      label: "Split Routes",
      icon: IcScissors,
    },
    {
      id: "split_cable",
      label: "Split Cable",
      icon: IcScissors,
    },
    {
      id: "core_transaction",
      label: "Core Config",
      icon: IcCore,
    },
    {
      id: "generate_pole",
      label: "Generate Pole",
      icon: IcPole,
    },
  ],
  FWA: [
    {
      id: "add_data_sitepoint",
      label: "Add Towers",
      icon: IcAddData,
    },
    {
      id: "buffer_area_new",
      label: "Buffer Area",
      icon: IcBuffer,
    },
    {
      id: "potential_analysis",
      label: "Potential Analysis",
      icon: IcBuffer,
    },
    {
      id: "fix_quadrant_based",
      label: "Fix Quadrant Based",
      icon: IcBuffer,
    },
    {
      id: "directional_quadrant_method",
      label: "Directional Quadrant Method",
      icon: IcBuffer,
    },
    {
      id: "antenna_direction",
      label: "Antenna Direction",
      icon: IcInsight,
    },
  ],
  "market-potential": [
    {
      id: "market_potential_analysis",
      label: "Potential Analysis",
      icon: IcInsight,
    },
    {
      id: "market_route_analysis",
      label: "Route Analysis",
      icon: IcRoute,
    },
  ],
};

const analysisTools = computed(() => {
  const module = currentModule.value;
  const toolConfigs = module
    ? MODULE_TOOL_CONFIG[module.typeFeature] || []
    : [];

  if (!toolConfigs.length) {
    return [];
  }

  return toolConfigs.map((config) => ({
    ...config,
    action: (item: ToolItem) => handleOpenToolsCard(item),
  }));
});

const handleOpenToolsCard = (item: ToolItem) => {
  showCard.value = true;
  showTools.value = false;
  activeTools.value = item;
  if (
    item.id === "digitize" ||
    item.id === "length" ||
    item.id === "area" ||
    item.id === "buffer_area" ||
    item.id === "buffer_line" ||
    item.id === "buffer_area_new"
  ) {
    mapRefStore.drawMode = true;
  }
  if (item.id === "potential_analysis") {
    showCard.value = false;
    showTools.value = true;
    featureStore.setMapInfo("analytic");
    analysisStore.setCurrentAnalysisType("potential_analysis");
  }
};

const handleCloseToolsCard = () => {
  showCard.value = false;
  showTools.value = true;
  setTimeout(() => {
    activeTools.value = null;
  }, 400);
  if (activeTools.value?.id === "digitize") {
    mapRefStore.drawMode = false;
  }
};

const removeAllAnimation = () => {
  if (map.value?.getSource("highlight")) {
    (map.value?.getSource("highlight") as GeoJSONSource).setData(
      emptyFeatureCollection,
    );
  }
  pauseAllAnimation();
};
</script>

<template>
  <TransitionRoot
    as="div"
    :show="!showTable && showTools"
    enter="transition-all duration-300"
    enter-from="-mb-6 opacity-0"
    enter-to="mb-0 opacity-1"
    leave="transition-all duration-300"
    leave-from="mb-0 opacity-1"
    leave-to="-mb-6 opacity-0"
    class="z-10 absolute bottom-8 left-1/2 -translate-x-1/2 rounded-xs transition-all duration-1000 ease-in-out"
  >
    <div
      class="flex items-center gap-2 bg-white ring-1 ring-grey-700 rounded-xs p-2 transition-all duration-1000 ease-in-out"
    >
      <MapToolsQuickRequest v-if="typeFeature === 'FWA'" />
      <MapToolsQuickRouteInsight v-if="typeFeature === 'FWA'" />
      <MapToolsDropdown
        v-if="
          typeFeature !== 'market-potential' && typeFeature !== 'ftth-mapping'
        "
        :triggerLabel="'Tools'"
        :triggerIcon="IcChart"
        :itemLabel="'Map Tools'"
        :itemDescription="'Geospatial tools to draw insights and add data from the map.'"
        :items="analysisTools as ToolItem[]"
      />
      <div
        class="flex items-center gap-2 bg-white transition-all duration-1000 ease-in-out"
        v-if="typeFeature === 'market-potential'"
      >
        <MapToolsDropdown
          :triggerLabel="'Analytic Tools'"
          :triggerIcon="IcChart"
          :itemLabel="'Analytic Tools'"
          :itemDescription="'Geospatial Analytic Tools to draw Insights from the Map.'"
          :items="[
            // {
            //   id: 'advanced_insight',
            //   label: 'Advanced Insight',
            //   icon: IcTools,
            //   action: () => console.log('advanced_insight'),
            // },
            // {
            //   id: 'boundary',
            //   label: 'Boundary Area',
            //   icon: IcDrawSquare,
            //   action: (item) => {
            //     handleOpenToolsCard(item!);
            //   },
            // },
            {
              id: 'digitize',
              label: 'Digitize',
              icon: IcDrawFree,
              action: (item) => {
                handleOpenToolsCard(item!);
              },
            },
            {
              id: 'buffer_area',
              label: 'Buffer Area',
              icon: IcDrawSquare,
              action: (item) => {
                handleOpenToolsCard(item!);
              },
            },
            // {
            //   id: 'upload',
            //   label: 'Upload Polygon',
            //   icon: IcRoute,
            //   action: (item) => {
            //     handleOpenToolsCard(item!);
            //   },
            // },

            {
              id: 'specific',
              label: 'Specific Layer',
              icon: IcMapLayerB,
              action: (item) => {
                handleOpenToolsCard(item!);
              },
            },
            {
              id: 'select_location',
              label: 'Select By Location',
              icon: IcMapLayerB,
              action: (item) => {
                handleOpenToolsCard(item!);
              },
            },
          ]"
        >
        </MapToolsDropdown>
        <MapToolsDropdown
          v-if="typeFeature === 'market-potential'"
          :triggerLabel="'Geoprocessing'"
          :itemLabel="'Geoprocessing Tools'"
          :itemDescription="'Geospatial tools to draw insights and add data from the map.'"
          :triggerIcon="IcMapLayerB"
          :items="[
            {
              id: 'intersect',
              label: 'Intersect Tool',
              icon: IcIntersect,
              action: (item) => {
                handleOpenToolsCard(item!);
              },
            },
            {
              id: 'difference',
              label: 'Difference Tool',
              icon: IcDifference,
              action: (item) => {
                handleOpenToolsCard(item!);
              },
            },
            {
              id: 'spatial-join',
              label: 'Spatial Join Tool',
              icon: IcIntersect,
              action: (item) => {
                handleOpenToolsCard(item!);
              },
            },
            {
              id: 'table-join',
              label: 'Table Join Tool',
              icon: IcTableJoin1,
              action: (item) => {
                handleOpenToolsCard(item!);
              },
            },
            {
              id: 'route_finder',
              label: 'Route Finder',
              icon: IcRoute,
              action: (item) => {
                handleOpenToolsCard(item!);
              },
            },
            {
              id: 'ftth_analysis',
              label: 'FTTH Analysis',
              icon: IcConnection,
              action: (item) => {
                handleOpenToolsCard(item!);
              },
            },
          ]"
        ></MapToolsDropdown>
        <MapToolsDropdown
          v-if="typeFeature === 'market-potential'"
          :triggerLabel="'Insight Analysis'"
          :triggerIcon="IcChart"
          :itemLabel="'Potential Analysis'"
          :itemDescription="'Insight Analysis to draw insights and add data from the map.'"
          :items="analysisTools as ToolItem[]"
        />
        <div class="border-l border-grey-700 h-8"></div>
        <MapToolsDropdown
          :triggerIcon="IcRuler"
          :triggerLabel="'Measurement'"
          :itemLabel="'Measurement'"
          :itemDescription="'Draw on Map and add to layer'"
          :items="[
            {
              id: 'length',
              label: 'Length',
              labelCard: 'Length Measurement Tool',
              icon: IcRuler,
              action: (item) => {
                removeAllAnimation();
                handleOpenToolsCard(item!);
              },
            },
            {
              id: 'area',
              label: 'Area',
              labelCard: 'Area Measurement Tool',
              icon: IcRulerCorner,
              action: (item) => {
                removeAllAnimation();
                handleOpenToolsCard(item!);
              },
            },
          ]"
        ></MapToolsDropdown>
      </div>
      <MapToolsDropdown
        :triggerLabel="'Basemap'"
        :triggerIcon="IcMapFlat"
        :itemLabel="'Basemap'"
        :itemDescription="'Change basemap'"
      >
        <template #custom-item>
          <MapToolsBasemap />
        </template>
      </MapToolsDropdown>
    </div>
  </TransitionRoot>

  <MapToolsCard
    :active="showCard"
    :onClose="handleCloseToolsCard"
    :label="activeTools?.labelCard || activeTools?.label"
    :icon="activeTools?.icon"
  >
    <MapToolsQuickInsightMarket
      v-if="activeTools?.id === 'market_potential_analysis'"
    />
    <MapToolsQuickRouteMarket
      v-if="activeTools?.id === 'market_route_analysis'"
    />
    <MapToolsLength v-if="activeTools?.id === 'length'" />
    <MapToolsArea v-else-if="activeTools?.id === 'area'" />
    <MapToolsDigitize v-else-if="activeTools?.id === 'digitize'" />
    <MapToolsBoundaryArea v-else-if="activeTools?.id === 'boundary'" />
    <MapToolsUploadPolygon
      v-else-if="activeTools?.id === 'upload'"
      :sort-order="{ id: 'asc', name: 'Sort - Alphabetical (A-Z)' }"
    />
    <MapToolsQuickInsight v-else-if="activeTools?.id === 'insight'" />
    <MapToolsFindCoordinate v-else-if="activeTools?.id === 'find_coordinate'" />
    <MapToolsSelectLocation v-else-if="activeTools?.id === 'select_location'" />
    <MapToolsIntersect v-else-if="activeTools?.id === 'intersect'" />
    <MapToolsDifference v-else-if="activeTools?.id === 'difference'" />
    <MapToolsSpatialJoin
      v-else-if="activeTools?.id === 'spatial-join'"
      @on-close="handleCloseToolsCard"
    />
    <MapToolsTableJoin
      v-else-if="activeTools?.id === 'table-join'"
      @on-close="handleCloseToolsCard"
    />
    <MapToolsSpecificLayer v-else-if="activeTools?.id === 'specific'" />
    <MapToolsRouteFinder v-else-if="activeTools?.id === 'route_finder'" />
    <MapToolsFtth v-else-if="activeTools?.id === 'ftth_analysis'" />
    <MapToolsStreetView v-else-if="activeTools?.id === 'street_view'" />
    <MapToolsLineBuffer v-else-if="activeTools?.id === 'buffer_line'" />
    <MapToolsBufferAreaNew v-else-if="activeTools?.id === 'buffer_area_new'" />
    <MapToolsBuffer v-else-if="activeTools?.id === 'buffer_area'" />
    <MapToolsAddBackboneData
      v-else-if="activeTools?.id === 'add_data_sitepoint'"
    />
    <MapToolsAddCableData v-else-if="activeTools?.id === 'add_data_cable'" />
    <MapToolsAddRoutesData v-else-if="activeTools?.id === 'add_data_routes'" />
    <MapToolsAddAssets v-else-if="activeTools?.id === 'add_assets'" />
    <MapToolsCoreTransaction
      v-else-if="activeTools?.id === 'core_transaction'"
    />
    <MapToolsFixQuadrantBased
      v-else-if="activeTools?.id === 'fix_quadrant_based'"
    />
    <MapToolsDirectionalQuadrantMethod
      v-else-if="activeTools?.id === 'directional_quadrant_method'"
    />
    <MapToolsAntennaDirection
      v-else-if="activeTools?.id === 'antenna_direction'"
    />
    <MapToolsEditRouteGeometry
      v-else-if="activeTools?.id === 'edit_route_geometry'"
      @on-close="handleCloseToolsCard"
    />
    <MapToolsEditSitePoint
      v-else-if="activeTools?.id === 'edit_site_point'"
      @on-close="handleCloseToolsCard"
    />
    <MapToolsSplitRoutes
      v-else-if="activeTools?.id === 'split_routes'"
      @on-close="handleCloseToolsCard"
    />
    <MapToolsSplitCable
      v-else-if="activeTools?.id === 'split_cable'"
      @on-close="handleCloseToolsCard"
    />
    <MapToolsGeneratePole
      v-else-if="activeTools?.id === 'generate_pole'"
      @on-close="handleCloseToolsCard"
    />
    <MapToolsEditAttributeAsset
      v-else-if="activeTools?.id === 'edit_attribute_asset'"
    />
  </MapToolsCard>

  <!-- BOQ/BOM Tools -->
  <MapToolsBoqBomDrawPolygon
    v-if="analysisStore.boqBomToolActive === 'draw_polygon'"
  />
  <MapToolsBoqBomSelectionPolygon
    v-if="analysisStore.boqBomToolActive === 'selection_polygon'"
  />
</template>
