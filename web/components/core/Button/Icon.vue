<script setup lang="ts">
export interface Props {
  onClick?: () => void;
  active?: boolean;
  icon?: string | null;
  iconClass?: string;
}
const props = withDefaults(defineProps<Props>(), {
  onClick: () => {},
  active: false,
  icon: null,
  iconClass: "w-4 h-4",
});
</script>

<template>
  <UButton
    @click="onClick"
    size="sm"
    :class="active ? 'text-brand-500 bg-brand-950' : 'bg-transparent'"
    class="hover:bg-grey-800 p-1 rounded-xxs flex items-center gap-2"
  >
    <component
      v-show="icon"
      :is="icon"
      :class="iconClass"
      :fontControlled="false"
    ></component>
  </UButton>
</template>
