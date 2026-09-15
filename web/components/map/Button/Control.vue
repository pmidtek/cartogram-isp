<script setup lang="ts">
const props = defineProps<{
  onClick: () => void;
  active: boolean;
}>();
</script>

<template>
  <div class="p-2 rounded-xs bg-white/30">
    <UButton
      @click="onClick"
      size="sm"
      :class="
        active
          ? 'text-white bg-gradient-to-r from-blue-100 to-blue-600'
          : 'bg-transparent text-black'
      "
      class="hover:text-white hover:bg-gradient-to-r hover:from-blue-100 hover:to-blue-600 p-2 rounded-xs"
    >
      <slot></slot>
    </UButton>
  </div>
</template>
