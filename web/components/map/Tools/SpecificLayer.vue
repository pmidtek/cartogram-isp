<script lang="ts" setup>
import { useDrawControl } from "~/utils/useDrawControl";
import area from "@turf/area";
import { convertArea } from "@turf/helpers";
import { watch, computed, ref } from "vue";
import IcSpinner from "~/assets/icons/ic-spinner.svg";
import { useDigitizeStore } from "~/stores/useDigitizeResult";
import { useMapRef } from "#imports";

interface DataResult {
  class_ts: string | null;
  count: string;
}

interface CombinedData {
  [key: string]: DataResult[];
}

interface LayerOption {
  label: string;
  value: string;
}

const combinedData: CombinedData = {};

const areaCount = ref<number>(0);
const areaUnit = ref<string>("m");
const colour = ref("#F36B1D");

const featureStore = useFeature();

const optionsDataDetail = [
  "Energy",
  "Carport",
  "Footprint Grade",
  "House Price",
  "Road Type",
  "House Class",
];
const digitizeStore = useDigitizeStore();
const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();

const isDropdownOpen = ref(false);

const toggleDropdown = () => {
  isDropdownOpen.value = !isDropdownOpen.value;
  if (!isDropdownOpen.value) {
    searchQuery.value = "";
  }
};

const getSelectedLayerLabel = computed(() => {
  if (!selectedLayerName.value) return "Select Layer";
  return (
    activeLayers.value?.find((layer) => layer.value === selectedLayerName.value)
      ?.label || "Select Layer"
  );
});

const selectLayer = (layer: LayerOption) => {
  selectedLayerName.value = layer.value;
  selectedLayer.value = layer.label;
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

const selectedLayer = ref<string>();
const selectedLayers = ref<string[]>([]);
const selectedLayerName = ref<string>();
const selectedLayerCoordinates = ref<any[]>([]);
const isFetching = ref<boolean>(false);
const layerStore = useMapLayer();

const activeLayers = computed(() => {
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

// Search functionality
const searchQuery = ref("");
const filteredLayers = computed(() => {
  if (!searchQuery.value) return activeLayers.value;

  const query = searchQuery.value.toLowerCase();
  return activeLayers.value?.filter((layer) =>
    layer.label.toLowerCase().includes(query),
  );
});

const toggleLayer = (layer: string) => {
  if (selectedLayers.value.includes(layer)) {
    selectedLayers.value = selectedLayers.value.filter((l) => l !== layer);
  } else {
    selectedLayers.value.push(layer);
  }
};

const handleReset = () => {
  areaCount.value = 0;
  selectedLayers.value = [];
  searchQuery.value = "";
  selectedLayer.value = undefined;
  selectedLayerName.value = undefined;
};

const handleApply = async () => {
  if (selectedLayers.value.length === 0 || !selectedLayer.value) return;

  let hasError = false;

  try {
    isFetching.value = true;
    const token = authStore.accessToken;

    for (const layer of selectedLayers.value) {
      const formattedLayer = layer.toLowerCase().replace(/ /g, "_");
      const url = `/panel/chart/count/layer/${formattedLayer}`;

      const body = {
        layer: selectedLayerName.value,
      };

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        hasError = true;
        toast.add({
          title: "Error",
          description: `Error for layer: ${layer}, "You don't have permission to access this."`,
          icon: "i-heroicons-exclamation-circle",
        });
        continue;
      }

      const dataResult: DataResult[] = await response.json();
      combinedData[layer] = dataResult;
    }

    // FETCH GEOM
    const geomResponse = await fetchGeom(selectedLayerName.value);
    if (geomResponse.length) {
      console.log("GEOM RESPONSE", geomResponse);
      geomResponse.forEach((geom) => {
        selectedLayerCoordinates.value.push(geom);
      });
    }

    if (!hasError) {
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
        name: "Specific Layer",
        area: selectedLayer.value,
        coordinates: selectedLayerCoordinates.value.map(
          (polygon) => polygon.geom.coordinates,
        ),
        data: combinedData,
        layer: selectedLayerName.value,
      });

      featureStore.setMapInfo("analytic");

      // Reset the state
      selectedLayers.value = [];
      areaCount.value = 0;
      searchQuery.value = "";
    }
  } catch (error) {
    console.error("Error:", error);
    hasError = true;
  } finally {
    isFetching.value = false;
  }
};

const fetchGeom = async (layer: string) => {
  try {
    const url = `/panel/items/${layer}?fields=geom`;
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    const dataResult: any = await response.json();
    if (dataResult.data.length) {
      return dataResult.data;
    }
  } catch (error) {
    throw new Error("Error at fetching geom");
  }
};

const isApplyDisabled = computed(() => {
  return selectedLayers.value.length === 0 || isFetching.value;
});
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <h3 class="text-grey-800 text-2xs">Apply Analysis From</h3>

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

    <div class="flex items-center">
      <h3 class="text-grey-800 text-2xs w-1/2">Apply analysis to</h3>
      <div class="h-[1px] w-full bg-grey-700" />
    </div>

    <div class="flex flex-wrap gap-2">
      <UButton
        v-for="layer in optionsDataDetail"
        :key="layer"
        size="xs"
        :class="{
          'bg-brand-400 bg-opacity-30 border-brand-600 border text-brand-500 font-medium':
            selectedLayers.includes(layer),
          'bg-white border border-grey-500 text-brand-500':
            !selectedLayers.includes(layer),
        }"
        class="rounded-xxs cursor-pointer text-[10px] hover:bg-brand-100"
        @click="toggleLayer(layer)"
      >
        {{ layer }}
      </UButton>
    </div>
  </div>

  <div class="p-2 flex gap-2 justify-between">
    <UButton
      @click="handleReset"
      color="grey"
      :ui="{ rounded: 'rounded-[4px]' }"
      class="w-[49%] justify-center text-sm"
    >
      Reset
    </UButton>
    <UButton
      :disabled="isApplyDisabled"
      @click="handleApply"
      color="primary"
      :ui="{ rounded: 'rounded-[4px]' }"
      class="w-[49%] justify-center text-sm"
    >
      <template v-if="isFetching">
        <IcSpinner class="h-4 w-4 animate-spin" />
      </template>
      <template v-else> Apply </template>
    </UButton>
  </div>
</template>
