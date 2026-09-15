<script setup lang="ts">
import type {
  GeoJSONSource,
  MapGeoJSONFeature,
  MapMouseEvent,
  PointLike,
} from "maplibre-gl";
import { ref } from "vue";
import maplibregl from "maplibre-gl";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";
import IcCross from "~/assets/icons/ic-cross.svg";
import KeenSlider, { type KeenSliderInstance } from "keen-slider";
import { showHighlightLayer } from "~/utils/index";

const mapRefStore = useMapRef();
const featureStore = useFeature();
const { featureIdEdit } = storeToRefs(featureStore);
const { map } = storeToRefs(mapRefStore);
const mapLayerStore = useMapLayer();
const authStore = useAuth();

// Slider Logic
const sliderContainer = ref<HTMLElement | null>(null);
let slider: KeenSliderInstance | null = null;
let nextImage: (e: MouseEvent) => void;
let prevImage: (e: MouseEvent) => void;

onMounted(() => {
  if (sliderContainer.value) {
    slider = new KeenSlider(
      sliderContainer.value!,
      {
        loop: true,
      },
      [],
    );
    nextImage = (e: MouseEvent) => {
      slider?.update();
      slider?.next();
    };

    prevImage = (e: MouseEvent) => {
      slider?.update();
      slider?.prev();
    };
  }
});

// Popup Logic
export type PopupItem = {
  layerId: string;
  layerType: string;
  tableName: string;
  rowId: string | number;
  clickPopupColumns: string[] | null;
  imageColumns: string[] | null;
  featureDetailColumns: string[] | null;
  geometry: GeoJSON.Geometry;
};

export type SitePointInfo = {
  id: number;
  code: string;
  name: string;
  site_point_type_id?: { id: number; name: string };
  area_city_id?: { city: string; province: string };
  [key: string]: any;
  assets?: any[];
  routes?: any[];
  cables?: any[];
};

const contentRef = ref<HTMLDivElement>();
const popupItems = ref<PopupItem[]>([]);
const popupRef = ref<maplibregl.Popup>();
const features = ref<any[]>([]);
const isFetching = ref(false);
const featureIndex = ref(0);
const isEditing = ref(false);
const editableFeature = ref<any>({});
const isSaving = ref(false);
const analysisStore = useAnalysisResult();
const isSitePointPopup = ref(false);
const isAssetsPopup = ref(false);
const sitePointInfo = ref<SitePointInfo | null>(null);
const expandedSections = ref({
  assets: false,
  routes: false,
  cables: false,
});

// Extend site point logic
const isExtended = ref(false);
const isExtendFetching = ref(false);
const EXTEND_ASSETS_SOURCE = "extend-site-point-assets";
const EXTEND_ASSETS_LAYER = "extend-site-point-assets-layer";
const EXTEND_SPIDERS_SOURCE = "extend-site-point-spiders";
const EXTEND_SPIDERS_LAYER = "extend-site-point-spiders-layer";
const hiddenLayerIds = ref<string[]>([]);

const hideExistingAssetAndSpiderLayers = () => {
  if (!map.value) return;
  const hidden: string[] = [];
  mapLayerStore.groupedActiveLayers.forEach((group) => {
    group.layerLists.forEach((layer) => {
      if (layer.layer_name === "assets") {
        // Hide asset layer
        if (map.value!.getLayer(layer.layer_id)) {
          const vis = map.value!.getLayoutProperty(
            layer.layer_id,
            "visibility",
          );
          if (vis !== "none") {
            map.value!.setLayoutProperty(layer.layer_id, "visibility", "none");
            hidden.push(layer.layer_id);
          }
        }
        // Hide corresponding spider layer
        const spiderLayerId = `${layer.layer_id}_spiders`;
        if (map.value!.getLayer(spiderLayerId)) {
          const vis = map.value!.getLayoutProperty(spiderLayerId, "visibility");
          if (vis !== "none") {
            map.value!.setLayoutProperty(spiderLayerId, "visibility", "none");
            hidden.push(spiderLayerId);
          }
        }
      }
    });
  });
  hiddenLayerIds.value = hidden;
};

const restoreHiddenLayers = () => {
  if (!map.value) return;
  hiddenLayerIds.value.forEach((layerId) => {
    if (map.value!.getLayer(layerId)) {
      map.value!.setLayoutProperty(layerId, "visibility", "visible");
    }
  });
  hiddenLayerIds.value = [];
};

const removeExtendLayers = () => {
  if (!map.value) return;
  if (map.value.getLayer(EXTEND_ASSETS_LAYER))
    map.value.removeLayer(EXTEND_ASSETS_LAYER);
  if (map.value.getSource(EXTEND_ASSETS_SOURCE))
    map.value.removeSource(EXTEND_ASSETS_SOURCE);
  if (map.value.getLayer(EXTEND_SPIDERS_LAYER))
    map.value.removeLayer(EXTEND_SPIDERS_LAYER);
  if (map.value.getSource(EXTEND_SPIDERS_SOURCE))
    map.value.removeSource(EXTEND_SPIDERS_SOURCE);
};

const handleExtend = async () => {
  if (!map.value || !sitePointInfo.value) return;

  if (isExtended.value) {
    // Restore: remove extended layers, bring back original layers
    removeExtendLayers();
    restoreHiddenLayers();
    isExtended.value = false;
    return;
  }

  const sitePointId = sitePointInfo.value.id;
  isExtendFetching.value = true;

  try {
    const params = new URLSearchParams({
      site_point_id: String(sitePointId),
      min_r: "30",
      max_r: "70",
      step: "5",
    });

    const [assetsRes, spidersRes] = await Promise.all([
      $fetch<GeoJSON.FeatureCollection>(
        `/panel/geojson/assets/by-site-point?${params}`,
        { headers: { Authorization: `Bearer ${authStore.accessToken}` } },
      ),
      $fetch<GeoJSON.FeatureCollection>(
        `/panel/geojson/asset-spiders/by-site-point?${params}`,
        { headers: { Authorization: `Bearer ${authStore.accessToken}` } },
      ),
    ]);

    // Hide existing asset and spider layers
    hideExistingAssetAndSpiderLayers();

    // Remove previous extend layers if any
    removeExtendLayers();

    // Add extended spider lines first (render behind assets)
    map.value.addSource(EXTEND_SPIDERS_SOURCE, {
      type: "geojson",
      data: spidersRes,
    });
    map.value.addLayer({
      id: EXTEND_SPIDERS_LAYER,
      type: "line",
      source: EXTEND_SPIDERS_SOURCE,
      paint: {
        "line-color": "#94A3B8",
        "line-width": 1,
        "line-opacity": 0.6,
      },
    });

    // Icons are resolved from the map sprite (sprite@2x) via icon-image; no per-icon loading needed.

    // Copy feature-level id into properties so it's accessible after queryRenderedFeatures
    const assetsData = assetsRes as any;
    if (assetsData.features) {
      assetsData.features.forEach((f: any) => {
        if (f.id != null && f.properties) {
          f.properties.id = f.id;
        }
      });
    }

    // Add extended assets as symbol layer with icons
    map.value.addSource(EXTEND_ASSETS_SOURCE, {
      type: "geojson",
      data: assetsData,
    });
    map.value.addLayer({
      id: EXTEND_ASSETS_LAYER,
      type: "symbol",
      source: EXTEND_ASSETS_SOURCE,
      layout: {
        "icon-image": ["get", "icon"],
        "icon-size": 0.3,
        "icon-allow-overlap": true,
      },
      paint: {
        "icon-opacity": 0.9,
      },
    });

    isExtended.value = true;

    // Close popup
    popupRef.value?.remove();
  } catch (error) {
    console.error("Error fetching extended site point data:", error);
  } finally {
    isExtendFetching.value = false;
  }
};

watchEffect(() => {
  if (!map.value || mapRefStore.drawMode) return;

  map.value.on("click", (e: MapMouseEvent & Object) => {
    if (mapRefStore.drawMode) return;

    // Don't show popup if BOQ/BOM tool is active
    if (analysisStore.boqBomToolActive === "selection_polygon") return;
    if (analysisStore.boqBomToolActive === "draw_polygon") return;

    // Don't show popup if buffer/quadrant analysis tool is active
    if (analysisStore.bufferToolActive) return;

    // Don't show popup while the Site Points panel is open — clicking a
    // site point there opens/pairs an accordion instead (see
    // web/components/map/SitePoints/index.vue's own click handler).
    if (featureStore.mapInfo === "site-points") return;

    const point = [e.point.x, e.point.y];
    const filterLayers = mapLayerStore.groupedActiveLayers
      ?.map(({ layerLists }) => layerLists)
      .flat()
      .filter((e) => Boolean(e.click_popup_columns));

    const layerIds = filterLayers?.map(({ layer_id }) => layer_id) ?? [];
    if (isExtended.value && map.value!.getLayer(EXTEND_ASSETS_LAYER)) {
      layerIds.push(EXTEND_ASSETS_LAYER);
    }

    // Add project GeoJSON layers to the queried layers
    const mapLayers = map.value!.getStyle()?.layers || [];
    mapLayers.forEach((l: any) => {
      if (l.id.startsWith("project-")) {
        layerIds.push(l.id);
      }
    });

    // Filter to only layers that exist on the map
    const validLayerIds = layerIds.filter((id) => map.value!.getLayer(id));

    const features = map.value!.queryRenderedFeatures(point as PointLike, {
      layers: validLayerIds,
    });

    const featureList = features.map((feature: MapGeoJSONFeature) => {
      // Handle project GeoJSON layer features
      if (feature.layer.id.startsWith("project-")) {
        // Map layer suffix to real table name
        let tableName = "_project_geojson";
        if (feature.layer.id.endsWith("-site-points-layer")) {
          tableName = "site_points";
        } else if (feature.layer.id.endsWith("-assets-layer")) {
          tableName = "assets";
        } else if (feature.layer.id.endsWith("-routes-layer")) {
          tableName = "routes";
        } else if (feature.layer.id.endsWith("-cables-layer")) {
          tableName = "cables";
        }
        return {
          layerId: feature.layer.id,
          layerType: feature.layer.type,
          tableName,
          rowId: feature.id ?? feature.properties?.id,
          clickPopupColumns: null,
          featureDetailColumns: null,
          imageColumns: [],
          _projectProperties: feature.properties,
        };
      }
      // Handle extend layer features
      if (feature.layer.id === EXTEND_ASSETS_LAYER) {
        return {
          layerId: feature.layer.id,
          layerType: feature.layer.type,
          tableName: "assets",
          rowId: feature.id ?? feature.properties?.id,
          clickPopupColumns: null,
          featureDetailColumns: null,
          imageColumns: [],
        };
      }
      const foundLayer = filterLayers?.find(
        (layer) => layer.layer_id === feature.layer.id,
      )!;
      return {
        layerId: feature.layer.id,
        layerType: feature.layer.type,
        tableName: feature.sourceLayer,
        rowId: feature.id,
        clickPopupColumns: foundLayer.click_popup_columns,
        featureDetailColumns: foundLayer.feature_detail_columns,
        imageColumns: foundLayer.image_columns ?? [],
      };
    });

    popupItems.value = featureList as PopupItem[];
    if (popupRef.value) {
      popupRef.value.remove();
    }
    if (featureList.length && contentRef.value) {
      popupRef.value = new maplibregl.Popup({
        closeButton: false,
        closeOnClick: false,
        closeOnMove: false,
        className: "geod-popup",
      })
        .setLngLat(e.lngLat)
        .setMaxWidth("400px")
        .setDOMContent(contentRef.value)
        .addTo(map.value!);
      featureStore.setRightSidebar("");
      setTimeout(
        () => featureStore.setFeature(featureList[0] as PopupItem),
        500,
      );
      slider?.moveToIdx(0);
    }
  });
});

onUnmounted(() => {
  removeExtendLayers();
  restoreHiddenLayers();
  slider?.destroy();
  popupRef.value?.remove();
});

watchEffect(async () => {
  if (popupItems.value?.length) {
    isAssetsPopup.value = false;
    isSitePointPopup.value = false;
    const fetchFeature = async (popupItem: PopupItem) => {
      try {
        // Handle project GeoJSON features with no specific table (e.g. asset-spiders)
        if (popupItem.tableName === "_project_geojson") {
          const props = (popupItem as any)._projectProperties || {};
          const { id, geom, ...displayProps } = props;
          return displayProps;
        }

        // Fallback to raw properties for project layers with no rowId
        if (popupItem.layerId?.startsWith("project-") && !popupItem.rowId) {
          const props = (popupItem as any)._projectProperties || {};
          const { id, geom, ...displayProps } = props;
          return displayProps;
        }

        // Use the special site-point-info API for site_points
        if (popupItem.tableName === "site_points") {
          const response: { data: SitePointInfo } = await $fetch(
            `/panel/data/site-point-info/${popupItem.rowId}`,
            {
              headers: {
                Authorization: `Bearer ${authStore.accessToken}`,
              },
            },
          );

          isSitePointPopup.value = true;
          sitePointInfo.value = response.data;

          // Format the main site point data for display - only show specific fields
          const { id, name, code, site_point_type_id, area_city_id } =
            response.data;

          const formattedData = {
            id: id,
            code: code || "-",
            name: name || "-",
            "Site Type": site_point_type_id?.name || "-",
            Province: area_city_id?.province || "-",
            City: area_city_id?.city || "-",
            geom: response.data.geom,
          };
          return formattedData;
        } else {
          // Original logic for non-site_points tables
          const querystring = new URLSearchParams({
            fields: [
              "*",
              "user_created.first_name",
              "user_created.last_name",
              "user_updated.first_name",
              "user_updated.last_name",
              "asset_type_id.id",
              "asset_type_id.name",
              "asset_group_id.id",
              "asset_group_id.name",
              "cable_group_id.*",
            ]!.join(","),
          } as Record<string, string>);
          const response: { data: any } = await $fetch(
            `/panel/items/${popupItem.tableName}/${popupItem.rowId}?${querystring}`,
            {
              headers: {
                Authorization: `Bearer ${authStore.accessToken}`,
              },
            },
          );

          // Check if this is assets table - show only specific fields
          if (popupItem.tableName === "assets") {
            const { id, asset_type_id, asset_group_id, name, code } =
              response.data;

            isAssetsPopup.value = true;
            const formattedData = {
              id: id,
              "Asset Type": asset_type_id?.name || "-",
              "Asset Group": asset_group_id?.id || "-",
              name: name || "-",
              code: code || "-",
              geom: response.data.geom,
            };
            return formattedData;
          }

          // For cables from project layers, show only specific fields
          if (
            popupItem.tableName === "cables" &&
            popupItem.layerId?.startsWith("project-")
          ) {
            const { name, code, cable_net_length_m, cable_group_id } =
              response.data;
            return {
              name: name || "-",
              code: code || "-",
              "Cable Lengh": `${cable_net_length_m} m` ?? "-",
              "Cable Group": cable_group_id?.id || "-",
            };
          }

          // For other tables, show all attributes with mapped nested objects
          const {
            other_attributes,
            user_created,
            user_updated,
            asset_type_id,
            asset_group_id,
            cable_group_id,
            ...dataWithoutOtherAttributes
          } = response.data;

          const formattedData = {
            ...dataWithoutOtherAttributes,
            geom: response.data.geom,
            ...(user_created?.first_name && user_created?.last_name
              ? {
                  "Created By": `${user_created.first_name} ${user_created.last_name}`,
                }
              : {}),
            ...(user_updated?.first_name && user_updated?.last_name
              ? {
                  "Updated By": `${user_updated.first_name} ${user_updated.last_name}`,
                }
              : {}),
            ...(asset_type_id?.name
              ? { "Asset Type": asset_type_id.name }
              : {}),
            ...(asset_group_id?.name
              ? { "Asset Group": asset_group_id?.id }
              : {}),
            ...(cable_group_id?.name
              ? { "Cable Group": cable_group_id?.id }
              : {}),
            ...(other_attributes?.reduce((acc: any, attr: any) => {
              acc[attr.label] = attr.value;
              return acc;
            }, {}) || {}),
          };
          return formattedData;
        }
      } catch (error) {
        return {};
      }
    };
    isFetching.value = true;
    isSitePointPopup.value = false;
    sitePointInfo.value = null;
    const data = await Promise.all(
      popupItems.value.map((item) => fetchFeature(item)),
    );
    isFetching.value = false;
    features.value = data;
    featureIndex.value = 0;
    slider?.update();
    showHighlightLayer(map.value!, data as any[], popupItems.value[0].layerId);
  }
});

// const nextFeature = () => {
//   if (featureIndex.value === popupItems.value.length - 1) return;
//   featureIndex.value++;
//   const newData: GeoJSON.FeatureCollection = {
//     type: "FeatureCollection",
//     features: features.value
//       .filter((_, idx) => idx === featureIndex.value)
//       .map(({ geom, ...rest }) => ({
//         type: "Feature",
//         properties: rest,
//         geometry: geom,
//       })),
//   };
//   (map.value!.getSource("highlight") as GeoJSONSource).setData(newData);
//   moveHighlightLayer(map.value!, popupItems.value[featureIndex.value].layerId);
//   slider?.moveToIdx(0);
//   slider?.update();
//   featureStore.setFeature(popupItems.value[featureIndex.value]);
// };

// const prevFeature = () => {
//   if (featureIndex.value === 0) return;
//   featureIndex.value--;
//   const newData: GeoJSON.FeatureCollection = {
//     type: "FeatureCollection",
//     features: features.value
//       .filter((_, idx) => idx === featureIndex.value)
//       .map(({ geom, ...rest }) => ({
//         type: "Feature",
//         properties: rest,
//         geometry: geom,
//       })),
//   };
//   (map.value!.getSource("highlight") as GeoJSONSource).setData(newData);
//   moveHighlightLayer(map.value!, popupItems.value[featureIndex.value].layerId);
//   slider?.moveToIdx(0);
//   slider?.update();
//   featureStore.setFeature(popupItems.value[featureIndex.value]);
// };

const removePopup = () => {
  popupRef.value!.remove();
  (map.value!.getSource("highlight") as GeoJSONSource).setData(
    emptyFeatureCollection,
  );
  pauseAllAnimation();
  isEditing.value = false;
  isSitePointPopup.value = false;
  sitePointInfo.value = null;
  expandedSections.value = {
    assets: false,
    routes: false,
    cables: false,
  };
};

const toggleSection = (section: "assets" | "routes" | "cables") => {
  expandedSections.value[section] = !expandedSections.value[section];
};

const handleEdit = (value: number) => {
  featureIdEdit.value = value;
};
// const startEdit = () => {
//   isEditing.value = true;
//   editableFeature.value = { ...features.value[featureIndex.value] };
// };

// const cancelEdit = () => {
//   isEditing.value = false;
//   editableFeature.value = {};
// };

// const saveEdit = async () => {
//   try {
//     isSaving.value = true;

//     // Separate the attributes that should be in other_attributes
//     const { geom, ogc_fid, name, code, ...otherAttrs } = editableFeature.value;

//     // Convert the flattened attributes back to other_attributes array
//     const other_attributes = Object.entries(otherAttrs).map(
//       ([label, value]) => ({
//         label,
//         value,
//       })
//     );

//     const requestBody = {
//       name,
//       code,
//       other_attributes,
//     };

//     await $fetch(
//       `/panel/items/${popupItems.value[featureIndex.value].tableName}/${
//         popupItems.value[featureIndex.value].rowId
//       }`,
//       {
//         method: "PATCH",
//         body: JSON.stringify(requestBody),
//         headers: {
//           "Content-Type": "application/json",
//           Authorization: `Bearer ${authStore.accessToken}`,
//         },
//       }
//     );

//     // Update the local feature data
//     features.value[featureIndex.value] = { ...editableFeature.value };
//     isEditing.value = false;

//     // Show success message (you can customize this)
//     console.log("Feature updated successfully");
//   } catch (error) {
//     console.error("Error updating feature:", error);
//     // Show error message (you can customize this)
//   } finally {
//     isSaving.value = false;
//   }
// };
</script>

<template>
  <div class="hidden">
    <div ref="contentRef">
      <section
        class="flex h-full w-80 flex-col items-center justify-center gap-2 p-3 overflow-hidden bg-white rounded-xs text-grey-700"
      >
        <header
          class="flex justify-between items-center w-full border-b pb-1 border-grey-700"
        >
          <h4 class="text-xs font-medium">Detail Popup Information</h4>
          <IcCross
            role="button"
            :fontControlled="false"
            @click="removePopup"
            class="-mr-1 w-5 h-4 px-1 py-0.5 text-grey-400"
          ></IcCross>
        </header>

        <!-- <h4 class="text-xs font-normal text-left w-full">
          {{ featureIndex + 1 }}/{{ features.length }} Layer Selection
        </h4> -->

        <!-- <div
          :class="`relative w-full ${
            popupItems[featureIndex]?.imageColumns?.length ? 'h-40' : 'h-0'
          }`"
        >
          <div class="h-full w-full rounded-xs">
            <img
              class="keen-slider__slide object-cover min-w-full max-w-full"
              v-for="(val, idx) of Object.keys(features[featureIndex] ?? {})
                .filter((k) =>
                  popupItems[featureIndex]?.imageColumns?.includes(k)
                )
                .map((k) =>
                  features[featureIndex][k].includes(',')
                    ? features[featureIndex][k].split(',')
                    : features[featureIndex][k]
                )
                .flat()"
              :key="idx"
              :src="val"
            />
          </div>

          <button
            v-if="
              Object.keys(features[featureIndex] ?? {}).filter((k) =>
                popupItems[featureIndex]?.imageColumns?.includes(k)
              ).length
            "
            @click="prevImage"
            class="absolute left-2 top-1/2 -translate-y-1/2 flex justify-center items-center border rounded-xs bg-black opacity-40"
          >
            <IcArrowReg
              :fontControlled="false"
              class="w-5 h-5 m-1 -rotate-90 text-grey-50"
            />
          </button>

          <button
            v-if="
              Object.keys(features[featureIndex] ?? {}).filter((k) =>
                popupItems[featureIndex]?.imageColumns?.includes(k)
              ).length
            "
            @click="nextImage"
            class="absolute right-2 top-1/2 -translate-y-1/2 flex justify-center items-center border rounded-xs bg-black opacity-40"
          >
            <IcArrowReg
              :fontControlled="false"
              class="w-5 h-5 m-1 rotate-90 text-grey-50"
            />
          </button>
        </div> -->
        <article
          class="w-full max-h-48 overflow-y-scroll bg-[#EFEFEF] p-2 rounded rounded-xxs"
          v-if="popupItems?.length"
        >
          <h5 class="text-[10px] font-normal text-[#79797B]">
            Main Attributes
          </h5>
          <template v-if="isFetching">
            <div
              v-for="(_, idx) in Array.from({ length: 3 })"
              :key="idx"
              class="flex space-x-2 animate-pulse space-y-2"
            >
              <div class="w-1/4 h-4 bg-grey-700 rounded-xs"></div>
              <div class="grow h-4 bg-grey-700 rounded-xs"></div>
            </div>
          </template>
          <template v-else-if="!isEditing">
            <div class="space-y-2 mt-1">
              <div
                v-for="key of Object.keys(features[featureIndex] ?? {}).filter(
                  (k) =>
                    k !== 'geom' &&
                    k !== 'status' &&
                    k !== 'date_created' &&
                    k !== 'date_updated' &&
                    k !== 'owner' &&
                    k !== 'description' &&
                    k !== 'attachment',
                )"
                :key="key"
                class="flex text-[#626264] space-x-2"
              >
                <p
                  :class="
                    popupItems[featureIndex]?.tableName !== 'cables'
                      ? 'w-1/4'
                      : 'w-2/4'
                  "
                  class="text-2xs font-medium capitalize text-wrap"
                >
                  {{ key }}
                </p>
                <p class="text-xs break-words flex-1">
                  : {{ features[featureIndex][key] ?? "-" }}
                </p>
              </div>
            </div>
          </template>
          <template v-else>
            <div
              v-for="key of Object.keys(editableFeature ?? {}).filter(
                (k) => k !== 'geom',
              )"
              :key="key"
              class="flex flex-col space-y-2"
            >
              <label class="text-2xs text-grey-600">{{ key }}</label>
              <input
                v-model="editableFeature[key]"
                class="text-xs p-1 border border-grey-300 rounded-xs focus:outline-none focus:border-blue-500"
                :readonly="key === 'ogc_fid'"
              />
            </div>
            <!-- <div class="flex space-x-2 mt-3">
              <button
                @click="saveEdit"
                :disabled="isSaving"
                class="text-xs bg-blue-600 text-white px-3 py-1 rounded-xs hover:bg-blue-700 disabled:opacity-50"
              >
                {{ isSaving ? "Saving..." : "Save" }}
              </button>
              <button
                @click="cancelEdit"
                :disabled="isSaving"
                class="text-xs bg-grey-300 text-grey-700 px-3 py-1 rounded-xs hover:bg-grey-400 disabled:opacity-50"
              >
                Cancel
              </button>
            </div> -->
          </template>
        </article>

        <footer class="w-full space-y-2">
          <div class="w-full flex items-center space-x-2">
            <!-- Show Detail button for site_points -->
            <button
              v-if="
                ((isSitePointPopup && sitePointInfo) || isAssetsPopup) &&
                !popupItems[featureIndex]?.layerId?.startsWith('project-')
              "
              @click="
                () => {
                  featureStore.setMapInfo('detail-info');
                  // Store the site point info in the feature store for the drawer
                  featureStore.setFeature(popupItems[0]);
                  popupRef!.remove();
                }
              "
              class="rounded-xxs grow h-9 bg-blue-500 text-sm font-normal text-white hover:bg-blue-600"
            >
              Show Detail
            </button>
            <!-- Edit Attributes button (hidden for project GeoJSON layers) -->
            <button
              v-if="
                popupItems[featureIndex]?.tableName !== '_project_geojson' &&
                !popupItems[featureIndex]?.layerId?.startsWith('project-')
              "
              @click="
                () => {
                  featureStore.setMapInfo('add-attribute');
                  popupRef!.remove();
                  handleEdit(popupItems[0].rowId as number);
                }
              "
              class="rounded-xxs grow h-9 bg-brand-500 text-sm font-normal text-white hover:bg-brand-600"
            >
              Edit Attributes
            </button>
          </div>
          <!-- Extend button for site_points -->
          <button
            v-if="
              isSitePointPopup &&
              sitePointInfo &&
              !popupItems[featureIndex]?.layerId?.startsWith('project-')
            "
            @click="handleExtend"
            :disabled="isExtendFetching"
            class="rounded-xxs grow h-9 text-sm font-normal text-white w-full"
            :class="
              isExtended
                ? 'bg-yellow-500 hover:bg-yellow-600'
                : 'bg-green-600 hover:bg-green-700'
            "
          >
            {{
              isExtendFetching
                ? "Loading..."
                : isExtended
                  ? "Restore"
                  : "Extend"
            }}
          </button>
          <!-- Show Connection button for site_points -->
          <UButton
            v-if="
              isSitePointPopup &&
              sitePointInfo &&
              !popupItems[featureIndex]?.layerId?.startsWith('project-')
            "
            block
            :ui="{ rounded: 'rounded-xxs' }"
            label="Show Connection"
            class="h-9 text-sm font-normal"
            @click="
              () => {
                featureStore.setMapInfo('site-connection');
                featureStore.setFeature(popupItems[0]);
                popupRef!.remove();
              }
            "
          />
        </footer>
      </section>
    </div>
  </div>
</template>

<style>
@import url("keen-slider/keen-slider.css");
</style>
