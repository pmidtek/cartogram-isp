<script setup lang="ts">
import IcCloudUpload from "~/assets/icons/ic-cloud-upload.svg";
import IcTrash from "~/assets/icons/ic-trash.svg";
import IcInfo from "~/assets/icons/ic-info.svg";

const props = defineProps<{
  selectedFile: File | null;
  accept?: string;
}>();

const emit = defineEmits<{
  (e: "setSelectedFile", value: File | null): void;
}>();

const input = ref<HTMLInputElement | null>(null);

const handleFileUploadChange = async (e: Event) => {
  const target = e.target as HTMLInputElement;
  if (!target.files || !target.files.length) return;
  const file = target.files[0];
  emit("setSelectedFile", file);
};

const handleDelete = (e: Event) => {
  if (props.selectedFile) {
    e.stopPropagation();
    emit("setSelectedFile", null);
  }
};

const onDragOver = ref(false);

const handleDragOver = (e: Event) => {
  e.preventDefault();
  e.stopPropagation();

  if (onDragOver.value) return;
  onDragOver.value = true;
};

const handleDragLeave = (e: Event) => {
  e.preventDefault();
  e.stopPropagation();
  onDragOver.value = false;
};

const handleDrop = (e: any) => {
  e.preventDefault();
  e.stopPropagation();
  onDragOver.value = false;
  const files: File[] = [...e.dataTransfer.files];

  const file = files[0];
  emit("setSelectedFile", file);
};
</script>

<template>
  <input
    ref="input"
    :accept="accept"
    type="file"
    hidden
    @change="handleFileUploadChange"
  />
  <div
    class="flex flex-col gap-1"
    @drop="handleDrop"
    @dragleave="handleDragLeave"
    @dragover="handleDragOver"
  >
    <div
      @click="
        () => {
          input?.click();
        }
      "
      :class="[
        onDragOver || selectedFile ? 'border-brand-500' : 'border-grey-600',
        selectedFile ? 'bg-brand-950' : 'bg-grey-700',
        'p-1 border rounded-xxs cursor-pointer',
      ]"
    >
      <p class="text-2xs text-grey-400 ml-2 mb-1 mt-2">File</p>
      <div
        class="flex items-center justify-between bg-white/30 rounded-xxs px-2 py-4"
      >
        <div>
          <p
            :class="[
              selectedFile ? 'text-brand-500' : 'text-grey-200',
              'text-xs',
            ]"
          >
            {{ selectedFile?.name || "Select File" }}
          </p>
          <p
            :class="[
              selectedFile ? 'text-brand-400' : 'text-grey-400',
              'text-xs',
            ]"
          >
            Please select or drag spatial data file from your storage here
            (Supported File Type: .GeoJson, .KML, .Zip)
          </p>
        </div>

        <button @click="handleDelete">
          <component
            :is="selectedFile ? IcTrash : IcCloudUpload"
            :class="[
              selectedFile ? 'text-brand-500' : 'text-grey-400',
              'w-6 h-6',
            ]"
            :fontControlled="false"
          ></component>
        </button>
      </div>
    </div>
    <div class="flex items-center gap-2 mt-2">
      <IcInfo class="text-grey-400" />
      <p class="text-xs text-grey-400">Maximum File Size: 999 MB</p>
    </div>
  </div>
</template>
