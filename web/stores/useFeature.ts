import { defineStore } from "pinia";
import type { PopupItem } from "@/components/map/Popup.vue";

export type rightSidebarEnum =
  | "mapinfo"
  | "feature"
  | "3d-feature"
  | "geoprocessing"
  | "analytic"
  | "";

export type titleEnum =
  | "Backbone Route Map"
  | "Asset Management Map"
  | "Market Potential Analysis Map"
  | "Backhaul Optimal Planing and Asset Management"
  | "Market Potential Analysis (Existing Infrastructure)"
  | "Fixed Wireless Access (FWA) Opportunity Assessment"
  | "Integrated BOQ & BOM Generation with Optical Budget Analysis"
  | "Market Potential Map"
  | "Assets Management Map"
  | "";

export type typeFeatureEnum =
  | "backhaul"
  | "backbone"
  | "potential-analysis"
  | "FWA"
  | "market-potential"
  | "fwa-access"
  | "ftth-access"
  | "BOQ-BOM"
  | "integrated-network"
  | "automated-ftth"
  | "";
export type Province = {
  province_id: string;
  province: string;
};

export type Cities = {
  city_id: string;
  city: string;
};
export type typeFilterLocation = {
  province: Province[];
  cities: Cities[];
};
export type mapInfoEnum =
  | "info"
  | "analytic"
  | "title-feature"
  | "add-attribute"
  | "detail-info"
  | "geoprocessing"
  | "core-transaction"
  | "quick-request-list"
  | "site-connection"
  | "site-points"
  | "";

export const useFeature = defineStore("feature", () => {
  const feature = ref<PopupItem>();
  const titleFeature = ref<titleEnum>("");
  const typeFeature = ref<typeFeatureEnum>("");
  const isShowLayerManagement = ref(false);
  const isShowLegend = ref(false);
  const isShowProject = ref(false);
  const featureIdEdit = ref<number | null>(null);
  const filterLocation = ref<typeFilterLocation | null | undefined>();
  const newFeatureGeometry = ref<any>(null);
  const newFeatureType = ref<"point" | "line" | "multipoint" | null>(null);
  // Cable endpoints for line features (from/to metadata)
  const newCableEndpoints = ref<{
    from: { ogc_fid: number | string; type?: string } | null;
    to: { ogc_fid: number | string; type?: string } | null;
  } | null>(null);

  // Selected site point for core transaction
  const selectedCoreTransactionSite = ref<{
    coordinates: [number, number];
    id: string;
    ogc_fid: number;
    name?: string;
    code?: string;
    type?: string;
  } | null>(null);

  function setFeature(newFeature: PopupItem | undefined) {
    feature.value = newFeature;
  }

  function setNewFeatureGeometry(
    geometry: any,
    type: "point" | "line" | "multipoint",
  ) {
    newFeatureGeometry.value = geometry;
    newFeatureType.value = type;
  }

  function clearNewFeatureGeometry() {
    newFeatureGeometry.value = null;
    newFeatureType.value = null;
  }
  function setNewCableEndpoints(
    from: { ogc_fid: number | string; type?: string } | null,
    to: { ogc_fid: number | string; type?: string } | null,
  ) {
    newCableEndpoints.value = { from, to };
  }
  function clearNewCableEndpoints() {
    newCableEndpoints.value = null;
  }

  function setSelectedCoreTransactionSite(
    site: {
      coordinates: [number, number];
      id: string;
      ogc_fid: number;
      name?: string;
      code?: string;
      type?: string;
    } | null,
  ) {
    selectedCoreTransactionSite.value = site;
  }

  const threeDfeature = ref<{ header: Object; content: Object }>();
  function set3DFeature(
    newFeature: { header: Object; content: Object } | undefined,
  ) {
    threeDfeature.value = newFeature;
  }
  const mapInfo = ref<mapInfoEnum>("");
  function setMapInfo(newValue: mapInfoEnum) {
    mapInfo.value = newValue;
  }
  const rightSidebar = ref<rightSidebarEnum>("");
  function setRightSidebar(newValue: rightSidebarEnum) {
    rightSidebar.value = newValue;
  }
  return {
    feature,
    featureIdEdit,
    setFeature,
    threeDfeature,
    set3DFeature,
    rightSidebar,
    setRightSidebar,
    mapInfo,
    setMapInfo,
    titleFeature,
    isShowLayerManagement,
    isShowLegend,
    isShowProject,
    typeFeature,
    filterLocation,
    newFeatureGeometry,
    newFeatureType,
    setNewFeatureGeometry,
    clearNewFeatureGeometry,
    newCableEndpoints,
    setNewCableEndpoints,
    clearNewCableEndpoints,
    selectedCoreTransactionSite,
    setSelectedCoreTransactionSite,
  };
});
