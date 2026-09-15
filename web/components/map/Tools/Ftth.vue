<script lang="ts" setup>
import IcLeft from "~/assets/icons/ic-nodeleft1.svg";
import IcSettings from "~/assets/icons/ic-setting.svg";
import { ref, computed, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { Marker, MapMouseEvent } from "maplibre-gl";
import * as wellknown from "wellknown";
import type { FtthResponse } from "~/utils/types.ts";
import { LngLatBounds } from "maplibre-gl";
import IcBridge1 from "~/assets/icons/bridge1.svg";
import IcBridge2 from "~/assets/icons/bridge2.svg";
import IcBridge3 from "~/assets/icons/bridge3.svg";

const authStore = useAuth();
const layerStore = useMapLayer();
const { accessToken } = storeToRefs(authStore);
const geomShortest = ref();
const layerAliasNaming = ref<string | null | undefined>(null);

const mapStore = useMapRef();
const { map } = storeToRefs(mapStore);
const { fetchActiveLayers } = layerStore;

const toast = useToast();

const activeLayers = computed(() => {
  return layerStore.groupedActiveLayers
    ?.map(({ layerLists }) => layerLists)
    .flat()
    .filter((el) => el.source === "vector_tiles" && el.is_ftth === true)
    .map((el: LayerLists) => ({
      label: el.layer_alias || (el as VectorTiles).layer_name,
      layer_name: (el as VectorTiles).layer_name,
    }));
});

const selectedLayer = ref<{ layer_name: string; label: string } | undefined>(
  undefined,
);

// Coordinates
const coordStart = ref<[number, number] | null>(null);
const coordEnd = ref<[number, number] | null>(null);

// Enable Apply button only if settings are open, layer selected, and coords set
const disableFTTH = computed(() => {
  return (
    showSettings.value !== null &&
    selectedLayer.value?.layer_name !== null &&
    coordStart.value !== null &&
    coordEnd.value !== null &&
    layerAliasNaming !== null
  );
});

// Settings panel visibility
const showSettings = ref(false);

// Form state
const params = ref({
  fiber_attenuation_db_per_km: 0.25,
  splice_loss_db: 0.15,
  splice_every_km: 1.0,
  connector_loss_db: 0.4,
  connectors_entry: 3,
  connectors_exit: 3,
  fixed_loss_db: 0.0,
  splitter_level1_loss_db: 0.0,
  splitter_level1_count: 0,
  splitter_level2_loss_db: 0.0,
  splitter_level2_count: 0,
  splitter_level3_loss_db: 0.0,
  splitter_level3_count: 0,
  splice_boxes: 0,
});

const userId = ref<string | null>(null);

onMounted(async () => {
  try {
    interface UserData {
      data: { id: string };
    }

    // Get current user once
    const myData = await $fetch<UserData>(
      window.location.origin + "/users/me",
      {
        method: "GET",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer " + accessToken.value,
        },
      },
    );

    userId.value = myData.data?.id;
    if (!userId.value) return;

    // Fetch ftthParams for this user
    const existing: any = await $fetch(
      `/panel/items/ftthParams?filter[user][_eq]=${userId.value}`,
      {
        method: "GET",
        headers: { authorization: "Bearer " + accessToken.value },
      },
    );

    if (existing?.data?.length > 0) {
      params.value = { ...params.value, ...existing.data[0] };
    }
  } catch (err) {
    console.error("Failed to load user FTTH params", err);
  }
});

const toggleSettings = () => {
  showSettings.value = !showSettings.value;
};

// Save parameters without re-fetching /users/me
const saveParams = async () => {
  try {
    if (!userId.value) throw new Error("User ID not loaded");

    const existing: any = await $fetch(
      `/panel/items/ftthParams?filter[user][_eq]=${userId.value}`,
      {
        method: "GET",
        headers: { authorization: "Bearer " + accessToken.value },
      },
    );

    if (existing?.data?.length > 0) {
      await $fetch(`/panel/items/ftthParams/${existing.data[0].id}`, {
        method: "PATCH",
        headers: { authorization: "Bearer " + accessToken.value },
        body: params.value,
      });
    } else {
      await $fetch(`/panel/items/ftthParams`, {
        method: "POST",
        headers: { authorization: "Bearer " + accessToken.value },
        body: { ...params.value, user: userId.value },
      });
    }

    toast.add({
      title: "FTTH Parameters Updated",
      description: "Parameters saved successfully.",
      icon: "i-heroicons-information-circle",
    });
  } catch (err) {
    console.error("Failed to save parameters", err);
  } finally {
    toggleSettings();
  }
};

// FTTH result
const resultData = ref({
  distance: 0,
  loss: 0,
});

const handleFTTH = async () => {
  try {
    if (!coordStart.value || !coordEnd.value) {
      toast.add({
        title: "Error",
        description: "Please select both start and end points",
        color: "red",
      });
      return;
    }

    const reqParams: Record<string, string> = {
      startpoint: coordStart.value
        ? `${coordStart.value[0]},${coordStart.value[1]}`
        : "",
      endpoint: coordEnd.value
        ? `${coordEnd.value[0]},${coordEnd.value[1]}`
        : "",
      tablename: selectedLayer.value?.layer_name ?? "",
      ...Object.fromEntries(
        Object.entries(params.value).map(([k, v]) => [k, String(v)]), // force values to string
      ),
    };

    // ✅ loop through the fixed 3 slots, but only add if not null
    coordBridges.value.forEach((bridge, i) => {
      if (bridge) {
        reqParams[`bridge${i + 1}`] = `${bridge[0]},${bridge[1]}`;
      }
    });

    // remove empty/undefined keys
    const queryString = new URLSearchParams(
      Object.fromEntries(
        Object.entries(reqParams).filter(
          ([_, v]) => v !== "" && v !== undefined,
        ),
      ),
    )
      .toString()
      .replace(/%2C/g, ",");

    const ftthResult = await $fetch<FtthResponse>(
      `https://footprint.geodashboard.io/api/testftth/?${queryString}`,
    );

    if (!ftthResult?.summary) return;

    // console.log("fetch result : ", JSON.stringify(ftthResult))

    const { total_distance, total_loss_db, shortest_path } = ftthResult.summary;

    // distance: "28.699 km" → 28.699
    const distanceNum = parseFloat(total_distance);

    resultData.value = {
      distance: distanceNum,
      loss: total_loss_db,
    };

    geomShortest.value = shortest_path;

    // parse WKT into GeoJSON
    const geojson = wellknown.parse(shortest_path);

    if (map.value && geojson) {
      // 🗑️ remove old source + layer before adding a new one
      if (map.value.getLayer("ftth-line")) {
        map.value.removeLayer("ftth-line");
      }
      if (map.value.getSource("ftth-line")) {
        map.value.removeSource("ftth-line");
      }

      // ➕ add new source
      map.value.addSource("ftth-line", {
        type: "geojson",
        data: {
          type: "Feature",
          geometry: geojson,
          properties: {},
        },
      });

      // ➕ add new line layer
      map.value.addLayer({
        id: "ftth-line",
        type: "line",
        source: "ftth-line",
        paint: {
          "line-color": "#FF6600",
          "line-width": 3,
        },
      });

      // 🔍 auto-zoom to fit new line
      let coords: number[][] = [];

      if (geojson.type === "LineString" && Array.isArray(geojson.coordinates)) {
        coords = geojson.coordinates;
      } else if (geojson.type === "MultiLineString") {
        coords = geojson.coordinates.flat();
      } else if (
        geojson.type === "GeometryCollection" &&
        Array.isArray((geojson as any).geometries)
      ) {
        (geojson as any).geometries.forEach((g: any) => {
          if (g.coordinates) {
            coords.push(...g.coordinates.flat());
          }
        });
      }

      if (coords.length > 0) {
        map.value.fitBounds(
          [
            [
              Math.min(...coords.map((c) => c[0])),
              Math.min(...coords.map((c) => c[1])),
            ],
            [
              Math.max(...coords.map((c) => c[0])),
              Math.max(...coords.map((c) => c[1])),
            ],
          ],
          { padding: 40 },
        );
      }
    }
  } catch (error) {
    console.error("FTTH analysis error:", error);
  }
};

const flyToSelectedLayer = async () => {
  if (!map.value || !selectedLayer.value) return;

  const targetLayerName = selectedLayer.value.layer_name;

  try {
    // 🔹 Fetch bounds from your backend with $fetch
    const res: any = await $fetch(
      `/panel/items/vector_tiles?filter[layer_name][_eq]=${targetLayerName}`,
    );

    const layerInfo = res?.data?.[0];
    if (!layerInfo || !layerInfo.bounds) {
      console.warn("No bounds found for layer:", targetLayerName);
      return;
    }

    // 🔹 Build bounds from API response
    const bounds = new LngLatBounds();
    const coordinates = layerInfo.bounds.coordinates[0]; // polygon ring
    coordinates.forEach((coord: [number, number]) => bounds.extend(coord));

    if (!bounds.isEmpty()) {
      map.value.fitBounds(bounds, { padding: 40, duration: 800 });
    } else {
      console.warn("Bounds were empty for layer:", targetLayerName);
    }
  } catch (err) {
    console.error("Error fetching bounds for layer:", targetLayerName, err);
  }
};

watchEffect(() => {
  flyToSelectedLayer();
});

const startMarker = ref<Marker | null>(null);
const endMarker = ref<Marker | null>(null);

// 🟢 bridge markers
const bridgeMarkers = ref<(Marker | null)[]>([null, null, null]);

let pickingStart = ref(false);
let pickingEnd = ref(false);
let pickingBridge = ref<number | null>(null);

const coordBridges = ref<([number, number] | null)[]>([null, null, null]);

map.value?.on("click", (e: MapMouseEvent) => {
  // Start marker
  if (pickingStart.value) {
    coordStart.value = [e.lngLat.lng, e.lngLat.lat];

    if (!startMarker.value) {
      startMarker.value = new Marker({ color: "green" })
        .setLngLat(coordStart.value)
        .addTo(map.value!);
    } else {
      startMarker.value.setLngLat(coordStart.value);
    }

    pickingStart.value = false;
  }

  // End marker
  if (pickingEnd.value) {
    coordEnd.value = [e.lngLat.lng, e.lngLat.lat];

    if (!endMarker.value) {
      endMarker.value = new Marker({ color: "red" })
        .setLngLat(coordEnd.value)
        .addTo(map.value!);
    } else {
      endMarker.value.setLngLat(coordEnd.value);
    }

    pickingEnd.value = false;
  }

  // Bridge markers
  if (pickingBridge.value !== null) {
    const index = pickingBridge.value;
    coordBridges.value[index] = [e.lngLat.lng, e.lngLat.lat];

    if (!bridgeMarkers.value[index]) {
      // create marker if not exists
      bridgeMarkers.value[index] = new Marker({
        color: index === 0 ? "blue" : index === 1 ? "orange" : "purple",
        pitchAlignment: "map",
        rotationAlignment: "map",
      })
        .setLngLat(coordBridges.value[index]!)
        .addTo(map.value!);
    } else {
      // update existing marker
      bridgeMarkers.value[index]!.setLngLat(coordBridges.value[index]!);
    }

    pickingBridge.value = null;
  }
});

// Functions
const startNode = () => {
  pickingStart.value = true;
  pickingEnd.value = false;
  pickingBridge.value = null;
};

const endNode = () => {
  pickingEnd.value = true;
  pickingStart.value = false;
  pickingBridge.value = null;
};

const addBridge = (index: number) => {
  pickingBridge.value = index;
  pickingStart.value = false;
  pickingEnd.value = false;
};

const handleClear = () => {
  if (map.value) {
    // remove FTTH line
    if (map.value.getLayer("ftth-line")) {
      map.value.removeLayer("ftth-line");
    }
    if (map.value.getSource("ftth-line")) {
      map.value.removeSource("ftth-line");
    }

    // remove start marker
    if (startMarker.value) {
      startMarker.value.remove();
      startMarker.value = null;
    }

    // remove end marker
    if (endMarker.value) {
      endMarker.value.remove();
      endMarker.value = null;
    }

    // remove bridge markers
    bridgeMarkers.value.forEach((marker, idx) => {
      marker?.remove();
      bridgeMarkers.value[idx] = null;
    });
    coordBridges.value = [null, null, null];

    coordStart.value = null;
    coordEnd.value = null;
    layerAliasNaming.value = null;

    // reset results
    resultData.value = {
      distance: 0,
      loss: 0,
    };
  }
};

const handleAddLayer = async () => {
  console.log("fetch add layer");

  try {
    const result = await $fetch("/panel/addlayer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + authStore.accessToken,
      },
      body: {
        layerName: selectedLayer.value?.layer_name,
        layerAlias: layerAliasNaming.value,
        distance: resultData.value?.distance,
        loss: resultData.value?.loss,
        geom: geomShortest.value,
      },
    });

    result;
    fetchActiveLayers();

    // ✅ success toasts
    toast.add({
      title: "FTTH added into layer management",
      description: "Parameters saved successfully.",
      icon: "i-heroicons-information-circle",
    });

    // console.log("Response:", result);
  } catch (error) {
    // ❌ error toast
    toast.add({
      title: "Error adding FTTH layer",
      description: (error as Error).message,
      color: "red",
      icon: "i-heroicons-exclamation-triangle",
    });

    console.error("Error adding layer:", error);
  }
};
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <!-- Select Layer -->
    <div class="space-y-1">
      <p class="text-2xs text-grey-800">Select Feature Layer</p>

      <USelectMenu
        searchable
        searchable-placeholder="Search Layer"
        v-model="selectedLayer"
        :options="activeLayers"
        :search-attributes="['layer_name', 'label']"
        option-attribute="label"
        placeholder="Select layer"
        :ui="{ rounded: 'rounded-xxs' }"
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

    <div class="p-2 space-y-1">
      <p class="text-grey-800 text-[8px] leading-none">Layer Name</p>
      <UInput
        v-model="layerAliasNaming"
        type="text"
        class="w-full"
        :ui="{ rounded: 'rounded-[4px]' }"
        :disabled="selectedLayer?.layer_name === null"
      />
    </div>

    <!-- Buttons -->
    <div class="p-2 flex flex-col gap-y-2">
      <div class="flex flex-row justify-between gap-x-2">
        <UButton
          @click="startNode"
          :color="pickingStart ? 'brand' : 'white'"
          :ui="{ rounded: 'rounded-[4px]' }"
          class="outline outline-1 outline-brand-600 justify-center text-sm w-[48%]"
        >
          <IcLeft
            class="w-6 h-6 rotate-180 text-grey-800 bg-green-600 rounded-lg"
          />
          <p>Start Point</p>
        </UButton>
        <UButton
          @click="endNode"
          :color="pickingEnd ? 'brand' : 'white'"
          :ui="{ rounded: 'rounded-[4px]' }"
          class="outline outline-1 outline-brand-600 justify-center text-sm w-[48%]"
        >
          <IcLeft class="w-6 h-6 text-grey-800 bg-red-600 rounded-lg" />
          <p>End Point</p>
        </UButton>
      </div>
      <UButton
        @click="toggleSettings"
        color="white"
        :ui="{ rounded: 'rounded-[4px]' }"
        class="outline outline-1 outline-brand-600 justify-center text-sm w-full"
      >
        <IcSettings class="w-6 h-6" />
        <p>Settings</p>
      </UButton>
    </div>

    <!-- Bridges -->
    <div class="px-2 flex flex-row gap-x-2">
      <UButton
        variant="ghost"
        :ui="{ rounded: 'rounded-[4px]' }"
        @click="addBridge(0)"
        class="w-[31.5%] justify-center text-sm ring ring-1 ring-brand-600 flex items-center gap-2"
      >
        <IcBridge1 class="w-6 h-6 text-grey-800 bg-blue-600 rounded-lg" />
        <span>B1</span>
      </UButton>

      <UButton
        variant="ghost"
        :ui="{ rounded: 'rounded-[4px]' }"
        @click="addBridge(1)"
        class="w-[31.5%] justify-center text-sm ring ring-1 ring-brand-600 flex items-center gap-2"
      >
        <IcBridge2 class="w-6 h-6 text-grey-800 bg-yellow-500 rounded-lg" />
        <span>B2</span>
      </UButton>

      <UButton
        variant="ghost"
        :ui="{ rounded: 'rounded-[4px]' }"
        @click="addBridge(2)"
        class="w-[31.5%] justify-center text-sm ring ring-1 ring-brand-600 flex items-center gap-2"
      >
        <IcBridge3 class="w-6 h-6 text-grey-800 bg-purple-600 rounded-lg" />
        <span>B3</span>
      </UButton>
    </div>

    <div class="px-2 gap-x-2 flex">
      <UButton
        variant="ghost"
        :ui="{ rounded: 'rounded-[4px]' }"
        @click="handleClear"
        class="w-[48.5%] justify-center text-sm ring ring-1 ring-brand-600"
      >
        Clear
      </UButton>
      <UButton
        variant="ghost"
        :ui="{ rounded: 'rounded-[4px]' }"
        @click="handleAddLayer"
        class="w-[48.5%] justify-center text-sm ring ring-1 ring-brand-600"
      >
        Add to layer
      </UButton>
    </div>

    <!-- Settings Form -->
    <div
      v-if="showSettings"
      class="p-2 grid grid-cols-2 gap-3 bg-transparent rounded h-[200px] overflow-y-auto"
    >
      <div
        v-for="(value, key) in params"
        :key="key"
        class="flex flex-col gap-1"
      >
        <p class="text-grey-800 text-[8px] leading-none">
          {{ key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) }}
        </p>
        <UInput
          v-model="params[key]"
          type="number"
          step="0.01"
          :ui="{ rounded: 'rounded-[4px]' }"
        />
      </div>

      <div class="col-span-2">
        <UButton
          color="brand"
          :ui="{ rounded: 'rounded-[4px]' }"
          class="w-full justify-center text-sm"
          @click="saveParams"
        >
          Save Parameters
        </UButton>
      </div>
    </div>

    <!-- FTTH result -->
    <div class="p-2 grid grid-cols-2 gap-3 bg-transparent rounded">
      <h1 class="col-span-2 text-grey-800 text-sm">FTTH result</h1>
      <div
        v-for="(value, key) in resultData"
        :key="key"
        class="flex flex-col gap-1"
      >
        <p class="text-grey-800 text-[8px] leading-none">
          {{ key.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) }}
          {{ key === "loss" ? "(db)" : "(km)" }}
        </p>
        <UInput
          v-model="resultData[key]"
          type="number"
          step="0.01"
          :ui="{ rounded: 'rounded-[4px]' }"
          :disabled="true"
        />
      </div>
    </div>

    <!-- Apply -->
    <div class="p-2">
      <UButton
        @click="handleFTTH"
        color="brand"
        :ui="{ rounded: 'rounded-[4px]' }"
        :disabled="!disableFTTH"
        class="w-full justify-center text-sm"
      >
        Analyze ftth
      </UButton>
    </div>
  </div>
</template>
