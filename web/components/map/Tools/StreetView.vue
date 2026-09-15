<script lang="ts" setup>
import type { MapLayerTouchEvent } from "maplibre-gl";
import maplibregl from "maplibre-gl";

const mapStore = useMapRef();
const { map } = mapStore;

const currentMarker = ref<maplibregl.Marker | null>(null);
const streetViewCoord = ref<{ lat: number; lng: number } | null>(null);

// Function to remove marker
const removeMarker = () => {
  if (currentMarker.value) {
    currentMarker.value.remove();
    currentMarker.value = null;
  }
};

const createMarker = (coordinates: [number, number]) => {
  removeMarker();

  const marker = new maplibregl.Marker({
    color: "#FF8C00",
  })
    .setLngLat(coordinates)
    .addTo(mapStore.map!);

  currentMarker.value = marker;
  streetViewCoord.value = { lat: coordinates[1], lng: coordinates[0] };
};

const getLocation = (event: MapLayerTouchEvent) => {
  const coordinates = event.lngLat.toArray();
  createMarker(coordinates);
  console.log(coordinates);
};

onMounted(() => {
  if (map) {
    map.on("click", getLocation);
    map.getCanvasContainer().style.cursor = "crosshair";
  }
});

onUnmounted(() => {
  if (map) {
    map.off("click", getLocation);
    map.getCanvasContainer().style.cursor = "";
  }
  if (currentMarker.value) {
    currentMarker.value.remove();
    currentMarker.value = null;
    streetViewCoord.value = null;
  }
});
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <p class="text-2xs text-grey-400">
      To use Street View, simply click on any point on the map with the pointer
      this will open a 360° view of the selected area
    </p>
  </div>
  <teleport to="body">
    <div
      v-if="streetViewCoord"
      class="fixed bottom-24 right-6 w-[27rem] h-[17rem]"
    >
      <MapStreetView :coordinate="streetViewCoord" />
    </div>
  </teleport>
</template>
