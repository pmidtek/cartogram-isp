<script lang="ts" setup>
import { useQuery } from "@tanstack/vue-query";
import { staticKey } from "~/constants";

defineProps<{
  count: number;
}>();

const catalogueStore = useCatalogue();
const { selectedCategory } = storeToRefs(catalogueStore);

const {
  data: categoryData,
  error,
  isFetching,
  isError,
} = useQuery({
  queryKey: ["category-header", selectedCategory],
  queryFn: async ({ queryKey }) => {
    if (queryKey[1] === staticKey.other) {
      return {
        category_name: "Other",
        description: "Other category",
      } as Category;
    } else if (queryKey[1] === staticKey.loadedData) {
      return {
        category_name: "Loaded Data",
        description: "Dataset Folder/Project Uploaded by User",
      } as Category;
    } else if (queryKey[1]) {
      const res = await $fetch<{ data: Category }>(
        `/panel/items/categories/${queryKey[1]}?` +
          new URLSearchParams({
            fields: "category_name,description,contributor,date_created",
          })
      );
      return res.data;
    } else {
      return null;
    }
  },
});
</script>

<template>
  <div class="p-3 border border-t-0 border-l-0 border-grey-700">
    <div v-if="!isFetching" class="flex flex-col gap-1">
      <h3 class="text-grey-50">{{ categoryData?.category_name }}</h3>
      <p class="text-xs text-grey-50">{{ categoryData?.description }}</p>
      <span class="flex items-center gap-3 text-grey-400 text-xs">
        <p v-if="categoryData?.contributor">
          Folder by: {{ categoryData?.contributor }}
        </p>
        <p v-if="categoryData?.date_created">
          Created at:
          {{
            new Date(categoryData?.date_created).toLocaleDateString("id-ID", {
              year: "numeric",
              month: "numeric",
              day: "numeric",
            })
          }}
        </p>
        <p>Number of Datasets : {{ count || 0 }}</p>
      </span>
    </div>
    <div v-else class="flex flex-col gap-1">
      <USkeleton
        :ui="{ background: 'bg-grey-800', rounded: 'rounded-xxs' }"
        class="h-5 w-32 mb-1"
      />
      <USkeleton
        :ui="{ background: 'bg-grey-800', rounded: 'rounded-xxs' }"
        class="h-3 w-52"
      />
      <USkeleton
        :ui="{ background: 'bg-grey-800', rounded: 'rounded-xxs' }"
        class="h-3 w-96"
      />
    </div>
  </div>
</template>
