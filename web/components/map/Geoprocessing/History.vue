<script lang="ts" setup>
import { useInfiniteQuery } from "@tanstack/vue-query";
import IcSpinner from "~/assets/icons/ic-spinner.svg";

const authStore = useAuth();
const pageLimit = 10;
const {
  data: historyDataInfinite,
  fetchNextPage,
  hasNextPage,
  isFetching,
} = useInfiniteQuery({
  queryKey: ["geoprocessing_history_query_key"],
  queryFn: async ({ pageParam = 1, queryKey }) => {
    const queryParams: Record<string, string> = {
      limit: pageLimit.toString(),
      page: pageParam.toString(),
      fields: "*,uploader.*",
      sort: "-mtime",
      filter: JSON.stringify({
        _or: [{ state: { _eq: "done" } }, { state: { _eq: "rejected" } }],
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
      v-if="historyDataInfinite?.pages.flat().length"
      v-for="(item, index) of historyDataInfinite.pages.flat()"
      :key="item.message_id"
    >
      <MapGeoprocessingCard :data="item" :isAddLayerAction="true" />
    </div>
    <div
      v-if="!historyDataInfinite?.pages.flat().length && !isFetching"
      class="text-white text-center mt-5"
    >
      <h4 class="text-sm text-grey-50">No Data</h4>
    </div>
    <div
      v-if="!historyDataInfinite?.pages.flat().length && isFetching"
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
      v-if="historyDataInfinite?.pages.flat().length && hasNextPage"
      ref="sentinel"
    >
      <IcSpinner
        class="text-white animate-spin h-6 w-6 p-1 m-auto"
        :fontControlled="false"
      />
    </div>
  </div>
</template>
