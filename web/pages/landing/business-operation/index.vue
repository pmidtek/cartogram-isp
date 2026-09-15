<script lang="ts" setup>
import IcArrow from "~/assets/icons/ic-arrow-reg.svg";
import { useMapModule } from "~/stores/useMapModule";

definePageMeta({
  layout: false,
});

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
    slug: "ftth-mapping",
    label: "FTTH Mapping",
    description:
      "Visualize and manage Fiber-to-the-Home network infrastructure and coverage.",
    isModule: true,
    route: "/map/ftth-mapping",
  },
];

// Filter options based on user's modules
const landingOptions = computed(() => {
  // return allLandingOptions.filter((option) => authStore.hasModule(option.slug));
  return allLandingOptions;
});

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
  const icons: Record<string, string> = {
    "ftth-mapping": `<svg class="w-8 h-8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 2L2 7l10 5 10-5-10-5z"></path>
      <path d="M2 17l10 5 10-5"></path>
      <path d="M2 12l10 5 10-5"></path>
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
        'bg-[url(/assets/images/business-operation-1.png)]':
          optionsPick === 'ftth-mapping',
        'bg-[url(/assets/images/business-operation-0.png)]':
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
            Business Operation
          </h1>
          <p
            class="text-white font-medium text-[20px] font-raleway leading-normal"
          >
            Manage and visualize fiber network infrastructure for efficient
            operations.
          </p>
        </div>
        <div
          v-if="optionsPick === 'ftth-mapping'"
          class="flex flex-col justify-end space-y-4 py-10"
        >
          <h1
            class="text-6xl lead font-medium text-white font-raleway leading-tight"
          >
            FTTH Mapping
          </h1>
          <p
            class="text-white font-medium text-[20px] font-raleway leading-normal"
          >
            Visualize and manage Fiber-to-the-Home network infrastructure and
            coverage.
          </p>
        </div>
      </div>
    </div>
    <div class="w-[50%] p-8 px-6 py-10 flex flex-col justify-between">
      <div>
        <h1 class="text-[56px] font-medium font-raleway leading-[64px]">
          Business Operation
        </h1>
        <p class="text-[18px] text-grey-500 mt-2 font-raleway">
          Manage and visualize fiber network infrastructure for efficient
          operations.
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
      </div>
    </div>
  </div>
</template>
