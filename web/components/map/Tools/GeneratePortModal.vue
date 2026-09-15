<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import IcHelp from "~/assets/icons/ic-help.svg";

const props = defineProps<{
  modelValue: boolean;
  assetId: string | number;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  generated: [];
}>();

const toast = useToast();
const authStore = useAuth();
// Modal state - computed property for v-model
const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

// Form state
const portType = ref<"uplink" | "downlink" | "others" | "">("");
const portCount = ref<number>(1);
const isGenerating = ref(false);

// Generated ports tracking
interface GeneratedPort {
  id: string | number;
  asset_id: number;
  path: string;
  number: number;
  front: string;
  back: string;
  port_type: string;
  port_speed?: string | null;
  port_description?: string | null;
  sfp_connected_to_port?: string | null;
  sfp_length?: string | null;
  sfp_serial?: string | null;
  opm_dbm?: string | null;
  aggregation_code?: string | null;
  port_identifier?: string | null;
  port_status: string;
}

interface GeneratedPortGroup {
  type: "uplink/source" | "downlink/destination" | "others";
  count: number;
  ports: GeneratedPort[];
}

// Removed ref - will use computed instead

// Port type options
const portTypeOptions = [
  { label: "Uplink/Source", value: "uplink/source" },
  { label: "Downlink/Destination", value: "downlink/destination" },
  { label: "Others", value: "others" },
];

// Use TanStack Query to fetch existing ports
const {
  data: existingPortsData,
  isLoading: isLoadingExistingPorts,
  refetch: refetchExistingPorts,
} = useQuery({
  queryKey: computed(() => ["asset-ports", props.assetId]),
  queryFn: async () => {
    if (!props.assetId) return null;

    // Fetch all port types in parallel
    const fetchPortsByType = async (portType: string) => {
      const queryParams = new URLSearchParams({
        "filter[asset_id][_eq]": String(props.assetId),
        "filter[port_type][_eq]": portType,
        sort: "number",
      });

      const response = await $fetch<{ data: GeneratedPort[] }>(
        `/panel/items/asset_ports?${queryParams}`,
        {
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        }
      );

      // Sort by number field numerically to ensure correct order
      const ports = response.data || [];
      return ports.sort((a, b) => a.number - b.number);
    };

    const [uplinkPorts, downlinkPorts, othersPorts] = await Promise.all([
      fetchPortsByType("uplink/source"),
      fetchPortsByType("downlink/destination"),
      fetchPortsByType("others"),
    ]);

    const groups: GeneratedPortGroup[] = [];

    if (uplinkPorts.length > 0) {
      groups.push({
        type: "uplink/source",
        count: uplinkPorts.length,
        ports: uplinkPorts,
      });
    }

    if (downlinkPorts.length > 0) {
      groups.push({
        type: "downlink/destination",
        count: downlinkPorts.length,
        ports: downlinkPorts,
      });
    }

    if (othersPorts.length > 0) {
      groups.push({
        type: "others",
        count: othersPorts.length,
        ports: othersPorts,
      });
    }

    return groups;
  },
  enabled: computed(() => props.modelValue && !!props.assetId),
});

// Use computed to directly reference query data
const generatedPortGroups = computed(() => existingPortsData.value || []);

// Computed: Filter out already generated port types
const availablePortTypes = computed(() => {
  const generatedTypes = generatedPortGroups.value.map((g) => g.type);
  return portTypeOptions.filter(
    (option) => !generatedTypes.includes(option.value as any)
  );
});

// Computed: Check if generate button should be disabled
const isGenerateDisabled = computed(() => {
  return !portType.value || portCount.value < 1 || isGenerating.value;
});

// Generate ports function
const handleGenerate = async () => {
  if (!portType.value || portCount.value < 1) {
    toast.add({
      title: "Validation Error",
      description: "Please select port type and enter valid count",
      color: "red",
    });
    return;
  }

  isGenerating.value = true;

  try {
    await $fetch("/panel/transactions/v1/generate-ports", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify({
        asset_id: props.assetId,
        port_type: portType.value,
        port_count: portCount.value,
      }),
    });

    toast.add({
      title: "Success",
      description: `Generated ${portCount.value} ${portType.value} port(s)`,
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });

    // Refetch ports from the server to update the UI seamlessly
    await refetchExistingPorts();

    // Reset form
    portType.value = "";
    portCount.value = 1;
  } catch (error: any) {
    console.error("Error generating ports:", error);
    toast.add({
      title: "Error",
      description: error.data?.message || "Failed to generate ports",
      color: "red",
    });
  } finally {
    isGenerating.value = false;
  }
};

// Close modal
const handleClose = () => {
  emit("update:modelValue", false);
  emit("generated");

  // Reset state after modal closes
  setTimeout(() => {
    // generatedPortGroups is now computed, no need to reset it
    portType.value = "";
    portCount.value = 1;
  }, 300);
};

// Edit port state
const editingPort = ref<GeneratedPort | null>(null);
const isEditModalOpen = ref(false);
const editForm = ref({
  number: 0,
  port_speed: "",
  port_description: "",
  port_identifier: "",
  sfp_connected_to_port: "",
  sfp_length: "",
  sfp_serial: "",
  opm_dbm: "",
  aggregation_code: "",
});

// Edit modal computed for v-model
const editModalOpen = computed({
  get: () => isEditModalOpen.value,
  set: (value) => (isEditModalOpen.value = value),
});

// Get port status color class
const getPortStatusClass = (status: string) => {
  return status?.toLowerCase() === "used"
    ? "bg-gray-500 hover:bg-gray-600"
    : "bg-green-500 hover:bg-green-600";
};

// Add/Delete port states
const isAddingPort = ref(false);
const addingPortType = ref<
  "uplink/source" | "downlink/destination" | "others" | null
>(null);
const isDeletingPort = ref(false);

// Add single port function
const handleAddSinglePort = async (
  portType: "uplink/source" | "downlink/destination" | "others"
) => {
  isAddingPort.value = true;
  addingPortType.value = portType;

  try {
    await $fetch("/panel/transactions/add-port", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify({
        asset_id: props.assetId,
        port_type: portType,
        port_count: 1,
      }),
    });

    toast.add({
      title: "Success",
      description: `Added 1 ${portType} port`,
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });

    // Refetch ports to update the UI
    await refetchExistingPorts();
  } catch (error: any) {
    console.error("Error adding port:", error);
    toast.add({
      title: "Error",
      description: error.data?.message || "Failed to add port",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
  } finally {
    isAddingPort.value = false;
    addingPortType.value = null;
  }
};

// Delete last port function (right to left, highest number first)
const handleDeleteLastPort = async (
  portType: "uplink" | "downlink" | "others"
) => {
  // Find the group for this port type
  const group = generatedPortGroups.value.find((g) => g.type === portType);
  if (!group || group.ports.length === 0) return;

  // Get the last port (highest number)
  const lastPort = group.ports[group.ports.length - 1];

  isDeletingPort.value = true;

  try {
    await $fetch(`/panel/transactions/delete-port/${lastPort.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    toast.add({
      title: "Success",
      description: `Deleted ${lastPort.port_type} port ${lastPort.number}`,
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });

    // Refetch ports to update the UI
    await refetchExistingPorts();
  } catch (error: any) {
    console.error("Error deleting port:", error);
    toast.add({
      title: "Error",
      description: error.data?.message || "Failed to delete port",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
  } finally {
    isDeletingPort.value = false;
  }
};

// Open edit modal for a port
const isFetchingPort = ref(false);
const handleEditPort = async (port: GeneratedPort) => {
  isFetchingPort.value = true;

  try {
    // Fetch the latest port data from API
    const response = await $fetch<{ data: GeneratedPort }>(
      `/panel/items/asset_ports/${port.id}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      }
    );

    const latestPortData = response.data;
    editingPort.value = latestPortData;

    // Populate form with latest data
    editForm.value = {
      number: latestPortData.number || 0,
      port_speed: latestPortData.port_speed || "",
      port_description: latestPortData.port_description || "",
      port_identifier: latestPortData.port_identifier || "",
      sfp_connected_to_port: latestPortData.sfp_connected_to_port || "",
      sfp_length: latestPortData.sfp_length || "",
      sfp_serial: latestPortData.sfp_serial || "",
      opm_dbm: latestPortData.opm_dbm || "",
      aggregation_code: latestPortData.aggregation_code || "",
    };

    isEditModalOpen.value = true;
  } catch (error: any) {
    console.error("Error fetching port data:", error);
    toast.add({
      title: "Error",
      description: error.data?.message || "Failed to fetch port data",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
  } finally {
    isFetchingPort.value = false;
  }
};

// Save port configuration
const isSavingPort = ref(false);
const handleSavePort = async () => {
  if (!editingPort.value) return;

  isSavingPort.value = true;

  try {
    await $fetch(`/panel/items/asset_ports/${editingPort.value.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify(editForm.value),
    });

    toast.add({
      title: "Success",
      description: "Port configuration updated",
      color: "green",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });

    // Refetch ports to get the latest data
    await refetchExistingPorts();

    isEditModalOpen.value = false;
    editingPort.value = null;
  } catch (error: any) {
    console.error("Error updating port:", error);
    toast.add({
      title: "Error",
      description: error.data?.message || "Failed to update port",
      color: "red",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
  } finally {
    isSavingPort.value = false;
  }
};
</script>

<template>
  <UModal
    v-model="isOpen"
    :ui="{ width: 'sm:max-w-2xl', rounded: 'rounded-xxs' }"
    prevent-close
  >
    <UCard
      :ui="{
        rounded: 'rounded-xxs',
        header: { padding: 'p-2' },
        body: { padding: 'p-2' },
        footer: { padding: 'p-2' },
      }"
    >
      <template #header>
        <div class="flex items-center justify-between">
          <h1 class="text-lg font-semibold">Generate Port</h1>
          <UButton
            color="gray"
            variant="ghost"
            icon="i-heroicons-x-mark-20-solid"
            @click="handleClose"
          />
        </div>
      </template>

      <div class="space-y-6">
        <!-- Loading State -->
        <div
          v-if="isLoadingExistingPorts"
          class="flex flex-col items-center justify-center py-4 space-y-2"
        >
          <div
            class="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-500"
          ></div>
          <p class="text-sm text-gray-500">Loading existing ports...</p>
        </div>

        <!-- Port Generation Form -->
        <div v-else class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-5 gap-4">
            <!-- Port Type Select -->
            <UFormGroup label="Port Type" required class="col-span-2">
              <USelect
                v-model="portType"
                :options="availablePortTypes"
                placeholder="Select port type"
                :disabled="availablePortTypes.length === 0"
                :ui="{ rounded: 'rounded-xxs' }"
              />
            </UFormGroup>

            <!-- Port Count Input -->
            <UFormGroup label="Count of Port" required class="col-span-2">
              <UInput
                v-model.number="portCount"
                type="number"
                placeholder="Enter count"
                :min="1"
                :max="100"
              />
            </UFormGroup>
            <div class="flex items-end col-span-1">
              <UButton
                label="Generate"
                color="primary"
                size="sm"
                block
                :disabled="isGenerateDisabled"
                :loading="isGenerating"
                @click="handleGenerate"
                :ui="{ rounded: 'rounded-xxs' }"
              />
            </div>
          </div>

          <!-- Generate Button -->
          <div class="flex justify-end"></div>

          <!-- Divider -->
          <UDivider v-if="generatedPortGroups.length > 0" />

          <!-- Empty State -->
          <div
            v-if="generatedPortGroups.length === 0"
            class="flex flex-col items-center justify-center py-8 space-y-3"
          >
            <div
              class="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                class="h-8 w-8 text-gray-400"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  stroke-linecap="round"
                  stroke-linejoin="round"
                  stroke-width="2"
                  d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                />
              </svg>
            </div>
            <div class="text-center">
              <p class="text-sm font-medium text-gray-900">
                No ports generated yet
              </p>
              <p class="text-xs text-gray-500 mt-1">
                Select a port type and count to generate ports
              </p>
            </div>
          </div>

          <!-- Generated Ports Display -->
          <div v-else class="space-y-6">
            <div
              v-for="group in generatedPortGroups"
              :key="group.type"
              class="space-y-2"
            >
              <!-- Port Type Header -->
              <div class="flex items-center justify-between">
                <h4 class="text-sm font-medium capitalize">{{ group.type }}</h4>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500"
                    >{{ group.count }} port(s)</span
                  >
                  <UButton
                    icon="i-heroicons-minus-20-solid"
                    size="xs"
                    color="red"
                    :loading="isDeletingPort"
                    :disabled="isDeletingPort || group.count === 0"
                    @click="handleDeleteLastPort(group.type)"
                    :ui="{ rounded: 'rounded-xxs' }"
                  />
                  <UButton
                    icon="i-heroicons-plus-20-solid"
                    size="xs"
                    color="primary"
                    :loading="isAddingPort && addingPortType === group.type"
                    :disabled="isAddingPort"
                    @click="handleAddSinglePort(group.type)"
                    :ui="{ rounded: 'rounded-xxs' }"
                  />
                </div>
              </div>

              <!-- Port Boxes Grid -->
              <div class="grid grid-cols-12">
                <button
                  v-for="port in group.ports"
                  :key="port.id"
                  class="h-10 border-[1px] border-white rounded transition-all duration-200 flex items-center justify-center text-sm font-medium rounded-xxs"
                  :class="getPortStatusClass(port.port_status)"
                  :disabled="isFetchingPort || isDeletingPort"
                  @click="handleEditPort(port)"
                >
                  <p class="text-white font-semibold">
                    {{ port.number }}
                  </p>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      <template #footer>
        <div class="bg-gray-50 flex gap-1 items-center">
          <IcHelp class="text-sm text-gray-500 italic" />
          <p class="text-xs text-gray-500">
            To modify a port’s details, click on a port marker on the map.
          </p>
        </div>
        <div class="flex items-center justify-end gap-2">
          <UButton
            label="Done"
            color="primary"
            size="md"
            @click="handleClose"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>
      </template>
    </UCard>
  </UModal>

  <!-- Port Edit Modal -->
  <UModal v-model="editModalOpen" :ui="{ width: 'sm:max-w-md' }">
    <UCard>
      <template #header>
        <div class="flex items-center justify-between">
          <h3 class="text-base font-semibold">Configure Port</h3>
          <UButton
            color="gray"
            variant="ghost"
            icon="i-heroicons-x-mark-20-solid"
            @click="editModalOpen = false"
          />
        </div>
      </template>

      <div class="space-y-4">
        <UFormGroup label="Port Speed" name="port_speed">
          <UInput
            id="port_speed"
            v-model="editForm.port_speed"
            placeholder="Enter port speed"
          />
        </UFormGroup>
        <UFormGroup label="Port Identifier" name="port_identifier">
          <UInput
            id="port_identifier"
            v-model="editForm.port_identifier"
            placeholder="Enter port identifier"
          />
        </UFormGroup>
        <UFormGroup label="SFP Connected To Port" name="sfp_connected_to_port">
          <UInput
            id="sfp_connected_to_port"
            v-model="editForm.sfp_connected_to_port"
            placeholder="Enter SFP Connected To Port"
          />
        </UFormGroup>
        <UFormGroup label="SFP Lenght" name="sfp_length">
          <UInput
            id="sfp_length"
            v-model="editForm.sfp_length"
            placeholder="Enter SFP Lenght"
          />
        </UFormGroup>
        <UFormGroup label="SFP Serial" name="sfp_serial">
          <UInput
            id="sfp_serial"
            v-model="editForm.sfp_serial"
            placeholder="Enter SFP Serial"
          />
        </UFormGroup>
        <UFormGroup label="OPM DBM" name="opm_dbm">
          <UInput
            id="opm_dbm"
            v-model="editForm.opm_dbm"
            placeholder="Enter OPM DBM"
          />
        </UFormGroup>
        <UFormGroup label="Aggregation Code" name="aggregation_code">
          <UInput
            id="aggregation_code"
            v-model="editForm.aggregation_code"
            placeholder="Enter aggregation code"
          />
        </UFormGroup>
        <UFormGroup label="Port Description" name="port_description">
          <UTextarea
            id="port_description"
            v-model="editForm.port_description"
            placeholder="Enter port description"
            :rows="3"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </UFormGroup>
      </div>

      <template #footer>
        <div class="flex items-center justify-end gap-2">
          <UButton
            label="Cancel"
            color="gray"
            variant="outline"
            @click="editModalOpen = false"
          />
          <UButton
            label="Save"
            color="primary"
            :loading="isSavingPort"
            @click="handleSavePort"
          />
        </div>
      </template>
    </UCard>
  </UModal>
</template>
