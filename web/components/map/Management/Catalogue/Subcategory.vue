<script lang="ts" setup>
import { TransitionRoot } from "@headlessui/vue";
import type { Category } from "~/utils/types";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";

const props = withDefaults(
  defineProps<{
    item: Category;
    level?: number;
  }>(),
  { level: 0 }
);

const isExpand = ref(false);
const catalogueStore = useCatalogue();
const { setCategory } = catalogueStore;
const { selectedCategory } = storeToRefs(catalogueStore);

const { data: subcategoriesData, status } = useFetch<{
  data: Category;
}>(`/panel/items/categories/${props.item.category_id}`, {
  query: {
    filter: {},
    fields: "category_id,category_name,description,subcategories.*",
    sort: "category_name",
    deep: { subcategories: { _sort: "category_name" } },
  },
});
</script>

<template>
  <UButton
    :ui="{ rounded: 'rounded-xxs' }"
    :label="item.category_name"
    :variant="selectedCategory === item.category_id ? 'solid' : 'ghost'"
    color="grey"
    @click="
      () => {
        if (item.subcategories.length > 0) {
          isExpand = !isExpand;
        } else {
          setCategory(item.category_id);
        }
      }
    "
    class="text-xs flex justify-between"
    :class="{}"
    :style="{
      marginLeft: `${level * 10 + 10}px`,
      width: `calc(100% - ${level * 10 + 10}px)`,
    }"
  >
    <template #trailing v-if="item.subcategories.length > 0">
      <div
        :class="[
          isExpand ? 'rotate-0' : 'rotate-180',
          'transition-all duration-200 ease-in',
        ]"
      >
        <IcArrowReg :fontControlled="false" class="w-4 h-4 text-right" />
      </div>
    </template>
  </UButton>
  <TransitionRoot
    v-if="
      subcategoriesData?.data?.subcategories &&
      subcategoriesData.data.subcategories.length > 0
    "
    :show="isExpand"
    enter="transition-all ease-in duration-300"
    enterFrom="max-h-0 "
    enterTo="max-h-[100rem]"
    leave="transition-all ease-out duration-300"
    leaveFrom="max-h-[100rem]"
    leaveTo="max-h-0 "
    class="overflow-auto flex flex-col gap-2"
  >
    <MapManagementCatalogueSubcategory
      v-for="subcategory of subcategoriesData.data.subcategories"
      :key="subcategory.category_id"
      :item="subcategory"
      :level="level + 1"
    />
  </TransitionRoot>
</template>
