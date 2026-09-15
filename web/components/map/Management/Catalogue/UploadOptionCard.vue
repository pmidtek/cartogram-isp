<script lang="ts" setup>
import IcAddFile from "~/assets/icons/ic-add-file.svg";

defineProps<{
  title: string;
  desc: string;
  optLabel: string;
}>();

const emit = defineEmits<{
  (e: "changeMode"): void;
}>();
</script>

<template>
  <div
    @click="emit('changeMode')"
    class="flex flex-col h-full gap-1 justify-between p-4 bg-grey-800 border rounded-xs cursor-pointer border-grey-700"
  >
    <div class="flex flex-col items-center py-6">
      <IcAddFile class="w-6 h-6 text-brand-500" :fontControlled="false" />
      <p class="text-grey-50 mt-2">{{ title }}</p>
      <p class="text-sm text-grey-400 text-center">
        {{ desc }}
      </p>
    </div>
  </div>
</template>
