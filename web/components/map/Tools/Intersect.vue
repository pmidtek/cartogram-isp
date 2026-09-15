<template>
  <div class="p-2 flex flex-col gap-2">
    <!-- Layer Selection with Search Inside -->
    <div class="space-y-1">
      <p class="text-2xs text-grey-800">Create new features from</p>
      <div class="relative">
        <div
          @click="toggleDropdown('selectedLayer')"
          class="cursor-pointer px-2 py-1 rounded-xxs text-grey-800 text-2xs bg-white border border-grey-600"
        >
          {{ selectedLayerAlias || "Select Layer" }}
        </div>
        <div
          v-if="dropdownOpen.selectedLayer"
          class="absolute z-10 mt-1 rounded-xxs text-grey-800 text-2xs bg-white border border-grey-600 w-full"
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
              :key="layer.layer_alias"
              @click="selectLayer(layer, 'selectedLayer')"
              class="p-2 cursor-pointer"
            >
              {{ layer.layer_alias }}
            </li>
            <li v-if="filteredLayers.length === 0" class="p-2 text-gray-500">
              No results found
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Overlap Layer Selection with Search Inside -->
    <div class="space-y-1">
      <p class="text-2xs text-grey-800">Overlaps with</p>
      <div class="relative">
        <div
          @click="toggleDropdown('overlapLayer')"
          class="cursor-pointer px-2 py-1 rounded-xxs text-grey-800 text-2xs bg-white border border-grey-600"
        >
          {{ overlapLayerAlias || "Select Layer" }}
        </div>
        <div
          v-if="dropdownOpen.overlapLayer"
          class="absolute z-10 mt-1 rounded-xxs text-grey-800 text-2xs bg-white border border-grey-600 w-full"
        >
          <div class="p-2">
            <UInput
              v-model="searchQueryOverlap"
              placeholder="Search layers"
              :ui="{ rounded: 'rounded-xxs' }"
              size="2xs"
            />
          </div>
          <ul class="max-h-48 overflow-y-auto">
            <li
              v-for="layer in filteredOverlapLayers"
              :key="layer.layer_alias"
              @click="selectLayer(layer, 'overlapLayer')"
              class="p-2 cursor-pointer"
            >
              {{ layer.layer_alias }}
            </li>
            <li
              v-if="filteredOverlapLayers.length === 0"
              class="p-2 text-gray-500"
            >
              No results found
            </li>
          </ul>
        </div>
      </div>
    </div>

    <!-- Output Feature Class Name -->
    <div class="space-y-1">
      <p class="text-2xs text-grey-800">Output Feature Class Name</p>
      <UInput
        v-model="outputLayer"
        :ui="{ rounded: 'rounded-xxs' }"
        size="2xs"
      />
    </div>

    <!-- Apply Intersect Button -->
    <div class="p-2">
      <UButton
        @click="handleIntersect"
        color="brand"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="w-full justify-center text-sm"
        :loading="false"
      >
        Apply Intersect
      </UButton>
    </div>
  </div>
</template>

<script lang="ts" setup>
const emit = defineEmits<{
  onClose: [];
}>();
const toast = useToast();
const layerStore = useMapLayer();
const authStore = useAuth();
const queueStore = useGeoprocessingQueue();
const featureStore = useFeature();

const selectedLayer = ref<string | null>(null);
const overlapLayer = ref<string | null>(null);
const outputLayer = ref<string | null>(null);

const selectedLayerAlias = ref<string | null>(null);
const overlapLayerAlias = ref<string | null>(null);

// Additional state for storing selected layer names
const selectedLayerName = ref<string | null>(null);
const overlapLayerName = ref<string | null>(null);

// Search queries for both dropdowns
const searchQuery = ref("");
const searchQueryOverlap = ref("");

// Dropdown state for both layer selections
const dropdownOpen = reactive({
  selectedLayer: false,
  overlapLayer: false,
});

// Get active layers from the store
// Get active layers with both alias and name from the store
const activeLayers = computed(() => {
  return layerStore.groupedActiveLayers
    ?.map(({ layerLists }) => layerLists)
    .flat()
    .filter((el) => el.source === "vector_tiles")
    .map(({ layer_alias, layer_name }: any) => ({ layer_alias, layer_name }));
});

// Filtered layers based on search query remain the same
const filteredLayers = computed(() => {
  return activeLayers.value.filter(({ layer_alias }) =>
    layer_alias.toLowerCase().includes(searchQuery.value.toLowerCase()),
  );
});

const filteredOverlapLayers = computed(() => {
  return activeLayers.value.filter(({ layer_alias }) =>
    layer_alias.toLowerCase().includes(searchQueryOverlap.value.toLowerCase()),
  );
});

// Function to toggle dropdown visibility
const toggleDropdown = (dropdown: "selectedLayer" | "overlapLayer") => {
  dropdownOpen[dropdown] = !dropdownOpen[dropdown];
  if (dropdown === "selectedLayer") searchQuery.value = ""; // Clear search when opening
  if (dropdown === "overlapLayer") searchQueryOverlap.value = ""; // Clear search when opening
};

// Function to select a layer and close the corresponding dropdown
const selectLayer = (
  layer: { layer_alias: string; layer_name: string },
  dropdown: "selectedLayer" | "overlapLayer",
) => {
  if (dropdown === "selectedLayer") {
    selectedLayerAlias.value = layer.layer_alias;
    selectedLayerName.value = layer.layer_name;
  } else {
    overlapLayerAlias.value = layer.layer_alias;
    overlapLayerName.value = layer.layer_name;
  }
  dropdownOpen[dropdown] = false;
};

// Handle Intersect
const handleIntersect = async () => {
  const body = {
    input_table: [selectedLayerName.value, overlapLayerName.value],
    output_table: outputLayer.value,
  };
  try {
    const response = await fetch("/panel/geoprocessing/intersect", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify(body),
    });
    const result = await response.json();

    if (result.errors?.length) throw new Error(result.errors[0].message);
    setTimeout(() => {
      queueStore.checkQueueState(result.message_id);
    }, 1000);
    featureStore.setRightSidebar("geoprocessing");
    featureStore.setMapInfo("");
    emit("onClose");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to enqueue the intersect task. Please try again.";
    toast.add({
      title: message,
      icon: "i-heroicons-x-mark",
    });
  }
};
</script>
