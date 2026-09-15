<script lang="ts" setup>
import { useDrawControl } from "~/utils/useDrawControl";
import area from "@turf/area";
import { convertArea } from "@turf/helpers";
import { computed, ref } from "vue";
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

const areaCount = ref<number>(0);
const areaUnit = ref<string>("m");
const colour = ref("#F36B1D");
const featureStore = useFeature();
const analysisStore = useAnalysisResult();

const optionsDataDetail = [
  "Energy",
  "Carport",
  "House Price",
  "Road Type",
  "House Class",
];
const digitizeStore = useDigitizeStore();
const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();

const selectedLayers = ref<string[]>([]);
const createdPolygons = ref<any[]>([]);
const isFetching = ref<boolean>(false);

const { drawer } = useDrawControl({
  mode: "draw_polygon",
  onCreated: (feature) => {
    createdPolygons.value.push(feature);

    const lastPolygon = createdPolygons.value[createdPolygons.value.length - 1];
    areaCount.value =
      areaUnit.value === "m"
        ? parseFloat(area(lastPolygon).toFixed(2))
        : parseFloat(
            convertArea(area(lastPolygon), "meters", "kilometers").toFixed(2),
          );
  },
});

const startNewPolygon = () => {
  drawer?.changeMode("draw_polygon");
  toast.add({
    title: "Drawing Mode",
    description: `You can now draw Polygon ${createdPolygons.value.length + 1}`,
    icon: "i-heroicons-pencil",
  });
};

const toggleLayer = (layer: string) => {
  if (selectedLayers.value.includes(layer)) {
    selectedLayers.value = selectedLayers.value.filter((l) => l !== layer);
  } else {
    selectedLayers.value.push(layer);
  }
};

const handleReset = () => {
  areaCount.value = 0;
  drawer?.deleteAll();
  drawer?.changeMode("draw_polygon");
  createdPolygons.value = [];
  selectedLayers.value = [];
};

const handleApply = async () => {
  if (createdPolygons.value.length === 0 || selectedLayers.value.length === 0) {
    return;
  }

  const combinedData: CombinedData = {};
  let hasError = false;

  try {
    isFetching.value = true;
    const token = authStore.accessToken;

    const geometryCollection = {
      area: {
        type: "GeometryCollection",
        geometries: createdPolygons.value.map((polygon) => ({
          type: "Polygon",
          coordinates: polygon.geometry.coordinates,
        })),
      },
    };

    for (const layer of selectedLayers.value) {
      const formattedLayer = layer.toLowerCase().replace(/ /g, "_");
      const url = `/panel/chart/count/digitize/${formattedLayer}`;

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(geometryCollection),
      });

      if (!response.ok) {
        hasError = true;
        toast.add({
          title: "Error",
          description: `Wrong Area or Cities not Set Yet for layer: ${layer}`,
          icon: "i-heroicons-exclamation-circle",
        });
        continue;
      }

      const dataResult: DataResult[] = await response.json();
      combinedData[layer] = dataResult;
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
        name: `Digitize Combined`,
        layer: selectedLayers.value.join(", "),
        area: parseFloat(
          createdPolygons.value
            .reduce((total, polygon) => total + area(polygon), 0)
            .toFixed(2),
        ),
        coordinates: createdPolygons.value.map(
          (polygon) => polygon.geometry.coordinates,
        ),
        data: combinedData,
      });

      analysisStore.setCurrentAnalysisType("digitize_analysis");
      featureStore.setMapInfo("analytic");

      selectedLayers.value = [];
      createdPolygons.value = [];
      areaCount.value = 0;
    }
  } catch (error) {
    console.error("Error:", error);
    hasError = true;
  } finally {
    isFetching.value = false;
  }
};

const isApplyDisabled = computed(() => {
  return (
    createdPolygons.value.length === 0 ||
    selectedLayers.value.length === 0 ||
    isFetching.value
  );
});
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <h3 class="text-grey-800 text-2xs -mb-2">Isochrone to</h3>
    <p class="text-2xs text-grey-400">
      Click on Map and select Layers to perform Isochrone Analysis
    </p>

    <div class="flex gap-2 items-center">
      <UInput
        v-model="areaCount"
        readonly
        :ui="{ rounded: 'rounded-xxs' }"
        placeholder="Select On Map"
        class="w-full"
        size="xs"
      >
        <template #trailing>
          <span class="text-2xs text-gray-400"
            >Polygons: {{ createdPolygons.length }}</span
          >
        </template>
      </UInput>
    </div>

    <UButton
      class="my-2 flex items-center justify-center text-xs"
      @click="startNewPolygon"
      :ui="{ rounded: 'rounded-[4px]' }"
      :disabled="createdPolygons.length === 0"
    >
      Draw New Polygon
    </UButton>

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
      :disabled="createdPolygons.length === 0"
      @click="handleReset"
      color="grey"
      :ui="{ rounded: 'rounded-[4px]' }"
      class="w-[49%] justify-center text-sm"
      >Reset</UButton
    >
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
