<script lang="ts" setup>
import { computed } from "vue";
import { useQuery } from "@tanstack/vue-query";

const props = defineProps<{
  antennaDirectionId: number | string | null | undefined;
}>();

const authStore = useAuth();
const mapRefStore = useMapRef();

const getItemCenter = (item: any): [number, number] | null => {
  if (!item?.geom) return null;
  const geom = typeof item.geom === "string" ? JSON.parse(item.geom) : item.geom;
  if (!geom?.coordinates) return null;
  return [geom.coordinates[0], geom.coordinates[1]];
};

const flyToTower = (item: any) => {
  const map = mapRefStore.map;
  const center = getItemCenter(item);
  if (!map || !center) return;
  map.flyTo({ center, zoom: 16, duration: 1200 });
};

const { data: items, isLoading } = useQuery({
  queryKey: ["antenna_direction_item_list", computed(() => props.antennaDirectionId)],
  enabled: computed(() => !!props.antennaDirectionId),
  queryFn: async () => {
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/antenna_direction_item?filter[antenna_direction_id][_eq]=${props.antennaDirectionId}&fields=*&limit=-1`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return response.data;
  },
});

// Build the list of non-empty sectors for a tower item
const sectorsOf = (item: any) => {
  return [1, 2, 3]
    .map((n) => ({
      no: n,
      azimuth: item[`s${n}_azimuth`],
      beam_width: item[`s${n}_beam_width`],
      footprint_count: item[`s${n}_footprint_count`],
    }))
    .filter((s) => s.azimuth !== null && s.azimuth !== undefined);
};
</script>

<template>
  <!-- Loading State -->
  <div v-if="isLoading" class="flex flex-col items-center justify-center py-8">
    <div
      class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"
    ></div>
    <p class="text-xs text-grey-500 mt-2">Loading towers...</p>
  </div>

  <!-- Empty State -->
  <div
    v-else-if="!items || items.length === 0"
    class="flex flex-col items-center justify-center py-8"
  >
    <UIcon
      name="i-heroicons-signal-slash"
      class="w-12 h-12 text-grey-300 mb-2"
    />
    <p class="text-xs text-grey-600 font-medium">No towers found</p>
  </div>

  <!-- Tower List -->
  <div v-else class="space-y-2">
    <div
      v-for="item in items"
      :key="item.id"
      @click="flyToTower(item)"
      class="bg-white border border-grey-200 rounded-xxs p-3 cursor-pointer hover:border-brand-400 hover:shadow-sm transition-all"
    >
      <div class="flex items-center gap-2 mb-2">
        <UIcon name="i-heroicons-signal" class="w-4 h-4 text-brand-500" />
        <h3 class="text-xs font-semibold text-grey-900 truncate">
          {{ item.tower_name || `Tower ${item.tower_id}` }}
        </h3>
        <span
          v-if="item.tower_owner"
          class="text-2xs text-grey-600 bg-grey-100 rounded-xxs px-1.5 py-0.5"
        >
          {{ item.tower_owner }}
        </span>
      </div>

      <div v-if="sectorsOf(item).length" class="space-y-1">
        <div
          v-for="sector in sectorsOf(item)"
          :key="sector.no"
          class="flex items-center justify-between text-2xs text-grey-700"
        >
          <span class="font-medium">Sector {{ sector.no }}</span>
          <span class="flex items-center gap-2 text-grey-600">
            <span>Az {{ sector.azimuth }}&deg;</span>
            <span>BW {{ sector.beam_width }}&deg;</span>
            <span>{{ sector.footprint_count }} fp</span>
          </span>
        </div>
      </div>
      <p v-else class="text-2xs text-grey-500">No sectors</p>
    </div>
  </div>
</template>
