<script setup lang="ts">
const store = useMapRef();
const { map } = storeToRefs(store);
const coordinates = ref<{ lng: string; lat: string }>({
  lng: "0.000000",
  lat: "0.000000",
});

watchEffect(async () => {
  if (map?.value) {
    map.value.on("mousemove", function (e) {
      coordinates.value = {
        lng: e.lngLat.lng.toString(),
        lat: e.lngLat.lat.toString(),
      };
    });
  }
});
</script>

<template>
  <div
    class="z-10 absolute bottom-0 left-0 bg-white/30 rounded-xxs pl-6 pr-2 py-[2px] flex gap-2 text-grey-50 text-2xs"
  >
    <div className="flex gap-2 items-center">
      <p className="whitespace-nowrap">Lat {{ coordinates.lat }}</p>
    </div>
    <div className="flex gap-2 items-center">
      <p className="whitespace-nowrap">Long {{ coordinates.lng }}</p>
    </div>
  </div>
</template>
