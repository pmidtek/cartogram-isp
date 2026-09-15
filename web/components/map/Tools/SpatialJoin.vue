<script lang="ts" setup>
const emit = defineEmits<{
  onClose: [];
}>();
const toast = useToast();
const layerStore = useMapLayer();
const authStore = useAuth();
const { accessToken } = storeToRefs(authStore);
const queueStore = useGeoprocessingQueue();
const featureStore = useFeature();
const activeLayers = computed(() => {
  return layerStore.groupedActiveLayers
    ?.map(({ layerLists }) => layerLists)
    .flat()
    .filter((el) => el.source === "vector_tiles")
    .map((el: LayerLists) => {
      return {
        label: el.layer_alias || (el as VectorTiles).layer_name,
        layer_name: (el as VectorTiles).layer_name,
      };
    });
});
const selectedLayer = ref<{ layer_name: string; label: string }>();
const spatialJoinLayer = ref<{ layer_name: string; label: string }>();
const outputLayer = ref<string>();

const disableSpatialJoin = computed(() => {
  return !(selectedLayer.value && spatialJoinLayer.value && outputLayer.value);
});

const handleSpatialJoin = async () => {
  const body = {
    target_table: selectedLayer.value?.layer_name,
    join_table: spatialJoinLayer.value?.layer_name,
    output_table: outputLayer.value,
  };

  if (accessToken.value) {
    try {
      const response = await fetch("/panel/geoprocessing/spatial-join", {
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
          : "Failed to enqueue the spatial join task. Please try again.";
      toast.add({
        title: "spatial join error",
        icon: "i-heroicons-x-mark",
        description: message,
      });
    }
  } else {
    toast.add({
      title: "Forbidden access",
      icon: "i-heroicons-x-mark",
      description: "You need to login to run the spatial join analysis",
    });
  }
};
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <div class="space-y-1">
      <p class="text-2xs text-gray-800">Spatial Join from</p>
      <USelectMenu
        searchable
        searchable-placeholder="Search Layer"
        v-model="selectedLayer"
        :options="activeLayers"
        :search-attributes="['layer_name', 'label']"
        option-attribute="label"
        placeholder="Select layer"
        :ui="{
          rounded: 'rounded-xxs',
        }"
        :uiMenu="{
          base: 'space-y-1',
          rounded: 'rounded-xxs',
          background: 'bg-white',
          ring: 'ring-1 ring-grey-600',
          option: {
            base: 'cursor-pointer text-grey-700 hover:text-grey-700',
            padding: 'px-1.5 py-1',
            selected: 'bg-grey-200 text-grey-700',
            color: 'text-grey-200',
            rounded: 'rounded-xxs',
            active: 'bg-grey-200 text-grey-700',
            size: 'text-xs',
          },
          input: 'bg-white text-grey-200 text-xs',
        }"
        size="2xs"
      />
    </div>
    <div class="space-y-1">
      <p class="text-2xs text-gray-800">
        Spatial Join with: {{ JSON.stringify(disableSpatialJoin) }}
      </p>
      <USelectMenu
        searchable
        searchable-placeholder="Search Layer"
        v-model="spatialJoinLayer"
        :options="activeLayers"
        :search-attributes="['layer_name', 'label']"
        option-attribute="label"
        placeholder="Select layer"
        :ui="{
          rounded: 'rounded-xxs',
        }"
        :uiMenu="{
          base: 'space-y-1',
          rounded: 'rounded-xxs',
          background: 'bg-white',
          ring: 'ring-1 ring-grey-600',
          option: {
            base: 'cursor-pointer text-grey-700 hover:text-grey-700',
            padding: 'px-1.5 py-1',
            selected: 'bg-grey-200 text-grey-700',
            color: 'text-grey-200',
            rounded: 'rounded-xxs',
            active: 'bg-grey-200 text-grey-700',
            size: 'text-xs',
          },
          input: 'bg-white text-grey-200 text-xs',
        }"
        size="2xs"
      />
    </div>
    <div class="space-y-1">
      <p class="text-2xs text-gray-800">Output Layer Name</p>
      <UInput v-model="outputLayer" :ui="{ rounded: 'rounded-xxs' }" size="2xs">
      </UInput>
    </div>
  </div>
  <div class="p-2">
    <UButton
      @click="handleSpatialJoin"
      color="brand"
      :ui="{ rounded: 'rounded-[4px]' }"
      :disabled="disableSpatialJoin"
      class="w-full justify-center text-sm"
      :loading="false"
      >Apply Spatial Join
    </UButton>
  </div>
</template>
