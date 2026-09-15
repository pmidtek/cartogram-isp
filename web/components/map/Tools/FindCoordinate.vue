<script lang="ts" setup>
import type { GeoJSONSource } from "maplibre-gl";

const mapStore = useMapRef();
const { map } = mapStore;
const toast = useToast();

const longitudeRef = ref("");
const latitudeRef = ref("");

const findCoordinate = () => {
  const latRegex = /^-?([1-8]?\d(?:\.\d{1,})?|90(?:\.0{1,6})?)$/;
  const longRegex = /^-?((1[0-7]|[1-9])?\d(?:\.\d{1,})?|180(?:\.0{1,6})?)$/;
  const isLatitudeValid = latRegex.test(latitudeRef.value);
  const isLongitudeValid = longRegex.test(longitudeRef.value);

  if (isLatitudeValid && isLongitudeValid) {
    map?.flyTo({
      center: [parseFloat(longitudeRef.value), parseFloat(latitudeRef.value)],
      zoom: 6,
    });
    if (!map?.getSource("find-coordinate-point")) {
      map?.addImage(
        "pulsing-point",
        createPulsingDot({
          map: map!,
          size: 90,
          strokeStyle: getBrandColor("500"),
          fillStyle: getBrandColor("500"),
        }),
        {
          pixelRatio: 2,
        }
      );
      map?.addSource("find-coordinate-point", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              geometry: {
                type: "Point",
                coordinates: [
                  parseFloat(longitudeRef.value),
                  parseFloat(latitudeRef.value),
                ],
              },
            },
          ],
        },
      });
      map?.addLayer({
        type: "symbol",
        source: "find-coordinate-point",
        id: "find-coordinate-point-pulsing",
        layout: {
          "icon-image": "pulsing-point",
        },
      });
    } else {
      (map?.getSource("find-coordinate-point") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: {
              type: "Point",
              coordinates: [
                parseFloat(longitudeRef.value),
                parseFloat(latitudeRef.value),
              ],
            },
          },
        ],
      });
    }
  } else {
    toast.add({
      title: "Invalid Input Coordinate",
      description: "Please provide correct input coordinate",
      icon: "i-heroicons-information-circle",
      timeout: 1500,
    });
  }
};

onUnmounted(() => {
  if (map?.getSource("find-coordinate-point")) {
    map?.removeImage("pulsing-point");
    map.removeLayer("find-coordinate-point-pulsing");
    map.removeSource("find-coordinate-point");
  }
});
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <p class="text-2xs text-grey-400">
      <span class="font-bold"
        >Input coordinates (Decimal Degrees/DD Format)</span
      >
      into the field below to find the place.
    </p>
    <div class="grid grid-cols-2 gap-1">
      <UInput
        v-model="longitudeRef"
        color="gray"
        :ui="{ rounded: 'rounded-xxs' }"
        placeholder="Longitude"
        size="2xs"
      >
      </UInput>
      <UInput
        v-model="latitudeRef"
        color="gray"
        :ui="{ rounded: 'rounded-xxs' }"
        placeholder="Latitude"
        size="2xs"
      >
      </UInput>
    </div>
  </div>
  <div class="p-2">
    <UButton
      :disabled="!longitudeRef || !latitudeRef"
      @click="findCoordinate"
      color="grey"
      variant="outline"
      :ui="{ rounded: 'rounded-[4px]' }"
      class="w-full justify-center text-sm"
      >Search</UButton
    >
  </div>
</template>
