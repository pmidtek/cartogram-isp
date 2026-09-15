<script setup lang="ts">
import { Map, GeolocateControl } from "maplibre-gl";
import type { LngLatBoundsLike, StyleSpecification } from "maplibre-gl";
import type { Raw } from "vue";
import { towerIconSvg2 } from "~/constants";
import { useGeneralSettings } from "~/utils";
import IcSpinner from "~/assets/icons/ic-spinner.svg";
import {
  shallowRef,
  onMounted,
  onUnmounted,
  markRaw,
  ref,
  onBeforeUnmount,
} from "vue";
import { useMapData, useSharedMap } from "~/utils";
import bbox from "@turf/bbox";

const { isLoading, data: mapData } = await useMapData();
const { data } = await useGeneralSettings();

const sharedMap = await useSharedMap();
const toast = useToast();

const mapContainer = shallowRef<null | HTMLElement>(null);
const map = shallowRef<null | Raw<Map>>(null);
const geolocate = shallowRef<null | Raw<GeolocateControl>>(null);
const store = useMapRef();
const { setMapLoad, setMapRef, setGeolocateRef } = store;

// Coordinate popup state
const showCoordinatePopup = ref(false);
const popupCoordinates = ref({ lng: 0, lat: 0 });
const popupPosition = ref({ x: 0, y: 0 });
const popupRef = ref<HTMLDivElement | null>(null);
const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);

// Function to handle right-click and show coordinates
const handleRightClick = (e: MouseEvent) => {
  if (!map.value) return;

  // Prevent default right-click menu
  e.preventDefault();

  // Get coordinates from the click event
  const lngLat = map.value.unproject([e.offsetX, e.offsetY]);

  popupCoordinates.value = {
    lng: lngLat.lng,
    lat: lngLat.lat,
  };

  // Position the popup near the click
  popupPosition.value = {
    x: e.clientX,
    y: e.clientY,
  };

  showCoordinatePopup.value = true;
};

// Function to handle clicks outside the popup
const handleClickOutside = (e: MouseEvent) => {
  // Check if the popup is shown and the click is outside the popup
  if (
    showCoordinatePopup.value &&
    popupRef.value &&
    !popupRef.value.contains(e.target as Node)
  ) {
    showCoordinatePopup.value = false;
  }
};

// Function to copy coordinates to clipboard
const copyCoordinates = () => {
  const { lng, lat } = popupCoordinates.value;
  const coordinateText = `${lat.toFixed(8)}, ${lng.toFixed(8)}`;

  navigator.clipboard
    .writeText(coordinateText)
    .then(() => {
      toast.add({
        description: `Coordinate has been copied to your clipboard`,
        icon: "i-heroicons-check-circle",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });
    })
    .catch((err) => {
      console.error("Failed to copy coordinates: ", err);
    });
};

//map init
onMounted(async () => {
  setMapLoad(false);

  // Use different basemap for backhaul module
  const basemapUrl =
    currentModule.value?.slug === "backhaul" ||
    currentModule.value?.slug === "ftth-mapping"
      ? "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
      : "https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";

  const style: StyleSpecification = {
    version: 8,
    sprite: window.location.origin + "/panel/sprites/sprite",
    sources: {
      "basemap-sources": {
        type: "raster",
        tiles: [basemapUrl],
        tileSize: 256,
      },
    },
    // glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    glyphs: "/font/{fontstack}/{range}.pbf",
    layers: [
      {
        id: "basemap-tiles",
        type: "raster",
        source: "basemap-sources",
        minzoom: 0,
        maxzoom: 24,
      },
    ],
  };

  map.value = markRaw(
    new Map({
      container: mapContainer.value!,
      style,
      bounds:
        sharedMap?.value?.data.map_state.boundArray ||
        (bbox(
          mapData?.value?.data.initial_map_view || [
            [95.01, -11.01], // Southwest coordinates (longitude, latitude)
            [141.02, 6.08], // Northeast coordinates (longitude, latitude)
          ], // Indonesia Bounds
        ) as LngLatBoundsLike),
      maxZoom: 20,
    }),
  );

  geolocate.value = markRaw(
    new GeolocateControl({
      positionOptions: {
        enableHighAccuracy: true,
      },
      trackUserLocation: true,
    }),
  );

  map.value.addControl(geolocate.value);

  // Add right-click event listener
  map.value.getCanvas().addEventListener("contextmenu", handleRightClick);

  // Add click event listener to document to handle outside clicks
  document.addEventListener("click", handleClickOutside);

  setMapRef(map.value);
  setGeolocateRef(geolocate.value);
  map.value.on("load", () => {
    map.value!.addImage(
      "pulsing-dot",
      createPulsingDot({
        map: map.value!,
        size: 90,
        strokeStyle: getBrandColor("200"),
      }),
      {
        pixelRatio: 2,
      },
    );

    const towerImg = new Image(25, 25);
    towerImg.onload = () => {
      if (map.value && !map.value.hasImage("tower-icon")) {
        // Add image with SDF (Signed Distance Field) option to enable dynamic coloring
        map.value.addImage("tower-icon", towerImg, { sdf: true });
      }
    };
    towerImg.onerror = (error) => {
      console.error("Failed to load tower icon:", error);
    };
    towerImg.src =
      "data:image/svg+xml;charset=utf-8," + encodeURIComponent(towerIconSvg2);
  });

  setTimeout(() => {
    setMapLoad(true);
  }, 1000);
});

// Remove event listeners on unmount
onBeforeUnmount(() => {
  document.removeEventListener("click", handleClickOutside);
  setMapLoad(false);
  map.value?.remove();
  setMapRef(null);
  setGeolocateRef(null);
});

// onMounted(() => console.log("mounted", route.fullPath));
// onUnmounted(() => console.log("unmounted", route.fullPath));

// get layer list
// const layerStore = useMapLayer();
// const { fetchListlayer } = layerStore;
// fetchListlayer();
</script>

<template>
  <div class="map-wrap">
    <Transition appear name="fade" mode="out-in">
      <div
        v-if="!store.mapLoad"
        class="fixed inset-0 z-[9998] flex items-center justify-center bg-grey-200/10 backdrop-blur-sm"
      >
        <div class="flex flex-col items-center gap-3 text-white">
          <IcSpinner class="text-white h-10 w-10 animate-spin" />
          <p class="text-sm font-medium">Preparing map experience…</p>
        </div>
      </div>
    </Transition>
    <div class="map" ref="mapContainer"></div>
    <MapLayer v-if="store.mapLoad" />
    <MapPopup />
    <MapSitePointConnectionPanel />

    <!-- Coordinate Popup -->
    <div
      v-if="showCoordinatePopup"
      ref="popupRef"
      class="fixed z-[1000] bg-[#232221] p-3 rounded-xxs text-grey-200 w-[16rem]"
      :style="{
        left: `${popupPosition.x}px`,
        top: `${popupPosition.y}px`,
      }"
    >
      <div class="">
        <div class="text-xs flex items-center justify-between font-semibold">
          <h3>Coordinates Information</h3>
          <button @click="showCoordinatePopup = false">
            <SvgoIcCross />
          </button>
        </div>
        <div class="w-full h-[1px] bg-grey-700 my-1" />

        <div class="grid grid-cols-2 text-xs gap-y-2 my-2">
          <p class="font-semibold">Longitude</p>
          <p>: {{ popupCoordinates.lng.toFixed(6) }}</p>
          <p class="font-semibold">Latitude</p>

          <p>: {{ popupCoordinates.lat.toFixed(6) }}</p>
        </div>

        <div class="">
          <button
            class="text-sm bg-brand-600 rounded-xs text-white w-full py-2 font-semibold mt-4 mb-2"
            @click="copyCoordinates"
          >
            Copy to Clipboard
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
@import "https://unpkg.com/maplibre-gl@3.6.2/dist/maplibre-gl.css";
@import "https://api.mapbox.com/mapbox-gl-js/plugins/mapbox-gl-draw/v1.4.3/mapbox-gl-draw.css";

.map-wrap {
  position: relative;
  width: 100%;
  height: calc(100vh);
}

.map {
  position: absolute;
  width: 100%;
  height: 100%;
}

.coordinate-popup {
  position: fixed;
  z-index: 1000;
  background-color: white;
  border: 1px solid #ccc;
  border-radius: 8px;
  padding: 15px;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
}

.coordinate-actions {
  display: flex;
  justify-content: center;
  gap: 10px;
}
</style>
