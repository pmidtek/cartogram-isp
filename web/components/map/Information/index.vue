<script setup lang="ts">
import { toRaw } from "vue";
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";
import { useChartScore } from "~/utils";
import {
  Chart as ChartJS,
  Title,
  Tooltip,
  Legend,
  CategoryScale,
  LinearScale,
  ArcElement,
  BarElement,
} from "chart.js";
import { Doughnut, Bar } from "vue-chartjs";
import ChartDataLabels from "chartjs-plugin-datalabels";

ChartJS.register(
  CategoryScale,
  LinearScale,
  ArcElement,
  BarElement,
  Title,
  Tooltip,
  Legend
);

ChartJS.register(ChartDataLabels);

interface ChartData {
  class_ts: string;
  count: number;
}

interface CityData {
  name: string;
  province: string;
  bounds: any;
}

interface Coordinates {
  coordinates: number[][];
  type: string;
}

const mapStore = useMapRef();

const { map, setSelectedCity } = mapStore;
const mapLayerStore = useMapLayer();

const authStore = useAuth();
const featureStore = useFeature();
const nmkab = ref<string>("");
const nmprov = ref<string>("");
const detailData = ref<string>("House Class");
const newChartData = ref<any>("");
const newDataChartPending = ref<any>("");

const { isLoading: chartLoading, data: chartData } = await useChartScore();

const { pending: optionsProvLoading, data: optionsDataProv } = await useFetch<{
  data: CityData[];
}>("/panel/items/cities?fields=province", {
  key: "provinces",
  headers: {
    Authorization: "Bearer " + authStore.accessToken,
  },
  transform: (response) => {
    return {
      data: response.data.sort((a, b) => a.province.localeCompare(b.province)),
    };
  },
});

const optionsProv = computed(() => [
  ...new Set(optionsDataProv.value?.data.map((el) => el.province) ?? []),
]);

const { pending: optionsLoading, data: optionsData } = await useFetch<{
  data: CityData[];
}>(
  () => {
    if (!nmprov.value) return "/panel/items/cities?fields=name,province,bounds";
    return `/panel/items/cities?filter={"province":{"_eq":"${nmprov.value}"}}&fields=name,province,bounds`;
  },
  {
    key: "cities",
    headers: {
      Authorization: "Bearer " + authStore.accessToken,
    },
    watch: [nmprov],
  }
);

const options = computed(
  () => optionsData.value?.data.map((el) => el.name) ?? []
);

const optionsDataDetail = [
  "Energy",
  "Carport",
  "House Class",
  // "Footprint Grade",
  "House Price",
  "Road Type",
];

const { pending, data: filteredData } = await useFetch<ChartData[]>(
  "/panel/chart/count/kab/house_class",
  {
    key: "map",
    method: "POST",
    headers: {
      Authorization: "Bearer " + authStore.accessToken,
    },
    body: { nmkab: nmkab },
    watch: [nmkab],
  }
);

const detailDataEndpoint = computed(() => {
  if (!detailData.value) return "";
  const endpoint = detailData.value.toLowerCase().replace(/\s+/g, "_");
  return `/panel/chart/count/kab/${endpoint}`;
});

watch([detailData, nmkab], async () => {
  const endpoint = detailDataEndpoint.value;

  if (!endpoint) {
    console.warn("Detail data endpoint is empty, skipping fetch.");
    return;
  }

  const { pending, data, error } = await useFetch(endpoint, {
    key: "info",
    method: "POST",
    headers: {
      Authorization: "Bearer " + authStore.accessToken,
    },
    body: nmkab.value ? { nmkab: nmkab.value } : {},
  });

  newDataChartPending.value = pending.value;

  if (error.value) {
    console.error("Error fetching data:", error.value);
  } else {
    newChartData.value = Array.isArray(data.value) ? data.value : [];
  }
});

const labels = computed(
  () =>
    chartData.value
      ?.filter((el) => el.class_ts !== null && el.class_ts !== undefined)
      .map((el) => el.class_ts) ?? []
);

const data = computed(
  () =>
    chartData.value
      ?.filter((el) => el.count !== null && el.count !== undefined)
      .map((el) => el.count) ?? []
);

const filteredLabels = computed(
  () =>
    (newChartData.value.length ? newChartData.value : filteredData.value)?.map(
      (el: any) => el.class_ts
    ) ?? []
);

const filteredChartData = computed(
  () =>
    (newChartData.value.length ? newChartData.value : filteredData.value)?.map(
      (el: any) => el.count
    ) ?? []
);

const handleClear = () => {
  nmkab.value = "";
  nmprov.value = "";
  detailData.value = "";
  newChartData.value = "";
};

const closeMapInfo = () => {
  featureStore.setMapInfo("");
};

watch(nmprov, () => {
  nmkab.value = "";
});

watch(nmkab, () => {
  const data = optionsData.value;

  if (nmkab.value && data) {
    const selectedCity = data.data.find((city) => city.name === nmkab.value);

    if (selectedCity && selectedCity.bounds) {
      const bounds = selectedCity.bounds.coordinates[0];

      const center: [number, number] = [
        (bounds[0][0] + bounds[2][0]) / 2,
        (bounds[0][1] + bounds[2][1]) / 2,
      ];

      map?.flyTo({
        center,
        zoom: 14,
        speed: 2,
        curve: 1,
        easing: (t: number) => t,
      });

      mapStore.setSelectedCity(selectedCity.name);
      mapStore.setSelectedProvince(selectedCity.province);
    } else {
      console.log("City not found or bounds not available");
    }
  }
});

const formatNumber = (value: number) => {
  return new Intl.NumberFormat().format(value);
};

const capitalizeWords = (str: string) => {
  return str
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
};

const formatDistrict = (str: string) => {
  return str.replace(/_/g, " ");
};

const dynamicTitle = computed(() => {
  const formattedProv = nmprov.value ? capitalizeWords(nmprov.value) : "";
  const formattedKab = nmkab.value ? formatDistrict(nmkab.value) : "";

  if (detailData.value) {
    return `${formattedKab || formattedProv || "Indonesia"} ${
      detailData.value
    }`;
  } else if (formattedKab) {
    return `${formattedKab} Class Score`;
  } else if (formattedProv) {
    return `${formattedProv} Class Score`;
  } else {
    return "Indonesia Class Score";
  }
});

const totalCount = computed(() => {
  const data = newChartData.value.length
    ? newChartData.value
    : filteredData.value ?? [];
  return data.reduce((sum, item) => {
    const count = Number(item.count);
    return sum + (isNaN(count) ? 0 : count);
  }, 0);
});
</script>

<template>
  <div class="flex justify-between items-center m-3">
    <h2 class="text-white">Infospace</h2>
    <IcArrowLeft
      role="button"
      @click="closeMapInfo"
      :fontControlled="false"
      class="w-3 h-3 rotate-180 text-grey-50"
    />
  </div>
  <hr class="mx-3" />
  <div class="flex-1 overflow-y-auto px-3 my-3">
    <div v-if="!chartData" class="animate-pulse space-y-3">
      <div class="w-full h-8 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-8 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-44 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-6 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-6 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-6 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-6 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-6 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-6 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-12 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-12 bg-grey-700 rounded-xs"></div>
    </div>
    <template v-else>
      <div class="text-white">
        <h3>{{ dynamicTitle }}</h3>
        <div class="mt-4 h-[255px]">
          <Doughnut
            :data="{
              labels,
              datasets: [
                {
                  data,
                  backgroundColor: ['#FFC981', '#1F8C41', '#C5E687', '#D51A1D'],
                  borderColor: ['#000', '#000', '#000', '#000'],
                  hoverOffset: 4,
                },
              ],
            }"
            :options="{
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  display: false,
                },
                tooltip: {
                  callbacks: {
                    label: function (tooltipItem) {
                      const dataset = tooltipItem.dataset;
                 
                      const currentValue = Number(
                        dataset.data[tooltipItem.dataIndex]
                      );
                      const total = dataset.data.reduce(
                        (acc, val) => acc + Number(val),
                        0
                      );
                      const percentage = ((currentValue / total) * 100).toFixed(
                        2
                      ); 
                      return `${tooltipItem.label}: ${currentValue} (${percentage}%)`; 
                    },
                  },
                },
                datalabels: {
                  formatter: (value: number, context: any) => {
          const dataset = context.chart.data.datasets[0].data as number[];
          const total = dataset.reduce((acc, val) => acc + Number(val), 0);
          const percentage = ((value / total) * 100).toFixed(2);
          return `${percentage}%`; 
        }, color: '#fff',  // Text color
          backgroundColor: '#000',  // Box color
          borderRadius: 4,
          padding: {
            top: 6,
            bottom: 6,
            left: 8,
            right: 8,
          },
          anchor: 'end',
          align: 'start',
          offset: 10,  
          font: {
            size: 10,
          },
                },
              },
            }"
          />
        </div>

        <div class="mt-4">
          <p class="text-sm mb-2">Detail Data</p>
          <USelect
            placeholder="Select Data"
            v-model="detailData"
            :options="optionsDataDetail"
            option-attribute="detailData"
            color="gray"
            :ui="{ rounded: 'rounded-xxs' }"
            size="2xs"
          />
          <div class="flex items-center justify-between gap-3 mt-2">
            <USelect
              placeholder="Select Province"
              v-model="nmprov"
              :options="optionsProv"
              option-attribute="nmprov"
              color="gray"
              :ui="{ rounded: 'rounded-xxs' }"
              size="2xs"
            />
            <USelect
              placeholder="Select District"
              v-model="nmkab"
              :options="options"
              option-attribute="nmkab"
              color="gray"
              :ui="{ rounded: 'rounded-xxs' }"
              size="2xs"
              :disabled="!nmprov"
            />
          </div>
          <template v-if="nmkab !== null">
            <div class="mt-4 h-[152px]">
              <Bar
                class="h-[152px]"
                :data="{
                  labels: filteredLabels,
                  datasets: [
                    {
                      label: 'Jumlah Residen',
                      data: filteredChartData,
                      borderRadius: 12,
                      backgroundColor: [
                        '#FFC981',
                        '#1F8C41',
                        '#C5E687',
                        '#D51A1D',
                      ],
                      // borderColor: '#F36A1D',
                      borderWidth: 1,
                      barThickness: 14,
                    },
                  ],
                }"
                :options="{
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
                }"
              />
            </div>
            <div class="mt-4">
              <p class="text-white text-xs">Data Tables</p>
              <div class="divide-y divide-grey-600/30 text-xs mt-3">
                <div class="grid grid-cols-2 py-1">
                  <p>Class</p>
                  <p>{{ detailData || "Jumlah Residen" }}</p>
                </div>
                <!-- Render newChartData if it's available -->
                <div v-if="newChartData && newChartData.length">
                  <div
                    v-for="item in newChartData"
                    :key="item.class_ts"
                    class="grid grid-cols-2 py-1"
                  >
                    <p>{{ item.class_ts }}</p>
                    <p>{{ formatNumber(item.count) }}</p>
                  </div>
                  <div class="grid grid-cols-2 py-1 font-semibold mt-2">
                    <p>Total</p>
                    <p>{{ formatNumber(totalCount) }}</p>
                  </div>
                </div>

                <!-- Render filteredData only if newChartData is not available -->
                <div v-else>
                  <div
                    v-for="item in filteredData"
                    :key="item.class_ts"
                    class="grid grid-cols-2 py-1"
                  >
                    <p>{{ item.class_ts }}</p>
                    <p>{{ formatNumber(item.count) }}</p>
                  </div>
                  <!-- Total Count Section -->
                  <div class="grid grid-cols-2 py-1 font-semibold mt-2">
                    <p>Total</p>
                    <p>{{ formatNumber(totalCount) }}</p>
                  </div>
                </div>
              </div>
            </div>
            <UButton
              block
              variant="outline"
              @click="handleClear"
              size="sm"
              type="button"
              label="Clear Layer Selection"
              class="mt-4"
              :ui="{ rounded: 'rounded-xxs' }"
            />
          </template>
        </div>
      </div>
    </template>
  </div>
</template>
