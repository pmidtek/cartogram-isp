import { useInfiniteQuery } from "@tanstack/vue-query";
import type { SitePointListItem } from "~/utils/types";

const pageLimit = 15;

export function useSitePointsList(siteTypeId: number) {
  const authStore = useAuth();

  const { data, fetchNextPage, hasNextPage, isFetching, isLoading, error } =
    useInfiniteQuery({
      queryKey: ["site_points_list_query_key", siteTypeId],
      queryFn: async ({ pageParam = 1 }) => {
        const queryParams: Record<string, string> = {
          limit: pageLimit.toString(),
          page: pageParam.toString(),
          fields:
            "id,name,code,site_point_type_id.name,area_city_id.city,area_city_id.province,date_created,geom",
          sort: "-date_created",
          "filter[site_point_type_id][_eq]": String(siteTypeId),
        };
        const r = await $fetch<{ data: SitePointListItem[] }>(
          "/panel/items/site_points?" + new URLSearchParams(queryParams),
          {
            headers: { Authorization: "Bearer " + authStore.accessToken },
          },
        );
        return r.data;
      },
      initialPageParam: 1,
      getNextPageParam: (lastPage, allPages, lastPageParam) =>
        lastPage.length < pageLimit ? undefined : lastPageParam + 1,
    });

  const sitePoints = computed(() => data.value?.pages.flat() ?? []);

  return {
    sitePoints,
    fetchNextPage,
    hasNextPage,
    isFetching,
    isLoading,
    error,
  };
}
