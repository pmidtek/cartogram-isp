<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { showHighlightLayer } from "~/utils/index";
import { postCable } from "~/utils/ftthManualAdd";

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();
const analysisStore = useAnalysisResult();
const manualAdd = useFtthManualAdd();
const { refreshProjectLayer } = useFtthProjectLayers();

interface RouteRecommendation {
  geojson: any;
  routes: number[];
  site_points: string[];
  length: string;
}

const selectedSitePoints = ref<
  Array<{
    ogc_fid: string | number;
    name: string;
    coordinates: [number, number];
    id: string;
  }>
>([]);

const routeRecommendations = ref<RouteRecommendation[]>([]);
const selectedRouteOption = ref<RouteRecommendation | null>(null);

const routeTypes = ref<Array<{ label: string; value: number }>>([]);
const selectedRouteType = ref<number | null>(null);

const cableTypes = ref<Array<{ label: string; value: number }>>([]);
const selectedCableType = ref<number | null>(null);

const isLoadingRoutes = ref(false);
const isAdding = ref(false);

const canSelectMorePoints = computed(() => selectedSitePoints.value.length < 2);

const routeOptions = computed(() =>
  routeRecommendations.value.map((route, index) => ({
    label: route.site_points?.length
      ? route.site_points.join(" → ")
      : `Route ${index + 1}`,
    value: index,
  })),
);

const canAddCable = computed(
  () =>
    selectedSitePoints.value.length === 2 &&
    selectedRouteOption.value !== null &&
    selectedCableType.value !== null &&
    !isAdding.value,
);

// Project site-points layer to click.
const sitePointLayerIds = (): string[] => {
  const map = mapRefStore.map;
  const pid = analysisStore.ftthAnalysisProjectId;
  if (!map || !pid) return [];
  const layer = `project-${pid}-site-points-layer`;
  return map.getLayer(layer) ? [layer] : [];
};

const refreshHighlight = () => {
  const map = mapRefStore.map;
  if (!map) return;
  showHighlightLayer(
    map,
    selectedSitePoints.value.map((pt) => ({
      geom: { type: "Point", coordinates: pt.coordinates } as any,
    })),
    "ftth-cable-point-highlight",
    true,
  );
};

const clearHighlight = () => {
  const map = mapRefStore.map;
  if (map?.getSource("highlight")) {
    (map.getSource("highlight") as any).setData({
      type: "FeatureCollection",
      features: [],
    });
  }
};

const handleMapClick = (e: any) => {
  const map = mapRefStore.map;
  if (!map || !canSelectMorePoints.value) return;
  const layers = sitePointLayerIds();
  if (!layers.length) return;

  const features = map.queryRenderedFeatures(e.point, { layers });
  if (!features.length) return;
  const feature = features[0];
  if (feature.geometry.type !== "Point") return;

  const ogcFid =
    feature.properties?.ogc_fid ??
    feature.properties?.id ??
    (feature.id as string | number);
  const id = String(ogcFid ?? `selected-${Date.now()}`);
  if (selectedSitePoints.value.some((pt) => pt.id === id) || !ogcFid) return;

  const coords = feature.geometry.coordinates as [number, number];
  selectedSitePoints.value.push({
    ogc_fid: ogcFid,
    name: feature.properties?.name || `Site ${ogcFid}`,
    coordinates: [coords[0], coords[1]],
    id,
  });
  refreshHighlight();
};

const handleMapMouseMove = (e: any) => {
  const map = mapRefStore.map;
  if (!map || !canSelectMorePoints.value) return;
  const layers = sitePointLayerIds();
  if (!layers.length) return;
  const features = map.queryRenderedFeatures(e.point, { layers });
  map.getCanvas().style.cursor = features.length ? "pointer" : "";
};

const fetchRouteTypes = async () => {
  try {
    const url = "/panel/items/route_types?filter[is_ftth][_eq]=true&sort=name";
    const response = await $fetch<{ data: Array<{ id: number; name: string }> }>(
      url,
      { headers: { Authorization: `Bearer ${authStore.accessToken}` } },
    );
    const data = Array.isArray(response) ? response : response.data;
    routeTypes.value = data.map((t) => ({ label: t.name, value: t.id }));
    if (selectedRouteType.value === null && routeTypes.value.length) {
      selectedRouteType.value = routeTypes.value[0].value;
    }
  } catch (e) {
    console.error("Error fetching route types:", e);
  }
};

const fetchCableTypes = async () => {
  try {
    const url = "/panel/items/cable_types?filter[is_ftth][_eq]=true&sort=name";
    const response = await $fetch<{ data: Array<{ id: number; name: string }> }>(
      url,
      { headers: { Authorization: `Bearer ${authStore.accessToken}` } },
    );
    const data = Array.isArray(response) ? response : response.data;
    cableTypes.value = data.map((t) => ({ label: t.name, value: t.id }));
    if (selectedCableType.value === null && cableTypes.value.length) {
      selectedCableType.value = cableTypes.value[0].value;
    }
  } catch (e) {
    console.error("Error fetching cable types:", e);
  }
};

const fetchRouteRecommendations = async () => {
  if (selectedSitePoints.value.length !== 2 || selectedRouteType.value === null)
    return;
  const siteFrom = selectedSitePoints.value[0].ogc_fid;
  const siteTo = selectedSitePoints.value[1].ogc_fid;
  isLoadingRoutes.value = true;
  try {
    const url = `/panel/analysis/route-recomendations?site_from=${siteFrom}&site_to=${siteTo}&route_type_id=${selectedRouteType.value}`;
    const response = await $fetch<{ data: RouteRecommendation[] }>(url, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
    routeRecommendations.value = response.data || [];
    if (!routeRecommendations.value.length) {
      toast.add({
        title: "Tidak ada route",
        description: "Tidak ada rekomendasi route antar 2 titik ini.",
        icon: "i-heroicons-exclamation-triangle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
    }
  } catch (e) {
    console.error("Error fetching route recommendations:", e);
    routeRecommendations.value = [];
    toast.add({
      title: "Error",
      description: "Gagal memuat rekomendasi route.",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isLoadingRoutes.value = false;
  }
};

watch(
  () => selectedSitePoints.value.length,
  (len) => {
    if (len === 2) fetchRouteRecommendations();
  },
);

watch(selectedRouteType, () => {
  if (selectedSitePoints.value.length === 2) {
    selectedRouteOption.value = null;
    fetchRouteRecommendations();
  }
});

// === Route preview ===
const addRoutePreview = () => {
  const map = mapRefStore.map;
  if (!map || !selectedRouteOption.value) return;
  removeRoutePreview();
  map.addSource("ftth-cable-route-preview", {
    type: "geojson",
    data: selectedRouteOption.value.geojson,
  });
  map.addLayer({
    id: "ftth-cable-route-preview",
    type: "line",
    source: "ftth-cable-route-preview",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#FF6B00",
      "line-width": 4,
      "line-dasharray": [2, 2],
    },
  });
};

const removeRoutePreview = () => {
  const map = mapRefStore.map;
  if (!map) return;
  if (map.getLayer("ftth-cable-route-preview"))
    map.removeLayer("ftth-cable-route-preview");
  if (map.getSource("ftth-cable-route-preview"))
    map.removeSource("ftth-cable-route-preview");
};

watch(selectedRouteOption, (route) => {
  if (route) addRoutePreview();
  else removeRoutePreview();
});

const handleRouteSelection = (index: number | undefined) => {
  selectedRouteOption.value =
    index !== undefined && routeRecommendations.value[index]
      ? routeRecommendations.value[index]
      : null;
};

const removePoint = (index: number) => {
  selectedSitePoints.value.splice(index, 1);
  routeRecommendations.value = [];
  selectedRouteOption.value = null;
  removeRoutePreview();
  refreshHighlight();
};

const handleReset = () => {
  selectedSitePoints.value = [];
  routeRecommendations.value = [];
  selectedRouteOption.value = null;
  removeRoutePreview();
  clearHighlight();
};

const handleAddCable = async () => {
  const pid = analysisStore.ftthAnalysisProjectId;
  if (!canAddCable.value || !selectedRouteOption.value || !pid) return;
  isAdding.value = true;
  try {
    await postCable(
      pid,
      {
        site_from: selectedSitePoints.value[0].ogc_fid,
        site_to: selectedSitePoints.value[1].ogc_fid,
        cable_type_id: selectedCableType.value as number,
        cable_net_length_m: parseFloat(selectedRouteOption.value.length) || 0,
        route_ids: selectedRouteOption.value.routes,
      },
      authStore.accessToken,
    );
    await refreshProjectLayer(pid, "cables");
    manualAdd.markAdded();
    toast.add({
      title: "Cable ditambahkan",
      description: "Cable tersimpan ke project.",
      icon: "i-heroicons-check-circle",
      color: "green",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    handleReset();
  } catch (e: any) {
    console.error("Error adding cable:", e);
    toast.add({
      title: "Error",
      description: e?.data?.message || "Gagal menambah cable.",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isAdding.value = false;
  }
};

onMounted(() => {
  mapRefStore.setDrawMode(true);
  fetchRouteTypes();
  fetchCableTypes();
  const map = mapRefStore.map;
  if (map) {
    map.on("click", handleMapClick);
    map.on("mousemove", handleMapMouseMove);
  }
});

onUnmounted(() => {
  mapRefStore.setDrawMode(false);
  removeRoutePreview();
  clearHighlight();
  const map = mapRefStore.map;
  if (map) {
    map.off("click", handleMapClick);
    map.off("mousemove", handleMapMouseMove);
    map.getCanvas().style.cursor = "";
  }
});
</script>

<template>
  <div class="p-2">
    <p class="text-2xs text-[#626264] mb-2">
      <template v-if="selectedSitePoints.length < 2">
        Pilih 2 site point untuk membuat route kabel.
      </template>
      <template v-else-if="!selectedRouteOption">
        Pilih salah satu route dari dropdown di bawah.
      </template>
      <template v-else>Pilih cable type lalu klik "Add Cable".</template>
    </p>

    <!-- Selected points -->
    <div class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Site Point ({{ selectedSitePoints.length }}/2)
      </label>
      <div
        v-if="selectedSitePoints.length > 0"
        class="border rounded-xxs divide-y"
      >
        <div
          v-for="(point, index) in selectedSitePoints"
          :key="point.id"
          class="flex items-center justify-between px-2 py-0.5"
        >
          <span class="text-2xs font-medium text-grey-900">
            {{ index + 1 }}. {{ point.name }}
          </span>
          <UButton
            icon="i-heroicons-trash"
            variant="ghost"
            color="red"
            size="2xs"
            :ui="{ rounded: 'rounded-xxs' }"
            @click="removePoint(index)"
          />
        </div>
      </div>
      <div v-else class="text-center text-2xs text-grey-400 py-2">
        Klik site point pada map
      </div>
    </div>

    <!-- Route type (drives recommendations) -->
    <div v-if="selectedSitePoints.length === 2" class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Route Type <span class="text-red-500">*</span>
      </label>
      <USelect
        v-model="selectedRouteType"
        :options="routeTypes"
        option-attribute="label"
        value-attribute="value"
        variant="outline"
        size="2xs"
        :disabled="isLoadingRoutes"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Route selection -->
    <div v-if="selectedSitePoints.length === 2" class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Route Selection <span class="text-red-500">*</span>
      </label>
      <USelect
        :model-value="
          selectedRouteOption
            ? routeRecommendations.indexOf(selectedRouteOption)
            : undefined
        "
        :options="routeOptions"
        option-attribute="label"
        value-attribute="value"
        variant="outline"
        size="2xs"
        placeholder="Select route"
        :loading="isLoadingRoutes"
        :disabled="isLoadingRoutes || routeOptions.length === 0"
        :ui="{ rounded: 'rounded-xxs' }"
        @update:model-value="handleRouteSelection"
      />
      <p v-if="selectedRouteOption" class="text-2xs text-grey-500 mt-1">
        Panjang: {{ selectedRouteOption.length }} m
      </p>
    </div>

    <!-- Cable type -->
    <div v-if="selectedRouteOption" class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Cable Type <span class="text-red-500">*</span>
      </label>
      <USelect
        v-model="selectedCableType"
        :options="cableTypes"
        option-attribute="label"
        value-attribute="value"
        variant="outline"
        size="2xs"
        placeholder="Select cable type"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>
  </div>

  <div class="grid grid-cols-2 p-2 gap-2">
    <UButton
      variant="outline"
      color="gray"
      label="Reset"
      block
      :ui="{ rounded: 'rounded-xxs' }"
      @click="handleReset"
    />
    <UButton
      variant="solid"
      color="brand"
      label="Add Cable"
      block
      :disabled="!canAddCable"
      :loading="isAdding"
      :ui="{ rounded: 'rounded-xxs' }"
      @click="handleAddCable"
    />
  </div>
</template>
