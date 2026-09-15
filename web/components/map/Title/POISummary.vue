<script setup lang="ts">
const mapRefStore = useMapRef();

const selectedCategory = ref<string>("Sekolah");
const categoryOptions = [
  { value: "Sekolah", label: "Sekolah" },
  { value: "Ruko", label: "Ruko (Daftar Pertokoan Dalam Kawasan Komersial)" },
];

const POI_LAYER_ID = "poi_circle";

watch(selectedCategory, () => {
  const map = mapRefStore.map;
  if (!map) return;

  // Reset poi layer filter
  if (map.getLayer(POI_LAYER_ID)) {
    map.setFilter(POI_LAYER_ID, null);
  }

  // Reset zoom to Indonesia view
  map.flyTo({
    center: [117.5, -2.5],
    zoom: 5,
    duration: 1000,
  });
});

onUnmounted(() => {
  const map = mapRefStore.map;
  if (map && map.getLayer(POI_LAYER_ID)) {
    map.setFilter(POI_LAYER_ID, null);
  }
});
</script>

<template>
  <div class="bg-white">
    <div class="px-2 pt-1 pb-2">
      <USelect
        v-model="selectedCategory"
        :options="categoryOptions"
        size="sm"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>
    <MapTitleSchoolSummary v-if="selectedCategory === 'Sekolah'" />
    <MapTitleRukoSummary v-else />
  </div>
</template>
