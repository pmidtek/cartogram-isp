<script setup lang="ts">
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import { TransitionRoot } from "@headlessui/vue";
import IcCross from "~/assets/icons/ic-cross.svg";

const props = defineProps<{
  active: boolean;
  mode: "input" | "tower";
}>();

const emit = defineEmits<{
  (e: "save"): void;
  (e: "cancel"): void;
}>();

const mapRefStore = useMapRef();
const layerStore = useMapLayer();
const draftStore = useNewProjectDraft();
const toast = useToast();

// === Local selection state (multi) ===
const localCoords = ref<[number, number][]>([]);
const localTowers = ref<{ id: number | string; label: string; coord?: [number, number] }[]>([]);

// How many start points are required. The 90% "+1" buffer applies to both modes.
const max = computed(
  () => draftStore.oltTotalLines + (draftStore.oltLastLineFull ? 1 : 0),
);

const selectedCount = computed(() =>
  props.mode === "input" ? localCoords.value.length : localTowers.value.length,
);

const canSave = computed(
  () => max.value > 0 && selectedCount.value === max.value,
);

// === Map IDs (scoped to this card) ===
const POINT_SOURCE = "olt-input-point";
const POINT_LAYER = "olt-input-point";
const HIGHLIGHT_SOURCE = "olt-tower-highlight";
const HIGHLIGHT_LAYER = "olt-tower-highlight";
const AOI_SOURCE = "olt-aoi";
const AOI_FILL_LAYER = "olt-aoi-fill";
const AOI_LINE_LAYER = "olt-aoi-line";

// =====================================================================
// AOI context: keep the selected area visible while picking start points
// =====================================================================
const addAoiLayer = () => {
  const map = mapRefStore.map;
  if (!map || !draftStore.parsedGeometry) return;
  if (map.getSource(AOI_SOURCE)) return;
  map.addSource(AOI_SOURCE, {
    type: "geojson",
    data: {
      type: "Feature",
      properties: {},
      geometry: draftStore.parsedGeometry,
    } as any,
  });
  map.addLayer({
    id: AOI_FILL_LAYER,
    type: "fill",
    source: AOI_SOURCE,
    paint: { "fill-color": "#7C3AED", "fill-opacity": 0.12 },
  });
  map.addLayer({
    id: AOI_LINE_LAYER,
    type: "line",
    source: AOI_SOURCE,
    paint: { "line-color": "#7C3AED", "line-width": 2, "line-opacity": 0.8 },
  });
};

const removeAoiLayer = () => {
  const map = mapRefStore.map;
  if (!map) return;
  for (const id of [AOI_FILL_LAYER, AOI_LINE_LAYER]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(AOI_SOURCE)) map.removeSource(AOI_SOURCE);
};

const pointFc = (coords: [number, number][]) => ({
  type: "FeatureCollection" as const,
  features: coords.map((c, idx) => ({
    type: "Feature" as const,
    properties: { idx },
    geometry: { type: "Point" as const, coordinates: c },
  })),
});

// =====================================================================
// Input mode: click to place start points (up to `max`)
// =====================================================================
const renderInputPoints = () => {
  const map = mapRefStore.map;
  const src = map?.getSource(POINT_SOURCE) as GeoJSONSource | undefined;
  if (src) src.setData(pointFc(localCoords.value) as any);
};

const onInputMapClick = (e: MapMouseEvent) => {
  if (localCoords.value.length >= max.value) {
    toast.add({
      title: `Maximum ${max.value} point(s) reached`,
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-sm font-medium",
        icon: "text-yellow-500",
      },
    });
    return;
  }
  localCoords.value = [...localCoords.value, [e.lngLat.lng, e.lngLat.lat]];
  renderInputPoints();
};

const addInputLayer = () => {
  const map = mapRefStore.map;
  if (!map) return;
  if (!map.getSource(POINT_SOURCE)) {
    map.addSource(POINT_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: POINT_LAYER,
      type: "circle",
      source: POINT_SOURCE,
      paint: {
        "circle-color": "#7C3AED",
        "circle-radius": 7,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }
  if (draftStore.oltMode === "input" && draftStore.oltCoordinates.length) {
    localCoords.value = draftStore.oltCoordinates.map(
      (c) => [...c] as [number, number],
    );
  }
  map.on("click", onInputMapClick);
  const canvas = map.getCanvas?.();
  if (canvas) canvas.style.cursor = "crosshair";
  renderInputPoints();
};

const removeInputLayer = () => {
  const map = mapRefStore.map;
  if (!map) return;
  map.off("click", onInputMapClick);
  if (map.getLayer(POINT_LAYER)) map.removeLayer(POINT_LAYER);
  if (map.getSource(POINT_SOURCE)) map.removeSource(POINT_SOURCE);
  const canvas = map.getCanvas?.();
  if (canvas) canvas.style.cursor = "";
};

// =====================================================================
// Tower mode: toggle towers from the FTTH tower layer (up to `max`)
// =====================================================================
type TowerLayerRef = { config: any; prevVisibility: string | undefined };
let towerLayerRefs: TowerLayerRef[] = [];

const resolveTowerLayers = (): any[] => {
  const groups = layerStore.groupedActiveLayers ?? [];
  const all = groups.map((g: any) => g.layerLists).flat();
  const towers = all.filter(
    (l: any) =>
      l?.source === "vector_tiles" &&
      (l.layer_name === "towers" ||
        l.layer_name === "ftth_tower" ||
        l.layer_alias?.toLowerCase().includes("tower")),
  );
  if (!towers.length) {
    console.warn("[OLT] No tower layer found in groupedActiveLayers", all);
  }
  return towers;
};

const towerLayerIds = (): string[] => {
  const map = mapRefStore.map;
  if (!map) return [];
  return towerLayerRefs
    .map((r) => r.config.layer_id)
    .filter((id: string) => !!map.getLayer(id));
};

const showTowerLayers = () => {
  const towers = resolveTowerLayers();
  towerLayerRefs = towers.map((config) => ({
    config,
    prevVisibility: config.layer_style?.layout_visibility,
  }));
  for (const { config } of towerLayerRefs) {
    if (config.layer_style) config.layer_style.layout_visibility = "visible";
  }
  if (!towerLayerRefs.length) {
    toast.add({
      title: "Tower layer not available",
      description: "No FTTH tower layer is loaded on the map.",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
  }
};

const restoreTowerLayers = () => {
  for (const { config, prevVisibility } of towerLayerRefs) {
    if (config.layer_style) {
      config.layer_style.layout_visibility = prevVisibility ?? "none";
    }
  }
  towerLayerRefs = [];
};

const renderHighlights = () => {
  const map = mapRefStore.map;
  const src = map?.getSource(HIGHLIGHT_SOURCE) as GeoJSONSource | undefined;
  const coords = localTowers.value
    .map((t) => t.coord)
    .filter((c): c is [number, number] => !!c);
  if (src) src.setData(pointFc(coords) as any);
};

const onTowerMapClick = (e: MapMouseEvent) => {
  const map = mapRefStore.map;
  if (!map) return;
  const layers = towerLayerIds();
  if (!layers.length) return;
  const features = map.queryRenderedFeatures(e.point, { layers });
  if (!features.length) return;
  const feature = features[0];
  const id =
    feature.properties?.ogc_fid ??
    feature.properties?.id ??
    (feature.id as string | number | undefined);
  if (id === undefined || id === null) return;

  const existingIdx = localTowers.value.findIndex((t) => t.id === id);
  if (existingIdx >= 0) {
    // Toggle off
    localTowers.value = localTowers.value.filter((_, i) => i !== existingIdx);
    renderHighlights();
    return;
  }
  if (localTowers.value.length >= max.value) {
    toast.add({
      title: `Maximum ${max.value} tower(s) reached`,
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-sm font-medium",
        icon: "text-yellow-500",
      },
    });
    return;
  }
  const label =
    feature.properties?.name ?? feature.properties?.code ?? String(id);
  const coord =
    feature.geometry.type === "Point"
      ? (feature.geometry.coordinates as [number, number])
      : undefined;
  localTowers.value = [...localTowers.value, { id, label, coord }];
  renderHighlights();
};

const addTowerSelection = () => {
  const map = mapRefStore.map;
  if (!map) return;
  if (!map.getSource(HIGHLIGHT_SOURCE)) {
    map.addSource(HIGHLIGHT_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: HIGHLIGHT_LAYER,
      type: "circle",
      source: HIGHLIGHT_SOURCE,
      paint: {
        "circle-color": "rgba(124,58,237,0.25)",
        "circle-radius": 14,
        "circle-stroke-color": "#7C3AED",
        "circle-stroke-width": 2,
      },
    });
  }
  showTowerLayers();
  if (draftStore.oltMode === "tower" && draftStore.oltTowers.length) {
    localTowers.value = draftStore.oltTowers.map((t) => ({ ...t }));
  }
  map.on("click", onTowerMapClick);
  const canvas = map.getCanvas?.();
  if (canvas) canvas.style.cursor = "crosshair";
  renderHighlights();
};

const removeTowerSelection = () => {
  const map = mapRefStore.map;
  if (!map) return;
  map.off("click", onTowerMapClick);
  if (map.getLayer(HIGHLIGHT_LAYER)) map.removeLayer(HIGHLIGHT_LAYER);
  if (map.getSource(HIGHLIGHT_SOURCE)) map.removeSource(HIGHLIGHT_SOURCE);
  const canvas = map.getCanvas?.();
  if (canvas) canvas.style.cursor = "";
  restoreTowerLayers();
};

// === manual remove from card list ===
const removeAt = (idx: number) => {
  if (props.mode === "input") {
    localCoords.value = localCoords.value.filter((_, i) => i !== idx);
    renderInputPoints();
  } else {
    localTowers.value = localTowers.value.filter((_, i) => i !== idx);
    renderHighlights();
  }
};

// =====================================================================
// Activate / deactivate based on `active` + `mode`
// =====================================================================
const teardown = (mode: "input" | "tower") => {
  if (mode === "input") removeInputLayer();
  if (mode === "tower") removeTowerSelection();
  removeAoiLayer();
  localCoords.value = [];
  localTowers.value = [];
};

const activate = (mode: "input" | "tower") => {
  addAoiLayer(); // keep the AOI visible underneath the selection layers
  if (mode === "input") addInputLayer();
  if (mode === "tower") addTowerSelection();
};

watch(
  () => [props.active, props.mode] as const,
  (newVal, oldVal) => {
    const [newActive, newMode] = newVal;
    const [oldActive, oldMode] = oldVal || [false, "input"];
    if (oldActive && (!newActive || oldMode !== newMode)) teardown(oldMode);
    if (newActive && (!oldActive || oldMode !== newMode)) activate(newMode);
  },
  { immediate: true },
);

const onSave = () => {
  if (!canSave.value) return;
  if (props.mode === "input") {
    draftStore.oltCoordinates = localCoords.value.map(
      (c) => [...c] as [number, number],
    );
    draftStore.oltMode = "input";
  } else {
    draftStore.oltTowers = localTowers.value.map((t) => ({
      id: t.id,
      label: t.label,
    }));
    draftStore.oltMode = "tower";
  }
  emit("save");
};

const onCancel = () => {
  emit("cancel");
};

onUnmounted(() => {
  removeInputLayer();
  removeTowerSelection();
  removeAoiLayer();
});
</script>

<template>
  <TransitionRoot
    as="div"
    :show="active"
    enter="transition-all duration-300"
    enter-from="-mb-10 opacity-0"
    enter-to="mb-0 opacity-1"
    leave="transition-all duration-300"
    leave-from="mb-0 opacity-1"
    leave-to="-mb-10 opacity-0"
    class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] rounded-xs bg-white min-w-[20rem] max-w-[25rem] divide-y divide-grey-700 shadow-lg"
  >
    <div class="flex items-center gap-[6px] p-2">
      <UIcon
        :name="mode === 'tower' ? 'i-heroicons-signal' : 'i-heroicons-map-pin'"
        class="w-3 h-3 text-grey-400"
      />
      <p class="flex-1 text-grey-800 text-2xs">
        {{ mode === "tower" ? "Select Start Tower(s)" : "Pick Start Point(s)" }}
      </p>
      <span class="text-2xs font-medium text-brand-600">
        {{ selectedCount }}/{{ max }}
      </span>
      <button @click="onCancel">
        <IcCross class="w-2 h-2 text-grey-400 m-2" :fontControlled="false" />
      </button>
    </div>

    <div class="p-3 space-y-2">
      <p class="text-2xs text-grey-500">
        <template v-if="mode === 'input'">
          Click on the map to add up to {{ max }} start point(s).
        </template>
        <template v-else>
          Click towers on the map to select up to {{ max }} (click again to
          deselect).
        </template>
      </p>

      <div
        v-if="mode === 'input' && localCoords.length"
        class="space-y-1 max-h-32 overflow-auto"
      >
        <div
          v-for="(c, i) in localCoords"
          :key="i"
          class="bg-green-50 border border-green-200 rounded-xxs p-1.5 flex items-center justify-between"
        >
          <span class="text-2xs text-green-700">
            {{ i + 1 }}. {{ c[0].toFixed(5) }}, {{ c[1].toFixed(5) }}
          </span>
          <button
            type="button"
            class="text-2xs text-red-600 hover:text-red-800"
            @click="removeAt(i)"
          >
            Remove
          </button>
        </div>
      </div>

      <div
        v-if="mode === 'tower' && localTowers.length"
        class="space-y-1 max-h-32 overflow-auto"
      >
        <div
          v-for="(t, i) in localTowers"
          :key="i"
          class="bg-green-50 border border-green-200 rounded-xxs p-1.5 flex items-center justify-between"
        >
          <span class="text-2xs text-green-700">{{ i + 1 }}. {{ t.label }}</span>
          <button
            type="button"
            class="text-2xs text-red-600 hover:text-red-800"
            @click="removeAt(i)"
          >
            Remove
          </button>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="p-2 grid grid-cols-2 gap-2">
      <UButton
        size="2xs"
        color="gray"
        variant="ghost"
        block
        :ui="{ rounded: 'rounded-xxs' }"
        @click="onCancel"
      >
        Cancel
      </UButton>
      <UButton
        size="2xs"
        color="primary"
        block
        :disabled="!canSave"
        :ui="{ rounded: 'rounded-xxs' }"
        @click="onSave"
      >
        Save
      </UButton>
    </div>
  </TransitionRoot>
</template>
