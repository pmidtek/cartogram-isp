<script setup lang="ts">
import { computed, ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { storeToRefs } from "pinia";
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";
import { showHighlightLayer } from "~/utils";
import bbox from "@turf/bbox";
import type { LngLatBoundsLike } from "maplibre-gl";

const featureStore = useFeature();
const { mapInfo, feature } = storeToRefs(featureStore);
const authStore = useAuth();
const toast = useToast();
const queryClient = useQueryClient();
const mapRefStore = useMapRef();

// Track which assets are expanded
const expandedAssets = ref<Set<number>>(new Set());

//Fiber Diagram
const isFiberDiagramModalOpen = ref(false);

// Generate Port Modal state
const isGeneratePortModalOpen = ref(false);
const selectedAssetId = ref<number | null>(null);

const selectedType = ref<string | null>(null);
//FiberDiagram cable
const selectedCableId = ref<number | null>(null);

// Assets Table Modal state
const isAssetsTableModalOpen = ref(false);

const toggleAssetExpand = (index: number) => {
  if (expandedAssets.value.has(index)) {
    expandedAssets.value.delete(index);
  } else {
    expandedAssets.value.add(index);
  }
};

// Check if we should show this drawer
const isEnabled = computed(() => {
  return (
    mapInfo.value === "detail-info" &&
    (feature.value?.tableName === "site_points" ||
      feature.value?.tableName === "assets") &&
    !!feature.value?.rowId
  );
});

// Determine if we're viewing site_points or assets
const isSitePoint = computed(() => feature.value?.tableName === "site_points");
const isAsset = computed(() => feature.value?.tableName === "assets");

// Fetch site point info using TanStack Query
const {
  data: sitePointData,
  isLoading: isSitePointLoading,
  isError: isSitePointError,
  error: sitePointError,
  isFetching: isSitePointFetching,
} = useQuery({
  queryKey: computed(() => [
    "/panel/data/site-point-info",
    feature.value?.rowId,
  ]),
  queryFn: async ({ queryKey }) => {
    const [baseUrl, rowId] = queryKey;
    const res = await $fetch<{ data: any }>(`${baseUrl}/${rowId}`, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    return res.data;
  },
  enabled: computed(() => isEnabled.value && isSitePoint.value),
});

// Fetch asset info using TanStack Query
const {
  data: assetData,
  isLoading: isAssetLoading,
  isError: isAssetError,
  error: assetError,
  isFetching: isAssetFetching,
} = useQuery({
  queryKey: computed(() => ["/panel/items/assets", feature.value?.rowId]),
  queryFn: async ({ queryKey }) => {
    const [baseUrl, rowId] = queryKey;
    const querystring = new URLSearchParams({
      fields: [
        "*",
        "user_created.first_name",
        "user_created.last_name",
        "user_updated.first_name",
        "user_updated.last_name",
        "asset_type_id.id",
        "asset_type_id.name",
        "site_point_id.id",
        "site_point_id.name",
        "site_point_id.code",
        "attachment.id",
        "attachment.label",
        "attachment.directus_files_id",
      ]!.join(","),
    });
    const res = await $fetch<{ data: any }>(
      `${baseUrl}/${rowId}?${querystring}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return res.data;
  },
  enabled: computed(() => isEnabled.value && isAsset.value),
});

// Unified loading/error states
const isLoading = computed(
  () => isSitePointLoading.value || isAssetLoading.value,
);
const isError = computed(() => isSitePointError.value || isAssetError.value);
const error = computed(() => sitePointError.value || assetError.value);
const isFetching = computed(
  () => isSitePointFetching.value || isAssetFetching.value,
);

// Computed counts
const assetsCount = computed(() => sitePointData.value?.assets?.length || 0);
const routesCount = computed(() => sitePointData.value?.routes?.length || 0);
const cablesCount = computed(() => sitePointData.value?.cables?.length || 0);

// Close drawer
const closeDrawer = () => {
  // Clear highlight layers
  const map = mapRefStore.map;
  if (map && map.getSource("highlight")) {
    const highlightSource = map.getSource("highlight") as any;
    highlightSource.setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  featureStore.setMapInfo("");
  featureStore.setFeature(undefined);
};

// Open Generate Port Modal
const openGeneratePortModal = (assetId: number) => {
  selectedAssetId.value = assetId;
  isGeneratePortModalOpen.value = true;
};

//open fiber diagram
const openFiberDiagram = (assetId: number, type: string) => {
  if (type === "assets") {
    selectedAssetId.value = assetId;
    selectedCableId.value = null; // Clear cable ID
    selectedType.value = "assets";
  } else {
    selectedCableId.value = assetId;
    selectedAssetId.value = null; // Clear asset ID
    selectedType.value = "cables";
  }
  isFiberDiagramModalOpen.value = true;
};

// Track tube generation loading state
const isGeneratingTube = ref(false);

const handleGenerate = async (type: string, id: number) => {
  // For ports, open the modal instead of direct API call
  if (type === "ports") {
    openGeneratePortModal(id);
    return;
  }

  // Handle other types (if any) with the old logic
  let payload;
  payload = { asset_id: id };

  try {
    const res = await $fetch(`/panel/transactions/generate-${type}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify(payload),
    });

    toast.add({
      title: `Generate ${type} successfully`,
      description: `${
        type.charAt(0).toUpperCase() + type.slice(1)
      } have been generated successfully`,
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } catch (error: any) {
    // Extract error message from various possible error structures
    const errorMessage =
      error?.data?.errors?.[0]?.message || // Directus error format
      error?.data?.message || // Standard API error
      error?.response?.data?.message || // Axios-style error
      error?.message || // Generic error
      "An error occurred while generating";

    toast.add({
      title: `Generate ${type} unsuccessfully`,
      description: errorMessage,
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  }
};

// Handle click on asset/cable/route card to highlight and zoom
const handleItemClick = async (
  item: any,
  type: "asset" | "cable" | "route",
) => {
  const map = mapRefStore.map;
  if (!map) return;

  try {
    let geom: any;
    let layerName: string;

    if (type === "asset") {
      // Assets use their parent site point geometry
      if (sitePointData.value?.geom) {
        geom = sitePointData.value.geom;
      } else {
        // Fallback: fetch site point geometry
        const response = await $fetch(
          `/panel/items/site_points/${sitePointData.value.id}?fields=geom`,
          {
            headers: {
              Authorization: `Bearer ${authStore.accessToken}`,
            },
          },
        );
        geom = (response as any).data.geom;
        console.log(geom, ">>>>>>>>site_points");
      }
      layerName = "site_points_circle_highlight";
    } else if (type === "cable") {
      // Fetch cable geometry
      const response = await $fetch(`/panel/data/cables/${item.id}`, {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      });
      geom = (response as any).data.geom;
      console.log(geom, ">>>>>>>>cables");
      layerName = "cables_line_highlight";
    } else if (type === "route") {
      // Fetch route geometry
      const response = await $fetch(
        `/panel/items/routes/${item.id}?fields=geom`,
        {
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        },
      );
      geom = (response as any).data.geom;
      console.log(geom, ">>>>>>>>routes");
      layerName = "routes_line_highlight";
    }

    if (!geom) {
      console.warn("No geometry found for", type, item.id);
      return;
    }

    // Highlight the feature
    showHighlightLayer(map, [{ geom }], layerName, false);
  } catch (error) {
    console.error("Error highlighting feature:", error);
    toast.add({
      title: "Error",
      description: "Failed to highlight feature on map",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
  }
};
</script>

<template>
  <div class="p-3 space-y-3">
    <!-- Header -->
    <div class="flex justify-between items-center">
      <div>
        <h2 class="text-grey-900 text-xs">
          {{ isSitePoint ? "Site Point" : "Asset" }} Detail Information
        </h2>
        <p class="text-[10px] font-raleway text-grey-600 text-xxs">
          {{
            isSitePoint
              ? "View detailed information about site point and related data"
              : "View detailed information about asset"
          }}
        </p>
      </div>
      <div class="flex items-center space-x-2">
        <UButton
          icon="i-heroicons-table-cells"
          size="xs"
          color="brand"
          variant="solid"
          @click="isAssetsTableModalOpen = true"
          :ui="{ rounded: 'rounded-xxs' }"
        >
          Table View
        </UButton>
        <IcArrowLeft
          role="button"
          @click="closeDrawer"
          :fontControlled="false"
          class="w-3 h-3 rotate-180 text-grey-900"
        />
      </div>
    </div>
    <div class="w-full h-[1px] bg-grey-300"></div>

    <!-- Loading State -->
    <div
      v-if="isLoading || isFetching"
      class="flex flex-col items-center justify-center py-8 space-y-2"
    >
      <div
        class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"
      ></div>
      <p class="text-xs text-grey-500">
        Loading {{ isSitePoint ? "site point" : "asset" }} information...
      </p>
    </div>

    <!-- Error State -->
    <div
      v-else-if="isError"
      class="flex flex-col items-center justify-center py-8 space-y-2"
    >
      <p class="text-xs text-red-500">
        Error loading {{ isSitePoint ? "site point" : "asset" }} information
      </p>
      <p class="text-2xs text-grey-500">{{ error?.message }}</p>
    </div>

    <!-- Site Point Content -->
    <template v-else-if="isSitePoint && sitePointData">
      <!-- All Content in Scrollable Area -->
      <div class="h-[calc(100dvh-17rem)] overflow-y-scroll space-y-3 pb-4">
        <!-- Main Accordion with 4 sections -->
        <UAccordion
          :multiple="true"
          :items="[
            {
              label: 'Site Information',
              icon: 'i-heroicons-map-pin',
              defaultOpen: true,
              slot: 'site-info',
            },
            {
              label: `Assets`,
              icon: 'i-heroicons-cube',
              defaultOpen: false,
              slot: 'assets',
            },
            {
              label: `Cables`,
              icon: 'i-heroicons-signal',
              defaultOpen: false,
              slot: 'cables',
            },
            {
              label: `Routes`,
              icon: 'i-heroicons-arrow-trending-up',
              defaultOpen: false,
              slot: 'routes',
            },
          ]"
          :ui="{
            wrapper: 'space-y-3',
            container: 'border rounded-xs',
          }"
        >
          <template #default="{ item, index, open }">
            <UButton
              color="gray"
              variant="ghost"
              class="hover:bg-transparent"
              :icon="item.icon"
              :ui="{ rounded: 'rounded-none', padding: { sm: 'p-3' } }"
            >
              <span class="truncate font-semibold">{{ item.label }}</span>

              <template #trailing>
                <UIcon
                  name="i-heroicons-chevron-right-20-solid"
                  class="w-5 h-5 ms-auto transform transition-transform duration-200"
                  :class="[open && 'rotate-90']"
                />
              </template>
            </UButton>
          </template>
          <!-- Site Info Slot -->
          <template #site-info>
            <div class="p-4 space-y-3 border-t">
              <!-- Main Attributes in 2 columns -->
              <div class="grid grid-cols-2 gap-3">
                <!-- Name -->
                <div class="space-y-1">
                  <p class="text-2xs text-grey-600">Name</p>
                  <p class="text-sm text-grey-900">
                    {{ sitePointData.name || "-" }}
                  </p>
                </div>

                <!-- Site Type -->
                <div v-if="sitePointData.site_point_type_id" class="space-y-1">
                  <p class="text-2xs text-grey-600">Site Type</p>
                  <p class="text-sm text-grey-900">
                    {{ sitePointData.site_point_type_id.name }}
                  </p>
                </div>

                <!-- Code -->
                <div class="space-y-1">
                  <p class="text-2xs text-grey-600">Code</p>
                  <p class="text-sm text-grey-900">
                    {{ sitePointData.code || "-" }}
                  </p>
                </div>

                <div class="space-y-1">
                  <p class="text-2xs text-grey-600">Stasiun Code</p>
                  <p class="text-sm text-grey-900">
                    {{ sitePointData.station_code || "-" }}
                  </p>
                </div>

                <!-- Owner -->
                <div v-if="sitePointData.owner" class="space-y-1">
                  <p class="text-2xs text-grey-600">Owner</p>
                  <p class="text-sm text-grey-900">
                    {{ sitePointData.owner || "-" }}
                  </p>
                </div>

                <!-- City -->
                <div v-if="sitePointData.area_city_id" class="space-y-1">
                  <p class="text-2xs text-grey-600">City</p>
                  <p class="text-sm text-grey-900">
                    {{ sitePointData.area_city_id.city }}
                  </p>
                </div>

                <!-- Province -->
                <div v-if="sitePointData.area_city_id" class="space-y-1">
                  <p class="text-2xs text-grey-600">Province</p>
                  <p class="text-sm text-grey-900">
                    {{ sitePointData.area_city_id.province }}
                  </p>
                </div>
              </div>

              <!-- Description (full width) -->
              <div v-if="sitePointData.description" class="space-y-1">
                <p class="text-2xs text-grey-600">Description</p>
                <p class="text-sm text-grey-900">
                  {{ sitePointData.description }}
                </p>
              </div>

              <!-- Other Attributes -->
              <template
                v-if="
                  sitePointData.other_attributes &&
                  sitePointData.other_attributes.length
                "
              >
                <UDivider
                  :ui="{ label: 'text-2xs' }"
                  label="Other Attributes"
                />
                <div
                  v-for="attr in sitePointData.other_attributes"
                  :key="attr.label"
                  class="space-y-1"
                >
                  <p class="text-2xs text-grey-600">{{ attr.label }}</p>
                  <p class="text-sm text-grey-900">{{ attr.value || "-" }}</p>
                </div>
              </template>
            </div>
          </template>

          <!-- Assets Slot -->
          <template #assets>
            <div v-if="!assetsCount" class="p-4 text-center">
              <p class="text-xs text-grey-500">
                No assets found for this site point
              </p>
            </div>
            <div v-else class="p-4 space-y-4 border-t">
              <div
                v-for="(asset, idx) in sitePointData.assets"
                :key="idx"
                class="p-2 border rounded-xxs border-grey-200 space-y-2 cursor-pointer hover:bg-gray-50 transition-colors"
                @click="handleItemClick(asset, 'asset')"
              >
                <div class="flex items-center justify-between">
                  <p class="text-sm font-medium text-grey-900">
                    {{ asset.name || `Asset #${idx + 1}` }}
                  </p>
                  <div class="flex gap-2" @click.stop>
                    <UButton
                      label="Fiber Diagram"
                      color="brand"
                      size="2xs"
                      @click="openFiberDiagram(asset.id, 'assets')"
                      :ui="{ rounded: 'rounded-xxs' }"
                    />
                    <UButton
                      v-if="asset.asset_type_id?.terminate_type === 'active'"
                      label="Generate Port"
                      color="brand"
                      size="2xs"
                      @click="handleGenerate('ports', asset.id)"
                      :ui="{ rounded: 'rounded-xxs' }"
                    />
                  </div>
                </div>

                <!-- Default visible properties -->
                <div class="space-y-1.5">
                  <div v-if="asset.code" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Code</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      asset.code
                    }}</span>
                  </div>
                  <div v-if="asset.asset_type_id" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Type</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      asset.asset_type_id.name
                    }}</span>
                  </div>
                  <div v-if="asset.tag_id" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Tag ID</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      asset.tag_id
                    }}</span>
                  </div>
                  <div v-if="asset.rfid" class="flex">
                    <span class="text-2xs text-grey-600 w-32">RFID</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      asset.rfid
                    }}</span>
                  </div>

                  <!-- Additional properties (shown when expanded) -->
                  <template v-if="expandedAssets.has(idx)">
                    <!-- Description -->
                    <div v-if="asset.description" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Description</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.description || "-"
                      }}</span>
                    </div>

                    <!-- Serial Number -->
                    <div v-if="asset.serial_number" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Serial Number</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.serial_number || "-"
                      }}</span>
                    </div>

                    <!-- Location Details -->
                    <div v-if="asset.location" class="flex">
                      <span class="text-2xs text-grey-600 w-32">Location</span>
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.location || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.location_detail" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Location Detail</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.location_detail || "-"
                      }}</span>
                    </div>

                    <!-- Port Information -->
                    <div v-if="asset.port" class="flex">
                      <span class="text-2xs text-grey-600 w-32">Port</span>
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.port || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.port_no" class="flex">
                      <span class="text-2xs text-grey-600 w-32">Port No</span>
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.port_no || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.port_fuction" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Port Function</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.port_fuction || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.port_type" class="flex">
                      <span class="text-2xs text-grey-600 w-32">Port Type</span>
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.port_type || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.port_speed" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Port Speed</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.port_speed || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.port_description" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Port Description</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.port_description || "-"
                      }}</span>
                    </div>

                    <!-- SFP Information -->
                    <div v-if="asset.sfp_model" class="flex">
                      <span class="text-2xs text-grey-600 w-32">SFP Model</span>
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.sfp_model || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.sfp_length" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >SFP Length</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.sfp_length || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.sfp_serial" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >SFP Serial</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.sfp_serial || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.opm_dbm" class="flex">
                      <span class="text-2xs text-grey-600 w-32">OPM dBm</span>
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.opm_dbm || "-"
                      }}</span>
                    </div>

                    <!-- Aggregation -->
                    <div v-if="asset.aggregation_code" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Aggregation Code</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.aggregation_code || "-"
                      }}</span>
                    </div>

                    <!-- Cable Information -->
                    <div v-if="asset.cable_net_length_m" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Cable Net Length (m)</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.cable_net_length_m || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.cable_gross_length_m" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Cable Gross Length (m)</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.cable_gross_length_m || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.cable_tube" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Cable Tube</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.cable_tube || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.cable_core" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Cable Core</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.cable_core || "-"
                      }}</span>
                    </div>

                    <!-- Dates -->
                    <div v-if="asset.date_of_purchase" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Purchase Date</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.date_of_purchase || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.date_of_install" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Install Date</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.date_of_install || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.date_of_service" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Service Date</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.date_of_service || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.date_of_warranty_expiration" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Warranty Expiry</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.date_of_warranty_expiration || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.date_of_last_inspection" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Last Inspection</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.date_of_last_inspection || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.last_inspected_by" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Inspected By</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.last_inspected_by || "-"
                      }}</span>
                    </div>
                    <div
                      v-if="asset.date_of_maintenance_expiration"
                      class="flex"
                    >
                      <span class="text-2xs text-grey-600 w-32"
                        >Maintenance Expiry</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.date_of_maintenance_expiration || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.maintenance_by" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Maintained By</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.maintenance_by || "-"
                      }}</span>
                    </div>

                    <!-- Service Log -->
                    <div v-if="asset.service_log_ticket_number" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Service Ticket</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.service_log_ticket_number || "-"
                      }}</span>
                    </div>

                    <!-- Insurance -->
                    <div v-if="asset.insurance_expiration_date" class="flex">
                      <span class="text-2xs text-grey-600 w-32"
                        >Insurance Expiry</span
                      >
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.insurance_expiration_date || "-"
                      }}</span>
                    </div>
                    <div v-if="asset.insurer" class="flex">
                      <span class="text-2xs text-grey-600 w-32">Insurer</span>
                      <span class="text-2xs text-grey-900 flex-1">{{
                        asset.insurer || "-"
                      }}</span>
                    </div>

                    <!-- Other Attributes -->
                    <template
                      v-if="
                        asset.other_attributes && asset.other_attributes.length
                      "
                    >
                      <div class="col-span-2 pt-2">
                        <p class="text-2xs font-semibold text-grey-700 mb-1.5">
                          Other Attributes
                        </p>
                      </div>
                      <div
                        v-for="(attr, attrIdx) in asset.other_attributes"
                        :key="attrIdx"
                        class="flex"
                      >
                        <span class="text-2xs text-grey-600 w-32">{{
                          attr.label
                        }}</span>
                        <span class="text-2xs text-grey-900 flex-1">{{
                          attr.value || "-"
                        }}</span>
                      </div>
                    </template>
                  </template>
                </div>

                <!-- Expand/Collapse Button -->
                <UButton
                  :label="expandedAssets.has(idx) ? 'Show Less' : 'Show More'"
                  size="2xs"
                  color="gray"
                  variant="ghost"
                  block
                  @click.stop="toggleAssetExpand(idx)"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
              </div>
            </div>
          </template>

          <!-- Cables Slot -->
          <template #cables>
            <div v-if="!cablesCount" class="p-4 text-center">
              <p class="text-xs text-grey-500">
                No cables found for this site point
              </p>
            </div>
            <div v-else class="p-4 space-y-4 border-t">
              <div
                v-for="(cable, idx) in sitePointData.cables"
                :key="idx"
                class="p-2 border rounded-xxs border-grey-200 space-y-2 cursor-pointer hover:bg-gray-50 transition-colors"
                @click="handleItemClick(cable, 'cable')"
              >
                <div class="flex items-center justify-between">
                  <p class="text-xs font-medium text-grey-900">
                    {{ cable.name || `Cable #${idx + 1}` }}
                  </p>
                  <UButton
                    label="Fiber Diagram"
                    color="brand"
                    size="2xs"
                    :loading="isGeneratingTube"
                    :disabled="isGeneratingTube"
                    @click.stop="openFiberDiagram(cable.id, 'cables')"
                    :ui="{ rounded: 'rounded-xxs' }"
                  />
                </div>
                <div class="space-y-1.5">
                  <div v-if="cable.code" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Code</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      cable.code
                    }}</span>
                  </div>
                  <div v-if="cable.cable_type_id" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Type</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      cable.cable_type_id.name
                    }}</span>
                  </div>

                  <!-- Site From -->
                  <div v-if="cable.site_from" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Site From</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      typeof cable.site_from === "object"
                        ? cable.site_from.name ||
                          cable.site_from.code ||
                          cable.site_from
                        : cable.site_from
                    }}</span>
                  </div>

                  <!-- Site To -->
                  <div v-if="cable.site_to" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Site To</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      typeof cable.site_to === "object"
                        ? cable.site_to.name ||
                          cable.site_to.code ||
                          cable.site_to
                        : cable.site_to
                    }}</span>
                  </div>

                  <div v-if="cable.description" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Description</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      cable.description
                    }}</span>
                  </div>

                  <!-- Other Attributes -->
                  <template
                    v-if="
                      cable.other_attributes && cable.other_attributes.length
                    "
                  >
                    <div class="pt-2">
                      <p class="text-2xs font-semibold text-grey-700 mb-1.5">
                        Other Attributes
                      </p>
                    </div>
                    <div
                      v-for="(attr, attrIdx) in cable.other_attributes"
                      :key="attrIdx"
                      class="flex"
                    >
                      <span class="text-2xs text-grey-600 w-32">{{
                        attr.label
                      }}</span>
                      <span class="text-2xs text-grey-900 flex-1">{{
                        attr.value || "-"
                      }}</span>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </template>

          <!-- Routes Slot -->
          <template #routes>
            <div v-if="!routesCount" class="p-4 text-center">
              <p class="text-xs text-grey-500">
                No routes found for this site point
              </p>
            </div>
            <div v-else class="p-4 space-y-4 border-t">
              <div
                v-for="(route, idx) in sitePointData.routes"
                :key="idx"
                class="p-2 border rounded-xxs border-grey-200 space-y-2 cursor-pointer hover:bg-gray-50 transition-colors"
                @click="handleItemClick(route, 'route')"
              >
                <p class="text-xs font-medium text-grey-900">
                  {{ route.name || `Route #${idx + 1}` }}
                </p>
                <div class="space-y-1.5">
                  <div v-if="route.code" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Code</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      route.code
                    }}</span>
                  </div>
                  <div v-if="route.route_type_id" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Type</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      route.route_type_id.name
                    }}</span>
                  </div>
                  <div v-if="route.description" class="flex">
                    <span class="text-2xs text-grey-600 w-32">Description</span>
                    <span class="text-2xs text-grey-900 flex-1">{{
                      route.description
                    }}</span>
                  </div>

                  <!-- Other Attributes -->
                  <template
                    v-if="
                      route.other_attributes && route.other_attributes.length
                    "
                  >
                    <div class="pt-2">
                      <p class="text-2xs font-semibold text-grey-700 mb-1.5">
                        Other Attributes
                      </p>
                    </div>
                    <div
                      v-for="(attr, attrIdx) in route.other_attributes"
                      :key="attrIdx"
                      class="flex"
                    >
                      <span class="text-2xs text-grey-600 w-32">{{
                        attr.label
                      }}</span>
                      <span class="text-2xs text-grey-900 flex-1">{{
                        attr.value || "-"
                      }}</span>
                    </div>
                  </template>
                </div>
              </div>
            </div>
          </template>
        </UAccordion>
      </div>
    </template>

    <!-- Asset Content -->
    <template v-else-if="isAsset && assetData">
      <!-- All Content in Scrollable Area -->
      <div class="h-[calc(100dvh-17rem)] overflow-y-scroll pb-4">
        <!-- Single Card Container -->
        <div class="border rounded-xs">
          <div class="p-4 space-y-3">
            <!-- Basic Information -->
            <div class="grid grid-cols-2 gap-3">
              <!-- Name -->
              <div class="space-y-1">
                <p class="text-2xs text-grey-600">Name</p>
                <p class="text-sm text-grey-900">
                  {{ assetData.name || "-" }}
                </p>
              </div>

              <!-- Code -->
              <div class="space-y-1">
                <p class="text-2xs text-grey-600">Code</p>
                <p class="text-sm text-grey-900">
                  {{ assetData.code || "-" }}
                </p>
              </div>

              <!-- Asset Type -->
              <div class="space-y-1">
                <p class="text-2xs text-grey-600">Asset Type</p>
                <p class="text-sm text-grey-900">
                  {{ assetData.asset_type_id?.name || "-" }}
                </p>
              </div>

              <!-- Tag ID -->
              <div class="space-y-1">
                <p class="text-2xs text-grey-600">Tag ID</p>
                <p class="text-sm text-grey-900">
                  {{ assetData.tag_id || "-" }}
                </p>
              </div>

              <!-- RFID -->
              <div class="space-y-1">
                <p class="text-2xs text-grey-600">RFID</p>
                <p class="text-sm text-grey-900">
                  {{ assetData.rfid || "-" }}
                </p>
              </div>

              <!-- Site Point -->
              <div v-if="assetData.site_point_id" class="space-y-1">
                <p class="text-2xs text-grey-600">Site Point</p>
                <p class="text-sm text-grey-900">
                  {{
                    assetData.site_point_id.name ||
                    assetData.site_point_id.code ||
                    "-"
                  }}
                </p>
              </div>

              <!-- Location -->
              <div v-if="assetData.location" class="col-span-2 space-y-1">
                <p class="text-2xs text-grey-600">Location</p>
                <p class="text-sm text-grey-900">
                  {{ assetData.location }}
                </p>
              </div>

              <!-- Description -->
              <div v-if="assetData.description" class="col-span-2 space-y-1">
                <p class="text-2xs text-grey-600">Description</p>
                <p class="text-sm text-grey-900">
                  {{ assetData.description }}
                </p>
              </div>
            </div>

            <!-- Serial Number & Other Details -->
            <template
              v-if="assetData.serial_number || assetData.location_detail"
            >
              <UDivider
                :ui="{ label: 'text-2xs' }"
                label="Additional Details"
              />
              <div class="grid grid-cols-2 gap-3">
                <!-- Serial Number -->
                <div v-if="assetData.serial_number" class="space-y-1">
                  <p class="text-2xs text-grey-600">Serial Number</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.serial_number }}
                  </p>
                </div>

                <!-- Location Detail -->
                <div
                  v-if="assetData.location_detail"
                  class="space-y-1"
                  :class="{ 'col-span-2': !assetData.serial_number }"
                >
                  <p class="text-2xs text-grey-600">Location Detail</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.location_detail }}
                  </p>
                </div>
              </div>
            </template>

            <!-- Ports Information -->
            <template v-if="assetData.ports && assetData.ports.length">
              <UDivider
                :ui="{ label: 'text-2xs' }"
                :label="`Ports (${assetData.ports.length})`"
              />
              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                  <p class="text-2xs text-grey-600">Total Ports</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.ports.length }}
                  </p>
                </div>
              </div>
            </template>

            <!-- Dates Section -->
            <template
              v-if="
                assetData.date_of_purchase ||
                assetData.date_of_install ||
                assetData.date_of_service ||
                assetData.date_of_warranty_expiration ||
                assetData.date_of_last_inspection
              "
            >
              <UDivider :ui="{ label: 'text-2xs' }" label="Dates" />
              <div class="grid grid-cols-2 gap-3">
                <!-- Purchase Date -->
                <div v-if="assetData.date_of_purchase" class="space-y-1">
                  <p class="text-2xs text-grey-600">Purchase Date</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.date_of_purchase }}
                  </p>
                </div>

                <!-- Installation Date -->
                <div v-if="assetData.date_of_install" class="space-y-1">
                  <p class="text-2xs text-grey-600">Installation Date</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.date_of_install }}
                  </p>
                </div>

                <!-- Service Date -->
                <div v-if="assetData.date_of_service" class="space-y-1">
                  <p class="text-2xs text-grey-600">Service Date</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.date_of_service }}
                  </p>
                </div>

                <!-- Warranty Expiry -->
                <div
                  v-if="assetData.date_of_warranty_expiration"
                  class="space-y-1"
                >
                  <p class="text-2xs text-grey-600">Warranty Expiry Date</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.date_of_warranty_expiration }}
                  </p>
                </div>

                <!-- Last Inspection -->
                <div v-if="assetData.date_of_last_inspection" class="space-y-1">
                  <p class="text-2xs text-grey-600">Last Inspection Date</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.date_of_last_inspection }}
                  </p>
                </div>

                <!-- Last Inspected By -->
                <div v-if="assetData.last_inspected_by" class="space-y-1">
                  <p class="text-2xs text-grey-600">Last Inspected By</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.last_inspected_by }}
                  </p>
                </div>

                <!-- Maintenance Expiry -->
                <div
                  v-if="assetData.date_of_maintenance_expiration"
                  class="space-y-1"
                >
                  <p class="text-2xs text-grey-600">Maintenance Expiry Date</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.date_of_maintenance_expiration }}
                  </p>
                </div>

                <!-- Maintained By -->
                <div v-if="assetData.maintenance_by" class="space-y-1">
                  <p class="text-2xs text-grey-600">Maintained By</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.maintenance_by }}
                  </p>
                </div>
              </div>
            </template>

            <!-- Service Log -->
            <template v-if="assetData.service_log_ticket_number">
              <UDivider :ui="{ label: 'text-2xs' }" label="Service Log" />
              <div class="grid grid-cols-2 gap-3">
                <div class="space-y-1">
                  <p class="text-2xs text-grey-600">Service Ticket Number</p>
                  <p class="text-sm text-grey-900">
                    {{ assetData.service_log_ticket_number }}
                  </p>
                </div>
              </div>
            </template>

            <!-- Other Attributes -->
            <template
              v-if="
                assetData.other_attributes && assetData.other_attributes.length
              "
            >
              <UDivider :ui="{ label: 'text-2xs' }" label="Other Attributes" />
              <div class="space-y-2">
                <div
                  v-for="(attr, idx) in assetData.other_attributes"
                  :key="idx"
                  class="grid grid-cols-2 gap-3"
                >
                  <div class="space-y-1">
                    <p class="text-2xs text-grey-600">{{ attr.label }}</p>
                    <p class="text-sm text-grey-900">{{ attr.value || "-" }}</p>
                  </div>
                </div>
              </div>
            </template>

            <!-- Timestamps -->
            <template v-if="assetData.date_created || assetData.date_updated">
              <UDivider :ui="{ label: 'text-2xs' }" label="Timestamps" />
              <div class="grid grid-cols-2 gap-3">
                <!-- Date Created -->
                <div v-if="assetData.date_created" class="space-y-1">
                  <p class="text-2xs text-grey-600">Date Created</p>
                  <p class="text-sm text-grey-900">
                    {{
                      new Date(assetData.date_created).toLocaleString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    }}
                  </p>
                </div>

                <!-- Date Updated -->
                <div v-if="assetData.date_updated" class="space-y-1">
                  <p class="text-2xs text-grey-600">Date Updated</p>
                  <p class="text-sm text-grey-900">
                    {{
                      new Date(assetData.date_updated).toLocaleString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })
                    }}
                  </p>
                </div>
              </div>
            </template>

            <!-- Attachments Section -->
            <template
              v-if="assetData.attachment && assetData.attachment.length"
            >
              <UDivider :ui="{ label: 'text-2xs' }" :label="`Attachments`" />
              <div class="space-y-2">
                <div
                  v-for="(attachment, idx) in assetData.attachment"
                  :key="idx"
                  class="p-3 border rounded-xxs border-grey-200 space-y-2"
                >
                  <p class="text-sm font-medium text-grey-900">
                    {{ attachment.label || `Attachment ${idx + 1}` }}
                  </p>
                  <div class="flex items-center justify-between">
                    <span class="text-2xs text-grey-600">File ID:</span>
                    <span class="text-2xs text-grey-900">{{
                      attachment.directus_files_id
                    }}</span>
                  </div>
                  <a
                    :href="`/panel/assets/${attachment.directus_files_id}`"
                    target="_blank"
                    rel="noopener noreferrer"
                    class="block"
                  >
                    <UButton
                      label="View File"
                      icon="i-heroicons-arrow-down-tray"
                      size="xs"
                      :ui="{ rounded: 'rounded-xxs' }"
                      block
                    />
                  </a>
                </div>
              </div>
            </template>

            <!-- User Information -->
            <template
              v-if="
                assetData.user_created?.first_name ||
                assetData.user_updated?.first_name
              "
            >
              <UDivider :ui="{ label: 'text-2xs' }" label="User Information" />
              <div class="grid grid-cols-2 gap-3">
                <!-- Created By -->
                <div
                  v-if="assetData.user_created?.first_name"
                  class="space-y-1"
                >
                  <p class="text-2xs text-grey-600">Created By</p>
                  <p class="text-sm text-grey-900">
                    {{
                      `${assetData.user_created.first_name} ${assetData.user_created.last_name}`
                    }}
                  </p>
                </div>

                <!-- Updated By -->
                <div
                  v-if="assetData.user_updated?.first_name"
                  class="space-y-1"
                >
                  <p class="text-2xs text-grey-600">Updated By</p>
                  <p class="text-sm text-grey-900">
                    {{
                      `${assetData.user_updated.first_name} ${assetData.user_updated.last_name}`
                    }}
                  </p>
                </div>
              </div>
            </template>
          </div>
        </div>
      </div>
    </template>

    <!-- Generate Port Modal -->
    <MapToolsGeneratePortModal
      v-model="isGeneratePortModalOpen"
      :asset-id="selectedAssetId || 0"
    />

    <MapToolsFiberDiagram
      v-model="isFiberDiagramModalOpen"
      :asset-id="selectedAssetId || selectedCableId || 0"
      :type="selectedType"
    />

    <!-- Assets Table Modal -->
    <MapDetailInfoAssetsTableModal v-model="isAssetsTableModalOpen" />
  </div>
</template>
