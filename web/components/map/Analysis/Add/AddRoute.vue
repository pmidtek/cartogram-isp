<script setup lang="ts">
import { ref, computed } from "vue";
import { postRoute } from "~/utils/ftthManualAdd";

const authStore = useAuth();
const toast = useToast();
const analysisStore = useAnalysisResult();
const manualAdd = useFtthManualAdd();
const { refreshProjectLayer } = useFtthProjectLayers();

const {
  selectedPoints,
  routeGeometry,
  routeLength,
  isGeneratingRoute,
  isDrawingManually,
  canGenerate,
  handleAutoGenerate,
  handleDrawManually,
  removePoint,
  resetDraft,
  mountHandlers,
  unmountHandlers,
} = useFtthRouteDraft();

const routeTypes = ref<Array<{ label: string; value: number }>>([]);
const selectedRouteType = ref<number | null>(null);
const isAdding = ref(false);

const canAdd = computed(
  () =>
    routeGeometry.value !== null &&
    selectedRouteType.value !== null &&
    !isAdding.value,
);

const fetchRouteTypes = async () => {
  try {
    const url = "/panel/items/route_types?filter[is_ftth][_eq]=true&sort=name";
    const response = await $fetch<{ data: Array<{ id: number; name: string }> }>(
      url,
      { headers: { Authorization: `Bearer ${authStore.accessToken}` } },
    );
    const data = Array.isArray(response) ? response : response.data;
    routeTypes.value = data.map((t) => ({ label: t.name, value: t.id }));
  } catch (e) {
    console.error("Error fetching route types:", e);
  }
};

const handleAddRoute = async () => {
  const pid = analysisStore.ftthAnalysisProjectId;
  if (!routeGeometry.value || selectedPoints.value.length !== 2) return;
  if (!selectedRouteType.value || !pid) return;
  isAdding.value = true;
  try {
    await postRoute(
      pid,
      {
        route_type_id: selectedRouteType.value,
        site_from: selectedPoints.value[0].ogc_fid,
        site_to: selectedPoints.value[1].ogc_fid,
        length_m: parseFloat(routeLength.value) || 0,
        geom: routeGeometry.value,
      },
      authStore.accessToken,
    );
    await refreshProjectLayer(pid, "routes");
    manualAdd.markAdded();
    toast.add({
      title: "Route ditambahkan",
      description: "Route tersimpan ke project.",
      icon: "i-heroicons-check-circle",
      color: "green",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    resetDraft();
  } catch (e: any) {
    console.error("Error adding route:", e);
    toast.add({
      title: "Error",
      description: e?.data?.message || "Gagal menambah route.",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isAdding.value = false;
  }
};

onMounted(() => {
  mountHandlers();
  fetchRouteTypes();
});
onUnmounted(() => unmountHandlers());
</script>

<template>
  <div class="p-2">
    <p class="text-2xs text-[#626264] mb-2">
      Pilih route type lalu 2 site point untuk dihubungkan.
    </p>

    <!-- Route Type -->
    <div class="mb-3">
      <label class="text-2xs text-[#626264] mb-1 block">
        Route Type <span class="text-red-500">*</span>
      </label>
      <USelect
        v-model="selectedRouteType"
        :options="routeTypes"
        option-attribute="label"
        value-attribute="value"
        size="2xs"
        placeholder="Select route type"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Selected points -->
    <div v-if="selectedPoints.length > 0" class="mb-3">
      <label class="text-2xs text-[#626264] mb-2 block">
        Site Point ({{ selectedPoints.length }}/2)
      </label>
      <div class="border rounded-xxs divide-y">
        <div
          v-for="(point, index) in selectedPoints"
          :key="index"
          class="flex items-center justify-between px-2 py-0.5"
        >
          <p class="text-2xs font-medium text-grey-900">
            Point {{ index + 1 }}{{ point.name ? `: ${point.name}` : "" }}
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
    </div>

    <!-- Length -->
    <div class="mb-3">
      <label class="text-2xs text-[#626264] mb-1 block">Route Length</label>
      <UInput v-model="routeLength" size="2xs" variant="outline" readonly>
        <template #trailing>
          <span class="text-2xs text-grey-600">meters</span>
        </template>
      </UInput>
    </div>

    <!-- Generate buttons -->
    <div class="grid grid-cols-2 gap-2">
      <UButton
        label="Auto Generate"
        icon="i-material-symbols:alt-route-rounded"
        size="xs"
        color="gray"
        block
        :disabled="!canGenerate"
        :loading="isGeneratingRoute"
        :ui="{ rounded: 'rounded-xxs' }"
        @click="handleAutoGenerate"
      />
      <UButton
        :label="isDrawingManually ? 'Drawing...' : 'Draw Manually'"
        :icon="
          isDrawingManually ? 'i-heroicons-hand-raised' : 'i-heroicons-pencil'
        "
        block
        size="xs"
        :color="isDrawingManually ? 'brand' : 'gray'"
        :disabled="!canGenerate || isDrawingManually"
        :ui="{ rounded: 'rounded-xxs' }"
        @click="handleDrawManually"
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
      @click="resetDraft"
    />
    <UButton
      variant="solid"
      color="brand"
      label="Add Route"
      block
      :disabled="!canAdd"
      :loading="isAdding"
      :ui="{ rounded: 'rounded-xxs' }"
      @click="handleAddRoute"
    />
  </div>
</template>
