<script setup lang="ts">
import { TransitionRoot } from "@headlessui/vue";
import IcBasemap from "~/assets/icons/ic-basemap.svg";
import IcInfo from "~/assets/icons/ic-info.svg";
import IcChart from "~/assets/icons/ic-chart.svg";
import IcRectangleList from "~/assets/icons/ic-rectangle-list.svg";
import IcLocation from "~/assets/icons/ic-location.svg";
import IcMapExtent from "~/assets/icons/ic-map-instance.svg";
import IcList from "~/assets/icons/ic-list-A.svg";
import IcMapLayer from "~/assets/icons/ic-map-layer.svg";
import IcZoomIn from "~/assets/icons/ic-plus.svg";
import IcZoomOut from "~/assets/icons/ic-min.svg";
import IcAttribute from "~/assets/icons/ic-attribute.svg";
import IcMapLayerB from "~/assets/icons/ic-map-layer-b.svg";
import IcTime from "~/assets/icons/ic-time.svg";
import IcNodeLeft1 from "~/assets/icons/ic-nodeleft1.svg";
import { useMapData } from "~/utils";
import { storeToRefs } from "pinia";
import bbox from "@turf/bbox";
import type { LngLatBoundsLike } from "maplibre-gl";

import { useExpandStore } from "~/stores/useIsExpand";
import { onMounted, nextTick } from "vue";
import type { typeFeatureEnum } from "~/stores/useFeature";
import { useMapModule } from "~/stores/useMapModule";
import { useMapLayer } from "~/stores/useMapLayer";

const route = useRoute();
const router = useRouter();
const analysisType = computed(() => {
  return route.params.analysis;
});
const toolsStore = useMapTools();
const { showCard, showTools } = storeToRefs(toolsStore);
const expandStore = useExpandStore();
const isModalOpen = ref(true);
const featureStore = useFeature();
const {
  isShowLayerManagement,
  isShowLegend,
  isShowProject,
  mapInfo,
  typeFeature,
} = storeToRefs(featureStore);
const isShowActivity = ref(false);
const mapStore = useMapRef();

const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);

const layerStore = useMapLayer();
const { fetchActiveLayers, clearAllAnalysisLayers } = layerStore;

const ftthWatcher = useFtthAnalysisWatcher();

const { data: mapData } = await useMapData();
const store = useMapRef();
const { map, geolocateRef } = storeToRefs(store);

const storeTableData = useTableData();
const { showTable, fullscreen } = storeToRefs(storeTableData);

const storeCatalogue = useCatalogue();
const { showCatalogue } = storeToRefs(storeCatalogue);
const currentZoom = ref(map.value?.getZoom().toPrecision(3));

const updateZoomValue = () => {
  currentZoom.value = map.value?.getZoom().toPrecision(3);
};

onMounted(() => {
  expandStore.isExpand = false;
  featureStore.setMapInfo("");

  // Open project drawer by default for ftth-mapping
  if (typeFeature.value === "ftth-mapping") {
    isShowProject.value = true;
    ftthWatcher.start();
  }
});

onUnmounted(() => {
  featureStore.setMapInfo("");
  isShowProject.value = false;
  ftthWatcher.stop();
});

watchEffect(() => {
  if (mapStore.selectedCity || mapStore.selectedProvince) {
    isShowLayerManagement.value = true;
    isShowActivity.value = false;
  }
});

watch(isShowLayerManagement, (newValue) => {
  if (newValue) {
    isShowActivity.value = false;
    isShowProject.value = false;
  }
});

watch(isShowProject, (newValue) => {
  if (newValue) {
    isShowLayerManagement.value = false;
    isShowActivity.value = false;
  }
});

watchEffect((onCleanup) => {
  map.value?.on("load", () => updateZoomValue());
  map.value?.on("moveend", () => updateZoomValue());

  onCleanup(() => {
    map.value?.off("load", () => updateZoomValue());
    map.value?.off("moveend", () => updateZoomValue());
  });
});

watch(analysisType, (newAnalysistype) => {
  featureStore.setMapInfo("");
  showCard.value = false;
  showTools.value = true;
});

const ensureParam = (value: unknown) => {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.length > 0) {
    return value[0] as string;
  }
  return null;
};

watch(
  analysisType,
  (param) => {
    const resolved = ensureParam(param);
    if (!resolved) {
      const fallback = moduleStore.getModule("backbone");
      if (fallback) {
        router.replace(moduleStore.resolveRoute(fallback));
      }
      return;
    }

    const matched = moduleStore.setActiveModuleByRouteParam(resolved);
    if (!matched) {
      const fallback = moduleStore.getModule("backbone");
      if (fallback) {
        router.replace(moduleStore.resolveRoute(fallback));
      }
    }
  },
  { immediate: true },
);

watch(
  currentModule,
  async (module) => {
    if (module) {
      // Clear all existing analysis layers before fetching new ones
      // This prevents duplicate layers when switching between modules
      clearAllAnalysisLayers();
      await fetchActiveLayers(module.slug);
    }
  },
  { immediate: true },
);
</script>

<template>
  <div
    :class="[
      (showCatalogue || (showTable && fullscreen)) && 'z-50',
      'absolute top-0 left-0 w-screen h-screen flex flex-col items-start',
    ]"
  >
    <Map :key="currentModule?.slug"></Map>
    <MapLayerAdministrationCentroids v-if="map" />
    <MapLayerSpDataFootprint v-if="map" />

    <!-- <MapIntroModal /> -->

    <!-- left sidebar -->
    <TransitionRoot
      as="div"
      :show="isShowLayerManagement"
      enter="transform transition-all duration-300"
      enter-from="-ml-8 opacity-0"
      enter-to="ml-0 opacity-1"
      leave="transform transition-all duration-300"
      leave-from="ml-0 opacity-1"
      leave-to="-ml-8 opacity-0"
      class="z-10 absolute top-[5.5rem] bg-white w-[18.5rem] rounded-xs left-6 h-full max-h-[calc(100%-12rem)] overflow-hidden flex flex-col"
    >
      <MapManagement />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="isShowProject"
      :unmount="false"
      enter="transform transition-all duration-300"
      enter-from="-ml-8 opacity-0"
      enter-to="ml-0 opacity-1"
      leave="transform transition-all duration-300"
      leave-from="ml-0 opacity-1"
      leave-to="-ml-8 opacity-0"
      class="z-10 absolute top-[5.5rem] bg-white w-[18.5rem] rounded-xs left-6 h-full max-h-[calc(100%-12rem)] overflow-hidden flex flex-col"
    >
      <MapProject />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="isShowActivity"
      enter="transform transition-all duration-300"
      enter-from="-ml-8 opacity-0"
      enter-to="ml-0 opacity-1"
      leave="transform transition-all duration-300"
      leave-from="ml-0 opacity-1"
      leave-to="-ml-8 opacity-0"
      :class="isShowLayerManagement ? 'left-[20.5rem]' : 'left-[1.5rem]'"
      class="z-10 absolute top-[5.5rem] bg-white w-[18.5rem] rounded-xs h-full max-h-[calc(100%-12rem)] overflow-hidden flex flex-col transition-all ease-in-out duration-300"
    >
      <MapActivity />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="isShowLegend"
      enter="transition-all duration-300"
      enter-from="-ml-8 opacity-0"
      enter-to="ml-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="ml-0 opacity-1"
      leave-to="-ml-8 opacity-0"
      :class="isShowLayerManagement ? 'left-[20.5rem]' : 'left-[1.5rem]'"
      class="z-10 absolute top-[5.5rem] bg-white h-fit max-h-[calc(100%-12rem)] w-[15.5rem] rounded-xs transition-all ease-in-out duration-300 overflow-hidden flex flex-col"
    >
      <MapLegend />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="showTable"
      enter="transition-all duration-1000"
      enter-from="-ml-8 opacity-0"
      enter-to="ml-0 opacity-1"
      leave="transition-all duration-1000"
      leave-from="ml-0 opacity-1"
      leave-to="-ml-8 opacity-0"
      :class="[
        !fullscreen
          ? 'w-[calc(50vw-3rem)] h-[calc(100vh-7.5rem)] top-[5.5rem]'
          : 'w-[calc(100vw-3rem)] h-[calc(100vh-3rem)] top-[1.5rem]',
        'absolute z-20 left-[1.5rem] bg-white rounded-xs transition-all ease-in-out duration-300',
      ]"
    >
      <MapManagementTable />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="showCatalogue"
      enter="transition-all duration-1000"
      enter-from="-ml-8 opacity-0"
      enter-to="ml-0 opacity-1"
      leave="transition-all duration-1000"
      leave-from="ml-0 opacity-1"
      leave-to="-ml-8 opacity-0"
      class="w-[calc(100vw-3rem)] h-[calc(100vh-3rem)] top-[1.5rem] absolute z-[9999999] left-[1.5rem] bg-white rounded-xs transition-all ease-in-out duration-300"
    >
      <MapManagementCatalogue />
    </TransitionRoot>

    <!-- top left button controller -->
    <!-- <div
      class="z-10 absolute flex gap-2 shrink top-[1.9rem] left-[32rem] transition-all ease-in-out duration-300 items-center"
    >
      <div
        class="p-2 bg-white rounded-xs shadow-md justify-center gap-2 overflow-hidden flex items-center cursor-pointer"
        @click="() => (isShowLayerManagement = !isShowLayerManagement)"
        :class="
          isShowLayerManagement
            ? 'text-white bg-gradient-to-r from-blue-100 to-blue-600'
            : 'bg-transparent'
        "
      >
        <IcMapLayer class="w-5 h-5" :fontControlled="false" />
        <p
          class="justify-start text-[10px] font-medium font-Raleway leading-none"
        >
          Layers
        </p>
      </div>
      <div
        @click="() => (isShowLegend = !isShowLegend)"
        class="p-2 bg-white rounded-xs shadow-md justify-center gap-2 overflow-hidden flex items-center cursor-pointer"
        :class="
          isShowLegend
            ? 'text-white bg-gradient-to-r from-blue-100 to-blue-600'
            : 'bg-transparent'
        "
      >
        <IcBasemap class="w-5 h-5" :fontControlled="false" />
        <p
          class="justify-start text-[10px] font-medium font-Raleway leading-none"
        >
          Legends
        </p>
      </div>
    </div> -->

    <!-- right sidebar -->
    <TransitionRoot
      as="div"
      :show="featureStore.mapInfo === 'title-feature'"
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[30.5rem] rounded-xs max-h-[calc(100%-12rem)] overflow-hidden flex flex-col"
    >
      <MapTitle />
    </TransitionRoot>
    <!-- <TransitionRoot
      as="div"
      :show="featureStore.mapInfo === 'info'"
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[18.5rem] rounded-xs max-h-[calc(100%-12rem)] overflow-hidden flex flex-col"
    >
      <MapInformation />
    </TransitionRoot> -->
    <TransitionRoot
      as="div"
      :show="featureStore.mapInfo === 'analytic'"
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      class="z-20 absolute top-[5.5rem] right-6 bg-white w-[30.5rem] rounded-xs h-[calc(100%-12rem)] overflow-hidden flex flex-col"
    >
      <MapAnalysis />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="featureStore.mapInfo === 'add-attribute'"
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[486px] rounded-xs h-[calc(100%-12rem)] overflow-hidden flex flex-col transition-all ease-in-out duration-300"
    >
      <MapAttribute />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="featureStore.mapInfo === 'detail-info'"
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[486px] rounded-xs h-[calc(100%-12rem)] overflow-hidden flex flex-col transition-all ease-in-out duration-300"
    >
      <MapDetailInfo />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="featureStore.mapInfo === 'core-transaction'"
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[486px] rounded-xs h-[calc(100%-12rem)] overflow-hidden flex flex-col transition-all ease-in-out duration-300"
    >
      <MapCoreTransaction />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="
        featureStore.mapInfo === 'quick-request-list' &&
        typeFeature !== 'market-potential'
      "
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[486px] rounded-xs h-[calc(100%-12rem)] overflow-hidden flex flex-col transition-all ease-in-out duration-300"
    >
      <MapListQuickAnalysis />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="
        featureStore.mapInfo === 'quick-request-list' &&
        typeFeature === 'market-potential'
      "
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[486px] rounded-xs h-[calc(100%-12rem)] overflow-hidden flex flex-col transition-all ease-in-out duration-300"
    >
      <MapListPOIAnalysis />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="featureStore.rightSidebar === 'feature'"
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      :class="
        featureStore.mapInfo === 'info' ||
        featureStore.mapInfo === 'analytic' ||
        featureStore.mapInfo === 'title-feature'
          ? 'right-[20.5rem]'
          : 'right-[1.5rem]'
      "
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[18.5rem] rounded-xs h-[calc(100%-12rem)] overflow-hidden flex flex-col transition-all ease-in-out duration-300"
    >
      <MapFeatureDetail />
    </TransitionRoot>
    <!-- <TransitionRoot
      as="div"
      :show="featureStore.rightSidebar === '3d-feature'"
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      :class="
        featureStore.mapInfo === 'info' ||
        featureStore.mapInfo === 'analytic' ||
        featureStore.mapInfo === 'title-feature'
          ? 'right-[20.5rem]'
          : 'right-[1.5rem]'
      "
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[18.5rem] rounded-xs h-[calc(100%-12rem)] overflow-hidden flex flex-col"
    >
      <Map3DFeatureDetail />
    </TransitionRoot> -->

    <TransitionRoot
      as="div"
      :show="featureStore.mapInfo === 'geoprocessing'"
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      :class="
        featureStore.mapInfo === 'info' ||
        featureStore.mapInfo === 'analytic' ||
        featureStore.mapInfo === 'title-feature'
          ? 'right-[20.5rem]'
          : 'right-[1.5rem]'
      "
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[486px] rounded-xs h-[calc(100%-12rem)] overflow-hidden flex flex-col transition-all ease-in-out duration-300"
    >
      <MapGeoprocessing />
    </TransitionRoot>
    <TransitionRoot
      as="div"
      :show="featureStore.mapInfo === 'site-points'"
      enter="transition-all duration-300"
      enter-from="-mr-8 opacity-0"
      enter-to="mr-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mr-0 opacity-1"
      leave-to="-mr-8 opacity-0"
      :class="
        featureStore.mapInfo === 'info' ||
        featureStore.mapInfo === 'analytic' ||
        featureStore.mapInfo === 'title-feature'
          ? 'right-[20.5rem]'
          : 'right-[1.5rem]'
      "
      class="z-10 absolute top-[5.5rem] right-6 bg-white w-[486px] rounded-xs h-[calc(100%-12rem)] overflow-hidden flex flex-col transition-all ease-in-out duration-300"
    >
      <MapSitePoints />
    </TransitionRoot>

    <!-- top right button controller -->
    <div
      :class="
        featureStore.mapInfo === 'title-feature' ||
        featureStore.mapInfo === 'analytic' ||
        featureStore.mapInfo === 'add-attribute' ||
        featureStore.mapInfo === 'detail-info' ||
        featureStore.mapInfo === 'geoprocessing' ||
        featureStore.mapInfo === 'site-points' ||
        featureStore.mapInfo === 'quick-request-list' ||
        featureStore.mapInfo === 'core-transaction'
          ? 'right-[32.5rem]'
          : ['info', 'title-feature', 'analytic', 'detail-info'].includes(
                featureStore.mapInfo,
              ) && ['add-attribute'].includes(featureStore.rightSidebar)
            ? 'right-[15rem]'
            : ['title-feature', 'analytic'].includes(featureStore.mapInfo)
              ? 'right-[20.5rem]'
              : ['add-attribute'].includes(featureStore.rightSidebar)
                ? 'right-[32.5rem]'
                : 'right-[1.5rem]'
      "
      class="z-10 absolute flex flex-col gap-2 shrink top-[5.5rem] transition-all ease-in-out duration-300"
    >
      <MapButtonControl
        :onClick="
          () => {
            featureStore.setMapInfo(
              featureStore.mapInfo === 'title-feature' ? '' : 'title-feature',
            );
          }
        "
        :active="featureStore.mapInfo === 'title-feature'"
      >
        <UTooltip
          text="Info Feature"
          :popper="{ placement: 'left', offsetDistance: 16 }"
        >
          <IcInfo class="w-5 h-5" :fontControlled="false" />
        </UTooltip>
      </MapButtonControl>
      <MapButtonControl
        v-if="
          typeFeature !== 'market-potential' && typeFeature !== 'ftth-mapping'
        "
        :onClick="
          () => {
            featureStore.setMapInfo(
              featureStore.mapInfo === 'add-attribute' ? '' : 'add-attribute',
            );
          }
        "
        :active="featureStore.mapInfo === 'add-attribute'"
      >
        <UTooltip
          text="Add Attribute"
          :popper="{ placement: 'right', offsetDistance: 16 }"
        >
          <IcAttribute class="w-5 h-5" :fontControlled="false" />
        </UTooltip>
      </MapButtonControl>
      <!-- <MapButtonControl
        :onClick="
          () => {
            featureStore.setMapInfo(
              featureStore.mapInfo === 'info' ? '' : 'info'
            );
          }
        "
        :active="featureStore.mapInfo === 'info'"
      >
        <UTooltip
          text="Infospace"
          :popper="{ placement: 'left', offsetDistance: 16 }"
        >
          <IcInfo class="w-5 h-5" :fontControlled="false" />
        </UTooltip>
      </MapButtonControl> -->
      <MapButtonControl
        v-if="typeFeature !== 'backhaul'"
        :onClick="
          () => {
            featureStore.setMapInfo(
              featureStore.mapInfo === 'analytic' ? '' : 'analytic',
            );
          }
        "
        :active="featureStore.mapInfo === 'analytic'"
      >
        <UTooltip
          text="Analysis Result"
          :popper="{ placement: 'left', offsetDistance: 16 }"
        >
          <IcChart class="w-5 h-5" :fontControlled="false" />
        </UTooltip>
      </MapButtonControl>
      <!-- <MapButtonControl
        :onClick="
          () => {
            featureStore.setRightSidebar(
              featureStore.rightSidebar === 'feature' ||
                featureStore.rightSidebar === '3d-feature'
                ? ''
                : 'feature'
            );
          }
        "
        :active="
          featureStore.rightSidebar === 'feature' ||
          featureStore.rightSidebar === '3d-feature'
        "
      >
        <UTooltip
          text="Feature Detail"
          :popper="{ placement: 'left', offsetDistance: 16 }"
        >
          <IcRectangleList class="w-5 h-5" :fontControlled="false" />
        </UTooltip>
      </MapButtonControl> -->
      <MapButtonControl
        v-if="typeFeature !== 'backhaul' && typeFeature !== 'ftth-mapping'"
        :onClick="
          () => {
            featureStore.setMapInfo(
              featureStore.mapInfo === 'quick-request-list'
                ? ''
                : 'quick-request-list',
            );
          }
        "
        :active="featureStore.mapInfo === 'quick-request-list'"
      >
        <UTooltip
          text="Quick Request List"
          :popper="{ placement: 'right', offsetDistance: 16 }"
        >
          <IcList class="w-5 h-5" :fontControlled="false" />
        </UTooltip>
      </MapButtonControl>
      <MapButtonControl
        :onClick="
          () => {
            featureStore.setMapInfo(
              featureStore.mapInfo === 'geoprocessing' ? '' : 'geoprocessing',
            );
          }
        "
        :active="featureStore.mapInfo === 'geoprocessing'"
      >
        <UTooltip
          text="Geoprocessing"
          :popper="{ placement: 'right', offsetDistance: 16 }"
        >
          <IcMapLayerB class="w-5 h-5" :fontControlled="false" />
        </UTooltip>
      </MapButtonControl>
      <MapButtonControl
        :onClick="
          () => {
            featureStore.setMapInfo(
              featureStore.mapInfo === 'site-points' ? '' : 'site-points',
            );
          }
        "
        :active="featureStore.mapInfo === 'site-points'"
      >
        <UTooltip
          text="Site Points"
          :popper="{ placement: 'right', offsetDistance: 16 }"
        >
          <IcNodeLeft1 class="w-5 h-5" :fontControlled="false" />
        </UTooltip>
      </MapButtonControl>
    </div>

    <!-- top left button controller - Activity -->
    <div
      v-if="currentModule?.slug === 'backhaul'"
      :class="
        isShowLayerManagement && isShowLegend
          ? 'left-[36.5rem]'
          : isShowLayerManagement
            ? 'left-[20.5rem]'
            : isShowActivity && isShowLegend
              ? 'left-[37.5rem]'
              : isShowActivity
                ? 'left-[20.5rem]'
                : isShowLegend
                  ? 'left-[18rem]'
                  : 'left-[1.5rem]'
      "
      class="z-10 absolute flex flex-col gap-2 shrink top-[5.5rem] transition-all ease-in-out duration-300"
    >
      <MapButtonControl
        :onClick="
          () => {
            if (!isShowActivity) {
              isShowActivity = true;
              isShowLayerManagement = false;
            } else {
              isShowActivity = false;
            }
          }
        "
        :active="isShowActivity"
      >
        <UTooltip
          text="Activity Log"
          :popper="{ placement: 'right', offsetDistance: 16 }"
        >
          <IcTime class="w-5 h-5" :fontControlled="false" />
        </UTooltip>
      </MapButtonControl>
    </div>

    <!-- bottom left map -->
    <MapCoordinatesPanel />

    <!-- bottom toolbox -->
    <MapTools />

    <!-- bottom left map controller -->
    <div
      :class="showTable ? 'left-[calc(50vw-0.75rem)]' : 'left-6'"
      class="z-10 absolute bottom-8 left-6 transition-all ease-in-out duration-300"
    >
      <MapCompass />
    </div>

    <!-- bottom right map controller -->
    <div class="z-10 absolute bottom-8 right-6">
      <div class="flex gap-2 bg-white/30 rounded-xs p-2">
        <button
          @click="
            () => {
              map &&
                map.fitBounds(
                  bbox(
                    mapData?.data?.initial_map_view
                      ? mapData?.data?.initial_map_view
                      : [
                          [95.01, -11.01],
                          [141.02, 6.08],
                        ],
                  ) as LngLatBoundsLike,
                );
            }
          "
          class="bg-transparent hover:bg-gradient-to-r hover:from-blue-100 hover:to-blue-600 p-2 hover:text-white rounded-xs"
        >
          <IcMapExtent class="w-5 h-5" :fontControlled="false" />
        </button>
        <button
          @click="() => map && geolocateRef && geolocateRef.trigger()"
          class="bg-transparent hover:bg-gradient-to-r hover:from-blue-100 hover:to-blue-600 p-2 hover:text-white rounded-xs"
        >
          <IcLocation class="w-5 h-5" :fontControlled="false" />
        </button>
        <button
          @click="() => map && map.zoomOut()"
          class="bg-transparent hover:bg-gradient-to-r hover:from-blue-100 hover:to-blue-600 p-2 hover:text-white rounded-xs"
        >
          <IcZoomOut class="w-5 h-5" :fontControlled="false" />
        </button>
        <input
          :value="currentZoom"
          disabled
          type="text"
          class="text-xs text-center w-14 p-2 text-black rounded-xxs bg-black/5 border border-grey-600 focus:outline-none"
        />
        <button
          @click="() => map && map.zoomIn()"
          class="bg-transparent hover:bg-gradient-to-r hover:from-blue-100 hover:to-blue-600 p-2 hover:text-white rounded-xs"
        >
          <IcZoomIn class="w-5 h-5" :fontControlled="false" />
        </button>
        <!-- <button
          @click="console.log(map.getStyle())"
          class="bg-transparent hover:bg-gradient-to-r hover:from-blue-100 hover:to-blue-600 p-2 hover:text-white rounded-xs"
        >
          <IcZoomIn class="w-5 h-5" :fontControlled="false" />
        </button> -->
      </div>
    </div>

    <!-- FTTH analysis completion notification -->
    <UModal
      v-model="ftthWatcher.showDoneModal"
      :ui="{ width: 'w-full sm:max-w-md' }"
    >
      <div class="flex flex-col divide-y divide-grey-100">
        <div class="flex items-center justify-between p-4">
          <div class="flex items-center gap-2">
            <UIcon
              name="i-heroicons-check-circle"
              class="w-6 h-6 text-green-500"
            />
            <h2 class="text-lg font-semibold text-grey-900">
              FTTH Analysis Complete
            </h2>
          </div>
          <button
            @click="ftthWatcher.showDoneModal = false"
            class="text-grey-400 hover:text-grey-600"
          >
            <UIcon name="i-heroicons-x-mark" class="w-5 h-5" />
          </button>
        </div>
        <div class="p-4">
          <p class="text-sm text-grey-600">
            <template v-if="ftthWatcher.doneProjectName">
              The FTTH network for
              <span class="font-semibold text-grey-900">{{
                ftthWatcher.doneProjectName
              }}</span>
              has been generated successfully. Opening project management to
              view the result.
            </template>
            <template v-else>
              Your FTTH network analysis has been generated successfully.
              Opening project management to view the result.
            </template>
          </p>
        </div>
        <div class="flex justify-end gap-2 p-4">
          <UButton
            :ui="{
              rounded: 'rounded-xxs',
            }"
            color="primary"
            @click="ftthWatcher.showDoneModal = false"
          >
            View Project
          </UButton>
        </div>
      </div>
    </UModal>
  </div>
</template>
