<script setup lang="ts">
import { TransitionRoot } from "@headlessui/vue";
import IcArrow from "@/assets/icons/ic-arrow-fat.svg";
import IcEye from "~/assets/icons/ic-eye.svg";
import IcEyeCrossed from "~/assets/icons/ic-eye-crossed.svg";
import IcCross from "~/assets/icons/ic-cross.svg";
import IcPencil from "~/assets/icons/ic-attribute.svg";
import bbox from "@turf/bbox";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import { geometryToFeature, extractGeometry } from "~/utils/routeGeometry";
import type {
  LngLatBoundsLike,
  GeoJSONSource,
  Map as MaplibreMap,
} from "maplibre-gl";

const authStore = useAuth();
const mapStore = useMapRef();
const toast = useToast();
const featureStore = useFeature();
const analysisStore = useAnalysisResult();
const ftthWatcher = useFtthAnalysisWatcher();
const { loadProjectLayers, removeProjectLayers } = useFtthProjectLayers();

interface Project {
  project_id: number;
  project_name: string;
}

interface ProvinceData {
  province_ogc_fid: number;
  province_name: string;
  projects: Project[];
}

interface ApiResponse {
  data: ProvinceData[];
}

interface ActiveProjectLayer {
  key: string;
  sourceId: string;
  label: string;
  visible: boolean;
  hasData: boolean;
  color: string;
}

interface ActiveProject {
  project_id: number;
  project_name: string;
  layers: ActiveProjectLayer[];
  expanded: boolean;
  bounds: LngLatBoundsLike | null;
}

const isLoading = ref(false);
const provinceData = ref<ProvinceData[]>([]);
const loadingProjectId = ref<number | null>(null);
const activeProjects = ref<ActiveProject[]>([]);
const activeProjectIds = computed(
  () => new Set(activeProjects.value.map((p) => p.project_id)),
);

const selectedTab = ref(0);
const tabItems = [
  { key: "projects", label: "Project" },
  { key: "active", label: "Active" },
];

const fetchProjects = async () => {
  isLoading.value = true;
  try {
    const response = await $fetch<ApiResponse>("/panel/project-map", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    provinceData.value = response.data || [];
  } catch (error) {
    console.error("Error fetching projects:", error);
  } finally {
    isLoading.value = false;
  }
};

onMounted(() => {
  fetchProjects();
});

watch(
  () => ftthWatcher.showDoneModal,
  (isDone) => {
    if (isDone) fetchProjects();
  },
);

const filterRef = ref("");

const filteredProvinces = computed(() => {
  const filter = filterRef.value.toLowerCase();
  if (!filter) {
    return provinceData.value.filter(
      (province) => province.projects.length > 0,
    );
  }

  return provinceData.value
    .map((province) => ({
      ...province,
      projects: province.projects.filter((project) =>
        project.project_name.toLowerCase().includes(filter),
      ),
    }))
    .filter(
      (province) =>
        province.province_name.toLowerCase().includes(filter) ||
        province.projects.length > 0,
    );
});

const expandedProvinces = ref<Set<number>>(new Set());

const toggleProvince = (provinceId: number) => {
  if (expandedProvinces.value.has(provinceId)) {
    expandedProvinces.value.delete(provinceId);
  } else {
    expandedProvinces.value.add(provinceId);
  }
};

const totalProjects = computed(() => {
  return provinceData.value.reduce(
    (sum, province) => sum + province.projects.length,
    0,
  );
});


// Toggle visibility for a single layer
const toggleLayerVisibility = (projectId: number, layerKey: string) => {
  const activeProject = activeProjects.value.find(
    (p) => p.project_id === projectId,
  );
  if (!activeProject || !mapStore.map) return;

  const layer = activeProject.layers.find((l) => l.key === layerKey);
  if (!layer || !layer.hasData) return;

  const newVisibility = layer.visible ? "none" : "visible";
  layer.visible = !layer.visible;

  if (mapStore.map.getLayer(layer.sourceId)) {
    mapStore.map.setLayoutProperty(layer.sourceId, "visibility", newVisibility);
  }
};

// Toggle all layers for a project
const toggleAllProjectLayers = (projectId: number) => {
  const activeProject = activeProjects.value.find(
    (p) => p.project_id === projectId,
  );
  if (!activeProject || !mapStore.map) return;

  const dataLayers = activeProject.layers.filter((l) => l.hasData);
  const anyVisible = dataLayers.some((l) => l.visible);
  const newVisibility = anyVisible ? "none" : "visible";

  dataLayers.forEach((layer) => {
    layer.visible = !anyVisible;
    if (mapStore.map!.getLayer(layer.sourceId)) {
      mapStore.map!.setLayoutProperty(
        layer.sourceId,
        "visibility",
        newVisibility,
      );
    }
  });
};

// Toggle expand/collapse for active project
const toggleActiveProjectExpand = (projectId: number) => {
  const activeProject = activeProjects.value.find(
    (p) => p.project_id === projectId,
  );
  if (activeProject) {
    activeProject.expanded = !activeProject.expanded;
  }
};

// Fly to project bounds
const flyToProject = (projectId: number) => {
  const activeProject = activeProjects.value.find(
    (p) => p.project_id === projectId,
  );
  if (activeProject?.bounds && mapStore.map) {
    mapStore.map.fitBounds(activeProject.bounds, {
      padding: 50,
      duration: 1500,
    });
  }
};

// FTTH Analysis
const loadingFtthId = ref<number | null>(null);

const openFtthAnalysis = async (projectId: number) => {
  loadingFtthId.value = projectId;
  try {
    flyToProject(projectId);

    const activeProject = activeProjects.value.find(
      (p) => p.project_id === projectId,
    );

    const response = await $fetch<any>(`/panel/project-map/info/${projectId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    analysisStore.setFtthAnalysisData(
      response.data,
      projectId,
      activeProject?.project_name || "",
    );
    analysisStore.setCurrentAnalysisType("ftth_analysis");
    featureStore.setMapInfo("analytic");
  } catch (error) {
    console.error("Error fetching FTTH analysis:", error);
    toast.add({
      title: "Error",
      description: "Failed to fetch FTTH analysis data",
      color: "red",
    });
  } finally {
    loadingFtthId.value = null;
  }
};

// Add project layers to map
const addProjectToMap = async (project: Project) => {
  if (!mapStore.map) {
    toast.add({
      title: "Error",
      description: "Map is not ready",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
    return;
  }

  loadingProjectId.value = project.project_id;

  try {
    const projectId = project.project_id;
    const prefix = `project-${projectId}`;

    // Fetch + render all project layers (shared with manual-add refresh).
    const data = await loadProjectLayers(projectId);
    const sitePointsData = data["site-points"];
    const assetsData = data.assets;
    const assetSpidersData = data["asset-spiders"];
    const routesData = data.routes;
    const cablesData = data.cables;

    // Collect all features for bounds calculation
    const allFeatures: any[] = [];
    [
      sitePointsData,
      assetsData,
      assetSpidersData,
      routesData,
      cablesData,
    ].forEach((d) => {
      if (d?.features?.length) allFeatures.push(...d.features);
    });

    // Calculate bounds for fly-to
    const projectBounds: LngLatBoundsLike | null =
      allFeatures.length > 0
        ? (bbox({
            type: "FeatureCollection",
            features: allFeatures,
          }) as LngLatBoundsLike)
        : null;

    // Build active project with layer metadata
    const activeProject: ActiveProject = {
      project_id: project.project_id,
      project_name: project.project_name,
      expanded: true,
      bounds: projectBounds,
      layers: [
        {
          key: "site-points",
          sourceId: `${prefix}-site-points-layer`,
          label: "Site Points",
          visible: true,
          hasData: (sitePointsData?.features?.length ?? 0) > 0,
          color: "#3B82F6",
        },
        {
          key: "assets",
          sourceId: `${prefix}-assets-layer`,
          label: "Assets",
          visible: true,
          hasData: (assetsData?.features?.length ?? 0) > 0,
          color: "#8B5CF6",
        },
        {
          key: "asset-spiders",
          sourceId: `${prefix}-asset-spiders-layer`,
          label: "Asset Spiders",
          visible: true,
          hasData: (assetSpidersData?.features?.length ?? 0) > 0,
          color: "#94A3B8",
        },
        {
          key: "routes",
          sourceId: `${prefix}-routes-layer`,
          label: "Routes",
          visible: true,
          hasData: (routesData?.features?.length ?? 0) > 0,
          color: "#10B981",
        },
        {
          key: "cables",
          sourceId: `${prefix}-cables-layer`,
          label: "Cables",
          visible: true,
          hasData: (cablesData?.features?.length ?? 0) > 0,
          color: "#EF4444",
        },
      ],
    };

    activeProjects.value.push(activeProject);

    toast.add({
      title: "Project Added",
      description: `${project.project_name} layers added to map`,
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  } catch (error) {
    console.error("Error adding project to map:", error);
    toast.add({
      title: "Error",
      description: "Failed to add project layers to map",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  } finally {
    loadingProjectId.value = null;
  }
};

// Remove project layers from map
const removeProjectFromMap = (project: Project) => {
  removeProjectLayers(project.project_id);

  activeProjects.value = activeProjects.value.filter(
    (p) => p.project_id !== project.project_id,
  );
};

// Toggle project on map
const toggleProjectOnMap = (project: Project) => {
  if (activeProjectIds.value.has(project.project_id)) {
    removeProjectFromMap(project);
  } else {
    addProjectToMap(project);
  }
};

// Modal state
const isNewProjectModalOpen = ref(false);
const isDrawCardOpen = ref(false);
const isOltCardOpen = ref(false);
const oltCardMode = ref<"input" | "tower">("input");
const draftStore = useNewProjectDraft();

const openNewProjectModal = () => {
  draftStore.reset();
  isNewProjectModalOpen.value = true;
};

const closeNewProjectModal = () => {
  isNewProjectModalOpen.value = false;
};

const handleRequestDraw = () => {
  isNewProjectModalOpen.value = false;
  isDrawCardOpen.value = true;
};

const handleDrawDone = () => {
  isDrawCardOpen.value = false;
  isNewProjectModalOpen.value = true;
};

const handleRequestSelectOlt = (mode: "input" | "tower") => {
  oltCardMode.value = mode;
  isNewProjectModalOpen.value = false;
  isOltCardOpen.value = true;
};

const handleOltDone = () => {
  isOltCardOpen.value = false;
  isNewProjectModalOpen.value = true;
};

const handleProjectCreated = () => {
  draftStore.reset();
  fetchProjects();
};

const handleOpenGeoprocessing = () => {
  featureStore.setMapInfo("geoprocessing");
};

// === Edit Site Point Mode ===
const editingProjectId = ref<number | null>(null);
const movedSitePoints = ref<Map<number, [number, number]>>(new Map());
const isSavingEdits = ref(false);
const originalSitePointsData = ref<any>(null);

// Drag state
let editDragState = { isDragging: false, featureId: null as number | null };
let editDragHandlers: {
  onMouseDown: any;
  onMouseEnter: any;
  onMouseLeave: any;
} | null = null;

const enterEditMode = (projectId: number) => {
  if (editingProjectId.value) return;
  const map = mapStore.map;
  if (!map) return;

  editingProjectId.value = projectId;
  movedSitePoints.value = new Map();
  mapStore.setDrawMode(true);

  const layerId = `project-${projectId}-site-points-layer`;
  const source = map.getSource(layerId) as GeoJSONSource;
  if (!source) return;

  // Store original data for cancel
  const currentData = (source as any)._data;
  if (currentData) {
    originalSitePointsData.value = JSON.parse(JSON.stringify(currentData));
  }

  // Change style to indicate edit mode
  map.setPaintProperty(layerId, "circle-radius", 8);
  map.setPaintProperty(layerId, "circle-color", "#10B981");
  map.setPaintProperty(layerId, "circle-stroke-color", "#ffffff");

  // Setup drag handlers
  const onMouseDown = (e: any) => {
    e.preventDefault();
    const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });
    if (features.length === 0) return;

    const feature = features[0];
    editDragState = { isDragging: true, featureId: feature.id as number };
    map.getCanvas().style.cursor = "grabbing";

    const onMouseMove = (ev: any) => {
      if (!editDragState.isDragging) return;
      const coords: [number, number] = [ev.lngLat.lng, ev.lngLat.lat];

      // Update the feature coordinates in the source
      const src = map.getSource(layerId) as GeoJSONSource;
      if (src && originalSitePointsData.value) {
        // Get current working data from moved points + original
        const workingData = JSON.parse(
          JSON.stringify(originalSitePointsData.value),
        );
        // Apply all previous moves
        for (const feat of workingData.features) {
          const movedCoords = movedSitePoints.value.get(
            feat.id ?? feat.properties?.id,
          );
          if (movedCoords) {
            feat.geometry.coordinates = movedCoords;
          }
        }
        // Apply current drag
        for (const feat of workingData.features) {
          const fid = feat.id ?? feat.properties?.id;
          if (fid === editDragState.featureId) {
            feat.geometry.coordinates = coords;
            break;
          }
        }
        src.setData(workingData);
      }
    };

    const onMouseUp = (ev: any) => {
      if (!editDragState.isDragging) return;
      const coords: [number, number] = [ev.lngLat.lng, ev.lngLat.lat];
      if (editDragState.featureId !== null) {
        movedSitePoints.value.set(editDragState.featureId, coords);
        // Trigger reactivity
        movedSitePoints.value = new Map(movedSitePoints.value);
      }
      editDragState = { isDragging: false, featureId: null };
      map.getCanvas().style.cursor = "";
      map.off("mousemove", onMouseMove);
    };

    map.on("mousemove", onMouseMove);
    map.once("mouseup", onMouseUp);
  };

  const onMouseEnter = () => {
    if (!editDragState.isDragging) map.getCanvas().style.cursor = "grab";
  };
  const onMouseLeave = () => {
    if (!editDragState.isDragging) map.getCanvas().style.cursor = "";
  };

  map.on("mousedown", layerId, onMouseDown);
  map.on("mouseenter", layerId, onMouseEnter);
  map.on("mouseleave", layerId, onMouseLeave);

  editDragHandlers = { onMouseDown, onMouseEnter, onMouseLeave };

  toast.add({
    title: "Edit Mode",
    description: "Drag site points to move them",
    icon: "i-heroicons-pencil-square",
    ui: { background: "bg-white", title: "text-grey-800" },
  });
};

const exitEditMode = () => {
  const map = mapStore.map;
  if (!map || !editingProjectId.value) return;

  const layerId = `project-${editingProjectId.value}-site-points-layer`;

  // Remove drag handlers
  if (editDragHandlers) {
    map.off("mousedown", layerId, editDragHandlers.onMouseDown);
    map.off("mouseenter", layerId, editDragHandlers.onMouseEnter);
    map.off("mouseleave", layerId, editDragHandlers.onMouseLeave);
    editDragHandlers = null;
  }

  // Restore style
  if (map.getLayer(layerId)) {
    map.setPaintProperty(layerId, "circle-radius", 4);
    map.setPaintProperty(layerId, "circle-color", [
      "coalesce",
      ["get", "color"],
      "#3B82F6",
    ]);
    map.setPaintProperty(layerId, "circle-stroke-color", "#2563EB");
  }

  map.getCanvas().style.cursor = "";
  mapStore.setDrawMode(false);
  editingProjectId.value = null;
  movedSitePoints.value = new Map();
  originalSitePointsData.value = null;
};

const cancelEditMode = async () => {
  const map = mapStore.map;
  if (!map || !editingProjectId.value) return;

  const layerId = `project-${editingProjectId.value}-site-points-layer`;

  // Restore original data
  if (originalSitePointsData.value) {
    const source = map.getSource(layerId) as GeoJSONSource;
    if (source) {
      source.setData(originalSitePointsData.value);
    }
  }

  exitEditMode();
};

const saveEditedSitePoints = async () => {
  if (!editingProjectId.value || movedSitePoints.value.size === 0) return;

  isSavingEdits.value = true;
  const projectId = editingProjectId.value;
  const projectName =
    activeProjects.value.find((p) => p.project_id === projectId)
      ?.project_name || "";

  try {
    const promises = Array.from(movedSitePoints.value.entries()).map(
      ([id, coords]) =>
        $fetch(`/panel/data/move-site-point/${id}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
            "Content-Type": "application/json",
          },
          body: {
            geom: {
              type: "Point",
              coordinates: coords,
            },
          },
        }),
    );

    await Promise.all(promises);

    toast.add({
      title: "Saved",
      description: `${movedSitePoints.value.size} site point(s) updated`,
      icon: "i-heroicons-check-circle",
      color: "green",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    exitEditMode();

    // Refresh project layers
    removeProjectFromMap({ project_id: projectId, project_name: projectName });
    await addProjectToMap({ project_id: projectId, project_name: projectName });
  } catch (error) {
    console.error("Failed to save site points:", error);
    toast.add({
      title: "Error",
      description: "Failed to save site point changes",
      color: "red",
    });
  } finally {
    isSavingEdits.value = false;
  }
};

// === Edit Route Mode ===
const editingRouteProjectId = ref<number | null>(null);
const editingRouteId = ref<number | null>(null);
const isSavingRouteEdits = ref(false);
const isLoadingRoute = ref(false);
const routeMapDraw = ref<MapboxDraw | null>(null);
const newRouteGeometry = ref<GeoJSON.LineString | null>(null);
const originalLineCoords = ref<[number, number][]>([]);
let routeClickHandler: ((e: any) => void) | null = null;

// Custom MapboxDraw styles matching route style
const routeDrawStyles = [
  // Line style (active + inactive)
  {
    id: "gl-draw-line",
    type: "line",
    filter: ["all", ["==", "$type", "LineString"], ["!=", "mode", "static"]],
    paint: {
      "line-color": "#10B981",
      "line-width": 2,
      "line-opacity": 0.85,
    },
  },
  {
    id: "gl-draw-line-static",
    type: "line",
    filter: ["all", ["==", "$type", "LineString"], ["==", "mode", "static"]],
    paint: {
      "line-color": "#10B981",
      "line-width": 2,
      "line-opacity": 0.85,
    },
  },
  // Vertex points (draggable)
  {
    id: "gl-draw-point",
    type: "circle",
    filter: [
      "all",
      ["==", "$type", "Point"],
      ["==", "meta", "vertex"],
      ["!=", "mode", "static"],
    ],
    paint: {
      "circle-radius": 5,
      "circle-color": "#ffffff",
      "circle-stroke-color": "#10B981",
      "circle-stroke-width": 2,
    },
  },
  // Midpoints (click to add vertex)
  {
    id: "gl-draw-point-midpoint",
    type: "circle",
    filter: ["all", ["==", "$type", "Point"], ["==", "meta", "midpoint"]],
    paint: {
      "circle-radius": 3,
      "circle-color": "#10B981",
      "circle-stroke-color": "#ffffff",
      "circle-stroke-width": 1,
    },
  },
];

const handleRouteDrawUpdate = (e: any) => {
  const feature = e.features[0];
  if (!feature || feature.geometry.type !== "LineString") return;

  const coords = feature.geometry.coordinates;
  if (
    e.action === "change_coordinates" &&
    originalLineCoords.value.length > 0
  ) {
    coords[0] = originalLineCoords.value[0];
    coords[coords.length - 1] =
      originalLineCoords.value[originalLineCoords.value.length - 1];
    if (routeMapDraw.value) {
      routeMapDraw.value.add(feature);
    }
  }

  newRouteGeometry.value = feature.geometry as GeoJSON.LineString;
};

const startRouteDrawEdit = (map: MaplibreMap, geometry: GeoJSON.LineString) => {
  originalLineCoords.value = [...geometry.coordinates] as [number, number][];

  routeMapDraw.value = new MapboxDraw({
    displayControlsDefault: false,
    defaultMode: "simple_select",
    styles: routeDrawStyles,
  });

  map.addControl(routeMapDraw.value as any);

  const featureIds = routeMapDraw.value.add({
    type: "Feature",
    properties: {},
    geometry: geometry,
  });

  routeMapDraw.value.changeMode("direct_select", {
    featureId: featureIds[0],
  });

  map.on("draw.update", handleRouteDrawUpdate);
};

const hideLayerForEdit = (map: MaplibreMap, layerId: string) => {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", "none");
  }
};

const showLayerForEdit = (map: MaplibreMap, layerId: string) => {
  if (map.getLayer(layerId)) {
    map.setLayoutProperty(layerId, "visibility", "visible");
  }
};

const enterRouteEditMode = (projectId: number) => {
  if (editingRouteProjectId.value || editingProjectId.value) return;
  const map = mapStore.map as MaplibreMap;
  if (!map) return;

  editingRouteProjectId.value = projectId;
  mapStore.setDrawMode(true);

  const layerId = `project-${projectId}-routes-layer`;

  toast.add({
    title: "Edit Route",
    description: "Click on a route to edit its vertices",
    icon: "i-heroicons-pencil-square",
    ui: { background: "bg-white", title: "text-grey-800" },
  });

  routeClickHandler = async (e: any) => {
    const features = map.queryRenderedFeatures(e.point, { layers: [layerId] });
    if (features.length === 0) return;

    const feature = features[0];
    const routeId =
      feature.id ?? feature.properties?.id ?? feature.properties?.ogc_fid;
    console.log(routeId);
    if (!routeId) return;

    // Remove click handler after selection
    if (routeClickHandler) {
      map.off("click", layerId, routeClickHandler);
    }

    editingRouteId.value = routeId as number;
    isLoadingRoute.value = true;

    try {
      // Fetch full route data from API for accurate geometry
      const response = await $fetch<any>(
        `/panel/items/routes/${routeId}?fields=*`,
        {
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        },
      );

      const routeData = response.data;
      const geometry = extractGeometry(routeData.geom);

      if (!geometry || geometry.type !== "LineString") {
        toast.add({
          title: "Error",
          description: "Route geometry is not a valid LineString",
          color: "red",
        });
        exitRouteEditMode();
        return;
      }

      // Hide routes layer while editing (MapboxDraw shows the selected route)
      hideLayerForEdit(map, layerId);

      // Start MapboxDraw with full geometry from API
      startRouteDrawEdit(map, geometry as GeoJSON.LineString);

      toast.add({
        title: "Editing Route",
        description: "Drag vertices to edit. Start/end points are locked.",
        icon: "i-heroicons-pencil-square",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
    } catch (error) {
      console.error("Failed to fetch route data:", error);
      toast.add({
        title: "Error",
        description: "Could not load route data",
        color: "red",
      });
      exitRouteEditMode();
    } finally {
      isLoadingRoute.value = false;
    }
  };

  map.on("click", layerId, routeClickHandler);
};

const exitRouteEditMode = () => {
  const map = mapStore.map as MaplibreMap;
  if (!map) return;

  const projectId = editingRouteProjectId.value;

  // Remove click handler if still active
  if (routeClickHandler && projectId) {
    const layerId = `project-${projectId}-routes-layer`;
    map.off("click", layerId, routeClickHandler);
    routeClickHandler = null;
  }

  // Remove draw control
  if (routeMapDraw.value) {
    try {
      map.off("draw.update", handleRouteDrawUpdate);
      map.removeControl(routeMapDraw.value as any);
    } catch (e) {
      console.warn("Failed to remove draw control:", e);
    }
    routeMapDraw.value = null;
  }

  // Show routes layer again
  if (projectId) {
    showLayerForEdit(map, `project-${projectId}-routes-layer`);
  }

  map.getCanvas().style.cursor = "";
  mapStore.setDrawMode(false);
  editingRouteProjectId.value = null;
  editingRouteId.value = null;
  newRouteGeometry.value = null;
  originalLineCoords.value = [];
};

const cancelRouteEditMode = () => {
  exitRouteEditMode();
};

const saveEditedRoute = async () => {
  if (!editingRouteId.value || !newRouteGeometry.value) return;

  isSavingRouteEdits.value = true;
  const projectId = editingRouteProjectId.value;
  const projectName =
    activeProjects.value.find((p) => p.project_id === projectId)
      ?.project_name || "";

  try {
    await $fetch(`/panel/items/routes/${editingRouteId.value}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: {
        geom: geometryToFeature(newRouteGeometry.value),
      },
    });

    toast.add({
      title: "Saved",
      description: "Route updated successfully",
      icon: "i-heroicons-check-circle",
      color: "green",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    exitRouteEditMode();

    // Refresh project layers
    if (projectId) {
      removeProjectFromMap({
        project_id: projectId,
        project_name: projectName,
      });
      await addProjectToMap({
        project_id: projectId,
        project_name: projectName,
      });
    }
  } catch (error) {
    console.error("Failed to save route:", error);
    toast.add({
      title: "Error",
      description: "Failed to save route changes",
      color: "red",
    });
  } finally {
    isSavingRouteEdits.value = false;
  }
};

// Cleanup on unmount
onUnmounted(() => {
  if (editingProjectId.value) {
    exitEditMode();
  }
  if (editingRouteProjectId.value) {
    exitRouteEditMode();
  }
  if (mapStore.map) {
    for (const project of activeProjects.value) {
      for (const layer of project.layers) {
        if (layer.hasData) {
          if (mapStore.map.getLayer(layer.sourceId)) {
            mapStore.map.removeLayer(layer.sourceId);
          }
          if (mapStore.map.getSource(layer.sourceId)) {
            mapStore.map.removeSource(layer.sourceId);
          }
        }
      }
    }
  }
});
</script>

<template>
  <div class="p-3 space-y-1">
    <h2 class="text-md text-black">Project Management</h2>
    <p
      class="text-[10px] font-normal font-['Raleway'] leading-none text-grey-700"
    >
      Manage your FTTH mapping projects
    </p>
  </div>

  <div class="px-3">
    <UTabs
      v-model="selectedTab"
      :ui="{
        list: {
          tab: { rounded: 'rounded-xxs', base: 'rounded-xxs' },
          rounded: 'rounded-xxs',
          marker: { rounded: 'rounded-xxs' },
        },
      }"
      :items="tabItems"
    >
      <template #item="{ item }">
        <!-- Projects Tab -->
        <div
          v-if="item.key === 'projects'"
          class="flex flex-col flex-1 overflow-hidden min-h-0 h-[calc(100dvh-19rem)]"
        >
          <div>
            <UInput
              v-model="filterRef"
              :ui="{ rounded: 'rounded-xxs' }"
              placeholder="Search projects or provinces..."
            />
          </div>

          <div class="py-1 my-2 flex-1 overflow-y-auto hide-scrollbar">
            <!-- Loading state -->
            <div v-if="isLoading" class="text-center py-8">
              <UIcon
                name="i-heroicons-arrow-path"
                class="w-8 h-8 text-grey-400 mx-auto mb-2 animate-spin"
              />
              <p class="text-sm text-grey-500">Loading projects...</p>
            </div>

            <!-- Province list -->
            <template v-else>
              <div
                v-for="province in filteredProvinces"
                :key="province.province_ogc_fid"
                class="mb-2 border-[1px] rounded-xxs"
              >
                <div
                  class="p-2 cursor-pointer flex justify-between items-center text-black text-sm font-normal font-raleway"
                  @click="toggleProvince(province.province_ogc_fid)"
                >
                  <div class="flex items-center gap-2">
                    <UIcon
                      name="i-heroicons-map-pin"
                      class="w-4 h-4 text-blue-500"
                    />
                    <span class="text-normal text-xs">{{
                      province.province_name
                    }}</span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span
                      class="text-[10px] px-2 py-1 rounded-xxs bg-blue-100 text-blue-700"
                    >
                      {{ province.projects.length }} project{{
                        province.projects.length !== 1 ? "s" : ""
                      }}
                    </span>
                    <span
                      class="transition-transform duration-300 ease-in-out"
                      :class="{
                        'transform rotate-180': expandedProvinces.has(
                          province.province_ogc_fid,
                        ),
                      }"
                    >
                      <IcArrow class="rotate-90" />
                    </span>
                  </div>
                </div>
                <div
                  class="overflow-hidden transition-all duration-300 ease-in-out"
                  :class="{
                    'max-h-0': !expandedProvinces.has(
                      province.province_ogc_fid,
                    ),
                    'max-h-[500px] overflow-y-auto': expandedProvinces.has(
                      province.province_ogc_fid,
                    ),
                  }"
                >
                  <div class="p-2 pt-2 space-y-2 border-t">
                    <div
                      v-for="project in province.projects"
                      :key="project.project_id"
                      class="p-2 bg-grey-50 rounded-xxs hover:bg-grey-100 transition-colors"
                    >
                      <div class="flex items-center justify-between">
                        <div class="flex items-center gap-2">
                          <UIcon
                            name="i-heroicons-folder"
                            class="w-4 h-4 text-orange-500"
                          />
                          <span class="text-xs font-medium">{{
                            project.project_name
                          }}</span>
                        </div>
                        <div class="flex gap-1">
                          <UButton
                            size="xs"
                            :color="
                              activeProjectIds.has(project.project_id)
                                ? 'red'
                                : 'primary'
                            "
                            :variant="
                              activeProjectIds.has(project.project_id)
                                ? 'soft'
                                : 'soft'
                            "
                            :ui="{ rounded: 'rounded-xxs' }"
                            :loading="loadingProjectId === project.project_id"
                            @click="toggleProjectOnMap(project)"
                          >
                            {{
                              activeProjectIds.has(project.project_id)
                                ? "Remove"
                                : "Add To Map"
                            }}
                          </UButton>
                        </div>
                      </div>
                    </div>
                    <div
                      v-if="province.projects.length === 0"
                      class="text-center py-2"
                    >
                      <p class="text-xs text-grey-400">
                        No projects in this province
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div
                v-if="filteredProvinces.length === 0"
                class="text-center py-8"
              >
                <UIcon
                  name="i-heroicons-folder-open"
                  class="w-12 h-12 text-grey-300 mx-auto mb-2"
                />
                <p class="text-sm text-grey-500">No projects found</p>
              </div>
            </template>
          </div>

          <div class="border-t py-3">
            <UButton
              block
              color="primary"
              size="sm"
              :ui="{ rounded: 'rounded-xxs' }"
              @click="openNewProjectModal"
            >
              <UIcon name="i-heroicons-plus" class="w-4 h-4 mr-1" />
              New Project
            </UButton>
          </div>
        </div>

        <!-- Active Tab -->
        <div
          v-else-if="item.key === 'active'"
          class="flex flex-col flex-1 overflow-hidden min-h-0 h-[calc(100dvh-20rem)]"
        >
          <div class="py-1 my-3 flex-1 overflow-y-auto hide-scrollbar">
            <!-- Empty state -->
            <div v-if="activeProjects.length === 0" class="text-center py-8">
              <UIcon
                name="i-heroicons-map"
                class="w-12 h-12 text-grey-300 mx-auto mb-2"
              />
              <p class="text-sm text-grey-500">No active projects</p>
              <p class="text-xs text-grey-400 mt-1">
                Add projects from the Project tab
              </p>
            </div>

            <!-- Active project list -->
            <div
              v-for="activeProject in activeProjects"
              :key="activeProject.project_id"
              class="mb-2 border-[1px] rounded-xxs"
            >
              <!-- Project header -->
              <div class="p-2 flex justify-between items-center">
                <div
                  class="flex items-center gap-2 cursor-pointer flex-1"
                  @click="toggleActiveProjectExpand(activeProject.project_id)"
                >
                  <!-- <span
                    class="transition-transform duration-300 ease-in-out"
                    :class="{
                      'transform rotate-180': activeProject.expanded,
                    }"
                  >
                    <IcArrow class="rotate-90" />
                  </span> -->
                  <div>
                    <p class="text-xs font-medium text-black">
                      {{ activeProject.project_name }}
                    </p>
                    <!-- <p class="text-[10px] text-grey-500">
                      {{ activeProject.layers.filter((l) => l.hasData).length }}
                      layers
                    </p> -->
                  </div>
                </div>
                <div class="flex items-center gap-1.5">
                  <button
                    @click="openFtthAnalysis(activeProject.project_id)"
                    class="text-grey-700 hover:text-brand-500 transition-colors"
                    :class="{
                      'opacity-50 cursor-not-allowed':
                        loadingFtthId === activeProject.project_id,
                    }"
                    title="FTTH Analysis"
                    :disabled="loadingFtthId === activeProject.project_id"
                  >
                    <UIcon name="i-heroicons-map-pin" class="w-3.5 h-3.5" />
                  </button>
                  <button
                    @click="
                      editingProjectId === activeProject.project_id
                        ? cancelEditMode()
                        : enterEditMode(activeProject.project_id)
                    "
                    class="transition-colors"
                    :class="
                      editingProjectId === activeProject.project_id
                        ? 'text-brand-500 hover:text-brand-700'
                        : 'text-grey-700 hover:text-brand-500'
                    "
                    :disabled="
                      (editingProjectId !== null &&
                        editingProjectId !== activeProject.project_id) ||
                      editingRouteProjectId !== null
                    "
                    title="Edit Site Points"
                  >
                    <UIcon
                      name="i-heroicons-pencil-square"
                      class="w-3.5 h-3.5"
                    />
                  </button>
                  <button
                    @click="
                      editingRouteProjectId === activeProject.project_id
                        ? cancelRouteEditMode()
                        : enterRouteEditMode(activeProject.project_id)
                    "
                    class="transition-colors"
                    :class="
                      editingRouteProjectId === activeProject.project_id
                        ? 'text-brand-500 hover:text-brand-700'
                        : 'text-grey-700 hover:text-brand-500'
                    "
                    :disabled="
                      (editingRouteProjectId !== null &&
                        editingRouteProjectId !== activeProject.project_id) ||
                      editingProjectId !== null
                    "
                    title="Edit Routes"
                  >
                    <UIcon name="i-hugeicons:route-01" class="w-3.5 h-3.5" />
                  </button>
                  <button
                    @click="toggleAllProjectLayers(activeProject.project_id)"
                    class="text-grey-700 hover:text-brand-500 transition-colors"
                    title="Toggle all layers"
                  >
                    <IcEyeCrossed
                      v-if="
                        activeProject.layers
                          .filter((l) => l.hasData)
                          .every((l) => !l.visible)
                      "
                      class="w-3 h-3"
                      :fontControlled="false"
                    />
                    <IcEye v-else class="w-3 h-3" :fontControlled="false" />
                  </button>
                  <button
                    @click="
                      removeProjectFromMap({
                        project_id: activeProject.project_id,
                        project_name: activeProject.project_name,
                      })
                    "
                    class="text-red-500 hover:text-red-700 transition-colors"
                    title="Remove from map"
                  >
                    <UIcon name="i-heroicons-trash" class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <!-- Layer list (expanded) -->
              <div
                class="overflow-hidden transition-all duration-300 ease-in-out"
                :class="{
                  'max-h-0': !activeProject.expanded,
                  'max-h-[300px]': activeProject.expanded,
                }"
              >
                <div class="px-2 pb-2 space-y-1 border-t pt-2">
                  <template
                    v-for="layer in activeProject.layers"
                    :key="layer.key"
                  >
                    <div
                      v-if="layer.hasData"
                      class="flex items-center justify-between p-1.5 rounded-xxs hover:bg-grey-50 transition-colors"
                    >
                      <div class="flex items-center gap-2">
                        <span
                          class="text-xs"
                          :class="
                            layer.visible ? 'text-grey-700' : 'text-grey-400'
                          "
                        >
                          {{ layer.label }}
                        </span>
                      </div>
                      <button
                        @click="
                          toggleLayerVisibility(
                            activeProject.project_id,
                            layer.key,
                          )
                        "
                        class="text-grey-700 hover:text-brand-500 transition-colors"
                      >
                        <IcEyeCrossed
                          v-if="!layer.visible"
                          class="w-3 h-3"
                          :fontControlled="false"
                        />
                        <IcEye v-else class="w-3 h-3" :fontControlled="false" />
                      </button>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </UTabs>
  </div>

  <!-- Edit Site Points Card (floating on map, Tools Card style) -->
  <Teleport to="body">
    <TransitionRoot
      as="div"
      :show="!!editingProjectId"
      enter="transition-all duration-300"
      enter-from="-mb-10 opacity-0"
      enter-to="mb-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mb-0 opacity-1"
      leave-to="-mb-10 opacity-0"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] rounded-xs bg-white min-w-[20rem] max-w-[25rem] divide-y divide-grey-700"
    >
      <div class="flex items-center gap-[6px] p-2">
        <UIcon name="i-heroicons-pencil-square" class="w-3 h-3 text-grey-400" />
        <p class="flex-1 text-grey-800 text-2xs">Edit Site Points</p>
        <button @click="cancelEditMode">
          <IcCross class="w-2 h-2 text-grey-400 m-2" :fontControlled="false" />
        </button>
      </div>
      <div class="p-2 space-y-2">
        <p class="text-2xs text-grey-600">
          Drag site points to move them.
          <span
            v-if="movedSitePoints.size > 0"
            class="text-brand-500 font-semibold"
          >
            {{ movedSitePoints.size }} point(s) moved
          </span>
        </p>
        <div class="grid grid-cols-2 gap-2">
          <UButton
            variant="outline"
            color="gray"
            size="xs"
            block
            :ui="{ rounded: 'rounded-xxs' }"
            @click="cancelEditMode"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            size="xs"
            block
            :loading="isSavingEdits"
            :disabled="movedSitePoints.size === 0"
            :ui="{ rounded: 'rounded-xxs' }"
            @click="saveEditedSitePoints"
          >
            Save
          </UButton>
        </div>
      </div>
    </TransitionRoot>
  </Teleport>

  <!-- Edit Route Card (floating on map) -->
  <Teleport to="body">
    <TransitionRoot
      as="div"
      :show="!!editingRouteProjectId"
      enter="transition-all duration-300"
      enter-from="-mb-10 opacity-0"
      enter-to="mb-0 opacity-1"
      leave="transition-all duration-300"
      leave-from="mb-0 opacity-1"
      leave-to="-mb-10 opacity-0"
      class="fixed bottom-6 left-1/2 -translate-x-1/2 z-[9999] rounded-xs bg-white min-w-[20rem] max-w-[25rem] divide-y divide-grey-700"
    >
      <div class="flex items-center gap-[6px] p-2">
        <UIcon
          name="i-heroicons-arrows-pointing-out"
          class="w-3 h-3 text-grey-400"
        />
        <p class="flex-1 text-grey-800 text-2xs">Edit Route</p>
        <button @click="cancelRouteEditMode">
          <IcCross class="w-2 h-2 text-grey-400 m-2" :fontControlled="false" />
        </button>
      </div>
      <div class="p-2 space-y-2">
        <div v-if="isLoadingRoute" class="flex items-center gap-2 py-1">
          <div
            class="w-4 h-4 border-2 border-grey-200 border-t-brand-500 rounded-full animate-spin"
          ></div>
          <p class="text-2xs text-grey-600">Loading route...</p>
        </div>
        <p v-else-if="!editingRouteId" class="text-2xs text-grey-600">
          Click on a route on the map to start editing.
        </p>
        <p v-else class="text-2xs text-grey-600">
          Drag vertices to edit route path. Start/end points are locked.
          <span v-if="newRouteGeometry" class="text-brand-500 font-semibold">
            Route modified
          </span>
        </p>
        <div v-if="editingRouteId" class="grid grid-cols-2 gap-2">
          <UButton
            variant="outline"
            color="gray"
            size="xs"
            block
            :ui="{ rounded: 'rounded-xxs' }"
            @click="cancelRouteEditMode"
          >
            Cancel
          </UButton>
          <UButton
            color="primary"
            size="xs"
            block
            :loading="isSavingRouteEdits"
            :disabled="!newRouteGeometry"
            :ui="{ rounded: 'rounded-xxs' }"
            @click="saveEditedRoute"
          >
            Save
          </UButton>
        </div>
        <div v-else class="flex justify-end">
          <UButton
            variant="outline"
            color="gray"
            size="xs"
            :ui="{ rounded: 'rounded-xxs' }"
            @click="cancelRouteEditMode"
          >
            Cancel
          </UButton>
        </div>
      </div>
    </TransitionRoot>
  </Teleport>

  <!-- New Project Modal -->
  <UModal v-model="isNewProjectModalOpen" :ui="{ width: 'max-w-lg' }">
    <MapProjectNewProjectModal
      @close="closeNewProjectModal"
      @created="handleProjectCreated"
      @open-geoprocessing="handleOpenGeoprocessing"
      @request-draw="handleRequestDraw"
      @request-select-olt="handleRequestSelectOlt"
    />
  </UModal>

  <!-- Draw AOI Tool Card (teleported so it floats over the map, not inside the drawer) -->
  <Teleport to="body">
    <MapProjectDrawAoiToolCard
      :active="isDrawCardOpen"
      @save="handleDrawDone"
      @cancel="handleDrawDone"
    />
  </Teleport>

  <!-- OLT Start Point Tool Card (teleported so it floats over the map) -->
  <Teleport to="body">
    <MapProjectOltStartPointToolCard
      :active="isOltCardOpen"
      :mode="oltCardMode"
      @save="handleOltDone"
      @cancel="handleOltDone"
    />
  </Teleport>
</template>
