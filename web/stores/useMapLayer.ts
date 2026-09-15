import type {
  VectorTiles,
  RasterTiles,
  CircleStyles,
  FillStyles,
  LineStyles,
  LayerGroupedByCategory,
  LayerLists,
  ThreeDTiles,
  ThreeDTilesConfig,
  RasterTilesConfig,
  VectorTilesConfig,
  LoadedGeoJson,
  LayerConfigLists,
  ThreeDLayerCenter,
  SymbolStylesConfig,
  SitePointType,
  SitePoint,
  AssetType,
  Asset,
  RouteType,
  Route,
  CableType,
  Cable,
  Tower,
} from "~/utils/types";
import {
  geomTypeCircle,
  geomTypeLine,
  geomTypePolygon,
  geomTypeRaster,
  geomTypeSymbol,
  geomTypeTerrain,
  geomTypeThreeD,
  uncategorizedAlias,
} from "~/constants";
import { isString, parseString } from "~/utils";
import { useMapModule } from "~/stores/useMapModule";
import { CollisionGroups } from "maplibre-gl";

interface Category {
  label: string;
  layerLists: any[]; // Define a more specific type if possible
}

export const useMapLayer = defineStore("maplayer", () => {
  const featureStore = useFeature();
  const { typeFeature } = storeToRefs(featureStore);
  const moduleStore = useMapModule();
  const mapRefStore = useMapRef();
  const mapLayerStore = useMapLayer();
  const authStore = useAuth();
  const { getAllLoadedGeoJsonData } = useIDB();
  const listLayer = ref<{
    site_points: SitePointType[];
    assets: AssetType[];
    routes: RouteType[];
    cables: CableType[];
    towers?: Tower[];
  }>();
  const groupedActiveLayers = ref<LayerGroupedByCategory[]>([]);
  const groupedLayerList = ref<LayerGroupedByCategory[]>([]);
  const groupedLocalLayers = ref<LayerGroupedByCategory[]>([]);

  const selectedCategory = ref<Category | null>(null);

  function setSelectedCategory(category: { label: string; layerLists: any[] }) {
    selectedCategory.value = category;
  }

  const handleVisibility = (
    groupIndex: number,
    layerIndex: number,
    visibility: string,
  ) => {
    if (groupedActiveLayers.value) {
      // Mutate the layer style directly - Vue 3 will detect this change
      groupedActiveLayers.value[groupIndex].layerLists[
        layerIndex
      ].layer_style.layout_visibility = visibility;
    }
  };

  const toggleCategoryVisibility = (
    label: string,
    parentGroupLabel?: string,
  ) => {
    if (!groupedActiveLayers.value) return;

    // Find all layers in all groups that match this category label
    let firstLayerVisibility: string | null = null;

    // First pass: determine if we're showing or hiding (based on first layer found)
    for (const group of groupedActiveLayers.value) {
      // If parentGroupLabel is provided, only check within that group
      if (parentGroupLabel && group.label !== parentGroupLabel) continue;

      for (const layer of group.layerLists) {
        const categoryName = layer.category?.category_name;
        if (categoryName === label) {
          firstLayerVisibility =
            layer.layer_style.layout_visibility || "visible";
          break;
        }
      }
      if (firstLayerVisibility !== null) break;
    }

    if (firstLayerVisibility === null) return;

    // Determine new visibility (toggle)
    const newVisibility =
      firstLayerVisibility === "visible" ? "none" : "visible";

    // Second pass: apply to all matching layers within the same parent group
    groupedActiveLayers.value.forEach((group) => {
      // If parentGroupLabel is provided, only toggle within that group
      if (parentGroupLabel && group.label !== parentGroupLabel) return;

      group.layerLists.forEach((layer) => {
        const categoryName = layer.category?.category_name;
        if (categoryName === label) {
          layer.layer_style.layout_visibility = newVisibility;
        }
      });
    });
  };

  const updateLayerOpacity = (
    groupIndex: number,
    layerIndex: number,
    opacity: number,
  ) => {
    if (groupedActiveLayers.value) {
      const prev = groupedActiveLayers.value;
      const selected = prev[groupIndex].layerLists[layerIndex];
      if (selected.source === "vector_tiles") {
        let updatedOpacity = opacity;
        if (selected.geometry_type === geomTypeCircle) {
          (selected.layer_style as CircleStyles).paint_circle_opacity =
            updatedOpacity.toString();
        } else if (selected.geometry_type === geomTypeLine) {
          (selected.layer_style as LineStyles).paint_line_opacity =
            updatedOpacity.toString();
        } else if (selected.geometry_type === geomTypePolygon) {
          (selected.layer_style as FillStyles).paint_fill_opacity =
            updatedOpacity.toString();
        }
      } else if (selected.source === "raster_tiles") {
        (selected as RasterTiles).opacity = opacity;
      } else if (selected.source === "three_d_tiles") {
        (selected as ThreeDTiles).opacity = opacity;
      }

      groupedActiveLayers.value = prev;
    }
  };

  const updateLayerProperty = (
    groupIndex: number,
    layerIndex: number,
    propType: "paint" | "layout" | "3d",
    propName: string,
    propValue: string | number | boolean | null,
    layerId: string,
  ) => {
    if (groupedActiveLayers.value) {
      let newValue;

      if (isString(propValue)) {
        newValue = parseString(propValue as string);
      } else {
        newValue = propValue;
      }
      const prev = groupedActiveLayers.value;
      const selected: LayerLists = prev[groupIndex].layerLists[layerIndex];
      if (propType !== "3d") {
        if (propName !== "icon-image") {
          (
            selected.layer_style as Record<
              string,
              string | number | boolean | null
            >
          )[`${propType}_` + propName.replace(/-/g, "_")] = propValue;
        } else {
          (
            selected.layer_style as Record<
              string,
              string | number | boolean | null
            >
          )["icon_image_id"] = propValue;
        }
      } else {
        (selected as Record<string, any>)[propName] = propValue;
      }

      groupedActiveLayers.value = prev;
      if (mapRefStore.map) {
        if (propType === "paint") {
          mapRefStore.map.setPaintProperty(layerId, propName, newValue);
        } else if (propType === "layout") {
          mapRefStore.map.setLayoutProperty(layerId, propName, newValue);
        }
      }
    }
  };

  const sortLayer = (layers: LayerLists[], order: "asc" | "desc" = "asc") => {
    return layers.sort((a, b) => {
      let nameA: string, nameB: string;
      if (a.source === "vector_tiles") {
        nameA = a.layer_alias?.toUpperCase() || a.layer_name.toUpperCase();
      } else {
        nameA = a.layer_alias.toUpperCase();
      }
      if (b.source === "vector_tiles") {
        nameB = b.layer_alias?.toUpperCase() || b.layer_name.toUpperCase();
      } else {
        nameB = b.layer_alias.toUpperCase();
      }
      if (order === "asc") {
        return nameA.localeCompare(nameB);
      } else {
        return nameB.localeCompare(nameA);
      }
    });
  };

  const getLayersArr = (layers: {
    vectorTiles?: {
      data: LayerConfigLists;
    };
    rasterTiles?: {
      data: LayerConfigLists;
    };
    threeDTiles?: {
      data: LayerConfigLists;
    };
  }) => {
    const layersArr: LayerLists[] = [];
    for (const [key, value] of Object.entries(layers)) {
      value.data.forEach((el) => {
        if (key === "vectorTiles") {
          const item = JSON.parse(JSON.stringify(el as VectorTilesConfig));
          delete item.circle_style;
          delete item.symbol_style;
          delete item.line_style;
          delete item.fill_style;
          if ((el as VectorTilesConfig).circle_style) {
            layersArr.push({
              ...item,
              layer_id: item.layer_id + "_circle",
              layer_alias: item.layer_alias || item.layer_name,
              layer_style: (el as VectorTilesConfig)
                .circle_style as CircleStylesConfig,
              source: "vector_tiles",
              geometry_type: geomTypeCircle,
              dimension: "2D",
            });
          }
          if ((el as VectorTilesConfig).symbol_style) {
            layersArr.push({
              ...item,
              layer_id: item.layer_id + "_symbol",
              layer_alias: item.layer_alias || item.layer_name,
              layer_style: {
                ...((el as VectorTilesConfig)
                  .symbol_style as SymbolStylesConfig),
                icon_image_id: (el as VectorTilesConfig)?.symbol_style
                  ?.layout_icon_image?.id,
                icon_image_title: (el as VectorTilesConfig)?.symbol_style
                  ?.layout_icon_image?.title,
              },
              source: "vector_tiles",
              geometry_type: geomTypeSymbol,
              dimension: "2D",
            });
          }
          if ((el as VectorTilesConfig).line_style) {
            layersArr.push({
              ...item,
              layer_id: item.layer_id + "_line",
              layer_alias: item.layer_alias || item.layer_name,
              layer_style: (el as VectorTilesConfig)
                .line_style as LineStylesConfig,
              source: "vector_tiles",
              geometry_type: geomTypeLine,
              dimension: "2D",
            });
          }
          if ((el as VectorTilesConfig).fill_style) {
            layersArr.push({
              ...item,
              layer_id: item.layer_id + "_fill",
              layer_alias: item.layer_alias || item.layer_name,
              layer_style: (el as VectorTilesConfig)
                .fill_style as FillStylesConfig,
              source: "vector_tiles",
              geometry_type: geomTypePolygon,
              dimension: "2D",
            });
          }
        } else if (key === "rasterTiles") {
          const item = el as RasterTilesConfig;
          let RasterTilesItem: RasterTiles;
          RasterTilesItem = {
            layer_alias: item.layer_alias,
            layer_id: item.layer_id,
            bounds: item.bounds,
            minzoom: item.minzoom,
            maxzoom: item.maxzoom,
            terrain_rgb: item.terrain_rgb,
            source: "raster_tiles",
            opacity: 1,
            layer_style: {
              layout_visibility: item.visible ? "visible" : "none",
            },
            geometry_type: item.terrain_rgb ? geomTypeTerrain : geomTypeRaster,
            dimension: "2D",
            category: item.category,
            ...(item.terrain_rgb && { category: { category_name: "Terrain" } }),
          };
          layersArr.push(RasterTilesItem);
        } else if (key === "threeDTiles") {
          const item = el as ThreeDTilesConfig;
          let ThreeDTilesItem: ThreeDTiles;
          ThreeDTilesItem = {
            source: "three_d_tiles",
            opacity: item.opacity,
            point_size: item.point_size,
            point_color: item.point_color,
            layer_style: {
              layout_visibility: item.visible ? "visible" : "none",
            },
            geometry_type: geomTypeThreeD,
            layer_alias: item.layer_alias,
            layer_id: item.layer_id,
            category: { category_name: "3D" },
            dimension: "3D",
          };
          layersArr.push(ThreeDTilesItem);
        }
      });
    }

    //sort by layer_alias in ascending order
    sortLayer(layersArr);

    return layersArr;
  };

  const groupLayerByCategory = (layerLists: LayerLists[]) => {
    const layerGroupedByCategory = layerLists.reduce(
      (group: LayerGroupedByCategory[], item) => {
        const existingCategory = group.find((group: LayerGroupedByCategory) => {
          let categoryName = "";
          if (item.category === null) {
            categoryName = uncategorizedAlias;
          } else if (item.category?.category_name) {
            categoryName = item.category.category_name;
          }
          return group.label === categoryName;
        });

        if (existingCategory) {
          existingCategory.layerLists.push(item);
        } else {
          if (item.category === null) {
            group.push({
              label: uncategorizedAlias,
              layerLists: [item],
              defaultOpen: false,
            });
          } else if (item.category !== null && item.category?.category_name) {
            group.push({
              label: item.category.category_name,
              layerLists: [item],
              defaultOpen: false,
            });
          }
        }

        return group.sort((a, b) => {
          const nameA = a.label.toUpperCase(); // ignore upper and lowercase
          const nameB = b.label.toUpperCase(); // ignore upper and lowercase

          // '3D' group should always come first
          if (nameA === "3D") return -1;
          if (nameB === "3D") return 1;

          // 'Terrain' group should always come last
          if (nameA === "TERRAIN") return 1;
          if (nameB === "TERRAIN") return -1;

          return nameA.localeCompare(nameB);
        });
      },
      [],
    );
    return layerGroupedByCategory;
  };

  const fetchListedLayers = async () => {
    try {
      const [vectorTiles, rasterTiles, threeDTiles, loadedGeoJsonData] =
        await Promise.all([
          $fetch<{
            data: LayerConfigLists;
          }>(
            "/panel/items/vector_tiles?fields=*.*.*&sort=layer_name&limit=-1",
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + authStore.accessToken,
              },
            },
          ),
          $fetch<{
            data: LayerConfigLists;
          }>("/panel/items/raster_tiles?fields=*.*&sort=layer_alias&limit=-1", {
            method: "GET",
            headers: {
              "Content-Type": "application/json",
              Authorization: "Bearer " + authStore.accessToken,
            },
          }),
          $fetch<{
            data: LayerConfigLists;
          }>(
            "/panel/items/three_d_tiles?fields=*.*&sort=layer_alias&limit=-1",
            {
              method: "GET",
              headers: {
                "Content-Type": "application/json",
                Authorization: "Bearer " + authStore.accessToken,
              },
            },
          ),
          getAllLoadedGeoJsonData(),
        ]);

      const layerData = groupLayerByCategory(
        getLayersArr({
          vectorTiles,
          rasterTiles,
          threeDTiles,
        }),
      );
      const localLayerData = groupLayerByCategory(
        sortLayer(
          loadedGeoJsonData.map((el) => {
            return {
              source: el.source,
              layer_id: el.layer_id,
              layer_alias: el.layer_alias,
              layer_style: el.layer_style,
              bounds: el.bounds,
              category: el.category,
              geometry_type: el.geometry_type,
              dimension: el.dimension,
              is_ftth: el.is_ftth ?? false,
            };
          }),
        ),
      );

      groupedLayerList.value = layerData;
      groupedLocalLayers.value = localLayerData;
    } catch (error) {
      return [];
    }
  };

  const fetchActiveLayers = async (module?: string) => {
    await fetchListlayer(module);
  };

  const threeDLayerCenter = ref<ThreeDLayerCenter[]>([]);

  //remove item from groupedActiveLayer
  const removeLayer = (
    layerItem: VectorTiles | RasterTiles | ThreeDTiles | LoadedGeoJson,
  ) => {
    let groupName = layerItem.category
      ? layerItem.category.category_name
      : uncategorizedAlias;
    let groupIndex = groupedActiveLayers.value?.findIndex(
      (el) => el.label === groupName,
    );
    let layerIndex = groupedActiveLayers.value?.[
      groupIndex as number
    ].layerLists.findIndex((el) => el.layer_id === layerItem.layer_id);

    if (
      groupedActiveLayers.value?.[groupIndex as number].layerLists.length === 1
    ) {
      groupedActiveLayers.value?.splice(groupIndex as number, 1);
    } else {
      groupedActiveLayers.value?.[groupIndex as number]?.layerLists.splice(
        layerIndex as number,
        1,
      );
    }

    if (layerItem.source !== "three_d_tiles") {
      mapRefStore.map?.removeLayer(layerItem.layer_id);
      mapRefStore.map?.removeSource(layerItem.layer_id);
    }
  };

  const clearAllAnalysisLayers = () => {
    if (!mapRefStore.map) return;

    // Remove all layers from the map that were created by analysis components
    // This includes buffer layers and analysis result layers
    const layersToRemove: string[] = [];
    const sourcesToRemove: string[] = [];

    // Collect all layer IDs from groupedActiveLayers
    groupedActiveLayers.value.forEach((group) => {
      group.layerLists.forEach((layer) => {
        if (layer.source !== "three_d_tiles") {
          layersToRemove.push(layer.layer_id);
          sourcesToRemove.push(layer.layer_id);
        }
      });
    });

    // Also remove any buffer/analysis layers that might not be in groupedActiveLayers
    // Pattern: Buffer_FWA_*, *_buffer, *_house_class, *_poi, *_telecommunication, etc.
    const map = mapRefStore.map;
    const allLayers = map.getStyle()?.layers || [];

    allLayers.forEach((layer: any) => {
      const layerId = layer.id;
      // Match buffer analysis patterns and backhaul analysis patterns
      if (
        layerId.includes("_buffer") ||
        layerId.includes("_house_class") ||
        layerId.includes("_poi") ||
        layerId.includes("_telecommunication") ||
        layerId.startsWith("Buffer_FWA_") ||
        layerId.includes("Backhaul_")
      ) {
        if (!layersToRemove.includes(layerId)) {
          layersToRemove.push(layerId);
          sourcesToRemove.push(layerId);
        }
      }
    });

    // Remove layers and sources
    layersToRemove.forEach((layerId) => {
      try {
        if (map.getLayer(layerId)) {
          map.removeLayer(layerId);
        }
      } catch (error) {
        console.warn(`Failed to remove layer ${layerId}:`, error);
      }
    });

    sourcesToRemove.forEach((sourceId) => {
      try {
        if (map.getSource(sourceId)) {
          map.removeSource(sourceId);
        }
      } catch (error) {
        console.warn(`Failed to remove source ${sourceId}:`, error);
      }
    });

    // Clear the grouped active layers array
    // Keep only non-analysis layers (like base layers, terrain, etc.)
    // For now, we'll clear everything as analysis layers are the main concern
    groupedActiveLayers.value = [];
  };

  const addLayer = (
    layerItem: VectorTiles | RasterTiles | ThreeDTiles | LoadedGeoJson,
  ) => {
    let groupName = layerItem.category?.category_name || uncategorizedAlias;

    let groupIndex = mapLayerStore.groupedActiveLayers.findIndex(
      (el) => el.label === groupName,
    );
    if (groupIndex !== -1) {
      mapLayerStore.groupedActiveLayers[groupIndex].layerLists.push(layerItem);
    } else {
      if (
        mapLayerStore.groupedActiveLayers.findIndex(
          (el) => el.label === "Terrain",
        ) !== -1
      ) {
        mapLayerStore.groupedActiveLayers.splice(-1, 0, {
          label: groupName,
          layerLists: [layerItem],
          defaultOpen: false,
        });
        // mapLayerStore.groupedActiveLayers.push({
        //   label: groupName,
        //   layerLists: [layerItem],
        //   defaultOpen: false,
        // });
      } else {
        mapLayerStore.groupedActiveLayers.push({
          label: groupName,
          layerLists: [layerItem],
          defaultOpen: false,
        });
      }
    }
  };

  const fetchListlayer = async (module?: string) => {
    const defaultBounds = {
      type: "Polygon",
      coordinates: [
        [
          [95.01, -11.01],
          [141.02, -11.01],
          [141.02, 6.08],
          [95.01, 6.08],
          [95.01, -11.01],
        ],
      ],
    } as GeoJSON.Polygon;

    const ensureBounds = (input: any) => {
      if (
        input &&
        typeof input === "object" &&
        input.type === "Polygon" &&
        Array.isArray(input.coordinates)
      ) {
        // Validate that coordinates are within valid lat/lng ranges
        // Latitude: -90 to 90, Longitude: -180 to 180
        try {
          const coords = input.coordinates[0];
          const isValid = coords.every((coord: number[]) => {
            const [lng, lat] = coord;
            return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
          });

          if (isValid) {
            return input as GeoJSON.Polygon;
          }
        } catch (e) {
          // If validation fails, return default bounds
        }
      }
      return defaultBounds;
    };

    // Color palette for different layer types
    const colorPalette = {
      sitePoints: {
        1: { main: "#3B82F6", stroke: "#2563EB" }, // Backbone - Blue
        2: { main: "#10B981", stroke: "#059669" }, // Backhaul - Green
        3: { main: "#F59E0B", stroke: "#D97706" }, // Tower - Amber
      },
      assets: {
        1: { main: "#8B5CF6", stroke: "#7C3AED" }, // ONT - Purple
        2: { main: "#06B6D4", stroke: "#0891B2" }, // ODP - Cyan
        3: { main: "#EC4899", stroke: "#DB2777" }, // ODC - Pink
      },
      routes: {
        1: { main: "#10B981", stroke: "#059669" }, // Route Type A - Green
        2: { main: "#3B82F6", stroke: "#2563EB" }, // Route Type B - Blue
      },
      cables: {
        1: { main: "#EF4444", stroke: "#DC2626" }, // Cable Type A - Red
      },
      towers: {
        CTM: "#10B981", // Green
        TBG: "#F5C400", // Yellow
        Alfa: "#EF4444", // Red
        Balcom: "#F59E0B", // Amber
        Gihon: "#3B82F6", // Blue
        PKP: "#8B5CF6", // Purple
      },
    };

    const buildCircleStyle = (
      visible: boolean,
      typeId?: number,
      isAsset?: boolean,
    ): CircleStyles => {
      let colors;

      if (isAsset) {
        // Use asset colors for assets
        colors = colorPalette.assets[
          typeId as keyof typeof colorPalette.assets
        ] || { main: "#8B5CF6", stroke: "#7C3AED" }; // Purple fallback
      } else {
        // Use site point colors for site points
        colors = colorPalette.sitePoints[
          typeId as keyof typeof colorPalette.sitePoints
        ] || { main: "#6B7280", stroke: "#4B5563" }; // Gray fallback
      }

      return {
        layout_visibility: visible ? "visible" : "none",
        paint_circle_color: colors.main,
        paint_circle_radius: 6,
        paint_circle_opacity: "0.9",
        paint_circle_stroke_color: colors.stroke,
        paint_circle_stroke_width: 2,
      };
    };

    const buildSymbolStyle = (
      visible: boolean,
      iconId?: string,
      typeId?: number,
    ): Record<string, any> => {
      // If iconId is provided (for assets), use the Directus asset icon
      if (iconId) {
        return {
          layout_visibility: visible ? "visible" : "none",
          layout_icon_size: 0.3, // Smaller icon size for assets
          layout_icon_allow_overlap: true,
          paint_icon_opacity: "0.9",
          icon_image_id: iconId, // Store the Directus asset UUID
        };
      }

      // Fallback for non-asset symbols (legacy)
      const colors = colorPalette.assets[
        typeId as keyof typeof colorPalette.assets
      ] || { main: "#F97316" }; // Orange fallback

      return {
        layout_visibility: visible ? "visible" : "none",
        layout_icon_size: 0.1,
        paint_icon_color: colors.main,
        paint_icon_opacity: "0.9",
      };
    };

    const buildTowerSymbolStyle = (
      visible: boolean,
      subTypeName?: string,
    ): Record<string, any> => {
      const color =
        colorPalette.towers[subTypeName as keyof typeof colorPalette.towers] ||
        "#F97316";

      return {
        layout_visibility: visible ? "visible" : "none",
        layout_icon_image: "tower-icon", // Reference to the SVG icon
        layout_icon_size: module === "backhaul" ? 1.2 : 1.2,
        layout_icon_allow_overlap: true,
        paint_icon_color: color,
        paint_icon_opacity: "0.9",
      };
    };

    const buildLineStyle = (
      visible: boolean,
      typeId?: number,
      isRoute?: boolean,
    ): LineStyles => {
      let color = "#10B981"; // Default green

      if (isRoute) {
        const colors =
          colorPalette.routes[typeId as keyof typeof colorPalette.routes];
        color = colors?.main || "#10B981";
      } else {
        const colors =
          colorPalette.cables[typeId as keyof typeof colorPalette.cables];
        color = colors?.main || "#EF4444";
      }

      return {
        layout_visibility: visible ? "visible" : "none",
        paint_line_color: color,
        paint_line_width: 4,
        paint_line_opacity: "0.85",
      };
    };

    const buildFillStyle = (visible: boolean): FillStyles => ({
      layout_visibility: visible ? "visible" : "none",
      paint_fill_color: "#7C3AED",
      paint_fill_opacity: "0.45",
      paint_fill_outline_color: "#5B21B6",
    });

    const buildAdministrationLineStyle = (
      visible: boolean,
      layerName: string,
    ): LineStyles => {
      // Different zoom levels for provinces vs cities
      const minzoom = layerName === "area_provinces" ? 5 : 8;
      const maxzoom = layerName === "area_provinces" ? 10 : 15;

      return {
        layout_visibility: visible ? "visible" : "none",
        paint_line_color: "#FFFFFF", // White color for boundaries
        paint_line_width: 0.5,
        paint_line_opacity: "0.8",
      };
    };

    try {
      // Build URL with module path parameter if provided
      const baseUrl = module
        ? `/panel/layers/layer-list/${module}`
        : "/panel/layers/layer-list";

      // Check if showing all data (no location filter)
      const { filterLocation } = featureStore;
      const isShowingAllData =
        !filterLocation ||
        (filterLocation.province?.length === 0 &&
          filterLocation.cities?.length === 0);

      // Add is_playground=false when showing all data, omit when filtered
      const queryString = isShowingAllData
        ? "group_by=type&state=active&is_playground=false"
        : "group_by=type&state=active&is_playground=true";

      const { data } = await $fetch<ResponseListLayerData>(
        `${baseUrl}?${queryString}`,
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + authStore.accessToken,
          },
        },
      );

      listLayer.value = data;

      const layerResponse = data as unknown as Record<string, any>;

      const groupedByType = new Map<string, LayerLists[]>();

      const vectorConfigs: Array<{
        key: string;
        layerName: string;
        suffix: string;
        geometry: string;
        itemsKey: string;
        categoryKey: string;
        styleBuilder: (
          visible: boolean,
        ) => CircleStyles | LineStyles | FillStyles | Record<string, any>;
        groupLabel: string;
        typeIdKey?: string;
      }> = [
        {
          key: "site_points",
          layerName: "site_points",
          suffix: "_circle",
          geometry: geomTypeCircle,
          itemsKey: "site_points",
          categoryKey: "site_point_type_name",
          styleBuilder: buildCircleStyle,
          groupLabel: "Site Points",
          typeIdKey: "site_point_type_id",
        },
        {
          key: "assets",
          layerName: "assets",
          suffix: "_symbol",
          geometry: geomTypeSymbol,
          itemsKey: "assets",
          categoryKey: "asset_type_name",
          styleBuilder: buildSymbolStyle,
          groupLabel: "Assets",
          typeIdKey: "asset_type_id",
        },
        {
          key: "cables",
          layerName: "cables",
          suffix: "_line",
          geometry: geomTypeLine,
          itemsKey: "cables",
          categoryKey: "cable_type_name",
          styleBuilder: buildLineStyle,
          groupLabel: "Cables",
          typeIdKey: "cable_type_id",
        },
        {
          key: "routes",
          layerName: "routes",
          suffix: "_line",
          geometry: geomTypeLine,
          itemsKey: "routes",
          categoryKey: "route_type_name",
          styleBuilder: buildLineStyle,
          groupLabel: "Routes",
          typeIdKey: "route_type_id",
        },
      ];

      // Process administration layers
      if (
        layerResponse.administrations &&
        Array.isArray(layerResponse.administrations)
      ) {
        if (!groupedByType.has("Administration")) {
          groupedByType.set("Administration", []);
        }

        const administrationBucket = groupedByType.get("Administration")!;

        layerResponse.administrations.forEach((admin: any) => {
          const layerName = admin.layer_name; // "area_provinces" or "area_cities"
          const administrationName = admin.administrations_name; // "Administration Provinces"
          const visible = admin.isvisible !== false;

          // Determine zoom levels based on layer type
          const minzoom = layerName === "area_provinces" ? 5 : 8;
          const maxzoom = layerName === "area_provinces" ? 10 : 15;

          const layerStyle = buildAdministrationLineStyle(visible, layerName);

          administrationBucket.push({
            source: "vector_tiles",
            bounds: defaultBounds,
            category: {
              category_name: "Administration",
              category_id: 999, // Use a special ID for administration
            },
            layer_style: layerStyle,
            geometry_type: geomTypeLine,
            layer_alias: administrationName,
            layer_id: `${layerName}_line`,
            layer_name: layerName,
            filter: undefined, // No filter needed - show all features
            minzoom: minzoom,
            maxzoom: maxzoom,
            click_popup_columns: [],
            image_columns: [],
            feature_detail_columns: [],
            dimension: "2D",
          } as VectorTiles);
        });
      }

      vectorConfigs.forEach((config) => {
        if (!groupedByType.has(config.groupLabel)) {
          groupedByType.set(config.groupLabel, []);
        }

        const groups =
          layerResponse[config.key] ||
          layerResponse[config.key.replace("-", "_")] ||
          [];

        if (!Array.isArray(groups)) return;

        groups.forEach((group: any) => {
          // Check if this type has sub_types (is_have_sub: true)
          const isHaveSub = group?.is_have_sub === true;
          const subTypes = group?.sub_types || [];
          const categoryName =
            group?.[config.categoryKey] ||
            group?.name ||
            group?.label ||
            config.layerName;
          const typeId =
            config.typeIdKey && group?.[config.typeIdKey] !== undefined
              ? group[config.typeIdKey]
              : undefined;

          const targetBucket = groupedByType.get(config.groupLabel)!;

          if (isHaveSub && subTypes.length > 0) {
            // Handle is_have_sub: true - create one layer per sub_type
            subTypes.forEach((subType: any) => {
              const subTypeName = subType?.sub_type_name || "Unknown";
              const subTypeKey = subType?.sub_type_key || "type";
              const visible = subType?.isvisible !== false;
              const layerAlias = `${categoryName} - ${subTypeName}`;
              const baseId = `${
                config.layerName
              }_${typeId}_${subTypeKey}_${subTypeName.replace(/\s+/g, "_")}`;
              const layerBounds = ensureBounds(
                subType?.bounds || group?.bounds,
              );

              const categoryMeta = {
                category_name: categoryName,
                category_id: typeId,
              } as any;

              // Build client-side filter expression (no query parameters)
              const filterExpression = config.typeIdKey
                ? [
                    "all",
                    ["==", ["get", config.typeIdKey], typeId],
                    ["==", ["get", subTypeKey], subTypeName],
                  ]
                : ["==", ["get", subTypeKey], subTypeName];

              // Build style with color differentiation
              let layerStyle:
                | CircleStyles
                | LineStyles
                | FillStyles
                | Record<string, any>;

              // Tower-like types: any site_point with is_have_sub + owner sub_type
              const isTower =
                config.key === "site_points" &&
                isHaveSub &&
                subTypes.some((s: any) => s.sub_type_key === "owner");

              if (isTower) {
                // Use symbol style with tower icon and color for each owner
                layerStyle = buildTowerSymbolStyle(visible, subTypeName);
              } else if (
                config.key === "site_points" &&
                config.geometry === geomTypeCircle
              ) {
                layerStyle = buildCircleStyle(visible, typeId);
              } else if (
                config.key === "assets" &&
                config.geometry === geomTypeSymbol
              ) {
                // For assets, extract icon UUID from group object
                const iconId = group?.icon;
                layerStyle = buildSymbolStyle(visible, iconId, typeId);
              } else if (
                config.key === "routes" &&
                config.geometry === geomTypeLine
              ) {
                layerStyle = buildLineStyle(visible, typeId, true);
              } else if (
                config.key === "cables" &&
                config.geometry === geomTypeLine
              ) {
                layerStyle = buildLineStyle(visible, typeId, false);
              } else {
                layerStyle = config.styleBuilder(visible) as any;
              }

              // Use symbol geometry for towers, otherwise use config geometry
              const actualGeometry = isTower ? geomTypeSymbol : config.geometry;
              const actualSuffix = isTower ? "_symbol" : config.suffix;

              if (
                actualGeometry === geomTypeCircle ||
                actualGeometry === geomTypeSymbol
              ) {
                // Determine minzoom based on layer type
                let minzoom = 4; // Default for site points
                if (config.key === "assets") {
                  minzoom = 8; // Assets visible from zoom 8+
                } else if (isTower && module !== "backhaul") {
                  minzoom = 12; // Towers visible from zoom 12+ (except backhaul)
                }

                targetBucket.push({
                  source: "vector_tiles",
                  bounds: layerBounds,
                  category: categoryMeta,
                  layer_style: layerStyle as CircleStyles,
                  geometry_type: actualGeometry,
                  layer_alias: layerAlias,
                  layer_id: `${baseId}${actualSuffix}`,
                  layer_name: config.layerName,
                  filter: filterExpression,
                  minzoom: minzoom,
                  maxzoom: 22,
                  click_popup_columns: [],
                  image_columns: [],
                  feature_detail_columns: [],
                  dimension: "2D",
                } as VectorTiles);
              } else if (config.geometry === geomTypeLine) {
                targetBucket.push({
                  source: "vector_tiles",
                  bounds: layerBounds,
                  category: categoryMeta,
                  layer_style: layerStyle as LineStyles,
                  geometry_type: geomTypeLine,
                  layer_alias: layerAlias,
                  layer_id: `${baseId}${config.suffix}`,
                  layer_name: config.layerName,
                  filter: filterExpression,
                  minzoom: 4,
                  maxzoom: 22,
                  click_popup_columns: [],
                  image_columns: [],
                  feature_detail_columns: [],
                  dimension: "2D",
                } as VectorTiles);
              } else if (config.geometry === geomTypePolygon) {
                targetBucket.push({
                  source: "vector_tiles",
                  bounds: layerBounds,
                  category: categoryMeta,
                  layer_style: layerStyle as FillStyles,
                  geometry_type: geomTypePolygon,
                  layer_alias: layerAlias,
                  layer_id: `${baseId}${config.suffix}`,
                  layer_name: config.layerName,
                  filter: filterExpression,
                  minzoom: 4,
                  maxzoom: 22,
                  click_popup_columns: [],
                  image_columns: [],
                  feature_detail_columns: [],
                  dimension: "2D",
                } as VectorTiles);
              }
            });
          } else {
            // Handle is_have_sub: false - create one layer per type (not per item)
            const visible = group?.isvisible !== false;
            const layerAlias = categoryName;
            const baseId = `${config.layerName}_${typeId}`;
            const layerBounds = ensureBounds(group?.bounds);

            const categoryMeta = categoryName
              ? ({
                  category_name: categoryName,
                  category_id: typeId,
                } as any)
              : null;

            // Build client-side filter expression for filtering by type
            const filterExpression = config.typeIdKey
              ? ["==", ["get", config.typeIdKey], typeId]
              : undefined;

            // Build style with color differentiation
            let layerStyle:
              | CircleStyles
              | LineStyles
              | FillStyles
              | Record<string, any>;

            // Towers (site_point_type_id: 3) - use symbol icon
            const isTower = config.key === "site_points" && typeId === 3;

            if (isTower) {
              // Use symbol style with tower icon and color for each owner
              layerStyle = buildTowerSymbolStyle(visible, categoryName);
            } else if (
              config.key === "site_points" &&
              config.geometry === geomTypeCircle
            ) {
              layerStyle = buildCircleStyle(visible, typeId);
            } else if (
              config.key === "assets" &&
              config.geometry === geomTypeSymbol
            ) {
              // For assets, extract icon UUID from group object
              const iconId = group?.icon;
              layerStyle = buildSymbolStyle(visible, iconId, typeId);
            } else if (
              config.key === "routes" &&
              config.geometry === geomTypeLine
            ) {
              layerStyle = buildLineStyle(visible, typeId, true);
            } else if (
              config.key === "cables" &&
              config.geometry === geomTypeLine
            ) {
              layerStyle = buildLineStyle(visible, typeId, false);
            } else {
              layerStyle = config.styleBuilder(visible) as any;
            }

            // Use symbol geometry for towers, otherwise use config geometry
            const actualGeometry = isTower ? geomTypeSymbol : config.geometry;
            const actualSuffix = isTower ? "_symbol" : config.suffix;

            if (
              actualGeometry === geomTypeCircle ||
              actualGeometry === geomTypeSymbol
            ) {
              // Determine minzoom based on layer type
              let minzoom = 4; // Default for site points
              if (config.key === "assets") {
                minzoom = 8; // Assets visible from zoom 8+
              } else if (isTower && module !== "backhaul") {
                minzoom = 12; // Towers visible from zoom 12+ (except backhaul)
              }

              targetBucket.push({
                source: "vector_tiles",
                bounds: layerBounds,
                category: categoryMeta,
                layer_style: layerStyle as CircleStyles,
                geometry_type: actualGeometry,
                layer_alias: layerAlias,
                layer_id: `${baseId}${actualSuffix}`,
                layer_name: config.layerName,
                filter: filterExpression,
                minzoom: minzoom,
                maxzoom: 22,
                click_popup_columns: [],
                image_columns: [],
                feature_detail_columns: [],
                dimension: "2D",
              } as VectorTiles);
            } else if (config.geometry === geomTypeLine) {
              targetBucket.push({
                source: "vector_tiles",
                bounds: layerBounds,
                category: categoryMeta,
                layer_style: layerStyle as LineStyles,
                geometry_type: geomTypeLine,
                layer_alias: layerAlias,
                layer_id: `${baseId}${config.suffix}`,
                layer_name: config.layerName,
                filter: filterExpression,
                minzoom: 4,
                maxzoom: 22,
                click_popup_columns: [],
                image_columns: [],
                feature_detail_columns: [],
                dimension: "2D",
              } as VectorTiles);
            } else if (config.geometry === geomTypePolygon) {
              targetBucket.push({
                source: "vector_tiles",
                bounds: layerBounds,
                category: categoryMeta,
                layer_style: layerStyle as FillStyles,
                geometry_type: geomTypePolygon,
                layer_alias: layerAlias,
                layer_id: `${baseId}${config.suffix}`,
                layer_name: config.layerName,
                filter: filterExpression,
                minzoom: 4,
                maxzoom: 22,
                click_popup_columns: [],
                image_columns: [],
                feature_detail_columns: [],
                dimension: "2D",
              } as VectorTiles);
            }
          }
        });
      });

      const groupedResult: LayerGroupedByCategory[] = [];

      vectorConfigs.forEach((config) => {
        const bucket = groupedByType.get(config.groupLabel) || [];

        if (!bucket.length) return;

        const sorted = sortLayer([...bucket]);
        groupedResult.push({
          label: config.groupLabel,
          layerLists: sorted,
          defaultOpen: false,
        });
      });

      // Add Administration group if it exists
      const administrationBucket = groupedByType.get("Administration") || [];
      if (administrationBucket.length > 0) {
        const sorted = sortLayer([...administrationBucket]);
        groupedResult.push({
          label: "Administration",
          layerLists: sorted,
          defaultOpen: false,
        });
      }

      // Process data_supports layers
      if (
        layerResponse.data_supports &&
        Array.isArray(layerResponse.data_supports)
      ) {
        const dataSupportsLayers: VectorTiles[] = [];

        layerResponse.data_supports.forEach((dataSupport: any) => {
          const layerName = dataSupport.layer_name;
          const dataSupportName =
            dataSupport.data_supports_name || dataSupport.layer_name;
          const visible = dataSupport.isvisible !== false;
          const geometryType = dataSupport.geometry_type;
          const bounds = ensureBounds(dataSupport.bounds);

          const categoryName = "Data Supports";

          // Create layer based on geometry type
          if (geometryType === "POINT") {
            // Use circle style if available
            const circleStyle = dataSupport.circle_style;
            if (circleStyle) {
              const layerStyle: CircleStyles = {
                layout_visibility: visible ? "visible" : "none",
                paint_circle_color: circleStyle.paint_circle_color || "#E57373",
                paint_circle_radius: circleStyle.paint_circle_radius || 10,
                paint_circle_opacity: circleStyle.paint_circle_opacity || "0.8",
                paint_circle_stroke_color:
                  circleStyle.paint_circle_stroke_color || "#B71C1C",
                paint_circle_stroke_width:
                  circleStyle.paint_circle_stroke_width || 0,
              };

              dataSupportsLayers.push({
                source: "vector_tiles",
                bounds: bounds,
                category: {
                  category_name: categoryName,
                  category_id: 1000,
                },
                layer_style: layerStyle,
                geometry_type: geomTypeCircle,
                layer_alias: dataSupportName,
                layer_id: `${layerName}_circle`,
                layer_name: layerName,
                filter: undefined,
                minzoom: dataSupport.minzoom || 4,
                maxzoom: dataSupport.maxzoom || 22,
                click_popup_columns: dataSupport.click_popup_columns || [],
                image_columns: dataSupport.image_columns || [],
                feature_detail_columns:
                  dataSupport.feature_detail_columns || [],
                dimension: "2D",
              } as VectorTiles);
            }

            // Handle symbol style if available
            const symbolStyle = dataSupport.symbol_style;
            if (symbolStyle) {
              const layerStyle: Record<string, any> = {
                layout_visibility: visible ? "visible" : "none",
                layout_icon_size: symbolStyle.layout_icon_size || 0.3,
                layout_icon_allow_overlap:
                  symbolStyle.layout_icon_allow_overlap || true,
                paint_icon_opacity: symbolStyle.paint_icon_opacity || "0.9",
              };

              if (symbolStyle.icon_image_id) {
                layerStyle.icon_image_id = symbolStyle.icon_image_id;
              }

              dataSupportsLayers.push({
                source: "vector_tiles",
                bounds: bounds,
                category: {
                  category_name: categoryName,
                  category_id: 1000,
                },
                layer_style: layerStyle,
                geometry_type: geomTypeSymbol,
                layer_alias: dataSupportName,
                layer_id: `${layerName}_symbol`,
                layer_name: layerName,
                filter: undefined,
                minzoom: dataSupport.minzoom || 4,
                maxzoom: dataSupport.maxzoom || 22,
                click_popup_columns: dataSupport.click_popup_columns || [],
                image_columns: dataSupport.image_columns || [],
                feature_detail_columns:
                  dataSupport.feature_detail_columns || [],
                dimension: "2D",
              } as VectorTiles);
            }
          } else if (geometryType === "LINESTRING") {
            const lineStyle = dataSupport.line_style;
            if (lineStyle) {
              const layerStyle: LineStyles = {
                layout_visibility: visible ? "visible" : "none",
                paint_line_color: lineStyle.paint_line_color || "#FF5733",
                paint_line_width: lineStyle.paint_line_width || 1,
                paint_line_opacity: lineStyle.paint_line_opacity || "0.8",
              };

              dataSupportsLayers.push({
                source: "vector_tiles",
                bounds: bounds,
                category: {
                  category_name: categoryName,
                  category_id: 1000,
                },
                layer_style: layerStyle,
                geometry_type: geomTypeLine,
                layer_alias: dataSupportName,
                layer_id: `${layerName}_line`,
                layer_name: layerName,
                filter: undefined,
                minzoom: dataSupport.minzoom || 4,
                maxzoom: dataSupport.maxzoom || 22,
                click_popup_columns: dataSupport.click_popup_columns || [],
                image_columns: dataSupport.image_columns || [],
                feature_detail_columns:
                  dataSupport.feature_detail_columns || [],
                dimension: "2D",
              } as VectorTiles);
            }
          } else if (geometryType === "POLYGON") {
            const fillStyle = dataSupport.fill_style;
            if (fillStyle) {
              const layerStyle: FillStyles = {
                layout_visibility: visible ? "visible" : "none",
                paint_fill_color: fillStyle.paint_fill_color || "#7C3AED",
                paint_fill_opacity: fillStyle.paint_fill_opacity || "0.45",
                paint_fill_outline_color:
                  fillStyle.paint_fill_outline_color || "#5B21B6",
              };

              dataSupportsLayers.push({
                source: "vector_tiles",
                bounds: bounds,
                category: {
                  category_name: categoryName,
                  category_id: 1000,
                },
                layer_style: layerStyle,
                geometry_type: geomTypePolygon,
                layer_alias: dataSupportName,
                layer_id: `${layerName}_fill`,
                layer_name: layerName,
                filter: undefined,
                minzoom: dataSupport.minzoom || 4,
                maxzoom: dataSupport.maxzoom || 22,
                click_popup_columns: dataSupport.click_popup_columns || [],
                image_columns: dataSupport.image_columns || [],
                feature_detail_columns:
                  dataSupport.feature_detail_columns || [],
                dimension: "2D",
              } as VectorTiles);
            }
          }
        });

        // Add Data Supports group to result if there are layers
        if (dataSupportsLayers.length > 0) {
          const sorted = sortLayer([...dataSupportsLayers]);
          groupedResult.push({
            label: "Data Supports",
            layerLists: sorted,
            defaultOpen: false,
          });
        }
      }

      groupedActiveLayers.value = groupedResult;
      groupedLayerList.value = groupedResult.map((group) => ({
        label: group.label,
        defaultOpen: group.defaultOpen,
        layerLists: group.layerLists.map((layer) => ({ ...layer })),
      }));
    } catch (error) {
      console.log(error);
      groupedActiveLayers.value = [];
    }
  };

  const toggleTowerLayersByOwner = (ownerName: string | null) => {
    if (!groupedActiveLayers.value) return;

    // Find the "Site Points" category group
    const sitePointsGroup = groupedActiveLayers.value.find(
      (group) => group.label === "Site Points",
    );

    if (!sitePointsGroup) return;

    // Iterate through all layers in Site Points category
    sitePointsGroup.layerLists.forEach((layer) => {
      // Check if this is a tower-like layer (symbol geometry on site_points)
      const isTowerLayer =
        layer.geometry_type === geomTypeSymbol &&
        (layer as any).layer_name === "site_points";

      if (!isTowerLayer) return;

      // Extract owner name from layer_alias (format: "Tower - CTM")
      const layerOwner = layer.layer_alias?.split(" - ")[1]?.trim();
      if (!layerOwner) return;

      // Determine visibility
      let newVisibility: string;
      if (ownerName === null) {
        newVisibility = "visible"; // Show all
      } else if (layerOwner === ownerName) {
        newVisibility = "visible"; // Show selected
      } else {
        newVisibility = "none"; // Hide others
      }

      // Update layer visibility (watchers in Vector.vue will sync to map)
      layer.layer_style.layout_visibility = newVisibility;
    });
  };

  const toggleSchoolLayersByJenjang = (
    jenjang: string | null,
    provinceId: number | null = null,
    cityId: number | null = null,
  ) => {
    if (!groupedActiveLayers.value) return;

    const dataSupportsGroup = groupedActiveLayers.value.find(
      (group) => group.label === "Data Supports",
    );

    if (!dataSupportsGroup) return;

    const map = mapRefStore.map;
    if (!map) return;

    dataSupportsGroup.layerLists.forEach((layer) => {
      const isSchoolLayer = layer.layer_id === "poi_circle";
      if (!isSchoolLayer) return;

      const layerId = layer.layer_id;
      if (!map.getLayer(layerId)) return;

      // Build combined filter (always include group=Sekolah)
      const filters: any[] = [["==", ["get", "group"], "Sekolah"]];

      // Add jenjang filter if specified
      if (jenjang !== null) {
        filters.push(["==", ["get", "sub_group"], jenjang]);
      }

      // Add area filter if specified
      if (cityId !== null) {
        filters.push(["==", ["get", "city_id"], cityId]);
      } else if (provinceId !== null) {
        filters.push(["==", ["get", "province_id"], provinceId]);
      }

      // Apply combined filter
      if (filters.length === 1) {
        map.setFilter(layerId, filters[0]);
      } else {
        map.setFilter(layerId, ["all", ...filters]);
      }

      map.setLayoutProperty(layerId, "visibility", "visible");
    });
  };

  return {
    fetchListlayer,
    fetchListedLayers,
    fetchActiveLayers,
    handleVisibility,
    toggleCategoryVisibility,
    toggleTowerLayersByOwner,
    addLayer,
    getLayersArr,
    groupedLayerList,
    groupedActiveLayers,
    groupedLocalLayers,
    updateLayerOpacity,
    groupLayerByCategory,
    threeDLayerCenter,
    removeLayer,
    clearAllAnalysisLayers,
    updateLayerProperty,
    sortLayer,
    selectedCategory,
    listLayer,
    setSelectedCategory,
    toggleSchoolLayersByJenjang,
  };
});
