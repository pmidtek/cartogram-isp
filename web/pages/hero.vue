<script lang="ts" setup>
definePageMeta({
  layout: false,
});
import { useQuery, useQueryClient } from "@tanstack/vue-query";

const authStore = useAuth();
const featureStore = useFeature();
const queryClient = useQueryClient();
const { isSignedIn, dataUser } = storeToRefs(authStore);
const { filterLocation } = storeToRefs(featureStore);

// Business planning features
const businessPlanningFeatures = [
  // {
  //   module: "market-potential",
  //   title: "Market Potential Analysis",
  //   description: "Identify high-value market opportunities",
  //   iconColor: "blue",
  //   iconBg: "bg-blue-100",
  //   iconClass: "text-blue-600",
  //   icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />`,
  // },
  // {
  //   module: "fwa-access",
  //   title: "Fixed Wireless Access (FWA)",
  //   description: "Assess FWA coverage and feasibility",
  //   iconColor: "purple",
  //   iconBg: "bg-purple-100",
  //   iconClass: "text-purple-600",
  //   icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8.111 16.404a5.5 5.5 0 017.778 0M12 20h.01m-7.08-7.071c3.904-3.905 10.236-3.905 14.141 0M1.394 9.393c5.857-5.857 15.355-5.857 21.213 0" />`,
  // },
  {
    module: "backhaul",
    title: "Asset Management",
    description: "Optimize routes and manage optical budgets",
    iconColor: "green",
    iconBg: "bg-green-100",
    iconClass: "text-green-600",
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />`,
  },
];

// Filter features based on user's modules
const filteredBusinessPlanningFeatures = computed(() => {
  // return businessPlanningFeatures.filter((feature) =>
  //   authStore.hasModule(feature.module),
  // );
  return businessPlanningFeatures;
});

// Check if user has access to business planning modules
const hasBusinessPlanningAccess = computed(() => {
  return filteredBusinessPlanningFeatures.value.length > 0;
});

// Business operation features
const businessOperationFeatures = [
  {
    module: "ftth-mapping",
    title: "FTTH Mapping",
    description: "Visualize fiber network infrastructure",
    iconColor: "cyan",
    iconBg: "bg-cyan-100",
    iconClass: "text-cyan-600",
    icon: `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />`,
  },
];

// Filter features based on user's modules
const filteredBusinessOperationFeatures = computed(() => {
  // return businessOperationFeatures.filter((feature) =>
  //   authStore.hasModule(feature.module),
  // );
  return businessOperationFeatures;
});

// Check if user has access to business operation modules
const hasBusinessOperationAccess = computed(() => {
  return filteredBusinessOperationFeatures.value.length > 0;
});

// Check if user has FTTH module for business operation
const hasFtthModule = computed(() => {
  return authStore.hasModule("ftth-mapping");
});

const { data: dataUserLocation, refetch: refetchUserData } = useQuery({
  queryKey: ["data-user-location"],
  queryFn: async () => {
    const res = await $fetch<any>("/panel/playgrounds", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    const formatData = {
      provience:
        res.data.provinces?.map((i: any) => {
          return {
            province_id: i.key,
            province: i.value,
          };
        }) || [],
      cities:
        res.data.cities?.map((i: any) => {
          return {
            city_id: i.key,
            city: i.value,
          };
        }) || [],
    };
    filterLocation.value = {
      province: formatData?.provience,
      cities: formatData?.cities,
    };
    return res.data;
  },
  enabled: true, // Enable the query to run automatically
});

function navigateToLink(value: string) {
  navigateTo(value);
}

onMounted(async () => {
  console.log("onMounted - hero page");
  filterLocation.value = null;
  await refetchUserData();
});
</script>

<template>
  <div class="h-full w-full bg-white relative">
    <div class="relative z-10 min-h-screen bg-white">
      <!-- Main Container -->
      <div class="mx-auto p-10 h-screen">
        <!-- Blue rounded container for header and hero -->
        <div
          class="bg-[url(/assets/images/business-planning-0.png)] bg-cover bg-center rounded-lg p-14 mb-8 shadow-xl h-full"
        >
          <!-- Header -->
          <div class="flex items-center justify-between mb-12">
            <h1 class="text-xl font-bold text-white font-raleway">Dashboard</h1>
            <button
              @click="authStore.signout()"
              class="px-10 py-2.5 text-sm font-medium text-brand-500 bg-white hover:bg-gray-50 rounded-sm transition-all shadow-md"
            >
              Log Out
            </button>
          </div>

          <!-- Hero Section -->
          <div class="mb-8">
            <h2 class="text-5xl font-bold text-white mb-6 font-raleway">
              Hello, {{ `${dataUser?.first_name} ${dataUser?.last_name}` }}!
            </h2>
            <p
              class="text-lg text-white/90 max-w-4xl leading-relaxed font-raleway"
            >
              Welcome to Dashboard — Geospatial Intelligence for Network
              Planning. Harness the power of geospatial intelligence to identify
              new market opportunities, evaluate demand potential, and design
              efficient, data-driven fiber network routes.
            </p>
          </div>
          <!-- Feature Cards -->
          <div class="grid md:grid-cols-2 gap-6 h-[calc(100vh-28rem)]">
            <!-- Business Planning Card -->
            <div
              v-if="hasBusinessPlanningAccess"
              @click="navigateToLink('/landing/business-planning')"
              class="bg-white rounded-xl shadow-lg overflow-hidden cursor-pointer transition-all duration-300 hover:-translate-y-2 hover:shadow-2xl"
            >
              <div class="p-8 h-full flex flex-col justify-between">
                <div>
                  <!-- Icon and Title Section -->
                  <div class="flex items-start justify-between mb-6">
                    <div class="flex items-center space-x-4">
                      <div
                        class="w-14 h-14 rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-lg"
                      >
                        <svg
                          class="w-7 h-7 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                          />
                        </svg>
                      </div>
                      <div>
                        <h2
                          class="text-2xl font-bold text-gray-900 font-raleway"
                        >
                          Business Planning
                        </h2>
                        <span
                          class="bg-gradient-to-r from-green-500 to-green-600 text-xs text-white px-2 py-1 rounded-full inline-block mt-1 font-medium"
                          >Active</span
                        >
                      </div>
                    </div>
                  </div>

                  <!-- Description -->
                  <p class="text-gray-600 mb-6 font-raleway">
                    Strategic tools for market analysis, route optimization, and
                    comprehensive budget planning.
                  </p>

                  <!-- Features List -->
                  <div class="space-y-3">
                    <div
                      v-for="feature in filteredBusinessPlanningFeatures"
                      :key="feature.module"
                      class="flex items-center space-x-3 p-3 rounded-lg hover:bg-blue-50 transition-all duration-200 hover:translate-x-2 group"
                    >
                      <div
                        :class="[
                          feature.iconBg,
                          'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                        ]"
                      >
                        <svg
                          :class="[feature.iconClass, 'w-5 h-5']"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          v-html="feature.icon"
                        ></svg>
                      </div>
                      <div class="flex-1">
                        <h3
                          class="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors"
                        >
                          {{ feature.title }}
                        </h3>
                        <p class="text-sm text-gray-500">
                          {{ feature.description }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Action Button -->
                <button
                  class="w-full mt-6 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-semibold py-3 px-6 rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all shadow-lg hover:shadow-xl"
                >
                  Explore Planning Tools
                </button>
              </div>
            </div>

            <!-- Business Operation Card -->
            <div
              v-if="!hasFtthModule"
              class="bg-white rounded-xl shadow-lg overflow-hidden relative"
            >
              <!-- Coming Soon Badge -->
              <div
                class="absolute top-4 right-4 bg-gradient-to-r from-red-500 to-red-600 text-white text-xs font-bold px-3 py-1 rounded-full shadow-lg"
              >
                COMING SOON
              </div>

              <div class="p-8 h-full flex flex-col justify-between">
                <div>
                  <!-- Icon and Title Section -->
                  <div class="flex items-start justify-between mb-6">
                    <div class="flex items-center space-x-4">
                      <div
                        class="w-14 h-14 rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 opacity-60 flex items-center justify-center shadow-lg"
                      >
                        <svg
                          class="w-7 h-7 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                          />
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                      </div>
                      <div>
                        <h2
                          class="text-2xl font-bold text-gray-900 font-raleway"
                        >
                          Business Operation
                        </h2>
                      </div>
                    </div>
                  </div>

                  <!-- Description -->
                  <p class="text-gray-600 mb-6 font-raleway">
                    Advanced operational tools for real-time network management
                    and automated workflow optimization.
                  </p>

                  <!-- Features List (disabled state) -->
                  <div class="space-y-3 opacity-50">
                    <div
                      class="flex items-center space-x-3 p-3 rounded-lg bg-gray-50"
                    >
                      <div
                        class="w-9 h-9 rounded-lg bg-gray-200 flex items-center justify-center flex-shrink-0"
                      >
                        <svg
                          class="w-5 h-5 text-gray-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4"
                          />
                        </svg>
                      </div>
                      <div class="flex-1">
                        <h3 class="font-semibold text-gray-700">
                          Integrated Data Sync
                        </h3>
                        <p class="text-sm text-gray-500">
                          Real-time network data synchronization
                        </p>
                      </div>
                    </div>

                    <div
                      class="flex items-center space-x-3 p-3 rounded-lg bg-gray-50"
                    >
                      <div
                        class="w-9 h-9 rounded-lg bg-gray-200 flex items-center justify-center flex-shrink-0"
                      >
                        <svg
                          class="w-5 h-5 text-gray-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"
                          />
                        </svg>
                      </div>
                      <div class="flex-1">
                        <h3 class="font-semibold text-gray-700">
                          Automated FTTH Mapping
                        </h3>
                        <p class="text-sm text-gray-500">
                          GIS-powered network visualization
                        </p>
                      </div>
                    </div>

                    <div
                      class="flex items-center space-x-3 p-3 rounded-lg bg-gray-50"
                    >
                      <div
                        class="w-9 h-9 rounded-lg bg-gray-200 flex items-center justify-center flex-shrink-0"
                      >
                        <svg
                          class="w-5 h-5 text-gray-500"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M13 10V3L4 14h7v7l9-11h-7z"
                          />
                        </svg>
                      </div>
                      <div class="flex-1">
                        <h3 class="font-semibold text-gray-700">
                          Network Performance
                        </h3>
                        <p class="text-sm text-gray-500">
                          Monitor and optimize operations
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Disabled Button -->
                <button
                  disabled
                  class="w-full mt-6 bg-gray-300 text-gray-500 font-semibold py-3 px-6 rounded-lg cursor-not-allowed"
                >
                  Available Soon
                </button>
              </div>
            </div>
            <div
              v-if="hasFtthModule"
              @click="
                hasFtthModule && navigateToLink('/landing/business-operation')
              "
              :class="[
                'bg-white rounded-xl shadow-lg overflow-hidden transition-all duration-300',
                hasFtthModule
                  ? 'cursor-pointer hover:-translate-y-2 hover:shadow-2xl'
                  : 'opacity-50 pointer-events-none',
              ]"
            >
              <div class="p-8 h-full flex flex-col justify-between">
                <div>
                  <!-- Icon and Title Section -->
                  <div class="flex items-start justify-between mb-6">
                    <div class="flex items-center space-x-4">
                      <div
                        class="w-14 h-14 rounded-lg bg-gradient-to-br from-blue-600 to-blue-700 flex items-center justify-center shadow-lg"
                      >
                        <svg
                          class="w-7 h-7 text-white"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                          />
                          <path
                            stroke-linecap="round"
                            stroke-linejoin="round"
                            stroke-width="2"
                            d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                          />
                        </svg>
                      </div>
                      <div>
                        <h2
                          class="text-2xl font-bold text-gray-900 font-raleway"
                        >
                          Business Operation
                        </h2>
                        <span
                          v-if="hasFtthModule"
                          class="bg-gradient-to-r from-green-500 to-green-600 text-xs text-white px-2 py-1 rounded-full inline-block mt-1 font-medium"
                          >Active</span
                        >
                        <span
                          v-else
                          class="bg-gray-400 text-xs text-white px-2 py-1 rounded-full inline-block mt-1 font-medium"
                          >Coming Soon</span
                        >
                      </div>
                    </div>
                  </div>

                  <!-- Description -->
                  <p class="text-gray-600 mb-6 font-raleway">
                    Advanced operational tools for real-time network management
                    and automated workflow optimization.
                  </p>

                  <!-- Features List -->
                  <div class="space-y-3">
                    <div
                      v-for="feature in filteredBusinessOperationFeatures"
                      :key="feature.module"
                      :class="[
                        'flex items-center space-x-3 p-3 rounded-lg transition-all duration-200',
                        hasFtthModule
                          ? 'hover:bg-blue-50 hover:translate-x-2 group'
                          : 'pointer-events-none',
                      ]"
                    >
                      <div
                        :class="[
                          feature.iconBg,
                          'w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0',
                        ]"
                      >
                        <svg
                          :class="[feature.iconClass, 'w-5 h-5']"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                          v-html="feature.icon"
                        ></svg>
                      </div>
                      <div class="flex-1">
                        <h3
                          class="font-semibold text-gray-900 group-hover:text-blue-600 transition-colors"
                        >
                          {{ feature.title }}
                        </h3>
                        <p class="text-sm text-gray-500">
                          {{ feature.description }}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Action Button -->
                <button
                  :disabled="!hasFtthModule"
                  :class="[
                    'w-full mt-6 font-semibold py-3 px-6 rounded-lg transition-all',
                    hasFtthModule
                      ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-700 hover:to-blue-800 shadow-lg hover:shadow-xl'
                      : 'bg-gray-300 text-gray-500 cursor-not-allowed',
                  ]"
                >
                  {{
                    hasFtthModule
                      ? "Explore Operation Tools"
                      : "Module Not Available"
                  }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
