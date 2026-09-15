<script setup lang="ts">
import { Background } from "@vue-flow/background";
import type { Node, Edge, NodeTypesObject } from "@vue-flow/core";
import PortNode from "~/components/map/CoreTransaction/PortNode.vue";
import { Position, VueFlow, useVueFlow } from "@vue-flow/core";
import { useDiagramExport } from "~/composables/useDiagramExport";
import { getCoreColor } from "~/utils/coreColors";

const { layout } = useLayout();
const { fitView } = useVueFlow();
const { exportToPdf, exportMapToPdf } = useDiagramExport();

// Pick the first non-empty string across multiple plausible payload paths.
const pickRemarks = (...candidates: any[]): string => {
  for (const v of candidates) {
    if (typeof v === "string" && v.trim().length > 0) return v;
  }
  return "";
};

const props = defineProps<{
  modelValue: boolean;
  assetId: string | number;
  type: string | null;
}>();

// Computed property to get the correct ID based on type
const itemId = computed(() => props.assetId);

const diagramContainer = ref<HTMLElement | null>(null);
const mapContainer = ref<HTMLElement | null>(null);
const tableContainer = ref<HTMLElement | null>(null);
const mapFiberDiagramRef = ref<any>(null); // New ref
const toast = useToast();
const selectedTab = ref(0);
// Tab items for UTabs
const tabItems = [
  {
    key: "diagram",
    label: "Diagram View",
  },
  {
    key: "table",
    label: "Table View",
  },
  {
    key: "map",
    label: "Map View",
  },
];

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});
const closeModal = () => {
  isOpen.value = false;
};

// VueFlow State
const nodes = ref<Node[]>([]);
const edges = ref<Edge[]>([]);
const isLoading = ref(false);
const error = ref<string | null>(null);

// Asset detail state
const assetDetail = ref<any>(null);
const cableDetail = ref<any>(null);
const isLoadingAsset = ref(false);

// Table view state
const tableData = ref<PortConnection[]>([]);
const isLoadingTable = ref(false);
const tableError = ref<string | null>(null);

// Filter table data to only show ports/cores with transactions
const filteredTableData = computed(() => {
  return tableData.value.filter(
    (port) => port.transactions && port.transactions.length > 0,
  );
});

// Map modal state
const showMapModal = ref(false);
const selectedNodeData = ref<{
  itemType: string;
  itemTypeId: string;
} | null>(null);
const mapDataToShow = ref<any>(null);
const isLoadingMapData = ref(false);

// Cable-core remarks (lives inside the Show-on-Map modal for cable cores).
const remarksInput = ref("");
const isSavingRemarks = ref(false);
const remarksInputRef = ref<any>(null);

// When the modal opens for a cable core, focus the remarks input so the user
// can type immediately (VueFlow keeps the canvas focused after node click).
const focusRemarksInput = () => {
  const root = remarksInputRef.value?.$el ?? remarksInputRef.value;
  if (!root) return false;
  const el: HTMLInputElement | null =
    typeof root.querySelector === "function"
      ? root.querySelector("input, textarea")
      : null;
  const target = el || (root as HTMLElement);
  if (target && typeof (target as any).focus === "function") {
    (target as HTMLElement).focus();
    if ((target as HTMLInputElement).select) {
      try {
        (target as HTMLInputElement).select();
      } catch {}
    }
    return document.activeElement === target;
  }
  return false;
};

watch(
  [showMapModal, () => selectedNodeData.value?.itemType],
  async ([open, itemType]) => {
    if (open && itemType === "cable_cores") {
      // Retry focus across a few frames — UModal mounts behind a transition,
      // and VueFlow may try to re-focus its canvas right after node click.
      const tryFocus = (attemptsLeft: number) => {
        if (focusRemarksInput()) return;
        if (attemptsLeft <= 0) return;
        setTimeout(() => tryFocus(attemptsLeft - 1), 60);
      };
      await nextTick();
      tryFocus(8);
    }
  },
);

// Register custom node types
const nodeTypes: NodeTypesObject = {
  portNode: PortNode as any,
};

// Fetch core connections data
const authStore = useAuth();

// Fetch asset detail
const fetchAssetDetail = async () => {
  if (!props.assetId) return;

  isLoadingAsset.value = true;

  try {
    const response = await $fetch<{ data: any }>(
      `/panel/items/assets/${props.assetId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    assetDetail.value = response.data;
  } catch (err) {
    console.error("Error fetching asset detail:", err);
  } finally {
    isLoadingAsset.value = false;
  }
};

const fetchCableDetail = async () => {
  if (!itemId.value) return;

  isLoadingAsset.value = true;

  try {
    const response = await $fetch<{ data: any }>(
      `/panel/items/cables/${itemId.value}?fields=*,cable_type_id.name,cable_type_id.id`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    cableDetail.value = response.data;
  } catch (err) {
    console.error("Error fetching cable detail:", err);
  } finally {
    isLoadingAsset.value = false;
  }
};

const fetchCoreConnections = async () => {
  if (!props.assetId) return;

  isLoading.value = true;
  error.value = null;

  try {
    const response = await $fetch<CoreConnectionResponse>(
      `/panel/transactions/v1/core-connections?type=${props.type}&type_id=${props.assetId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    // Transform API response to nodes and edges
    transformDataToNodesAndEdges(response.data);
    // Also store for table view
    tableData.value = response.data;
  } catch (err) {
    console.error("Error fetching core connections:", err);
    error.value = "Failed to load fiber diagram data";
  } finally {
    isLoading.value = false;
  }
};

// Fetch table data (reuses the same endpoint)
const fetchTableData = async () => {
  if (!props.assetId) return;

  isLoadingTable.value = true;
  tableError.value = null;

  try {
    const response = await $fetch<CoreConnectionResponse>(
      `/panel/transactions/v1/core-connections?type=${props.type}&type_id=${props.assetId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    tableData.value = response.data;
  } catch (err) {
    console.error("Error fetching table data:", err);
    tableError.value = "Failed to load table data";
  } finally {
    isLoadingTable.value = false;
  }
};

const transformDataToNodesAndEdges = (data: PortConnection[]) => {
  if (props.type === "cables") {
    transformCableDataToNodesAndEdges(data);
    return;
  }

  const newNodes: Node[] = [];
  const newEdges: Edge[] = [];
  const nodeMap = new Map<string, Node>(); // Track unique nodes by port ID

  const horizontalSpacing = 250;
  const verticalSpacing = 50;

  // First pass: Collect all unique ports (source and target)
  data.forEach((portConnection, portIdx) => {
    // Create source node from the port
    const sourcePortId = `port-${portConnection.id}`;

    const label = `Assets ${portConnection.type_info?.asset_type_name || "Unknown"} ${portConnection.type_info?.name || ""}\nPort ${portConnection.number ?? "N/A"} - ${portConnection.port_type || "Unknown"}`;

    if (!nodeMap.has(sourcePortId)) {
      const sourceNode: Node = {
        id: sourcePortId,
        type: "portNode",
        position: {
          x: 0,
          y: portIdx * verticalSpacing,
        },
        data: {
          label,
          color: "#10B981",
          status: "enabled" as const,
          type: "port" as const,
        },
        draggable: true,
      };
      nodeMap.set(sourcePortId, sourceNode);
    }

    // Collect target nodes from transactions
    portConnection.transactions.forEach((transaction) => {
      if (transaction.item_type === "asset_ports") {
        const targetPortId = `port-${
          transaction.item_type_id ? transaction.item_type_id : transaction.id
        }`;

        if (!nodeMap.has(targetPortId)) {
          const targetNode: Node = {
            id: targetPortId,
            type: "portNode",
            position: {
              x: horizontalSpacing,
              y: 0,
            },
            data: {
              label: `${transaction.type_info?.asset_type_name || "Unknown Asset"} ${transaction.type_info?.name}${transaction.item_type_info?.number ? `\nPort ${transaction.item_type_info?.number}` : ""}${transaction.item_type_info?.port_type ? ` - ${transaction.item_type_info?.port_type}` : ""}`,
              color: "#10B981",
              status: "used" as const,
              type: "port" as const,
            },
            draggable: true,
          };
          nodeMap.set(targetPortId, targetNode);
        }
      } else if (transaction.item_type === "cable_cores") {
        const cableNodeId = `cable-${transaction.item_type_id}-from-${sourcePortId}`;
        const remarks = pickRemarks(
          (transaction.item_type_info as any)?.remark,
          (transaction.item_type_info as any)?.remarks,
        );
        const baseLabel = `Cables ${transaction.type_info?.name || "Unknown Cable"}\nTube ${transaction.item_type_info?.tube ?? "N/A"} - Core ${transaction.item_type_info?.core ?? "N/A"}`;

        const cableNode: Node = {
          id: cableNodeId,
          type: "portNode",
          position: {
            x: horizontalSpacing / 2,
            y: 0,
          },
          data: {
            label: remarks ? `${baseLabel}\nRemarks: ${remarks}` : baseLabel,
            color: "#3B82F6",
            tubeColor:
              transaction.item_type_info?.tube_color ||
              (transaction.item_type_info?.tube
                ? getCoreColor(transaction.item_type_info.tube)
                : null),
            coreColor: transaction.item_type_info?.core_color || null,
            status: "used" as const,
            type: "core" as const,
            coreNumber: transaction.item_type_info?.core,
            cableCoreId: transaction.item_type_id,
            remarks,
          },
          draggable: true,
        };
        nodeMap.set(cableNodeId, cableNode);
      }
    });
  });

  // Second pass: Create edges from transactions (sequential chain)
  data.forEach((portConnection) => {
    const sourcePortId = `port-${portConnection.id}`;
    let previousNodeId = sourcePortId;

    portConnection.transactions.forEach((transaction) => {
      let currentTargetId = "";

      if (transaction.item_type === "asset_ports") {
        currentTargetId = `port-${
          transaction.item_type_id ? transaction.item_type_id : transaction.id
        }`;
      } else if (transaction.item_type === "cable_cores") {
        currentTargetId = `cable-${transaction.item_type_id}-from-${sourcePortId}`;
      }

      if (currentTargetId) {
        newEdges.push({
          id: transaction.id,
          source: previousNodeId,
          target: currentTargetId,
          type: "straight",
          style: {
            stroke: transaction.type === "cables" ? "#3B82F6" : "#10B981",
            strokeWidth: 2,
          },
        });

        previousNodeId = currentTargetId;
      }
    });
  });

  // Convert node map to array and improve positioning
  const nodesArray = Array.from(nodeMap.values());

  // Chain-based positioning
  data.forEach((portConnection, chainIdx) => {
    const sourcePortId = `port-${portConnection.id}`;
    const sourceNode = nodeMap.get(sourcePortId);

    if (sourceNode) {
      sourceNode.position.x = 50;
      sourceNode.position.y = 50 + chainIdx * (verticalSpacing * 4);
    }

    let currentX = 50 + horizontalSpacing;

    portConnection.transactions.forEach((transaction) => {
      let currentNodeId = "";

      if (transaction.item_type === "asset_ports") {
        currentNodeId = `port-${transaction.item_type_id}`;
      } else if (transaction.item_type === "cable_cores") {
        currentNodeId = `cable-${transaction.item_type_id}-from-${sourcePortId}`;
      }

      if (currentNodeId) {
        const currentNode = nodeMap.get(currentNodeId);
        if (currentNode) {
          currentNode.position.x = currentX;
          currentNode.position.y = 50 + chainIdx * (verticalSpacing * 4);
        }

        currentX += horizontalSpacing;
      }
    });
  });

  nodes.value = nodesArray;
  edges.value = newEdges;
};

// Cable-specific transform: layout as B-asset (left) → Cable Core (center) → F-asset (right)
const transformCableDataToNodesAndEdges = (data: PortConnection[]) => {
  const nodeMap = new Map<string, Node>();
  const newEdges: Edge[] = [];

  const horizontalSpacing = 300;
  const verticalSpacing = 90;

  // Cable core is always the anchor at center
  const centerX = 350;
  const leftX = centerX - horizontalSpacing;
  const rightX = centerX + horizontalSpacing;

  // Group data by core id (same core has side F and side B)
  const coreGroups = new Map<
    number,
    { F?: PortConnection; B?: PortConnection }
  >();
  data.forEach((portConnection) => {
    const coreId = portConnection.id;
    if (!coreGroups.has(coreId)) {
      coreGroups.set(coreId, {});
    }
    const group = coreGroups.get(coreId)!;
    if (portConnection.side === "F") {
      group.F = portConnection;
    } else if (portConnection.side === "B") {
      group.B = portConnection;
    }
  });

  let rowIdx = 0;
  coreGroups.forEach((group, coreId) => {
    const ref = group.F || group.B;
    if (!ref) return;

    const yPos = 50 + rowIdx * verticalSpacing;

    // Center node: Cable Core (always anchored at center)
    const cableNodeId = `cable-core-${coreId}`;
    const refF: any = group.F;
    const refB: any = group.B;
    const remarks = pickRemarks(
      refF?.remark,
      refB?.remark,
      refF?.item_type_info?.remark,
      refB?.item_type_info?.remark,
      refF?.transactions?.[0]?.item_type_info?.remark,
      refB?.transactions?.[0]?.item_type_info?.remark,
      // legacy fallback (plural)
      refF?.remarks,
      refB?.remarks,
      refF?.item_type_info?.remarks,
      refB?.item_type_info?.remarks,
    );
    const baseLabel = `Cables ${ref.type_info?.name || "Unknown"}\nTube ${ref.tube ?? "N/A"} - Core ${ref.core ?? "N/A"}`;
    const cableNode: Node = {
      id: cableNodeId,
      type: "portNode",
      position: { x: centerX, y: yPos },
      data: {
        label: remarks ? `${baseLabel}\nRemarks: ${remarks}` : baseLabel,
        color: "#3B82F6",
        tubeColor: ref.tube_color || (ref.tube ? getCoreColor(ref.tube) : null),
        coreColor: ref.core_color || null,
        status: "enabled" as const,
        type: "core" as const,
        coreNumber: ref.core,
        cableCoreId: coreId,
        remarks,
      },
      draggable: true,
    };
    nodeMap.set(cableNodeId, cableNode);

    // Left side: B (Back) side transaction assets
    if (group.B && group.B.transactions.length > 0) {
      group.B.transactions.forEach((transaction) => {
        if (transaction.item_type === "asset_ports") {
          const assetNodeId = `port-${transaction.item_type_id || transaction.id}-B`;
          if (!nodeMap.has(assetNodeId)) {
            const assetNode: Node = {
              id: assetNodeId,
              type: "portNode",
              position: { x: leftX, y: yPos },
              data: {
                label: `Assets ${transaction.type_info?.asset_type_name || "Unknown"} ${transaction.type_info?.name || ""}${transaction.item_type_info?.number ? `\nPort ${transaction.item_type_info?.number}` : ""}${transaction.item_type_info?.port_type ? ` - ${transaction.item_type_info?.port_type}` : ""}`,
                color: "#10B981",
                status: "used" as const,
                type: "port" as const,
                side: "left",
              },
              draggable: true,
            };
            nodeMap.set(assetNodeId, assetNode);
          }

          // Edge: B-asset → Cable Core
          newEdges.push({
            id: `${transaction.id}-B`,
            source: assetNodeId,
            target: cableNodeId,
            type: "straight",
            style: { stroke: "#3B82F6", strokeWidth: 2 },
          });
        }
      });
    }

    // Right side: F (Front) side transaction assets
    if (group.F && group.F.transactions.length > 0) {
      group.F.transactions.forEach((transaction) => {
        if (transaction.item_type === "asset_ports") {
          const assetNodeId = `port-${transaction.item_type_id || transaction.id}-F`;
          if (!nodeMap.has(assetNodeId)) {
            const assetNode: Node = {
              id: assetNodeId,
              type: "portNode",
              position: { x: rightX, y: yPos },
              data: {
                label: `${transaction.type_info?.asset_type_name || "Unknown"} ${transaction.type_info?.name || ""}${transaction.item_type_info?.number ? `\nPort ${transaction.item_type_info?.number}` : ""}${transaction.item_type_info?.port_type ? ` - ${transaction.item_type_info?.port_type}` : ""}`,
                color: "#10B981",
                status: "used" as const,
                type: "port" as const,
                side: "right",
              },
              draggable: true,
            };
            nodeMap.set(assetNodeId, assetNode);
          }

          // Edge: Cable Core → F-asset
          newEdges.push({
            id: `${transaction.id}-F`,
            source: cableNodeId,
            target: assetNodeId,
            type: "straight",
            style: { stroke: "#10B981", strokeWidth: 2 },
          });
        }
      });
    }

    rowIdx++;
  });

  nodes.value = Array.from(nodeMap.values());
  edges.value = newEdges;
};

// Watch for modal open and asset ID changes
watch(
  () => [isOpen.value, props.assetId],
  ([open, assetId]) => {
    if (open && assetId) {
      fetchCoreConnections();
      if (props.type === "assets") {
        fetchAssetDetail();
      } else {
        fetchCableDetail();
      }
      fetchTableData();
    }
  },
  { immediate: true },
);

async function layoutGraph(direction: any) {
  nodes.value = layout(nodes.value, edges.value, direction);

  nextTick(() => {
    fitView();
  });
}

// Handle node click to display asset/cable ID and show map modal
const onNodeClick = (nodeMouseEvent: any) => {
  const { node } = nodeMouseEvent;

  let itemType = "";
  let itemTypeId = "";

  if (node.data.type === "port") {
    itemType = "asset_ports";
    itemTypeId = node.id.replace("port-", "");
  } else if (node.data.type === "core") {
    itemType = "cable_cores";
    itemTypeId = String(node.data?.cableCoreId ?? node.id.split("-")[1]);
    remarksInput.value = node.data?.remarks || "";
  }

  if (itemType && itemTypeId) {
    // Release VueFlow's hold on focus before the modal opens so its focus-trap can work.
    if (typeof document !== "undefined") {
      const active = document.activeElement as HTMLElement | null;
      active?.blur?.();
    }
    selectedNodeData.value = { itemType, itemTypeId };
    showMapModal.value = true;
  }
};

const handleSaveRemarks = async () => {
  const id = selectedNodeData.value?.itemTypeId;
  if (!id || selectedNodeData.value?.itemType !== "cable_cores") return;
  isSavingRemarks.value = true;
  try {
    await $fetch(`/panel/items/cable_cores/${id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: { remark: remarksInput.value },
    });

    toast.add({
      title: "Remarks saved",
      description: "Cable core remarks updated successfully",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });

    closeMapModal();
    // Refresh diagram so the new remarks show up in the cable node label.
    await fetchCoreConnections();
  } catch (err) {
    console.error("Error saving cable core remarks:", err);
    toast.add({
      title: "Error",
      description: "Failed to save remarks",
      color: "red",
    });
  } finally {
    isSavingRemarks.value = false;
  }
};

// Handle showing connection on map
const handleShowOnMap = async () => {
  if (!selectedNodeData.value) return;

  isLoadingMapData.value = true;

  try {
    const { itemType, itemTypeId } = selectedNodeData.value;
    const response = await $fetch<any>(
      `/panel/transactions/v1/core-connections-map?item_type=${itemType}&item_type_id=${itemTypeId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    // Close modal first
    showMapModal.value = false;

    // Switch to map tab (index 2) BEFORE setting data
    selectedTab.value = 2;

    // Wait for DOM update and component mounting
    await nextTick();

    // Small additional delay to ensure map component is fully initialized
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Then set the map data (this will trigger the watcher in FiberDiagramMap)
    mapDataToShow.value = response.data;
  } catch (error) {
    console.error("Error fetching map data:", error);
    // TODO: Show error toast notification
  } finally {
    isLoadingMapData.value = false;
  }
};

// Close map modal
const closeMapModal = () => {
  showMapModal.value = false;
  selectedNodeData.value = null;
  remarksInput.value = "";
};

// Export state
const isExporting = ref(false);

// Export table to Excel via API
const handleExportTable = async () => {
  try {
    const response = await fetch(
      `/panel/transactions/v1/core-connections/excel?type=${props.type}&type_id=${props.assetId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    // Get the blob from the response
    const blob = await response.blob();

    // Create a download link
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;

    // Generate filename with asset/cable info and timestamp
    const timestamp = new Date().toISOString().split("T")[0];
    const typeName = props.type === "assets" ? "Asset" : "Cable";
    const assetInfo =
      props.type === "assets" ? assetDetail.value : cableDetail.value;
    const name = assetInfo?.name || assetInfo?.code || props.assetId;
    a.download = `Fiber_Connections_${typeName}_${name}_${timestamp}.xlsx`;

    // Trigger download
    document.body.appendChild(a);
    a.click();

    // Cleanup
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    toast.add({
      title: "Export Successful",
      description: "Table exported to Excel successfully.",
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } catch (error) {
    console.error("Error exporting table:", error);
    throw error;
  }
};

// Export diagram to PDF
const handleExportDiagram = async () => {
  if (!diagramContainer.value) {
    toast.add({
      title: "Export Failed",
      description: "Diagram container not found.",
      color: "red",
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
    const timestamp = new Date().toISOString().split("T")[0];
    const assetInfo =
      props.type === "assets" ? assetDetail.value : cableDetail.value;
    const name = assetInfo?.name || assetInfo?.code || props.assetId;
    const filename = `Fiber_Diagram_${name}_${timestamp}`;

    await exportToPdf(diagramContainer.value, filename);

    toast.add({
      title: "Export Successful",
      description: "Diagram exported to PDF successfully.",
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } catch (error) {
    console.error("Error exporting diagram:", error);
    throw error;
  }
};

// Export map to PDF
const handleExportMap = async () => {
  if (!mapFiberDiagramRef.value?.localMap) {
    toast.add({
      title: "Export Failed",
      description: "Map instance not available for export.",
      color: "red",
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
    const timestamp = new Date().toISOString().split("T")[0];
    const assetInfo =
      props.type === "assets" ? assetDetail.value : cableDetail.value;
    const name = assetInfo?.name || assetInfo?.code || props.assetId;
    const filename = `Fiber_Map_${name}_${timestamp}`;

    await exportMapToPdf(mapFiberDiagramRef.value.localMap, filename); // Pass localMap

    toast.add({
      title: "Export Successful",
      description: "Map exported to PDF successfully.",
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } catch (error) {
    console.error("Error exporting map:", error);
    throw error;
  }
};

// Handle export based on current view
const handleExport = async () => {
  if (isExporting.value) return;

  isExporting.value = true;

  try {
    if (selectedTab.value === 0) {
      await handleExportDiagram();
    } else if (selectedTab.value === 1) {
      await handleExportTable();
    } else if (selectedTab.value === 2) {
      await handleExportMap();
    }
  } catch (error) {
    console.error("Export error:", error);
    toast.add({
      title: "Export Failed",
      description: "An error occurred while exporting. Please try again.",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  } finally {
    isExporting.value = false;
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
              Fiber Diagram
            </h3>
            <p class="mt-1 text-xs text-gray-500">
              Browse through asset ports and cables connection.
            </p>
          </div>
          <UButton
            color="gray"
            variant="ghost"
            icon="i-heroicons-x-mark-20-solid"
            class="-my-1"
            @click="closeModal"
          />
        </div>
      </template>
      <UTabs
        variant="link"
        v-model="selectedTab"
        :items="tabItems"
        class="w-full"
        :ui="{
          list: {
            tab: { rounded: 'rounded-xxs', base: 'rounded-xxs' },
            rounded: 'rounded-xxs',
            marker: { rounded: 'rounded-xxs' },
          },
        }"
      >
        <template #item="{ item }">
          <div
            v-if="item.key === 'diagram'"
            ref="diagramContainer"
            class="border border-grey-200 rounded-xs bg-grey-50 h-[calc(100vh-17rem)] w-full overflow-hidden relative"
          >
            <!-- Loading State -->
            <div
              v-if="isLoading"
              class="absolute inset-0 flex items-center justify-center bg-grey-50 z-10"
            >
              <div
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center"
                >
                  <UIcon
                    name="i-heroicons-arrow-path"
                    class="w-6 h-6 text-gray-400 animate-spin"
                  />
                </div>
                <p class="text-sm text-gray-600 font-medium">
                  Loading fiber diagram...
                </p>
                <p class="text-xs text-gray-500">
                  Fetching port connections and cables data
                </p>
              </div>
            </div>

            <!-- Error State -->
            <div
              v-else-if="error"
              class="absolute inset-0 flex items-center justify-center bg-grey-50 z-10"
            >
              <div
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
                <p class="text-sm text-gray-600 font-medium">
                  Failed to load diagram
                </p>
                <p class="text-xs text-gray-500">{{ error }}</p>
                <UButton
                  size="sm"
                  color="primary"
                  @click="fetchCoreConnections"
                >
                  <UIcon name="i-heroicons-arrow-path" class="w-4 h-4 mr-1" />
                  Retry
                </UButton>
              </div>
            </div>

            <!-- Empty State (No Data) -->
            <div
              v-else-if="!nodes.length"
              class="absolute inset-0 flex items-center justify-center bg-grey-50 z-10"
            >
              <div
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center"
                >
                  <UIcon
                    name="i-heroicons-inbox"
                    class="w-6 h-6 text-gray-400"
                  />
                </div>
                <p class="text-sm text-gray-600 font-medium">
                  No connections found
                </p>
                <p class="text-xs text-gray-500">
                  This asset has no fiber port connections to display
                </p>
              </div>
            </div>

            <!-- VueFlow Diagram -->
            <VueFlow
              v-else
              :nodes="nodes"
              :edges="edges"
              :node-types="nodeTypes"
              :pan-on-scroll="true"
              :pan-on-drag="true"
              :zoom-on-scroll="true"
              :zoom-on-pinch="true"
              :zoom-on-double-click="false"
              @nodes-initialized="
                props.type === 'cables' ? fitView() : layoutGraph('LR')
              "
              @node-click="onNodeClick"
              class="h-full w-full overflow-x-auto overflow-y-hidden"
            >
              <Background pattern-color="#aaa" :gap="16" />
              <Panel position="top-left">
                <div
                  class="m-2 p-3 bg-white border border-grey-200 rounded-xs shadow-sm max-w-md absolute z-50 w-[25%]"
                >
                  <template v-if="isLoadingAsset">
                    <div class="flex items-center gap-2 text-grey-600">
                      <div
                        class="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin"
                      />
                      <p class="text-sm">Loading asset details...</p>
                    </div>
                  </template>
                  <template v-else-if="assetDetail || cableDetail">
                    <UAccordion
                      :items="[
                        {
                          label: 'Asset Details',
                          defaultOpen: false,
                        },
                      ]"
                    >
                      <template #default="{ item, index, open }">
                        <UButton
                          color="gray"
                          variant="ghost"
                          class="w-full"
                          :ui="{
                            rounded: 'rounded-xs',
                            padding: { sm: 'p-0' },
                          }"
                        >
                          <p class="font-semibold text-grey-900">
                            Detail
                            {{ props.type === "assets" ? "Asset" : "Cable" }}
                            Info
                          </p>
                          <template #trailing>
                            <UIcon
                              name="i-heroicons-chevron-down-20-solid"
                              class="w-5 h-5 ms-auto transform transition-transform duration-200"
                              :class="[open && 'rotate-180']"
                            />
                          </template>
                        </UButton>
                      </template>
                      <template v-if="assetDetail" #item="{ item }">
                        <div class="space-y-2 text-sm border-t pt-2">
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600">Name</span>
                            <span class="font-semibold text-black text-xs">{{
                              assetDetail.name || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600">Code</span>
                            <span class="font-semibold text-black text-xs">{{
                              assetDetail.code || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600">Description</span>
                            <span class="font-semibold text-black text-xs">{{
                              assetDetail.description || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600">Tag ID</span>
                            <span class="font-semibold text-black text-xs">{{
                              assetDetail.tag_id || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600">RFID</span>
                            <span class="font-semibold text-black text-xs">{{
                              assetDetail.rfid || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600">Location</span>
                            <span class="font-semibold text-black text-xs">{{
                              assetDetail.location || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600">Location Detail</span>
                            <span class="font-semibold text-black text-xs">{{
                              assetDetail.location_detail || "-"
                            }}</span>
                          </div>
                        </div>
                      </template>
                      <template v-else #item="{ item }">
                        <div class="space-y-2 text-sm border-t pt-2">
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600 text-xs">Name</span>
                            <span class="font-semibold text-black text-xs">{{
                              cableDetail.name || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600 text-xs">Code</span>
                            <span class="font-semibold text-black text-xs">{{
                              cableDetail.code || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600 text-xs"
                              >Cable Type</span
                            >
                            <span class="font-semibold text-black text-xs">{{
                              cableDetail.cable_type_id.name || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600 text-xs"
                              >Serial Number</span
                            >
                            <span class="font-semibold text-black text-xs">{{
                              cableDetail.serial_number || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600 text-xs"
                              >Description</span
                            >
                            <span class="font-semibold text-black text-xs">{{
                              cableDetail.description || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600 text-xs">Tag ID</span>
                            <span class="font-semibold text-black text-xs">{{
                              cableDetail.tag_id || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600 text-xs">RFID</span>
                            <span class="font-semibold text-black text-xs">{{
                              cableDetail.rfid || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600 text-xs">Location</span>
                            <span class="font-semibold text-black text-xs">{{
                              cableDetail.location || "-"
                            }}</span>
                          </div>
                          <div class="grid grid-cols-2">
                            <span class="text-grey-600 text-xs"
                              >Location Detail</span
                            >
                            <span class="font-semibold text-black text-xs">{{
                              cableDetail.location_detail || "-"
                            }}</span>
                          </div>
                        </div>
                      </template>
                    </UAccordion>
                  </template>
                </div>
              </Panel>
            </VueFlow>
          </div>
          <!-- Table View Tab -->
          <div
            v-if="item.key === 'table'"
            ref="tableContainer"
            class="border border-grey-200 rounded-xs bg-white h-[calc(100vh-17rem)] w-full overflow-hidden flex flex-col"
          >
            <!-- Loading State -->
            <div
              v-if="isLoadingTable"
              class="flex-1 flex items-center justify-center"
            >
              <div
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center"
                >
                  <UIcon
                    name="i-heroicons-arrow-path"
                    class="w-6 h-6 text-gray-400 animate-spin"
                  />
                </div>
                <p class="text-sm text-gray-600 font-medium">
                  Loading table view...
                </p>
                <p class="text-xs text-gray-500">
                  Fetching fiber connection data
                </p>
              </div>
            </div>

            <!-- Error State -->
            <div
              v-else-if="tableError"
              class="flex-1 flex items-center justify-center"
            >
              <div
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
                <p class="text-sm text-gray-600 font-medium">
                  Failed to load table
                </p>
                <p class="text-xs text-gray-500">{{ tableError }}</p>
                <UButton size="sm" color="primary" @click="fetchTableData">
                  <UIcon name="i-heroicons-arrow-path" class="w-4 h-4 mr-1" />
                  Retry
                </UButton>
              </div>
            </div>

            <!-- Empty State (No Data) -->
            <div
              v-else-if="!filteredTableData || filteredTableData.length === 0"
              class="flex-1 flex items-center justify-center"
            >
              <div
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center"
                >
                  <UIcon
                    name="i-heroicons-inbox"
                    class="w-6 h-6 text-gray-400"
                  />
                </div>
                <p class="text-sm text-gray-600 font-medium">
                  No connections found
                </p>
                <p class="text-xs text-gray-500">
                  This asset has no fiber port connections to display in table
                  format
                </p>
              </div>
            </div>

            <!-- Table Data -->
            <div v-else class="flex-1 overflow-auto p-4">
              <div class="space-y-6">
                <div
                  v-for="(port, idx) in filteredTableData"
                  :key="port.id"
                  class="border border-grey-200 rounded-xs overflow-hidden"
                >
                  <div
                    class="bg-grey-50 px-4 py-3 border-b border-grey-200 font-semibold text-sm"
                  >
                    Port {{ port.number ?? "N/A" }} -
                    {{ port.port_type || "Unknown" }} ({{ port.path || "N/A" }})
                  </div>
                  <div class="overflow-x-auto">
                    <table class="min-w-full divide-y divide-grey-200">
                      <thead class="bg-grey-50">
                        <tr>
                          <th
                            class="px-4 py-3 text-left font-medium text-grey-600 text-xs uppercase tracking-wider"
                          >
                            Type
                          </th>
                          <th
                            class="px-4 py-3 text-left font-medium text-grey-600 text-xs uppercase tracking-wider"
                          >
                            Name
                          </th>
                          <th
                            class="px-4 py-3 text-left text-xs font-medium text-grey-600 uppercase tracking-wider"
                          >
                            Item Type
                          </th>
                          <th
                            class="px-4 py-3 text-left text-xs font-medium text-grey-600 uppercase tracking-wider"
                          >
                            Details
                          </th>
                        </tr>
                      </thead>
                      <tbody class="bg-white divide-y divide-grey-200">
                        <tr
                          v-for="transaction in port.transactions"
                          :key="transaction.id"
                          class="hover:bg-grey-50"
                        >
                          <td class="px-4 py-3 text-sm text-grey-900">
                            <span
                              class="inline-flex items-center px-2 py-1 rounded-xs text-xs font-medium"
                              :class="
                                transaction.type === 'cables'
                                  ? 'bg-blue-100 text-blue-800'
                                  : 'bg-green-100 text-green-800'
                              "
                            >
                              {{
                                transaction.type === "cables"
                                  ? "Cable"
                                  : "Asset"
                              }}
                            </span>
                          </td>
                          <td class="px-4 py-3 text-sm text-grey-900">
                            {{ transaction.type_info.name || "-" }}
                          </td>
                          <td class="px-4 py-3 text-sm text-grey-900">
                            <span
                              class="inline-flex items-center px-2 py-1 rounded-xs text-xs font-medium bg-grey-100 text-grey-800"
                            >
                              {{
                                transaction.item_type === "cable_cores"
                                  ? "Cable Core"
                                  : "Asset Port"
                              }}
                            </span>
                          </td>
                          <td class="px-4 py-3 text-sm text-grey-600">
                            <template
                              v-if="transaction.item_type === 'cable_cores'"
                            >
                              <span
                                class="p-1 rounded-xxs text-white"
                                :style="
                                  transaction.item_type_info?.tube_color
                                    ? {
                                        backgroundColor:
                                          transaction.item_type_info.tube_color,
                                      }
                                    : {}
                                "
                              >
                                Tube
                                {{ transaction.item_type_info?.tube ?? "N/A" }}
                              </span>
                              -
                              <span
                                class="p-1 rounded-xxs text-white"
                                :style="
                                  transaction.item_type_info?.core_color
                                    ? {
                                        backgroundColor:
                                          transaction.item_type_info.core_color,
                                      }
                                    : {}
                                "
                              >
                                Core
                                {{ transaction.item_type_info?.core ?? "N/A" }}
                              </span>
                            </template>
                            <template v-else>
                              {{
                                transaction.item_type_info
                                  ? `Port ${
                                      transaction.item_type_info?.number ??
                                      "N/A"
                                    }`
                                  : `${transaction.type_info?.asset_type_name} ${transaction.type_info?.name}`
                              }}
                              <!-- Port
                              {{ transaction.item_type_info?.number ?? "N/A" }} -->

                              {{
                                transaction.item_type_info
                                  ? `${
                                      transaction.item_type_info?.port_type ||
                                      "Unknown"
                                    }`
                                  : ""
                              }}
                            </template>
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- Map View Tab -->
          <div
            v-if="item.key === 'map'"
            ref="mapContainer"
            class="border border-grey-200 rounded-xs bg-grey-50 h-[calc(100vh-17rem)] w-full overflow-hidden"
          >
            <div
              v-if="!tableData || tableData.length === 0"
              class="flex-1 flex items-center justify-center h-full"
            >
              <div
                class="flex flex-col items-center justify-center py-16 space-y-3"
              >
                <div
                  class="w-12 h-12 rounded-full bg-gray-100 flex items-center justify-center"
                >
                  <UIcon
                    name="i-heroicons-inbox"
                    class="w-6 h-6 text-gray-400"
                  />
                </div>
                <p class="text-sm text-gray-600 font-medium">
                  No connections found
                </p>
                <p class="text-xs text-gray-500">
                  This asset has no fiber port connections to display in map
                  format
                </p>
              </div>
            </div>
            <MapToolsFiberDiagramMap
              v-else
              ref="mapFiberDiagramRef"
              :asset-id="assetId"
              :connection-data="mapDataToShow"
            />
          </div>
        </template>
      </UTabs>

      <template #footer>
        <div>
          <UButton
            label="Export Current View"
            block
            variant="outline"
            color="gray"
            size="md"
            :loading="isExporting"
            :disabled="isExporting"
            :ui="{ rounded: 'rounded-xxs' }"
            @click="handleExport"
          />
        </div>
      </template>
    </UCard>
  </UModal>

  <!-- Show on Map Confirmation Modal -->
  <UModal
    v-model="showMapModal"
    :ui="{ rounded: 'rounded-xs', width: 'sm:max-w-md' }"
  >
    <UCard
      :ui="{
        ring: '',
        divide: 'divide-y divide-gray-100',
        rounded: 'rounded-xs',
      }"
    >
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold leading-6 text-gray-900">
            Show Connection on Map
          </h3>
          <UButton
            color="gray"
            variant="ghost"
            icon="i-heroicons-x-mark-20-solid"
            class="-my-1"
            @click="closeMapModal"
          />
        </div>
      </template>

      <div class="space-y-3">
        <p class="text-sm text-gray-600">
          Would you like to view this connection on the map?
        </p>
        <p class="text-xs text-gray-500">
          This will switch to the map tab and display the spatial connection
          data.
        </p>

        <!-- Remarks section (only for cable cores) -->
        <div
          v-if="selectedNodeData?.itemType === 'cable_cores'"
          class="pt-3 border-t border-gray-200 space-y-2"
        >
          <label class="text-xs font-medium text-gray-700 block">Remarks</label>
          <div class="flex gap-2">
            <UInput
              ref="remarksInputRef"
              v-model="remarksInput"
              placeholder="Add remarks for this cable core"
              :disabled="isSavingRemarks"
              autofocus
              class="flex-1"
              :ui="{ rounded: 'rounded-xxs' }"
              @keydown.stop
              @keypress.stop
              @keyup.stop
            />
            <UButton
              label="Add Remarks"
              color="primary"
              :loading="isSavingRemarks"
              :disabled="!remarksInput || isLoadingMapData"
              :ui="{ rounded: 'rounded-xxs' }"
              @click="handleSaveRemarks"
            />
          </div>
        </div>
      </div>

      <template #footer>
        <div class="flex justify-end gap-2">
          <UButton
            label="Cancel"
            color="gray"
            variant="outline"
            @click="closeMapModal"
            :disabled="isLoadingMapData"
            :ui="{ rounded: 'rounded-xxs' }"
          />
          <UButton
            label="Show on Map"
            color="primary"
            :loading="isLoadingMapData"
            @click="handleShowOnMap"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>
      </template>
    </UCard>
  </UModal>
</template>
