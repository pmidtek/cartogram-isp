<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { VueFlow, useVueFlow } from "@vue-flow/core";
import type { EdgeChange } from "@vue-flow/core";
import type { NodeTypesObject } from "@vue-flow/core";
import PortNode from "./PortNode.vue";
import { getCoreColor } from "~/utils/coreColors";

const featureStore = useFeature();
const authStore = useAuth();
const toast = useToast();

// Props
interface Props {
  selectedSite: any;
}

const props = defineProps<Props>();

// Register custom node types
const nodeTypes: NodeTypesObject = {
  portNode: PortNode as any,
};

// Nodes and edges
const nodes = ref<any[]>([]);
const edges = ref<any[]>([]);

// Form data
const selectedAsset = ref<string | undefined>();
const selectedSide = ref<string | undefined>();
const selectedCable = ref<string | undefined>();
const selectedTube = ref<string | undefined>();

// API data
const assetOptions = ref<any[]>([]);
const cableOptions = ref<any[]>([]);
const tubeOptions = ref<any[]>([]);
const assetPorts = ref<any[]>([]);
const cableCores = ref<any[]>([]);
const isLoadingAssets = ref(false);
const isLoadingCables = ref(false);
const isLoadingTubes = ref(false);
const isLoadingAssetPorts = ref(false);
const isLoadingCableCores = ref(false);
const isLoadingCoreTransactions = ref(false);

const sideOptions = [
  { label: "Uplink/Source", value: "uplink/source" },
  { label: "Downlink/Destination", value: "downlink/destination" },
  { label: "Others", value: "others" },
];

// Fetch assets
const fetchAssets = async (sitePointId: number) => {
  isLoadingAssets.value = true;
  try {
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/assets?filter[site_point_id][_eq]=${sitePointId}&filter[ports][_gte]=0`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    assetOptions.value = response.data.map((asset) => ({
      label: asset.name || asset.code || `Asset ${asset.id}`,
      value: asset.id,
    }));
  } catch (error) {
    console.error("Error fetching assets:", error);
    assetOptions.value = [];
  } finally {
    isLoadingAssets.value = false;
  }
};

// Fetch cables
const fetchCables = async (sitePointId: number) => {
  isLoadingCables.value = true;
  try {
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/cables?filter[_and][0][_and][0][_or][0][site_from][_eq]=${sitePointId}&filter[_and][0][_and][0][_or][1][site_to][_eq]=${sitePointId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    cableOptions.value = response.data.map((cable) => ({
      label: cable.name || cable.code || `Cable ${cable.id}`,
      value: cable.id,
    }));
  } catch (error) {
    console.error("Error fetching cables:", error);
    cableOptions.value = [];
  } finally {
    isLoadingCables.value = false;
  }
};

// Fetch tubes
const fetchTubes = async (cableId: number) => {
  isLoadingTubes.value = true;
  try {
    const response = await $fetch<{ data: Array<{ tube: number }> }>(
      `/panel/items/cable_cores/?filter[cable_id][_eq]=${cableId}&groupBy=tube`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    tubeOptions.value = response.data.map((item) => ({
      label: `Tube ${item.tube}`,
      value: item.tube.toString(),
    }));
  } catch (error) {
    console.error("Error fetching tubes:", error);
    tubeOptions.value = [];
  } finally {
    isLoadingTubes.value = false;
  }
};

// Watch for site point changes
watch(
  () => props.selectedSite?.ogc_fid,
  (newSitePointId) => {
    if (newSitePointId) {
      fetchAssets(newSitePointId);
      fetchCables(newSitePointId);
    }
  },
  { immediate: true },
);

// Watch for cable selection changes
watch(
  () => selectedCable.value,
  (newCableId) => {
    selectedTube.value = undefined;
    tubeOptions.value = [];

    if (newCableId) {
      fetchTubes(Number(newCableId));
    }
  },
);

// Watch for side selection changes
watch(
  () => selectedSide.value,
  (newSide) => {
    if (newSide && assetPorts.value.length > 0) {
      const assetNodes = generatePortNodes(assetPorts.value, newSide);
      const cableNodes = nodes.value.filter(
        (node) => node.data.side === "right",
      );
      nodes.value = [...assetNodes, ...cableNodes];
      edges.value = [];
    }
  },
);

// Generate port nodes
const generatePortNodes = (ports: any[], side: string) => {
  const uniquePorts = ports.reduce((acc: any[], port: any) => {
    if (!acc.find((p: any) => p.number === port.number)) {
      acc.push(port);
    }
    return acc;
  }, [] as any[]);

  uniquePorts.sort((a: any, b: any) => a.number - b.number);

  return uniquePorts.map((port: any, index: number) => {
    const suffix = computed(() => {
      switch (selectedSide.value) {
        case "uplink/source":
          return "U/S";
        case "downlink/destination":
          return "D/D";
        case "others":
        default:
          return "O";
      }
    });

    return {
      id: `P$${port.id}`,
      type: "portNode",
      position: { x: -50, y: 20 + index * 40 },
      data: {
        label: `${port.number}-${suffix.value}`,
        color: port.port_status === "used" ? "#71797E" : "#10B981",
        status: port.port_status,
        side: "left",
        type: "port",
      },
      draggable: false,
    };
  });
};

// Generate cable core nodes
const generateCableCoreNodes = (cores: any[], sitePointId: number) => {
  // Sort by tube and core number
  const sortedCores = [...cores].sort((a: any, b: any) => {
    if (a.tube !== b.tube) {
      return a.tube - b.tube;
    }
    return a.core - b.core;
  });

  return sortedCores.map((core: any, index: number) => {
    const isSiteFrom = core.cable_id.site_from === sitePointId;
    const statusField = isSiteFrom ? "from" : "to";
    const status =
      core[statusField] === "used"
        ? "used"
        : core[statusField] === "enabled"
          ? "enabled"
          : "enabled";

    return {
      id: `C$${core.id}$${isSiteFrom ? "F" : "B"}`,
      type: "portNode",
      position: { x: 320, y: 20 + index * 40 },
      data: {
        label: `Tube ${core.tube} - Core ${core.core}`,
        color: status === "used" ? "#71797E" : "#10B981",
        status: status,
        side: "right",
        type: "core",
        coreNumber: core.core, // Pass core number for color mapping
        tubeColor: getCoreColor(core.tube),
      },
      draggable: false,
    };
  });
};

// Fetch asset ports
const fetchAssetPorts = async () => {
  if (!selectedAsset.value || !selectedSide.value) {
    console.warn("No asset or side selected");
    return;
  }

  isLoadingAssetPorts.value = true;
  try {
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/asset_ports/?filter[asset_id][_eq]=${selectedAsset.value}&filter[port_type][_eq]=${selectedSide.value}&sort=path`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    assetPorts.value = response.data;

    const assetNodes = generatePortNodes(assetPorts.value, selectedSide.value);
    const cableNodes = nodes.value.filter((node) => node.data.side === "right");
    nodes.value = [...assetNodes, ...cableNodes];

    edges.value = [];

    if (
      assetNodes.length > 0 &&
      cableNodes.length > 0 &&
      props.selectedSite?.ogc_fid
    ) {
      await fetchCoreTransactions(props.selectedSite.ogc_fid);
    }
  } catch (error) {
    console.error("Error fetching asset ports:", error);
    assetPorts.value = [];
  } finally {
    isLoadingAssetPorts.value = false;
  }
};

// Fetch cable cores
const fetchCableCores = async (showAll = false) => {
  if (!selectedCable.value || !props.selectedSite?.ogc_fid) {
    console.warn("No cable or site selected");
    return;
  }

  if (!showAll && !selectedTube.value) {
    console.warn("No tube selected");
    return;
  }

  isLoadingCableCores.value = true;
  try {
    // Build URL with or without tube filter
    const tubeFilter = showAll
      ? ""
      : `&filter[tube][_eq]=${selectedTube.value}`;
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/cable_cores/?filter[cable_id][_eq]=${selectedCable.value}${tubeFilter}&sort=path&fields=*,cable_id.id,cable_id.site_from,cable_id.site_to`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    cableCores.value = response.data;

    const cableNodes = generateCableCoreNodes(
      cableCores.value,
      props.selectedSite.ogc_fid,
    );

    const assetNodes = nodes.value.filter((node) => node.data.side === "left");
    nodes.value = [...assetNodes, ...cableNodes];

    edges.value = [];

    if (
      assetNodes.length > 0 &&
      cableNodes.length > 0 &&
      props.selectedSite?.ogc_fid
    ) {
      await fetchCoreTransactions(props.selectedSite.ogc_fid);
    }
  } catch (error) {
    console.error("Error fetching cable cores:", error);
    cableCores.value = [];
  } finally {
    isLoadingCableCores.value = false;
  }
};

// Fetch existing core transactions
const fetchCoreTransactions = async (sitePointId: number) => {
  isLoadingCoreTransactions.value = true;
  try {
    const response = await $fetch<{
      data: Array<{ id: string; source: string; target: string }>;
    }>(`/panel/transactions/core-transactions?site_point_id=${sitePointId}`, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    const existingEdges = response.data.map((transaction) => ({
      id: transaction.id,
      source: transaction.source,
      target: transaction.target,
      style: { stroke: "#3B82F6", strokeWidth: 2 },
    }));

    edges.value = existingEdges;
  } catch (error) {
    console.error("Error fetching core transactions:", error);
    edges.value = [];
  } finally {
    isLoadingCoreTransactions.value = false;
  }
};

// Update node status
const updateNodeStatus = (nodeId: string, status: "used" | "enabled") => {
  const nodeIndex = nodes.value.findIndex((n) => n.id === nodeId);
  if (nodeIndex !== -1) {
    const color = status === "used" ? "#71797E" : "#10B981";
    nodes.value[nodeIndex] = {
      ...nodes.value[nodeIndex],
      data: {
        ...nodes.value[nodeIndex].data,
        status: status,
        color: color,
      },
    };
  }
};

// Handle connection between port and core
const onConnect = async (params: any) => {
  const sourceNode = nodes.value.find((n) => n.id === params.source);
  const targetNode = nodes.value.find((n) => n.id === params.target);

  if (sourceNode?.data.status === "used") {
    toast.add({
      title: "Connection Failed",
      description: "Source port is already in use",
      color: "red",
      icon: "i-heroicons-x-circle",
    });
    return;
  }

  if (targetNode?.data.status === "used") {
    toast.add({
      title: "Connection Failed",
      description: "Target port is already in use",
      color: "red",
      icon: "i-heroicons-x-circle",
    });
    return;
  }

  if (!props.selectedSite?.ogc_fid) {
    console.error("No site point selected");
    return;
  }

  const requestBody = {
    method: "port2core",
    site_point_id: props.selectedSite.ogc_fid,
    source: params.source,
    destination: params.target,
  };

  try {
    const response = await $fetch("/panel/transactions/v1/core-config", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    const newEdge = {
      id: `e-${params.source}-${params.target}`,
      source: params.source,
      target: params.target,
      sourceHandle: params.sourceHandle,
      targetHandle: params.targetHandle,
      style: { stroke: "#3B82F6", strokeWidth: 2 },
    };

    edges.value = [...edges.value, newEdge];

    updateNodeStatus(params.source, "used");
    updateNodeStatus(params.target, "used");

    await Promise.all([fetchAssetPorts(), fetchCableCores()]);

    toast.add({
      title: "Connection Successful",
      description: "Port to Core connected successfully",
      color: "green",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  } catch (error) {
    console.error("Error connecting port to core:", error);
    toast.add({
      title: "Connection Failed",
      description: "Failed to create port to core connection",
      color: "red",
      icon: "i-heroicons-x-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  }
};

// Edge deletion modal state
const showDeleteModal = ref(false);
const selectedEdge = ref<any>(null);
const isDeletingEdge = ref(false);

// Fullscreen modal state
const isFullscreenModalOpen = ref(false);

// Handle edge click to show delete confirmation
const onEdgeClick = (event: any) => {
  const edge = event.edge;
  selectedEdge.value = edge;
  showDeleteModal.value = true;
};

// Confirm and delete edge
const confirmDeleteEdge = async () => {
  if (!selectedEdge.value) return;

  isDeletingEdge.value = true;
  try {
    await handleEdgeDeletion(selectedEdge.value.id);

    // Remove edge from local state
    edges.value = edges.value.filter((e) => e.id !== selectedEdge.value.id);

    toast.add({
      title: "Connection Deleted",
      description: "The connection has been removed successfully",
      color: "green",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });

    showDeleteModal.value = false;
    selectedEdge.value = null;
  } catch (error) {
    toast.add({
      title: "Deletion Failed",
      description: "Failed to delete the connection",
      color: "red",
      icon: "i-heroicons-x-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isDeletingEdge.value = false;
  }
};

// Get node labels for display in confirmation modal
const getNodeLabel = (nodeId: string) => {
  const node = nodes.value.find((n) => n.id === nodeId);
  return node?.data?.label || nodeId;
};

const isGeneratingTube = ref(false);

const handleAddTube = async (cableId: number) => {
  isGeneratingTube.value = true;

  try {
    // Fetch existing tubes for this cable
    const queryParams = new URLSearchParams({
      "filter[cable_id][_eq]": String(cableId),
      groupBy: "tube",
    });

    const existingTubesResponse = await $fetch<{ data: { tube: number }[] }>(
      `/panel/items/cable_cores?${queryParams}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    // Calculate next tube number
    const existingTubes = existingTubesResponse.data || [];
    const nextTubeNo =
      existingTubes.length > 0
        ? Math.max(...existingTubes.map((t) => t.tube)) + 1
        : 1;

    // Generate the tube with 12 cores
    const response = await $fetch("/panel/transactions/v1/generate-cores", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        cable_id: cableId,
        tube_no: nextTubeNo,
      }),
    });

    toast.add({
      title: "Success",
      description: `Tube ${nextTubeNo} with 12 cores has been generated`,
      color: "green",
    });

    // Refresh tube dropdown
    await fetchTubes(cableId);
  } catch (error: any) {
    console.error("Error generating tube:", error);

    const errorMessage =
      error?.data?.errors?.[0]?.message ||
      error?.data?.message ||
      error?.message ||
      "Failed to generate tube";

    toast.add({
      title: "Error",
      description: errorMessage,
      color: "red",
    });
  } finally {
    isGeneratingTube.value = false;
  }
};

const handleEdgeDeletion = async (edgeId: string) => {
  if (!edgeId) return;
  try {
    const res = await $fetch(
      `/panel/transactions/core-transactions/${edgeId}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    console.log("Deleted successfully:", res);

    await Promise.all([fetchAssetPorts(), fetchCableCores()]);
  } catch (error) {
    console.error("Failed to delete edge:", error);
  }
};
</script>

<template>
  <div class="space-y-4">
    <!-- Two Column Layout -->
    <div class="grid grid-cols-2 gap-4">
      <!-- Left Column - Asset Selection -->
      <div class="space-y-3">
        <h4 class="text-xs font-semibold text-grey-800">Select Asset</h4>

        <div class="space-y-2">
          <USelect
            v-model="selectedAsset"
            :options="assetOptions"
            placeholder="Select Asset"
            size="sm"
            value-attribute="value"
            :loading="isLoadingAssets"
            :disabled="isLoadingAssets"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <div class="space-y-2">
          <label class="text-2xs text-grey-600 block">Select Side</label>
          <USelect
            v-model="selectedSide"
            :options="sideOptions"
            placeholder="Select Side"
            size="sm"
            value-attribute="value"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <UButton
          label="Show"
          color="primary"
          block
          size="sm"
          :loading="isLoadingAssetPorts"
          :disabled="!selectedAsset || !selectedSide"
          @click="fetchAssetPorts"
          :ui="{ rounded: 'rounded-xxs' }"
        />
      </div>

      <!-- Right Column - Cable Selection -->
      <div class="space-y-3">
        <h4 class="text-xs font-semibold text-grey-800">Select Cable</h4>

        <div class="space-y-1">
          <USelect
            v-model="selectedCable"
            :options="cableOptions"
            placeholder="Select Cable"
            size="sm"
            value-attribute="value"
            :loading="isLoadingCables"
            :disabled="isLoadingCables"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>
        <div class="space-y-2">
          <div class="flex justify-between items-center">
            <label class="text-2xs text-grey-600 block">Select Tube</label>
            <UButton
              size="2xs"
              :ui="{ rounded: 'rounded-xxs' }"
              label="Generate Tube"
              color="primary"
              variant="ghost"
              class="p-0"
              :loading="isGeneratingTube"
              :disabled="!selectedCable || isGeneratingTube"
              @click="handleAddTube(Number(selectedCable))"
            />
          </div>
          <USelect
            v-model="selectedTube"
            :options="tubeOptions"
            placeholder="Select Tube"
            size="sm"
            value-attribute="value"
            :loading="isLoadingTubes"
            :disabled="!selectedCable || isLoadingTubes"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <UButton
            label="Show"
            color="primary"
            block
            size="sm"
            :loading="isLoadingCableCores"
            :disabled="!selectedCable || !selectedTube"
            @click="fetchCableCores(false)"
            :ui="{ rounded: 'rounded-xxs' }"
          />
          <UButton
            label="Show All"
            color="primary"
            block
            size="sm"
            :loading="isLoadingCableCores"
            :disabled="!selectedCable"
            @click="fetchCableCores(true)"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>
      </div>
    </div>

    <!-- Visual Diagram -->
    <div
      class="border border-grey-200 rounded-xs bg-grey-50 h-[calc(100dvh-39rem)] w-full overflow-hidden relative"
    >
      <!-- Fullscreen Button -->
      <button
        @click="isFullscreenModalOpen = true"
        class="absolute top-2 right-2 z-10 bg-white hover:bg-grey-50 border border-grey-300 rounded-md p-2 shadow-sm transition-colors"
        title="Open Fullscreen"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          class="h-4 w-4 text-grey-700"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path
            stroke-linecap="round"
            stroke-linejoin="round"
            stroke-width="2"
            d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4"
          />
        </svg>
      </button>

      <VueFlow
        :nodes="nodes"
        :edges="edges"
        :node-types="nodeTypes"
        :pan-on-scroll="true"
        :pan-on-drag="true"
        :zoom-on-scroll="false"
        :zoom-on-pinch="false"
        :zoom-on-double-click="false"
        @connect="onConnect"
        @edge-click="onEdgeClick"
        class="h-full w-full overflow-x-auto overflow-y-hidden"
      >
      </VueFlow>
    </div>

    <!-- Action Buttons -->
    <div class="grid grid-cols-2 gap-2 mt-4">
      <UButton
        label="Cancel"
        color="gray"
        variant="outline"
        block
        size="sm"
        @click="$emit('cancel')"
        :ui="{ rounded: 'rounded-xxs' }"
      />
      <UButton
        label="Done"
        color="primary"
        block
        size="sm"
        @click="$emit('done')"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Delete Confirmation Modal -->
    <UModal
      v-model="showDeleteModal"
      :ui="{ width: 'sm:max-w-md', rounded: 'rounded-xs' }"
    >
      <UCard
        :ui="{
          base: 'overflow-hidden',
          header: { padding: 'px-3 py-3 sm:px-6' },
          body: { padding: 'px-2 py-2 sm:px-3 sm:py-3' },
          footer: { padding: 'px-3 py-3 sm:px-3' },
          rounded: 'rounded-xs',
        }"
      >
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold text-gray-900">
              Delete Connection
            </h3>
            <UButton
              color="gray"
              variant="ghost"
              icon="i-heroicons-x-mark-20-solid"
              class="-my-1"
              @click="showDeleteModal = false"
            />
          </div>
        </template>

        <div class="space-y-3">
          <div class="flex flex-col items-center justify-center py-2 space-y-2">
            <div
              class="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center"
            >
              <UIcon
                name="i-heroicons-exclamation-triangle"
                class="w-6 h-6 text-red-500"
              />
            </div>
            <p class="text-sm text-gray-600 text-center">
              Are you sure you want to delete this connection?
            </p>
          </div>

          <div v-if="selectedEdge" class="bg-gray-50 rounded-xxs">
            <div class="flex items-center justify-center gap-2 text-sm">
              <span class="font-semibold text-gray-900">
                {{ getNodeLabel(selectedEdge.source) }}
              </span>
              <UIcon
                name="i-heroicons-arrow-right"
                class="w-4 h-4 text-gray-400"
              />
              <span class="font-semibold text-gray-900">
                {{ getNodeLabel(selectedEdge.target) }}
              </span>
            </div>
          </div>

          <p class="text-xs text-gray-500 text-center">
            This action cannot be undone.
          </p>
        </div>

        <template #footer>
          <div class="flex gap-3 justify-end">
            <UButton
              label="Cancel"
              color="gray"
              variant="outline"
              size="sm"
              @click="showDeleteModal = false"
              :disabled="isDeletingEdge"
              :ui="{ rounded: 'rounded-xs' }"
            />
            <UButton
              label="Delete"
              color="red"
              size="sm"
              :loading="isDeletingEdge"
              @click="confirmDeleteEdge"
              :ui="{ rounded: 'rounded-xs' }"
            />
          </div>
        </template>
      </UCard>
    </UModal>

    <!-- Fullscreen Modal -->
    <UModal v-model="isFullscreenModalOpen">
      <UCard :ui="{ rounded: 'rounded-none' }">
        <template #header>
          <div class="flex justify-between items-center">
            <h3 class="text-base font-semibold text-grey-900">
              Port to Core Configuration
            </h3>
            <UButton
              icon="i-heroicons-x-mark"
              color="gray"
              variant="ghost"
              size="sm"
              @click="isFullscreenModalOpen = false"
            />
          </div>
        </template>

        <div class="h-[calc(100vh-12rem)] w-full border">
          <VueFlow
            :nodes="nodes"
            :edges="edges"
            fit-view-on-init
            :node-types="nodeTypes"
            :pan-on-scroll="true"
            :pan-on-drag="true"
            :zoom-on-scroll="true"
            :zoom-on-pinch="true"
            :zoom-on-double-click="true"
            @connect="onConnect"
            @edge-click="onEdgeClick"
            class="h-full w-full"
          >
          </VueFlow>
        </div>
      </UCard>
    </UModal>
  </div>
</template>
