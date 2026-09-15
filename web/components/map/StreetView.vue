<script setup lang="ts">
const props = defineProps<{
  coordinate: { lat: number; lng: number };
}>();

const streetViewRef = ref<HTMLElement | null>(null);
let panorama: google.maps.StreetViewPanorama | null = null;

const { load } = useGoogleMaps();

onMounted(async () => {
  console.log("onmounted");
  const google = await load();

  if (streetViewRef.value) {
    // Initialize panorama
    panorama = new google.maps.StreetViewPanorama(streetViewRef.value, {
      position: props.coordinate,
      pov: { heading: 34, pitch: 10 },
      zoom: 1,
    });
  }
});

watch(
  () => props.coordinate,
  (newCoord) => {
    console.log("newCoord", newCoord);
    if (panorama) {
      panorama.setPosition(newCoord);
    }
  },
  { deep: true }
);
</script>

<template>
  <div ref="streetViewRef" class="w-full h-full rounded-xs shadow" />
</template>
