<script lang="ts" setup>
import { useInfiniteQuery } from "@tanstack/vue-query";
import IcSpinner from "~/assets/icons/ic-spinner.svg";

const authStore = useAuth();
const toast = useToast();
const pageLimit = 10;
const {
  data: queueDataInfinite,
  fetchNextPage,
  hasNextPage,
  isFetching,
} = useInfiniteQuery({
  queryKey: ["geoprocessing_queue_query_key"],
  queryFn: async ({ pageParam = 1, queryKey }) => {
    const queryParams: Record<string, string> = {
      limit: pageLimit.toString(),
      page: pageParam.toString(),
      fields: "*,uploader.*",
      sort: "-mtime",
      filter: JSON.stringify({
        _or: [{ state: { _eq: "consumed" } }, { state: { _eq: "queued" } }],
      }),
    };
    const r = await $fetch<{ data: any[] }>(
      "/panel/items/geoprocessing_queue?" + new URLSearchParams(queryParams),
      {
        headers: { Authorization: "Bearer " + authStore.accessToken },
      },
    );
    return r.data;
  },
  initialPageParam: 1,
  getNextPageParam: (lastPage, allPages, lastPageParam, allPageParams) => {
    if (lastPage.length < pageLimit) {
      return undefined;
    }
    return lastPageParam + 1;
  },
  refetchInterval: 15 * 1000,
});

// Track previous statuses to detect changes
const prevStatusMap = ref<Map<string, string>>(new Map());

watch(
  () => queueDataInfinite.value?.pages.flat(),
  (items) => {
    if (!items) return;
    const currentMap = new Map<string, string>();
    for (const item of items) {
      const id = item.message_id;
      const status = (item.status ?? item.state)?.toLowerCase() ?? "";
      currentMap.set(id, status);

      const prev = prevStatusMap.value.get(id);
      if (prev && prev !== status) {
        const name = item.message?.actor_name ?? "Task";
        if (status.includes("success") || status.includes("completed")) {
          toast.add({
            title: "Process Completed",
            description: `${name} finished successfully`,
            color: "green",
            ui: {
              background: "bg-white",
              title: "text-gray-900 text-md font-semibold",
              description: "text-gray-500",
              icon: "text-green-500",
            },
          });
        } else if (status.includes("error") || status.includes("failed")) {
          toast.add({
            title: "Process Failed",
            description: `${name} encountered an error`,
            color: "red",
            ui: {
              background: "bg-white",
              title: "text-gray-900 text-md font-semibold",
              description: "text-gray-500",
              icon: "text-red-500",
            },
          });
        }
      }
    }
    prevStatusMap.value = currentMap;
  },
  { deep: true },
);

const sentinel = ref(null);
const { isVisible } = useIntersectionObserver(sentinel);

watchEffect(() => {
  if (isVisible.value && hasNextPage.value) {
    fetchNextPage();
  }
});
</script>

<template>
  <div class="space-y-2">
    <div
      v-if="queueDataInfinite?.pages.flat().length"
      v-for="(item, index) of queueDataInfinite.pages.flat()"
      :key="item.message_id"
    >
      <MapGeoprocessingCard :data="item" :isAddLayerAction="false" />
    </div>
    <div
      v-if="!queueDataInfinite?.pages.flat().length && !isFetching"
      class="text-center py-8 px-4"
    >
      <div class="flex justify-center mb-3"></div>
      <h4 class="text-sm font-medium text-grey-300 mb-1">No Active Tasks</h4>
      <p class="text-2xs text-grey-500">Your geoprocessing queue is empty</p>
    </div>
    <div
      v-if="!queueDataInfinite?.pages.flat().length && isFetching"
      v-for="i of [1, 2, 3]"
      :key="i"
    >
      <USkeleton
        :ui="{ background: 'bg-grey-800', rounded: 'rounded-xxs' }"
        class="h-10 w-full"
      />
      <div
        class="bg-transparent border border-grey-700 rounded-xxs p-2 space-y-2"
      >
        <div v-for="i of [1, 2, 3, 4]" :key="i" class="space-y-1">
          <USkeleton
            :ui="{ background: 'bg-grey-800', rounded: 'rounded-xxs' }"
            class="h-3 w-1/2"
          />
          <USkeleton
            :ui="{ background: 'bg-grey-800', rounded: 'rounded-xxs' }"
            class="h-3 w-2/3"
          />
        </div>
      </div>
    </div>
    <div
      v-if="queueDataInfinite?.pages.flat().length && hasNextPage"
      ref="sentinel"
    >
      <IcSpinner
        class="text-white animate-spin h-6 w-6 p-1 m-auto"
        :fontControlled="false"
      />
    </div>
  </div>
</template>
