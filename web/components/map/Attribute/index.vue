<script setup lang="ts">
import type { GeoJSONSource } from "maplibre-gl";
import { ref, computed, watch } from "vue";
import { useQuery, useMutation, useQueryClient } from "@tanstack/vue-query";
import { storeToRefs } from "pinia";
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";

const featureStore = useFeature();
const { featureIdEdit, mapInfo, feature } = storeToRefs(featureStore);
const authStore = useAuth();
const queryClient = useQueryClient();
const toast = useToast();
const mapRefStore = useMapRef();
const { map } = storeToRefs(mapRefStore);

// Local state for editing
const mainAttributes = ref<
  Array<{ key: string; label: string; value: any; editable: boolean }>
>([]);
const additionalAttributes = ref<Array<{ key: string; value: any }>>([]);
const newAttributeKey = ref("");
const newAttributeValue = ref("");
const showAllAttributes = ref(false);

// Track original values to detect changes
const originalMainAttributes = ref<Record<string, any>>({});
const originalAdditionalAttributes = ref<Array<{ key: string; value: any }>>(
  [],
);

// Attachments
const attachments = ref<Array<{ id: number; label: string; file_id: string }>>(
  [],
);
const originalAttachments = ref<
  Array<{ id: number; label: string; file_id: string }>
>([]);
const newAttachmentFile = ref<File | null>(null);
const newAttachmentLabel = ref("");
const isUploadingAttachment = ref(false);
const fileInputRef = ref<HTMLInputElement | null>(null);
const isImageModalOpen = ref(false);
const currentPreviewImage = ref("");

// Main attribute keys by feature type
// Define which fields to show by default
const defaultVisibleFields = [
  "id",
  "Asset Type",
  "code",
  "description",
  "name",
  "tag_id",
  "rfid",
  "core",
  "tube",
];

// Computed property to filter attributes based on toggle
const displayedMainAttributes = computed(() => {
  if (showAllAttributes.value) {
    return mainAttributes.value;
  }
  return mainAttributes.value.filter(
    (attr) =>
      defaultVisibleFields.includes(attr.key) ||
      defaultVisibleFields.includes(attr.label),
  );
});

const isEditMode = computed(() => {
  return mapInfo.value === "add-attribute" && !!featureIdEdit.value;
});

// Enable query only when the drawer is open and a feature is selected for editing
const isEnabled = computed(() => {
  return isEditMode.value;
});

// Determine table for edit (based on selected feature)
const editTableName = computed(() => {
  if (!isEditMode.value) return "backbone";
  const table = feature.value?.tableName || "backbone";

  return table;
});

// Check if current feature is an asset
const isAssetFeature = computed(() => {
  return editTableName.value === "assets";
});

// Fetch feature attributes using TanStack Query
const {
  data: featureData,
  isLoading,
  isError,
  error,
  isFetching,
} = useQuery({
  queryKey: computed(() => [
    "featureAttributes",
    editTableName.value,
    featureIdEdit.value,
  ]),
  queryFn: async () => {
    if (!featureIdEdit.value) throw new Error("No feature selected");

    const querystring = new URLSearchParams({
      fields: [
        "*",
        "description",
        "user_created.first_name",
        "user_created.last_name",
        "user_updated.first_name",
        "user_updated.last_name",
        "asset_type_id.id",
        "asset_type_id.name",
        "attachment.*",
      ]!.join(","),
    } as Record<string, string>);

    const response: any = await $fetch(
      `/panel/items/${editTableName.value}/${featureIdEdit.value}?${querystring}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    return response.data;
  },
  enabled: isEnabled,
  staleTime: 2000, // Cache for 1 seconds
  refetchOnWindowFocus: false,
});

// Update attributes mutation
const updateAttributesMutation = useMutation({
  mutationFn: async () => {
    if (!featureIdEdit.value) throw new Error("No feature selected");

    // Build main attributes object with only changed values
    const mainAttrs: Record<string, any> = {};
    let hasChanges = false;

    mainAttributes.value.forEach((attr) => {
      // Check if value has changed from original
      if (originalMainAttributes.value[attr.key] !== attr.value) {
        // Convert "-" back to null for the API
        const valueToSend = attr.value === "-" ? null : attr.value;
        mainAttrs[attr.key] = valueToSend;
        hasChanges = true;
      }
    });

    // Check if additional attributes changed
    const additionalAttrsChanged =
      JSON.stringify(additionalAttributes.value) !==
      JSON.stringify(originalAdditionalAttributes.value);

    // Only build other_attributes if they changed
    let otherAttrs: Array<{ label: string; value: any }> | undefined;
    if (additionalAttrsChanged) {
      otherAttrs = additionalAttributes.value.map((attr) => ({
        label: attr.key,
        value: attr.value === "-" ? null : attr.value,
      }));
      hasChanges = true;
    }

    // Check for attachment changes (only for assets)
    const attachmentsChanged =
      JSON.stringify(attachments.value) !==
      JSON.stringify(originalAttachments.value);

    if (attachmentsChanged && isAssetFeature.value) {
      hasChanges = true;
    }

    // If no changes, don't send request
    if (!hasChanges) {
      throw new Error("No changes detected");
    }

    const requestBody: Record<string, any> = {
      ...mainAttrs,
    };

    // Only add other_attributes if they changed
    if (otherAttrs !== undefined) {
      requestBody.other_attributes = otherAttrs;
    }

    // Build attachment changes payload (only for assets)
    if (attachmentsChanged && isAssetFeature.value) {
      const attachmentPayload: {
        create?: Array<{ directus_files_id: string; label: string }>;
        update?: Array<{
          id: number;
          label: string;
          directus_files_id: string;
        }>;
        delete?: Array<number>;
      } = {};

      // Find new attachments (those without id or with temporary id)
      const newAttachments = attachments.value.filter(
        (att) => !originalAttachments.value.some((orig) => orig.id === att.id),
      );
      if (newAttachments.length > 0) {
        attachmentPayload.create = newAttachments.map((att) => ({
          directus_files_id: att.file_id,
          label: att.label,
        }));
      }

      // Find updated attachments (those with changed labels)
      const updatedAttachments = attachments.value.filter((att) => {
        const original = originalAttachments.value.find(
          (orig) => orig.id === att.id,
        );
        return (
          original &&
          (original.label !== att.label || original.file_id !== att.file_id)
        );
      });
      if (updatedAttachments.length > 0) {
        attachmentPayload.update = updatedAttachments.map((att) => ({
          id: att.id,
          label: att.label,
          directus_files_id: att.file_id,
        }));
      }

      // Find deleted attachments
      const deletedAttachmentIds = originalAttachments.value
        .filter((orig) => !attachments.value.some((att) => att.id === orig.id))
        .map((att) => att.id);
      if (deletedAttachmentIds.length > 0) {
        attachmentPayload.delete = deletedAttachmentIds;
      }

      // Only add attachment payload if there are changes
      if (
        attachmentPayload.create ||
        attachmentPayload.update ||
        attachmentPayload.delete
      ) {
        requestBody.attachment = attachmentPayload;
      }
    }

    const response = await $fetch(
      `/panel/items/${editTableName.value}/${featureIdEdit.value}`,
      {
        method: "PATCH",
        body: JSON.stringify(requestBody),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    return response;
  },
  onSuccess: () => {
    // Update original values to reflect saved state
    originalMainAttributes.value = {};
    mainAttributes.value.forEach((attr) => {
      originalMainAttributes.value[attr.key] = attr.value;
    });
    originalAdditionalAttributes.value = JSON.parse(
      JSON.stringify(additionalAttributes.value),
    );
    originalAttachments.value = JSON.parse(JSON.stringify(attachments.value));

    // Invalidate and refetch the query
    queryClient.invalidateQueries({
      queryKey: ["featureAttributes", featureIdEdit.value],
    });
    featureStore.setMapInfo("");

    // Show success toast
    toast.add({
      title: "Success",
      description: "Attributes updated successfully",
      color: "brand",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-bg-gray-900",
      },
    });
  },
  onError: (error: any) => {
    console.error("Error updating attributes:", error);

    // Handle "No changes detected" case gracefully
    if (error.message === "No changes detected") {
      toast.add({
        title: "No Changes",
        description: "No attributes were modified",
        color: "gray",
        icon: "i-heroicons-information-circle",
        ui: {
          background: "bg-white",
          title: "text-bg-gray-900",
        },
      });
      return;
    }

    // Show error toast for actual errors
    toast.add({
      title: "Error",
      description: "Failed to update attributes. Please try again.",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
      ui: {
        background: "bg-white",
        title: "text-bg-gray-900",
      },
    });
  },
});

// Watch for data changes and populate local state (EDIT mode)
watch(
  featureData,
  (newData) => {
    if (newData) {
      const {
        other_attributes,
        geom,
        user_created,
        user_updated,
        asset_type_id,
        attachment,
        ...rest
      } = newData;

      // Extract attachments
      if (attachment && Array.isArray(attachment)) {
        attachments.value = attachment.map((att: any) => ({
          id: att.id,
          label: att.label || "Untitled",
          file_id: att.directus_files_id,
        }));
      } else {
        attachments.value = [];
      }

      // Map nested objects to readable format
      const mappedData = {
        ...rest,
        ...(user_created?.first_name && user_created?.last_name
          ? {
              "Created By": `${user_created.first_name} ${user_created.last_name}`,
            }
          : {}),
        ...(user_updated?.first_name && user_updated?.last_name
          ? {
              "Updated By": `${user_updated.first_name} ${user_updated.last_name}`,
            }
          : {}),
        ...(asset_type_id?.name
          ? {
              "Asset Type": asset_type_id.name,
            }
          : {}),
      };

      // Filter out system fields (same as Popup.vue)
      const filteredKeys = Object.keys(mappedData).filter(
        (k) =>
          k !== "geom" &&
          k !== "status" &&
          k !== "date_created" &&
          k !== "date_updated" &&
          k !== "owner" &&
          k !== "ogc_fid" &&
          k !== "lon" &&
          k !== "lat" &&
          k !== "attachment",
      );

      // Convert all attributes to main attributes with editable flags
      const mainAttrs: Array<{
        key: string;
        label: string;
        value: any;
        editable: boolean;
      }> = [];

      const prioritizedKeys = [
        "name",
        "code",
        "cable_type",
        "core",
        "tube",
        "type",
        "from_id",
        "from_type",
        "to_id",
        "to_type",
      ];

      const orderedKeys = [
        ...new Set([
          ...prioritizedKeys.filter((key) => filteredKeys.includes(key)),
          ...filteredKeys,
        ]),
      ];

      orderedKeys.forEach((key) => {
        const value = mappedData[key] ?? "-";

        // All fields are editable except id and site_point_id
        const isEditable = key !== "id" && key !== "site_point_id";

        mainAttrs.push({
          key,
          label: key.charAt(0).toUpperCase() + key.slice(1),
          value: value,
          editable: isEditable,
        });
      });

      mainAttributes.value = mainAttrs;

      // Store original main attributes values for change detection
      originalMainAttributes.value = {};
      mainAttrs.forEach((attr) => {
        originalMainAttributes.value[attr.key] = attr.value;
      });

      // Separate additional attributes from other_attributes
      const additionalAttrs: Array<{ key: string; value: any }> = [];
      if (other_attributes && Array.isArray(other_attributes)) {
        other_attributes.forEach((attr: any) => {
          additionalAttrs.push({
            key: attr.label,
            value: attr.value ?? "-", // Show "-" for null/undefined
          });
        });
      }
      additionalAttributes.value = additionalAttrs;

      // Store original additional attributes for change detection
      originalAdditionalAttributes.value = JSON.parse(
        JSON.stringify(additionalAttrs),
      );

      // Store original attachments for change detection
      originalAttachments.value = JSON.parse(JSON.stringify(attachments.value));
    }
  },
  { immediate: true },
);

// Attachment functions
const handleFileSelect = (event: Event) => {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    newAttachmentFile.value = target.files[0];
  }
};

const uploadAttachment = async () => {
  if (!newAttachmentFile.value || !newAttachmentLabel.value) {
    toast.add({
      title: "Error",
      description: "Please select a file and enter a label",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    return;
  }

  isUploadingAttachment.value = true;

  try {
    // Upload file to Directus
    const formData = new FormData();
    formData.append("file", newAttachmentFile.value);

    const uploadResponse: any = await $fetch("/panel/files", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: formData,
    });

    const fileId = uploadResponse.data.id;

    // Add to local attachments array (will be saved on "Save Data" button)
    // Use a temporary negative ID to distinguish new attachments
    const tempId = -Date.now();
    attachments.value.push({
      id: tempId,
      label: newAttachmentLabel.value,
      file_id: fileId,
    });

    // Clear form
    newAttachmentFile.value = null;
    newAttachmentLabel.value = "";
    if (fileInputRef.value) {
      fileInputRef.value.value = "";
    }

    toast.add({
      title: "Success",
      description: "Attachment added (save to persist changes)",
      color: "brand",
      icon: "i-heroicons-check-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } catch (error) {
    console.error("Error uploading attachment:", error);
    toast.add({
      title: "Error",
      description: "Failed to upload file",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
  } finally {
    isUploadingAttachment.value = false;
  }
};

const removeAttachment = (index: number) => {
  // Simply remove from local array (will be saved on "Save Data" button)
  attachments.value.splice(index, 1);

  toast.add({
    title: "Success",
    description: "Attachment marked for removal (save to persist changes)",
    color: "brand",
    icon: "i-heroicons-check-circle",
    ui: { background: "bg-white", title: "text-grey-800" },
  });
};

const updateAttachmentLabel = (index: number) => {
  // Label is updated via v-model binding
  // Changes will be saved when "Save Data" button is clicked
  // No need to make immediate API call
};

const isImageFile = (fileId: string) => {
  // Common image extensions
  const imageExtensions = [
    ".jpg",
    ".jpeg",
    ".png",
    ".gif",
    ".bmp",
    ".webp",
    ".svg",
  ];
  return imageExtensions.some((ext) => fileId.toLowerCase().endsWith(ext));
};

const openImagePreview = (fileId: string) => {
  currentPreviewImage.value = `/panel/assets/${fileId}`;
  isImageModalOpen.value = true;
};

const closeImagePreview = () => {
  isImageModalOpen.value = false;
  currentPreviewImage.value = "";
};

const closeAnalytic = () => {
  console.log("close");
  featureStore.setMapInfo("");
};

const saveChanges = async () => {
  await updateAttributesMutation.mutateAsync();

  const highlightSource = map.value?.getSource("highlight") as
    | GeoJSONSource
    | undefined;
  highlightSource?.setData(emptyFeatureCollection);
  featureIdEdit.value = null;
};

const addNewAttribute = () => {
  if (newAttributeKey.value && newAttributeValue.value) {
    additionalAttributes.value.push({
      key: newAttributeKey.value,
      value: newAttributeValue.value,
    });
    newAttributeKey.value = "";
    newAttributeValue.value = "";
  }
};

const removeAdditionalAttribute = (index: number) => {
  additionalAttributes.value.splice(index, 1);
};
</script>

<template>
  <div class="p-3 space-y-3">
    <div class="flex justify-between items-center">
      <div>
        <h2 class="text-grey-900 text-xs">Edit Attributes Data</h2>
        <p class="text-[10px] font-raleway text-grey-600 text-xxs">
          Edit existing or add new attribute data
        </p>
      </div>
      <IcArrowLeft
        role="button"
        @click="closeAnalytic"
        :fontControlled="false"
        class="w-3 h-3 rotate-180 text-grey-900"
      />
    </div>
    <div class="w-full h-[1px] bg-grey-300"></div>

    <!-- Loading State (only in edit mode) -->
    <div
      v-if="isEditMode && (isLoading || isFetching)"
      class="flex flex-col items-center justify-center py-8 space-y-2"
    >
      <div
        class="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-500"
      ></div>
      <p class="text-xs text-grey-500">Loading attributes...</p>
    </div>

    <!-- Error State (only in edit mode) -->
    <div
      v-else-if="isEditMode && isError"
      class="flex flex-col items-center justify-center py-8 space-y-2"
    >
      <p class="text-xs text-red-500">Error loading attributes</p>
      <p class="text-2xs text-grey-500">Please try again later</p>
    </div>

    <!-- Content (both create and edit modes) -->
    <template v-else-if="featureData">
      <div class="h-[calc(100dvh-20.5rem)] overflow-y-scroll space-y-3">
        <!-- Main Attributes Section -->
        <UDivider
          label="Main Attributes"
          :ui="{ label: 'text-[10px] text-[#79797B]' }"
        />
        <div
          v-for="(attr, index) in displayedMainAttributes"
          :key="`main-${index}`"
          :class="
            attr.key === 'desc'
              ? 'flex flex-col gap-3'
              : 'grid grid-cols-2 w-full gap-3'
          "
        >
          <div class="border-[1px] border-black px-2 py-1 rounded-xxs">
            <p class="text-2xs text-[#626264]">Attribute Title</p>
            <UInput
              :model-value="attr.label"
              variant="none"
              size="lg"
              disabled
              :ui="{
                padding: {
                  lg: 'p-0',
                },
              }"
            />
          </div>
          <div class="border-[1px] border-black px-2 py-1 rounded-xxs">
            <p class="text-2xs text-[#626264]">Value</p>
            <UTextarea
              v-if="attr.key === 'desc'"
              v-model="attr.value"
              variant="none"
              :rows="4"
              :disabled="!attr.editable"
              placeholder="Enter description..."
              :ui="{
                padding: 'p-0',
              }"
            />
            <UInput
              v-else
              v-model="attr.value"
              variant="none"
              size="md"
              :disabled="!attr.editable"
              :ui="{
                padding: {
                  md: 'p-0',
                },
              }"
            />
          </div>
        </div>

        <!-- View All Attributes Button (only for assets) -->
        <UButton
          v-if="
            isEditMode &&
            isAssetFeature &&
            mainAttributes.length > defaultVisibleFields.length
          "
          @click="showAllAttributes = !showAllAttributes"
          :label="showAllAttributes ? 'Show Less' : 'View All Attributes'"
          size="xs"
          color="gray"
          variant="outline"
          block
          :ui="{ rounded: 'rounded-xxs' }"
        />

        <!-- Additional Attributes Section -->
        <div class="pb-3">
          <UDivider
            label="Additional Attributes"
            :ui="{ label: 'text-[10px] text-[#79797B]' }"
          />
        </div>
        <div
          v-for="(attr, index) in additionalAttributes"
          v-if="additionalAttributes.length > 0"
          :key="`additional-${index}`"
          class="grid grid-cols-2 w-full gap-3"
        >
          <div
            class="border-[1px] border-black px-3 py-2 rounded-xxs space-y-1"
          >
            <p class="text-2xs text-[#626264]">Attribute Name</p>
            <UInput
              v-model="attr.key"
              variant="none"
              size="lg"
              :ui="{
                padding: {
                  lg: 'p-0',
                },
              }"
            />
          </div>
          <div
            class="border-[1px] border-black px-3 py-2 rounded-xxs space-y-1"
          >
            <div class="flex items-center justify-between">
              <p class="text-2xs text-[#626264]">Attribute Value</p>
              <button
                @click="removeAdditionalAttribute(index)"
                class="text-red-500 hover:text-red-700 text-2xs"
              >
                Remove
              </button>
            </div>
            <UInput
              v-model="attr.value"
              variant="none"
              size="md"
              :ui="{
                padding: {
                  md: 'p-0',
                },
              }"
            />
          </div>
        </div>
        <div class="text-center text-xs text-grey-300" v-else>
          <p>No Additional Attribute</p>
        </div>

        <!-- Attachments Section (only for assets) -->
        <div class="pb-3" v-if="isEditMode && isAssetFeature">
          <UDivider
            label="Attachments"
            :ui="{ label: 'text-[10px] text-[#79797B]' }"
          />
        </div>

        <!-- Existing Attachments Table (only for assets) -->
        <div v-if="isEditMode && isAssetFeature">
          <div
            v-if="attachments.length > 0"
            class="border border-grey-300 rounded-xxs overflow-hidden"
          >
            <table class="w-full text-xs">
              <thead class="bg-grey-100">
                <tr>
                  <th
                    class="text-left px-3 py-2 text-2xs font-medium text-grey-700"
                  >
                    Label
                  </th>
                  <th
                    class="text-left px-3 py-2 text-2xs font-medium text-grey-700"
                  >
                    File ID
                  </th>
                  <th
                    class="text-center px-3 py-2 text-2xs font-medium text-grey-700"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(attachment, index) in attachments"
                  :key="attachment.id"
                  class="border-t border-grey-200 hover:bg-grey-50"
                >
                  <td class="px-3 py-2">
                    <UInput
                      v-model="attachment.label"
                      variant="none"
                      size="xs"
                      :ui="{
                        padding: {
                          xs: 'px-1 py-0.5',
                        },
                      }"
                      class="border border-grey-300 rounded"
                    />
                  </td>
                  <td
                    class="px-3 py-2 text-2xs text-grey-600 truncate max-w-[100px]"
                  >
                    {{ attachment.file_id }}
                  </td>
                  <td class="px-3 py-2">
                    <div class="flex items-center justify-center gap-2">
                      <button
                        v-if="isImageFile(attachment.file_id)"
                        @click="openImagePreview(attachment.file_id)"
                        class="text-brand-500 hover:text-brand-600 text-2xs font-medium"
                        title="Preview Image"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"
                          />
                        </svg>
                      </button>
                      <a
                        :href="`/panel/assets/${attachment.file_id}`"
                        target="_blank"
                        class="text-blue-500 hover:text-blue-600 text-2xs font-medium"
                        title="Download"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                          />
                        </svg>
                      </a>
                      <button
                        @click="removeAttachment(index)"
                        class="text-red-500 hover:text-red-700 text-2xs font-medium"
                        title="Remove"
                      >
                        <svg
                          xmlns="http://www.w3.org/2000/svg"
                          class="h-4 w-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                          />
                        </svg>
                      </button>
                    </div>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          <div
            v-else
            class="text-center text-xs text-grey-300 py-2 border border-grey-200 rounded-xxs"
          >
            <p>No Attachments</p>
          </div>
        </div>

        <!-- Upload New Attachment (only for assets) -->
        <div class="pt-3" v-if="isEditMode && isAssetFeature">
          <UDivider
            label="Upload New Attachment"
            :ui="{ label: 'text-[10px] text-[#79797B]' }"
          />
        </div>
        <div v-if="isEditMode && isAssetFeature" class="grid grid-cols-2 gap-3">
          <div
            class="border-[1px] border-black px-3 py-2 rounded-xxs space-y-1"
          >
            <p class="text-2xs text-[#626264]">Label</p>
            <UInput
              v-model="newAttachmentLabel"
              variant="none"
              size="md"
              placeholder="Enter label"
              :ui="{
                padding: {
                  md: 'p-0',
                },
              }"
            />
          </div>
          <div
            class="border-[1px] border-black px-3 py-2 rounded-xxs space-y-1"
          >
            <p class="text-2xs text-[#626264]">File</p>
            <input
              ref="fileInputRef"
              type="file"
              @change="handleFileSelect"
              class="text-xs w-full"
            />
          </div>
        </div>
        <div v-if="isEditMode && isAssetFeature" class="pt-2">
          <UButton
            label="Upload Attachment"
            color="brand"
            size="xs"
            block
            :loading="isUploadingAttachment"
            :disabled="!newAttachmentFile || !newAttachmentLabel"
            @click="uploadAttachment"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>

        <!-- Add New Additional Attribute -->
        <div class="pt-3">
          <UDivider
            label="Add New Additional Attribute"
            :ui="{ label: 'text-[10px] text-[#79797B]' }"
          />
        </div>
        <div class="grid grid-cols-2 w-full gap-3">
          <div
            class="border-[1px] border-brand-500 px-3 py-2 rounded-xxs space-y-1"
          >
            <p class="text-2xs text-[#626264]">New Attribute Title</p>
            <UInput
              v-model="newAttributeKey"
              variant="none"
              size="lg"
              placeholder="Enter name"
              :ui="{
                padding: {
                  lg: 'p-0',
                },
              }"
            />
          </div>
          <div
            class="border-[1px] border-brand-500 px-3 py-2 rounded-xxs space-y-1"
          >
            <p class="text-2xs text-[#626264]">New Attribute Value</p>
            <UInput
              v-model="newAttributeValue"
              variant="none"
              size="md"
              placeholder="Enter value"
              :ui="{
                padding: {
                  md: 'p-0',
                },
              }"
            />
          </div>
        </div>
        <UButton
          @click="addNewAttribute"
          :disabled="!newAttributeKey || !newAttributeValue"
          label="Add New Attribute Data"
          size="md"
          color="white"
          icon="i-ep:plus"
          block
          :ui="{ rounded: 'rounded-xxs' }"
        />
      </div>

      <UButton
        @click="saveChanges"
        :loading="updateAttributesMutation.isPending.value"
        :disabled="updateAttributesMutation.isPending.value"
        block
        label="Save Data"
        size="lg"
        :ui="{ rounded: 'rounded-xxs' }"
      />
    </template>

    <!-- No Feature Selected -->
    <div
      v-else
      class="flex flex-col items-center justify-center py-8 space-y-2"
    >
      <p class="text-xs text-grey-500">No feature selected</p>
      <p class="text-2xs text-grey-400">Select a feature to edit attributes</p>
    </div>

    <!-- Image Preview Modal -->
    <UModal v-model="isImageModalOpen" :ui="{ width: 'max-w-4xl' }">
      <UCard
        :ui="{
          base: 'overflow-hidden',
          body: {
            base: 'p-4',
            padding: '',
          },
          header: {
            base: 'flex items-center justify-between',
            padding: 'px-4 py-3',
          },
        }"
      >
        <template #header>
          <h3 class="text-base font-semibold text-grey-900">Image Preview</h3>
          <UButton
            color="gray"
            variant="ghost"
            icon="i-heroicons-x-mark-20-solid"
            @click="closeImagePreview"
            :ui="{ rounded: 'rounded-full' }"
          />
        </template>

        <div class="flex items-center justify-center bg-grey-50 rounded-lg p-4">
          <img
            :src="currentPreviewImage"
            alt="Preview"
            class="max-w-full max-h-[70vh] object-contain rounded"
          />
        </div>

        <template #footer>
          <div class="flex justify-between items-center">
            <a
              :href="currentPreviewImage"
              target="_blank"
              class="text-brand-500 hover:text-brand-600 text-sm font-medium flex items-center gap-2"
            />
            <UButton
              label="Close"
              color="gray"
              variant="solid"
              @click="closeImagePreview"
              :ui="{ rounded: 'rounded-xxs' }"
            />
          </div>
        </template>
      </UCard>
    </UModal>
  </div>
</template>
