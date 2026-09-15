<script lang="ts" setup>
import type { GeoJSONSource, MapLayerTouchEvent } from "maplibre-gl";
import buffer from "@turf/buffer";
import area from "@turf/area";
import { convertLength, type Units } from "@turf/helpers";
import { useQuery } from "@tanstack/vue-query";
import type { HeaderData } from "../Management/Table.vue";

interface DataResult {
  class_ts: string | null;
  count: string;
}

interface LayerOption {
  label: string;
  value: string;
}

const mapStore = useMapRef();
const { map } = mapStore;
const toast = useToast();

const points = ref<[string, number, number][]>([]);
const areaBuffer = ref();
const isLoading = ref(false);
const isFetching = ref<boolean>(false);
const isInverted = ref(false);

const digitizeStore = useDigitizeStore();

// Layer and Intersection Handling
const layerStore = useMapLayer();
const activeLayers = computed(() => {
  return layerStore.groupedActiveLayers
    ?.map(({ layerLists }) => layerLists)
    .flat()
    .filter((el) => el.source === "vector_tiles")
    .map(({ layer_name }: any) => layer_name as string)
    .filter((layer_name) => layer_name.includes("admin"));
});

const activeLayersAdmin = computed(() => {
  return layerStore.groupedActiveLayers
    ?.map(({ layerLists }) => layerLists)
    .flat()
    .filter(
      (el) =>
        el.source === "vector_tiles" &&
        el.geometry_type === "Polygon" &&
        !el.layer_alias?.includes("_Footprint") &&
        !el.layer_alias?.includes("_footprint"),
    )
    .map(
      (layer: any) =>
        ({
          label: layer.layer_alias,
          value: layer.layer_name,
        }) as LayerOption,
    );
});

const selectedLayer = ref<string>();
const selectedLayerAdmin = ref<string>();
const selectedLayerLabel = ref<string>();
const selectedLayerName = ref<string>();
const enabled = computed(() => !!selectedLayer.value);

watchEffect(() => {
  console.log(selectedLayer.value);
  console.log(selectedLayerAdmin.value);
  console.log(selectedLayerName.value);
});
const isDropdownOpen = ref(false);

// Form validation
const isButtonDisabled = computed(() => {
  if (selectedType.value === "simple") {
    return !selectedLayerName.value || !selectedLayer.value;
  }
  return (
    !selectedLayerName.value || !selectedLayer.value || !selectedColumn.value
  );
});

// Search functionality
const searchQuery = ref("");
const filteredLayers = computed(() => {
  if (!searchQuery.value) return activeLayersAdmin.value;

  const query = searchQuery.value.toLowerCase();
  return activeLayersAdmin.value?.filter((layer) =>
    layer.label.toLowerCase().includes(query),
  );
});

// Reset form function
const resetForm = () => {
  selectedLayerName.value = undefined;
  selectedLayerAdmin.value = undefined;
  selectedLayer.value = undefined;
  selectedType.value = "categorical";
  selectedColumn.value = undefined;
  isInverted.value = false;
  searchQuery.value = "";
  isDropdownOpen.value = false;
  selectedLayerLabel.value = "";
};

const toggleDropdown = () => {
  isDropdownOpen.value = !isDropdownOpen.value;
  if (!isDropdownOpen.value) {
    searchQuery.value = "";
  }
};

const getSelectedLayerLabel = computed(() => {
  if (!selectedLayerName.value) return "Select Layer";
  return (
    activeLayersAdmin.value?.find(
      (layer) => layer.value === selectedLayerName.value,
    )?.label || "Select Layer"
  );
});

const selectLayer = (layer: LayerOption) => {
  selectedLayerName.value = layer.value;
  selectedLayerAdmin.value = layer.label;
  isDropdownOpen.value = false;
  searchQuery.value = "";
};

onMounted(() => {
  document.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".relative")) {
      isDropdownOpen.value = false;
    }
  });
});

const authStore = useAuth();

const {
  data: headerData,
  error: headerError,
  isFetching: isHeaderFetching,
  isError: isHeaderError,
} = useQuery({
  queryKey: [`/panel/vector-tiles-attribute-table-header/`, selectedLayer],
  queryFn: ({ queryKey }) =>
    $fetch<{
      data: HeaderData[];
    }>(queryKey[0] + queryKey[1]!, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    }).then((r) => r.data),
  enabled,
});

const columns = computed<
  {
    value: string;
    name: string;
  }[]
>(() => {
  if (headerData.value) {
    return headerData.value
      .filter((el) => el.type !== "geometry")
      .map((el: HeaderData) => ({
        value: el.field,
        name: capitalizeEachWords(el.field),
      }));
  } else return [];
});

const selectedType = ref("simple");
const selectedColumn = ref<{
  value: string;
  name: string;
}>();

watch(selectedLayer, () => {
  selectedColumn.value = undefined;
});

const featureStore = useFeature();
const analysisStore = useAnalysisResult();
const isAnalyze = ref(false);

const handleApply = async () => {
  if (isButtonDisabled.value || isLoading.value) return;

  try {
    isLoading.value = true;
    const token = authStore.accessToken;
    const url = `/panel/buffer/layer`;

    const body = {
      layer: selectedLayerName.value,
      layer_target: selectedLayer.value,
      type: selectedType.value,
      column: selectedColumn?.value,
      invert: isInverted.value,
    };

    if (selectedType.value === "simple") {
      delete body.column;
    }

    toast.add({
      title: "Processing",
      description: "Sending request to server...",
      icon: "i-heroicons-arrow-path",
      timeout: 2000,
    });

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    const dataResult: DataResult[] = await response.json();

    toast.add({
      title: "Success",
      description: "Data successfully digitized and stored.",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });

    digitizeStore.addDigitizedData({
      layerId: "select",
      name: "Select By Location",
      area: selectedLayerAdmin.value,
      coordinates: null,
      data: dataResult,
      layer: selectedLayer.value,
      selectLayer: selectedLayerName.value,
      selectTargetLayer: selectedLayer.value,
      invert: isInverted.value,
    });

    featureStore.setMapInfo("analytic");
    resetForm();
  } catch (error) {
    console.error("Error:", error);
    toast.add({
      title: "Error",
      description:
        error instanceof Error ? error.message : "An unexpected error occurred",
      icon: "i-heroicons-exclamation-circle",
    });
  } finally {
    isLoading.value = false;
  }
};
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <h3 class="text-grey-800 text-2xs">Location from</h3>
    <div class="relative">
      <div
        @click="toggleDropdown"
        class="cursor-pointer px-2 py-1 rounded-xxs text-grey-800 text-2xs bg-white border border-grey-600"
      >
        {{ getSelectedLayerLabel }}
      </div>
      <div
        v-if="isDropdownOpen"
        class="absolute z-10 mt-1 w-full rounded-xxs text-grey-800 text-2xs bg-white border border-grey-600"
      >
        <div class="p-2">
          <UInput
            v-model="searchQuery"
            placeholder="Search layers"
            :ui="{ rounded: 'rounded-xxs' }"
            size="2xs"
          />
        </div>
        <ul class="max-h-48 overflow-y-auto">
          <li
            v-for="layer in filteredLayers"
            :key="layer.value"
            @click="selectLayer(layer)"
            class="p-2 cursor-pointer hover:bg-grey-600"
          >
            {{ layer.label }}
          </li>
          <li v-if="filteredLayers.length === 0" class="p-2 text-gray-500">
            No results found
          </li>
        </ul>
      </div>
    </div>

    <h3 class="text-grey-800 text-2xs">Apply Analysis to</h3>
    <div class="grid grid-cols-3 gap-1">
      <USelect
        v-model="selectedLayer"
        :options="activeLayers"
        placeholder="Select Layer"
        :ui="{ rounded: 'rounded-xxs' }"
        size="2xs"
      />
      <USelect
        v-model="selectedType"
        :options="['categorical']"
        placeholder="Select Analysis Type"
        :ui="{ rounded: 'rounded-xxs' }"
        size="2xs"
      />
      <USelect
        :disabled="selectedType === 'simple'"
        v-model="selectedColumn"
        :options="columns"
        option-attribute="name"
        value-attribute="value"
        placeholder="Select Column"
        :ui="{ rounded: 'rounded-xxs' }"
        size="2xs"
      />
    </div>

    <div class="flex items-center gap-2 justify-between my-2">
      <label class="text-grey-800 text-2xs">Invert Selection</label>
      <UToggle
        v-model="isInverted"
        :ui="{ wrapper: 'w-8 h-4', circle: { on: 'w-3 h-3', off: 'w-3 h-3' } }"
      />
    </div>

    <div class="p-2 w-full">
      <UButton
        @click="handleApply"
        color="brand"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="w-full justify-center text-sm"
        :loading="isLoading"
        :disabled="isButtonDisabled"
      >
        <template v-if="isLoading"> Processing... </template>
        <template v-else> Do Select By Location </template>
      </UButton>
    </div>
  </div>
</template>
