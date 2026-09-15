<script lang="ts" setup>
import { ref, computed } from "vue";
import { storeToRefs } from "pinia";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { Marker, Popup } from "maplibre-gl";
import bbox from "@turf/bbox";
import { featureCollection } from "@turf/helpers";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";
import {
  bearing,
  destination,
  angularDelta,
  buildSectorWedge,
  type LngLat,
} from "~/utils/antennaSector";

const authStore = useAuth();
const mapRefStore = useMapRef();
const analysisStore = useAnalysisResult();
const toolsStore = useMapTools();
const toast = useToast();
const queryClient = useQueryClient();
const { antennaDirectionData } = storeToRefs(analysisStore);

const antennaDirectionId = computed(() => antennaDirectionData.value?.id);
const radiusM = computed(() => Number(antennaDirectionData.value?.radius_m) || 0);

// Data visibility state
const isDataVisible = ref(true);
const SECTOR_LAYER_ID = "antenna-direction-sectors";
const TOWER_LAYER_ID = "antenna-direction-towers";

// Fetch sector polygons geojson on demand
const { data: geojsonSector, refetch: refetchSector } = useQuery({
  queryKey: ["antenna_direction_sector", antennaDirectionId],
  enabled: computed(() => !!antennaDirectionId.value),
  queryFn: async () => {
    return await $fetch<any>(
      `/panel/geojson/fwa/antenna_sector?antenna_direction_id=${antennaDirectionId.value}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
  },
});

// Fetch antenna_direction_item rows (tower center + per-sector angles) for editing
const { data: editItems, refetch: refetchEditItems } = useQuery({
  queryKey: ["antenna_direction_item_edit", antennaDirectionId],
  enabled: computed(() => !!antennaDirectionId.value),
  queryFn: async () => {
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/antenna_direction_item?filter[antenna_direction_id][_eq]=${antennaDirectionId.value}&fields=*&limit=-1`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return response.data;
  },
});

// Fetch tower points geojson on demand
const { data: geojsonTower } = useQuery({
  queryKey: ["antenna_direction_tower", antennaDirectionId],
  enabled: computed(() => !!antennaDirectionId.value),
  queryFn: async () => {
    return await $fetch<any>(
      `/panel/geojson/fwa/antenna?antenna_direction_id=${antennaDirectionId.value}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
  },
});

// Add sector layer to map
const addSectorLayerToMap = (geojson: any) => {
  const map = mapRefStore.map;
  if (!map || !geojson) return;

  removeSectorLayerFromMap();

  map.addSource(SECTOR_LAYER_ID, {
    type: "geojson",
    data: geojson,
    promoteId: "id",
  });

  map.addLayer({
    id: `${SECTOR_LAYER_ID}-fill`,
    type: "fill",
    source: SECTOR_LAYER_ID,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": 0.3,
    },
  });

  map.addLayer({
    id: `${SECTOR_LAYER_ID}-line`,
    type: "line",
    source: SECTOR_LAYER_ID,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 2,
    },
  });

  // Keep the edited tower's static sectors hidden across layer rebuilds.
  if (isEditMode.value) applyEditHideFilter();
};

const removeSectorLayerFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;

  if (map.getLayer(`${SECTOR_LAYER_ID}-line`)) {
    map.removeLayer(`${SECTOR_LAYER_ID}-line`);
  }
  if (map.getLayer(`${SECTOR_LAYER_ID}-fill`)) {
    map.removeLayer(`${SECTOR_LAYER_ID}-fill`);
  }
  if (map.getSource(SECTOR_LAYER_ID)) {
    map.removeSource(SECTOR_LAYER_ID);
  }
};

// Tower colors mapping
const towerColors: Record<string, string> = {
  CTM: "#10B981",
  TBG: "#F5C400",
  Alfa: "#EF4444",
  Balcom: "#F59E0B",
  Gihon: "#3B82F6",
  PKP: "#8B5CF6",
};

// Ensure tower icon is loaded
const ensureTowerIconLoaded = async () => {
  const map = mapRefStore.map;
  if (!map || map.hasImage("tower-icon")) return;

  const { towerIconSvg2 } = await import("~/constants");

  return new Promise<void>((resolve, reject) => {
    const img = new Image(25, 25);
    img.onload = () => {
      if (map && !map.hasImage("tower-icon")) {
        map.addImage("tower-icon", img, { sdf: true });
      }
      resolve();
    };
    img.onerror = (error) => {
      console.error("Failed to load tower icon:", error);
      reject(error);
    };
    img.src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(towerIconSvg2);
  });
};

// Add tower layer to map
const addTowerLayerToMap = async (geojson: any) => {
  const map = mapRefStore.map;
  if (!map || !geojson) return;

  await ensureTowerIconLoaded();
  removeTowerLayerFromMap();

  map.addSource(TOWER_LAYER_ID, {
    type: "geojson",
    data: geojson,
  });

  const colorExpression: any = ["match", ["get", "tower_owner"]];
  Object.entries(towerColors).forEach(([owner, color]) => {
    colorExpression.push(owner, color);
  });
  colorExpression.push("#F97316");

  map.addLayer({
    id: TOWER_LAYER_ID,
    type: "symbol",
    source: TOWER_LAYER_ID,
    minzoom: 12,
    maxzoom: 18,
    layout: {
      "icon-image": "tower-icon",
      "icon-size": 1.2,
      "icon-allow-overlap": true,
      visibility: "visible",
    },
    paint: {
      "icon-color": colorExpression,
      "icon-opacity": 0.9,
    },
  });
};

const removeTowerLayerFromMap = () => {
  const map = mapRefStore.map;
  if (!map) return;

  if (map.getLayer(TOWER_LAYER_ID)) {
    map.removeLayer(TOWER_LAYER_ID);
  }
  if (map.getSource(TOWER_LAYER_ID)) {
    map.removeSource(TOWER_LAYER_ID);
  }
};

// Fly to extent of all layers (only once, so refetch-after-save doesn't re-zoom)
const hasFlownToExtent = ref(false);
const flyToExtent = () => {
  const map = mapRefStore.map;
  if (!map || hasFlownToExtent.value) return;

  const allFeatures = [];
  if (geojsonSector.value?.features) {
    allFeatures.push(...geojsonSector.value.features);
  }
  if (geojsonTower.value?.features) {
    allFeatures.push(...geojsonTower.value.features);
  }

  if (allFeatures.length === 0) return;

  try {
    const fc = featureCollection(allFeatures);
    const bounds = bbox(fc);

    map.fitBounds(
      [
        [bounds[0], bounds[1]],
        [bounds[2], bounds[3]],
      ],
      {
        padding: 80,
        duration: 1500,
        maxZoom: 16,
      },
    );
    hasFlownToExtent.value = true;
  } catch (error) {
    console.error("Error flying to extent:", error);
  }
};

// Hide existing tower layers (from main map)
const hideExistingTowerLayers = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const mapLayerStore = useMapLayer();
  const { groupedActiveLayers } = storeToRefs(mapLayerStore);

  if (!groupedActiveLayers.value) return;

  const sitePointsGroup = groupedActiveLayers.value.find(
    (group) => group.label === "Site Points",
  );

  if (!sitePointsGroup) return;

  sitePointsGroup.layerLists.forEach((layer) => {
    const isTowerLayer =
      layer.category?.category_id === 3 && layer.geometry_type === "Symbol";

    if (isTowerLayer && layer.layer_id) {
      if (map.getLayer(layer.layer_id)) {
        map.setLayoutProperty(layer.layer_id, "visibility", "none");
      }
    }
  });
};

// Show existing tower layers (restore visibility)
const showExistingTowerLayers = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const mapLayerStore = useMapLayer();
  const { groupedActiveLayers } = storeToRefs(mapLayerStore);

  if (!groupedActiveLayers.value) return;

  const sitePointsGroup = groupedActiveLayers.value.find(
    (group) => group.label === "Site Points",
  );

  if (!sitePointsGroup) return;

  sitePointsGroup.layerLists.forEach((layer) => {
    const isTowerLayer =
      layer.category?.category_id === 3 && layer.geometry_type === "Symbol";

    if (isTowerLayer && layer.layer_id) {
      if (map.getLayer(layer.layer_id)) {
        const originalVisibility =
          layer.layer_style.layout_visibility || "visible";
        map.setLayoutProperty(layer.layer_id, "visibility", originalVisibility);
      }
    }
  });
};

// Watch for geojson changes and add to map
watch(
  [geojsonSector, geojsonTower],
  async ([sector, tower]) => {
    if (!sector && !tower) return;

    hideExistingTowerLayers();

    if (sector) {
      addSectorLayerToMap(sector);
    }
    if (tower) {
      await addTowerLayerToMap(tower);
    }

    nextTick(() => {
      flyToExtent();
      if (tower) bindTowerInteractions();
    });
  },
  { immediate: true },
);

// Cleanup on unmount
onUnmounted(() => {
  removeTowerPopup();
  unbindTowerInteractions();
  exitEditMode();
  removeSectorLayerFromMap();
  removeTowerLayerFromMap();
  showExistingTowerLayers();
  toolsStore.showTools = true;
});

// Toggle layer visibility
const toggleVisibility = () => {
  isDataVisible.value = !isDataVisible.value;
  const map = mapRefStore.map;
  if (!map) return;

  const visibility = isDataVisible.value ? "visible" : "none";

  if (map.getLayer(`${SECTOR_LAYER_ID}-fill`)) {
    map.setLayoutProperty(`${SECTOR_LAYER_ID}-fill`, "visibility", visibility);
  }
  if (map.getLayer(`${SECTOR_LAYER_ID}-line`)) {
    map.setLayoutProperty(`${SECTOR_LAYER_ID}-line`, "visibility", visibility);
  }
  if (map.getLayer(TOWER_LAYER_ID)) {
    map.setLayoutProperty(TOWER_LAYER_ID, "visibility", visibility);
  }
};

/* ------------------------------------------------------------------ *
 *  Sector editing (drag azimuth / beam_width) — all sectors in parallel
 * ------------------------------------------------------------------ */
const EDIT_SOURCE_ID = "antenna-sector-edit";
const EDIT_FILL_ID = `${EDIT_SOURCE_ID}-fill`;
const EDIT_LINE_ID = `${EDIT_SOURCE_ID}-line`;

const SECTOR_COLORS: Record<number, string> = {
  1: "#00B050",
  2: "#0070C0",
  3: "#ED7D31",
};

const EDGE_COLOR = "#F59E0B";

// rotate (azimuth) and left/right resize (beam width) glyphs
const ROTATE_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v5h-5"/></svg>`;
const RESIZE_SVG = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7l-4 5 4 5"/><path d="M15 7l4 5-4 5"/></svg>`;

// Build a circular drag-handle DOM element for a maplibregl.Marker.
const createHandleEl = (color: string, kind: "rotate" | "edge"): HTMLElement => {
  const size = kind === "rotate" ? 22 : 18;
  const el = document.createElement("div");
  el.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;background:#fff;border:2px solid ${color};box-shadow:0 1px 3px rgba(0,0,0,0.35);color:${color};display:flex;align-items:center;justify-content:center;cursor:grab;`;
  el.innerHTML = kind === "rotate" ? ROTATE_SVG : RESIZE_SVG;
  return el;
};

const isEditMode = ref(false);
const isSaving = ref(false);
const isEditCardOpen = ref(false);
const editItemId = ref<number | null>(null);

type SectorEdit = {
  sectorNo: number;
  center: LngLat;
  azimuth: number;
  beamWidth: number;
  originalAzimuth: number;
  originalBeamWidth: number;
  rotate: Marker;
  edgeA: Marker;
  edgeB: Marker;
};

// Non-reactive marker/geometry state; `sectorView` is the reactive mirror for the card.
let edits: SectorEdit[] = [];
const sectorView = ref<
  { sectorNo: number; azimuth: number; beamWidth: number }[]
>([]);

const popupTower = ref<{ itemId: number; name: string; owner: string } | null>(
  null,
);
const towerPopupRef = ref<HTMLElement | null>(null);
let towerPopup: Popup | null = null;

const clamp = (v: number, min: number, max: number) =>
  Math.min(max, Math.max(min, v));

const getItemCenter = (item: any): LngLat | null => {
  if (!item?.geom) return null;
  const geom = typeof item.geom === "string" ? JSON.parse(item.geom) : item.geom;
  if (!geom?.coordinates) return null;
  return [geom.coordinates[0], geom.coordinates[1]];
};

const syncView = () => {
  sectorView.value = edits.map((e) => ({
    sectorNo: e.sectorNo,
    azimuth: e.azimuth,
    beamWidth: e.beamWidth,
  }));
};

const updatePreview = () => {
  const map = mapRefStore.map;
  if (!map) return;

  const data: any = {
    type: "FeatureCollection",
    features: edits.map((e) => ({
      type: "Feature",
      properties: {
        sectorNo: e.sectorNo,
        color: SECTOR_COLORS[e.sectorNo] || "#2563EB",
      },
      geometry: buildSectorWedge(e.center, e.azimuth, e.beamWidth, radiusM.value),
    })),
  };

  const src = map.getSource(EDIT_SOURCE_ID) as any;
  if (src) {
    src.setData(data);
    return;
  }
  map.addSource(EDIT_SOURCE_ID, { type: "geojson", data });
  map.addLayer({
    id: EDIT_FILL_ID,
    type: "fill",
    source: EDIT_SOURCE_ID,
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.35 },
  });
  map.addLayer({
    id: EDIT_LINE_ID,
    type: "line",
    source: EDIT_SOURCE_ID,
    paint: { "line-color": ["get", "color"], "line-width": 2 },
  });
};

const removePreview = () => {
  const map = mapRefStore.map;
  if (!map) return;
  if (map.getLayer(EDIT_LINE_ID)) map.removeLayer(EDIT_LINE_ID);
  if (map.getLayer(EDIT_FILL_ID)) map.removeLayer(EDIT_FILL_ID);
  if (map.getSource(EDIT_SOURCE_ID)) map.removeSource(EDIT_SOURCE_ID);
};

const positionSectorMarkers = (e: SectorEdit) => {
  const r = radiusM.value;
  e.rotate.setLngLat(destination(e.center, r, e.azimuth));
  e.edgeA.setLngLat(destination(e.center, r, e.azimuth - e.beamWidth / 2));
  e.edgeB.setLngLat(destination(e.center, r, e.azimuth + e.beamWidth / 2));
};

const onRotateDrag = (e: SectorEdit) => {
  const ll = e.rotate.getLngLat();
  e.azimuth = Math.round(bearing(e.center, [ll.lng, ll.lat])) % 360;
  positionSectorMarkers(e);
  updatePreview();
  syncView();
};

const onEdgeDrag = (e: SectorEdit, marker: Marker) => {
  const ll = marker.getLngLat();
  const b = bearing(e.center, [ll.lng, ll.lat]);
  const half = Math.abs(angularDelta(b, e.azimuth));
  e.beamWidth = clamp(Math.round(half * 2), 5, 120);
  positionSectorMarkers(e);
  updatePreview();
  syncView();
};

// Hide all of the edited tower's static server sectors (the preview replaces them).
const applyEditHideFilter = () => {
  const map = mapRefStore.map;
  if (!map || editItemId.value == null) return;
  const f: any = ["!", ["==", ["get", "item_id"], editItemId.value]];
  if (map.getLayer(`${SECTOR_LAYER_ID}-fill`)) {
    map.setFilter(`${SECTOR_LAYER_ID}-fill`, f);
  }
  if (map.getLayer(`${SECTOR_LAYER_ID}-line`)) {
    map.setFilter(`${SECTOR_LAYER_ID}-line`, f);
  }
};

const clearEditHideFilter = () => {
  const map = mapRefStore.map;
  if (!map) return;
  if (map.getLayer(`${SECTOR_LAYER_ID}-fill`)) {
    map.setFilter(`${SECTOR_LAYER_ID}-fill`, null);
  }
  if (map.getLayer(`${SECTOR_LAYER_ID}-line`)) {
    map.setFilter(`${SECTOR_LAYER_ID}-line`, null);
  }
};

const removeEditMarkers = () => {
  edits.forEach((e) => {
    e.rotate.remove();
    e.edgeA.remove();
    e.edgeB.remove();
  });
  edits = [];
};

const buildEdits = (itemId: number) => {
  const map = mapRefStore.map;
  if (!map) return;
  removeEditMarkers();

  const item = (editItems.value || []).find((i: any) => i.id === itemId);
  const center = item ? getItemCenter(item) : null;
  if (!center) return;

  const r = radiusM.value;
  [1, 2, 3].forEach((n) => {
    const az = item[`s${n}_azimuth`];
    const bw = item[`s${n}_beam_width`];
    if (az == null || bw == null) return;

    const rotate = new Marker({
      draggable: true,
      element: createHandleEl(SECTOR_COLORS[n], "rotate"),
    })
      .setLngLat(destination(center, r, az))
      .addTo(map);
    const edgeA = new Marker({
      draggable: true,
      element: createHandleEl(EDGE_COLOR, "edge"),
    })
      .setLngLat(destination(center, r, az - bw / 2))
      .addTo(map);
    const edgeB = new Marker({
      draggable: true,
      element: createHandleEl(EDGE_COLOR, "edge"),
    })
      .setLngLat(destination(center, r, az + bw / 2))
      .addTo(map);

    const e: SectorEdit = {
      sectorNo: n,
      center,
      azimuth: az,
      beamWidth: bw,
      originalAzimuth: az,
      originalBeamWidth: bw,
      rotate,
      edgeA,
      edgeB,
    };
    rotate.on("drag", () => onRotateDrag(e));
    edgeA.on("drag", () => onEdgeDrag(e, edgeA));
    edgeB.on("drag", () => onEdgeDrag(e, edgeB));
    edits.push(e);
  });

  applyEditHideFilter();
  updatePreview();
  syncView();
};

const clearEdits = () => {
  removeEditMarkers();
  removePreview();
  clearEditHideFilter();
  sectorView.value = [];
};

/* --- Tower click -> popup -> bottom edit card --- */
const removeTowerPopup = () => {
  towerPopup?.remove();
  towerPopup = null;
};

const onTowerClick = (e: any) => {
  const map = mapRefStore.map;
  if (!map) return;
  const feats = map.queryRenderedFeatures(e.point, { layers: [TOWER_LAYER_ID] });
  if (!feats.length) return;
  const f: any = feats[0];
  const itemId = Number(f.id ?? f.properties?.id);
  const item = (editItems.value || []).find((i: any) => i.id === itemId);
  if (!item) return;

  const tower = {
    itemId,
    name: item.tower_name || `Tower ${itemId}`,
    owner: item.tower_owner || "",
  };

  // Already editing: clicking another tower switches to it directly (no popup).
  if (isEditMode.value) {
    if (itemId === editItemId.value) return;
    popupTower.value = tower;
    editItemId.value = itemId;
    buildEdits(itemId);
    return;
  }

  // Not editing yet: show the popup that triggers edit mode.
  popupTower.value = tower;
  removeTowerPopup();
  if (towerPopupRef.value) {
    towerPopup = new Popup({
      closeButton: true,
      closeOnClick: true,
      className: "geod-popup",
    })
      .setLngLat(e.lngLat)
      .setDOMContent(towerPopupRef.value)
      .addTo(map);
  }
};

const onTowerEnter = () => {
  const map = mapRefStore.map;
  if (map) map.getCanvas().style.cursor = "pointer";
};
const onTowerLeave = () => {
  const map = mapRefStore.map;
  if (map) map.getCanvas().style.cursor = "";
};

const bindTowerInteractions = () => {
  const map = mapRefStore.map;
  if (!map) return;
  map.off("click", TOWER_LAYER_ID, onTowerClick);
  map.on("click", TOWER_LAYER_ID, onTowerClick);
  map.off("mouseenter", TOWER_LAYER_ID, onTowerEnter);
  map.on("mouseenter", TOWER_LAYER_ID, onTowerEnter);
  map.off("mouseleave", TOWER_LAYER_ID, onTowerLeave);
  map.on("mouseleave", TOWER_LAYER_ID, onTowerLeave);
};

const unbindTowerInteractions = () => {
  const map = mapRefStore.map;
  if (!map) return;
  map.off("click", TOWER_LAYER_ID, onTowerClick);
  map.off("mouseenter", TOWER_LAYER_ID, onTowerEnter);
  map.off("mouseleave", TOWER_LAYER_ID, onTowerLeave);
};

const enterEditMode = () => {
  isEditMode.value = true;
  mapRefStore.setDrawMode(true);
};

const exitEditMode = () => {
  clearEdits();
  const map = mapRefStore.map;
  if (map) map.getCanvas().style.cursor = "";
  isEditMode.value = false;
  mapRefStore.setDrawMode(false);
};

const startEditFromPopup = () => {
  if (!popupTower.value) return;
  removeTowerPopup();
  editItemId.value = popupTower.value.itemId;
  toolsStore.showTools = false;
  isEditCardOpen.value = true;
  enterEditMode();
  buildEdits(editItemId.value);
};

const closeEditCard = () => {
  exitEditMode();
  isEditCardOpen.value = false;
  editItemId.value = null;
  toolsStore.showTools = true;
};

const resetAll = () => {
  edits.forEach((e) => {
    e.azimuth = e.originalAzimuth;
    e.beamWidth = e.originalBeamWidth;
    positionSectorMarkers(e);
  });
  updatePreview();
  syncView();
};

const saveAll = async () => {
  if (!edits.length || editItemId.value == null) return;
  isSaving.value = true;
  const itemId = editItemId.value;
  try {
    const body: any = {};
    edits.forEach((e) => {
      body[`s${e.sectorNo}_azimuth`] = Math.round(e.azimuth);
      body[`s${e.sectorNo}_beam_width`] = e.beamWidth;
    });

    await $fetch(`/panel/items/antenna_direction_item/${itemId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    });

    toast.add({
      title: "Sectors Updated",
      description: "Footprint coverage is being recalculated",
      icon: "i-heroicons-check-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    // Remove the edit handles/preview after saving, then refresh the static
    // sector geojson + tower list. Edit mode stays on so clicking another
    // tower keeps editing directly.
    clearEdits();
    editItemId.value = null;
    popupTower.value = null;
    await refetchEditItems();
    await refetchSector();
    queryClient.invalidateQueries({ queryKey: ["antenna_direction_item_list"] });
  } catch (error: any) {
    toast.add({
      title: "Save Failed",
      description: error?.data?.message || "Could not update the sectors",
      icon: "i-heroicons-x-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isSaving.value = false;
  }
};
</script>

<template>
  <div class="py-3 flex flex-col gap-3">
    <!-- Section 1: Action Buttons -->
    <div class="flex flex-col gap-2">
      <UButton
        size="xs"
        color="gray"
        variant="outline"
        :ui="{ rounded: 'rounded-xxs', padding: { xs: 'px-2 py-2' } }"
        @click="toggleVisibility"
        block
        class="flex items-center gap-1"
      >
        <component :is="isDataVisible ? IcEye : IcEyeCrossed" class="w-4 h-4" />
        <span class="text-[10px]">{{
          isDataVisible ? "Visible" : "Hidden"
        }}</span>
      </UButton>
      <p class="text-[10px] text-grey-500 text-center">
        Click a tower on the map to edit its sectors.
      </p>
    </div>

    <UDivider />

    <!-- Section 2: Data List -->
    <div class="flex flex-col gap-2">
      <p class="text-md text-grey-700 font-semibold">Antenna Direction Result</p>

      <MapAnalysisAntennaDirectionContent
        :antenna-direction-id="antennaDirectionId"
      />
    </div>

    <!-- Tower popup content (moved into a maplibregl.Popup on click) -->
    <div class="hidden">
      <div ref="towerPopupRef">
        <div class="w-56 p-3 bg-white rounded-xs text-grey-700 space-y-2">
          <div>
            <h4 class="text-xs font-semibold text-grey-900">
              {{ popupTower?.name }}
            </h4>
            <p v-if="popupTower?.owner" class="text-2xs text-grey-500">
              {{ popupTower?.owner }}
            </p>
          </div>
          <button
            @click="startEditFromPopup"
            class="w-full h-8 rounded-xxs bg-brand-500 text-white text-xs font-normal hover:bg-brand-600"
          >
            Edit Direction
          </button>
        </div>
      </div>
    </div>

    <!-- Bottom edit card -->
    <Teleport to="body">
      <div
        v-if="isEditCardOpen"
        class="fixed bottom-6 left-1/2 -translate-x-1/2 z-30 w-[22rem] max-w-[90vw] rounded-xs bg-white shadow-xl ring-1 ring-grey-300"
      >
        <div class="flex items-center gap-2 p-3 border-b border-grey-200">
          <UIcon name="i-heroicons-signal" class="w-4 h-4 text-brand-500" />
          <p class="flex-1 text-xs font-semibold text-grey-900 truncate">
            {{ popupTower?.name || "Edit Antenna Direction" }}
          </p>
          <button @click="closeEditCard">
            <UIcon name="i-heroicons-x-mark" class="w-4 h-4 text-grey-400" />
          </button>
        </div>

        <div class="p-3 space-y-3">
          <template v-if="sectorView.length">
            <div
              v-for="s in sectorView"
              :key="s.sectorNo"
              class="flex items-center justify-between text-2xs text-grey-700"
            >
              <span class="flex items-center gap-1.5 font-medium">
                <span
                  class="w-2.5 h-2.5 rounded-full"
                  :style="{ backgroundColor: SECTOR_COLORS[s.sectorNo] }"
                ></span>
                Sector {{ s.sectorNo }}
              </span>
              <span class="flex items-center gap-3 text-grey-600">
                <span>Az {{ s.azimuth.toFixed(0) }}&deg;</span>
                <span>BW {{ s.beamWidth }}&deg;</span>
              </span>
            </div>
            <p class="text-[10px] text-grey-500">
              Drag a colored handle to rotate that sector, the amber handles to
              change its width.
            </p>
            <div class="grid grid-cols-2 gap-2">
              <UButton
                label="Reset"
                color="gray"
                variant="outline"
                size="xs"
                block
                :disabled="isSaving"
                @click="resetAll"
                :ui="{ rounded: 'rounded-xxs' }"
              />
              <UButton
                label="Save"
                color="brand"
                size="xs"
                block
                :loading="isSaving"
                @click="saveAll"
                :ui="{ rounded: 'rounded-xxs' }"
              />
            </div>
          </template>
          <p v-else class="text-[10px] text-grey-600">
            Click a tower on the map to edit its sectors.
          </p>
        </div>
      </div>
    </Teleport>
  </div>
</template>
