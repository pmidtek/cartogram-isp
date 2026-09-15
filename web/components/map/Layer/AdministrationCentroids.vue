<script setup lang="ts">
import { ref, computed, watch, watchEffect, onBeforeUnmount } from "vue";
import { useQuery } from "@tanstack/vue-query";
import { useMapRef } from "~/stores/useMapRef";
import { useMapLayer } from "~/stores/useMapLayer";
import { useMapModule } from "~/stores/useMapModule";
import { useAuth } from "~/stores/useAuth";
import { storeToRefs } from "pinia";
import maplibregl from "maplibre-gl";

const mapRefStore = useMapRef();
const { map } = storeToRefs(mapRefStore);
const mapLayerStore = useMapLayer();
const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);
const authStore = useAuth();

// Module detection - only show in FWA modules
const isFWAModule = computed(() => {
  return (
    currentModule.value?.slug === "potential-analysis" ||
    currentModule.value?.slug === "fwa-access"
  );
});

// Fetch province centroids
const { data: provinceCentroids } = useQuery({
  queryKey: ["geojson", "area_provinces", "centroid"],
  queryFn: async () => {
    return await $fetch("/panel/geojson/area_province?options=centroid", {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
  },
  enabled: isFWAModule,
});

// Fetch city centroids
const { data: cityCentroids } = useQuery({
  queryKey: ["geojson", "area_cities", "centroid"],
  queryFn: async () => {
    return await $fetch("/panel/geojson/area_cities?options=centroid", {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
  },
  enabled: isFWAModule,
});

// Layer IDs
const PROVINCE_SOURCE_ID = "area_provinces_centroid_source";
const PROVINCE_LAYER_ID = "area_provinces_centroid_label";
const CITY_SOURCE_ID = "area_cities_centroid_source";
const CITY_LAYER_ID = "area_cities_centroid_label";

// Add centroid layers to map
const addCentroidLayers = () => {
  if (!map.value) return;

  // Add province centroids
  if (provinceCentroids.value) {
    if (!map.value.getSource(PROVINCE_SOURCE_ID)) {
      map.value.addSource(PROVINCE_SOURCE_ID, {
        type: "geojson",
        data: provinceCentroids.value as any,
      });
    }

    if (!map.value.getLayer(PROVINCE_LAYER_ID)) {
      // Add text label on top of background
      map.value.addLayer({
        id: PROVINCE_LAYER_ID,
        type: "symbol",
        source: PROVINCE_SOURCE_ID,
        minzoom: 5,
        maxzoom: 10,
        layout: {
          "text-field": [
            "concat",
            ["to-string", ["get", "tower_count"]],
            " Towers",
          ],
          "text-size": 14,
          "text-allow-overlap": false,
          visibility: "none", // Start hidden, sync with boundaries
        },
        paint: {
          "text-color": "#000000",
          "text-opacity": 1,
          "text-halo-color": "#FFFFFF",
          "text-halo-width": 10,
          "text-halo-blur": 2,
        },
      } as any);
    }
  }

  // Add city centroids
  if (cityCentroids.value) {
    if (!map.value.getSource(CITY_SOURCE_ID)) {
      map.value.addSource(CITY_SOURCE_ID, {
        type: "geojson",
        data: cityCentroids.value as any,
      });
    }

    if (!map.value.getLayer(CITY_LAYER_ID)) {
      // Add text label on top of background
      map.value.addLayer({
        id: CITY_LAYER_ID,
        type: "symbol",
        source: CITY_SOURCE_ID,
        minzoom: 8,
        maxzoom: 13,
        layout: {
          "text-field": [
            "concat",
            ["to-string", ["get", "tower_count"]],
            " Towers",
          ],
          "text-size": 14,
          "text-allow-overlap": false,
          visibility: "none", // Start hidden, sync with boundaries
        },
        paint: {
          "text-color": "#000000",
          "text-opacity": 1,
          "text-halo-color": "#FFFFFF",
          "text-halo-width": 10,
          "text-halo-blur": 2,
        },
      } as any);
    }
  }
};

// Sync visibility with administration boundary layers
const syncVisibilityWithBoundaries = () => {
  if (!map.value) return;

  const adminGroup = mapLayerStore.groupedActiveLayers?.find(
    (g) => g.label === "Administration",
  );
  if (!adminGroup) return;

  // Sync province centroids with province boundaries
  const provinceLayer = adminGroup.layerLists.find(
    (l) => l.layer_id === "area_provinces_line",
  );
  if (provinceLayer) {
    const visibility = provinceLayer.layer_style.layout_visibility || "visible";
    if (map.value.getLayer(`${PROVINCE_LAYER_ID}_bg`)) {
      map.value.setLayoutProperty(
        `${PROVINCE_LAYER_ID}_bg`,
        "visibility",
        visibility,
      );
    }
    if (map.value.getLayer(PROVINCE_LAYER_ID)) {
      map.value.setLayoutProperty(PROVINCE_LAYER_ID, "visibility", visibility);
    }
  }

  // Sync city centroids with city boundaries
  const cityLayer = adminGroup.layerLists.find(
    (l) => l.layer_id === "area_cities_line",
  );
  if (cityLayer) {
    const visibility = cityLayer.layer_style.layout_visibility || "visible";
    if (map.value.getLayer(`${CITY_LAYER_ID}_bg`)) {
      map.value.setLayoutProperty(
        `${CITY_LAYER_ID}_bg`,
        "visibility",
        visibility,
      );
    }
    if (map.value.getLayer(CITY_LAYER_ID)) {
      map.value.setLayoutProperty(CITY_LAYER_ID, "visibility", visibility);
    }
  }
};

// Watch for data and add layers
watch(
  [provinceCentroids, cityCentroids, map],
  () => {
    if (map.value && isFWAModule.value) {
      addCentroidLayers();
      syncVisibilityWithBoundaries();
    }
  },
  { immediate: true },
);

// Re-add layers when map style changes (e.g., basemap change)
watchEffect((onInvalidate) => {
  if (!map.value) return;

  const handleStyleData = (e: any) => {
    // Only re-add layers after the style is fully loaded (not on every style update)
    if (e.dataType === "style") {
      if (isFWAModule.value) {
        // Re-add centroid layers after style loads
        setTimeout(() => {
          addCentroidLayers();
          syncVisibilityWithBoundaries();
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

// Watch for boundary visibility changes
watch(
  () => mapLayerStore.groupedActiveLayers,
  () => syncVisibilityWithBoundaries(),
  { deep: true },
);

// Setup click handlers for popups
watchEffect((onInvalidate) => {
  if (!map.value) return;

  const handleClick = (e: any) => {
    const feature = e.features?.[0];
    if (!feature) return;

    const { area, tower_count, tower_count_detail } = feature.properties;

    // Parse tower_count_detail (may be JSON string)
    let detailHTML = "";
    try {
      const detail =
        typeof tower_count_detail === "string"
          ? JSON.parse(tower_count_detail)
          : tower_count_detail;

      if (detail && typeof detail === "object") {
        detailHTML = Object.entries(detail)
          .map(([owner, count]) => `<strong>${owner}:</strong> ${count}`)
          .join("<br>");
      } else {
        detailHTML = "N/A";
      }
    } catch {
      detailHTML = "N/A";
    }

    new maplibregl.Popup()
      .setLngLat(e.lngLat)
      .setHTML(
        `
        <div style="padding: 8px;">
          <h3 style="font-weight: bold; margin-bottom: 8px;">${area || "Unknown"}</h3>
          <p><strong>Total Towers:</strong> ${tower_count || 0}</p>
          <div style="margin-top: 8px;">
            <p style="font-weight: 600;">By Owner:</p>
            ${detailHTML}
          </div>
        </div>
      `,
      )
      .addTo(map.value);
  };

  // Add click listeners
  if (map.value.getLayer(PROVINCE_LAYER_ID)) {
    map.value.on("click", PROVINCE_LAYER_ID, handleClick);
  }
  if (map.value.getLayer(CITY_LAYER_ID)) {
    map.value.on("click", CITY_LAYER_ID, handleClick);
  }

  // Cursor pointer on hover
  const onMouseEnter = () => {
    if (map.value) map.value.getCanvas().style.cursor = "pointer";
  };
  const onMouseLeave = () => {
    if (map.value) map.value.getCanvas().style.cursor = "";
  };

  if (map.value.getLayer(PROVINCE_LAYER_ID)) {
    map.value.on("mouseenter", PROVINCE_LAYER_ID, onMouseEnter);
    map.value.on("mouseleave", PROVINCE_LAYER_ID, onMouseLeave);
  }
  if (map.value.getLayer(CITY_LAYER_ID)) {
    map.value.on("mouseenter", CITY_LAYER_ID, onMouseEnter);
    map.value.on("mouseleave", CITY_LAYER_ID, onMouseLeave);
  }

  onInvalidate(() => {
    if (!map.value) return;
    if (map.value.getLayer(PROVINCE_LAYER_ID)) {
      map.value.off("click", PROVINCE_LAYER_ID, handleClick);
      map.value.off("mouseenter", PROVINCE_LAYER_ID, onMouseEnter);
      map.value.off("mouseleave", PROVINCE_LAYER_ID, onMouseLeave);
    }
    if (map.value.getLayer(CITY_LAYER_ID)) {
      map.value.off("click", CITY_LAYER_ID, handleClick);
      map.value.off("mouseenter", CITY_LAYER_ID, onMouseEnter);
      map.value.off("mouseleave", CITY_LAYER_ID, onMouseLeave);
    }
  });
});

// Remove layers
const removeCentroidLayers = () => {
  if (!map.value) return;

  const layerIds = [
    PROVINCE_LAYER_ID,
    `${PROVINCE_LAYER_ID}_bg`,
    CITY_LAYER_ID,
    `${CITY_LAYER_ID}_bg`,
  ];
  const sourceIds = [PROVINCE_SOURCE_ID, CITY_SOURCE_ID];

  layerIds.forEach((id) => {
    if (map.value!.getLayer(id)) {
      map.value!.removeLayer(id);
    }
  });

  sourceIds.forEach((id) => {
    if (map.value!.getSource(id)) {
      map.value!.removeSource(id);
    }
  });
};

// Watch for module changes - add/remove layers
watch(isFWAModule, (isFWA) => {
  if (!map.value) return;

  if (isFWA) {
    addCentroidLayers();
    syncVisibilityWithBoundaries();
  } else {
    removeCentroidLayers();
  }
});

// Cleanup on unmount
onBeforeUnmount(() => {
  removeCentroidLayers();
});
</script>

<template>
  <!-- Headless component -->
</template>
