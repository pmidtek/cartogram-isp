<script setup lang="ts">
import { useQuery } from "@tanstack/vue-query";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/vue";
import { useFloating, offset, flip } from "@floating-ui/vue";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";
import { layerIconsFolderId } from "~/constants";

const props = defineProps<{
  modelValue: { id: string; title: string };
  updateIconImage: (iconImageId: string, iconImageTitle: string) => void;
}>();
const emit = defineEmits(["update:modelValue"]);

const filterByTitle = ref("");

const fetcher = async (url: string, searchParams?: URLSearchParams) =>
  await fetch(`${url}${searchParams ? "?" + searchParams : ""}`).then(
    (response) => response.json()
  );

const { data: iconImageData, refetch } = useQuery({
  queryKey: [`/panel/files`],
  queryFn: ({ queryKey }) =>
    fetcher(
      queryKey[0],
      new URLSearchParams({
        filter: JSON.stringify({
          _and: [
            {
              folder: { _eq: layerIconsFolderId },
            },
            { type: { _eq: "image/svg+xml" } },
            filterByTitle.value && {
              title: { _icontains: filterByTitle.value },
            },
          ].filter((el) => el),
        }),
        fields: "*",
      })
    ),
});

const reference = ref(null);
const floating = ref(null);
const { floatingStyles } = useFloating(reference, floating, {
  placement: "right-start",
  middleware: [offset(0), flip()],
});

const filterRef = ref("");

const handleFilter = (input: string) => {
  if (input) {
    filterByTitle.value = input;
    refetch();
  } else {
    filterByTitle.value = "";
    refetch();
  }
};

watch(filterRef, debounce(handleFilter, 500));
</script>

<template>
  <Popover class="relative w-full flex items-center">
    <PopoverButton
      ref="reference"
      class="w-full flex gap-2 focus:outline-none p-2 border border-grey-500 rounded-xxs items-center justify-between"
    >
      <div class="flex gap-2 items-center">
        <img
          :src="`/panel/assets/${modelValue.id}`"
          alt="test"
          class="filter-icon h-4 w-4"
        />
        <p class="text-grey-400 text-2xs">{{ modelValue.title || "-" }}</p>
      </div>
      <IcArrowReg
        :fontControlled="false"
        class="w-4 h-4 rotate-180 text-grey-50"
      />
    </PopoverButton>

    <teleport to="body">
      <PopoverPanel
        ref="floating"
        :style="floatingStyles"
        class="absolute z-10 border border-grey-500 rounded-xxs bg-white w-[18.125rem] py-2 flex flex-col gap-2"
      >
        <p class="text-grey-400 text-sm px-2">Icon</p>
        <div class="flex flex-col gap-2 px-2">
          <p class="text-grey-400 text-2xs">Find Icons</p>
          <UInput
            v-model="filterRef"
            color="gray"
            :ui="{ rounded: 'rounded-xxs' }"
            placeholder="Filter"
            size="2xs"
          >
          </UInput>
          <div class="border-b border-grey-700" />
        </div>
        <div
          v-if="iconImageData?.data"
          class="flex gap-2 flex-wrap max-h-80 overflow-y-auto px-2"
        >
          <button
            v-for="item in iconImageData?.data"
            @click="
              () => {
                updateIconImage(item.id, item.title);
                emit('update:modelValue', { id: item.id, title: item.title });
              }
            "
            class="bg-grey-800 rounded-xxs p-2"
          >
            <img
              :src="`/panel/assets/${item.id}`"
              alt="test"
              class="filter-icon h-4 w-4 fill-red-500 stroke-white"
            />
          </button>
        </div>
      </PopoverPanel>
    </teleport>
  </Popover>
</template>

<style>
.filter-icon {
  filter: invert(68%) sepia(38%) saturate(23%) hue-rotate(22deg) brightness(95%)
    contrast(99%);
}
</style>
