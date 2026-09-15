<script setup lang="ts">
import type { AddLayerObject } from "maplibre-gl";
import { useQuery } from "@tanstack/vue-query";
import {
  geomTypeCircle,
  geomTypeLine,
  geomTypePolygon,
  geomTypeSymbol,
} from "~/constants";
import { isString, parseString } from "~/utils";
import type {
  VectorTiles,
  CircleStyles,
  FillStyles,
  LineStyles,
  LayerLists,
  LoadedGeoJson,
  SymbolStylesAdjusted,
} from "~/utils/types";

type StyleObject = Record<
  string,
  string | number | boolean | any[] | undefined | Record<string, string>
>;

const store = useMapRef();
const { map } = storeToRefs(store);
const { getLoadedGeoJsonData } = useIDB();
const authStore = useAuth();
const featureStore = useFeature();

// Fetch ISP colors from API
const { data: ispColorsData } = useQuery({
  queryKey: ["/panel/items/isp"],
  queryFn: async () => {
    const res = await $fetch<{ data: Array<{ name: string; color: string }> }>(
      "/panel/items/isp?fields=name,color",
      {
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
      },
    );
    // Convert to a map for easy lookup
    const colorMap: Record<string, string> = {};
    res.data.forEach((isp) => {
      if (isp.name && isp.color) {
        colorMap[isp.name] = isp.color;
      }
    });
    return colorMap;
  },
  staleTime: 1000 * 60 * 60, // Cache for 1 hour
});

// Fetch POI sub_group colors from API
const { data: poiSubGroupColorsData } = useQuery({
  queryKey: ["/panel/items/poi_sub_group"],
  queryFn: async () => {
    const res = await $fetch<{
      data: Array<{ id: string; color: string }>;
    }>("/panel/items/poi_sub_group?fields=id,color", {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
    const colorMap: Record<string, string> = {};
    res.data.forEach((item) => {
      if (item.id && item.color) {
        colorMap[item.id] = item.color;
      }
    });
    return colorMap;
  },
  staleTime: 1000 * 60 * 60,
});

const props = defineProps<{
  renderedLayers: LayerLists[];
  item: VectorTiles | LoadedGeoJson;
  order: number;
}>();

const currentToken = ref(authStore.accessToken);
// Check if showing all data (no location filter)
const isShowingAllData = computed(() => {
  const { filterLocation } = featureStore;
  return (
    !filterLocation ||
    (filterLocation.province?.length === 0 &&
      filterLocation.cities?.length === 0)
  );
});

// Watch for visibility changes from the store and sync to map
watch(
  () => props.item.layer_style.layout_visibility,
  (newVisibility) => {
    if (map.value && map.value.getLayer(props.item.layer_id)) {
      map.value.setLayoutProperty(
        props.item.layer_id,
        "visibility",
        newVisibility || "visible",
      );

      // Also sync visibility for asset-spiders layer if this is an assets layer
      if (props.item.layer_name === "assets") {
        const spiderLayerId = `${props.item.layer_id}_spiders`;
        if (map.value.getLayer(spiderLayerId)) {
          map.value.setLayoutProperty(
            spiderLayerId,
            "visibility",
            newVisibility || "visible",
          );
        }
      }

      // Also sync visibility for site_points label layers (stasiun and shelter)
      if (props.item.layer_name === "site_points") {
        const labelLayerId = `${props.item.layer_id}_label`;
        if (map.value.getLayer(labelLayerId)) {
          map.value.setLayoutProperty(
            labelLayerId,
            "visibility",
            newVisibility || "visible",
          );
        }
      }
    }
  },
);

// Watch for POI sub_group colors data and update paint when loaded
watch(
  () => poiSubGroupColorsData.value,
  (colors) => {
    if (
      !colors ||
      !map.value ||
      props.item.layer_id !== "poi_circle" ||
      !map.value.getLayer(props.item.layer_id)
    )
      return;
    const matchExpr: any[] = ["match", ["get", "sub_group"]];
    Object.entries(colors).forEach(([id, color]) => {
      matchExpr.push(id, color);
    });
    matchExpr.push("#FFFFFF");
    map.value.setPaintProperty(props.item.layer_id, "circle-color", matchExpr);
  },
);

watchEffect(async (onInvalidate) => {
  const onMouseEnter = () => {
    map.value!.getCanvas().style.cursor = "pointer";
  };
  const onMouseLeave = () => {
    map.value!.getCanvas().style.cursor = "";
  };

  // Load tower icon SVG for symbol layers
  const loadTowerIcon = async () => {
    if (!map.value || map.value.hasImage("tower-icon")) return;

    const { towerIconSvg2 } = await import("~/constants");
    const img = new Image(29, 29);
    img.onload = () => {
      if (map.value && !map.value.hasImage("tower-icon")) {
        map.value.addImage("tower-icon", img, { sdf: true });
      }
    };
    img.src = "data:image/svg+xml;base64," + btoa(towerIconSvg2);
  };

  // Load asset icon from Directus assets
  const loadAssetIcon = async (iconId: string) => {
    if (!map.value || !iconId || map.value.hasImage(iconId)) return;

    return new Promise<void>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (map.value && !map.value.hasImage(iconId)) {
          try {
            // Load without sdf to preserve icon colors
            map.value.addImage(iconId, img);
            resolve();
          } catch (error) {
            console.error(`Failed to add image ${iconId}:`, error);
            reject(error);
          }
        } else {
          resolve();
        }
      };
      img.onerror = (error) => {
        console.error(`Failed to load asset icon ${iconId}:`, error);
        reject(error);
      };
      img.src = `/panel/assets/${iconId}`;
    });
  };

  if (map.value) {
    // Use layer_name as the shared source ID (e.g., "site_points", "assets", "routes", "cables")
    // This allows multiple layers to share the same source for client-side filtering
    const sourceId =
      props.item.source === "vector_tiles"
        ? props.item.layer_name
        : props.item.layer_id;

    if (!map.value.getSource(sourceId)) {
      if (props.item.source === "vector_tiles") {
        // Check if this is an administration layer
        const isAdministrationLayer =
          props.item.layer_name === "area_provinces" ||
          props.item.layer_name === "area_cities";

        // Check if this is a data supports layer (from response.json data_supports array)
        const isDataSupportsLayer =
          props.item.category?.category_name === "Data Supports";

        // Build MVT URL
        // Administration layers and data supports layers use /mvt (no is_playground needed), others use /mvt-data
        const mvtUrl =
          window.location.origin +
          (isAdministrationLayer || isDataSupportsLayer
            ? `/panel/mvt/`
            : `/panel/mvt-data/`) +
          props.item.layer_name +
          "?z={z}&x={x}&y={y}" +
          (authStore.accessToken
            ? "&access_token=" + authStore.accessToken
            : "") +
          (isAdministrationLayer || isDataSupportsLayer
            ? ""
            : isShowingAllData.value
              ? "&is_playground=false"
              : "&is_playground=true");

        map.value.addSource(sourceId, {
          type: "vector",
          tiles: [mvtUrl],
          minzoom: props.item.minzoom || 5,
          maxzoom: props.item.maxzoom || 15,
        });
      } else {
        try {
          const loadedGeoJson = await getLoadedGeoJsonData(props.item.layer_id);
          if (loadedGeoJson) {
            map.value.addSource(sourceId, {
              type: "geojson",
              data: loadedGeoJson.data,
            });
          } else {
            console.error("Layer does not exists in IndexedDB");
          }
        } catch (error) {
          console.error(error);
        }
      }
    } else {
      if (
        authStore.accessToken &&
        authStore.accessToken !== currentToken.value &&
        props.item.source === "vector_tiles"
      ) {
        const source = map.value.getSource(sourceId);
        if (source) {
          // Check if this is an administration layer
          const isAdministrationLayer =
            props.item.layer_name === "area_provinces" ||
            props.item.layer_name === "area_cities";

          // Check if this is a data supports layer (from response.json data_supports array)
          const isDataSupportsLayer =
            props.item.category?.category_name === "Data Supports";

          // Build MVT URL
          // Administration layers and data supports layers use /mvt (no is_playground needed), others use /mvt-data
          const mvtUrl =
            window.location.origin +
            (isAdministrationLayer || isDataSupportsLayer
              ? `/panel/mvt/`
              : `/panel/mvt-data/`) +
            props.item.layer_name +
            "?z={z}&x={x}&y={y}" +
            "&access_token=" +
            authStore.accessToken +
            (isAdministrationLayer || isDataSupportsLayer
              ? ""
              : isShowingAllData.value
                ? "&is_playground=false"
                : "");

          (source as any).setTiles([mvtUrl]);
          currentToken.value = authStore.accessToken;
        }
      }
    }

    if (!map.value.getLayer(props.item.layer_id)) {
      let beforeId: undefined | string = undefined;

      const priorityOrder = [
        "site_points",
        "assets",
        "asset-spiders",
        "cables",
        "routes",
      ];
      const currentLayerName = props.item.layer_name.toLowerCase();
      const priorityIndex = priorityOrder.indexOf(currentLayerName);

      if (priorityIndex !== -1) {
        // It's a priority layer. Find the immediately higher priority layer on the map.
        for (let i = priorityIndex - 1; i >= 0; i--) {
          const higherLayerName = priorityOrder[i];
          const higherLayerMeta = props.renderedLayers.find(
            (l) => l.layer_name.toLowerCase() === higherLayerName,
          );
          if (higherLayerMeta && map.value.getLayer(higherLayerMeta.layer_id)) {
            beforeId = higherLayerMeta.layer_id;
            break;
          }
        }
        // If no higher layer found, beforeId remains undefined.
      } else {
        // It's a non-priority layer.

        // Find the previous non-priority layer that is on the map.
        let previousNonPriorityLayerId: string | undefined = undefined;
        for (let i = props.order - 1; i >= 0; i--) {
          const prevLayer = props.renderedLayers[i];
          if (
            priorityOrder.indexOf(prevLayer.layer_name.toLowerCase()) === -1
          ) {
            // if not a priority layer
            if (map.value.getLayer(prevLayer.layer_id)) {
              previousNonPriorityLayerId = prevLayer.layer_id;
              break;
            }
          }
        }

        if (previousNonPriorityLayerId) {
          beforeId = previousNonPriorityLayerId;
        } else {
          // This is the highest non-priority layer. It should be below the lowest priority layer.
          let lowestPriorityId: string | undefined = undefined;
          for (let i = priorityOrder.length - 1; i >= 0; i--) {
            const layerName = priorityOrder[i];
            const layerMeta = props.renderedLayers.find(
              (l) => l.layer_name.toLowerCase() === layerName,
            );
            if (layerMeta && map.value.getLayer(layerMeta.layer_id)) {
              lowestPriorityId = layerMeta.layer_id;
              break;
            }
          }
          if (lowestPriorityId) {
            beforeId = lowestPriorityId;
          }
          // If no priority layers and no previous non-priority layers, beforeId remains undefined.
        }
      }

      if (props.item.geometry_type === geomTypeCircle) {
        let paint: StyleObject = {},
          layout: StyleObject = {};

        Object.keys(props.item.layer_style).forEach((key) => {
          const [category, ...nameStrings] = key.split("_");
          if (
            category === "paint" &&
            props.item.layer_style?.[key as keyof typeof props.item.layer_style]
          ) {
            paint[nameStrings.join("-")] = isString(
              (props.item.layer_style as CircleStyles)[
                key as keyof CircleStyles
              ],
            )
              ? parseString(
                  (props.item.layer_style as CircleStyles)[
                    key as keyof CircleStyles
                  ] as string,
                )
              : (props.item.layer_style as CircleStyles)[
                  key as keyof CircleStyles
                ];
          } else if (
            category === "layout" &&
            (props.item.layer_style as CircleStyles)?.[
              key as keyof CircleStyles
            ]
          ) {
            layout[nameStrings.join("-")] = isString(
              (props.item.layer_style as CircleStyles)[
                key as keyof CircleStyles
              ],
            )
              ? parseString(
                  (props.item.layer_style as CircleStyles)[
                    key as keyof CircleStyles
                  ] as string,
                )
              : (props.item.layer_style as CircleStyles)[
                  key as keyof CircleStyles
                ];
          }
        });

        // Override circle-color for POI layers based on sub_group
        if (props.item.layer_id === "poi_circle") {
          const colors = poiSubGroupColorsData.value;
          if (colors && Object.keys(colors).length > 0) {
            const matchExpr: any[] = ["match", ["get", "sub_group"]];
            Object.entries(colors).forEach(([id, color]) => {
              matchExpr.push(id, color);
            });
            matchExpr.push("#FFFFFF"); // default color
            paint["circle-color"] = matchExpr;
          }
        }

        // Use shared source ID (layer_name for vector tiles, layer_id for GeoJSON)
        const sourceId =
          props.item.source === "vector_tiles"
            ? props.item.layer_name
            : props.item.layer_id;

        const layer: AddLayerObject = {
          id: props.item.layer_id,
          type: "circle",
          source: sourceId,
          layout,
          paint,
        };

        // Add minzoom/maxzoom to layer if specified
        if (props.item.minzoom !== undefined) {
          layer["minzoom"] = props.item.minzoom;
        }
        if (props.item.maxzoom !== undefined) {
          layer["maxzoom"] = props.item.maxzoom;
        }

        if (props.item.source === "vector_tiles") {
          layer["source-layer"] = props.item.layer_name.split("?")[0];
          // Apply client-side filter if available
          if ((props.item as VectorTiles).filter) {
            layer["filter"] = (props.item as VectorTiles).filter as any;
          }
        }

        map.value.addLayer(layer, beforeId || undefined);

        // Add label layer for site_points (stasiun and shelter - circle geometry)
        if (
          props.item.layer_name === "site_points" &&
          props.item.source === "vector_tiles"
        ) {
          const labelLayerId = `${props.item.layer_id}_label`;

          if (!map.value.getLayer(labelLayerId)) {
            const labelLayer: AddLayerObject = {
              id: labelLayerId,
              type: "symbol",
              source: sourceId,
              minzoom: 12,
              "source-layer": props.item.layer_name.split("?")[0],
              layout: {
                "text-field": ["get", "name"],
                "text-size": 11,
                "text-anchor": "top",
                "text-offset": [0, 3],
                "text-optional": true,
                "text-allow-overlap": false,
                visibility: (props.item.layer_style.layout_visibility ===
                  "visible" ||
                props.item.layer_style.layout_visibility === "none"
                  ? props.item.layer_style.layout_visibility
                  : "visible") as "visible" | "none",
              },
              paint: {
                "text-color": "#1F2937",
                "text-halo-color": "#FFFFFF",
                "text-halo-width": 1.5,
                "text-halo-blur": 0.5,
              },
            };

            // Apply same client-side filter as the circle layer
            if ((props.item as VectorTiles).filter) {
              labelLayer["filter"] = (props.item as VectorTiles).filter as any;
            }

            map.value.addLayer(labelLayer, beforeId || undefined);
          }
        }
      } else if (props.item.geometry_type === geomTypeSymbol) {
        // Load tower icon if this is a tower layer
        if (
          props.item.layer_name === "site_points" ||
          props.item.layer_name === "towers"
        ) {
          await loadTowerIcon();
        }

        // Load asset icon if this is an assets layer
        if (props.item.layer_name === "assets") {
          const iconId = (props.item.layer_style as SymbolStylesAdjusted)
            ?.icon_image_id;
          if (iconId && typeof iconId === "string") {
            try {
              await loadAssetIcon(iconId);
            } catch (error) {
              console.error(
                `Failed to load asset icon for layer ${props.item.layer_id}:`,
                error,
              );
            }
          }
        }

        let paint: StyleObject = {},
          layout: StyleObject = {};

        Object.keys(props.item.layer_style).forEach((key) => {
          const [category, ...nameStrings] = key.split("_");
          if (
            category === "paint" &&
            props.item.layer_style?.[key as keyof typeof props.item.layer_style]
          ) {
            paint[nameStrings.join("-")] = isString(
              (props.item.layer_style as SymbolStylesAdjusted)[
                key as keyof SymbolStylesAdjusted
              ],
            )
              ? parseString(
                  (props.item.layer_style as SymbolStylesAdjusted)[
                    key as keyof SymbolStylesAdjusted
                  ] as string,
                )
              : (props.item.layer_style as SymbolStylesAdjusted)[
                  key as keyof SymbolStylesAdjusted
                ];
          } else if (
            category === "layout" &&
            key === "layout_icon_image" &&
            (props.item.layer_style as SymbolStylesAdjusted)?.[
              key as keyof SymbolStylesAdjusted
            ]
          ) {
            // Handle layout_icon_image specially for tower icons
            layout["icon-image"] = (
              props.item.layer_style as SymbolStylesAdjusted
            )[key as keyof SymbolStylesAdjusted];
          } else if (
            category === "layout" &&
            key !== "layout_icon_image" &&
            (props.item.layer_style as SymbolStylesAdjusted)?.[
              key as keyof SymbolStylesAdjusted
            ]
          ) {
            layout[nameStrings.join("-")] = isString(
              (props.item.layer_style as SymbolStylesAdjusted)[
                key as keyof SymbolStylesAdjusted
              ],
            )
              ? parseString(
                  (props.item.layer_style as SymbolStylesAdjusted)[
                    key as keyof SymbolStylesAdjusted
                  ] as string,
                )
              : (props.item.layer_style as SymbolStylesAdjusted)[
                  key as keyof SymbolStylesAdjusted
                ];
          } else if (
            category === "icon" &&
            key === "icon_image_id" &&
            (props.item.layer_style as SymbolStylesAdjusted)?.[
              key as keyof SymbolStylesAdjusted
            ]
          ) {
            layout["icon-image"] = (
              props.item.layer_style as SymbolStylesAdjusted
            )[key as keyof SymbolStylesAdjusted];
          }
        });

        // Debug logging for tower layer
        if (props.item.layer_name === "towers") {
          console.log("Tower layer configuration:", {
            id: props.item.layer_id,
            layout,
            paint,
            style: props.item.layer_style,
          });

          // Add click handler to debug tower properties
          map.value.on("click", props.item.layer_id, (e) => {
            if (e.features && e.features.length > 0) {
              console.log(e.features[0]);
              console.log(
                "Tower feature clicked - properties:",
                e.features[0].properties,
              );
            }
          });
        }

        // Use shared source ID (layer_name for vector tiles, layer_id for GeoJSON)
        const sourceId =
          props.item.source === "vector_tiles"
            ? props.item.layer_name
            : props.item.layer_id;

        const symbolLayer: AddLayerObject = {
          id: props.item.layer_id,
          type: "symbol",
          source: sourceId,
          "source-layer": props.item.layer_name.split("?")[0],
          layout,
          paint,
        };

        // Add minzoom/maxzoom to layer if specified
        if (props.item.minzoom !== undefined) {
          symbolLayer["minzoom"] = props.item.minzoom;
        }
        if (props.item.maxzoom !== undefined) {
          symbolLayer["maxzoom"] = props.item.maxzoom;
        }

        // Apply client-side filter if available
        if (
          props.item.source === "vector_tiles" &&
          (props.item as VectorTiles).filter
        ) {
          symbolLayer["filter"] = (props.item as VectorTiles).filter as any;
        }

        // Add asset-spiders layer for assets (lines connecting assets) - BEFORE asset symbols
        if (
          props.item.layer_name === "assets" &&
          props.item.source === "vector_tiles"
        ) {
          const spiderSourceId = "asset-spiders";

          // Add asset-spiders source if not exists
          if (!map.value.getSource(spiderSourceId)) {
            const spiderMvtUrl =
              window.location.origin +
              `/panel/mvt-data/asset-spiders` +
              "?z={z}&x={x}&y={y}" +
              (authStore.accessToken
                ? "&access_token=" + authStore.accessToken
                : "") +
              (isShowingAllData.value
                ? "&is_playground=false"
                : "&is_playground=true");

            map.value.addSource(spiderSourceId, {
              type: "vector",
              tiles: [spiderMvtUrl],
              minzoom: props.item.minzoom || 5,
              maxzoom: props.item.maxzoom || 15,
            });
          }

          // Add asset-spiders line layer BEFORE adding the asset symbols (so spiders render behind)
          const spiderLayerId = `${props.item.layer_id}_spiders`;
          if (!map.value.getLayer(spiderLayerId)) {
            const spiderLayer: AddLayerObject = {
              id: spiderLayerId,
              type: "line",
              source: spiderSourceId,
              "source-layer": "asset-spiders",
              layout: {
                visibility: (props.item.layer_style.layout_visibility ===
                  "visible" ||
                props.item.layer_style.layout_visibility === "none"
                  ? props.item.layer_style.layout_visibility
                  : "visible") as "visible" | "none",
              },
              paint: {
                "line-color": "#94A3B8", // Slate color for spider lines
                "line-width": 1,
                "line-opacity": 0.6,
              },
            };
            // Add spider layer with the same beforeId as the asset layer will use
            // This ensures spiders render behind the assets
            map.value.addLayer(spiderLayer, beforeId || undefined);
          }
        }

        // Now add the asset symbol layer on top of spiders
        map.value.addLayer(symbolLayer, beforeId || undefined);

        // Add label layer for site_points (stasiun and shelter only)
        if (
          props.item.layer_name === "site_points" &&
          props.item.source === "vector_tiles"
        ) {
          // Check if this is a stasiun (type 1) or shelter (type 2) layer
          const isSitePointWithLabel =
            props.item.layer_alias?.toLowerCase().includes("stasiun") ||
            props.item.layer_alias?.toLowerCase().includes("shelter");

          if (isSitePointWithLabel) {
            console.log("isSitePointWithLabel running ");
            const labelLayerId = `${props.item.layer_id}_label`;

            if (!map.value.getLayer(labelLayerId)) {
              const labelLayer: AddLayerObject = {
                id: labelLayerId,
                type: "symbol",
                source: sourceId,
                "source-layer": props.item.layer_name.split("?")[0],
                layout: {
                  "text-field": ["get", "name"],
                  "text-size": 11,
                  "text-anchor": "top",
                  "text-offset": [0, 1.2],
                  "text-optional": true,
                  "text-allow-overlap": false,
                  visibility: (props.item.layer_style.layout_visibility ===
                    "visible" ||
                  props.item.layer_style.layout_visibility === "none"
                    ? props.item.layer_style.layout_visibility
                    : "visible") as "visible" | "none",
                },
                paint: {
                  "text-color": "#1F2937",
                  "text-halo-color": "#FFFFFF",
                  "text-halo-width": 1.5,
                  "text-halo-blur": 0.5,
                },
              };

              // Add minzoom/maxzoom to label layer if specified
              if (props.item.minzoom !== undefined) {
                labelLayer["minzoom"] = props.item.minzoom;
              }
              if (props.item.maxzoom !== undefined) {
                labelLayer["maxzoom"] = props.item.maxzoom;
              }

              // Apply same client-side filter as the symbol layer
              if ((props.item as VectorTiles).filter) {
                labelLayer["filter"] = (props.item as VectorTiles)
                  .filter as any;
              }

              map.value.addLayer(labelLayer, beforeId || undefined);
            }
          }
        }
      } else if (props.item.geometry_type === geomTypePolygon) {
        let paint: StyleObject = {},
          layout: StyleObject = {};

        Object.keys(props.item.layer_style as FillStyles).forEach((key) => {
          const [category, ...nameStrings] = key.split("_");
          if (
            category === "paint" &&
            props.item.layer_style?.[key as keyof typeof props.item.layer_style]
          ) {
            paint[nameStrings.join("-")] = isString(
              (props.item.layer_style as FillStyles)[key as keyof FillStyles],
            )
              ? parseString(
                  (props.item.layer_style as FillStyles)[
                    key as keyof FillStyles
                  ] as string,
                )
              : (props.item.layer_style as FillStyles)[key as keyof FillStyles];
          } else if (
            category === "layout" &&
            (props.item.layer_style as FillStyles)?.[key as keyof FillStyles]
          ) {
            layout[nameStrings.join("-")] = (
              props.item.layer_style as FillStyles
            )[key as keyof FillStyles];
          }
        });

        // Use shared source ID (layer_name for vector tiles, layer_id for GeoJSON)
        const sourceId =
          props.item.source === "vector_tiles"
            ? props.item.layer_name
            : props.item.layer_id;

        const layer: AddLayerObject = {
          id: props.item.layer_id,
          type: "fill",
          source: sourceId,
          layout,
          paint,
        };

        // Add minzoom/maxzoom to layer if specified
        if (props.item.minzoom !== undefined) {
          layer["minzoom"] = props.item.minzoom;
        }
        if (props.item.maxzoom !== undefined) {
          layer["maxzoom"] = props.item.maxzoom;
        }

        if (props.item.source === "vector_tiles") {
          layer["source-layer"] = props.item.layer_name.split("?")[0];
          // Apply client-side filter if available
          if ((props.item as VectorTiles).filter) {
            layer["filter"] = (props.item as VectorTiles).filter as any;
          }
        }
        map.value.addLayer(layer, beforeId || undefined);

        // Add label layer for admin boundaries
        // if (props.item.layer_name.toLowerCase().includes("admin")) {
        //   console.log("Adding label layer for admin boundaries");
        //   const labelLayer: AddLayerObject = {
        //     id: `${props.item.layer_id}-label`,
        //     type: "symbol",
        //     source: props.item.layer_id,
        //     "source-layer": props.item.layer_name,
        //     layout: {
        //       "text-field": [
        //         "coalesce",
        //         ["get", "nmdesa"],
        //         ["get", "name"],
        //         ["get", "NAMOBJ"],
        //         ["get", "NAMA"],
        //         "Unknown",
        //       ],
        //       "text-size": 14,
        //       "text-anchor": "center",
        //       "text-justify": "center",
        //       "text-transform": "uppercase",
        //       "text-letter-spacing": 0.05,
        //       "text-max-width": 7,
        //       visibility: "visible",
        //     },
        //     paint: {
        //       "text-color": "#FF0000",
        //       "text-halo-color": "#FFFFFF",
        //       "text-halo-width": 2,
        //     },
        //     minzoom: 5,
        //     maxzoom: 22,
        //   };
        //   map.value.addLayer(labelLayer, beforeId || undefined);
        //   console.log("Added label layer:", `${props.item.layer_id}-label`);
        // }
      } else if (props.item.geometry_type === geomTypeLine) {
        let paint: StyleObject = {},
          layout: StyleObject = {};

        Object.keys(props.item.layer_style as LineStyles).forEach((key) => {
          const [category, ...nameStrings] = key.split("_");
          if (
            category === "paint" &&
            props.item.layer_style?.[key as keyof typeof props.item.layer_style]
          ) {
            paint[nameStrings.join("-")] = isString(
              (props.item.layer_style as LineStyles)[key as keyof LineStyles],
            )
              ? parseString(
                  (props.item.layer_style as LineStyles)[
                    key as keyof LineStyles
                  ] as string,
                )
              : (props.item.layer_style as LineStyles)[key as keyof LineStyles];
          } else if (
            category === "layout" &&
            (props.item.layer_style as LineStyles)?.[key as keyof LineStyles]
          ) {
            layout[nameStrings.join("-")] = (
              props.item.layer_style as LineStyles
            )[key as keyof LineStyles];
          }
        });

        // Override line-color for aoi_area_line based on ISP
        if (props.item.layer_id === "aoi_area_line") {
          // Use ISP colors from API if available, otherwise fallback to hardcoded colors
          const ispColors: Record<string, string> = ispColorsData.value;

          // Build match expression for line-color based on ISP
          const colorExpression: any = ["match", ["get", "isp"]];

          // Add each ISP color mapping
          Object.entries(ispColors).forEach(([isp, color]) => {
            colorExpression.push(isp, color);
          });

          // Add fallback color (grey for unknown ISPs)
          colorExpression.push("#6B7280");

          paint["line-color"] = colorExpression;
        }

        // Use shared source ID (layer_name for vector tiles, layer_id for GeoJSON)
        const sourceId =
          props.item.source === "vector_tiles"
            ? props.item.layer_name
            : props.item.layer_id;

        const layer: AddLayerObject = {
          id: props.item.layer_id,
          type: "line",
          source: sourceId,
          layout,
          paint,
        };

        // Add minzoom/maxzoom to layer if specified
        if (props.item.minzoom !== undefined) {
          layer["minzoom"] = props.item.minzoom;
        }
        if (props.item.maxzoom !== undefined) {
          layer["maxzoom"] = props.item.maxzoom;
        }

        if (props.item.source === "vector_tiles") {
          layer["source-layer"] = props.item.layer_name.split("?")[0];
          // Apply client-side filter if available
          if ((props.item as VectorTiles).filter) {
            layer["filter"] = (props.item as VectorTiles).filter as any;
          }
        }
        map.value.addLayer(layer, beforeId || undefined);
      }

      // emit("updateBeforeId", props.item.layer_id);
    }

    if (
      props.item.source === "vector_tiles" &&
      props.item.click_popup_columns?.length
    ) {
      map.value.on("mouseenter", props.item.layer_id, onMouseEnter);
      map.value.on("mouseleave", props.item.layer_id, onMouseLeave);
    }
  }

  onInvalidate(() => {
    if (map.value) {
      map.value.off("mouseenter", props.item.layer_id, onMouseEnter);
      map.value.off("mouseleave", props.item.layer_id, onMouseLeave);
    }
  });
});
</script>

<template></template>
