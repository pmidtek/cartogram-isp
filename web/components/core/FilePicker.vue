<script lang="ts" setup>
const emit = defineEmits(["files-selected"]);
const fileInput = ref<HTMLInputElement | null>(null);
const selectedFileName = ref<string>("");

const handleFileChange = () => {
  if (fileInput.value?.files) {
    const files = fileInput.value.files;
    if (files.length > 0) {
      selectedFileName.value = files[0].name;
    }
    emit("files-selected", files);
  }
};

const triggerFileInput = () => {
  fileInput.value?.click();
};

// Optional: Add a function to clear the selection
const clearSelection = () => {
  selectedFileName.value = "";
  if (fileInput.value) {
    fileInput.value.value = "";
  }
  emit("files-selected", null);
};
</script>

<template>
  <div class="relative border border-grey-500 rounded-xxs">
    <button
      type="button"
      class="w-full text-xs rounded-xxs p-2 bg-white flex items-center justify-between text-white"
      @click="triggerFileInput"
    >
      <div class="flex items-center justify-between w-full">
        <p v-if="!selectedFileName" class="text-grey-700">Add Files</p>
        <p v-else class="truncate text-grey-800">{{ selectedFileName }}</p>
        <div v-if="selectedFileName" class="flex items-center gap-2">
          <button
            @click.stop="clearSelection"
            class="text-grey-400 hover:text-grey-200 p-1"
          >
            <i class="i-heroicons-x-mark w-4 h-4" />
          </button>
        </div>
      </div>
    </button>
    <input
      ref="fileInput"
      type="file"
      class="hidden"
      @change="handleFileChange"
    />
  </div>
</template>
