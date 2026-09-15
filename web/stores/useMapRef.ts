import { defineStore } from "pinia";
import type { Raw } from "vue";
import { Map, GeolocateControl } from "maplibre-gl";
import type { MapboxOverlay } from "@deck.gl/mapbox";

export const useMapRef = defineStore("mapref", () => {
  const mapLoad = ref<boolean>(false);
  const map = ref<null | Raw<Map>>(null);
  const ctrl = ref<null | Raw<MapboxOverlay>>(null);
  const geolocateRef = ref<null | Raw<GeolocateControl>>(null);
  const currentBasemap = ref("Maptiler Satellite");
  const drawMode = ref<boolean>(false);
  const selectedCity: Ref<string> = ref("");
  const selectedProvince: Ref<string> = ref("");

  function setMapLoad(value: boolean) {
    mapLoad.value = value;
  }
  function setMapRef(value: null | Raw<Map>) {
    map.value = value;
  }
  function setCtrlRef(value: null | Raw<MapboxOverlay>) {
    ctrl.value = value;
  }
  function setGeolocateRef(value: null | Raw<GeolocateControl>) {
    geolocateRef.value = value;
  }
  function setCurrentBaseMap(value: string) {
    currentBasemap.value = value;
  }

  function setDrawMode(value: boolean) {
    drawMode.value = value;
  }
  function setSelectedCity(value: string) {
    selectedCity.value = value;
  }
  function setSelectedProvince(value: string) {
    selectedProvince.value = value;
  }

  return {
    mapLoad,
    setMapLoad,
    map,
    setMapRef,
    geolocateRef,
    setGeolocateRef,
    ctrl,
    setCtrlRef,
    currentBasemap,
    setCurrentBaseMap,
    setDrawMode,
    drawMode,
    selectedCity,
    setSelectedCity,
    setSelectedProvince,
    selectedProvince,
  };
});
