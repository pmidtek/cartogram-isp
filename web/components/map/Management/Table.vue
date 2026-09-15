<script setup lang="ts">
import { useQuery, useInfiniteQuery } from "@tanstack/vue-query";
import type { GeoJSONSource, LngLatBoundsLike } from "maplibre-gl";
import IcCross from "~/assets/icons/ic-cross.svg";
import IcAdd from "~/assets/icons/ic-layer-plus.svg";
import IcDownload from "~/assets/icons/ic-download.svg";
import IcExpand from "~/assets/icons/ic-fullscreen.svg";
import IcFilter from "~/assets/icons/ic-filter.svg";
import IcShrink from "~/assets/icons/ic-shrink.svg";
import IcSort from "~/assets/icons/ic-sort.svg";
import bbox from "@turf/bbox";

import {
  Menu,
  MenuButton,
  MenuItems,
  MenuItem,
  TransitionRoot,
  TransitionChild,
  Dialog,
  DialogPanel,
  DialogTitle,
} from "@headlessui/vue";

const loadingRef = ref<HTMLElement>();
const isLoading = ref(false);
const isFetching = ref<boolean>(false);
const digitizeStore = useDigitizeStore();
const featureStore = useFeature();
const { typeFeature } = storeToRefs(featureStore);

export type HeaderData = {
  field: string;
  type: string;
};

interface Filter {
  column: string;
  operation: string;
  value: string;
}

interface DataResult {
  class_ts: string | null;
  count: string;
}

type Columns = { key: string; label: string; type: string };

const store = useTableData();
const { toggleTable, toggleFullscreen } = store;

const selectedIds = ref<any[]>([]);
const selectedGeom = ref<any[]>([]);
const highlightedIds = ref<string[]>([]);
const authStore = useAuth();

const baseCollection = computed(() => {
  const collection = store.activeCollection;
  return collection?.includes("?") ? collection.split("?")[0] : collection;
});

// Helper function to get the ID field from a row
const getRowId = (row: any): number | null => {
  return row.id ?? row.ogc_fid ?? null;
};

const desaNameValue = computed(() => {
  const collection = store.activeCollection;
  const params = new URLSearchParams(collection?.split("?")[1]);

  return Object.fromEntries(params.entries());
});

const useIntersectionObserver = (
  elementRef: Ref<Element | undefined>,
  callback: () => void,
  options = {},
) => {
  const observer = ref<IntersectionObserver | null>(null);

  onMounted(() => {
    if (!elementRef.value) return;

    observer.value = new IntersectionObserver((entries) => {
      const [entry] = entries;
      if (entry.isIntersecting) {
        callback();
      }
    }, options);

    observer.value.observe(elementRef.value);
  });

  onUnmounted(() => {
    if (observer.value) {
      observer.value.disconnect();
    }
  });

  return observer;
};

const {
  data: meData,
  error: meError,
  isFetching: isMeFetching,
  isError: isMeError,
} = useQuery({
  queryKey: ["/panel/users/me"],
  queryFn: ({ queryKey }) =>
    $fetch<{ id: string; is_can_download: boolean }>(queryKey[0], {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    }),
});

const {
  data: reqData,
  error: reqError,
  isFetching: isReqFetching,
  isError: isReqError,
} = useQuery({
  queryKey: ["/panel/items/request_download_logs"],
  queryFn: ({ queryKey }) =>
    $fetch<
      Array<{
        id: number;
        status: string;
        user_created: string;
        date_created: string;
        message: string | null;
      }>
    >(queryKey[0], {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    }),
});

const requested = ref<boolean>(false);

// Watch for changes in reqData and update `requested`
watch(
  () => reqData?.value?.data,
  (newReqData) => {
    console.log("newReqData:", newReqData); // Log to verify structure

    if (Array.isArray(newReqData)) {
      const currentUserId = meData?.value?.id;
      const hasPendingRequests = newReqData.some(
        (req) =>
          req.user_created === currentUserId && req.status === "Approved",
      );
      requested.value = hasPendingRequests;
    } else {
      console.error("reqData?.value is not an array:", newReqData);
      requested.value = false;
    }
  },
  { immediate: true },
);

const {
  data: headerData,
  error: headerError,
  isFetching: isHeaderFetching,
  isError: isHeaderError,
} = useQuery({
  queryKey: [
    `/panel/vector-tiles-attribute-table-header/`,
    baseCollection.value,
  ],
  queryFn: ({ queryKey }) =>
    $fetch<{ data: HeaderData[] }>(queryKey[0] + queryKey[1]!, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    }).then((r) => r.data),
});

const relationalFields: Record<string, { key: string; label: string }[]> = {
  assets: [
    { key: "site_point_id.name", label: "Site Name" },
    { key: "site_point_id.area_city_id.province", label: "Province" },
  ],
};

const columns = computed<
  {
    key: string;
    label: string;
    type: string;
  }[]
>(() => {
  if (headerData.value) {
    const extra = relationalFields[baseCollection.value ?? ""] ?? [];
    const excludedKeys = [
      ...extra.map((f) => f.key.split(".")[0]),
      "status",
      "user_created",
      "user_updated",
    ];
    return [
      ...headerData.value
        .map((el: HeaderData) => ({
          key: el.field,
          label: capitalizeEachWords(el.field),
          type: el.type,
        }))
        .filter(
          (el: Columns) =>
            el.type !== "geometry" && !excludedKeys.includes(el.key),
        ),
      ...extra.map((f) => ({ ...f, type: "string" })),
    ];
  } else return [];
});

const getFieldValue = (row: any, key: string): any => {
  return key.split(".").reduce((obj, part) => obj?.[part], row);
};

const sortBy = ref("");

// const queryFilter = ref([]);

// New reactive references for filter
const filterColumn = ref("");
const filterOperation = ref("");
const filterValue = ref("");
const appliedFilters = ref<Filter[]>([]);

const queryFilter = computed(() => {
  const filters = appliedFilters.value.map((filter) => {
    const { column, operation, value } = filter;
    switch (operation) {
      case "Equals":
        return { [column]: { _eq: value } };
      case "Doesnt Equals":
        return { [column]: { _neq: value } };
      case "Contains":
        return { [column]: { _icontains: `%${value}%` } };
      case "Doesnt Contains":
        return { [column]: { _ncontains: `%${value}%` } };
      case "Starts With":
        return { [column]: { _istarts_with: `${value}%` } };
      case "Ends With":
        return { [column]: { _iends_with: `%${value}` } };
      case "Less Than":
        return { [column]: { _lt: value } };
      case "Greather Than":
        return { [column]: { _gt: value } };
      case "Greather Than Equals":
        return { [column]: { _gte: value } };
      case "Is Null":
        return { [column]: { _null: true } };
      case "Is Not Null":
        return { [column]: { _nnull: true } };
      default:
        return {};
    }
  });
  const queryParams = desaNameValue.value;

  if (queryParams) {
    const kabNameKey = Object.keys(queryParams).find((key) =>
      key.toLowerCase().includes("kab"),
    );
    const kecNameKey = Object.keys(queryParams).find((key) =>
      key.toLowerCase().includes("kec"),
    );
    const desaNameKey = Object.keys(queryParams).find((key) =>
      key.toLowerCase().includes("desa"),
    );

    if (kabNameKey && queryParams[kabNameKey]) {
      filters.push({ [kabNameKey]: { _eq: queryParams[kabNameKey] } });
    }

    if (kecNameKey && queryParams[kecNameKey]) {
      filters.push({ [kecNameKey]: { _eq: queryParams[kecNameKey] } });
    }
    if (desaNameKey && queryParams[desaNameKey]) {
      filters.push({ [desaNameKey]: { _eq: queryParams[desaNameKey] } });
    }
  }

  return filters.length ? { _and: filters } : {};
});

const encodedQueryFilter = computed(() => {
  const defaultFilter =
    baseCollection.value === "site_points" && typeFeature.value === "backhaul"
      ? { site_point_type_id: { _neq: 3 } }
      : {};
  return encodeURIComponent(
    JSON.stringify({
      ...defaultFilter,
      ...queryFilter.value,
    }),
  );
});

const {
  data: countData,
  error: countError,
  isFetching: isCountFetching,
  isError: isCountError,
} = useQuery({
  queryKey: [
    `/panel/items/${baseCollection.value}?aggregate[count]=*&filter=${encodedQueryFilter.value}`,
  ],
  queryFn: ({ queryKey }) =>
    $fetch<{ data: { count: number }[] }>(queryKey[0], {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    }).then((r) => r.data[0].count),
});

const {
  data: tableData,
  error: tableError,
  fetchNextPage,
  hasNextPage,
  isError: isTableError,
  isFetching: isTableFetching,
  refetch,
} = useInfiniteQuery({
  queryKey: [`/panel/items/${baseCollection.value}?`, sortBy, queryFilter],
  queryFn: async ({ pageParam = 1, queryKey }) => {
    const defaultFilter =
      (queryKey[0] as string).includes("site_points") &&
      typeFeature.value === "backhaul"
        ? { site_point_type_id: { _neq: 3 } }
        : {};

    const queryParams: Record<string, string> = {
      limit: "30",
      page: pageParam.toString(),
      ...(headerData.value && {
        fields: headerData.value
          .filter((el: HeaderData) => el.type !== "geometry")
          .map((el: HeaderData) => el.field)
          .concat(
            "id",
            "ogc_fid",
            ...(relationalFields[baseCollection.value ?? ""] ?? []).map(
              (f) => f.key,
            ),
          )
          .join(","),
      }),
      sort: queryKey[1] as string,
      filter: JSON.stringify({
        ...defaultFilter,
        ...queryKey[2],
      }),
    };

    console.log(queryParams);
    const r = await $fetch<{ data: any[] }>(
      (queryKey[0] as string) + new URLSearchParams(queryParams),
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    console.log("API Response r:", r);
    console.log("API Response r.data:", r.data);
    console.log("First row from API:", r.data?.[0]);
    console.log(
      "First row keys from API:",
      r.data?.[0] ? Object.keys(r.data[0]) : "no data",
    );
    return r.data;
  },
  initialPageParam: 1,
  getNextPageParam: (_, allPages, lastPageParam) => {
    if (allPages.length * 25 >= countData.value!) {
      return undefined;
    }
    return lastPageParam + 1;
  },
});

const addFilter = () => {
  if (filterColumn.value && filterOperation.value && filterValue.value) {
    appliedFilters.value.push({
      column: filterColumn.value,
      operation: filterOperation.value,
      value: filterValue.value,
    });

    filterColumn.value = "";
    filterOperation.value = "";
    filterValue.value = "";
  }
};

const removeFilter = (index: number) => {
  appliedFilters.value.splice(index, 1);
};

const applyFilters = async () => {
  // Clear selections when applying filters
  selectedIds.value = [];
  isAllChecked.value = false;
  selectedGeom.value = [];

  await refetch();

  console.log("After refetch - tableData.value:", tableData.value);

  if (tableData.value && tableData.value.pages.length > 0) {
    console.log("Pages length:", tableData.value.pages.length);
    console.log("First page:", tableData.value.pages[0]);
    const firstRow = tableData.value.pages[0]?.[0];
    console.log("First row sample:", firstRow);
    console.log(
      "All keys in first row:",
      firstRow ? Object.keys(firstRow) : "no row",
    );
    console.log(
      "Checking for ID fields - id:",
      firstRow?.id,
      "ogc_fid:",
      firstRow?.ogc_fid,
      "npsn:",
      firstRow?.npsn,
    );

    const allFilteredIds = tableData.value.pages
      .flatMap((page) => page.map((row) => getRowId(row)))
      .filter((id) => id !== null && id !== undefined && id !== "");

    console.log("allFilteredIds in applyFilters:", allFilteredIds);
    highlightedIds.value = allFilteredIds;
  }

  closeModalFilter();
};

const resetFilters = () => {
  appliedFilters.value = [];
  selectedIds.value = [];
  isAllChecked.value = false;
  selectedGeom.value = [];
  refetch();
};

watch(
  appliedFilters,
  async () => {
    // Clear selections when filters change
    selectedIds.value = [];
    isAllChecked.value = false;
    selectedGeom.value = [];

    await refetch();

    if (tableData.value && tableData.value.pages.length > 0) {
      console.log("Watch - tableData.value.pages:", tableData.value.pages);
      const allFilteredIds = tableData.value.pages
        .flatMap((page) => page.map((row) => getRowId(row)))
        .filter((id) => id !== null && id !== undefined && id !== "");
      highlightedIds.value = allFilteredIds;
      console.log("Watch - allFilteredIds:", allFilteredIds);
    }
  },
  { deep: true },
);

const isAllChecked = ref(false);

const toggleSelectAll = () => {
  if (isAllChecked.value) {
    // If currently all checked, uncheck all
    selectedIds.value = [];
    highlightedIds.value = [];
    isAllChecked.value = false;
  } else {
    // If not all checked, check all visible rows
    const allIds = tableData.value.pages.flatMap((page) =>
      page.map((row) => getRowId(row)),
    );
    selectedIds.value = allIds;
    highlightedIds.value = allIds;
    isAllChecked.value = true;
  }
};

const onRowClick = (fid: string) => {
  if (highlightedIds.value.includes(fid as string))
    highlightedIds.value = highlightedIds.value.filter((e) => e !== fid);
  else highlightedIds.value = [...highlightedIds.value, fid as string];
};

const onRowSelect = (fid: string) => {
  console.log(fid);
  if (selectedIds.value.includes(fid)) {
    selectedIds.value = selectedIds.value.filter((e) => e !== fid);
    isAllChecked.value = false;
  } else {
    selectedIds.value = [...selectedIds.value, fid];

    const allVisibleIds = tableData?.value?.pages.flatMap((page) =>
      page.map((row) => getRowId(row)),
    );
    isAllChecked.value = allVisibleIds?.every((id) =>
      selectedIds.value.includes(id),
    );
  }

  if (!highlightedIds.value.includes(fid)) {
    highlightedIds.value = [...highlightedIds.value, fid];
  }
};
const mapRefStore = useMapRef();
const debouncedMapHighlight = debounce(async (newValue: string[]) => {
  // Filter out null, undefined, and empty string values
  const validIds = newValue.filter(
    (id) => id !== null && id !== undefined && id !== "",
  );

  if (!validIds.length) {
    if (mapRefStore.map?.getSource("highlight")) {
      (mapRefStore.map.getSource("highlight") as GeoJSONSource).setData(
        emptyFeatureCollection,
      );
      pauseAllAnimation();
    }
  } else {
    // Determine which ID field to use based on the first row of data
    const firstRow = tableData?.value?.pages?.[0]?.[0];
    let filterKey = "filter[id][_in]";

    if (firstRow?.ogc_fid !== undefined) {
      filterKey = "filter[ogc_fid][_in]";
    } else if (firstRow?.npsn !== undefined && firstRow?.id === undefined) {
      filterKey = "filter[npsn][_in]";
    }

    const queryParams: Record<string, string> = {
      fields: "geom",
      [filterKey]: validIds.join(","),
    };
    const { data } = await $fetch<{ data: any }>(
      `/panel/items/${store.activeCollection}?` +
        new URLSearchParams(queryParams),
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    showHighlightLayer(mapRefStore.map!, data, store.activeCollection!, true);
    mapRefStore.map!.fitBounds(
      bbox({
        type: "FeatureCollection",
        features: data.map(({ geom }: { geom: GeoJSON.Geometry }) => ({
          type: "Feature",
          geometry: geom,
        })),
      } as GeoJSON.FeatureCollection) as LngLatBoundsLike,
      {
        padding: {
          top: 80,
          bottom: 20,
          left: window.innerWidth * 0.49,
          right: 20,
        },
      },
    );
  }
}, 2000);
watch(highlightedIds, debouncedMapHighlight, {
  immediate: true,
});

const toast = useToast();
watchEffect(() => {
  if (isHeaderError.value || isCountError.value || isTableError.value) {
    toast.add({
      title: "Error on fetching table data",
      description: "Something went wrong, please contact data administrator",
      icon: "i-heroicons-information-circle",
    });
  }
});

const floatVisibility = ref(0);

const handleScroll = async (event: Event) => {
  const element = event.target as HTMLDivElement;

  const willVisible =
    (24 - (element.scrollHeight - element.clientHeight - element.scrollTop)) /
    24;
  floatVisibility.value = willVisible || 0;

  const scrollPosition = element.scrollTop + element.clientHeight;
  const scrollThreshold = element.scrollHeight - 200; // 200px from bottom

  if (
    !isLoading.value &&
    hasNextPage.value &&
    scrollPosition >= scrollThreshold
  ) {
    try {
      isLoading.value = true;
      await fetchNextPage();
    } finally {
      isLoading.value = false;
    }
  }
};

const handleIntersection = async () => {
  if (!isLoading.value && hasNextPage.value) {
    isLoading.value = true;
    await fetchNextPage();
    isLoading.value = false;
  }
};

useIntersectionObserver(loadingRef, handleIntersection);

const loadingDownload = ref("");
const loadingToast = ref<any>(null);
const isModalOpenDownload = ref(false);

// STILL TS PROBLEM
watchEffect(() => {
  if (loadingDownload.value) {
    if (loadingToast.value) {
      toast.clear?.(loadingToast.value.id);
    }

    loadingToast.value = {
      id: toast.add({
        title: "Download in Progress",
        description: "Your file is being prepared...",
        timeout: 0,
      }),
    };
  } else if (loadingToast.value) {
    toast.clear?.(loadingToast.value.id);
    loadingToast.value = null;
  }
});

const downloadData = async () => {
  if (meData?.value?.data?.is_can_download) {
    loadingDownload.value = "Downloading...";

    const downloadColumns = columns.value;
    const downloadFields = [
      ...downloadColumns.map((c) => c.key),
      "id",
      "ogc_fid",
    ].join(",");

    try {
      const response = await $fetch<{ data: any[] }>(
        `/panel/items/${baseCollection.value}?filter=${encodedQueryFilter.value}&limit=-1&fields=${encodeURIComponent(downloadFields)}`,
        {
          headers: {
            Authorization: "Bearer " + authStore.accessToken,
          },
        },
      );

      const rows = response.data ?? [];

      const escape = (val: any) => {
        if (val === null || val === undefined) return "";
        const s = typeof val === "object" ? JSON.stringify(val) : String(val);
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };

      const csv = [
        downloadColumns.map((c) => escape(c.label)).join(","),
        ...rows.map((row) =>
          downloadColumns
            .map((c) => escape(getFieldValue(row, c.key)))
            .join(","),
        ),
      ].join("\n");

      const blob = new Blob(["\uFEFF" + csv], {
        type: "text/csv;charset=utf-8;",
      });
      const anchor = document.createElement("a");
      const href = window.URL.createObjectURL(blob);
      anchor.download = `${store.activeCollection}.csv`;
      anchor.href = href;
      anchor.click();
      window.URL.revokeObjectURL(href);
      anchor.remove();

      // Delay Toast Succes
      setTimeout(() => {
        toast.add({
          title: "Download Complete",
          description: "The data has been downloaded successfully.",
        });
      }, 400);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      toast.add({
        title: "Error on downloading table data",
        description: message,
      });
    } finally {
      loadingDownload.value = "";
    }
  } else {
    isModalOpenDownload.value = true;
  }
};
const hiddenFields = ref<string[]>([]);

const isOpen = ref(false);
const isOpenFilter = ref(false);

function closeModal() {
  isModalOpenDownload.value = false;
}
function openModal() {
  isOpen.value = true;
}

function openModalFilter() {
  isOpenFilter.value = true;
}
function closeModalFilter() {
  isOpenFilter.value = false;
}

const selectedCount = computed(() => {
  if (isAllChecked.value) {
    return countData?.value - selectedIds.value.length;
  }
  return selectedIds.value.length;
});

// watchEffect(() => {
//   console.log(selectedIds.value);
//   console.log(highlightedIds.value);
//   console.log(selectedGeom.value);
//   console.log(selectedGeom.value.geom);
// });

const requestDownloadLogs = async () => {
  const payload = {
    message: "test",
  };

  try {
    const response = await fetch("/panel/items/request_download_logs", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Success:", data);

    alert("Download log request submitted successfully!");
  } catch (error) {
    console.error("Error:", error);

    alert(`Error: ${error.message}`);
  }
};

const handleAnalyis = async () => {
  let hasError = false;
  try {
    isFetching.value = true;
    const token = authStore.accessToken;
    const fid = selectedIds.value.map(Number);

    const url = `/panel/chart/count/layer/house_class`;

    const body = {
      ogcFids: fid,
      layer: store.activeCollection,
    };
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      hasError = true;
      toast.add({
        title: "Error",
        description: "Error Fetch Geom Data, Please Refresh",
        icon: "i-heroicons-exclamation-circle",
      });
    }

    const dataResult: DataResult[] = await response.json();

    console.log(dataResult);
    if (!hasError) {
      toast.add({
        title: "Success",
        description: "Data successfully digitized and stored.",
        icon: "i-heroicons-check-circle",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });

      digitizeStore.addDigitizedData({
        name: "House Class",
        layer: selectedIds.value,
        area: tableName,
        coordinates: "From Table",
        data: { "House Class": dataResult },
      });

      featureStore.setMapInfo("analytic");
    }
  } catch (error) {}
};

const tableName = !store.activeCollection
  ? ""
  : store.activeCollection.match(/[?&](?:\w+)=([^&]+)/)
    ? store.activeCollection
        .match(/[?&](?:\w+)=([^&]+)/)[1]
        .split(/[_\s]/)
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ")
    : store.activeCollection
        .split(/[_\s]/)
        .map(
          (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase(),
        )
        .join(" ");
</script>

<template>
  <div class="flex flex-col gap-3 p-6 h-full max-h-full relative">
    <div class="flex justify-between">
      <div>
        <h1 class="text-grey-900 font-medium">Data Table</h1>
        <p class="text-2xs text-grey-600">
          Manage tabular data related to layer to be displayed on map
        </p>
      </div>
      <div class="flex items-center gap-2">
        <button @click="toggleFullscreen" class="p-2 rounded-xxs bg-white">
          <IcExpand
            class="w-[14px] h-[14px] text-grey-400"
            :fontControlled="false"
          />
        </button>
        <button
          @click="
            () => {
              toggleTable();
              store.fullscreen && toggleFullscreen();
              highlightedIds = [];
              selectedIds = [];
            }
          "
        >
          <IcCross class="w-4 h-4 text-grey-400" :fontControlled="false" />
        </button>
      </div>
    </div>
    <hr class="border-b border-grey-700" />
    <div class="flex justify-between items-center gap-3">
      <div class="flex items-center gap-3 justify-between w-full">
        <div class="flex items-center gap-3">
          <Menu as="div" class="relative z-10">
            <MenuButton
              class="flex items-center gap-3 p-2 border border-grey-600 rounded-xxs bg-white text-xs text-grey-900"
            >
              <IcSort
                class="w-[14px] h-[14px] text-grey-400"
                :fontControlled="false"
              />
              Show All Field
            </MenuButton>
            <transition
              enter-active-class="transition duration-100 ease-out"
              enter-from-class="transform scale-95 opacity-0"
              enter-to-class="transform scale-100 opacity-100"
              leave-active-class="transition duration-75 ease-in"
              leave-from-class="transform scale-100 opacity-100"
              leave-to-class="transform scale-95 opacity-0"
            >
              <MenuItems
                class="absolute left-0 mt-2 w-52 max-h-52 overflow-y-scroll origin-top-left rounded-xxs bg-white shadow-lg ring-1 ring-black/5 focus:outline-none overflow-x-hidden"
              >
                <MenuItem v-for="column in columns" :key="column.key">
                  <div
                    class="text-grey-900 flex w-full items-center p-2 gap-x-2 text-xs first:rounded-t-xxs last:rounded-b-xxs"
                  >
                    <CoreCheckbox
                      :id="column.key + '-checkbox'"
                      :index="0"
                      :is-checked="!hiddenFields.includes(column.key)"
                      :forHeader="true"
                      @click="
                        (event: Event) => {
                          event.preventDefault();
                          if (hiddenFields.includes(column.key)) {
                            hiddenFields = hiddenFields.filter(
                              (c) => c !== column.key,
                            );
                          } else {
                            hiddenFields = [...hiddenFields, column.key];
                          }
                        }
                      "
                    />
                    {{ column.label }}
                  </div>
                </MenuItem>
              </MenuItems>
            </transition>
          </Menu>

          <button
            @click="openModalFilter"
            class="flex items-center gap-3 p-2 border border-grey-600 rounded-xxs bg-white text-xs text-grey-900 relative"
          >
            <IcFilter
              class="w-[14px] h-[14px] text-grey-400"
              :fontControlled="false"
            />
            Filter
            <span
              v-if="appliedFilters.length > 0"
              class="absolute -top-2 -right-2 bg-brand-500 text-white rounded-full w-5 h-5 flex items-center justify-center text-xs"
            >
              {{ appliedFilters.length }}
            </span>
          </button>
        </div>

        <!-- New Filter Modal -->
        <transition name="modal-fade">
          <div
            v-if="isOpenFilter"
            class="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50"
          >
            <div
              class="bg-white text-gray-900 rounded-xs shadow-lg p-6 w-full max-w-2xl h-[32rem] relative"
            >
              <div class="flex items-start justify-between">
                <h3 class="text-sm font-semibold mb-4">Filter</h3>
                <button @click="closeModalFilter" class="text-grey-800">
                  &times;
                </button>
              </div>
              <div class="w-full h-[1px] bg-grey-600 mb-4" />
              <section>
                <div class="flex justify-between w-full gap-2 mb-4">
                  <USelect
                    v-model="filterColumn"
                    placeholder="Select Column"
                    :options="
                      columns.map((column) => ({
                        label: column.label,
                        value: column.key,
                        detailData: column.key,
                      }))
                    "
                    option-attribute="detailData"
                    :ui="{ rounded: 'rounded-xxs' }"
                    size="sm"
                    class="w-full"
                  />
                  <USelect
                    v-model="filterOperation"
                    placeholder="Select Operation"
                    :options="[
                      'Equals',
                      'Doesnt Equals',
                      'Contains',
                      'Doesnt Contains',
                      'Starts wWth',
                      'Ends With',
                      'Less Than',
                      'Less Than Equals',
                      'Greater Than',
                      'Greather Than Equals',
                      'Is Null',
                      'Is Not Null',
                    ]"
                    option-attribute="detailData"
                    :ui="{ rounded: 'rounded-xxs' }"
                    size="sm"
                    class="w-full"
                  />
                  <UInput
                    v-model="filterValue"
                    placeholder="Enter Value to Filter"
                    :ui="{ rounded: 'rounded-xxs' }"
                    size="sm"
                    class="w-full"
                  />
                  <UButton
                    variant="outline"
                    color="gray"
                    size="sm"
                    type="button"
                    label="Add"
                    class="px-4"
                    :ui="{ rounded: 'rounded-xxs' }"
                    @click="addFilter"
                  />
                </div>
                <section class="mt-10">
                  <p class="text-xs">Applied Filter</p>
                  <div class="w-full h-[1px] bg-grey-600 my-3" />
                  <div
                    v-for="(filter, index) in appliedFilters"
                    :key="index"
                    class="flex justify-between items-center mb-2 w-full"
                  >
                    <UButton
                      size="xs"
                      color="gray"
                      type="button"
                      :label="filter.column"
                      class="border-brand-300 text-brand-500 border bg-transparent w-[30%]"
                      :ui="{ rounded: 'rounded-xxs' }"
                    />
                    <UButton
                      size="xs"
                      color="gray"
                      type="button"
                      :label="filter.operation"
                      class="border-brand-300 text-brand-500 border bg-transparent w-[30%]"
                      :ui="{ rounded: 'rounded-xxs' }"
                    />
                    <UButton
                      size="xs"
                      color="gray"
                      type="button"
                      :label="filter.value"
                      class="border-brand-300 text-brand-500 border bg-transparent w-[30%]"
                      :ui="{ rounded: 'rounded-xxs' }"
                    />
                    <UButton
                      variant="outline"
                      color="gray"
                      size="xs"
                      type="button"
                      label="X"
                      class="px-4"
                      :ui="{ rounded: 'rounded-xxs' }"
                      @click="() => removeFilter(index)"
                    />
                  </div>
                </section>
                <!-- <UButton
                  variant="outline"
                  size="sm"
                  type="button"
                  label="+ Add Filter"
                  class="w-full"
                  :ui="{ rounded: 'rounded-xxs' }"
                /> -->
              </section>
              <div class="w-full absolute bottom-6 left-0 px-6">
                <div class="w-full h-[1px] bg-grey-600 mb-4" />
                <div class="flex w-full justify-between">
                  <UButton
                    size="sm"
                    color="gray"
                    type="button"
                    label="Reset Filter"
                    :ui="{ rounded: 'rounded-xxs' }"
                    class="w-[49%] justify-center"
                    @click="resetFilters"
                  />
                  <UButton
                    size="sm"
                    type="button"
                    label="Apply Filter"
                    :ui="{ rounded: 'rounded-xxs' }"
                    :disabled="appliedFilters.length === 0"
                    class="w-[49%] justify-center"
                    L
                    @click="applyFilters"
                  />
                </div>
              </div>
            </div>
          </div>
        </transition>
        <button
          @click="downloadData"
          class="flex items-center gap-3 p-2 border border-grey-600 rounded-xxs bg-white text-xs text-grey-900"
        >
          <IcDownload
            class="w-[14px] h-[14px] text-grey-400"
            :fontControlled="false"
          />
          Download
          {{ meData?.data?.is_can_download ? "All" : "Request Access" }}
        </button>

        <!-- Modal -->
        <transition name="fade">
          <div
            v-if="isModalOpenDownload"
            class="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50"
          >
            <div
              class="bg-[#232221] text-white rounded-xs shadow-lg p-6 w-full max-w-2xl"
            >
              <div class="flex items-start justify-between">
                <h2 class="text-lg font-bold text-white font-raleway">Dashboard</h2>
                <button @click="closeModal" class="text-grey-800">
                  &times;
                </button>
              </div>
              <div class="mt-6">
                <h3 class="text-xl text-grey-800 font-medium">
                  You need access
                </h3>
                <p class="text-grey-400 text-sm">
                  Request access, or switch account that have an access
                </p>
                <UButton
                  :disabled="requested"
                  @click="requestDownloadLogs"
                  class="rounded-xxs mt-24"
                >
                  Request Access
                </UButton>
              </div>
            </div>
          </div>
        </transition>
        <!-- <button
          @click="handleAnalyis"
          v-if="selectedIds.length >= 1"
          class="flex items-center gap-3 p-2 border border-grey-600 rounded-xxs bg-brand-600 text-xs text-white"
        >
          <SvgoIcChartPie
            class="w-[14px] h-[14px] text-grey-400"
            :fontControlled="false"
          />
          Show Analysis
        </button> -->
      </div>
    </div>
    <!-- New Tab;le -->
    <section
      class="h-[calc(100%-10.5rem)] flex flex-col rounded-xxs border border-grey-700 w-full overflow-auto pb-12 relative"
      @scroll="handleScroll"
    >
      <header class="flex w-full sticky top-0">
        <div class="bg-white h-14 w-14 flex items-center justify-center">
          <CoreCheckbox
            id="all-checkbox"
            :index="0"
            :is-checked="isAllChecked"
            :forHeader="true"
            @click="toggleSelectAll"
          />
        </div>
        <Menu
          as="div"
          class="relative"
          v-for="column in columns.filter((c) => !hiddenFields.includes(c.key))"
          :key="column.key"
        >
          <MenuButton
            class="bg-white hover:bg-grey-200 h-14 flex-1 min-w-[12rem] text-grey-900 flex items-center justify-between text-xs font-medium px-3 py-4 group"
          >
            <div class="flex gap-2">
              <p class="line-clamp-2">{{ column.label }}</p>
              <p class="hidden group-hover:block">&#8595;</p>
            </div>
            <UIcon
              v-if="sortBy.includes(column.key)"
              name="i-heroicons-bars-3-bottom-right"
              :class="
                'text-grey-400 h-5 w-5 ' +
                (sortBy[0] === '-' ? 'scale-x-[-1]' : 'rotate-180')
              "
              aria-hidden="true"
            />
          </MenuButton>
          <transition
            enter-active-class="transition duration-100 ease-out"
            enter-from-class="transform scale-95 opacity-0"
            enter-to-class="transform scale-100 opacity-100"
            leave-active-class="transition duration-75 ease-in"
            leave-from-class="transform scale-100 opacity-100"
            leave-to-class="transform scale-95 opacity-0"
          >
            <MenuItems
              class="absolute left-0 mt-2 w-full origin-top-left rounded-xxs bg-white shadow-lg ring-1 ring-black/5 focus:outline-none overflow-hidden"
            >
              <MenuItem>
                <button
                  class="text-grey-900 flex w-full items-center p-3 text-xs hover:bg-grey-200"
                  @click="
                    () => {
                      sortBy = column.key;
                    }
                  "
                >
                  <UIcon
                    name="i-heroicons-bars-3-bottom-right"
                    class="mr-2 h-4 w-4 rotate-180"
                    aria-hidden="true"
                  />
                  Sort Ascending
                </button>
              </MenuItem>
              <MenuItem>
                <button
                  class="text-grey-900 flex w-full items-center p-3 text-xs hover:bg-grey-200"
                  @click="
                    () => {
                      sortBy = '-' + column.key;
                    }
                  "
                >
                  <UIcon
                    name="i-heroicons-bars-3-bottom-right"
                    class="mr-2 h-4 w-4 scale-x-[-1]"
                    aria-hidden="true"
                  />
                  Sort Descending
                </button>
              </MenuItem>
            </MenuItems>
          </transition>
        </Menu>
      </header>

      <template v-if="tableData?.pages.length">
        <template v-for="tableRows in tableData.pages">
          <main
            role="button"
            @click="() => onRowClick(rowData.id || rowData.ogc_fid)"
            class="flex w-full group"
            v-for="rowData in tableRows"
            :key="rowData.id || rowData.ogc_fid"
          >
            <div
              :class="
                'h-[4.5rem] w-14 flex items-center justify-center group-hover:bg-brand-100 ' +
                (highlightedIds.includes(rowData.id || rowData.ogc_fid)
                  ? 'bg-brand-100 '
                  : ' ')
              "
            >
              <CoreCheckbox
                :id="`checkbox-${rowData.id || rowData.ogc_fid}`"
                :index="rowData.id || rowData.ogc_fid"
                :is-checked="
                  selectedIds.includes(rowData.id || rowData.ogc_fid)
                "
                :forHeader="true"
                @click="
                  (event: Event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onRowSelect(rowData.id || rowData.ogc_fid);
                    // console.log(rowData);
                    selectedGeom = rowData;
                  }
                "
              />
            </div>
            <div
              v-for="column in columns.filter(
                (c) => !hiddenFields.includes(c.key),
              )"
              :key="column.key"
              :class="
                'first-letter:h-[4.5rem] flex-1 min-w-[12rem] flex items-center text-xs font-normal px-3 py-4 group-hover:bg-brand-100 ' +
                (highlightedIds.includes(rowData.id || rowData.ogc_fid)
                  ? 'text-brand-500 '
                  : 'text-grey-700 ') +
                (highlightedIds.includes(rowData.id || rowData.ogc_fid)
                  ? 'bg-brand-100 '
                  : ' ')
              "
            >
              <p class="line-clamp-2">
                {{ getFieldValue(rowData, column.key) }}
              </p>
            </div>
          </main>
        </template>
      </template>
    </section>

    <!-- <template v-if="floatVisibility >= 0">
      <UButton
        v-if="hasNextPage"
        :loading="isCountFetching || isHeaderFetching || isTableFetching"
        @click="() => fetchNextPage()"
        class="absolute bottom-8 right-8 w-1/4 px-3 min-w-fit h-9 rounded-xxs flex justify-center items-center"
        :label="
          isCountFetching || isHeaderFetching || isTableFetching
            ? 'Loading'
            : 'Load More'
        "
        :style="{ opacity: floatVisibility }"
      >
      </UButton
      ><span
        v-else
        class="absolute rounded-xxs border border-grey-600 bottom-8 right-8 w-1/4 px-3 min-w-fit bg-white h-9 text-grey-900 flex justify-center items-center text-xs"
        :style="{ opacity: floatVisibility }"
        >End of Data</span
      ></template
    > -->

    <div v-if="hasNextPage">
      <div ref="loadingRef" class="flex justify-end items-center w-full">
        <div v-if="isLoading" class="flex items-center gap-2">
          <USpinner />
          <span class="text-sm text-grey-400">Loading More Data...</span>
        </div>
      </div>
    </div>
    <div v-else>
      <div class="flex justify-end items-center text-sm text-grey-800">
        End of Data
      </div>
    </div>

    <span
      class="absolute rounded-xxs border border-grey-600 bottom-8 left-8 w-1/4 px-3 min-w-fit bg-white h-9 text-grey-900 flex justify-center items-center text-xs"
    >
      {{ selectedCount }} {{ (isAllChecked ? "un" : "") + "selected" }} from
      {{ countData }} rows</span
    >
  </div>
</template>
