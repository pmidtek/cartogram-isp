<script lang="ts" setup>
import {
  Listbox,
  ListboxButton,
  ListboxOptions,
  ListboxOption,
} from "@headlessui/vue";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";

const props = defineProps<{
  value: string;
  options: { value: string; label: string }[];
  placeholder: string;
  disabled?: boolean;
}>();
const emit = defineEmits<{
  (e: "handleChange", value: string): void;
}>();
// const selected = ref<null | { value: string; label: string }>(
//   props.value ? props.options.filter((el) => el.value === props.value)[0] : null
// );

const selected = computed(() => {
  if (props.value) {
    return props.options.filter((el) => el.value === props.value)[0];
  } else {
    return null;
  }
});
</script>

<template>
  <Listbox :disabled="disabled" v-slot="{ disabled }">
    <div class="relative mt-1">
      <ListboxButton
        :class="[
          disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          'relative flex items-center justify-between gap-2 w-full rounded-xxs bg-grey-700 ring-1 ring-grey-600 px-3 py-4 text-left shadow-md focus:outline-none focus-visible:border-indigo-500 focus-visible:ring-2 focus-visible:ring-white/75 focus-visible:ring-offset-2 focus-visible:ring-offset-orange-300 text-sm',
        ]"
      >
        <span
          :class="[
            disabled ? 'text-grey-500' : 'text-grey-200',
            'block truncate',
          ]"
        >
          {{ selected?.label || placeholder }}
        </span>
        <IcArrowReg
          :fontControlled="false"
          :class="[
            disabled ? 'text-grey-500' : 'text-grey-200',
            'w-4 h-4 rotate-180',
          ]"
        />
      </ListboxButton>

      <transition
        leave-active-class="transition duration-100 ease-in"
        leave-from-class="opacity-100"
        leave-to-class="opacity-0"
      >
        <ListboxOptions
          class="absolute mt-1 max-h-60 w-full overflow-auto rounded-xxs bg-grey-800 p-2 space-y-2 text-base shadow-lg ring-1 ring-grey-700 focus:outline-none sm:text-sm"
        >
          <ListboxOption
            v-slot="{ active, selected }"
            v-for="option in options"
            @click="() => emit('handleChange', option.value)"
            :key="option.value"
            :value="option"
            as="template"
          >
            <li
              :class="[
                active ? 'bg-grey-700' : '',
                'relative select-none p-2 text-grey-200 rounded-xxs cursor-pointer',
              ]"
            >
              <span
                :class="[
                  selected ? 'font-medium' : 'font-normal',
                  'block truncate',
                ]"
                >{{ option.label }}</span
              >
            </li>
          </ListboxOption>
        </ListboxOptions>
      </transition>
    </div>
  </Listbox>
</template>
