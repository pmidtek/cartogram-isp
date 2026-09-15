<script lang="ts" setup>
import { Menu, MenuButton, MenuItems, MenuItem } from "@headlessui/vue";
import { useFloating, offset, flip } from "@floating-ui/vue";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";

defineProps<{
  modelValue: string | null;
  updateLineDash: (value: null | number[]) => void;
  disabled?: boolean;
}>();
const emit = defineEmits(["update:modelValue"]);

const reference = ref(null);
const floating = ref(null);
const { floatingStyles } = useFloating(reference, floating, {
  placement: "bottom-start",
  middleware: [offset(0), flip()],
});
</script>

<template>
  <Menu as="div" class="relative w-full flex items-center">
    <MenuButton
      :disabled="disabled"
      ref="reference"
      class="w-full h-6 flex items-center gap-2 focus:outline-none p-2 border border-grey-500 rounded-xxs"
    >
      <div class="w-full h-3 rounded-xxs flex gap-2 items-center">
        <div
          :class="[
            modelValue ? 'border-dashed' : 'border-solid',
            'w-full border-t border-gray-800',
          ]"
        ></div>
        <p class="text-grey-400 text-2xs">
          {{ modelValue ? "Dashed" : "Solid" }}
        </p>
      </div>
      <IcArrowReg
        :fontControlled="false"
        class="w-4 h-4 rotate-180 text-grey-800"
      />
    </MenuButton>

    <teleport to="body">
      <MenuItems
        ref="floating"
        :style="floatingStyles"
        class="absolute z-10 p-2 border border-grey-500 rounded-xxs bg-white flex flex-col gap-2 w-48"
      >
        <MenuItem :disabled="modelValue === null">
          <UButton
            @click="
              () => {
                updateLineDash(null);
                emit('update:modelValue', null);
              }
            "
            :ui="{ rounded: 'rounded-[4px]' }"
            size="2xs"
            color="brand"
            variant="ghost"
            :class="modelValue === null && 'bg-brand-950'"
            >Solid</UButton
          >
        </MenuItem>
        <MenuItem :disabled="modelValue !== null">
          <UButton
            @click="
              () => {
                updateLineDash([5, 1]);
                emit('update:modelValue', [5, 1]);
              }
            "
            :ui="{ rounded: 'rounded-[4px]' }"
            size="2xs"
            color="brand"
            variant="ghost"
            :class="modelValue !== null && 'bg-brand-950'"
            >Dash</UButton
          >
        </MenuItem>
      </MenuItems>
    </teleport>
  </Menu>
</template>
