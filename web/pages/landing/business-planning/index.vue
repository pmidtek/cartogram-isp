<script lang="ts" setup>
import IcLocation from "~/assets/icons/ic-location-filter.svg";
import IcArrow from "~/assets/icons/ic-arrow-reg.svg";
import { useMapModule } from "~/stores/useMapModule";

definePageMeta({
  layout: false,
});

const featureStore = useFeature();
const { filterLocation } = storeToRefs(featureStore);
const optionsPick = ref<string | null>(null);

const router = useRouter();
const mapModuleStore = useMapModule();
const authStore = useAuth();

type LandingOption = {
  slug: string;
  label: string;
  description: string;
  isModule: boolean;
  route: string;
};

const allLandingOptions: LandingOption[] = [
  {
    slug: "market-potential",
    label: "Market Potential Analysis",
    description:
      "Analyze market opportunities and identify high-potential areas for network expansion.",
    isModule: true,
    route: "/map/market-potential",
  },
  {
    slug: "backhaul",
    label: "Assets Management",
    description:
      "Precision routing for resilient, effective and cost-efficient asset management.",
    isModule: true,
    route: "/map/backhaul",
  },
  {
    slug: "fwa-access",
    label: "Fixed Wireless Access",
    description:
      "Identify high-value FWA deployment zones through network and market insights.",
    isModule: true,
    route: "/map/fwa-access",
  },
];

// Filter options based on user's modules
const landingOptions = computed(() => {
  return allLandingOptions.filter((option) => authStore.hasModule(option.slug));
});

const isModalForced = ref(false);
const isModalOpen = ref(false);

// Watch untuk sync modal state
watch(
  () => filterLocation.value,
  (newFilterLocation) => {
    if (!isModalForced.value) {
      isModalOpen.value = !newFilterLocation;
    }
  },
  { immediate: true },
);

watch(isModalForced, (forced) => {
  if (forced) {
    isModalOpen.value = true;
  }
});

const closeModal = () => {
  isModalForced.value = false;
  isModalOpen.value = false;
};

const handleChangeHover = (slug: string | null) => {
  optionsPick.value = slug;
};

const handleMouseLeave = () => {
  optionsPick.value = null;
};

function goHeroPages() {
  navigateTo("/hero");
}

function goToOption(option: LandingOption) {
  if (option.isModule) {
    const module = mapModuleStore.getModule(option.slug as any);
    if (module) {
      mapModuleStore.setActiveModule(module.slug);
    }
  }
  router.push(option.route);
}

function getIcon(slug: string) {
  const icons = {
    "market-potential": `<svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M3 3v18h18"></path>
      <path d="M18 17V9"></path>
      <path d="M13 17V5"></path>
      <path d="M8 17v-3"></path>
    </svg>`,
    backhaul: `<svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2"></rect>
      <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"></path>
    </svg>`,
    "fwa-access": `<svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
      <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
      <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
      <circle cx="12" cy="20" r="1"></circle>
    </svg>`,
  };
  return icons[slug] || "";
}
</script>

<template>
  <div class="p-6 h-[100vh] gap-6 flex">
    <div
      class="w-[50%] h-full rounded-sm relative p-10 overflow-hidden col-span-2 transition-all duration-200 ease-in-out bg-cover bg-center"
      :class="{
        'bg-[url(/assets/images/business-planning-1.png)]':
          optionsPick === 'market-potential',
        'bg-[url(/assets/images/business-planning-2.png)]':
          optionsPick === 'backhaul',
        'bg-[url(/assets/images/business-planning-3.png)]':
          optionsPick === 'fwa-access',
        'bg-[url(/assets/images/business-planning-0.png)]':
          optionsPick === null,
      }"
    >
      <!-- radial blur -->
      <div
        class="absolute w-[1200px] h-[1200px] bg-white/15 -bottom-[600px] -left-[400px] rounded-full blur-2xl"
      ></div>
      <div
        class="flex flex-col justify-between h-full transition-all duration-200 ease-in-out"
      >
        <h1 class="text-xl font-bold text-white font-raleway">Dashboard</h1>
        <div
          v-if="optionsPick === null"
          class="flex flex-col justify-end space-y-4 py-10"
        >
          <h1
            class="text-7xl lead font-medium text-white font-raleway leading-tight"
          >
            Business Planning
          </h1>
          <p
            class="text-white font-medium text-[20px] font-raleway leading-normal"
          >
            Analyze market potential, optimize asset management, and assess FWA
            deployment opportunities.
          </p>
        </div>
        <div
          v-if="optionsPick === 'market-potential'"
          class="flex flex-col justify-end space-y-4 py-10"
        >
          <h1
            class="text-6xl lead font-medium text-white font-raleway leading-tight"
          >
            Market Potential Analysis
          </h1>
          <p
            class="text-white font-medium text-[20px] font-raleway leading-normal"
          >
            Analyze market opportunities and identify high-potential areas for
            network expansion.
          </p>
        </div>
        <div
          v-if="optionsPick === 'backhaul'"
          class="flex flex-col justify-end space-y-4 py-10"
        >
          <h1
            class="text-6xl lead font-medium text-white font-raleway leading-tight"
          >
            Assets Management
          </h1>
          <p
            class="text-white font-medium text-[20px] font-raleway leading-normal"
          >
            Precision routing for resilient, effective and cost-efficient asset
            management on backhaul networks.
          </p>
        </div>
        <div
          v-if="optionsPick === 'fwa-access'"
          class="flex flex-col justify-end space-y-4 py-10"
        >
          <h1
            class="text-6xl lead font-medium text-white font-raleway leading-tight"
          >
            Fixed Wireless Access
          </h1>
          <p
            class="text-white font-medium text-[20px] font-raleway leading-normal"
          >
            Identify high-value FWA deployment zones through network and market
            insights.
          </p>
        </div>
      </div>
    </div>
    <div class="w-[50%] p-8 px-6 py-10 flex flex-col justify-between">
      <div>
        <h1 class="text-[56px] font-medium font-raleway leading-[64px]">
          Business Planning
        </h1>
        <p class="text-[18px] text-grey-500 mt-2 font-raleway">
          Analyze market potential, optimize asset management, and assess FWA
          deployment opportunities.
        </p>

        <!-- Card Grid -->
        <div class="mt-10 grid grid-cols-1 gap-4">
          <div
            v-for="option in landingOptions"
            :key="option.slug"
            class="bg-white border-[1px] shadow-md rounded-sm border-grey-300 rounded-2xl p-10 cursor-pointer group hover:border-blue-400 hover:shadow-xl hover:-translate-y-1 transition-all duration-300"
            @mouseenter="handleChangeHover(option.slug)"
            @mouseleave="handleMouseLeave()"
            @click="goToOption(option)"
          >
            <div class="flex items-start gap-4">
              <!-- Icon -->
              <div
                class="w-14 h-14 rounded-xl bg-gradient-to-br from-blue-600 to-cyan-500 flex items-center justify-center text-white flex-shrink-0 shadow-lg"
              >
                <div v-html="getIcon(option.slug)"></div>
              </div>

              <!-- Content -->
              <div class="flex-1">
                <h3
                  class="text-xl font-bold text-gray-900 mb-2 group-hover:text-blue-600 transition-colors duration-300"
                >
                  {{ option.label }}
                </h3>
                <p class="text-sm text-gray-600 leading-relaxed">
                  {{ option.description }}
                </p>
              </div>

              <!-- Arrow -->
              <div
                class="opacity-0 group-hover:opacity-100 transition-opacity duration-300"
              >
                <IcArrow class="rotate-90 text-blue-600" />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="flex items-center justify-between">
        <div
          @click="goHeroPages"
          class="w-full flex items-center gap-4 cursor-pointer hover:opacity-70 transition-opacity"
        >
          <IcArrow class="-rotate-90" />
          <p>Back</p>
        </div>
        <div
          v-if="filterLocation"
          class="flex items-center gap-2 cursor-pointer hover:opacity-70 transition-opacity"
          @click="isModalForced = true"
        >
          <IcLocation />
          <p class="text-nowrap">
            <template v-if="filterLocation.province?.length > 0">
              <!-- Show province name -->
              {{ filterLocation.province[0].province }}
              <!-- Show city if available -->
              <template v-if="filterLocation.cities?.length > 0">
                , {{ filterLocation.cities[0].city }}
              </template>
              <!-- Show "see more" if multiple locations -->
              <span
                v-if="
                  filterLocation.province.length > 1 ||
                  filterLocation.cities.length > 1
                "
                class="text-nowrap text-[10px]"
              >
                ... see more
              </span>
            </template>
            <template v-else> All Locations </template>
          </p>
        </div>
      </div>
    </div>
  </div>
  <div>
    <UModal :prevent-close="true" v-model="isModalOpen">
      <LandingModalPlayground @close="closeModal" />
    </UModal>
  </div>
</template>
