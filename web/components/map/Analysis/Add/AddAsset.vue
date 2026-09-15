<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { showHighlightLayer } from "~/utils/index";
import {
  fetchFtthAssetTypes,
  fetchAssetGroups,
  postAssets,
} from "~/utils/ftthManualAdd";

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();
const analysisStore = useAnalysisResult();
const manualAdd = useFtthManualAdd();
const { refreshProjectLayer } = useFtthProjectLayers();

const assetTypes = ref<Array<{ label: string; value: number }>>([]);
const selectedAssetType = ref<number | null>(null);

const assetGroups = ref<Array<{ label: string; value: string }>>([]);
const selectedAssetGroup = ref<string | null>(null);
const loadingGroups = ref(false);
const hasGroups = computed(() => assetGroups.value.length > 0);

// Site points the assets will attach to.
const selectedSitePoints = ref<
  Array<{
    site_point_id: string | number;
    name: string;
    coordinates: [number, number];
    id: string;
  }>
>([]);

const isAdding = ref(false);

const selectedAssetTypeName = computed(
  () =>
    assetTypes.value.find((t) => t.value === selectedAssetType.value)?.label ||
    "",
);

const canAddData = computed(
  () =>
    selectedAssetType.value !== null &&
    (!hasGroups.value || selectedAssetGroup.value !== null) &&
    selectedSitePoints.value.length > 0 &&
    !isAdding.value,
);

const fetchTypes = async () => {
  try {
    const data = await fetchFtthAssetTypes(authStore.accessToken);
    assetTypes.value = data.map((t) => ({ label: t.name, value: t.id }));
  } catch (e) {
    console.error("Error fetching asset types:", e);
  }
};

// Load groups when asset type changes.
watch(selectedAssetType, async (id) => {
  selectedAssetGroup.value = null;
  assetGroups.value = [];
  if (id == null) return;
  loadingGroups.value = true;
  try {
    const groups = await fetchAssetGroups(id, authStore.accessToken);
    assetGroups.value = groups.map((g) => ({
      label: g.name || String(g.id),
      value: String(g.id),
    }));
    if (assetGroups.value.length) {
      selectedAssetGroup.value = assetGroups.value[0].value;
    }
  } finally {
    loadingGroups.value = false;
  }
});

// === Site point selection ===
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
    "ftth-asset-point-highlight",
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
  if (!map) return;
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
    site_point_id: ogcFid,
    name: feature.properties?.name || `Site ${ogcFid}`,
    coordinates: [coords[0], coords[1]],
    id,
  });
  refreshHighlight();
};

const handleMapMouseMove = (e: any) => {
  const map = mapRefStore.map;
  if (!map) return;
  const layers = sitePointLayerIds();
  if (!layers.length) return;
  const features = map.queryRenderedFeatures(e.point, { layers });
  map.getCanvas().style.cursor = features.length ? "pointer" : "";
};

const removePoint = (index: number) => {
  selectedSitePoints.value.splice(index, 1);
  refreshHighlight();
};

const handleReset = () => {
  selectedSitePoints.value = [];
  clearHighlight();
};

const handleAddData = async () => {
  const pid = analysisStore.ftthAnalysisProjectId;
  if (!canAddData.value || selectedAssetType.value === null || !pid) return;
  isAdding.value = true;
  const groupId = hasGroups.value ? selectedAssetGroup.value : null;
  const nameVal = groupId || selectedAssetTypeName.value;
  const count = selectedSitePoints.value.length;
  try {
    await postAssets(
      pid,
      selectedSitePoints.value.map((sp) => ({
        site_point_id: sp.site_point_id,
        asset_type_id: selectedAssetType.value as number,
        asset_group_id: groupId,
        name: nameVal,
        code: nameVal,
      })),
      authStore.accessToken,
    );
    await refreshProjectLayer(pid, "assets");
    manualAdd.markAdded(count);
    toast.add({
      title: "Asset ditambahkan",
      description: `${count} ${selectedAssetTypeName.value} tersimpan ke project.`,
      icon: "i-heroicons-check-circle",
      color: "green",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    handleReset();
  } catch (e: any) {
    console.error("Error adding assets:", e);
    toast.add({
      title: "Error",
      description: e?.data?.message || "Gagal menambah asset.",
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
  fetchTypes();
  const map = mapRefStore.map;
  if (map) {
    map.on("click", handleMapClick);
    map.on("mousemove", handleMapMouseMove);
  }
});

onUnmounted(() => {
  mapRefStore.setDrawMode(false);
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
      Pilih jenis asset & grup, lalu klik site point untuk memasang asset.
    </p>

    <!-- Asset type -->
    <div class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Asset Type <span class="text-red-500">*</span>
      </label>
      <USelect
        v-model="selectedAssetType"
        :options="assetTypes"
        option-attribute="label"
        value-attribute="value"
        size="2xs"
        placeholder="Select asset type"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Asset group -->
    <div v-if="hasGroups || loadingGroups" class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Asset Group <span class="text-red-500">*</span>
      </label>
      <USelect
        v-model="selectedAssetGroup"
        :options="assetGroups"
        option-attribute="label"
        value-attribute="value"
        size="2xs"
        :loading="loadingGroups"
        :disabled="loadingGroups"
        placeholder="Select asset group"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Attached site points -->
    <div class="mb-2">
      <label class="text-2xs text-[#626264] mb-1 block">
        Site Point ({{ selectedSitePoints.length }})
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
        Klik site point pada map untuk memasang asset
      </div>
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
      label="Add Assets"
      block
      :disabled="!canAddData"
      :loading="isAdding"
      :ui="{ rounded: 'rounded-xxs' }"
      @click="handleAddData"
    />
  </div>
</template>
