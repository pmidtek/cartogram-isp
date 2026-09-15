<script setup lang="ts">
import { Menu, MenuButton, MenuItems, MenuItem } from "@headlessui/vue";
import IcMapLayerA from "~/assets/icons/ic-map-layer-a.svg";

type LayerTypeFilterOptions = {
  type: string;
  label: string;
  checked: boolean;
  icon: string;
};

const props = defineProps<{
  list: LayerTypeFilterOptions[];
  handleChange: (index: string | number, value: boolean) => void;
  disabled: boolean;
}>();
const activeFilter = computed(() =>
  props.list
    .filter((el: LayerTypeFilterOptions) => el.checked === true)
    .map((item: LayerTypeFilterOptions) => item.type)
);
</script>

<template>
  <Menu as="div" class="relative inline-block text-left" v-slot="{ open }">
    <div>
      <MenuButton
        :disabled="disabled"
        :class="[
          'p-2 text-xs border rounded-xxs flex gap-2 items-center',
          disabled && 'text-grey-500 cursor-not-allowed',
          open
            ? 'bg-grey-700 text-grey-50 border-grey-500'
            : 'bg-transparent text-grey-200 border-grey-600',
        ]"
      >
        <IcMapLayerA
          :class="[
            'text-grey-200 w-4 h-4',
            disabled && 'text-grey-500',
          ]"
          :fontControlled="false"
        />
        {{
          activeFilter.length === 1 && activeFilter[0] === "all"
            ? "All Dimension"
            : activeFilter.length + " selected"
        }}
      </MenuButton>
    </div>

    <transition
      enter-active-class="transition duration-100 ease-out"
      enter-from-class="transform scale-95 opacity-0"
      enter-to-class="transform scale-100 opacity-100"
      leave-active-class="transition duration-75 ease-in"
      leave-from-class="transform scale-100 opacity-100"
      leave-to-class="transform scale-95 opacity-0"
    >
      <MenuItems
        class="p-2 absolute mt-1 max-h-60 min-w-full overflow-auto rounded-xxs border border-grey-700 bg-grey-800 space-y-2"
      >
        <template v-for="(item, index) in list" :key="item.type">
          <MenuItem as="div" v-slot="{ active }">
            <CoreCheckbox
              :id="item.type"
              :index="index"
              :label="item.label"
              :icon="item.icon"
              :isChecked="item.checked"
              @on-change="handleChange"
            />
          </MenuItem>
        </template>
      </MenuItems>
    </transition>
  </Menu>
</template>
