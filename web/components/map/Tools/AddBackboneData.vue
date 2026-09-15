<script setup lang="ts">
import { ref, computed } from "vue";
import IcHelp from "~/assets/icons/ic-info.svg";
import type { Feature, GeoJsonProperties, Geometry } from "geojson";

const mapRefStore = useMapRef();
const authStore = useAuth();
const toast = useToast();
const featureStore = useFeature();
const toolsStore = useMapTools();
const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);
const layerStore = useMapLayer();
const { fetchActiveLayers } = layerStore;

const sitePointTypes = ref<any>();
const sitePointTypesRaw = ref<any[]>([]);

// Tower owner options - fetched from API
const towerOwners = ref<Array<{ label: string; value: string }>>([]);

// True when the selected site type has sub_column_name === 'owner'
const selectedTypeHasOwner = computed(() => {
  const raw = sitePointTypesRaw.value.find(
    (t) => String(t.id) === selectedSiteType.value,
  );
  return raw?.sub_column_name === "owner";
});

//get SetPoint type
const fetchSitePointType = async () => {
  const res = await $fetch<any>(
    "/panel/items/site_point_types?filter[is_added_asset][_eq]=true",
    {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    },
  );

  if (currentModule.value?.slug === "fwa-access") {
    sitePointTypes.value = [
      {
        label: "Tower",
        value: "3",
      },
    ];
  } else {
    sitePointTypesRaw.value = res.data;
    sitePointTypes.value = res.data.map((i: any) => ({
      label: i.name,
      value: i.id,
    }));
  }
};
// Fetch tower owners from API
const fetchTowerOwners = async () => {
  try {
    const response: { data: Array<{ id: string; name: string }> } =
      await $fetch("/panel/items/owners?sort=name", {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      });

    towerOwners.value = response.data.map((owner) => ({
      label: owner.name,
      value: owner.name,
    }));
  } catch (error) {
    console.error("Error fetching tower owners:", error);
    toast.add({
      title: "Warning",
      description: "Failed to load tower owners",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  }
};

// Local state
const latitude = ref<string>("");
const longitude = ref<string>("");
const selectedSiteType = ref<string>(
  currentModule.value?.slug === "fwa-access" ? "3" : "2",
); // Tower for FWA, Backhaul for Backbone/Backhaul
const selectedTowerOwner = ref<string>(""); // For tower site type
const isAddingData = ref<boolean>(false);
const pointsCount = ref<number>(0);
const drawnPoints = ref<
  Array<{
    coords: [number, number];
    siteType: string;
    siteTypeName: string;
    owner?: string;
  }>
>([]);

// Enable Add Data button when we have at least one point
const canAddData = computed(() => {
  return pointsCount.value > 0 && !isAddingData.value;
});

// Handle point creation from map
const handlePointCreated = (feature: Feature<Geometry, GeoJsonProperties>) => {
  if (feature.geometry.type === "Point") {
    const coords = feature.geometry.coordinates as [number, number];
    const siteTypeName =
      sitePointTypes.value.find((t) => t.value === selectedSiteType.value)
        ?.label || "Unknown";

    // Validate owner if selected type requires it
    if (selectedTypeHasOwner.value && !selectedTowerOwner.value) {
      toast.add({
        title: "Owner Required",
        description: "Please select an owner before adding this point.",
        icon: "i-heroicons-exclamation-triangle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
      // Remove the drawn point
      if (drawerInstance) {
        drawerInstance.deleteAll();
        setTimeout(() => {
          drawerInstance.changeMode("draw_point");
        }, 0);
      }
      return;
    }

    // Add point to the list
    const point: {
      coords: [number, number];
      siteType: string;
      siteTypeName: string;
      owner?: string;
    } = {
      coords,
      siteType: selectedSiteType.value,
      siteTypeName,
    };

    // Add owner if selected type requires it
    if (selectedTypeHasOwner.value) {
      point.owner = selectedTowerOwner.value;
    }

    drawnPoints.value.push(point);
    pointsCount.value = drawnPoints.value.length;

    // Update coordinate inputs to show last added point
    longitude.value = coords[0].toFixed(6);
    latitude.value = coords[1].toFixed(6);

    // Keep draw mode active so user can add more points
    if (drawerInstance) {
      setTimeout(() => {
        drawerInstance.changeMode("draw_point");
      }, 0);
    }
  }
};

// Initialize draw control for point mode
let drawerInstance: any = null;
const initDrawControl = () => {
  // Avoid manual removeControl here; cleanup is handled inside useDrawControl

  const { drawer } = useDrawControl({
    mode: "draw_point",
    onCreated: handlePointCreated,
  });

  drawerInstance = drawer;
  return drawer;
};

// Function to add point from coordinates
const addPointFromCoordinates = () => {
  if (!latitude.value || !longitude.value || !drawerInstance) return;

  const latNum = parseFloat(latitude.value);
  const lngNum = parseFloat(longitude.value);

  if (isNaN(latNum) || isNaN(lngNum)) return;

  // Validate owner if selected type requires it
  if (selectedTypeHasOwner.value && !selectedTowerOwner.value) {
    toast.add({
      title: "Owner Required",
      description: "Please select an owner before adding this point.",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  // Check if this coordinate already exists
  const exists = drawnPoints.value.some(
    (p) => p.coords[0] === lngNum && p.coords[1] === latNum,
  );
  if (exists) {
    toast.add({
      title: "Duplicate Point",
      description: "This coordinate has already been added.",
      icon: "i-heroicons-exclamation-triangle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  // Add point programmatically
  const pointFeature = {
    type: "Feature" as const,
    geometry: {
      type: "Point" as const,
      coordinates: [lngNum, latNum],
    },
    properties: {},
  };

  drawerInstance.add(pointFeature);

  const siteTypeName =
    sitePointTypes.value.find((t) => t.value === selectedSiteType.value)
      ?.label || "Unknown";

  const point: {
    coords: [number, number];
    siteType: string;
    siteTypeName: string;
    owner?: string;
  } = {
    coords: [lngNum, latNum],
    siteType: selectedSiteType.value,
    siteTypeName,
  };

  // Add owner if selected type requires it
  if (selectedTypeHasOwner.value) {
    point.owner = selectedTowerOwner.value;
  }

  drawnPoints.value.push(point);
  pointsCount.value = drawnPoints.value.length;

  // Fly to the new point
  if (mapRefStore.map) {
    mapRefStore.map.flyTo({
      center: [lngNum, latNum],
      zoom: Math.max(mapRefStore.map.getZoom(), 15),
      duration: 1000,
    });
  }

  toast.add({
    title: "Point Added",
    description: `${siteTypeName} point added. Total: ${pointsCount.value} points.`,
    color: "green",
    icon: "i-heroicons-map-pin",
    ui: { background: "bg-white", title: "text-grey-800" },
  });
};

// Enable draw mode and fetch tower owners
onMounted(() => {
  mapRefStore.setDrawMode(true);
  initDrawControl();
  fetchTowerOwners();
  fetchSitePointType();
});

// Disable draw mode on unmount
onUnmounted(() => {
  mapRefStore.setDrawMode(false);
  // Do not call removeControl here to avoid double cleanup; composable handles it
});

// Remove a specific point
const removePoint = (index: number) => {
  const pointToRemove = drawnPoints.value[index];

  // Remove from drawn points array
  drawnPoints.value.splice(index, 1);
  pointsCount.value = drawnPoints.value.length;

  // Remove from map
  if (drawerInstance) {
    const allFeatures = drawerInstance.getAll();
    const featureToDelete = allFeatures.features.find((f: any) => {
      if (f.geometry.type === "Point") {
        const coords = f.geometry.coordinates as [number, number];
        return (
          coords[0] === pointToRemove.coords[0] &&
          coords[1] === pointToRemove.coords[1]
        );
      }
      return false;
    });
    if (featureToDelete) {
      drawerInstance.delete(featureToDelete.id);
    }
  }

  toast.add({
    title: "Point Removed",
    description: `${pointToRemove.siteTypeName} point removed.`,
    color: "red",
    icon: "i-heroicons-trash",
    ui: { background: "bg-white", title: "text-grey-800" },
  });
};

// Reset functionality
const handleReset = () => {
  latitude.value = "";
  longitude.value = "";
  pointsCount.value = 0;
  drawnPoints.value = [];

  if (drawerInstance) {
    drawerInstance.deleteAll();
  }

  if (featureStore.newFeatureGeometry) {
    featureStore.clearNewFeatureGeometry();
  }
};

// Add data functionality - hit API to create site points
const handleAddData = async () => {
  if (pointsCount.value === 0) {
    toast.add({
      title: "Error",
      description: "Please add at least one point",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  isAddingData.value = true;

  try {
    // Prepare request body - array of site points
    const body = drawnPoints.value.map((point) => {
      const payload: {
        site_point_type_id: number;
        geom: {
          type: "Point";
          coordinates: [number, number];
        };
        owner?: string;
      } = {
        site_point_type_id: parseInt(point.siteType), // Convert string to number
        geom: {
          type: "Point",
          coordinates: point.coords,
        },
      };

      // Add owner if the point has one
      if (point.owner) {
        payload.owner = point.owner;
      }

      return payload;
    });

    // Hit the API
    await $fetch("/panel/data/site_points", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body,
    });

    toast.add({
      title: "Success",
      description: `Successfully added ${pointsCount.value} site point${
        pointsCount.value > 1 ? "s" : ""
      }`,
      icon: "i-heroicons-check-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });

    // Reset the form
    handleReset();

    // Remove site_points layers and refetch to show new data
    try {
      const map = mapRefStore.map;
      if (map) {
        const style = map.getStyle();
        const allLayers: any[] = style?.layers || [];

        // Filter for site_points layers (since we're adding site points)
        const sitePointLayers = allLayers.filter((ly: any) =>
          ly["source-layer"]?.includes("site_points"),
        );

        // Remove layers first
        sitePointLayers.forEach((ly: any) => {
          if (map.getLayer(ly.id)) map.removeLayer(ly.id);
        });

        // Extract unique source IDs and remove sources
        const sourceIds = Array.from(
          new Set(
            sitePointLayers
              .map((ly: any) => ly.source)
              .filter((s: any) => typeof s === "string"),
          ),
        );

        sourceIds.forEach((srcId) => {
          if (map.getSource(srcId)) {
            try {
              map.removeSource(srcId);
            } catch (e) {
              console.warn("Failed to remove source", srcId, e);
            }
          }
        });
      }
    } catch (e) {
      console.warn("Failed to remove site point layers:", e);
    }

    // Refetch active layers to reload with new data
    try {
      await fetchActiveLayers(currentModule.value?.slug);
    } catch (e) {
      console.warn("Failed to refetch active layers:", e);
    }
  } catch (error: any) {
    console.error("Error adding site points:", error);
    toast.add({
      title: "Error",
      description: error?.data?.message || "Failed to add site points",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
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
        Click on the map or enter coordinates to add multiple site points.
      </p>
    </div>

    <!-- Point Status Indicator -->
    <div v-if="pointsCount > 0">
      <div class="flex items-center gap-1.5 rounded-md px-2 py-1.5">
        <span class="text-2xs font-medium text-brand-500">
          {{ pointsCount }} Point{{ pointsCount > 1 ? "s" : "" }} added
        </span>
      </div>
    </div>

    <!-- Site Type Selection -->
    <div class="mb-1">
      <label class="text-2xs text-[#626264] mb-1 block">Site Type</label>
      <USelect
        v-model="selectedSiteType"
        :options="sitePointTypes"
        option-attribute="label"
        value-attribute="value"
        variant="outline"
        size="2xs"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Owner Selection (only when selected type has sub_column_name === 'owner') -->
    <div v-if="selectedTypeHasOwner">
      <label class="text-2xs text-[#626264] mb-1 block"
        >Owner <span class="text-red-500">*</span></label
      >
      <USelect
        v-model="selectedTowerOwner"
        :options="towerOwners"
        option-attribute="label"
        value-attribute="value"
        size="2xs"
        placeholder="Select tower owner"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Manual Coordinate Input -->
    <div class="space-y-2">
      <label class="text-2xs text-[#626264]">Manual Coordinates</label>
      <div class="grid grid-cols-2 gap-2">
        <UInput
          v-model="latitude"
          variant="outline"
          size="2xs"
          placeholder="Latitude"
          type="number"
          step="0.000001"
        />
        <UInput
          v-model="longitude"
          variant="outline"
          size="2xs"
          placeholder="Longitude"
          type="number"
          step="0.000001"
        />
      </div>
      <UButton
        variant="outline"
        color="gray"
        label="Add Point"
        block
        size="xs"
        :disabled="!latitude || !longitude"
        @click="addPointFromCoordinates"
        :ui="{ rounded: 'rounded-xxs' }"
      />
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

  <div>
    <!-- Upload Section -->
    <div class="px-2 pb-2">
      <label class="text-2xs text-[#626264] mb-2 mt-2 block"
        >Bulk Upload Site Points</label
      >
      <MapToolsUploadData taskType="import_site_point" />
    </div>
  </div>
  <!-- <UDivider label="OR" /> -->
</template>
