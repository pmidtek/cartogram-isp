<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import bbox from "@turf/bbox";

type ConnectedSite = {
  id: number;
  name: string | null;
  code: string | null;
};

type Connection = {
  route_id: number;
  route_name: string | null;
  route_code: string | null;
  route_type: string | null;
  from: ConnectedSite | null;
  to: ConnectedSite | null;
  direction: "outgoing" | "incoming";
};

const featureStore = useFeature();
const authStore = useAuth();
const mapRefStore = useMapRef();
const { feature, mapInfo } = storeToRefs(featureStore);

const connections = ref<Connection[]>([]);
const geojson = ref<GeoJSON.FeatureCollection | null>(null);
const isLoading = ref(false);
const errorMessage = ref<string | null>(null);

const HIGHLIGHT_SOURCE_ID = "site-connection-highlight-source";
const HIGHLIGHT_LAYER_ID = "site-connection-highlight-layer";
const HIGHLIGHT_CASING_LAYER_ID = "site-connection-highlight-casing-layer";

const isOpen = computed(
  () => mapInfo.value === "site-connection" && !!feature.value,
);

const sitePointId = computed(() => feature.value?.rowId ?? null);

const outgoing = computed(() =>
  connections.value.filter((c) => c.direction === "outgoing"),
);
const incoming = computed(() =>
  connections.value.filter((c) => c.direction === "incoming"),
);

const removeHighlight = () => {
  const map = mapRefStore.map;
  if (!map) return;
  if (map.getLayer(HIGHLIGHT_LAYER_ID)) map.removeLayer(HIGHLIGHT_LAYER_ID);
  if (map.getLayer(HIGHLIGHT_CASING_LAYER_ID))
    map.removeLayer(HIGHLIGHT_CASING_LAYER_ID);
  if (map.getSource(HIGHLIGHT_SOURCE_ID)) map.removeSource(HIGHLIGHT_SOURCE_ID);
};

const renderHighlight = (fc: GeoJSON.FeatureCollection | null) => {
  const map = mapRefStore.map;
  if (!map) return;
  removeHighlight();
  if (!fc || !fc.features?.length) return;

  map.addSource(HIGHLIGHT_SOURCE_ID, { type: "geojson", data: fc });
  map.addLayer({
    id: HIGHLIGHT_CASING_LAYER_ID,
    type: "line",
    source: HIGHLIGHT_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": 8,
      "line-opacity": 0.9,
    },
  });
  map.addLayer({
    id: HIGHLIGHT_LAYER_ID,
    type: "line",
    source: HIGHLIGHT_SOURCE_ID,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": [
        "match",
        ["get", "direction"],
        "outgoing",
        "#6366f1",
        "incoming",
        "#ffe14d",
        "#6366f1",
      ],
      "line-width": 4,
    },
  });

  try {
    const [minX, minY, maxX, maxY] = bbox(fc);
    if (
      Number.isFinite(minX) &&
      Number.isFinite(minY) &&
      Number.isFinite(maxX) &&
      Number.isFinite(maxY)
    ) {
      map.fitBounds(
        [
          [minX, minY],
          [maxX, maxY],
        ],
        { padding: 80, duration: 600, maxZoom: 16 },
      );
    }
  } catch (e) {
    // ignore bbox errors for empty/invalid geometries
  }
};

const fetchConnections = async (id: string | number) => {
  isLoading.value = true;
  errorMessage.value = null;
  try {
    const res = await $fetch<{
      data: Connection[];
      geojson: GeoJSON.FeatureCollection;
    }>("/panel/data/site-point-connections", {
      query: { site_point_id: id },
      headers: { Authorization: "Bearer " + authStore.accessToken },
    });
    connections.value = res?.data ?? [];
    geojson.value = res?.geojson ?? null;
    renderHighlight(geojson.value);
  } catch (err: any) {
    errorMessage.value =
      err?.data?.errors?.[0]?.message ||
      err?.message ||
      "Failed to load connections";
    connections.value = [];
    geojson.value = null;
    removeHighlight();
  } finally {
    isLoading.value = false;
  }
};

watch(
  [isOpen, sitePointId],
  ([open, id]) => {
    if (open && id != null) {
      fetchConnections(id);
    } else {
      connections.value = [];
      geojson.value = null;
      errorMessage.value = null;
      removeHighlight();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  removeHighlight();
});

const closePanel = () => {
  featureStore.setMapInfo("");
};
</script>

<template>
  <div
    v-if="isOpen"
    class="fixed top-[5.5rem] right-24 z-40 w-[22rem] bg-white rounded-xs shadow-lg font-['Raleway']"
  >
    <header
      class="flex items-center justify-between px-4 py-3 border-b border-grey-200"
    >
      <div>
        <h3 class="text-sm font-semibold text-grey-900">Site Connections</h3>
      </div>
      <UButton
        variant="ghost"
        color="gray"
        size="xs"
        :ui="{ rounded: 'rounded-xxs' }"
        icon="i-heroicons-x-mark-20-solid"
        aria-label="Close"
        @click="closePanel"
      />
    </header>

    <div class="max-h-[60vh] overflow-y-auto px-4 py-3 text-xs text-grey-700">
      <div v-if="isLoading" class="py-6 text-center text-grey-500">
        Loading connections...
      </div>

      <div v-else-if="errorMessage" class="py-4 text-red-500">
        {{ errorMessage }}
      </div>

      <div
        v-else-if="connections.length === 0"
        class="py-6 text-center text-grey-500"
      >
        No connections found for this site point.
      </div>

      <template v-else>
        <section v-if="outgoing.length > 0" class="mb-4">
          <h4
            class="text-xs font-semibold text-grey-900 uppercase tracking-wide mb-2"
          >
            Outgoing ({{ outgoing.length }})
          </h4>
          <ul class="space-y-2">
            <li
              v-for="c in outgoing"
              :key="`out-${c.route_id}`"
              class="bg-grey-50 rounded-xxs px-3 py-2"
            >
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-semibold text-grey-900 truncate">
                  {{ c.to?.name || "—" }}
                </span>
                <span v-if="c.to?.code" class="text-grey-500 text-[10px]">
                  {{ c.to.code }}
                </span>
              </div>
              <div class="text-grey-500 text-[11px] mt-0.5">
                via
                <span class="text-grey-700">{{ c.route_name || "route" }}</span>
                <span v-if="c.route_type"> &middot; {{ c.route_type }}</span>
              </div>
            </li>
          </ul>
        </section>

        <section v-if="incoming.length > 0">
          <h4
            class="text-xs font-semibold text-grey-900 uppercase tracking-wide mb-2"
          >
            Incoming ({{ incoming.length }})
          </h4>
          <ul class="space-y-2">
            <li
              v-for="c in incoming"
              :key="`in-${c.route_id}`"
              class="bg-grey-50 rounded-xxs px-3 py-2"
            >
              <div class="flex items-baseline justify-between gap-2">
                <span class="font-semibold text-grey-900 truncate">
                  {{ c.from?.name || "—" }}
                </span>
                <span v-if="c.from?.code" class="text-grey-500 text-[10px]">
                  {{ c.from.code }}
                </span>
              </div>
              <div class="text-grey-500 text-[11px] mt-0.5">
                via
                <span class="text-grey-700">{{ c.route_name || "route" }}</span>
                <span v-if="c.route_type"> &middot; {{ c.route_type }}</span>
              </div>
            </li>
          </ul>
        </section>
      </template>
    </div>
  </div>
</template>
