<script setup lang="ts">
import { Menu, MenuButton, MenuItems, MenuItem } from "@headlessui/vue";
import { storeToRefs } from "pinia";
import type { Component } from "vue";
import IcArrow from "~/assets/icons/ic-arrow-reg.svg";
import type { ToolItem } from "~/utils/types";

const props = defineProps<{
  triggerLabel?: string;
  triggerIcon?: string | Component;
  itemLabel?: string;
  itemDescription?: string;
  items?: ToolItem[];
}>();

const toolsStore = useMapTools();
const { expandTools } = storeToRefs(toolsStore);
</script>

<template>
  <Menu as="div" v-slot="{ open }" class="relative inline-block text-left">
    <div>
      <MenuButton
        :class="[
          open
            ? 'bg-gradient-to-r from-blue-200/80 to-blue-600 text-white'
            : 'bg-transparent enabled:hover:bg-gradient-to-r enabled:hover:from-blue-200/80 enabled:hover:to-blue-600 enabled:hover:text-white text-grey-700 disabled:hover:bg-transparent',
          'inline-flex w-full items-center h-9 gap-3 rounded-xxs px-2 py-2 text-sm font-normal focus:outline-none disabled:text-grey-200 ',
        ]"
      >
        <component
          :is="triggerIcon"
          class="w-4 h-4"
          :fontControlled="false"
        ></component>
        <div
          :class="[
            expandTools ? 'w-72' : 'w-0',
            'max-w-max  whitespace-nowrap overflow-hidden',
          ]"
        >
          {{ triggerLabel }}
        </div>
        <IcArrow class="w-4 h-4" :fontControlled="false" />
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
        class="absolute right-0 bottom-12 mt-2 p-3 flex flex-col gap-2 w-60 origin-top-right rounded-xs bg-white shadow-lg ring-1 ring-grey-800 focus:outline-none"
      >
        <div v-show="itemLabel || itemDescription" class="text-white">
          <p class="text-xs text-grey-900 mb-1">{{ itemLabel }}</p>
          <p class="text-2xs text-grey-600">{{ itemDescription }}</p>
        </div>
        <UDivider />
        <slot name="custom-item" />
        <template v-for="item in items" :key="item.id">
          <MenuItem v-slot="{ active }">
            <button
              @click="
                () => {
                  if (item.action) {
                    item.action(item);
                  }
                }
              "
              :class="[
                active ? 'bg-grey-700' : 'bg-transparent text-grey-200',
                'group flex w-full items-center gap-3 rounded-xxs p-2 text-xs text-grey-900 hover:bg-gradient-to-r hover:from-blue-200/80 hover:to-blue-600 hover:text-white',
              ]"
            >
              <component
                :is="item.icon"
                class="w-[14px] h-[14px]"
                :fontControlled="false"
              ></component>
              {{ item.label }}
            </button>
          </MenuItem>
        </template>
      </MenuItems>
    </transition>
  </Menu>
</template>
