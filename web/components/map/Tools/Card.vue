<script setup lang="ts">
import { TransitionRoot } from "@headlessui/vue";
import IcCross from "~/assets/icons/ic-cross.svg";
import IcDrawSquare from "~/assets/icons/ic-draw-square.svg";

export interface Props {
  active?: boolean;
  label?: string;
  icon?: string | Component;
  onClose?: () => void;
}
const props = withDefaults(defineProps<Props>(), {
  active: false,
  label: "",
  onClose: () => {},
});
</script>

<template>
  <TransitionRoot
    as="div"
    :show="active"
    enter="transition-all duration-300"
    enter-from="-mb-10 opacity-0"
    enter-to="mb-0 opacity-1"
    leave="transition-all duration-300"
    leave-from="mb-0 opacity-1"
    leave-to="-mb-10 opacity-0"
    class="absolute bottom-6 left-1/2 -translate-x-1/2 rounded-xs bg-white min-w-[20rem] max-w-[25rem] divide-y divide-grey-700"
  >
    <div class="flex items-center gap-[6px] p-2">
      <component
        :is="icon"
        class="w-3 h-3 text-grey-400"
        :fontControlled="false"
      ></component>
      <p class="flex-1 text-grey-800 text-2xs">{{ label }}</p>
      <button @click="onClose">
        <IcCross class="w-2 h-2 text-grey-400 m-2" :fontControlled="false" />
      </button>
    </div>
    <slot />
  </TransitionRoot>
</template>
