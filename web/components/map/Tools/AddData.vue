<script setup lang="ts">
import { ref, computed, watch } from "vue";
import IcHelp from "~/assets/icons/ic-info.svg";
import type { Feature, GeoJsonProperties, Geometry } from "geojson";
import IcRoute from "~/assets/icons/ic-route.svg";
import distance from "@turf/distance";
import nearestPoint from "@turf/nearest-point";
import length from "@turf/length";
import { point, featureCollection, lineString } from "@turf/helpers";

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();

// Local state
const latitude = ref<string>("");
const longitude = ref<string>("");
const generateRoute = ref<boolean>(false);
const isAddingData = ref<boolean>(false);
const pointsCount = ref<number>(0);
const routeGeometry = ref<any>(null);
const isGeneratingRoute = ref<boolean>(false);
const snapEnabled = ref<boolean>(true);
const snapThreshold = 0.05; // kilometers - distance threshold to snap to nearest point
const drawnPoints = ref<Array<[number, number]>>([]);
const selectedPoints = ref<
  Array<{ coordinates: [number, number]; id: string }>
>([]);
const lineLength = ref<string>("");

// Total points count (drawn + selected)
const totalPointsCount = computed(() => {
  return drawnPoints.value.length + selectedPoints.value.length;
});

// Enable Add Data button when coordinates or route are available
const canAddData = computed(() => {
  const hasPoint = latitude.value && longitude.value;
  const hasRoute = routeGeometry.value !== null;
  return (hasPoint || hasRoute) && !isAddingData.value;
});

// Can add more points
const canAddMorePoints = computed(() => {
  return totalPointsCount.value < 2;
});

// Get all drawn points as Turf.js points
const getAllDrawnPoints = () => {
  if (!drawerInstance) return [];

  const allFeatures = drawerInstance.getAll().features;
  return allFeatures.filter((f: any) => f.geometry.type === "Point");
};

// Snap a coordinate to the nearest point using Turf.js
const snapCoordinateToPoint = (coord: [number, number]): [number, number] => {
  if (!snapEnabled.value) return coord;

  const points = getAllDrawnPoints();
  if (points.length === 0) return coord;

  const targetPoint = point(coord);
  const pointsCollection = featureCollection(
    points.map((p: any) => point(p.geometry.coordinates))
  );

  const nearest = nearestPoint(targetPoint, pointsCollection);
  const dist = distance(targetPoint, nearest, { units: "kilometers" });

  // Only snap if within threshold
  if (dist <= snapThreshold) {
    return nearest.geometry.coordinates as [number, number];
  }

  return coord;
};

// Handle point creation from map
const handlePointCreated = (feature: Feature<Geometry, GeoJsonProperties>) => {
  if (feature.geometry.type === "Point") {
    // Check if we can add more points
    if (totalPointsCount.value >= 2) {
      toast.add({
        title: "Limit Reached",
        description:
          "You can only select 2 points. Remove existing points first.",
        color: "orange",
        icon: "i-heroicons-exclamation-triangle",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });
      // Remove the just-created point
      if (drawerInstance) {
        const allFeatures = drawerInstance.getAll().features;
        const lastPoint = allFeatures[allFeatures.length - 1];
        drawerInstance.delete(lastPoint.id);
      }
      return;
    }

    const coords = feature.geometry.coordinates as [number, number];
    longitude.value = coords[0].toFixed(6);
    latitude.value = coords[1].toFixed(6);

    // Track all drawn points
    drawnPoints.value.push(coords);
    pointsCount.value = drawnPoints.value.length;
  }
};

// Handle line/route creation from map with snapping
const handleLineCreated = (feature: Feature<Geometry, GeoJsonProperties>) => {
  if (feature.geometry.type === "LineString") {
    const originalCoords = feature.geometry.coordinates as Array<
      [number, number]
    >;

    // Apply snapping to each coordinate if enabled
    const snappedCoords = originalCoords.map((coord) =>
      snapCoordinateToPoint(coord)
    );

    // Update the geometry with snapped coordinates
    const snappedGeometry = {
      type: "LineString",
      coordinates: snappedCoords,
    };

    routeGeometry.value = snappedGeometry;

    // Calculate line length in meters
    const lineFeature = lineString(snappedCoords);
    const lengthInKm = length(lineFeature, { units: "kilometers" });
    const lengthInMeters = (lengthInKm * 1000).toFixed(2);
    lineLength.value = lengthInMeters;

    // Update the feature on the map if snapping occurred
    if (snapEnabled.value && drawerInstance) {
      const allFeatures = drawerInstance.getAll().features;
      const lineFeatures = allFeatures.filter(
        (f: any) => f.geometry.type === "LineString"
      );

      if (lineFeatures.length > 0) {
        const lineFeature = lineFeatures[lineFeatures.length - 1];
        lineFeature.geometry = snappedGeometry;
        drawerInstance.add(lineFeature);
      }
    }

    // Count how many coordinates were snapped
    const snappedCount = originalCoords.filter((original, idx) => {
      const snapped = snappedCoords[idx];
      return original[0] !== snapped[0] || original[1] !== snapped[1];
    }).length;

    toast.add({
      title: "Route Created",
      description:
        snappedCount > 0
          ? `Route with ${snappedCoords.length} points created (${snappedCount} snapped to existing points)`
          : `Route with ${snappedCoords.length} points created`,
      color: "blue",
      icon: "i-heroicons-map",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  }
};

// Initialize draw control for point mode
let drawerInstance: any = null;
const initDrawControl = (mode: string) => {
  if (drawerInstance && mapRefStore.map) {
    mapRefStore.map.removeControl(drawerInstance);
  }

  // Create new drawer with appropriate mode
  const { drawer } = useDrawControl({
    mode: mode,
    onCreated: mode === "draw_point" ? handlePointCreated : handleLineCreated,
  });

  drawerInstance = drawer;
  return drawer;
};

// Visual snap indicator
let snapMarker: any = null;
let snappingMouseMoveHandler: any = null;

// Selected points visualization
const selectedPointsSource = "selected-points-source";
const selectedPointsLayer = "selected-points-layer";

// Add selected points layer to map
const addSelectedPointsLayer = () => {
  if (!mapRefStore.map) return;

  // Remove existing layer if any
  if (mapRefStore.map.getLayer(selectedPointsLayer)) {
    mapRefStore.map.removeLayer(selectedPointsLayer);
  }
  if (mapRefStore.map.getSource(selectedPointsSource)) {
    mapRefStore.map.removeSource(selectedPointsSource);
  }

  // Add source
  mapRefStore.map.addSource(selectedPointsSource, {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: selectedPoints.value.map((pt) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: pt.coordinates,
        },
        properties: { id: pt.id },
      })),
    },
  });

  // Add layer with highlighting style
  mapRefStore.map.addLayer({
    id: selectedPointsLayer,
    type: "circle",
    source: selectedPointsSource,
    paint: {
      "circle-radius": 10,
      "circle-color": "#3b82f6",
      "circle-opacity": 0.8,
      "circle-stroke-width": 3,
      "circle-stroke-color": "#ffffff",
    },
  });
};

// Update selected points visualization
const updateSelectedPointsLayer = () => {
  if (!mapRefStore.map) return;

  const source = mapRefStore.map.getSource(selectedPointsSource) as any;
  if (source) {
    source.setData({
      type: "FeatureCollection",
      features: selectedPoints.value.map((pt) => ({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: pt.coordinates,
        },
        properties: { id: pt.id },
      })),
    });
  }
};

// Handle map click to select backbone points
const handleMapClick = (e: any) => {
  if (!mapRefStore.map || generateRoute.value || !canAddMorePoints.value)
    return;

  // Get all visible layers that match backbone
  const backboneLayers = mapRefStore.map
    .getStyle()
    .layers.filter((layer: any) => {
      console.log(layer, ">>>> Layer");
      // Find backbone layer - could be circle, line, or symbol
      return (
        layer["source-layer"]?.includes("backbone") &&
        layer.layout &&
        layer.layout.visibility !== "none"
      );
    })
    .map((layer: any) => layer.id);

  console.log(backboneLayers, "backbone layers");
  if (backboneLayers.length === 0) return;

  const features = mapRefStore.map.queryRenderedFeatures(e.point, {
    layers: backboneLayers,
  });

  if (features.length > 0) {
    const feature = features[0];

    // Only select point geometries
    if (feature.geometry.type === "Point") {
      const coords = feature.geometry.coordinates as [number, number];
      const featureId = feature.properties?.id || `selected-${Date.now()}`;

      // Check if already selected
      const alreadySelected = selectedPoints.value.some(
        (pt) => pt.id === featureId
      );

      if (alreadySelected) {
        toast.add({
          title: "Already Selected",
          description: "This point is already selected",
          color: "orange",
          icon: "i-heroicons-information-circle",
          ui: {
            background: "bg-white",
            title: "text-gray-900 text-md font-semibold",
            description: "text-gray-500",
            icon: "text-blue-500",
          },
        });
        return;
      }

      // Add to selected points
      selectedPoints.value.push({ coordinates: coords, id: featureId });
      updateSelectedPointsLayer();

      toast.add({
        title: "Point Selected",
        description: `Selected point from backbone layer (${totalPointsCount.value}/2)`,
        color: "blue",
        icon: "i-heroicons-map-pin",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });
    }
  }
};

const setupSnapIndicator = () => {
  if (!mapRefStore.map || !snapEnabled.value) return;

  // Create a marker for snap preview
  if (!snapMarker) {
    const el = document.createElement("div");
    el.className = "snap-marker";
    el.style.cssText = `
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background-color: #3b82f6;
      border: 3px solid white;
      box-shadow: 0 0 8px rgba(59, 130, 246, 0.6);
      display: none;
      pointer-events: none;
      position: absolute;
      z-index: 1000;
      transform: translate(-50%, -50%);
    `;

    document.body.appendChild(el);
    snapMarker = el;
  }

  // Mouse move handler for showing snap preview
  snappingMouseMoveHandler = (e: any) => {
    if (!generateRoute.value) return;

    const mouseCoord: [number, number] = [e.lngLat.lng, e.lngLat.lat];
    const snappedCoord = snapCoordinateToPoint(mouseCoord);

    if (
      snappedCoord[0] !== mouseCoord[0] ||
      snappedCoord[1] !== mouseCoord[1]
    ) {
      // Mouse is near a point, show snap indicator
      const pixel = mapRefStore.map!.project(snappedCoord);
      snapMarker.style.left = `${pixel.x}px`;
      snapMarker.style.top = `${pixel.y}px`;
      snapMarker.style.display = "block";
    } else {
      snapMarker.style.display = "none";
    }
  };

  mapRefStore.map.on("mousemove", snappingMouseMoveHandler);
};

const removeSnapIndicator = () => {
  if (mapRefStore.map && snappingMouseMoveHandler) {
    mapRefStore.map.off("mousemove", snappingMouseMoveHandler);
  }
  if (snapMarker) {
    snapMarker.style.display = "none";
  }
};

// Watch snapEnabled toggle
watch(snapEnabled, (newValue) => {
  if (newValue && generateRoute.value) {
    setupSnapIndicator();
  } else {
    removeSnapIndicator();
  }
});

// Watch generateRoute toggle to switch draw mode
watch(generateRoute, (newValue) => {
  const mode = newValue ? "draw_line_string" : "draw_point";

  // Save existing features before switching modes
  let existingFeatures: any[] = [];
  if (drawerInstance) {
    existingFeatures = drawerInstance.getAll().features;
  }

  // Remove existing drawer
  if (drawerInstance && mapRefStore.map) {
    mapRefStore.map.removeControl(drawerInstance);
  }

  // Reinitialize with new mode
  nextTick(() => {
    const { drawer } = useDrawControl({
      mode: mode,
      onCreated: mode === "draw_point" ? handlePointCreated : handleLineCreated,
    });

    drawerInstance = drawer;

    // Restore existing features after mode switch
    if (existingFeatures.length > 0) {
      existingFeatures.forEach((feature: any) => {
        if (drawerInstance) {
          drawerInstance.add(feature);
        }
      });
    }

    // Setup snap indicator when switching to line mode
    if (newValue && snapEnabled.value) {
      nextTick(() => {
        setupSnapIndicator();
      });
    } else {
      removeSnapIndicator();
    }

    // Reset route geometry when switching back to point mode
    if (!newValue) {
      routeGeometry.value = null;
    }
  });
});

// Change cursor on hover over backbone points
const handleMapMouseMove = (e: any) => {
  if (!mapRefStore.map || generateRoute.value || !canAddMorePoints.value)
    return;

  const backboneLayers = mapRefStore.map
    .getStyle()
    .layers.filter((layer: any) => {
      return (
        layer.id.includes("backbone") &&
        layer.layout &&
        layer.layout.visibility !== "none"
      );
    })
    .map((layer: any) => layer.id);

  if (backboneLayers.length === 0) return;

  const features = mapRefStore.map.queryRenderedFeatures(e.point, {
    layers: backboneLayers,
  });

  const canvas = mapRefStore.map.getCanvas();
  if (features.length > 0 && features[0].geometry.type === "Point") {
    canvas.style.cursor = "pointer";
  } else if (!mapRefStore.drawMode) {
    canvas.style.cursor = "";
  }
};

// Enable draw mode
onMounted(() => {
  mapRefStore.setDrawMode(true);
  initDrawControl("draw_point");

  // Add selected points layer and event handlers
  if (mapRefStore.map) {
    addSelectedPointsLayer();
    mapRefStore.map.on("click", handleMapClick);
    mapRefStore.map.on("mousemove", handleMapMouseMove);
  }
});

// Disable draw mode on unmount
onUnmounted(() => {
  mapRefStore.setDrawMode(false);
  if (drawerInstance && mapRefStore.map) {
    mapRefStore.map.removeControl(drawerInstance);
  }
  removeSnapIndicator();
  if (snapMarker && snapMarker.parentNode) {
    snapMarker.parentNode.removeChild(snapMarker);
    snapMarker = null;
  }

  // Remove selected points layer and event handlers
  if (mapRefStore.map) {
    mapRefStore.map.off("click", handleMapClick);
    mapRefStore.map.off("mousemove", handleMapMouseMove);
    if (mapRefStore.map.getLayer(selectedPointsLayer)) {
      mapRefStore.map.removeLayer(selectedPointsLayer);
    }
    if (mapRefStore.map.getSource(selectedPointsSource)) {
      mapRefStore.map.removeSource(selectedPointsSource);
    }
  }
});

// Auto-generate route functionality
const handleAutoGenerateRoute = async () => {
  if (totalPointsCount.value < 2) {
    toast.add({
      title: "Error",
      description: "Please add exactly 2 points to generate a route",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
    return;
  }

  if (totalPointsCount.value > 2) {
    toast.add({
      title: "Error",
      description: "Please select exactly 2 points only",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
    return;
  }

  try {
    isGeneratingRoute.value = true;

    // Combine drawn and selected points
    const allPoints = [
      ...drawnPoints.value,
      ...selectedPoints.value.map((pt) => pt.coordinates),
    ];

    console.log(allPoints);
    // TODO: Try routing API first (Mapbox Directions, OSRM, etc.)
    // If API fails, fall back to straight line
    let routeCoords = allPoints;

    // Uncomment when you have routing API
    try {
      const routingResponse = await $fetch<any>(
        "/panel/analysis/generate-route",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authStore.accessToken}`,
          },
          body: { profile: "driving-car", locations: allPoints },
        }
      );
      console.log(routingResponse, "routing response");
      routeCoords =
        routingResponse?.data?.geojson_route?.features[0]?.geometry.coordinates;
    } catch (error) {
      console.log("Routing API failed, using straight line");
    }

    routeGeometry.value = {
      type: "LineString",
      coordinates: routeCoords,
    };

    // Calculate line length in meters
    const lineFeature = lineString(routeCoords);
    const lengthInKm = length(lineFeature, { units: "kilometers" });
    const lengthInMeters = (lengthInKm * 1000).toFixed(2);
    lineLength.value = lengthInMeters;

    // Clear existing lines and draw the generated route
    if (drawerInstance) {
      const allFeatures = drawerInstance.getAll().features;
      const pointFeatures = allFeatures.filter(
        (f: any) => f.geometry.type === "Point"
      );

      drawerInstance.deleteAll();

      // Re-add points
      pointFeatures.forEach((pf: any) => drawerInstance.add(pf));

      // Add the generated route
      drawerInstance.add({
        type: "Feature",
        geometry: routeGeometry.value,
        properties: {},
      });
    }

    toast.add({
      title: "Route Generated",
      description: `Route created via routing API (${lengthInMeters}m)`,
      color: "green",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } catch (error) {
    console.error("Error generating route:", error);
    toast.add({
      title: "Error",
      description: "Failed to generate route. Please try again.",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isGeneratingRoute.value = false;
  }
};

// Reset functionality
const handleReset = () => {
  latitude.value = "";
  longitude.value = "";
  generateRoute.value = false;
  pointsCount.value = 0;
  routeGeometry.value = null;
  drawnPoints.value = [];
  selectedPoints.value = [];
  lineLength.value = "";

  // Clear all drawn features
  if (drawerInstance) {
    drawerInstance.deleteAll();
  }

  // Clear selected points visualization
  updateSelectedPointsLayer();
};

// Add data functionality
const handleAddData = async () => {
  // Get all drawn features
  let allFeatures: any[] = [];
  if (drawerInstance) {
    allFeatures = drawerInstance.getAll().features;
  }

  if (allFeatures.length === 0) {
    toast.add({
      title: "Error",
      description: "Please draw something on the map first",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
    return;
  }

  try {
    isAddingData.value = true;

    // Determine geometry based on what's drawn
    let geom;
    let dataType = "";

    // Check if we have a route (LineString)
    const lineFeatures = allFeatures.filter(
      (f: any) => f.geometry.type === "LineString"
    );
    if (lineFeatures.length > 0) {
      geom = lineFeatures[0].geometry;
      dataType = "Route";
    } else {
      // Use points - if multiple points, could be a MultiPoint or just the first point
      const pointFeatures = allFeatures.filter(
        (f: any) => f.geometry.type === "Point"
      );
      if (pointFeatures.length === 1) {
        geom = pointFeatures[0].geometry;
        dataType = "Point";
      } else if (pointFeatures.length > 1) {
        // Create a MultiPoint geometry
        geom = {
          type: "MultiPoint",
          coordinates: pointFeatures.map((f: any) => f.geometry.coordinates),
        };
        dataType = "Points";
      }
    }

    // TODO: Replace with your actual API endpoint
    const response = await $fetch("/panel/items/backbone", {
      method: "POST",
      body: JSON.stringify({
        geom,
        // Add other required fields here
      }),
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    toast.add({
      title: "Success",
      description: `${dataType} added successfully`,
      color: "green",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });

    handleReset();
  } catch (error) {
    console.error("Error adding data:", error);
    toast.add({
      title: "Error",
      description: "Failed to add data. Please try again.",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isAddingData.value = false;
  }
};
</script>

<template>
  <div class="p-2">
    <div class="flex items-center gap-3 mb-2">
      <p class="text-2xs text-[#626264]">
        <template v-if="!generateRoute">
          Draw new points or click existing backbone layer points. Limit: 2
          points.
        </template>
        <template v-else>
          <span v-if="totalPointsCount === 2">
            Click "Auto Generate Route" to create a route between your 2 points.
          </span>
          <span v-else>
            Select exactly 2 points first to generate a route.
          </span>
        </template>
      </p>
      <IcHelp class="w-3 h-3" :fontControlled="false" />
    </div>

    <!-- Point Count Indicators -->
    <div v-if="totalPointsCount > 0" class="mb-2 flex items-center gap-2">
      <div
        v-if="drawnPoints.length > 0"
        class="flex items-center gap-1.5 rounded-md py-1"
      >
        <span class="text-2xs font-medium text-green-600">
          {{ drawnPoints.length }} drawn
        </span>
      </div>
      <div
        v-if="selectedPoints.length > 0"
        class="flex items-center gap-1.5 rounded-md py-1"
      >
        <span class="text-2xs font-medium text-blue-600">
          {{ selectedPoints.length }} selected
        </span>
      </div>
      <div class="flex items-center gap-1.5 rounded-md py-1">
        <span class="text-2xs font-medium text-brand-600">
          Total: {{ totalPointsCount }}/2
        </span>
      </div>
    </div>

    <div class="grid grid-cols-2 gap-2 mb-3">
      <UInput
        v-model="latitude"
        variant="outline"
        size="xs"
        placeholder="Latitude"
        type="number"
        step="0.000001"
      >
        <template #trailing v-if="false">
          <span class="text-xs text-gray-500 dark:text-gray-400">Latitude</span>
        </template>
      </UInput>
      <UInput
        v-model="longitude"
        variant="outline"
        size="xs"
        placeholder="Longitude"
        type="number"
        step="0.000001"
      >
        <template #trailing v-if="false">
          <span class="text-xs text-gray-500 dark:text-gray-400"
            >Longitude</span
          >
        </template>
      </UInput>
    </div>

    <div class="flex items-center gap-2 mb-2">
      <UToggle v-model="generateRoute" />
      <p class="text-xs text-[#79797B]">Generate Route</p>
    </div>

    <!-- Auto Generate Route Button -->
    <div v-if="generateRoute" class="mb-2">
      <div class="space-y-2">
        <p class="text-2xs text-grey-500">
          Draw a line from one point to another to generate a route
        </p>
        <UInput v-model="lineLength" variant="outline" size="xs" block readonly>
          <template #trailing>
            <span class="text-2xs text-grey-500">m</span>
          </template>
        </UInput>
        <UDivider label="or" :ui="{ label: 'text-2xs text-grey-500' }" />
        <UButton
          variant="ghost"
          label="Auto Generate Route"
          block
          size="xs"
          :disabled="totalPointsCount !== 2 || isGeneratingRoute"
          :loading="isGeneratingRoute"
          @click="handleAutoGenerateRoute"
          :ui="{ rounded: 'rounded-xxs' }"
        >
          <template #leading>
            <IcRoute class="text-brand-500" />
          </template>
        </UButton>
      </div>
    </div>
  </div>

  <div class="grid grid-cols-2 p-2 gap-2">
    <UButton
      variant="outline"
      color="gray"
      label="Reset"
      block
      @click="handleReset"
      :ui="{ rounded: 'rounded-xxs' }"
    />
    <UButton
      variant="solid"
      color="brand"
      label="Add Data"
      block
      :disabled="!canAddData"
      :loading="isAddingData"
      @click="handleAddData"
      :ui="{ rounded: 'rounded-xxs' }"
    />
  </div>
</template>
