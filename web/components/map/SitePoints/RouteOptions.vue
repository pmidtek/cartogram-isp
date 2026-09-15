<script lang="ts" setup>
import type { RouteOption } from "~/utils/types";
import { generateWaypoints, DEFAULT_POLE_SPACING_M } from "~/utils/route";

const props = defineProps<{
  options: RouteOption[];
  selectedId: number | null;
}>();

defineEmits<{
  select: [id: number];
}>();

function formatDistance(meters: number) {
  return meters < 1000
    ? `${Math.round(meters)} m`
    : `${(meters / 1000).toFixed(2)} km`;
}

function routeCoords(option: RouteOption): [number, number][] {
  return option.geojson_route.features
    .filter(
      (f): f is GeoJSON.Feature<GeoJSON.LineString> =>
        f.geometry.type === "LineString",
    )
    .flatMap((f) => f.geometry.coordinates as [number, number][]);
}

function poleCount(option: RouteOption) {
  return generateWaypoints(routeCoords(option), DEFAULT_POLE_SPACING_M).length;
}

const shortestId = computed(() => {
  if (!props.options.length) return null;
  return props.options.reduce((shortest, o) =>
    o.distance < shortest.distance ? o : shortest,
  ).id;
});
</script>

<template>
  <div class="space-y-1.5">
    <div
      v-for="(option, index) of options"
      :key="option.id"
      role="button"
      @click="$emit('select', option.id)"
      class="p-2 border rounded-xxs cursor-pointer transition-colors space-y-1"
      :class="
        option.id === selectedId
          ? 'border-brand-500 bg-brand-50'
          : 'border-grey-700 hover:bg-grey-50'
      "
    >
      <div class="flex items-center gap-1.5 flex-wrap">
        <UBadge
          :label="`R${index + 1}`"
          size="xs"
          variant="solid"
          color="gray"
          :ui="{ rounded: 'rounded-xxs' }"
        />
        <span class="text-2xs text-grey-800 font-medium">
          {{ formatDistance(option.distance) }}
        </span>
        <UBadge
          v-if="option.id === shortestId"
          label="Recommended"
          size="xs"
          variant="solid"
          color="green"
          :ui="{ rounded: 'rounded-xxs' }"
        />
      </div>
      <div class="text-2xs text-grey-500">
        Poles:
        {{ poleCount(option) }}
      </div>
    </div>
  </div>
</template>
