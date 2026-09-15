<script setup lang="ts">
import maplibregl from "maplibre-gl";
import { orsApiKey } from "~/constants";
import type { LngLatBoundsLike, MapMouseEvent } from "maplibre-gl";
import IcTrash from "~/assets/icons/ic-trash.svg";
import IcCircle from "~/assets/icons/ic-circle.svg";
import IcMarker from "~/assets/icons/ic-marker-stroked.svg";
import { useDirection } from "~/stores/useDirection";

const props = defineProps<{
  item: { id: string; feature: GeoJSON.Feature | null; label?: string };
  endPoint: boolean;
}>();

const directionStore = useDirection();
const { updateLocations, deleteLocationsById } = directionStore;
const { focusedInputId, markerRef } = storeToRefs(directionStore);
const mapStore = useMapRef();
const { map } = mapStore;

const loading = ref(false);
const selected = ref<any>(props.item);
const focused = ref(false);

// async function reverseGeocode(lon: number, lat: number) {
//   const res = await fetch(
//     // boundary.country=ID&sources=openstreetmap&boundary.circle.radius=1&size=1&layers=vanue,address,street&
//     "https://api.openrouteservice.org/geocode/reverse?boundary.country=ID&sources=openstreetmap&boundary.circle.radius=0.1&size=1&point.lon=" +
//       lon +
//       "&point.lat=" +
//       lat +
//       "&api_key=" +
//       orsApiKey
//   );
//   const result = await res.json();
//   if (result.features && result.features.length > 0) {
//     const label =
//       result.features[0]?.properties?.name +
//       (result.features[0]?.properties?.region
//         ? ", " + result.features[0]?.properties?.region
//         : "");
//     selected.value = {
//       id: props.item.id,
//       feature: result.features[0],
//       label: label,
//     };
//     updateLocations(props.item.id, result.features[0], label);
//   }
// }

async function search(q: string) {
  if (!q) return [];
  loading.value = true;
  const res = await fetch(
    "https://api.openrouteservice.org/geocode/autocomplete?boundary.country=ID&sources=openstreetmap&text=" +
      q +
      "&api_key=" +
      orsApiKey,
  );
  const result = await res.json();
  let options = [];
  if (result.features) {
    for (const feature of result.features) {
      options.push({
        id: feature.properties.id,
        feature: feature,
        label:
          feature?.properties?.name +
          (feature?.properties?.region
            ? ", " + feature?.properties?.region
            : ""),
      });
    }
  }
  loading.value = false;

  return options;
}

watchEffect(() => {
  selected.value = props.item;
});

const handleFocused = () => {
  focused.value = true;
  focusedInputId.value = props.item.id;
};

const blurWithDelayed = () => {
  setTimeout(() => {
    focused.value = false;
  }, 100);
};

const handleClickOnMap = (e: MapMouseEvent) => {
  if (markerRef.value) {
    markerRef.value.setLngLat([e.lngLat.lng, e.lngLat.lat]);
  } else {
    markerRef.value = markRaw(
      new maplibregl.Marker()
        .setLngLat([e.lngLat.lng, e.lngLat.lat])
        .addTo(map!),
    );
  }

  const label = `${e.lngLat.lng}, ${e.lngLat.lat}`;
  selected.value = {
    id: props.item.id,
    feature: { geometry: { coordinates: [e.lngLat.lng, e.lngLat.lat] } },
    label: label,
  };
  updateLocations(
    props.item.id,
    {
      type: "Feature",
      geometry: { coordinates: [e.lngLat.lng, e.lngLat.lat] },
    } as GeoJSON.Feature,
    label,
  );
  // reverseGeocode(e.lngLat.lng, e.lngLat.lat);

  focusedInputId.value = null;
};

watchEffect((onInvalidate) => {
  if (map && focusedInputId.value === props.item.id) {
    map.on("click", handleClickOnMap);
  }
  onInvalidate(() => {
    if (map && focusedInputId.value !== props.item.id) {
      map.off("click", handleClickOnMap);
    }
  });
});
</script>

<template>
  <div class="flex items-center gap-2">
    <div>
      <IcCircle
        v-if="!endPoint"
        :class="['text-grey-50 w-3 h-2']"
        :fontControlled="false"
      />
      <IcMarker
        v-else
        :class="['text-brand-500 w-3 h-3']"
        :fontControlled="false"
      />
    </div>
    <div class="flex-1 flex gap-2">
      <UInputMenu
        v-model="selected"
        @focus="handleFocused"
        @blur="blurWithDelayed"
        @change="
          (el: any) => {
            updateLocations(item.id, el.feature, el.label);
            mapStore.map?.fitBounds(el.feature.bbox as LngLatBoundsLike, {
              maxZoom: 17,
              padding: 100,
            });
          }
        "
        :search="search"
        :loading="loading"
        placeholder="Search location or click on map"
        option-attribute="label"
        trailing
        by="id"
        :debounce="500"
        :popper="{ placement: 'top-end' }"
        class="w-full"
        inputClass=""
        :ui="{
          rounded: 'rounded-xxs',
          base: 'bg-red-500',
        }"
        :uiMenu="{
          rounded: 'rounded-xxs',
          background: 'bg-grey-700',
          ring: 'ring-1 ring-grey-600',
          option: {
            base: 'cursor-pointer hover:text-grey-700',
            selected: 'bg-grey-200 text-grey-700',
            color: 'text-grey-200',
            rounded: 'rounded-xxs',
            active: 'bg-grey-200 text-grey-700',
          },
        }"
        size="xs"
      />
      <button
        v-if="focused"
        @click="
          () => {
            deleteLocationsById(item.id);
            selected = {};
          }
        "
      >
        <IcTrash :class="['text-brand-500 w-3 h-3']" :fontControlled="false" />
      </button>
    </div>
  </div>
</template>
