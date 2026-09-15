<script lang="ts" setup>
import type { MapMouseEvent } from "maplibre-gl";
import turfDistance from "@turf/distance";
import { point } from "@turf/helpers";
import IcCross from "~/assets/icons/ic-cross.svg";
import IcSpinner from "~/assets/icons/ic-spinner.svg";

const featureStore = useFeature();
const mapRefStore = useMapRef();
const preview = useRouteMapPreview();
const picker = useSitePointPicker();
const boqBom = useBoqBomResult();

const { sitePoints, fetchNextPage, hasNextPage, isFetching } =
  useSitePointsList(4);

// user pans (see the "moveend" listener below).
const mapCenter = ref<[number, number] | null>(null);

const sentinel = ref(null);
const { isVisible } = useIntersectionObserver(sentinel);

watchEffect(() => {
  if (isVisible.value && hasNextPage.value) {
    fetchNextPage();
  }
});

// Lets a user pick site points directly on the map instead of scrolling the
// list: a type-4 click opens/focuses its accordion, a type-2 click pairs
// with whichever accordion is currently active (see useSitePointPicker).
function handleMapClick(e: MapMouseEvent) {
  const map = mapRefStore.map;
  if (!map) return;

  const siteLayers = (map.getStyle()?.layers ?? [])
    .filter((layer: any) => layer["source-layer"] === "site_points")
    .map((layer) => layer.id);
  if (!siteLayers.length) return;

  const feature = map.queryRenderedFeatures(e.point, { layers: siteLayers })[0];
  if (!feature || feature.id == null || feature.geometry.type !== "Point") {
    return;
  }

  const id = Number(feature.id);
  const typeId = Number(feature.properties?.site_point_type_id);
  const coordinates = feature.geometry.coordinates as [number, number];

  if (typeId === 4) {
    picker.openAccordion(id);
  } else if (typeId === 2) {
    picker.pickStationFromMap({
      id,
      name: feature.properties?.name ?? `SP-${id}`,
      coordinates,
    });
  }
}

function handleMoveEnd() {
  const center = mapRefStore.map?.getCenter();
  if (center) mapCenter.value = [center.lng, center.lat];
}

const { map } = storeToRefs(mapRefStore);

// The map can still be initializing when this panel mounts, so this reacts
// to it becoming available instead of a one-shot read in onMounted (which
// would otherwise leave mapCenter permanently null — silently falling back
// to server order — until the user happened to pan).
let attachedMap: typeof map.value = null;
watch(
  map,
  (newMap) => {
    if (attachedMap) {
      attachedMap.off("click", handleMapClick);
      attachedMap.off("moveend", handleMoveEnd);
    }
    attachedMap = newMap;
    if (newMap) {
      newMap.on("click", handleMapClick);
      newMap.on("moveend", handleMoveEnd);
      handleMoveEnd();
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (attachedMap) {
    attachedMap.off("click", handleMapClick);
    attachedMap.off("moveend", handleMoveEnd);
  }
  preview.clearPreview();
});
</script>

<template>
  <!-- v-show (not v-if) on both branches: switching to/from the BOQ/BOM
  view must not unmount the accordion list, or every AccordionItem's local
  state (found routes, paired station, etc.) would be lost on "Back". -->
  <div v-show="boqBom.result.value" class="contents">
    <div class="flex justify-between items-center m-3">
      <div>
        <button
          type="button"
          @click="boqBom.clear()"
          class="text-2xs text-grey-500 hover:text-brand-500 mb-1"
        >
          ‹ Back
        </button>
        <h2 class="text-grey-800">Analysis Result</h2>
        <p class="text-2xs text-grey-500">
          BOQ/BOM Analysis Result — Feeder Route
        </p>
      </div>
      <IcCross
        role="button"
        @click="featureStore.setMapInfo('')"
        :fontControlled="false"
        class="w-3 h-3 rotate-180 text-grey-900 shrink-0"
      />
    </div>
    <hr class="mx-3" />

    <div class="grow overflow-y-auto px-3 py-3">
      <MapSitePointsBoqBomResult
        v-if="boqBom.result.value"
        :result="boqBom.result.value"
      />
    </div>
  </div>

  <div v-show="!boqBom.result.value" class="contents">
    <div class="flex justify-between items-center m-3">
      <h2 class="text-grey-800">Site Points</h2>
      <IcCross
        role="button"
        @click="featureStore.setMapInfo('')"
        :fontControlled="false"
        class="w-3 h-3 rotate-180 text-grey-900"
      />
    </div>
    <hr class="mx-3" />

    <div class="grow overflow-y-auto px-3 py-3 space-y-2 pb-10">
      <div v-if="sitePoints.length" v-for="item of sitePoints" :key="item.id">
        <MapSitePointsAccordionItem :data="item" />
      </div>
      <div
        v-if="!sitePoints.length && !isFetching"
        class="text-center py-8 px-4"
      >
        <h4 class="text-sm font-medium text-grey-300 mb-1">No Site Points</h4>
        <p class="text-2xs text-grey-500">No site points have been added yet</p>
      </div>
      <div
        v-if="!sitePoints.length && isFetching"
        v-for="i of [1, 2, 3]"
        :key="i"
        class="bg-transparent border border-grey-700 rounded-xxs p-2 space-y-2"
      >
        <div v-for="i of [1, 2, 3, 4]" :key="i" class="space-y-1">
          <USkeleton
            :ui="{ background: 'bg-grey-800', rounded: 'rounded-xxs' }"
            class="h-3 w-1/2"
          />
          <USkeleton
            :ui="{ background: 'bg-grey-800', rounded: 'rounded-xxs' }"
            class="h-3 w-2/3"
          />
        </div>
      </div>
      <div v-if="sitePoints.length && hasNextPage" ref="sentinel">
        <IcSpinner
          class="text-white animate-spin h-6 w-6 p-1 m-auto"
          :fontControlled="false"
        />
      </div>
    </div>
  </div>
</template>
