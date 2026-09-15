<script setup lang="ts">
import { computed, watch, watchEffect, onBeforeUnmount } from "vue";
import { useMapRef } from "~/stores/useMapRef";
import { useMapModule } from "~/stores/useMapModule";
import { useAuth } from "~/stores/useAuth";
import { storeToRefs } from "pinia";

const mapRefStore = useMapRef();
const { map } = storeToRefs(mapRefStore);
const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);
const authStore = useAuth();

const isFtthMapping = computed(() => {
  return currentModule.value?.slug === "ftth-mapping";
});

const SOURCE_ID = "sp_data_footprint_source";
const LAYER_ID = "sp_data_footprint_fill";

const isStyleLoaded = () => {
  try {
    return map.value?.isStyleLoaded() ?? false;
  } catch {
    return false;
  }
};

const addFootprintLayer = () => {
  if (!map.value || !isStyleLoaded()) return;

  if (!map.value.getSource(SOURCE_ID)) {
    const mvtUrl =
      window.location.origin +
      `/panel/mvt/ftth/sp_data_footprint` +
      "?z={z}&x={x}&y={y}" +
      (authStore.accessToken ? "&access_token=" + authStore.accessToken : "");

    map.value.addSource(SOURCE_ID, {
      type: "vector",
      tiles: [mvtUrl],
      minzoom: 18,
      maxzoom: 20,
    });
  }

  if (!map.value.getLayer(LAYER_ID)) {
    // Find the lowest project layer to insert footprint below it
    // so all project GeoJSON layers render above the footprint
    const mapLayers = map.value.getStyle()?.layers || [];
    const firstProjectLayer = mapLayers.find((l: any) =>
      l.id.startsWith("project-"),
    );

    map.value.addLayer(
      {
        id: LAYER_ID,
        type: "fill",
        source: SOURCE_ID,
        "source-layer": "sp_data_footprint",
        minzoom: 19,
        maxzoom: 21,
        layout: {
          visibility: "visible",
        },
        paint: {
          "fill-color": "#7C3AED",
          "fill-opacity": 0.3,
          "fill-outline-color": "#5B21B6",
        },
      } as any,
      firstProjectLayer?.id,
    );
  }
};

const removeFootprintLayer = () => {
  if (!map.value || !isStyleLoaded()) return;

  if (map.value.getLayer(LAYER_ID)) {
    map.value.removeLayer(LAYER_ID);
  }
  if (map.value.getSource(SOURCE_ID)) {
    map.value.removeSource(SOURCE_ID);
  }
};

// Wait for map style to load, then add layer
watchEffect((onInvalidate) => {
  if (!map.value || !isFtthMapping.value) return;

  if (isStyleLoaded()) {
    addFootprintLayer();
    return;
  }

  const onLoad = () => addFootprintLayer();
  map.value.on("load", onLoad);

  onInvalidate(() => {
    if (map.value) {
      map.value.off("load", onLoad);
    }
  });
});

// Watch module changes - remove when leaving ftth-mapping
watch(isFtthMapping, (isFtth, wasFtth) => {
  if (!isFtth && wasFtth) {
    removeFootprintLayer();
  }
});

// Re-add layers when map style changes (e.g., basemap change)
watchEffect((onInvalidate) => {
  if (!map.value) return;

  const handleStyleData = (e: any) => {
    if (e.dataType === "style") {
      if (isFtthMapping.value) {
        setTimeout(() => {
          addFootprintLayer();
        }, 600);
      }
    }
  };

  map.value.on("styledata", handleStyleData);

  onInvalidate(() => {
    if (map.value) {
      map.value.off("styledata", handleStyleData);
    }
  });
});

// Cleanup on unmount
onBeforeUnmount(() => {
  removeFootprintLayer();
});
</script>

<template>
  <!-- Headless component -->
</template>
