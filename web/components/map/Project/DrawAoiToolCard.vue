<script setup lang="ts">
import type { GeoJSONSource, MapMouseEvent } from "maplibre-gl";
import buffer from "@turf/buffer";
import { point as turfPoint } from "@turf/helpers";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { TransitionRoot } from "@headlessui/vue";
import glDrawStyles from "~/constants/glDrawStyles";
import IcCross from "~/assets/icons/ic-cross.svg";
import IcDrawSquare from "~/assets/icons/ic-draw-square.svg";

const props = defineProps<{
  active: boolean;
}>();

const emit = defineEmits<{
  (e: "save"): void;
  (e: "cancel"): void;
}>();

const mapRefStore = useMapRef();
const draftStore = useNewProjectDraft();

type SelectMode = "polygon" | "buffer";
const selectMode = ref<SelectMode>("polygon");
const localGeometry = ref<any>(null);

const bufferPoints = ref<[number, number][]>([]);
const bufferDistance = ref(100);
const bufferUnit = ref<"meters" | "kilometers">("meters");
const unitOptions = [
  { value: "meters", label: "meters" },
  { value: "kilometers", label: "kilometers" },
];

// === Map IDs (scoped to this card) ===
const POINTS_SOURCE = "np-draw-points";
const POINTS_LAYER = "np-draw-points";
const BUFFER_SOURCE = "np-draw-buffer";
const BUFFER_LAYER = "np-draw-buffer";

// === Polygon (MapboxDraw) lifecycle ===
let drawer: MapboxDraw | null = null;

const onDrawCreate = (e: any) => {
  const f = e.features?.[0];
  if (f?.geometry) localGeometry.value = f.geometry;
};
const onDrawUpdate = (e: any) => {
  const f = e.features?.[0];
  if (f?.geometry) localGeometry.value = f.geometry;
};
const onDrawDblClick = () => {
  if (drawer) drawer.changeMode("simple_select");
};

const addDrawControl = () => {
  const map = mapRefStore.map;
  if (!map || drawer) return;
  drawer = new MapboxDraw({
    defaultMode: "draw_polygon",
    controls: { trash: true, polygon: true, line_string: true },
    displayControlsDefault: false,
    keybindings: true,
    touchEnabled: true,
    styles: glDrawStyles,
  });
  map.addControl(drawer as any);
  map.on("draw.create", onDrawCreate);
  map.on("draw.update", onDrawUpdate);
  map.on("dblclick", onDrawDblClick);
  const canvas = map.getCanvas?.();
  if (canvas) canvas.style.cursor = "crosshair";

  // Pre-seed with the existing draft geometry if it's a polygon
  const existing = draftStore.parsedGeometry;
  if (
    existing &&
    (existing.type === "Polygon" || existing.type === "MultiPolygon")
  ) {
    try {
      drawer.add({
        type: "Feature",
        properties: {},
        geometry: existing,
      } as any);
      localGeometry.value = existing;
    } catch (_) {}
  }
};

const removeDrawControl = () => {
  const map = mapRefStore.map;
  if (!map || !drawer) return;
  try {
    drawer.deleteAll();
  } catch (_) {}
  try {
    map.removeControl(drawer as any);
  } catch (_) {}
  map.off("draw.create", onDrawCreate);
  map.off("draw.update", onDrawUpdate);
  map.off("dblclick", onDrawDblClick);
  const canvas = map.getCanvas?.();
  if (canvas) canvas.style.cursor = "";
  drawer = null;
};

const clearDrawnPolygon = () => {
  if (drawer) {
    drawer.deleteAll();
    drawer.changeMode("draw_polygon");
  }
  localGeometry.value = null;
};

// === Buffer mode lifecycle ===
const onBufferMapClick = (e: MapMouseEvent) => {
  bufferPoints.value = [
    ...bufferPoints.value,
    [e.lngLat.lng, e.lngLat.lat],
  ];
};

const renderBufferLayers = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const pointsFc = {
    type: "FeatureCollection" as const,
    features: bufferPoints.value.map((c, idx) => ({
      type: "Feature" as const,
      properties: { idx },
      geometry: { type: "Point" as const, coordinates: c },
    })),
  };
  const pointsSrc = map.getSource(POINTS_SOURCE) as GeoJSONSource | undefined;
  if (pointsSrc) pointsSrc.setData(pointsFc as any);

  let bufferFc: any = { type: "FeatureCollection", features: [] };
  if (bufferPoints.value.length > 0 && bufferDistance.value > 0) {
    const polygons: number[][][][] = [];
    for (const c of bufferPoints.value) {
      const buffered: any = buffer(turfPoint(c) as any, bufferDistance.value, {
        units: bufferUnit.value,
        steps: 60,
      });
      const geom = buffered?.geometry;
      if (!geom) continue;
      if (geom.type === "Polygon") {
        polygons.push(geom.coordinates as number[][][]);
      } else if (geom.type === "MultiPolygon") {
        for (const p of geom.coordinates as number[][][][]) polygons.push(p);
      }
    }
    if (polygons.length === 1) {
      localGeometry.value = { type: "Polygon", coordinates: polygons[0] };
    } else if (polygons.length > 1) {
      localGeometry.value = { type: "MultiPolygon", coordinates: polygons };
    } else {
      localGeometry.value = null;
    }
    if (localGeometry.value) {
      bufferFc = {
        type: "FeatureCollection",
        features: [
          { type: "Feature", properties: {}, geometry: localGeometry.value },
        ],
      };
    }
  } else {
    localGeometry.value = null;
  }
  const bufferSrc = map.getSource(BUFFER_SOURCE) as GeoJSONSource | undefined;
  if (bufferSrc) bufferSrc.setData(bufferFc);
};

const addBufferLayers = () => {
  const map = mapRefStore.map;
  if (!map) return;
  if (!map.getSource(BUFFER_SOURCE)) {
    map.addSource(BUFFER_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: BUFFER_LAYER,
      type: "fill",
      source: BUFFER_SOURCE,
      paint: { "fill-color": "#7C3AED", "fill-opacity": 0.25 },
    });
    map.addLayer({
      id: BUFFER_LAYER + "-outline",
      type: "line",
      source: BUFFER_SOURCE,
      paint: { "line-color": "#7C3AED", "line-width": 2, "line-opacity": 0.8 },
    });
  }
  if (!map.getSource(POINTS_SOURCE)) {
    map.addSource(POINTS_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: POINTS_LAYER,
      type: "circle",
      source: POINTS_SOURCE,
      paint: {
        "circle-color": "#7C3AED",
        "circle-radius": 6,
        "circle-stroke-color": "#ffffff",
        "circle-stroke-width": 2,
      },
    });
  }
  map.on("click", onBufferMapClick);
  const canvas = map.getCanvas?.();
  if (canvas) canvas.style.cursor = "crosshair";
  renderBufferLayers();
};

const removeBufferLayers = () => {
  const map = mapRefStore.map;
  if (!map) return;
  map.off("click", onBufferMapClick);
  for (const id of [BUFFER_LAYER, BUFFER_LAYER + "-outline", POINTS_LAYER]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [BUFFER_SOURCE, POINTS_SOURCE]) {
    if (map.getSource(id)) map.removeSource(id);
  }
  const canvas = map.getCanvas?.();
  if (canvas) canvas.style.cursor = "";
};

const clearBufferPoints = () => {
  bufferPoints.value = [];
  localGeometry.value = null;
  renderBufferLayers();
};

// React to buffer state changes while card is active in buffer mode
watch(
  [bufferPoints, bufferDistance, bufferUnit],
  () => {
    if (props.active && selectMode.value === "buffer") {
      renderBufferLayers();
    }
  },
  { deep: true },
);

// Activate / deactivate based on `active` + `selectMode`
watch(
  () => [props.active, selectMode.value] as const,
  (newVal, oldVal) => {
    const [newActive, newMode] = newVal;
    const [oldActive, oldMode] = oldVal || [false, "polygon"];

    // Tear down outgoing
    if (oldActive && (!newActive || oldMode !== newMode)) {
      if (oldMode === "polygon") removeDrawControl();
      if (oldMode === "buffer") removeBufferLayers();
      // Mode switch resets transient state of outgoing branch
      if (oldMode !== newMode) {
        if (oldMode === "polygon") localGeometry.value = null;
        if (oldMode === "buffer") {
          bufferPoints.value = [];
          localGeometry.value = null;
        }
      }
    }

    // Activate incoming
    if (newActive && (!oldActive || oldMode !== newMode)) {
      if (newMode === "polygon") addDrawControl();
      if (newMode === "buffer") addBufferLayers();
    }
  },
  { immediate: true },
);

const onSave = () => {
  if (!localGeometry.value) return;
  draftStore.parsedGeometry = localGeometry.value;
  // A drawn AOI replaces any uploaded file
  draftStore.uploadedFile = null;
  emit("save");
};

const onCancel = () => {
  emit("cancel");
};

onUnmounted(() => {
  removeDrawControl();
  removeBufferLayers();
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
      <IcDrawSquare
        class="w-3 h-3 text-grey-400"
        :fontControlled="false"
      />
      <p class="flex-1 text-grey-800 text-2xs">Draw Area of Interest</p>
      <button @click="onCancel">
        <IcCross class="w-2 h-2 text-grey-400 m-2" :fontControlled="false" />
      </button>
    </div>
    <div class="p-3 space-y-3">
      <!-- Mode picker -->
      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          :class="[
            'px-2 py-1.5 rounded-xxs text-2xs font-medium border transition-colors',
            selectMode === 'polygon'
              ? 'bg-brand-50 border-brand-500 text-brand-600'
              : 'bg-white border-grey-200 text-grey-600 hover:border-grey-300',
          ]"
          @click="selectMode = 'polygon'"
        >
          <UIcon
            name="i-heroicons-pencil-square"
            class="w-3 h-3 inline mr-1"
          />
          Draw Polygon
        </button>
        <button
          type="button"
          :class="[
            'px-2 py-1.5 rounded-xxs text-2xs font-medium border transition-colors',
            selectMode === 'buffer'
              ? 'bg-brand-50 border-brand-500 text-brand-600'
              : 'bg-white border-grey-200 text-grey-600 hover:border-grey-300',
          ]"
          @click="selectMode = 'buffer'"
        >
          <UIcon name="i-heroicons-map-pin" class="w-3 h-3 inline mr-1" />
          Point + Buffer
        </button>
      </div>

      <!-- Mode A: Draw Polygon -->
      <div v-if="selectMode === 'polygon'" class="space-y-2">
        <p class="text-2xs text-grey-500">
          Click on the map to add vertices, double-click to finish.
        </p>
        <div
          v-if="localGeometry"
          class="bg-green-50 border border-green-200 rounded-xxs p-2 flex items-center justify-between"
        >
          <div class="flex items-center gap-1">
            <UIcon
              name="i-heroicons-check-circle"
              class="w-4 h-4 text-green-600"
            />
            <span class="text-2xs text-green-700">Polygon ready</span>
          </div>
          <button
            type="button"
            class="text-2xs text-red-600 hover:text-red-800"
            @click="clearDrawnPolygon"
          >
            Clear
          </button>
        </div>
      </div>

      <!-- Mode B: Point + Buffer -->
      <div v-if="selectMode === 'buffer'" class="space-y-2">
        <p class="text-2xs text-grey-500">
          Click on the map to add points; each is buffered by the chosen
          distance.
        </p>
        <div class="grid grid-cols-2 gap-2">
          <div>
            <label class="block text-2xs text-grey-600 mb-0.5">Distance</label>
            <UInput
              v-model.number="bufferDistance"
              type="number"
              :min="0"
              :ui="{ rounded: 'rounded-xxs' }"
              size="2xs"
            />
          </div>
          <div>
            <label class="block text-2xs text-grey-600 mb-0.5">Unit</label>
            <USelect
              v-model="bufferUnit"
              :options="unitOptions"
              value-attribute="value"
              option-attribute="label"
              :ui="{ rounded: 'rounded-xxs' }"
              size="2xs"
            />
          </div>
        </div>
        <div class="flex items-center justify-between">
          <span class="text-2xs text-grey-500">
            {{ bufferPoints.length }} point{{
              bufferPoints.length === 1 ? "" : "s"
            }}
          </span>
          <button
            v-if="bufferPoints.length > 0"
            type="button"
            class="text-2xs text-red-600 hover:text-red-800"
            @click="clearBufferPoints"
          >
            Clear points
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
        :disabled="!localGeometry"
        :ui="{ rounded: 'rounded-xxs' }"
        @click="onSave"
      >
        Save
      </UButton>
    </div>
  </TransitionRoot>
</template>
