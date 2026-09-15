<script setup lang="ts">
import { ref, computed } from "vue";
import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import { postSitePoints } from "~/utils/ftthManualAdd";

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();
const analysisStore = useAnalysisResult();
const manualAdd = useFtthManualAdd();
const { refreshProjectLayer } = useFtthProjectLayers();

const latitude = ref<string>("");
const longitude = ref<string>("");
const isAdding = ref(false);

// Points drawn but not yet POSTed (shown in the MapboxDraw layer).
const drawnPoints = ref<[number, number][]>([]);
const pointsCount = computed(() => drawnPoints.value.length);
const canAddData = computed(() => pointsCount.value > 0 && !isAdding.value);

const handlePointCreated = (feature: Feature<Geometry, GeoJsonProperties>) => {
  if (feature.geometry.type !== "Point") return;
  const coords = feature.geometry.coordinates as [number, number];
  drawnPoints.value.push(coords);
  longitude.value = coords[0].toFixed(6);
  latitude.value = coords[1].toFixed(6);
  if (drawerInstance) {
    setTimeout(() => drawerInstance.changeMode("draw_point"), 0);
  }
};

let drawerInstance: any = null;
const initDrawControl = () => {
  const { drawer } = useDrawControl({
    mode: "draw_point",
    onCreated: handlePointCreated,
  });
  drawerInstance = drawer;
};

const addPointFromCoordinates = () => {
  if (!latitude.value || !longitude.value || !drawerInstance) return;
  const latNum = parseFloat(latitude.value);
  const lngNum = parseFloat(longitude.value);
  if (isNaN(latNum) || isNaN(lngNum)) return;

  const exists = drawnPoints.value.some(
    (p) => p[0] === lngNum && p[1] === latNum,
  );
  if (exists) return;

  drawerInstance.add({
    type: "Feature",
    geometry: { type: "Point", coordinates: [lngNum, latNum] },
    properties: {},
  });
  drawnPoints.value.push([lngNum, latNum]);

  if (mapRefStore.map) {
    mapRefStore.map.flyTo({
      center: [lngNum, latNum],
      zoom: Math.max(mapRefStore.map.getZoom(), 15),
      duration: 1000,
    });
  }
};

const removePoint = (index: number) => {
  const pt = drawnPoints.value[index];
  drawnPoints.value.splice(index, 1);
  if (drawerInstance) {
    const all = drawerInstance.getAll();
    const target = all.features.find(
      (f: any) =>
        f.geometry.type === "Point" &&
        f.geometry.coordinates[0] === pt[0] &&
        f.geometry.coordinates[1] === pt[1],
    );
    if (target) drawerInstance.delete(target.id);
  }
};

const handleReset = () => {
  latitude.value = "";
  longitude.value = "";
  drawnPoints.value = [];
  if (drawerInstance) {
    try {
      drawerInstance.deleteAll();
    } catch (e) {
      /* control already removed */
    }
  }
};

const handleAddData = async () => {
  const pid = analysisStore.ftthAnalysisProjectId;
  if (pointsCount.value === 0 || !pid) return;
  isAdding.value = true;
  const count = pointsCount.value;
  try {
    await postSitePoints(
      pid,
      drawnPoints.value.map((coords) => ({ coordinates: coords })),
      authStore.accessToken,
    );
    await refreshProjectLayer(pid, "site-points");
    manualAdd.markAdded(count);
    toast.add({
      title: "Site Point ditambahkan",
      description: `${count} site point tersimpan ke project.`,
      icon: "i-heroicons-check-circle",
      color: "green",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    handleReset();
  } catch (e: any) {
    console.error("Error adding site points:", e);
    toast.add({
      title: "Error",
      description: e?.data?.message || "Gagal menambah site point.",
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
  initDrawControl();
});

onUnmounted(() => {
  // Do not touch the drawer here — useDrawControl handles its own teardown.
  mapRefStore.setDrawMode(false);
  latitude.value = "";
  longitude.value = "";
  drawnPoints.value = [];
});
</script>

<template>
  <div class="p-2">
    <p class="text-2xs text-[#626264] mb-2">
      Klik pada map atau masukkan koordinat untuk menambah site point.
    </p>

    <div v-if="pointsCount > 0" class="mb-1">
      <span class="text-2xs font-medium text-brand-500">
        {{ pointsCount }} titik siap ditambahkan
      </span>
    </div>

    <!-- Drawn points list -->
    <div v-if="pointsCount > 0" class="my-2 border rounded-xxs divide-y">
      <div
        v-for="(pt, index) in drawnPoints"
        :key="index"
        class="flex items-center justify-between px-2 py-1"
      >
        <p class="text-2xs text-grey-800">
          {{ pt[1].toFixed(5) }}, {{ pt[0].toFixed(5) }}
        </p>
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

    <!-- Manual coordinates -->
    <div class="space-y-2">
      <label class="text-2xs text-[#626264]">Manual Coordinates</label>
      <div class="grid grid-cols-2 gap-2">
        <UInput
          v-model="latitude"
          variant="outline"
          size="2xs"
          placeholder="Latitude"
          type="number"
          step="0.000001"
        />
        <UInput
          v-model="longitude"
          variant="outline"
          size="2xs"
          placeholder="Longitude"
          type="number"
          step="0.000001"
        />
      </div>
      <UButton
        variant="outline"
        color="gray"
        label="Add Point"
        block
        size="xs"
        :disabled="!latitude || !longitude"
        :ui="{ rounded: 'rounded-xxs' }"
        @click="addPointFromCoordinates"
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
      label="Add Site Point"
      block
      :disabled="!canAddData"
      :loading="isAdding"
      :ui="{ rounded: 'rounded-xxs' }"
      @click="handleAddData"
    />
  </div>
</template>
