<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { VueFlow } from "@vue-flow/core";
import type { NodeTypesObject } from "@vue-flow/core";
import PortNode from "./PortNode.vue";

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

// Form data - Two asset selections
const selectedAsset1 = ref<string | undefined>();
const selectedPortType1 = ref<string | undefined>();
const selectedAsset2 = ref<string | undefined>();
const selectedPortType2 = ref<string | undefined>();

// API data
const assetOptions = ref<any[]>([]);
const assetPorts1 = ref<any[]>([]);
const assetPorts2 = ref<any[]>([]);
const isLoadingAssets = ref(false);
const isLoadingAssetPorts1 = ref(false);
const isLoadingAssetPorts2 = ref(false);
const isLoadingCoreTransactions = ref(false);

// Edge deletion modal state
const showDeleteModal = ref(false);
const selectedEdge = ref<any>(null);
const isDeletingEdge = ref(false);

const portTypeOptions = [
  { label: "Uplink/Source", value: "uplink/source" },
  { label: "Downlink/Destination", value: "downlink/destination" },
  { label: "Others", value: "others" },
];

// Computed filtered asset options to prevent selecting the same asset on both sides
const assetOptions1 = computed(() => {
  if (!selectedAsset2.value) return assetOptions.value;
  return assetOptions.value.filter(
    (asset) => asset.value !== Number(selectedAsset2.value)
  );
});

const assetOptions2 = computed(() => {
  if (!selectedAsset1.value) return assetOptions.value;
  return assetOptions.value.filter(
    (asset) => asset.value !== Number(selectedAsset1.value)
  );
});

// Fetch assets
const fetchAssets = async (sitePointId: number) => {
  isLoadingAssets.value = true;
  try {
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/assets?filter[site_point_id][_eq]=${sitePointId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      }
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

// Watch for site point changes
watch(
  () => props.selectedSite?.ogc_fid,
  (newSitePointId) => {
    if (newSitePointId) {
      fetchAssets(newSitePointId);
    }
  },
  { immediate: true }
);

// Watch for port type 1 selection changes
watch(
  () => selectedPortType1.value,
  (newPortType) => {
    if (newPortType && assetPorts1.value.length > 0) {
      const asset1Nodes = generatePortNodes(
        assetPorts1.value,
        newPortType,
        "left"
      );
      const asset2Nodes = nodes.value.filter(
        (node) => node.data.side === "right"
      );
      nodes.value = [...asset1Nodes, ...asset2Nodes];
      edges.value = [];
    }
  }
);

// Watch for port type 2 selection changes
watch(
  () => selectedPortType2.value,
  (newPortType) => {
    if (newPortType && assetPorts2.value.length > 0) {
      const asset2Nodes = generatePortNodes(
        assetPorts2.value,
        newPortType,
        "right"
      );
      const asset1Nodes = nodes.value.filter(
        (node) => node.data.side === "left"
      );
      nodes.value = [...asset1Nodes, ...asset2Nodes];
      edges.value = [];
    }
  }
);

// Generate port nodes
const generatePortNodes = (
  ports: any[],
  portType: string,
  nodePosition: "left" | "right"
) => {
  const uniquePorts = ports.reduce((acc: any[], port: any) => {
    if (!acc.find((p: any) => p.number === port.number)) {
      acc.push(port);
    }
    return acc;
  }, [] as any[]);

  uniquePorts.sort((a: any, b: any) => a.number - b.number);

  return uniquePorts.map((port: any, index: number) => {
    const suffix = computed(() => {
      switch (portType) {
        case "uplink/source":
          return "U/S";
        case "downlink/destination":
          return "D/D";
        case "others":
        default:
          return "O";
      }
    });

    const xPosition = nodePosition === "left" ? -50 : 320;

    return {
      id: `P$${port.id}`,
      type: "portNode",
      position: { x: xPosition, y: 20 + index * 35 },
      data: {
        label: `${port.number}-${suffix.value}`,
        color: port.port_status === "used" ? "#71797E" : "#10B981",
        status: port.port_status,
        side: nodePosition,
        type: "port",
      },
      draggable: false,
    };
  });
};

// Fetch asset 1 ports
const fetchAssetPorts1 = async () => {
  if (!selectedAsset1.value || !selectedPortType1.value) {
    console.warn("No asset 1 or port type selected");
    return;
  }

  isLoadingAssetPorts1.value = true;
  try {
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/asset_ports/?filter[asset_id][_eq]=${selectedAsset1.value}&filter[port_type][_eq]=${selectedPortType1.value}&sort=path`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      }
    );
    assetPorts1.value = response.data;

    const asset1Nodes = generatePortNodes(
      assetPorts1.value,
      selectedPortType1.value,
      "left"
    );
    const asset2Nodes = nodes.value.filter(
      (node) => node.data.side === "right"
    );
    nodes.value = [...asset1Nodes, ...asset2Nodes];

    edges.value = [];

    if (
      asset1Nodes.length > 0 &&
      asset2Nodes.length > 0 &&
      props.selectedSite?.ogc_fid
    ) {
      await fetchCoreTransactions(props.selectedSite.ogc_fid);
    }
  } catch (error) {
    console.error("Error fetching asset 1 ports:", error);
    assetPorts1.value = [];
  } finally {
    isLoadingAssetPorts1.value = false;
  }
};

// Fetch asset 2 ports
const fetchAssetPorts2 = async () => {
  if (!selectedAsset2.value || !selectedPortType2.value) {
    console.warn("No asset 2 or port type selected");
    return;
  }

  isLoadingAssetPorts2.value = true;
  try {
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/asset_ports/?filter[asset_id][_eq]=${selectedAsset2.value}&filter[port_type][_eq]=${selectedPortType2.value}&sort=path`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      }
    );
    assetPorts2.value = response.data;

    const asset2Nodes = generatePortNodes(
      assetPorts2.value,
      selectedPortType2.value,
      "right"
    );
    const asset1Nodes = nodes.value.filter((node) => node.data.side === "left");
    nodes.value = [...asset1Nodes, ...asset2Nodes];

    edges.value = [];

    if (
      asset1Nodes.length > 0 &&
      asset2Nodes.length > 0 &&
      props.selectedSite?.ogc_fid
    ) {
      await fetchCoreTransactions(props.selectedSite.ogc_fid);
    }
  } catch (error) {
    console.error("Error fetching asset 2 ports:", error);
    assetPorts2.value = [];
  } finally {
    isLoadingAssetPorts2.value = false;
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
    await $fetch(
      `/panel/transactions/core-transactions/${selectedEdge.value.id}`,
      {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      }
    );

    // Remove edge from the list
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
        icon: "text-green-500",
      },
    });

    showDeleteModal.value = false;
    selectedEdge.value = null;

    // Refresh data to update node statuses
    await Promise.all([fetchAssetPorts1(), fetchAssetPorts2()]);
  } catch (error) {
    console.error("Error deleting edge:", error);
    toast.add({
      title: "Deletion Failed",
      description: "Failed to delete the connection",
      color: "red",
      icon: "i-heroicons-x-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
  } finally {
    isDeletingEdge.value = false;
  }
};

// Get node label for display in delete modal
const getNodeLabel = (nodeId: string) => {
  const node = nodes.value.find((n) => n.id === nodeId);
  return node?.data?.label || nodeId;
};

// Handle connection between ports
const onConnect = async (params: any) => {
  console.log("Port to Port connection params:", params);

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
    method: "port2port",
    site_point_id: props.selectedSite.ogc_fid,
    source: params.source,
    destination: params.target,
  };

  console.log("Port to Port API request:", requestBody);

  try {
    const response = await $fetch("/panel/transactions/v1/core-config", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: requestBody,
    });

    console.log("Port to Port response:", response);

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

    await Promise.all([fetchAssetPorts1(), fetchAssetPorts2()]);

    toast.add({
      title: "Connection Successful",
      description: "Port to Port connected successfully",
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
    console.error("Error connecting port to port:", error);
    toast.add({
      title: "Connection Failed",
      description: "Failed to create port to port connection",
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
</script>

<template>
  <div class="space-y-4">
    <!-- Two Column Layout -->
    <div class="grid grid-cols-2 gap-4">
      <!-- Left Column - Asset 1 Selection -->
      <div class="space-y-3">
        <h4 class="text-xs font-semibold text-grey-800">Select Asset 1</h4>

        <div class="space-y-2">
          <USelect
            v-model="selectedAsset1"
            :options="assetOptions1"
            placeholder="Select Asset"
            size="sm"
            value-attribute="value"
            :loading="isLoadingAssets"
            :disabled="isLoadingAssets"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <div class="space-y-2">
          <label class="text-2xs text-grey-600 block">Select Port Type</label>
          <USelect
            v-model="selectedPortType1"
            :options="portTypeOptions"
            placeholder="Select Port Type"
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
          :loading="isLoadingAssetPorts1"
          :disabled="!selectedAsset1 || !selectedPortType1"
          @click="fetchAssetPorts1"
          :ui="{ rounded: 'rounded-xxs' }"
        />
      </div>

      <!-- Right Column - Asset 2 Selection -->
      <div class="space-y-3">
        <h4 class="text-xs font-semibold text-grey-800">Select Asset 2</h4>

        <div class="space-y-2">
          <USelect
            v-model="selectedAsset2"
            :options="assetOptions2"
            placeholder="Select Asset"
            size="sm"
            value-attribute="value"
            :loading="isLoadingAssets"
            :disabled="isLoadingAssets"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <div class="space-y-2">
          <label class="text-2xs text-grey-600 block">Select Port Type</label>
          <USelect
            v-model="selectedPortType2"
            :options="portTypeOptions"
            placeholder="Select Port Type"
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
          :loading="isLoadingAssetPorts2"
          :disabled="!selectedAsset2 || !selectedPortType2"
          @click="fetchAssetPorts2"
          :ui="{ rounded: 'rounded-xxs' }"
        />
      </div>
    </div>

    <!-- Visual Diagram -->
    <div
      class="border border-grey-200 rounded-xs bg-grey-50 h-[calc(100dvh-39rem)] w-full overflow-hidden"
    >
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

    <!-- Delete Edge Modal -->
    <UModal v-model="showDeleteModal" :ui="{ width: 'sm:max-w-md' }">
      <UCard
        :ui="{
          ring: '',
          divide: 'divide-y divide-gray-100',
        }"
      >
        <template #header>
          <div class="flex items-center justify-between">
            <h3 class="text-base font-semibold leading-6 text-gray-900">
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
          <p class="text-sm text-gray-600">
            Are you sure you want to delete this connection?
          </p>

          <p class="text-xs text-gray-500">
            This action cannot be undone. The connection will be permanently
            removed.
          </p>
        </div>

        <template #footer>
          <div class="flex justify-end gap-2">
            <UButton
              label="Cancel"
              color="gray"
              variant="outline"
              @click="showDeleteModal = false"
              :disabled="isDeletingEdge"
            />
            <UButton
              label="Delete"
              color="red"
              @click="confirmDeleteEdge"
              :loading="isDeletingEdge"
            />
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>
