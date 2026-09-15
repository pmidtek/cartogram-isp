<script lang="ts" setup>
const analysisStore = useAnalysisResult();
const mapStore = useMapRef();

const summary = computed(() => analysisStore.ftthAnalysisData?.summary || {});
const layerData = computed(() => analysisStore.ftthAnalysisData?.layer || {});
const projectId = computed(() => analysisStore.ftthAnalysisProjectId);
const projectName = computed(() => analysisStore.ftthAnalysisProjectName);

const cableSpecNumber = computed(() => {
  const spec = summary.value.cable_spec || "";
  return spec.replace(/\s*core\s*/i, "");
});

const cableLengthKm = computed(() => {
  const lengthM = summary.value.cable_length_m || 0;
  return (lengthM / 1000).toFixed(1);
});

interface LayerDefinition {
  key: string;
  label: string;
  color: string | null;
  icon: string | null;
  count: number | string;
  mapLayerId: string;
  filterProperty: string | null;
  filterValue: number | null;
}

const layerDefinitions = computed<LayerDefinition[]>(() => {
  const prefix = `project-${projectId.value}`;
  const defs: LayerDefinition[] = [];

  // Assets from API response
  const assets = layerData.value.assets || [];

  // Site points (OLT from summary, icon from assets)
  const oltAsset = assets.find((a: any) => a.asset_type_name === "OLT");
  defs.push({
    key: "site-points",
    label: "OLT",
    color: "#FF6B35",
    icon: oltAsset?.icon || null,
    count: summary.value.total_olt ?? "-",
    mapLayerId: `${prefix}-site-points-layer`,
    filterProperty: null,
    filterValue: null,
  });
  for (const asset of assets.filter((a: any) => a.asset_type_name !== "OLT")) {
    defs.push({
      key: `asset-${asset.asset_type_id}`,
      label: asset.asset_type_name,
      color: null,
      icon: asset.icon || null,
      count: asset.count ?? "-",
      mapLayerId: `${prefix}-assets-layer`,
      filterProperty: "asset_type_id",
      filterValue: asset.asset_type_id,
    });
  }

  // Routes from API response
  const routes = layerData.value.routes || [];
  for (const route of routes) {
    defs.push({
      key: `route-${route.route_type_id}`,
      label: route.route_type_name,
      color: route.color || "#10B981",
      icon: null,
      count: route.count ?? "-",
      mapLayerId: `${prefix}-routes-layer`,
      filterProperty: "route_type_id",
      filterValue: route.route_type_id,
    });
  }

  // Cables from API response
  const cables = layerData.value.cables || [];
  for (const cable of cables) {
    defs.push({
      key: `cable-${cable.cable_type_id}`,
      label: cable.cable_type_name,
      color: cable.color || "#EF4444",
      icon: null,
      count: cable.count ?? "-",
      mapLayerId: `${prefix}-cables-layer`,
      filterProperty: "cable_type_id",
      filterValue: cable.cable_type_id,
    });
  }

  return defs;
});

// Footprint layer toggle
const FOOTPRINT_LAYER_ID = "sp_data_footprint_fill";
const footprintVisible = ref(true);

function toggleFootprint() {
  footprintVisible.value = !footprintVisible.value;
  const map = mapStore.map;
  if (!map || !map.getLayer(FOOTPRINT_LAYER_ID)) return;
  map.setLayoutProperty(
    FOOTPRINT_LAYER_ID,
    "visibility",
    footprintVisible.value ? "visible" : "none",
  );
}

// Layer visibility state - all ON by default
const layerVisibility = ref<Record<string, boolean>>({});

// Initialize visibility for all layers
watch(
  layerDefinitions,
  (defs) => {
    defs.forEach((def) => {
      if (!(def.key in layerVisibility.value)) {
        layerVisibility.value[def.key] = true;
      }
    });
  },
  { immediate: true },
);

function toggleLayer(def: LayerDefinition) {
  layerVisibility.value[def.key] = !layerVisibility.value[def.key];
  applyFilters();
}

function applyFilters() {
  const map = mapStore.map;
  if (!map) return;

  // Group layers by mapLayerId to apply combined filters
  const layerGroups: Record<
    string,
    {
      filterProperty: string | null;
      items: { filterValue: number | null; visible: boolean }[];
    }
  > = {};

  layerDefinitions.value.forEach((def) => {
    if (!layerGroups[def.mapLayerId]) {
      layerGroups[def.mapLayerId] = {
        filterProperty: def.filterProperty,
        items: [],
      };
    }
    layerGroups[def.mapLayerId].items.push({
      filterValue: def.filterValue,
      visible: layerVisibility.value[def.key] ?? true,
    });
  });

  Object.entries(layerGroups).forEach(([layerId, group]) => {
    if (!map.getLayer(layerId)) return;

    // Simple visibility toggle (no sub-type filtering, e.g. site-points, cables)
    if (
      !group.filterProperty ||
      group.items.every((i) => i.filterValue === null)
    ) {
      const anyVisible = group.items.some((i) => i.visible);
      map.setLayoutProperty(
        layerId,
        "visibility",
        anyVisible ? "visible" : "none",
      );
      return;
    }

    // Filter-based toggle for grouped layers (assets, routes)
    const enabledIds = group.items
      .filter((i) => i.visible && i.filterValue !== null)
      .map((i) => i.filterValue!);

    if (enabledIds.length === 0) {
      map.setLayoutProperty(layerId, "visibility", "none");
    } else {
      map.setLayoutProperty(layerId, "visibility", "visible");
      if (
        enabledIds.length ===
        group.items.filter((i) => i.filterValue !== null).length
      ) {
        // All types visible - remove filter
        map.setFilter(layerId, null);
      } else {
        map.setFilter(layerId, [
          "in",
          ["get", group.filterProperty],
          ["literal", enabledIds],
        ]);
      }
    }
  });
}

onUnmounted(() => {
  // Reset filters on all project layers
  const map = mapStore.map;
  if (map && projectId.value) {
    const prefix = `project-${projectId.value}`;
    const layerIds = [
      `${prefix}-site-points-layer`,
      `${prefix}-assets-layer`,
      `${prefix}-asset-spiders-layer`,
      `${prefix}-routes-layer`,
      `${prefix}-cables-layer`,
    ];

    layerIds.forEach((layerId) => {
      if (map.getLayer(layerId)) {
        map.setFilter(layerId, null);
        map.setLayoutProperty(layerId, "visibility", "visible");
      }
    });
  }

  // Only clear if not transitioning to BOQ/BOM (so user can navigate back)
  // if (analysisStore.currentAnalysisType === "ftth_analysis") {
  //   analysisStore.clearFtthAnalysisData();
  //   analysisStore.clearCurrentAnalysisType();
  // }
  // When going to boq_bom_analysis, keep ftthAnalysisData so user can go back
});
</script>

<template>
  <div class="space-y-3 mt-3">
    <!-- Network Summary Section -->
    <div class="space-y-2">
      <!-- Row 1: Total Homes | Cable Type -->
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-brand-50 rounded-xxs p-3 text-center">
          <p class="text-[12px] uppercase text-grey-600 font-semibold">
            Total Homes
          </p>
          <p class="text-xl font-bold text-[#1a237e]">
            {{ summary.total_ont?.toLocaleString() || "0" }}
          </p>
        </div>
        <div class="bg-brand-50 rounded-xxs p-3 text-center">
          <p class="text-[12px] uppercase text-grey-600 font-semibold">
            Cable Type
          </p>
          <div class="flex items-center justify-center gap-2">
            <p class="text-xl font-bold text-[#1a237e]">
              {{ cableSpecNumber || "0" }}
            </p>
            <p class="text-[12px] text-grey-500 font-semibold">core</p>
          </div>
        </div>
      </div>

      <!-- Row 2: Total ODC | Total ODP -->
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-brand-50 rounded-xxs p-3 text-center">
          <p class="text-[12px] uppercase text-grey-600 font-semibold">
            Total ODC
          </p>
          <p class="text-xl font-bold text-[#1a237e]">
            {{ summary.total_odc?.toLocaleString() || "0" }}
          </p>
        </div>
        <div class="bg-brand-50 rounded-xxs p-3 text-center">
          <p class="text-[12px] uppercase text-grey-600 font-semibold">
            Total ODP
          </p>
          <p class="text-xl font-bold text-[#1a237e]">
            {{ summary.total_odp?.toLocaleString() || "0" }}
          </p>
        </div>
      </div>

      <!-- Row 3: Total ONT | Total Pole -->
      <div class="grid grid-cols-2 gap-2">
        <div class="bg-brand-50 rounded-xxs p-3 text-center">
          <p class="text-[12px] uppercase text-grey-600 font-semibold">
            Total ONT
          </p>
          <p class="text-xl font-bold text-[#1a237e]">
            {{ summary.total_ont?.toLocaleString() || "0" }}
          </p>
        </div>
        <div class="bg-brand-50 rounded-xxs p-3 text-center">
          <p class="text-[12px] uppercase text-grey-600 font-semibold">
            Total Pole
          </p>
          <p class="text-xl font-bold text-[#1a237e]">
            {{ summary.total_pole?.toLocaleString() || "0" }}
          </p>
        </div>
      </div>

      <!-- Row 4: Total Cable Length (full width) -->
      <div class="bg-brand-50 rounded-xxs p-3 text-center">
        <p class="text-[12px] uppercase text-grey-600 font-semibold">
          Total Cable Length
        </p>
        <p class="text-xl font-bold text-[#1a237e]">
          {{ cableLengthKm }}
          <span class="text-sm text-grey-500 font-semibold">km</span>
        </p>
      </div>

      <!-- Cable Group Detail -->
      <div v-if="summary.cable_group?.length" class="space-y-1">
        <p class="text-[11px] uppercase text-grey-500 font-semibold pt-1">
          Cable Detail
        </p>
        <div
          v-for="(cg, idx) in summary.cable_group"
          :key="idx"
          class="bg-brand-50 rounded-xxs px-3 py-2 flex items-center justify-between gap-2"
        >
          <div class="min-w-0">
            <p class="text-[11px] font-semibold text-grey-700 truncate">
              {{ cg.cable_type_name }}
            </p>
            <p class="text-[10px] text-grey-500">{{ cg.cable_group_id }}</p>
          </div>
          <div class="flex items-center gap-3 flex-shrink-0">
            <div class="text-right">
              <p class="text-xs font-bold text-[#1a237e]">
                {{ (cg.length_m / 1000).toFixed(2) }}
              </p>
              <p class="text-[10px] text-grey-500">km</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Layers Section -->
    <div>
      <p class="text-sm font-semibold text-grey-900 py-1">Layers</p>
      <div class="space-y-1">
        <!-- Footprint layer toggle -->
        <div
          class="flex items-center justify-between p-2 rounded-xxs hover:bg-grey-50 transition-colors"
        >
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <span
              class="w-3 h-3 rounded-sm flex-shrink-0"
              :style="{ backgroundColor: '#7C3AED' }"
            />
            <span class="text-xs text-grey-700 truncate">Footprint</span>
          </div>
          <div class="flex items-center gap-3">
            <UToggle
              :model-value="footprintVisible"
              @update:model-value="toggleFootprint()"
              size="xs"
            />
          </div>
        </div>

        <div
          v-for="def in layerDefinitions"
          :key="def.key"
          class="flex items-center justify-between p-2 rounded-xxs hover:bg-grey-50 transition-colors"
        >
          <div class="flex items-center gap-2 flex-1 min-w-0">
            <img
              v-if="def.icon"
              :src="`/panel/assets/${def.icon}`"
              class="w-7 h-7 flex-shrink-0 object-contain"
            />
            <span
              v-else
              class="w-3 h-3 rounded-sm flex-shrink-0"
              :style="{ backgroundColor: def.color || '#9E9E9E' }"
            />
            <span class="text-xs text-grey-700 truncate">
              {{ def.label }}
            </span>
          </div>
          <div class="flex items-center gap-3">
            <span
              class="text-xs text-grey-500 bg-brand-50 rounded-xxs px-2 py-0.5 min-w-[3rem] text-center"
            >
              {{ def.count }}
            </span>
            <UToggle
              :model-value="layerVisibility[def.key] ?? true"
              @update:model-value="toggleLayer(def)"
              size="xs"
            />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
