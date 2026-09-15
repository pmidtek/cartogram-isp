<script setup lang="ts">
import { ref, computed, watch } from "vue";

const props = defineProps<{
  modelValue: boolean;
  sitePoint: {
    ogc_fid: number;
    name?: string;
  } | null;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: boolean): void;
  (e: "close"): void;
  (e: "created"): void;
}>();

const authStore = useAuth();
const toast = useToast();
const layerStore = useMapLayer();
const moduleStore = useMapModule();
const mapRefStore = useMapRef();
const { currentModule } = storeToRefs(moduleStore);
const { fetchActiveLayers } = layerStore;

// Modal state
const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

// Current tab
const selectedTab = ref(0);

// Tabs configuration
const tabs = [
  { label: "Basic Info", icon: "i-heroicons-information-circle" },
  { label: "Dates", icon: "i-heroicons-calendar" },
  { label: "Attachments", icon: "i-heroicons-paper-clip" },
];

// Dropdown options
const assetTypes = ref<Array<{ label: string; value: number }>>([]);

// Form data
const formData = ref<{
  asset_type_id: number | undefined;
  name: string | undefined;
  code: string | undefined;
  location: string | undefined;
  location_detail: string | undefined;
  description: string | undefined;
  tag_id: string | undefined;
  rfid: string | undefined;
  serial_number: string | undefined;
  date_of_purchase: string | undefined;
  date_of_install: string | undefined;
  date_of_service: string | undefined;
  date_of_warranty_expiration: string | undefined;
  date_of_last_inspection: string | undefined;
  last_inspected_by: string | undefined;
  date_of_maintenance_expiration: string | undefined;
  maintenance_by: string | undefined;
  service_log_ticket_number: string | undefined;
}>({
  asset_type_id: undefined, // *
  name: undefined, // *
  code: undefined, // *
  location: undefined,
  location_detail: undefined,
  description: undefined,
  tag_id: undefined,
  rfid: undefined,
  serial_number: undefined,
  date_of_purchase: undefined,
  date_of_install: undefined,
  date_of_service: undefined,
  date_of_warranty_expiration: undefined,
  date_of_last_inspection: undefined,
  last_inspected_by: undefined,
  date_of_maintenance_expiration: undefined,
  maintenance_by: undefined,
  service_log_ticket_number: undefined,
});

// Attachments (Tab 7)
const attachments = ref<Array<{ file: File; label: string }>>([]);
const newAttachmentFile = ref<File | null>(null);
const newAttachmentLabel = ref("");
const fileInputRef = ref<HTMLInputElement | null>(null);

// Loading state
const isSubmitting = ref(false);

// Fetch dropdown options
const fetchDropdownOptions = async () => {
  try {
    // Fetch asset types
    const assetTypesResponse: any = await $fetch(
      "/panel/items/asset_types?sort=name&filter[terminate_type][_neq]=non_asset",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    const assetTypesData = Array.isArray(assetTypesResponse)
      ? assetTypesResponse
      : assetTypesResponse.data;
    assetTypes.value = assetTypesData.map((type: any) => ({
      label: type.name,
      value: type.id,
    }));
  } catch (error) {
    console.error("Error fetching dropdown options:", error);
    toast.add({
      title: "Warning",
      description: "Failed to load dropdown options",
      icon: "i-heroicons-exclamation-triangle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  }
};

// Watch modal open to fetch options
watch(isOpen, (newValue) => {
  if (newValue) {
    fetchDropdownOptions();
  }
});

// Handle file selection for attachments
const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    newAttachmentFile.value = target.files[0];
  }
};

// Add attachment to list
const addAttachment = () => {
  if (!newAttachmentFile.value || !newAttachmentLabel.value) {
    toast.add({
      title: "Error",
      description: "Please select a file and enter a label",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  attachments.value.push({
    file: newAttachmentFile.value,
    label: newAttachmentLabel.value,
  });

  // Clear form
  newAttachmentFile.value = null;
  newAttachmentLabel.value = "";
  if (fileInputRef.value) {
    fileInputRef.value.value = "";
  }

  toast.add({
    title: "Attachment Added",
    description: "Attachment added to upload queue",
    icon: "i-heroicons-check-circle",
    ui: { background: "bg-white", title: "text-grey-800" },
  });
};

// Remove attachment from list
const removeAttachment = (index: number) => {
  attachments.value.splice(index, 1);
};

// Validate form
const validateForm = (): boolean => {
  if (!formData.value.name) {
    toast.add({
      title: "Validation Error",
      description: "Name is required",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    selectedTab.value = 0; // Go to Basic Info tab
    return false;
  }

  if (!formData.value.code) {
    toast.add({
      title: "Validation Error",
      description: "Code is required",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    selectedTab.value = 0; // Go to Basic Info tab
    return false;
  }

  if (!formData.value.asset_type_id) {
    toast.add({
      title: "Validation Error",
      description: "Asset Type is required",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    selectedTab.value = 0; // Go to Basic Info tab
    return false;
  }

  return true;
};

// Submit form
const handleSubmit = async () => {
  if (!props.sitePoint) {
    toast.add({
      title: "Error",
      description: "No site point selected",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  if (!validateForm()) {
    return;
  }

  isSubmitting.value = true;

  try {
    // Step 1: Upload attachments to Directus and get file IDs
    const uploadedAttachments: Array<{
      directus_files_id: string;
      label: string;
    }> = [];

    for (const attachment of attachments.value) {
      const formDataFile = new FormData();
      formDataFile.append("file", attachment.file);

      const uploadResponse: any = await $fetch("/panel/files", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        body: formDataFile,
      });

      uploadedAttachments.push({
        directus_files_id: uploadResponse.data.id,
        label: attachment.label,
      });
    }

    // Step 2: Create asset with attachments in the payload
    const assetPayload: any = {
      ...formData.value,
      site_point_id: props.sitePoint.ogc_fid,
    };

    // Add attachments to payload if any were uploaded
    if (uploadedAttachments.length > 0) {
      assetPayload.attachment = {
        create: uploadedAttachments,
      };
    }

    const createAssetResponse: any = await $fetch("/panel/items/assets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: assetPayload,
    });

    // Step 3: Remove asset layers/sources and refetch active layers
    try {
      const map = mapRefStore.map;
      if (map) {
        const style = map.getStyle();
        const allLayers: any[] = style?.layers || [];

        // Filter layers related to assets (site points)
        const assetLayers = allLayers.filter(
          (ly: any) =>
            ly["source-layer"]?.includes("assets") ||
            ly["source-layer"]?.includes("site_point"),
        );

        // Remove matched layers
        assetLayers.forEach((ly: any) => {
          if (map.getLayer(ly.id)) map.removeLayer(ly.id);
        });

        // Remove unique sources afterwards
        const assetSourceIds = Array.from(
          new Set(
            assetLayers
              .map((ly: any) => ly.source)
              .filter((s: any) => typeof s === "string"),
          ),
        );
        assetSourceIds.forEach((srcId) => {
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
      console.warn("Failed to remove asset layers:", e);
    }

    try {
      await fetchActiveLayers(currentModule.value?.slug);
    } catch (e) {
      console.warn("Failed to refetch active layers:", e);
    }

    // Step 4: Reset form and close modal
    resetForm();
    emit("created");

    toast.add({
      title: "Success",
      description: "Asset created successfully",
      icon: "i-heroicons-check-circle",
      color: "green",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } catch (error: any) {
    console.error("Error creating asset:", error);
    toast.add({
      title: "Error",
      description: error?.data?.message || "Failed to create asset",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isSubmitting.value = false;
  }
};

// Reset form
const resetForm = () => {
  formData.value = {
    asset_type_id: undefined,
    name: undefined,
    code: undefined,
    location: undefined,
    location_detail: undefined,
    description: undefined,
    tag_id: undefined,
    rfid: undefined,
    serial_number: undefined,
    date_of_purchase: undefined,
    date_of_install: undefined,
    date_of_service: undefined,
    date_of_warranty_expiration: undefined,
    date_of_last_inspection: undefined,
    last_inspected_by: undefined,
    date_of_maintenance_expiration: undefined,
    maintenance_by: undefined,
    service_log_ticket_number: undefined,
  }; // Reset to initial state (form open)
  attachments.value = [];
  newAttachmentFile.value = null;
  newAttachmentLabel.value = "";
  selectedTab.value = 0;
};

// Handle close
const handleClose = () => {
  if (!isSubmitting.value) {
    resetForm();
    emit("close");
  }
};
</script>

<template>
  <UModal
    v-model="isOpen"
    fullscreen
    :ui="{
      fullscreen: 'max-w-[80%] h-[calc(100dvh-5rem)] rounded-xs',
    }"
  >
    <UCard
      :ui="{
        base: 'h-full flex flex-col',
        rounded: 'rounded-xs',
        divide: '',
        footer: {
          padding: 'pt-0',
        },
        body: {
          base: 'flex-1 overflow-hidden',
          padding: 'p-0',
        },
      }"
    >
      <!-- Header -->
      <template #header>
        <div class="flex items-center justify-between w-full">
          <div class="flex items-center gap-3">
            <UButton
              icon="i-heroicons-x-mark-20-solid"
              color="gray"
              variant="ghost"
              @click="handleClose"
              :disabled="isSubmitting"
            />
            <h2 class="text-xl font-semibold">Add Asset</h2>
          </div>
          <div v-if="sitePoint" class="text-sm text-grey-600">
            Site Point: {{ sitePoint.name || "Unknown" }}
          </div>
        </div>
      </template>

      <!-- Tabs -->
      <div class="flex gap-2 h-full overflow-hidden">
        <!-- Tab Navigation -->
        <div class="w-[20rem] bg-grey-50 overflow-y-auto border rounded-xs">
          <div class="p-2 space-y-1">
            <button
              v-for="(tab, index) in tabs"
              :key="index"
              @click="selectedTab = index"
              :class="[
                'w-full text-left px-3 py-2 rounded-xs text-sm flex items-center gap-2 transition-colors',
                selectedTab === index
                  ? 'bg-brand-500 text-white'
                  : 'text-grey-700 hover:bg-grey-200',
              ]"
            >
              <UIcon :name="tab.icon" class="w-4 h-4" />
              {{ tab.label }}
            </button>
          </div>
        </div>

        <!-- Tab Content -->
        <div class="flex-1 overflow-y-auto p-6 border rounded-xs">
          <!-- Tab 1: Basic Info -->
          <div v-show="selectedTab === 0" class="space-y-4 w-full">
            <h3 class="text-lg font-medium mb-4">Basic Information</h3>

            <div class="w-full grid grid-cols-2 gap-4">
              <div>
                <label class="text-sm font-medium mb-1 block">
                  Asset Type <span class="text-red-500">*</span>
                </label>
                <USelect
                  size="md"
                  v-model="formData.asset_type_id"
                  :options="assetTypes"
                  option-attribute="label"
                  value-attribute="value"
                  :ui="{ rounded: 'rounded-xxs' }"
                  placeholder="Select asset type"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block">
                  Name <span class="text-red-500">*</span>
                </label>
                <UInput
                  size="md"
                  v-model="formData.name"
                  placeholder="Enter name"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block">
                  Code <span class="text-red-500">*</span>
                </label>
                <UInput
                  size="md"
                  v-model="formData.code"
                  placeholder="Enter code"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block">Location</label>
                <UInput
                  v-model="formData.location"
                  placeholder="Enter location"
                  size="md"
                />
              </div>

              <div class="col-span-2">
                <label class="text-sm font-medium mb-1 block"
                  >Location Detail</label
                >
                <UInput
                  v-model="formData.location_detail"
                  placeholder="Enter location detail"
                  size="md"
                />
              </div>

              <div class="col-span-2">
                <label class="text-sm font-medium mb-1 block"
                  >Description</label
                >
                <UTextarea
                  size="md"
                  v-model="formData.description"
                  placeholder="Enter description"
                  :rows="3"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block">Tag ID</label>
                <UInput
                  size="md"
                  v-model="formData.tag_id"
                  placeholder="Enter tag ID"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block">RFID</label>
                <UInput
                  size="md"
                  v-model="formData.rfid"
                  placeholder="Enter RFID"
                />
              </div>

              <div class="col-span-2">
                <label class="text-sm font-medium mb-1 block"
                  >Serial Number</label
                >
                <UInput
                  v-model="formData.serial_number"
                  placeholder="Enter serial number"
                  size="md"
                />
              </div>
            </div>
          </div>

          <!-- Tab 4: Dates & Maintenance -->
          <div v-show="selectedTab === 1" class="space-y-4 w-full">
            <h3 class="text-lg font-medium mb-4">Dates & Maintenance</h3>

            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="text-sm font-medium mb-1 block"
                  >Date of Purchase</label
                >
                <UInput
                  size="md"
                  v-model="formData.date_of_purchase"
                  type="date"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block"
                  >Date of Install</label
                >
                <UInput
                  size="md"
                  v-model="formData.date_of_install"
                  type="date"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block"
                  >Date of Service</label
                >
                <UInput
                  size="md"
                  v-model="formData.date_of_service"
                  type="date"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block">
                  Warranty Expiration
                </label>
                <UInput
                  v-model="formData.date_of_warranty_expiration"
                  type="date"
                  size="md"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block">
                  Last Inspection Date
                </label>
                <UInput
                  v-model="formData.date_of_last_inspection"
                  type="date"
                  size="md"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block"
                  >Last Inspected By</label
                >
                <UInput
                  v-model="formData.last_inspected_by"
                  placeholder="Enter inspector name"
                  size="md"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block">
                  Maintenance Expiration
                </label>
                <UInput
                  v-model="formData.date_of_maintenance_expiration"
                  type="date"
                  size="md"
                />
              </div>

              <div>
                <label class="text-sm font-medium mb-1 block"
                  >Maintenance By</label
                >
                <UInput
                  v-model="formData.maintenance_by"
                  placeholder="Enter maintenance provider"
                  size="md"
                />
              </div>

              <div class="col-span-2">
                <label class="text-sm font-medium mb-1 block">
                  Service Log Ticket Number
                </label>
                <UInput
                  v-model="formData.service_log_ticket_number"
                  placeholder="Enter ticket number"
                  size="md"
                />
              </div>
            </div>
          </div>

          <!-- Tab 7: Attachments -->
          <div v-show="selectedTab === 2" class="space-y-4 w-full">
            <h3 class="text-lg font-medium mb-4">Attachments</h3>

            <!-- Attachment List -->
            <div v-if="attachments.length > 0" class="space-y-2 mb-4">
              <div
                v-for="(attachment, index) in attachments"
                :key="index"
                class="border rounded-xxs p-3 flex items-center justify-between"
              >
                <div class="flex items-center gap-3">
                  <UIcon
                    name="i-heroicons-paper-clip"
                    class="w-5 h-5 text-brand-500"
                  />
                  <div>
                    <p class="text-sm font-medium">{{ attachment.label }}</p>
                    <p class="text-xs text-grey-600">
                      {{ attachment.file.name }}
                    </p>
                  </div>
                </div>
                <UButton
                  icon="i-heroicons-trash"
                  color="red"
                  variant="ghost"
                  size="md"
                  @click="removeAttachment(index)"
                />
              </div>
            </div>
            <div v-else class="text-center text-sm text-grey-500 py-4">
              No attachments added yet
            </div>

            <!-- Add Attachment Form -->
            <div class="border-t pt-4">
              <h4 class="text-sm font-medium mb-3">Add Attachment</h4>
              <div class="grid grid-cols-2 gap-4">
                <div>
                  <label class="text-sm font-medium mb-1 block">Label</label>
                  <UInput
                    v-model="newAttachmentLabel"
                    placeholder="e.g., Photo, User Manual"
                    size="lg"
                  />
                </div>
                <div>
                  <label class="text-sm font-medium mb-1 block">File</label>
                  <input
                    ref="fileInputRef"
                    type="file"
                    @change="handleFileSelect"
                    class="text-sm w-full border border-gray-300 rounded px-2 py-[5px] rounded-xxs focus:outline-none focus:ring-2 focus:ring-brand-500 file:mr-4 file:py-1 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-brand-50 file:text-brand-700 hover:file:bg-brand-100"
                  />
                </div>
              </div>
              <UButton
                label="Add Attachment"
                icon="i-heroicons-plus"
                color="gray"
                size="md"
                class="mt-3"
                :disabled="!newAttachmentFile || !newAttachmentLabel"
                @click="addAttachment"
                :ui="{ rounded: 'rounded-xxs' }"
              />
            </div>
          </div>
        </div>
      </div>

      <!-- Footer Actions -->
      <template #footer>
        <div class="flex justify-end gap-3">
          <UButton
            label="Cancel"
            color="gray"
            variant="outline"
            @click="handleClose"
            :disabled="isSubmitting"
            :ui="{ rounded: 'rounded-xxs' }"
            size="lg"
          />
          <UButton
            label="Save Asset"
            color="brand"
            :loading="isSubmitting"
            @click="handleSubmit"
            :ui="{ rounded: 'rounded-xxs' }"
            size="lg"
          />
        </div>
      </template>
    </UCard>
  </UModal>
</template>
