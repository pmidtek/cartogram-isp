<script lang="ts" setup>
import {
  Listbox,
  ListboxLabel,
  ListboxButton,
  ListboxOptions,
  ListboxOption,
} from "@headlessui/vue";
import { logicalOperatorOptions } from "~/constants";

const props = defineProps<{
  item: any;
  fieldOption: { key: string; label: string; type: string }[];
  updateItem: any;
  deleteItem: any;
}>();

const selectedField = ref(
  props.fieldOption.filter((el) => el.key === props.item.field)[0]
);
const selectedOperator = ref(
  logicalOperatorOptions.filter((el) => el.value === props.item.operator)[0]
);

const value = ref(props.item.value || "");
const updatedItem = computed(() => {
  return {
    id: props.item.id,
    field: selectedField.value.key,
    operator: selectedOperator.value.value,
    value: value.value,
  };
});
</script>

<template>
  <div class="flex gap-2 items-center">
    <Listbox v-model="selectedField" class="z-50">
      <div class="relative mt-1">
        <ListboxButton
          class="relative w-full cursor-default rounded-lg bg-white py-2 pl-3 pr-10 text-left shadow-md focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm"
        >
          <span class="block truncate">{{ selectedField.label }}</span>
        </ListboxButton>

        <transition
          leave-active-class="transition duration-100 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <ListboxOptions
            class="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm"
          >
            <ListboxOption
              v-slot="{ active, selected }"
              v-for="field in fieldOption"
              :key="field.key"
              :value="field"
              as="template"
              @click="
                () => {
                  updateItem(updatedItem);
                }
              "
            >
              <li
                :class="[
                  active ? 'bg-amber-100 text-amber-900' : 'text-gray-900',
                  'relative cursor-default select-none py-2 px-2 pr-4',
                ]"
              >
                <span
                  :class="[
                    selected ? 'font-medium' : 'font-normal',
                    'block truncate',
                  ]"
                  >{{ field.label }}</span
                >
              </li>
            </ListboxOption>
          </ListboxOptions>
        </transition>
      </div>
    </Listbox>
    <Listbox v-model="selectedOperator" class="z-50">
      <div class="relative mt-1">
        <ListboxButton
          class="relative w-full cursor-default rounded-lg bg-white py-2 pl-3 pr-10 text-left shadow-md focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 sm:text-sm"
        >
          <span class="block truncate">{{ selectedOperator.label }}</span>
        </ListboxButton>

        <transition
          leave-active-class="transition duration-100 ease-in"
          leave-from-class="opacity-100"
          leave-to-class="opacity-0"
        >
          <ListboxOptions
            class="absolute mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-base shadow-lg ring-1 ring-black/5 focus:outline-none sm:text-sm"
          >
            <ListboxOption
              v-slot="{ active, selected }"
              v-for="field in logicalOperatorOptions"
              :key="field.value"
              :value="field"
              as="template"
              @click="
                () => {
                  updateItem(updatedItem);
                }
              "
            >
              <li
                :class="[
                  active ? 'bg-amber-100 text-amber-900' : 'text-gray-900',
                  'relative cursor-default select-none py-2 px-2 pr-4',
                ]"
              >
                <span
                  :class="[
                    selected ? 'font-medium' : 'font-normal',
                    'block truncate',
                  ]"
                  >{{ field.label }}</span
                >
              </li>
            </ListboxOption>
          </ListboxOptions>
        </transition>
      </div>
    </Listbox>
    <UInput
      v-model="value"
      @blur="
        () => {
          updateItem(updatedItem);
        }
      "
    />
    <button @click="() => deleteItem(item)">delete</button>
  </div>
</template>
