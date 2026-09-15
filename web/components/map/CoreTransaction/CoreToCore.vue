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

// Form data - Two cable selections
const selectedSpliceAsset = ref<string | undefined>();
const selectedCable1 = ref<string | undefined>();
const selectedTube1 = ref<string | undefined>();
const selectedCable2 = ref<string | undefined>();
const selectedTube2 = ref<string | undefined>();

// API data
const spliceAssetOptions = ref<any[]>([]);
const cableOptions = ref<any[]>([]);
const tubeOptions1 = ref<any[]>([]);
const tubeOptions2 = ref<any[]>([]);
const cableCores1 = ref<any[]>([]);
const cableCores2 = ref<any[]>([]);
const isLoadingSpliceAssets = ref(false);
const isLoadingCables = ref(false);
const isLoadingTubes1 = ref(false);
const isLoadingTubes2 = ref(false);
const isLoadingCableCores1 = ref(false);
const isLoadingCableCores2 = ref(false);
const isLoadingCoreTransactions = ref(false);

// Edge deletion modal state
const showDeleteModal = ref(false);
const selectedEdge = ref<any>(null);
const isDeletingEdge = ref(false);

// Computed filtered cable options to prevent selecting the same cable on both sides
const cableOptions1 = computed(() => {
  if (!selectedCable2.value) return cableOptions.value;
  return cableOptions.value.filter(
    (cable) => cable.value !== Number(selectedCable2.value),
  );
});

const cableOptions2 = computed(() => {
  if (!selectedCable1.value) return cableOptions.value;
  return cableOptions.value.filter(
    (cable) => cable.value !== Number(selectedCable1.value),
  );
});

// Fetch splice assets
const fetchSpliceAssets = async (sitePointId: number) => {
  isLoadingSpliceAssets.value = true;
  try {
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/assets?filter[site_point_id][_eq]=${sitePointId}&filter[asset_type_id][terminate_type][_eq]=passive_splice`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    spliceAssetOptions.value = response.data.map((asset) => ({
      label: asset.name || asset.code || `Asset ${asset.id}`,
      value: asset.id,
    }));
  } catch (error) {
    console.error("Error fetching splice assets:", error);
    spliceAssetOptions.value = [];
  } finally {
    isLoadingSpliceAssets.value = false;
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

// Fetch tubes for cable 1
const fetchTubes1 = async (cableId: number) => {
  isLoadingTubes1.value = true;
  try {
    const response = await $fetch<{ data: Array<{ tube: number }> }>(
      `/panel/items/cable_cores/?filter[cable_id][_eq]=${cableId}&groupBy=tube`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    tubeOptions1.value = response.data.map((item) => ({
      label: `Tube ${item.tube}`,
      value: item.tube.toString(),
    }));
  } catch (error) {
    console.error("Error fetching tubes:", error);
    tubeOptions1.value = [];
  } finally {
    isLoadingTubes1.value = false;
  }
};

// Fetch tubes for cable 2
const fetchTubes2 = async (cableId: number) => {
  isLoadingTubes2.value = true;
  try {
    const response = await $fetch<{ data: Array<{ tube: number }> }>(
      `/panel/items/cable_cores/?filter[cable_id][_eq]=${cableId}&groupBy=tube`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    tubeOptions2.value = response.data.map((item) => ({
      label: `Tube ${item.tube}`,
      value: item.tube.toString(),
    }));
  } catch (error) {
    console.error("Error fetching tubes:", error);
    tubeOptions2.value = [];
  } finally {
    isLoadingTubes2.value = false;
  }
};

// Watch for site point changes
watch(
  () => props.selectedSite?.ogc_fid,
  (newSitePointId) => {
    if (newSitePointId) {
      fetchSpliceAssets(newSitePointId);
      fetchCables(newSitePointId);
    }
  },
  { immediate: true },
);

// Watch for cable 1 selection changes
watch(
  () => selectedCable1.value,
  (newCableId) => {
    selectedTube1.value = undefined;
    tubeOptions1.value = [];

    if (newCableId) {
      fetchTubes1(Number(newCableId));
    }
  },
);

// Watch for cable 2 selection changes
watch(
  () => selectedCable2.value,
  (newCableId) => {
    selectedTube2.value = undefined;
    tubeOptions2.value = [];

    if (newCableId) {
      fetchTubes2(Number(newCableId));
    }
  },
);

// Generate cable core nodes
const generateCableCoreNodes = (
  cores: any[],
  sitePointId: number,
  side: "left" | "right",
) => {
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

    const xPosition = side === "left" ? -50 : 320;
    const nodeType = side === "left" ? "source" : "target";

    return {
      id: `C$${core.id}$${isSiteFrom ? "F" : "B"}`,
      type: "portNode",
      position: { x: xPosition, y: 20 + index * 35 },
      data: {
        label: `Tube ${core.tube} - Core ${core.core}`,
        color: status === "used" ? "#71797E" : "#10B981",
        status: status,
        side: side,
        type: "core",
        coreNumber: core.core, // Pass core number for color mapping
      },
      draggable: false,
    };
  });
};

// Fetch cable 1 cores
const fetchCableCores1 = async (showAll = false) => {
  if (!selectedCable1.value || !props.selectedSite?.ogc_fid) {
    console.warn("No cable 1 or site selected");
    return;
  }

  if (!showAll && !selectedTube1.value) {
    console.warn("No tube selected");
    return;
  }

  isLoadingCableCores1.value = true;
  try {
    // Build URL with or without tube filter
    const tubeFilter = showAll
      ? ""
      : `&filter[tube][_eq]=${selectedTube1.value}`;
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/cable_cores/?filter[cable_id][_eq]=${selectedCable1.value}${tubeFilter}&sort=path&fields=*,cable_id.id,cable_id.site_from,cable_id.site_to`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    cableCores1.value = response.data;

    const cable1Nodes = generateCableCoreNodes(
      cableCores1.value,
      props.selectedSite.ogc_fid,
      "left",
    );

    const cable2Nodes = nodes.value.filter(
      (node) => node.data.side === "right",
    );
    nodes.value = [...cable1Nodes, ...cable2Nodes];

    edges.value = [];

    if (
      cable1Nodes.length > 0 &&
      cable2Nodes.length > 0 &&
      props.selectedSite?.ogc_fid
    ) {
      await fetchCoreTransactions(props.selectedSite.ogc_fid);
    }
  } catch (error) {
    console.error("Error fetching cable 1 cores:", error);
    cableCores1.value = [];
  } finally {
    isLoadingCableCores1.value = false;
  }
};

// Fetch cable 2 cores
const fetchCableCores2 = async (showAll = false) => {
  if (!selectedCable2.value || !props.selectedSite?.ogc_fid) {
    console.warn("No cable 2 or site selected");
    return;
  }

  if (!showAll && !selectedTube2.value) {
    console.warn("No tube selected");
    return;
  }

  isLoadingCableCores2.value = true;
  try {
    // Build URL with or without tube filter
    const tubeFilter = showAll
      ? ""
      : `&filter[tube][_eq]=${selectedTube2.value}`;
    const response = await $fetch<{ data: any[] }>(
      `/panel/items/cable_cores/?filter[cable_id][_eq]=${selectedCable2.value}${tubeFilter}&sort=path&fields=*,cable_id.id,cable_id.site_from,cable_id.site_to`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    cableCores2.value = response.data;

    const cable2Nodes = generateCableCoreNodes(
      cableCores2.value,
      props.selectedSite.ogc_fid,
      "right",
    );

    const cable1Nodes = nodes.value.filter((node) => node.data.side === "left");
    nodes.value = [...cable1Nodes, ...cable2Nodes];

    edges.value = [];

    if (
      cable1Nodes.length > 0 &&
      cable2Nodes.length > 0 &&
      props.selectedSite?.ogc_fid
    ) {
      await fetchCoreTransactions(props.selectedSite.ogc_fid);
    }
  } catch (error) {
    console.error("Error fetching cable 2 cores:", error);
    cableCores2.value = [];
  } finally {
    isLoadingCableCores2.value = false;
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

// Handle connection between cores
const onConnect = async (params: any) => {
  const sourceNode = nodes.value.find((n) => n.id === params.source);
  const targetNode = nodes.value.find((n) => n.id === params.target);

  if (sourceNode?.data.status === "used") {
    toast.add({
      title: "Connection Failed",
      description: "Source core is already in use",
      color: "red",
      icon: "i-heroicons-x-circle",
    });
    return;
  }

  if (targetNode?.data.status === "used") {
    toast.add({
      title: "Connection Failed",
      description: "Target core is already in use",
      color: "red",
      icon: "i-heroicons-x-circle",
    });
    return;
  }

  if (!selectedSpliceAsset.value) {
    toast.add({
      title: "Connection Failed",
      description: "Please select a splice asset before connecting cores",
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
    method: "core2core",
    site_point_id: props.selectedSite.ogc_fid,
    source: params.source,
    destination: params.target,
    splice_asset_id: Number(selectedSpliceAsset.value),
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

    await Promise.all([fetchCableCores1(), fetchCableCores2()]);

    toast.add({
      title: "Connection Successful",
      description: "Core to Core connected successfully",
      color: "green",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
  } catch (error) {
    console.error("Error connecting core to core:", error);
    toast.add({
      title: "Connection Failed",
      description: "Failed to create core to core connection",
      color: "red",
      icon: "i-heroicons-x-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
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
      },
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
    await Promise.all([fetchCableCores1(), fetchCableCores2()]);
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
    await fetchTubes1(cableId);
    await fetchTubes2(cableId);
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
</script>

<template>
  <div class="space-y-4">
    <!-- Splice Asset Selection -->
    <div class="space-y-2">
      <h4 class="text-xs font-semibold text-grey-800">Select Splice Asset</h4>
      <USelect
        v-model="selectedSpliceAsset"
        :options="spliceAssetOptions"
        placeholder="Select Splice Asset"
        size="sm"
        value-attribute="value"
        :loading="isLoadingSpliceAssets"
        :disabled="isLoadingSpliceAssets"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </div>

    <!-- Two Column Layout -->
    <div class="grid grid-cols-2 gap-4">
      <!-- Left Column - Cable 1 Selection -->
      <div class="space-y-3">
        <h4 class="text-xs font-semibold text-grey-800">Select Cable 1</h4>

        <div class="space-y-2">
          <USelect
            v-model="selectedCable1"
            :options="cableOptions1"
            placeholder="Select Cable"
            size="sm"
            value-attribute="value"
            :loading="isLoadingCables"
            :disabled="isLoadingCables"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-2xs text-grey-600 block">Select Tube</label>
            <UButton
              size="2xs"
              :ui="{ rounded: 'rounded-xxs' }"
              label="Generate Tube"
              color="primary"
              variant="ghost"
              class="p-0"
              :loading="isGeneratingTube"
              :disabled="!selectedCable1 || isGeneratingTube"
              @click="handleAddTube(Number(selectedCable1))"
            />
          </div>
          <USelect
            v-model="selectedTube1"
            :options="tubeOptions1"
            placeholder="Select Tube"
            size="sm"
            value-attribute="value"
            :loading="isLoadingTubes1"
            :disabled="!selectedCable1 || isLoadingTubes1"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <UButton
            label="Show"
            color="primary"
            block
            size="sm"
            :loading="isLoadingCableCores1"
            :disabled="
              !selectedSpliceAsset || !selectedCable1 || !selectedTube1
            "
            @click="fetchCableCores1(false)"
            :ui="{ rounded: 'rounded-xxs' }"
          />
          <UButton
            label="Show All"
            color="primary"
            block
            size="sm"
            :loading="isLoadingCableCores1"
            :disabled="!selectedSpliceAsset || !selectedCable1"
            @click="fetchCableCores1(true)"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>
      </div>

      <!-- Right Column - Cable 2 Selection -->
      <div class="space-y-3">
        <h4 class="text-xs font-semibold text-grey-800">Select Cable 2</h4>

        <div class="space-y-2">
          <USelect
            v-model="selectedCable2"
            :options="cableOptions2"
            placeholder="Select Cable"
            size="sm"
            value-attribute="value"
            :loading="isLoadingCables"
            :disabled="isLoadingCables"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <div class="space-y-2">
          <div class="flex items-center justify-between">
            <label class="text-2xs text-grey-600 block">Select Tube</label>
            <UButton
              size="2xs"
              :ui="{ rounded: 'rounded-xxs' }"
              label="Generate Tube"
              color="primary"
              variant="ghost"
              class="p-0"
              :loading="isGeneratingTube"
              :disabled="!selectedCable2 || isGeneratingTube"
              @click="handleAddTube(Number(selectedCable2))"
            />
          </div>
          <USelect
            v-model="selectedTube2"
            :options="tubeOptions2"
            placeholder="Select Tube"
            size="sm"
            value-attribute="value"
            :loading="isLoadingTubes2"
            :disabled="!selectedCable2 || isLoadingTubes2"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <div class="grid grid-cols-2 gap-2">
          <UButton
            label="Show"
            color="primary"
            block
            size="sm"
            :loading="isLoadingCableCores2"
            :disabled="
              !selectedSpliceAsset || !selectedCable2 || !selectedTube2
            "
            @click="fetchCableCores2(false)"
            :ui="{ rounded: 'rounded-xxs' }"
          />
          <UButton
            label="Show All"
            color="primary"
            block
            size="sm"
            :loading="isLoadingCableCores2"
            :disabled="!selectedSpliceAsset || !selectedCable2"
            @click="fetchCableCores2(true)"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>
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
    <UModal
      v-model="showDeleteModal"
      :ui="{ rounded: 'rounded-sm', width: 'sm:max-w-md' }"
    >
      <UCard
        :ui="{
          ring: '',
          divide: 'divide-y divide-gray-100',
          rounded: 'rounded-sm',
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
