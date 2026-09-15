<script lang="ts" setup>
defineProps<{ mode: UploadModeEnum }>();

const emit = defineEmits<{
  (e: "handleChangeMode", modeValue: UploadModeEnum): void;
}>();
</script>

<template>
  <div class="flex-1 px-10 py-6">
    <p class="text-grey-50">Load Local Data/Upload Data</p>
    <p class="text-grey-500 text-2xs">
      Load from local storage to view data or upload and save data to the
      Dashboard
    </p>
    <hr class="border-grey-700 my-3" />
    <div class="grid grid-cols-2 gap-4">
      <MapManagementCatalogueUploadOptionCard
        title="Load Local Data"
        desc="The data will only be displayed on the data catalog and map pages. Data is not stored and cannot be shared."
        optLabel="Load Local Data"
        @change-mode="emit('handleChangeMode', 'loadlocal')"
      />
      <MapManagementCatalogueUploadOptionCard
        title="Upload Data"
        desc="The data will be saved in the database and then displayed on the catalog page and map page. Uploaded data can be shared and viewed by other users."
        optLabel="Upload Data"
        @change-mode="emit('handleChangeMode', 'upload')"
      />
    </div>
  </div>
</template>
