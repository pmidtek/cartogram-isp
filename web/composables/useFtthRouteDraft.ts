import { ref, computed } from "vue";
import length from "@turf/length";
import { lineString } from "@turf/helpers";
import { showHighlightLayer } from "~/utils/index";

export interface SelectedPoint {
  coordinates: [number, number];
  ogc_fid: string | number;
  name?: string;
}

/**
 * Shared 2-point route drafting logic used by both the FTTH "Add Route" and
 * "Add Cable" panels: select 2 site points (from the active project layer or the
 * staging layer), then build a LineString geometry via auto-generate or manual draw.
 */
export function useFtthRouteDraft() {
  const mapRefStore = useMapRef();
  const analysisStore = useAnalysisResult();
  const authStore = useAuth();
  const toast = useToast();

  const selectedPoints = ref<SelectedPoint[]>([]);
  const routeGeometry = ref<GeoJSON.LineString | null>(null);
  const routeLength = ref<string>("0");
  const isGeneratingRoute = ref(false);
  const isDrawingManually = ref(false);

  const hasStarted = ref(false);
  const drawnCoordinates = ref<[number, number][]>([]);

  const canGenerate = computed(
    () => selectedPoints.value.length === 2 && !isGeneratingRoute.value,
  );

  // Project site-points layer that can be clicked to pick a site point.
  const sitePointLayerIds = (): string[] => {
    const map = mapRefStore.map;
    const pid = analysisStore.ftthAnalysisProjectId;
    if (!map || !pid) return [];
    const projectLayer = `project-${pid}-site-points-layer`;
    return map.getLayer(projectLayer) ? [projectLayer] : [];
  };

  const refreshHighlight = () => {
    const map = mapRefStore.map;
    if (!map) return;
    showHighlightLayer(
      map,
      selectedPoints.value.map((pt) => ({
        geom: { type: "Point", coordinates: pt.coordinates } as any,
      })),
      "ftth-route-point-highlight",
      true,
    );
  };

  const handlePointSelection = (e: any) => {
    if (selectedPoints.value.length >= 2) return;
    const map = mapRefStore.map;
    if (!map) return;

    const layers = sitePointLayerIds();
    if (!layers.length) return;

    const features = map.queryRenderedFeatures(e.point, { layers });
    if (!features.length) return;

    const feature = features[0];
    if (feature.geometry.type !== "Point") return;

    const ogcFid =
      feature.properties?.ogc_fid ??
      feature.properties?.temp_id ??
      (feature.id as string | number);

    if (selectedPoints.value.some((p) => p.ogc_fid === ogcFid)) {
      toast.add({
        title: "Sudah dipilih",
        description: "Pilih site point yang berbeda.",
        icon: "i-heroicons-exclamation-triangle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
      return;
    }

    const coords = feature.geometry.coordinates as [number, number];
    selectedPoints.value.push({
      coordinates: [coords[0], coords[1]],
      ogc_fid: ogcFid,
      name: feature.properties?.name,
    });
    refreshHighlight();
  };

  const displayRouteOnMap = (geometry: GeoJSON.Geometry) => {
    const map = mapRefStore.map;
    if (!map) return;
    if (map.getLayer("route-preview")) map.removeLayer("route-preview");
    if (map.getSource("route-preview")) map.removeSource("route-preview");

    map.addSource("route-preview", {
      type: "geojson",
      data: { type: "Feature", properties: {}, geometry },
    });
    map.addLayer({
      id: "route-preview",
      type: "line",
      source: "route-preview",
      layout: { "line-join": "round", "line-cap": "round" },
      paint: { "line-color": "#FFBF00", "line-width": 4, "line-opacity": 0.8 },
    });
  };

  const setGeometry = (geom: GeoJSON.LineString) => {
    routeGeometry.value = geom;
    displayRouteOnMap(geom);
    routeLength.value = length(lineString(geom.coordinates), {
      units: "meters",
    }).toFixed(2);
  };

  const handleAutoGenerate = async () => {
    if (selectedPoints.value.length !== 2) return;
    isGeneratingRoute.value = true;
    const point1 = selectedPoints.value[0].coordinates;
    const point2 = selectedPoints.value[1].coordinates;
    try {
      try {
        const url = "/panel/analysis/generate-route";
        const response = await $fetch<{ data: { geojson_route: any } }>(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
            "Content-Type": "application/json",
          },
          body: { locations: [point1, point2], profile: "driving-car" },
        });
        const feat = response.data?.geojson_route?.features?.[0];
        if (feat?.geometry) {
          setGeometry(feat.geometry);
          toast.add({
            title: "Route dibuat",
            description: "Mengikuti jaringan jalan.",
            icon: "i-heroicons-check-circle",
            ui: { background: "bg-white", title: "text-grey-800" },
          });
          return;
        }
      } catch (e) {
        console.warn("Route generation failed, using straight line:", e);
      }
      setGeometry({ type: "LineString", coordinates: [point1, point2] });
      toast.add({
        title: "Route dibuat",
        description: "Memakai garis lurus antar titik.",
        icon: "i-heroicons-check-circle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
    } finally {
      isGeneratingRoute.value = false;
    }
  };

  const isNearPoint = (
    a: [number, number],
    b: [number, number],
    map: any,
  ) => {
    const pa = map.project(a);
    const pb = map.project(b);
    return Math.sqrt((pa.x - pb.x) ** 2 + (pa.y - pb.y) ** 2) < 20;
  };

  let drawClickHandler: ((e: any) => void) | null = null;
  const handleDrawManually = () => {
    if (selectedPoints.value.length !== 2) return;
    const map = mapRefStore.map;
    if (!map) return;

    isDrawingManually.value = true;
    hasStarted.value = false;
    drawnCoordinates.value = [];
    toast.add({
      title: "Mode gambar aktif",
      description: "Klik titik pertama untuk mulai menggambar.",
      icon: "i-heroicons-pencil",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    drawClickHandler = (e: any) => {
      if (!isDrawingManually.value) return;
      const click: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      if (!hasStarted.value) {
        if (isNearPoint(click, selectedPoints.value[0].coordinates, map)) {
          hasStarted.value = true;
          drawnCoordinates.value = [selectedPoints.value[0].coordinates];
        } else {
          toast.add({
            title: "Mulai dari titik pertama",
            description: "Klik tepat pada titik pertama.",
            icon: "i-heroicons-exclamation-triangle",
            ui: { background: "bg-white", title: "text-grey-800" },
          });
        }
        return;
      }

      if (isNearPoint(click, selectedPoints.value[1].coordinates, map)) {
        drawnCoordinates.value.push(selectedPoints.value[1].coordinates);
        setGeometry({
          type: "LineString",
          coordinates: drawnCoordinates.value,
        });
        toast.add({
          title: "Route selesai digambar",
          icon: "i-heroicons-check-circle",
          ui: { background: "bg-white", title: "text-grey-800" },
        });
        isDrawingManually.value = false;
        hasStarted.value = false;
        if (drawClickHandler) map.off("click", drawClickHandler);
        return;
      }

      drawnCoordinates.value.push(click);
      displayRouteOnMap({
        type: "LineString",
        coordinates: drawnCoordinates.value,
      });
    };

    map.on("click", drawClickHandler);
  };

  const removePoint = (index: number) => {
    selectedPoints.value.splice(index, 1);
    clearPreview();
    routeGeometry.value = null;
    routeLength.value = "0";
    refreshHighlight();
  };

  const clearPreview = () => {
    const map = mapRefStore.map;
    if (!map) return;
    if (map.getLayer("route-preview")) map.removeLayer("route-preview");
    if (map.getSource("route-preview")) map.removeSource("route-preview");
  };

  const clearHighlight = () => {
    const map = mapRefStore.map;
    if (map?.getSource("highlight")) {
      (map.getSource("highlight") as any).setData({
        type: "FeatureCollection",
        features: [],
      });
    }
  };

  const resetDraft = () => {
    selectedPoints.value = [];
    routeGeometry.value = null;
    routeLength.value = "0";
    isDrawingManually.value = false;
    isGeneratingRoute.value = false;
    hasStarted.value = false;
    drawnCoordinates.value = [];
    clearPreview();
    clearHighlight();
  };

  const mountHandlers = () => {
    mapRefStore.setDrawMode(true);
    const map = mapRefStore.map;
    if (map) map.on("click", handlePointSelection);
  };

  const unmountHandlers = () => {
    mapRefStore.setDrawMode(false);
    const map = mapRefStore.map;
    if (map) {
      map.off("click", handlePointSelection);
      if (drawClickHandler) map.off("click", drawClickHandler);
    }
    resetDraft();
  };

  return {
    selectedPoints,
    routeGeometry,
    routeLength,
    isGeneratingRoute,
    isDrawingManually,
    canGenerate,
    handleAutoGenerate,
    handleDrawManually,
    removePoint,
    resetDraft,
    mountHandlers,
    unmountHandlers,
  };
}
