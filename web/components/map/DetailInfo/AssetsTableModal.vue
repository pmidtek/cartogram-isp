<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useQuery } from "@tanstack/vue-query";

// Props
const props = defineProps<{
  modelValue: boolean;
}>();

// Emits
const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

// Stores
const authStore = useAuth();

// Local state for modal
const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

// Tab state
const activeTab = ref(0);
const tabItems = [
  {
    key: "assets",
    label: "Assets",
    icon: "i-heroicons-server-stack",
  },
  {
    key: "cables",
    label: "Cables",
    icon: "i-heroicons-cable",
  },
];

// Pagination state
const currentPage = ref(1);
const pageSize = ref(20);
const pageSizeOptions = [
  { label: "20", value: 20 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
];

// Filter state
const filters = ref({
  sitePointName: "",
  assetType: "",
  assetName: "",
  assetCode: "",
  portType: "",
  portStatus: "",
});

// Debounced search values
const debouncedSitePointName = ref("");
const debouncedAssetName = ref("");
const debouncedAssetCode = ref("");

// Debounce timer
let searchDebounceTimer: NodeJS.Timeout | null = null;

// Watch for search input changes with debounce
watch(
  () => filters.value.sitePointName,
  (newValue) => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      debouncedSitePointName.value = newValue;
      currentPage.value = 1; // Reset to first page on filter change
    }, 300);
  },
);

watch(
  () => filters.value.assetName,
  (newValue) => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      debouncedAssetName.value = newValue;
      currentPage.value = 1; // Reset to first page on filter change
    }, 300);
  },
);

watch(
  () => filters.value.assetCode,
  (newValue) => {
    if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(() => {
      debouncedAssetCode.value = newValue;
      currentPage.value = 1; // Reset to first page on filter change
    }, 300);
  },
);

// Watch for other filter changes
watch(
  () => [
    filters.value.assetType,
    filters.value.portType,
    filters.value.portStatus,
  ],
  () => {
    currentPage.value = 1; // Reset to first page on filter change
  },
);

// Watch for page size changes
watch(pageSize, () => {
  currentPage.value = 1; // Reset to first page when changing page size
});

// Cables-specific state
const cablesCurrentPage = ref(1);
const cablesPageSize = ref(20);
const cablesFilters = ref({
  cableType: "",
  cableName: "",
  cableCode: "",
  cableStatus: "",
});

// Debounced cable search values
const debouncedCableName = ref("");
const debouncedCableCode = ref("");

// Debounce timer for cables
let cableSearchDebounceTimer: NodeJS.Timeout | null = null;

// Watch for cable search input changes with debounce
watch(
  () => cablesFilters.value.cableName,
  (newValue) => {
    if (cableSearchDebounceTimer) clearTimeout(cableSearchDebounceTimer);
    cableSearchDebounceTimer = setTimeout(() => {
      debouncedCableName.value = newValue;
      cablesCurrentPage.value = 1;
    }, 300);
  },
);

watch(
  () => cablesFilters.value.cableCode,
  (newValue) => {
    if (cableSearchDebounceTimer) clearTimeout(cableSearchDebounceTimer);
    cableSearchDebounceTimer = setTimeout(() => {
      debouncedCableCode.value = newValue;
      cablesCurrentPage.value = 1;
    }, 300);
  },
);

// Watch for other cable filter changes
watch(
  () => [cablesFilters.value.cableType, cablesFilters.value.cableStatus],
  () => {
    cablesCurrentPage.value = 1;
  },
);

// Watch for cables page size changes
watch(cablesPageSize, () => {
  cablesCurrentPage.value = 1;
});

// Build query parameters
const queryParams = computed(() => {
  const params = new URLSearchParams({
    meta: "*",
    limit: pageSize.value.toString(),
    page: currentPage.value.toString(),
  });

  // Add filters
  if (debouncedSitePointName.value) {
    params.append("site_name", debouncedSitePointName.value);
  }
  if (filters.value.assetType) {
    params.append("asset_type_id", filters.value.assetType);
  }
  if (debouncedAssetName.value) {
    params.append("asset_name", debouncedAssetName.value);
  }
  if (debouncedAssetCode.value) {
    params.append("asset_code", debouncedAssetCode.value);
  }
  if (filters.value.portType) {
    params.append("filter[port_type][_eq]", filters.value.portType);
  }
  if (filters.value.portStatus) {
    params.append("port_status", filters.value.portStatus);
  }

  return params.toString();
});

// Fetch asset types for filter dropdown
const { data: assetTypesData } = useQuery({
  queryKey: ["asset-types"],
  queryFn: async () => {
    const res = await $fetch<{ data: Array<{ id: number; name: string }> }>(
      "/panel/items/asset_types?sort=name&filter[terminate_type][_neq]=non_asset",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return res.data;
  },
  staleTime: 300000, // 5 minutes - asset types don't change often
});

// Computed asset type options for dropdown
const assetTypeOptions = computed(() => {
  const types = assetTypesData.value || [];
  return [
    { label: "All Types", value: "" },
    ...types.map((type) => ({
      label: type.name,
      value: type.id.toString(),
    })),
  ];
});

// Fetch asset ports data using TanStack Query
const {
  data: assetPortsData,
  isLoading,
  isError,
  error,
  refetch,
} = useQuery({
  queryKey: computed(() => ["asset-ports", queryParams.value]),
  queryFn: async ({ queryKey }) => {
    const [_, params] = queryKey;
    const res = await $fetch<{
      meta: { total_count: number; filter_count: number };
      data: any[];
    }>(`/panel/data/tabular/v2/asset_ports?is_playground=false&${params}`, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    return res;
  },
  enabled: computed(() => isOpen.value),
  staleTime: 30000, // 30 seconds
});

// Computed values
const totalCount = computed(() => assetPortsData.value?.meta?.total_count || 0);
const filterCount = computed(
  () => assetPortsData.value?.meta?.filter_count || 0,
);
const assetPorts = computed(() => assetPortsData.value?.data || []);

// Pagination helpers
const startIndex = computed(() => (currentPage.value - 1) * pageSize.value + 1);
const endIndex = computed(() =>
  Math.min(currentPage.value * pageSize.value, filterCount.value),
);

// Build cables query parameters
const cablesQueryParams = computed(() => {
  const params = new URLSearchParams({
    meta: "*",
    limit: cablesPageSize.value.toString(),
    page: cablesCurrentPage.value.toString(),
  });

  // Add cable filters
  if (cablesFilters.value.cableType) {
    params.append("filter[cable_type_id][_eq]", cablesFilters.value.cableType);
  }
  if (debouncedCableName.value) {
    params.append(
      "filter[cable_id][name][_icontains]",
      debouncedCableName.value,
    );
  }
  if (debouncedCableCode.value) {
    params.append(
      "filter[cable_id][code][_icontains]",
      debouncedCableCode.value,
    );
  }
  if (cablesFilters.value.cableStatus) {
    params.append("filter[status][_eq]", cablesFilters.value.cableStatus);
  }

  return params.toString();
});

// Fetch cable types for filter dropdown
const { data: cableTypesData } = useQuery({
  queryKey: ["cable-types"],
  queryFn: async () => {
    const res = await $fetch<{ data: Array<{ id: number; name: string }> }>(
      "/panel/items/cable_types?sort=name",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return res.data;
  },
  staleTime: 300000, // 5 minutes
});

// Computed cable type options for dropdown
const cableTypeOptions = computed(() => {
  const types = cableTypesData.value || [];
  return [
    { label: "All Types", value: "" },
    ...types.map((type) => ({
      label: type.name,
      value: type.id.toString(),
    })),
  ];
});

// Fetch cables data using TanStack Query
const {
  data: cablesData,
  isLoading: cablesIsLoading,
  isError: cablesIsError,
  error: cablesError,
  refetch: cablesRefetch,
} = useQuery({
  queryKey: computed(() => ["cables", cablesQueryParams.value]),
  queryFn: async ({ queryKey }) => {
    const [_, params] = queryKey;
    const res = await $fetch<{
      meta: { total_count: number; filter_count: number };
      data: any[];
    }>(`/panel/data/tabular/cable_cores?${params}`, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    return res;
  },
  enabled: computed(() => isOpen.value && activeTab.value === 1),
  staleTime: 30000, // 30 seconds
});

// Cables computed values
const cablesTotalCount = computed(
  () => cablesData.value?.meta?.total_count || 0,
);
const cablesFilterCount = computed(
  () => cablesData.value?.meta?.filter_count || 0,
);
const cables = computed(() => cablesData.value?.data || []);

// Cables pagination helpers
const cablesStartIndex = computed(
  () => (cablesCurrentPage.value - 1) * cablesPageSize.value + 1,
);
const cablesEndIndex = computed(() =>
  Math.min(
    cablesCurrentPage.value * cablesPageSize.value,
    cablesFilterCount.value,
  ),
);

// Functions
const resetFilters = () => {
  filters.value = {
    sitePointName: "",
    assetType: "",
    assetName: "",
    assetCode: "",
    portType: "",
    portStatus: "",
  };
  debouncedSitePointName.value = "";
  debouncedAssetName.value = "";
  debouncedAssetCode.value = "";
  currentPage.value = 1;
};

const hasActiveFilters = computed(() => {
  return (
    filters.value.sitePointName ||
    filters.value.assetType ||
    filters.value.assetName ||
    filters.value.assetCode ||
    filters.value.portType ||
    filters.value.portStatus
  );
});

// Cables reset filters
const resetCablesFilters = () => {
  cablesFilters.value = {
    cableType: "",
    cableName: "",
    cableCode: "",
    cableStatus: "",
  };
  debouncedCableName.value = "";
  debouncedCableCode.value = "";
  cablesCurrentPage.value = 1;
};

const hasActiveCablesFilters = computed(() => {
  return (
    cablesFilters.value.cableType ||
    cablesFilters.value.cableName ||
    cablesFilters.value.cableCode ||
    cablesFilters.value.cableStatus
  );
});

// Watch for tab changes to reset filters
watch(activeTab, () => {
  resetFilters();
  resetCablesFilters();
});

// Port status badge color mapping
const getPortStatusColor = (status: string) => {
  const statusColors: Record<string, any> = {
    used: "blue",
    enabled: "green",
    disabled: "gray",
    reserved: "amber",
  };
  return statusColors[status?.toLowerCase()] || "gray";
};

// Cable status badge color mapping
const getCableStatusColor = (status: string) => {
  const statusColors: Record<string, any> = {
    active: "green",
    inactive: "gray",
    maintenance: "amber",
    planned: "blue",
  };
  return statusColors[status?.toLowerCase()] || "gray";
};

// Define comprehensive columns with customizable labels
const columns = [
  { key: "no", label: "No" },
  { key: "site_name", label: "Site Name" },
  { key: "site_code", label: "Site Code" },
  { key: "path", label: "Path" },
  { key: "asset_id", label: "Asset ID" },
  { key: "port_id", label: "Port ID" },
  { key: "asset_type", label: "Asset Type" },
  { key: "asset_name", label: "Asset Name" },
  { key: "asset_code", label: "Asset Code" },
  { key: "description", label: "Description", sortable: false },
  { key: "location", label: "Location" },
  { key: "location_detail", label: "Location Detail", sortable: false },
  { key: "tag_id", label: "Tag ID" },
  { key: "rfid", label: "RFID" },
  { key: "serial_number", label: "Serial Number" },
  { key: "port_type", label: "Port Type" },
  { key: "port_no", label: "Port No" },
  { key: "port_speed", label: "Port Speed" },
  { key: "port_description", label: "Port Description", sortable: false },
  {
    key: "sfp_connected_to_port",
    label: "SFP Connected To Port",
  },
  { key: "sfp_length", label: "SFP Length" },
  { key: "sfp_serial", label: "SFP Serial" },
  { key: "opm_dbm", label: "OPM dBm" },
  { key: "aggregation_code", label: "Aggregation Code" },
  { key: "port_identifier", label: "Port Identifier" },
  { key: "port_status", label: "Port Status" },
  { key: "date_of_purchase", label: "Date of Purchase" },
  { key: "date_of_install", label: "Date of Install" },
  { key: "date_of_service", label: "Date of Service" },
  {
    key: "date_of_warranty_expiration",
    label: "Date of Warranty Expiration",
  },
  {
    key: "date_of_last_inspection",
    label: "Date of Last Inspection",
  },
  { key: "last_inspected_by", label: "Last Inspected By" },
  {
    key: "date_of_maintenance_expiration",
    label: "Date of Maintenance Expiration",
  },
  { key: "maintenance_by", label: "Maintenance By" },
  {
    key: "service_log_ticket_number",
    label: "Service Log Ticket Number",
  },
];

// Define cables columns (placeholder - will be updated when API is ready)
const cablesColumns = [
  { key: "no", label: "No" },
  { key: "path", label: "Path" },
  { key: "cable_id", label: "Cable ID" },
  { key: "core_id", label: "Core ID" },
  { key: "cable_name", label: "Name" },
  { key: "cable_code", label: "Code" },
  { key: "cable_type", label: "Cable Type" },
  { key: "description", label: "Description", sortable: false },
  { key: "location", label: "Location" },
  { key: "location_detail", label: "Location Detail" },
  { key: "tag_id", label: "Tag ID" },
  { key: "rfid", label: "RFID" },
  { key: "serial_number", label: "Serial Number" },
  { key: "cable_tube", label: "Cable Tube" },
  { key: "cable_core", label: "Cable Core" },
  { key: "core_from_status", label: "Core From Status" },
  { key: "core_to_status", label: "Core To Status" },
  { key: "cable_net_length_m", label: "Net Length (m)" },
  { key: "cable_gross_length_m", label: "Gross Length (m)" },
  { key: "date_of_purchase", label: "Date of Purchase" },
  { key: "date_of_install", label: "Date of Install" },
  { key: "date_of_service", label: "Date of Service" },
  { key: "date_of_warranty_expiration", label: "Warranty Expiration" },
  { key: "date_of_last_inspection", label: "Last Inspection" },
  { key: "last_inspected_by", label: "Last Inspected By" },
  { key: "date_of_maintenance_expiration", label: "Maintenance Expiration" },
  { key: "maintenance_by", label: "Maintenance By" },
  { key: "service_log_ticket_number", label: "Service Log Ticket" },
  { key: "site_from_name", label: "Site From Name" },
  { key: "site_from_code", label: "Site From Code" },
  { key: "from_latitude", label: "From Latitude" },
  { key: "from_longitude", label: "From Longitude" },
  { key: "from_province", label: "From Province" },
  { key: "from_city", label: "From City" },
  { key: "site_to_name", label: "Site To Name" },
  { key: "site_to_code", label: "Site To Code" },
  { key: "to_latitude", label: "To Latitude" },
  { key: "to_longitude", label: "To Longitude" },
  { key: "to_province", label: "To Province" },
  { key: "to_city", label: "To City" },
];

// Transform data to handle null values - convert all nulls to "-"
const transformedAssetPorts = computed(() => {
  return assetPorts.value.map((port) => {
    const transformed: Record<string, any> = {};

    // Process all columns
    columns.forEach((col) => {
      const value = port[col.key];

      // Handle null/undefined values
      if (value === null || value === undefined || value === "") {
        transformed[col.key] = "-";
      } else {
        transformed[col.key] = value;
      }
    });

    return transformed;
  });
});

// Transform cables data to handle null values
const transformedCables = computed(() => {
  return cables.value.map((cable) => {
    const transformed: Record<string, any> = {};

    // Process all cables columns
    cablesColumns.forEach((col) => {
      const value = cable[col.key];

      // Handle null/undefined values
      if (value === null || value === undefined || value === "") {
        transformed[col.key] = "-";
      } else {
        transformed[col.key] = value;
      }
    });

    return transformed;
  });
});

// Format date helper
const formatDate = (dateString: string) => {
  if (!dateString || dateString === "-") return "-";
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateString;
  }
};

// Close modal
const closeModal = () => {
  isOpen.value = false;
};

// Download assets
const isDownloading = ref(false);

const downloadAssets = async () => {
  if (isDownloading.value) return;

  isDownloading.value = true;

  try {
    const toast = useToast();

    // Determine which data to download based on active tab
    const isAssetsTab = activeTab.value === 0;
    const endpoint = isAssetsTab
      ? "/panel/data/tabular/v2/asset_ports"
      : "/panel/data/tabular/cable_cores";
    const filename = isAssetsTab ? "assets_export.csv" : "cables_export.csv";

    // Build query params for export (without pagination)
    const params = new URLSearchParams();
    params.append("download", "csv");
    params.append("limit", "-1"); // Get all records
    if (isAssetsTab) {
      params.append("is_playground", "false");
    }

    if (isAssetsTab) {
      // Assets filters
      if (debouncedSitePointName.value) {
        params.append("site_name", debouncedSitePointName.value);
      }
      if (filters.value.assetType) {
        params.append("asset_type_id", filters.value.assetType);
      }
      if (debouncedAssetName.value) {
        params.append("asset_name", debouncedAssetName.value);
      }
      if (debouncedAssetCode.value) {
        params.append("asset_code", debouncedAssetCode.value);
      }
      if (filters.value.portType) {
        params.append("filter[port_type][_eq]", filters.value.portType);
      }
      if (filters.value.portStatus) {
        params.append("port_status", filters.value.portStatus);
      }
    } else {
      // Cables filters
      if (cablesFilters.value.cableType) {
        params.append(
          "filter[cable_type_id][_eq]",
          cablesFilters.value.cableType.toString(),
        );
      }
      if (debouncedCableName.value) {
        params.append(
          "filter[cable_name][_contains]",
          debouncedCableName.value,
        );
      }
      if (debouncedCableCode.value) {
        params.append(
          "filter[cable_code][_contains]",
          debouncedCableCode.value,
        );
      }
      if (cablesFilters.value.cableStatus) {
        params.append("filter[status][_eq]", cablesFilters.value.cableStatus);
      }
    }

    // Trigger download by opening URL with auth token
    const url = `${endpoint}?${params.toString()}&access_token=${authStore.accessToken}`;
    console.log(url);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.style.display = "none";

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast.add({
      title: "Download Started",
      description: "Your file download has started",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } catch (error) {
    console.error("Download failed:", error);
    const toast = useToast();
    toast.add({
      title: "Download Failed",
      description: "Could not download data. Please try again.",
      icon: "i-heroicons-exclamation-circle",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isDownloading.value = false;
  }
};
</script>

<template>
  <UModal
    v-model="isOpen"
    fullscreen
    prevent-close
    :ui="{
      fullscreen: 'max-w-[95%] h-[calc(100dvh-3rem)] rounded-xs',
    }"
  >
    <UCard
      :ui="{
        base: 'h-full flex flex-col',
        rounded: 'rounded-xs',
        header: { padding: 'px-4 py-3 sm:px-6' },
        body: {
          base: 'flex-1 overflow-hidden flex flex-col',
          padding: 'px-4 py-3',
        },
        footer: { padding: 'px-4 py-3 sm:px-6' },
      }"
    >
      <!-- Header -->
      <template #header>
        <div class="flex items-center justify-between">
          <div>
            <h3 class="text-base font-semibold leading-6 text-gray-900">
              Asset Ports & Cable Table
            </h3>
            <p class="mt-1 text-xs text-gray-500">
              View and filter all asset ports and cable in the system
            </p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              color="primary"
              icon="i-heroicons-arrow-down-tray"
              :ui="{ rounded: 'rounded-xxs' }"
              :loading="isDownloading"
              :disabled="isDownloading"
              @click="downloadAssets"
            >
              {{ isDownloading ? "Downloading..." : "Download CSV" }}
            </UButton>
            <UButton
              color="gray"
              variant="ghost"
              icon="i-heroicons-x-mark-20-solid"
              class="-my-1"
              @click="closeModal"
            />
          </div>
        </div>
      </template>

      <!-- Body -->
      <UTabs
        :ui="{
          list: {
            tab: { rounded: 'rounded-xxs', base: 'rounded-xxs' },
            rounded: 'rounded-xxs',
            marker: { rounded: 'rounded-xxs' },
          },
        }"
        v-model="activeTab"
        :items="tabItems"
        class="flex flex-col h-full"
      >
        <template #item="{ item }">
          <!-- Assets Tab -->
          <div
            v-if="item.key === 'assets'"
            class="flex flex-col h-full space-y-4 pt-4"
          >
            <!-- Filters Section -->
            <div class="bg-gray-50 rounded-xs space-y-3">
              <!-- Filter Inputs Grid -->
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
                <!-- Site Point Name Search -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block"
                    >Site Point Name</label
                  >
                  <UInput
                    v-model="filters.sitePointName"
                    placeholder="Search site point..."
                    size="sm"
                    icon="i-heroicons-magnifying-glass"
                    :ui="{ icon: { trailing: { pointer: '' } } }"
                  >
                    <template #trailing>
                      <UButton
                        v-if="filters.sitePointName"
                        color="gray"
                        variant="link"
                        size="2xs"
                        icon="i-heroicons-x-mark-20-solid"
                        :padded="false"
                        @click="filters.sitePointName = ''"
                      />
                    </template>
                  </UInput>
                </div>
                <!-- Asset Name Search -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block"
                    >Asset Name</label
                  >
                  <UInput
                    v-model="filters.assetName"
                    placeholder="Search asset name..."
                    size="sm"
                    icon="i-heroicons-magnifying-glass"
                    :ui="{ icon: { trailing: { pointer: '' } } }"
                  >
                    <template #trailing>
                      <UButton
                        v-if="filters.assetName"
                        color="gray"
                        variant="link"
                        size="2xs"
                        icon="i-heroicons-x-mark-20-solid"
                        :padded="false"
                        @click="filters.assetName = ''"
                      />
                    </template>
                  </UInput>
                </div>

                <!-- Asset Code Search -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block"
                    >Asset Code</label
                  >
                  <UInput
                    v-model="filters.assetCode"
                    placeholder="Search asset code..."
                    size="sm"
                    icon="i-heroicons-magnifying-glass"
                    :ui="{ icon: { trailing: { pointer: '' } } }"
                  >
                    <template #trailing>
                      <UButton
                        v-if="filters.assetCode"
                        color="gray"
                        variant="link"
                        size="2xs"
                        icon="i-heroicons-x-mark-20-solid"
                        :padded="false"
                        @click="filters.assetCode = ''"
                      />
                    </template>
                  </UInput>
                </div>
                <!-- Asset Type Filter -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block"
                    >Asset Type</label
                  >
                  <USelect
                    v-model="filters.assetType"
                    :options="assetTypeOptions"
                    size="sm"
                    :ui="{ rounded: 'rounded-xxs' }"
                  />
                </div>
                <!-- Port Type Filter -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block"
                    >Port Type</label
                  >
                  <USelect
                    v-model="filters.portType"
                    size="sm"
                    :ui="{ rounded: 'rounded-xxs' }"
                    :options="[
                      { label: 'All Types', value: '' },
                      { label: 'Uplink/Source', value: 'uplink/source' },
                      {
                        label: 'Downlink/Destination',
                        value: 'downlink/destination',
                      },
                    ]"
                  />
                </div>

                <!-- Port Status Filter -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block"
                    >Port Status</label
                  >
                  <USelect
                    v-model="filters.portStatus"
                    size="sm"
                    :ui="{ rounded: 'rounded-xxs' }"
                    :options="[
                      { label: 'All Status', value: '' },
                      { label: 'Used', value: 'used' },
                      { label: 'Enabled', value: 'enabled' },
                      { label: 'Disabled', value: 'disabled' },
                      { label: 'Reserved', value: 'reserved' },
                    ]"
                  />
                </div>
              </div>
            </div>
            <!-- <div class="flex items-center justify-between">
              <UButton
                v-if="hasActiveFilters"
                size="xs"
                color="brand"
                variant="ghost"
                @click="resetFilters"
              >
                Reset Filters
              </UButton>
            </div> -->
            <!-- Table Container -->
            <div
              class="flex-1 border rounded-xs overflow-auto flex flex-col min-h-0"
            >
              <!-- Loading State -->
              <div
                v-if="isLoading"
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-500"
                ></div>
                <p class="text-sm text-gray-500">Loading asset ports...</p>
              </div>

              <!-- Error State -->
              <div
                v-else-if="isError"
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center"
                >
                  <UIcon
                    name="i-heroicons-exclamation-triangle"
                    class="w-6 h-6 text-red-500"
                  />
                </div>
                <p class="text-sm text-red-600 font-medium">
                  Error loading asset ports
                </p>
                <p class="text-xs text-gray-500">
                  {{ error?.message || "An error occurred" }}
                </p>
                <UButton size="sm" color="gray" @click="refetch"
                  >Try Again</UButton
                >
              </div>

              <!-- Empty State -->
              <div
                v-else-if="assetPorts.length === 0"
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center"
                >
                  <UIcon
                    name="i-heroicons-table-cells"
                    class="w-6 h-6 text-gray-400"
                  />
                </div>
                <p class="text-sm text-gray-600 font-medium">
                  No asset ports found
                </p>
                <p class="text-xs text-gray-500">
                  {{
                    hasActiveFilters
                      ? "Try adjusting your filters"
                      : "No data available"
                  }}
                </p>
                <UButton
                  v-if="hasActiveFilters"
                  size="sm"
                  color="gray"
                  variant="ghost"
                  @click="resetFilters"
                >
                  Clear Filters
                </UButton>
              </div>

              <!-- Table -->
              <UTable
                v-else
                :rows="transformedAssetPorts"
                :columns="columns"
                :ui="{
                  th: {
                    base: 'sticky top-0 z-10 bg-white min-w-[120px]',
                    padding: 'px-3 py-3',
                  },
                  td: {
                    base: 'whitespace-nowrap bg-white',
                    padding: 'px-3 py-3',
                  },
                  wrapper: 'overflow-auto max-h-[calc(100vh-24rem)]',
                  divide: 'divide-y divide-gray-200',
                }"
              >
                <!-- Custom slot for port_status column with badge -->
                <template #port_status-data="{ row }">
                  <UBadge
                    v-if="row.port_status !== '-'"
                    :color="getPortStatusColor(row.port_status)"
                    variant="subtle"
                    size="xs"
                    class="capitalize"
                  >
                    {{ row.port_status }}
                  </UBadge>
                  <span v-else class="text-gray-400">-</span>
                </template>

                <!-- Custom slot for port_type column with capitalization -->
                <template #port_type-data="{ row }">
                  <span class="capitalize">{{ row.port_type }}</span>
                </template>

                <!-- Custom slots for date columns with formatting -->
                <template #date_of_purchase-data="{ row }">
                  {{ formatDate(row.date_of_purchase) }}
                </template>

                <template #date_of_install-data="{ row }">
                  {{ formatDate(row.date_of_install) }}
                </template>

                <template #date_of_service-data="{ row }">
                  {{ formatDate(row.date_of_service) }}
                </template>

                <template #date_of_warranty_expiration-data="{ row }">
                  {{ formatDate(row.date_of_warranty_expiration) }}
                </template>

                <template #date_of_last_inspection-data="{ row }">
                  {{ formatDate(row.date_of_last_inspection) }}
                </template>

                <template #date_of_maintenance_expiration-data="{ row }">
                  {{ formatDate(row.date_of_maintenance_expiration) }}
                </template>

                <!-- Custom slot for description and location_detail to show full text on hover -->
                <template #description-data="{ row }">
                  <span
                    class="max-w-xs truncate block"
                    :title="row.description"
                  >
                    {{ row.description }}
                  </span>
                </template>

                <template #location_detail-data="{ row }">
                  <span
                    class="max-w-xs truncate block"
                    :title="row.location_detail"
                  >
                    {{ row.location_detail }}
                  </span>
                </template>

                <template #port_description-data="{ row }">
                  <span
                    class="max-w-xs truncate block"
                    :title="row.port_description"
                  >
                    {{ row.port_description }}
                  </span>
                </template>
              </UTable>
            </div>

            <!-- Pagination & Controls -->
            <div
              v-if="!isLoading && assetPorts.length > 0"
              class="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t pt-4"
            >
              <!-- Left: Page Size Selector & Showing Info -->
              <div
                class="flex flex-col sm:flex-row items-start sm:items-center gap-3"
              >
                <!-- Page Size Selector -->
                <div class="flex items-center space-x-2">
                  <span class="text-sm text-gray-600">Show:</span>
                  <USelect
                    v-model="pageSize"
                    :options="pageSizeOptions"
                    size="xs"
                    class="w-20"
                    :ui="{ rounded: 'rounded-xxs' }"
                  />
                  <span class="text-sm text-gray-600">entries</span>
                </div>

                <!-- Showing Information -->
                <div class="text-sm text-gray-600">
                  Showing {{ startIndex }} - {{ endIndex }} of {{ filterCount }}
                  <span v-if="filterCount !== totalCount" class="text-gray-500">
                    (filtered from {{ totalCount }} total)
                  </span>
                </div>
              </div>

              <!-- Right: Pagination -->
              <UPagination
                v-model="currentPage"
                :page-count="pageSize"
                :total="filterCount"
                :max="7"
                show-first
                show-last
                size="sm"
              />
            </div>
          </div>
          <!-- End Assets Tab -->

          <!-- Cables Tab -->
          <div
            v-else-if="item.key === 'cables'"
            class="flex flex-col h-full space-y-4 pt-4"
          >
            <!-- Filters Section -->
            <div class="bg-gray-50 rounded-xs space-y-3">
              <!-- Filter Inputs Grid -->
              <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
                <!-- Cable Name Search -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block"
                    >Cable Name</label
                  >
                  <UInput
                    v-model="cablesFilters.cableName"
                    placeholder="Search cable name..."
                    size="sm"
                    icon="i-heroicons-magnifying-glass-20-solid"
                  />
                </div>

                <!-- Cable Code Search -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block"
                    >Cable Code</label
                  >
                  <UInput
                    v-model="cablesFilters.cableCode"
                    placeholder="Search cable code..."
                    size="sm"
                    icon="i-heroicons-magnifying-glass-20-solid"
                  />
                </div>

                <!-- Cable Type Filter -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block"
                    >Cable Type</label
                  >
                  <USelect
                    v-model="cablesFilters.cableType"
                    :options="cableTypeOptions"
                    placeholder="All Types"
                    size="sm"
                    :ui="{ rounded: 'rounded-xxs' }"
                  />
                </div>

                <!-- Cable Status Filter -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block">Status</label>
                  <USelect
                    v-model="cablesFilters.cableStatus"
                    :options="[
                      { label: 'All Statuses', value: '' },
                      { label: 'Active', value: 'active' },
                      { label: 'Inactive', value: 'inactive' },
                      { label: 'Maintenance', value: 'maintenance' },
                    ]"
                    placeholder="All Statuses"
                    size="sm"
                    :ui="{ rounded: 'rounded-xxs' }"
                  />
                </div>

                <!-- Page Size -->
                <div>
                  <label class="text-xs text-gray-600 mb-1 block"
                    >Page Size</label
                  >
                  <USelect
                    v-model="cablesPageSize"
                    :options="pageSizeOptions"
                    size="sm"
                    :ui="{ rounded: 'rounded-xxs' }"
                  />
                </div>
              </div>

              <!-- Action Buttons Row -->
              <div class="flex justify-between items-center pt-2 border-t">
                <div class="text-xs text-gray-600">
                  <span v-if="hasActiveCablesFilters" class="text-brand-600">
                    Filters active
                  </span>
                </div>
                <UButton
                  v-if="hasActiveCablesFilters"
                  label="Reset Filters"
                  size="xs"
                  color="brand"
                  variant="ghost"
                  @click="resetCablesFilters"
                >
                  Reset Filters
                </UButton>
              </div>
            </div>

            <!-- Table Container -->
            <div
              class="flex-1 border rounded-xs overflow-auto flex flex-col min-h-0"
            >
              <!-- Loading State -->
              <div
                v-if="cablesIsLoading"
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-500"
                ></div>
                <p class="text-sm text-gray-600">Loading cables data...</p>
              </div>

              <!-- Error State -->
              <div
                v-else-if="cablesIsError"
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center"
                >
                  <svg
                    class="w-6 h-6 text-red-600"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                    />
                  </svg>
                </div>
                <p class="text-sm text-gray-600">
                  Error loading cables: {{ cablesError?.message }}
                </p>
                <UButton size="sm" @click="cablesRefetch">Retry</UButton>
              </div>

              <!-- Empty State -->
              <div
                v-else-if="!transformedCables.length"
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center"
                >
                  <svg
                    class="w-6 h-6 text-gray-400"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      stroke-linecap="round"
                      stroke-linejoin="round"
                      stroke-width="2"
                      d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"
                    />
                  </svg>
                </div>
                <p class="text-sm text-gray-600">No cables found</p>
                <p class="text-xs text-gray-500">
                  Try adjusting your filters or check back later
                </p>
              </div>

              <!-- Cables Table -->
              <UTable
                v-else
                :rows="transformedCables"
                :columns="cablesColumns"
                :loading="cablesIsLoading"
                :ui="{
                  th: {
                    base: 'sticky top-0 z-10 bg-white min-w-[120px]',
                    padding: 'px-3 py-3',
                  },
                  td: {
                    base: 'whitespace-nowrap bg-white',
                    padding: 'px-3 py-3',
                  },
                  wrapper: 'overflow-auto max-h-[calc(100vh-24rem)] ',
                  divide: 'divide-y divide-gray-200',
                }"
              >
                <!-- Custom slot for status column with badge -->
                <template #status-data="{ row }">
                  <UBadge
                    v-if="row.status !== '-'"
                    :color="getCableStatusColor(row.status)"
                    variant="subtle"
                    size="xs"
                    class="capitalize"
                  >
                    {{ row.status }}
                  </UBadge>
                  <span v-else class="text-gray-400">{{ row.status }}</span>
                </template>

                <!-- Custom slot for date columns -->
                <template #date_created-data="{ row }">
                  <span class="text-xs">{{
                    formatDate(row.date_created)
                  }}</span>
                </template>
              </UTable>
            </div>

            <!-- Pagination Section -->
            <div class="flex items-center justify-between py-3 border-t">
              <!-- Left: Showing Information -->
              <div class="text-sm text-gray-600">
                Showing {{ cablesStartIndex }} - {{ cablesEndIndex }} of
                {{ cablesFilterCount }}
                <span
                  v-if="cablesFilterCount !== cablesTotalCount"
                  class="text-gray-500"
                >
                  (filtered from {{ cablesTotalCount }} total)
                </span>
              </div>

              <!-- Right: Pagination -->
              <UPagination
                v-model="cablesCurrentPage"
                :page-count="cablesPageSize"
                :total="cablesFilterCount"
                :max="7"
                show-first
                show-last
                size="sm"
              />
            </div>
          </div>
          <!-- End Cables Tab -->
        </template>
      </UTabs>
    </UCard>
  </UModal>
</template>
