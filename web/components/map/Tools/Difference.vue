<script setup lang="ts">
const emit = defineEmits<{
  onClose: [];
}>();
const toast = useToast();
const layerStore = useMapLayer();
const authStore = useAuth();
const queueStore = useGeoprocessingQueue();
const featureStore = useFeature();

const dropdownOpen = reactive({
  selectedLayer: false,
  overlapLayer: false,
});

const searchQuery = ref("");
const searchQueryOverlap = ref("");

const selectedLayer = ref<string>();
const overlapLayer = ref<string>();
const outputLayer = ref<string>();
const selectedLayerName = ref<string | null>(null);
const overlapLayerName = ref<string | null>(null);

const selectedLayerAlias = ref<string | null>(null);
const overlapLayerAlias = ref<string | null>(null);

const activeLayers = computed(() => {
  return layerStore.groupedActiveLayers
    ?.map(({ layerLists }) => layerLists)
    .flat()
    .filter((el) => el.source === "vector_tiles")
    .map(({ layer_alias, layer_name }: any) => ({ layer_alias, layer_name }));
});

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

const toggleDropdown = (dropdown: "selectedLayer" | "overlapLayer") => {
  dropdownOpen[dropdown] = !dropdownOpen[dropdown];
  if (!dropdownOpen[dropdown]) {
    if (dropdown === "selectedLayer") {
      searchQuery.value = "";
    } else {
      searchQueryOverlap.value = "";
    }
  }
};

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

// Click outside handler
onMounted(() => {
  document.addEventListener("click", (e: MouseEvent) => {
    const target = e.target as HTMLElement;
    if (!target.closest(".relative")) {
      dropdownOpen.selectedLayer = false;
      dropdownOpen.overlapLayer = false;
    }
  });
});

const handleDifference = async () => {
  const body = {
    input_table: [selectedLayerName.value, overlapLayerName.value],
    output_table: outputLayer.value,
  };
  try {
    const response = await fetch("/panel/geoprocessing/difference", {
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
    toast.add({
      title: "Success",
      description:
        "Your difference task has been successfully added to the queue! You'll be notified once processing is complete.",
      icon: "i-heroicons-check-circle",
    });
    featureStore.setRightSidebar("geoprocessing");
    featureStore.setMapInfo("");
    emit("onClose");
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to enqueue the difference task. Please try again.";
    toast.add({
      title: message,
      icon: "i-heroicons-x-mark",
    });
  }
};
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <!-- First Layer Selection -->
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
              color="gray"
              :ui="{ rounded: 'rounded-xxs' }"
              size="2xs"
            />
          </div>
          <ul class="max-h-48 overflow-y-auto">
            <li
              v-for="layer in filteredLayers"
              :key="layer"
              @click="selectLayer(layer, 'selectedLayer')"
              class="p-2 cursor-pointer hover:bg-grey-600"
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

    <!-- Second Layer Selection -->
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
              color="gray"
              :ui="{ rounded: 'rounded-xxs' }"
              size="2xs"
            />
          </div>
          <ul class="max-h-48 overflow-y-auto">
            <li
              v-for="layer in filteredOverlapLayers"
              :key="layer"
              @click="selectLayer(layer, 'overlapLayer')"
              class="p-2 cursor-pointer hover:bg-grey-600"
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

    <!-- Output Layer Input -->
    <div class="space-y-1">
      <p class="text-2xs text-grey-800">Output Feature Class Name</p>
      <UInput
        v-model="outputLayer"
        :ui="{ rounded: 'rounded-xxs' }"
        size="2xs"
      />
    </div>
  </div>

  <div class="p-2">
    <UButton
      @click="handleDifference"
      color="brand"
      :ui="{ rounded: 'rounded-[4px]' }"
      class="w-full justify-center text-sm"
      :loading="false"
    >
      Apply Difference
    </UButton>
  </div>
</template>
