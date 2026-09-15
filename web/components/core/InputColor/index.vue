<script setup lang="ts">
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/vue";
import { useFloating, offset, flip } from "@floating-ui/vue";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";

defineProps<{
  modelValue: string;
  updateColor: (color: string) => void;
}>();
const emit = defineEmits(["update:modelValue"]);

const reference = ref(null);
const floating = ref(null);
const { floatingStyles } = useFloating(reference, floating, {
  placement: "right-start",
  middleware: [offset(0), flip()],
});
</script>

<template>
  <Popover class="relative w-full flex items-center">
    <PopoverButton
      ref="reference"
      class="w-full flex items-center gap-2 focus:outline-none p-2 border border-grey-500 rounded-xxs"
    >
      <div
        class="w-full h-3 rounded-xxs"
        :style="{
          backgroundColor: modelValue,
        }"
      ></div>
      <IcArrowReg
        :fontControlled="false"
        class="w-4 h-4 rotate-180 text-grey-800"
      />
    </PopoverButton>

    <teleport to="body">
      <PopoverPanel
        ref="floating"
        :style="floatingStyles"
        class="absolute z-10 p-2 border border-grey-500 rounded-xxs bg-white"
      >
        <CoreInputColorPicker
          :color="modelValue"
          :updateColor="(color:string) => {
          updateColor(color)
          emit('update:modelValue', color);}"
        />
      </PopoverPanel>
    </teleport>
  </Popover>
</template>
