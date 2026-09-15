<script lang="ts" setup>
import { TransitionRoot } from "@headlessui/vue";
import turfDistance from "@turf/distance";
import { point } from "@turf/helpers";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";
import IcPin from "~/assets/icons/ic-pin.svg";
import type {
  SitePointListItem,
  RouteOption,
  BoqBomGenerateResult,
} from "~/utils/types";
import type { MapPickedSitePoint } from "~/composables/useSitePointPicker";

const props = defineProps<{
  data: SitePointListItem;
}>();

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();
const preview = useRouteMapPreview();
const picker = useSitePointPicker();
const boqBom = useBoqBomResult();

const isActive = computed(() => preview.activeOwnerId.value === props.data.id);
const isPanelOpen = computed(() => picker.isAccordionOpen(props.data.id));

function toastMissingCoords(title: string) {
  toast.add({
    title,
    description: "Could not resolve coordinates for the selected site points.",
    icon: "i-heroicons-exclamation-triangle",
    ui: { background: "bg-white", title: "text-grey-800" },
  });
}

function flyTo(coords: [number, number] | undefined) {
  if (!coords) {
    toast.add({
      title: "Location unavailable",
      description: "Could not find coordinates for this site point.",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }
  mapRefStore.map?.flyTo({ center: coords, zoom: 17, duration: 1000 });
}

function handleLocateAnchor() {
  flyTo(props.data.geom?.coordinates as [number, number] | undefined);
}

// Passive highlight for whatever is currently selected in this accordion —
// just the anchor while no type-2 point is paired yet, both once one is.
function updateSelectionHighlight() {
  const anchor = props.data.geom?.coordinates as [number, number] | undefined;
  if (!anchor) return;
  const points: [number, number][] = [anchor];
  if (selectedStation.value) points.push(selectedStation.value.coordinates);
  preview.showPointHighlight(props.data.id, points);
}

// The paired type-2 point — only ever set by picking it on the map (see
// useSitePointPicker / index.vue's map click handler).
const selectedStation = ref<MapPickedSitePoint | null>(null);

function resetRouteState() {
  routeOptions.value = [];
  selectedRouteOptionId.value = null;
  isPreviewOn.value = false;
  boqBom.clearIfOwner(props.data.id);
}

const selectedStationDetail = ref<SitePointListItem | null>(null);

async function fetchStationDetail(id: number) {
  try {
    const res = await $fetch<{ data: SitePointListItem }>(
      `/panel/items/site_points/${id}?fields=id,name,code,site_point_type_id.name,area_city_id.city,area_city_id.province,date_created,geom`,
      { headers: { Authorization: `Bearer ${authStore.accessToken}` } },
    );
    // ignore a stale response if the user picked a different point meanwhile
    if (selectedStation.value?.id === id) {
      selectedStationDetail.value = res.data;
    }
  } catch (error) {
    console.warn("Failed to fetch site point detail:", error);
  }
}

const selectedStationAsListItem = computed<SitePointListItem | null>(() => {
  if (!selectedStation.value) return null;
  if (selectedStationDetail.value?.id === selectedStation.value.id) {
    return selectedStationDetail.value;
  }
  return {
    id: selectedStation.value.id,
    name: selectedStation.value.name,
    code: null,
    site_point_type_id: null,
    area_city_id: null,
    date_created: null,
    geom: { type: "Point", coordinates: selectedStation.value.coordinates },
  };
});

function applyStationSelection(picked: MapPickedSitePoint) {
  selectedStation.value = picked;
  selectedStationDetail.value = null;
  resetRouteState();
  preview.clearIfOwner(props.data.id);
  updateSelectionHighlight();
  fetchStationDetail(picked.id);
}

function handleClearStation() {
  selectedStation.value = null;
  selectedStationDetail.value = null;
  resetRouteState();
  preview.clearIfOwner(props.data.id);
  updateSelectionHighlight();
}

function handleLocateStation() {
  flyTo(selectedStation.value?.coordinates);
}

watch(
  () => picker.stationSelectionSignal.value,
  (signal) => {
    if (!signal || signal.anchorId !== props.data.id) return;
    applyStationSelection(signal.point);
    picker.stationSelectionSignal.value = null;
  },
);

function findNearestStation(
  anchor: [number, number],
): MapPickedSitePoint | null {
  const map = mapRefStore.map;
  if (!map || !map.getSource("site_points")) return null;

  const anchorPoint = point(anchor);
  let nearest: MapPickedSitePoint | null = null;
  let nearestDistance = Infinity;

  for (const feature of map.querySourceFeatures("site_points", {
    sourceLayer: "site_points",
  })) {
    if (
      feature.id == null ||
      feature.geometry.type !== "Point" ||
      Number(feature.properties?.site_point_type_id) !== 2
    ) {
      continue;
    }
    const coordinates = feature.geometry.coordinates as [number, number];
    const distance = turfDistance(anchorPoint, point(coordinates));
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearest = {
        id: Number(feature.id),
        name: feature.properties?.name ?? `SP-${feature.id}`,
        coordinates,
      };
    }
  }

  return nearest;
}

function handleSnapNearest() {
  const anchor = props.data.geom?.coordinates as [number, number] | undefined;
  if (!anchor) {
    toastMissingCoords("Snap to nearest unavailable");
    return;
  }

  const nearest = findNearestStation(anchor);
  if (!nearest) {
    toast.add({
      title: "No station points loaded",
      description:
        "Pan or zoom the map over some station (type 2) points, then try again.",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  applyStationSelection(nearest);
}

watch(isPanelOpen, (open) => {
  if (open) updateSelectionHighlight();
});

const isFindingRoutes = ref(false);
const routeOptions = ref<RouteOption[]>([]);
const selectedRouteOptionId = ref<number | null>(null);
const isPreviewing = ref(false);
const isPreviewOn = ref(false);
const isGeneratingBoqBom = ref(false);

const canSearch = computed(() => !!selectedStation.value);

function pairCoords(): [[number, number], [number, number]] | null {
  const anchor = props.data.geom?.coordinates as [number, number] | undefined;
  if (!anchor || !selectedStation.value) return null;
  return [anchor, selectedStation.value.coordinates];
}

async function handleFindRoutes() {
  if (!canSearch.value) return;
  const coords = pairCoords();
  if (!coords) {
    toastMissingCoords("Find Routes unavailable");
    return;
  }

  isFindingRoutes.value = true;
  try {
    const res = await $fetch<{
      data: {
        status: string;
        message: string | null;
        options: RouteOption[];
      };
    }>("/panel/analysis/find-option-route", {
      method: "POST",
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
      body: { locations: coords, target_count: 3 },
    });

    // "straight_line" is the backend's last-resort placeholder when ORS
    // found no real route (source: "straight_line", profile: null) — a bare
    // direct line between the two points, not an actual route.
    const options = (res.data.options ?? []).filter(
      (o) => o.source !== "straight_line",
    );
    if (!options.length) {
      resetRouteState();
      toast.add({
        title: "No routes found",
        description: res.data.message || "Could not find any route options.",
        icon: "i-heroicons-exclamation-triangle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
      return;
    }

    // shortest first — it's the default recommendation shown initially
    options.sort((a, b) => a.distance - b.distance);

    isPreviewOn.value = false;
    routeOptions.value = options;
    selectedRouteOptionId.value = options[0].id;
    preview.showRoutePreview(props.data.id, routeOptions.value, options[0].id);
  } catch (error) {
    console.error("Error fetching route options:", error);
    toast.add({
      title: "Error",
      description: "Failed to load route options.",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isFindingRoutes.value = false;
  }
}

function handleSelectRouteOption(id: number) {
  selectedRouteOptionId.value = id;
  boqBom.clearIfOwner(props.data.id);
  preview.showRoutePreview(props.data.id, routeOptions.value, id);
}

const canGenerateBoqBom = computed(
  () => routeOptions.value.length > 0 && selectedRouteOptionId.value !== null,
);

async function handleGenerateBoqBom() {
  if (!canGenerateBoqBom.value || !selectedStation.value) return;
  const anchor = props.data.geom?.coordinates as [number, number] | undefined;
  const selectedRoute = routeOptions.value.find(
    (o) => o.id === selectedRouteOptionId.value,
  );
  if (!anchor || !selectedRoute) {
    toastMissingCoords("Generate BOQ/BOM unavailable");
    return;
  }

  isGeneratingBoqBom.value = true;
  try {
    const requestParams = {
      feeder_code: "M-FO-24C",
      pole_code: "T6",
      route_length_m: selectedRoute.distance,
    };
    const res = await $fetch<{ data: BoqBomGenerateResult }>(
      "/panel/boq-bom/feeder-simple/generate-boq-bom",
      {
        method: "POST",
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
        body: requestParams,
      },
    );
    boqBom.show(props.data.id, res.data, requestParams);
  } catch (error) {
    console.error("Error generating BOQ/BOM:", error);
    toast.add({
      title: "Error",
      description: "Failed to generate BOQ/BOM.",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isGeneratingBoqBom.value = false;
  }
}

async function handlePreview() {
  if (!canSearch.value) return;

  if (isPreviewOn.value) {
    isPreviewOn.value = false;
    preview.clearIfOwner(props.data.id);
    return;
  }

  const coords = pairCoords();
  if (!coords) {
    toastMissingCoords("Preview unavailable");
    return;
  }

  isPreviewing.value = true;
  try {
    preview.showPointPreview(props.data.id, coords[0], coords[1]);
    isPreviewOn.value = true;
  } finally {
    isPreviewing.value = false;
  }
}

function togglePanel() {
  if (isPanelOpen.value) {
    picker.closeAccordion(props.data.id);
    preview.clearIfOwner(props.data.id);
  } else {
    picker.openAccordion(props.data.id);
    handleLocateAnchor();
    updateSelectionHighlight();
  }
}
</script>

<template>
  <div
    class="border rounded-xxs transition-colors"
    :class="isActive ? 'border-brand-500' : 'border-grey-700'"
  >
    <div
      role="button"
      @click="togglePanel"
      class="w-full p-2 flex items-center gap-2 text-left cursor-pointer"
    >
      <div class="text-2xs flex-1 min-w-0">
        <p class="text-grey-500">Name</p>
        <p class="text-grey-800 truncate">{{ data.name || "-" }}</p>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          title="Jump to site"
          @click.stop="handleLocateAnchor"
          class="flex items-center justify-center w-5 h-5 rounded-xxs text-grey-500 hover:text-brand-500 hover:bg-grey-100"
        >
          <IcPin class="w-3 h-3" :fontControlled="false" />
        </button>
        <div
          :class="[
            isPanelOpen ? '' : 'rotate-180',
            'text-grey-500 transition-all duration-300',
          ]"
        >
          <IcArrowReg :fontControlled="false" class="w-3 h-3" />
        </div>
      </div>
    </div>

    <TransitionRoot
      appear
      :show="isPanelOpen"
      as="div"
      className="overflow-hidden"
      enter="transition-all ease-in duration-300"
      enterFrom="max-h-0"
      enterTo="max-h-[100rem]"
      leave="transition-all ease-out duration-300"
      leaveFrom="max-h-[100rem]"
      leaveTo="max-h-0"
    >
      <div class="border-t border-grey-700 p-2 space-y-2">
        <p v-if="!selectedStation" class="text-2xs text-grey-500">
          Click a Station site point on the map to pair it with this one.
        </p>
        <MapSitePointsCard
          v-else-if="selectedStationAsListItem"
          :data="selectedStationAsListItem"
          :selected="true"
          @select="handleClearStation"
          @locate="handleLocateStation"
        />
        <UButton
          variant="outline"
          color="gray"
          label="Snap to Nearest Station"
          block
          :ui="{ rounded: 'rounded-xxs' }"
          @click="handleSnapNearest"
        />

        <MapSitePointsRouteOptions
          v-if="routeOptions.length"
          :options="routeOptions"
          :selected-id="selectedRouteOptionId"
          @select="handleSelectRouteOption"
        />

        <div class="grid grid-cols-2 gap-2">
          <UButton
            :variant="isPreviewOn ? 'solid' : 'outline'"
            :color="isPreviewOn ? 'brand' : 'gray'"
            :label="isPreviewOn ? 'Hide Preview' : 'Preview'"
            block
            :disabled="!canSearch"
            :loading="isPreviewing"
            :ui="{ rounded: 'rounded-xxs' }"
            @click="handlePreview"
          />
          <UButton
            variant="solid"
            color="brand"
            label="Find Routes"
            block
            :disabled="!canSearch"
            :loading="isFindingRoutes"
            :ui="{ rounded: 'rounded-xxs' }"
            @click="handleFindRoutes"
          />
        </div>

        <UButton
          v-if="canGenerateBoqBom"
          variant="solid"
          color="brand"
          label="Generate BOQ/BOM"
          block
          :loading="isGeneratingBoqBom"
          :ui="{ rounded: 'rounded-xxs' }"
          @click="handleGenerateBoqBom"
        />
      </div>
    </TransitionRoot>
  </div>
</template>
