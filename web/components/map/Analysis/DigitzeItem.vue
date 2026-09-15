<script lang="ts" setup>
import { ref, computed } from "vue";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";
import IcTrash from "~/assets/icons/ic-trash.svg";

import { TransitionRoot } from "@headlessui/vue";
import type { DigitizeResult } from "~/utils/types";
import { useQuery, useInfiniteQuery } from "@tanstack/vue-query";

import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  BarElement,
} from "chart.js";

import { Bar } from "vue-chartjs";

// @ts-ignore
import tokml from "tokml";

ChartJS.register(
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
);

const props = defineProps<{
  digtizeResult: DigitizeResult;
}>();

const isExpand = ref(false);
const digitizeStore = useDigitizeStore();
const toast = useToast();
const authStore = useAuth();
const mapStore = useMapRef();
const { map } = mapStore;
const isModalOpenDownload = ref(false);

const {
  data: meData,
  error: meError,
  isFetching: isMeFetching,
  isError: isMeError,
} = useQuery({
  queryKey: ["panel/users/me"],
  queryFn: ({ queryKey }) =>
    $fetch<{ is_can_download: boolean }>(`/panel/users/me`, {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    }),
});

function closeModal() {
  isModalOpenDownload.value = false;
}

const handleDelete = (id: number) => {
  digitizeStore.removeDigitizedData(id);

  if (props.digtizeResult.layerId) {
    map?.removeLayer(props.digtizeResult.layerId);
    map?.removeLayer(`${props.digtizeResult.layerId}-stroke`);
  }
  toast.add({
    title: "Analysis Result Deleted",
    description: `Analysis result layer has been successfully removed.`,
    icon: "i-heroicons-check-circle",
    ui: {
      background: "bg-white",
      title: "text-gray-900 text-md font-semibold",
      description: "text-gray-500",
      icon: "text-blue-500",
    },
  });
};

const isSelectLayer = computed(() => props.digtizeResult.layerId === "select");

const categories = computed(() => {
  if (isSelectLayer.value) {
    return ["Area Statistics"];
  }
  return Object.keys(props.digtizeResult.data);
});

const selectLayerData = computed(() => {
  if (!isSelectLayer.value) return null;

  return props.digtizeResult.data.map((item: any) => ({
    category: item.category,
    count: item.count,
  }));
});

const chartData = computed(() => {
  if (isSelectLayer.value) return [];

  return categories.value.map((category) => {
    const categoryData =
      props.digtizeResult.data[category] ||
      props.digtizeResult.data.category ||
      [];

    return {
      category,
      data: {
        labels: categoryData.map((item: any) => item.class_ts || "N/A"),
        datasets: [
          {
            label: "Count",
            data: categoryData.map((item: any) => parseInt(item.count || "0")),
            borderRadius: 12,
            backgroundColor: ["#FFC981", "#1F8C41", "#C5E687", "#D51A1D"],
            borderColor: "#F36A1D",
            borderWidth: 1,
            barThickness: 14,
          },
        ],
      },
    };
  });
});

// Rest of the existing functions remain the same
const chartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: {
      display: false,
    },
    datalabels: {
      display: false,
    },
  },
  scales: {
    x: {
      ticks: {
        font: {
          size: 10,
        },
      },
    },
    y: {
      beginAtZero: true,
    },
  },
};

// Keep all other existing functions...
const handleDownloadGeojson = () => {
  if (meData?.value?.data?.is_can_download) {
    const coordinates = props.digtizeResult.coordinates;
    console.log("PROPS", props.digtizeResult);
    let type = "";
    if (props.digtizeResult.name) {
      type = "MultiPolygon";
    }

    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: type,
            coordinates:
              props.digtizeResult.name === "Buffer"
                ? [props.digtizeResult.coordinates]
                : props.digtizeResult.coordinates,
          },
          properties: buildProperties(),
        },
      ],
    };

    const blob = new Blob([JSON.stringify(geojson)], {
      type: "application/geo+json",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${props.digtizeResult.name || "digitized-area"}.geojson`;
    link.click();
    URL.revokeObjectURL(url);
  } else {
    isModalOpenDownload.value = true;
  }
};

const handleDownloadKML = () => {
  console.log(props.digtizeResult);
  if (meData?.value?.data?.is_can_download) {
    const coordinates = props.digtizeResult.coordinates;
    let type = "";

    if (props.digtizeResult.name) {
      type = "MultiPolygon";
    }

    const geojson = {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: type,
            coordinates:
              props.digtizeResult.name === "Buffer"
                ? [props.digtizeResult.coordinates]
                : props.digtizeResult.coordinates,
          },
          properties: buildProperties(),
        },
      ],
    };

    // Convert GeoJSON to KML
    const kml = tokml(geojson);

    // Create a Blob and download as .kml
    const blob = new Blob([kml], {
      type: "application/vnd.google-earth.kml+xml",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${props.digtizeResult.name || "digitized-area"}.kml`;
    link.click();
    URL.revokeObjectURL(url);
  } else {
    isModalOpenDownload.value = true;
  }
};

const handleDownloadCSV = async () => {
  if (meData?.value?.data?.is_can_download) {
    // Add loading toast
    const loadingToast = toast.add({
      title: "Downloading CSV",
      description: "Please wait while we prepare your data...",
      icon: "i-heroicons-arrow-path",
      loading: true,
      duration: Infinity,
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });

    try {
      let body;
      let url = "/panel/download/area/csv";

      if (props.digtizeResult.name === "Specific Layer") {
        body = {
          layer: props.digtizeResult.layer,
          layer_target: "sp_data_footprint",
        };
        url = "/panel/download/layer/csv";
      } else {
        const coordinates = props.digtizeResult.coordinates;

        const type =
          props.digtizeResult.name === "Digitize Combined"
            ? "MultiPolygon"
            : coordinates.length > 1
              ? "MultiPolygon"
              : "Polygon";

        body = {
          area: {
            coordinates: props.digtizeResult.coordinates,
            type: type,
          },
        };
      }

      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + authStore.accessToken,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = `${props.digtizeResult.name || "digitized-area"}.csv`;
        link.click();

        URL.revokeObjectURL(url);

        // Remove loading toast and show success
        toast.remove(loadingToast);
        toast.add({
          title: "CSV Download Complete",
          description: "The data has been downloaded successfully",
          icon: "i-heroicons-information-circle",
          ui: {
            background: "bg-white",
            title: "text-gray-900 text-md font-semibold",
            description: "text-gray-500",
            icon: "text-blue-500",
          },
        });
      } else {
        throw new Error("Failed to download CSV.");
      }
    } catch (error) {
      // Remove loading toast and show error
      toast.remove(loadingToast);
      toast.add({
        title: "Error on downloading table data",
        description: "Something When Wrong",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });
    }
  } else {
    isModalOpenDownload.value = true;
  }
};

const handleDownloadCSVSelect = async () => {
  if (meData?.value?.data?.is_can_download) {
    try {
      const body = {
        layer: props.digtizeResult.selectLayer,
        layer_target: props.digtizeResult.selectTargetLayer,
        invert: props.digtizeResult.invert,
      };

      const response = await fetch("/panel/download/layer/csv", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + authStore.accessToken,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = `${
          props.digtizeResult.name || "select-by-location"
        }.csv`;
        link.click();

        URL.revokeObjectURL(url);

        toast.add({
          title: "CSV Download Complete",
          description: "The data has been downloaded successfully",
          icon: "i-heroicons-information-circle",
        });
      } else {
        throw new Error("Failed to download CSV.");
      }
    } catch (error) {
      toast.add({
        title: "Error on downloading table data",
        description: "Something When Wrong",
      });
    }
  } else {
    isModalOpenDownload.value = true;
  }
};

const handleToggleVisibility = () => {
  if (map?.getLayer(props.digtizeResult.layerId)) {
    const visibility = map.getLayoutProperty(
      props.digtizeResult.layerId,
      "visibility",
    );
    const newVisibility = visibility === "visible" ? "none" : "visible";
    map.setLayoutProperty(
      props.digtizeResult.layerId,
      "visibility",
      newVisibility,
    );
    map.setLayoutProperty(
      `${props.digtizeResult.layerId}-stroke`,
      "visibility",
      newVisibility,
    );

    toast.add({
      title: `Layer ${newVisibility === "visible" ? "Shown" : "Hidden"}`,
      description: `The map layer has been ${
        newVisibility === "visible" ? "shown" : "hidden"
      }.`,
      icon: "i-heroicons-information-circle",
    });
  }
};

const handleFlyToLayer = () => {
  if (props.digtizeResult.coordinates && map) {
    const coordinates = props.digtizeResult.coordinates.flat(2);
    map?.flyTo({
      center: [coordinates[0], coordinates[1]],
      zoom: 17,
      speed: 1.2,
    });
    toast.add({
      title: "Zoomed to Layer",
      description: "The map has zoomed to the layer's extent.",
      icon: "i-heroicons-location-marker",
    });
  }
};

const formatNumber = (value: number) => {
  return new Intl.NumberFormat().format(value);
};

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

    alert(`Error: ${error?.message}`);
  }
};

const formatDigitizeResultCategory = (category: string) => {
  if (["A", "B", "C", "C1"].includes(category)) {
    switch (category) {
      case "A":
        return "A" + " " + "High";
      case "B":
        return "B" + " " + "Medium";
      case "C":
        return "C" + " " + "Low";
      case "C1":
        return "C1" + " " + "Very Low";

      default:
        return category;
    }
  } else {
    return category;
  }
};

const buildProperties = () => {
  let dataProperty = {};
  for (const [key, value] of Object.entries(props.digtizeResult.data)) {
    value.map((data: any) => {
      dataProperty[formatDigitizeResultCategory(data.class_ts)] = data.count;
    });
  }
  return {
    ...dataProperty,
    name: props.digtizeResult.name,
    area: props.digtizeResult.area,
    layer: props.digtizeResult.layer,
    total: calculateTotal(),
  };
};

const calculateTotal = () => {
  let total = 0;
  categories.value.forEach((category) => {
    total += props.digtizeResult.data[category].reduce(
      (sum: any, item: any) =>
        sum +
        (typeof item.count === "string" ? parseInt(item.count) : item.count),
      0,
    );
  });
  return total;
};
</script>

<template>
  <div>
    <div
      :class="[
        isExpand
          ? 'bg-brand-50 rounded-t-xxs border-[1px] border-brand-500'
          : 'bg-transparent hover:ring-1 hover:ring-grey-500 rounded-xxs',
        'cursor-pointer text-xs',
        'p-2 flex justify-between items-center gap-2 w-full',
      ]"
    >
      <div class="w-8/12">
        <p :class="['text-grey-800 truncate']">
          {{ digtizeResult.name }} Analysis Result
        </p>
        <p :class="['text-grey-600 truncate mt-1']">
          {{
            digtizeResult.name === "Specific Layer" ||
            digtizeResult.name === "House Class" ||
            digtizeResult.layerId === "select"
              ? digtizeResult.area + " Layer"
              : digtizeResult.area + " m²"
          }}
        </p>
      </div>
      <div class="flex gap-3 items-center justify-end w-4/12">
        <button
          v-if="
            props.digtizeResult.layerId !== 'select'
            // && props.digtizeResult.name !== 'Specific Layer'
          "
        >
          <SvgoIcDownload
            @click="handleDownloadKML"
            :class="['text-brand-500 w-3 h-3']"
            :fontControlled="false"
          />
        </button>
        <button
          @click="
            props.digtizeResult.layerId === 'select'
              ? handleDownloadCSVSelect()
              : handleDownloadCSV()
          "
        >
          <p class="text-brand-500 font-mono text-2xs">CSV</p>
        </button>
        <button @click="handleDelete(digtizeResult.id)">
          <IcTrash
            :class="['text-brand-500 w-3 h-3']"
            :fontControlled="false"
          />
        </button>
        <button @click="isExpand = !isExpand" class="text-grey-400">
          <IcArrowReg
            :class="`w-3 h-3 ${isExpand ? '' : 'rotate-180'}`"
            :fontControlled="false"
          />
        </button>
      </div>
    </div>
    <transition name="fade">
      <div
        v-if="isModalOpenDownload"
        class="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-[1000]"
      >
        <div
          class="bg-[#232221] text-white rounded-xs shadow-lg p-6 w-full max-w-2xl"
        >
          <div class="flex items-start justify-between">
            <h2 class="text-lg font-bold text-white font-raleway">Dashboard</h2>
            <button @click="closeModal" class="text-white">&times;</button>
          </div>
          <div class="mt-6">
            <h3 class="text-xl text-white font-medium">You need access</h3>
            <p class="text-grey-400 text-sm">
              Request access, or switch account that have an access
            </p>
            <UButton @click="requestDownloadLogs" class="rounded-xxs mt-24">
              Request Access
            </UButton>
          </div>
        </div>
      </div>
    </transition>
    <TransitionRoot
      :show="isExpand"
      enter="transition duration-500 ease-in-out"
      enterFrom="transform max-h-0 opacity-0"
      enterTo="transform max-h-full opacity-100"
      leave="transition duration-500 ease-in-out"
      leaveFrom="transform max-h-full opacity-100"
      leaveTo="transform max-h-0 opacity-0"
      class="transition-all duration-500 ease-in-out text-grey-400 text-xs"
    >
      <div class="border border-t-0 border-grey-700 p-2 rounded-b-xxs">
        <h5 class="text-grey-800">Area</h5>
        <div
          class="text-grey-800 font-medium p-2 border border-grey-500 rounded-xxs bg-white mt-1 flex justify-between items-center"
        >
          <div>
            <p>{{ digtizeResult.area }}</p>
            <p class="text-2xs">
              {{
                digtizeResult.name === "House Class" ? digtizeResult.layer : ""
              }}
            </p>
          </div>
          <div class="flex items-center gap-4" v-if="digtizeResult.layerId">
            <button @click="handleToggleVisibility">
              <SvgoIcEye />
            </button>
            <button @click="handleFlyToLayer">
              <SvgoIcDrawSquare />
            </button>
          </div>

          <p v-if="!digtizeResult.layerId" class="text-2xs text-grey-600">
            {{ digtizeResult.name !== "House Class" ? "m²" : "" }}
          </p>
        </div>

        <!-- Special case for select layer -->
        <div
          v-if="isSelectLayer"
          class="p-2 border border-t-0 border-grey-700 rounded-xxs mt-2"
        >
          <p>Area Statistics</p>
          <div class="mt-2">
            <p
              v-for="item in selectLayerData"
              :key="item.category"
              class="flex justify-between text-2xs mt-1 items-center gap-6"
            >
              <span class="text-grey-300">{{ item.category }}</span>
              <span class="w-full h-[1px] bg-grey-700" />
              <span class="text-grey-400">{{ formatNumber(item.count) }}</span>
            </p>
            <div
              class="flex justify-between items-center gap-6 text-2xs mt-2 pt-2 border-t border-grey-700"
            >
              <span class="text-grey-300 font-bold">Total</span>
              <span class="w-full h-[1px] bg-grey-700" />
              <span class="text-grey-400 font-bold">
                {{
                  selectLayerData?.reduce(
                    (sum: any, item: any) => sum + parseInt(item.count),
                    0,
                  )
                }}
              </span>
            </div>
          </div>
        </div>

        <!-- Original display for other layers -->
        <template v-else>
          <div
            v-for="(category, index) in categories"
            :key="index"
            class="p-2 border border-grey-700 rounded-xxs mt-2"
          >
            <p class="text-grey-800">{{ category }} in Digitize Area</p>
            <div class="mt-2">
              <div class="mt-4 h-[152px]">
                <Bar
                  v-if="chartData[index]"
                  :data="chartData[index].data"
                  :options="chartOptions"
                  class="h-[152px]"
                />
              </div>
              <p
                v-for="item in digtizeResult.data[category]"
                :key="item.class_ts"
                class="flex justify-between text-2xs mt-1 items-center gap-6"
              >
                <span class="text-grey-800 min-w-fit">{{
                  formatDigitizeResultCategory(item.class_ts) || "N/A"
                }}</span>

                <span class="w-full h-[1px] bg-grey-700" />
                <span class="text-grey-800">{{
                  formatNumber(item.count)
                }}</span>
              </p>
              <div
                class="flex justify-between items-center gap-6 text-2xs mt-2 pt-2 border-t border-grey-700"
              >
                <span class="text-grey-800 font-bold">Total</span>
                <span class="w-full h-[1px] bg-grey-700" />
                <span class="text-grey-800 font-bold">{{
                  formatNumber(
                    digtizeResult.data[category].reduce(
                      (sum: any, item: any) =>
                        sum +
                        (typeof item.count === "string"
                          ? parseInt(item.count)
                          : item.count),
                      0,
                    ),
                  )
                }}</span>
              </div>
            </div>
          </div>
        </template>
      </div>
    </TransitionRoot>
  </div>
</template>
