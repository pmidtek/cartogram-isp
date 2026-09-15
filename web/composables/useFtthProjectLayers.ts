import type { GeoJSONSource } from "maplibre-gl";
import { emptyFeatureCollection } from "~/utils/index";

export type ProjectLayerKey =
  | "site-points"
  | "assets"
  | "asset-spiders"
  | "routes"
  | "cables";

// GeoJSON endpoint per layer key.
const ENDPOINT: Record<ProjectLayerKey, string> = {
  "site-points": "/panel/geojson/site_points",
  assets: "/panel/geojson/assets",
  "asset-spiders": "/panel/geojson/asset-spiders",
  routes: "/panel/geojson/routes",
  cables: "/panel/geojson/cables",
};

// Bottom-to-top stacking order.
const ORDER: ProjectLayerKey[] = [
  "routes",
  "cables",
  "asset-spiders",
  "assets",
  "site-points",
];

// Layer paint/layout — matching colorPalette used elsewhere.
export const layerStyles = {
  "site-points": {
    type: "circle" as const,
    paint: {
      "circle-radius": 4,
      "circle-color": ["coalesce", ["get", "color"], "#3B82F6"],
      "circle-stroke-width": 2,
      "circle-stroke-color": "#2563EB",
      "circle-opacity": 0.9,
    },
  },
  assets: {
    type: "symbol" as const,
    layout: {
      "icon-image": ["get", "icon"],
      "icon-size": 0.3,
      "icon-allow-overlap": true,
    },
    paint: { "icon-opacity": 0.9 },
  },
  "asset-spiders": {
    type: "line" as const,
    paint: {
      "line-color": "#94A3B8",
      "line-width": 1,
      "line-opacity": 0.6,
    },
  },
  routes: {
    type: "line" as const,
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#10B981"],
      "line-width": 2,
      "line-opacity": 0.85,
    },
  },
  cables: {
    type: "line" as const,
    paint: {
      "line-color": ["coalesce", ["get", "color"], "#EF4444"],
      "line-width": 2,
      "line-opacity": 0.85,
    },
  },
} as const;

/**
 * Single source of truth for rendering an FTTH project's geojson layers
 * (`project-{id}-{key}-layer`). Used both for the initial project load
 * (Project/index.vue) and for refreshing after manual adds.
 */
export function useFtthProjectLayers() {
  const mapStore = useMapRef();
  const authStore = useAuth();

  // Load an asset icon image into MapLibre from Directus (idempotent).
  const loadAssetIcon = (iconId: string): Promise<void> => {
    const map = mapStore.map;
    if (!map || !iconId || map.hasImage(iconId)) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        if (map && !map.hasImage(iconId)) {
          try {
            map.addImage(iconId, img);
          } catch (e) {
            console.error(`Failed to add image ${iconId}:`, e);
          }
        }
        resolve();
      };
      img.onerror = () => resolve();
      img.src = `/panel/assets/${iconId}`;
    });
  };

  const fetchProjectGeoJSON = async (
    endpoint: string,
    projectId: number,
  ): Promise<any> => {
    try {
      return await $fetch<any>(endpoint, {
        method: "GET",
        params: { project_id: projectId },
        headers: { Authorization: `Bearer ${authStore.accessToken}` },
      });
    } catch (e) {
      console.error(`Error fetching ${endpoint}:`, e);
      return null;
    }
  };

  // Layer that should sit directly above `key` (for correct stacking on create).
  const beforeIdFor = (
    projectId: number,
    key: ProjectLayerKey,
  ): string | undefined => {
    const map = mapStore.map;
    if (!map) return undefined;
    const idx = ORDER.indexOf(key);
    for (let i = idx + 1; i < ORDER.length; i++) {
      const id = `project-${projectId}-${ORDER[i]}-layer`;
      if (map.getLayer(id)) return id;
    }
    return undefined;
  };

  // Create the source+layer if missing, else update its data.
  const ensureProjectLayer = async (
    projectId: number,
    key: ProjectLayerKey,
    data: any,
  ) => {
    const map = mapStore.map;
    if (!map) return;

    const sourceId = `project-${projectId}-${key}-layer`;
    const fcData = data ?? emptyFeatureCollection;

    // Preload asset icons before (re)rendering the symbol layer.
    if (key === "assets" && fcData?.features?.length) {
      const iconIds = [
        ...new Set(
          fcData.features.map((f: any) => f.properties?.icon).filter(Boolean),
        ),
      ] as string[];
      await Promise.all(iconIds.map((id) => loadAssetIcon(id)));
    }

    const existing = map.getSource(sourceId) as GeoJSONSource | undefined;
    if (existing) {
      existing.setData(fcData);
      return;
    }

    map.addSource(sourceId, { type: "geojson", data: fcData });
    const style = layerStyles[key];
    map.addLayer(
      {
        id: sourceId,
        source: sourceId,
        type: style.type,
        ...("layout" in style ? { layout: style.layout } : {}),
        paint: style.paint,
      } as any,
      beforeIdFor(projectId, key),
    );
  };

  // Refresh a single layer type from the backend.
  const refreshProjectLayer = async (
    projectId: number,
    key: ProjectLayerKey,
  ) => {
    const data = await fetchProjectGeoJSON(ENDPOINT[key], projectId);
    await ensureProjectLayer(projectId, key, data);
  };

  /**
   * Fetch + render all layers (create or update). Returns the raw geojson per
   * key so callers (Project/index.vue) can derive bounds + metadata.
   */
  const loadProjectLayers = async (projectId: number) => {
    const [sitePoints, assets, assetSpiders, routes, cables] =
      await Promise.all([
        fetchProjectGeoJSON(ENDPOINT["site-points"], projectId),
        fetchProjectGeoJSON(ENDPOINT.assets, projectId),
        fetchProjectGeoJSON(ENDPOINT["asset-spiders"], projectId),
        fetchProjectGeoJSON(ENDPOINT.routes, projectId),
        fetchProjectGeoJSON(ENDPOINT.cables, projectId),
      ]);

    const byKey: Record<ProjectLayerKey, any> = {
      "site-points": sitePoints,
      assets,
      "asset-spiders": assetSpiders,
      routes,
      cables,
    };

    // Render bottom-to-top so stacking is correct on first creation.
    for (const key of ORDER) {
      await ensureProjectLayer(projectId, key, byKey[key]);
    }

    return byKey;
  };

  const refreshAllProjectLayers = (projectId: number) =>
    loadProjectLayers(projectId);

  const removeProjectLayers = (projectId: number) => {
    const map = mapStore.map;
    if (!map) return;
    for (const key of ORDER) {
      const id = `project-${projectId}-${key}-layer`;
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
  };

  return {
    layerStyles,
    loadAssetIcon,
    fetchProjectGeoJSON,
    ensureProjectLayer,
    refreshProjectLayer,
    loadProjectLayers,
    refreshAllProjectLayers,
    removeProjectLayers,
  };
}
