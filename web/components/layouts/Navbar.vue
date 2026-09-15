<script setup lang="ts">
import IcLocation from "~/assets/icons/ic-location-filter.svg";
import { TransitionRoot } from "@headlessui/vue";
import IcHome from "~/assets/icons/ic-home.svg";
import IcLink from "~/assets/icons/ic-link.svg";
import IcMapFlat from "~/assets/icons/ic-map-flat.svg";
import IcTopnav from "~/assets/icons/ic-topnav.svg";
import IcLogin from "~/assets/icons/ic-login.svg";
import IcLogout from "~/assets/icons/ic-logout.svg";
import IcBasemap from "~/assets/icons/ic-basemap.svg";
import IcMapLayer from "~/assets/icons/ic-map-layer.svg";
import maplibregl from "maplibre-gl";
import { useMapData } from "~/utils";
import { useExpandStore } from "~/stores/useIsExpand";
import { orsApiKey } from "~/constants";

// Define types
interface AddressSuggestion {
  name: string;
  coordinates: [number, number]; // [longitude, latitude]
}

interface OpenRouteResponse {
  features: Array<{
    properties: {
      label: string;
    };
    geometry: {
      coordinates: [number, number];
    };
  }>;
}

const route = useRoute();
const toast = useToast();
const colorMode = useColorMode();
const expandStore = useExpandStore();
const mapRefStore = useMapRef();
const mapStore = useMapRef();
const featureStore = useFeature();
const {
  titleFeature,
  isShowLayerManagement,
  isShowLegend,
  isShowProject,
  filterLocation,
  typeFeature,
} = storeToRefs(featureStore);
const isOpen = ref<boolean>(false);
const titleMap = computed(() => {
  const analysisType = route.params.analysis;

  switch (analysisType) {
    case "backhaul":
      return "Assets Management";
    case "potential-analysis":
      return "Market Potential Analysis (Existing Infrastructure)";
    case "FWA":
      return "Fixed Wireless Access (FWA) Opportunity Assessment";
    case "BOQ-BOM":
      return "Integrated BOQ & BOM Generation with Optical Budget Analysis";
    case "integrated-network":
      return "Integrated Network Planning Data Synchronization";
    case "automated-ftth":
      return "Automated FTTH Network Mapping";
    default:
      return titleFeature.value || "Map";
  }
});
const handleShare = async (event: Event) => {
  event.preventDefault();
  try {
    isLoading.value = true;
    const res = await $fetch<{ data: { id: string } }>(
      "/panel/items/shared_map?fields=id",
      {
        method: "POST",
        body: JSON.stringify({
          map_state: { boundArray: mapRefStore.map?.getBounds().toArray() },
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + authStore.accessToken,
        },
      },
    );
    navigator.clipboard.writeText(
      window.location.origin + "?share_id=" + res.data.id,
    );
    toast.add({
      title: "Share Map Successful",
      description: "Shareable link copied to your clipboard.",
      icon: "i-heroicons-information-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
    isModalOpen.value = false;
  } catch (error) {
    console.error(error);
  } finally {
    isLoading.value = false;
  }
};

const closeModal = () => {
  isModalOpen.value = false;
};

// const isDark = computed({
//   get() {
//     return colorMode.value === "dark";
//   },
//   set() {
//     colorMode.preference = colorMode.value === "dark" ? "light" : "dark";
//   },
// });
const { isLoading, data: mapData } = await useMapData();
const myInterval = ref<NodeJS.Timeout>();

// const startScroll = () => {
//   myInterval.value = setInterval(
//     () =>
//       document.getElementById("auto-scroll")?.scrollBy({
//         left: 5,
//         behavior: "smooth",
//       }),
//     100
//   );
// };
// const refreshScroll = () => {
//   clearInterval(myInterval.value);
//   document.getElementById("auto-scroll")?.scrollTo({
//     left: 0,
//     behavior: "smooth",
//   });
// };

const authStore = useAuth();

// Modal state for "Share Map"
const isModalOpen = ref(false);
const isBOQBOMOpen = ref(false);
const openShareModal = () => {
  isModalOpen.value = true;
};

const openBOQBOMOpen = () => {
  isBOQBOMOpen.value = true;
};

const closeShareModal = () => {
  isModalOpen.value = false;
};

const searchQuery = ref<string>("");
const addressSuggestions = ref<AddressSuggestion[]>([]);
const isLoadingFetch = ref<boolean>(false);
const showDropdown = ref<boolean>(false);

const fetchAddressSuggestions = async (): Promise<void> => {
  const coordinateRegex = /^-?\d+\.?\d*[,\s]+-?\d+\.?\d*$/;
  const match = searchQuery.value.match(coordinateRegex);

  if (match) {
    // Parse the coordinates, handling different formats
    const coords = searchQuery.value
      .split(/[,\s]+/)
      .map((coord) => parseFloat(coord.trim()))
      .filter((coord) => !isNaN(coord));

    if (coords.length === 2) {
      // Coor Option
      addressSuggestions.value = [
        {
          name: `Go to coordinates: ${coords[0]}, ${coords[1]}`,
          coordinates: [coords[1], coords[0]],
        },
      ];
      showDropdown.value = true;
    }
  } else {
    if (searchQuery.value.length < 3) {
      addressSuggestions.value = [];
      showDropdown.value = false;
      return;
    }

    isLoadingFetch.value = true;
    try {
      const response = await fetch(
        `https://api.openrouteservice.org/geocode/autocomplete?api_key=${orsApiKey}&text=${encodeURIComponent(
          searchQuery.value,
        )}`,
      );
      const data: OpenRouteResponse = await response.json();
      addressSuggestions.value = data.features.map((feature) => ({
        name: feature.properties.label,
        coordinates: feature.geometry.coordinates,
      }));
      showDropdown.value = true;
    } catch (error) {
      console.error("Error fetching address suggestions:", error);
      toast.add({
        title: "Error",
        description: "Failed to fetch address suggestions",
        color: "red",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });
    } finally {
      isLoadingFetch.value = false;
    }
  }
};

const handleKeyDown = (event: KeyboardEvent) => {
  if (event.key === "Escape") {
    removeMarker();
  }
};

onMounted(() => {
  window.addEventListener("keydown", handleKeyDown);
});

onUnmounted(() => {
  window.removeEventListener("keydown", handleKeyDown);

  if (currentMarker.value) {
    currentMarker.value.remove();
    currentMarker.value = null;
  }
});

// Debounce function to limit API calls
const debounce = <F extends (...args: any[]) => any>(fn: F, delay: number) => {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<F>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
};

const currentMarker = ref<maplibregl.Marker | null>(null);

// Function to remove marker
const removeMarker = () => {
  if (currentMarker.value) {
    currentMarker.value.remove();
    currentMarker.value = null;
  }
  searchQuery.value = "";
  showDropdown.value = false;
};

const createMarker = (coordinates: [number, number]) => {
  removeMarker();

  const marker = new maplibregl.Marker({
    color: "#FF8C00",
  })
    .setLngLat(coordinates)
    .addTo(mapStore.map!);

  currentMarker.value = marker;
};

watch(searchQuery, debounce(fetchAddressSuggestions, 300));

const selectAddress = (address: AddressSuggestion): void => {
  searchQuery.value = address.name;
  showDropdown.value = false;

  if (mapStore.map) {
    mapStore.map.flyTo({
      center: address.coordinates,
      zoom: 16,
      essential: true,
    });

    createMarker(address.coordinates);
  }
};

const imageLogo = ref();

function handleClose() {
  isOpen.value = false;
}

onMounted(async () => {
  try {
    interface LogoCompanyResponse {
      data: Array<{ image_logo: string }>;
    }
    const result = await $fetch<LogoCompanyResponse>(
      "/panel/items/logo_company?filter[name][_eq]=company&limit=1",
      {
        method: "GET",
        headers: {
          Authorization: "Bearer " + authStore.accessToken,
        },
      },
    );

    console.log({ result });

    if (result?.data?.length > 0) {
      imageLogo.value = "/panel/assets/" + result.data[0].image_logo;
    }
  } catch (error) {
    console.error("Failed to fetch logo:", error);
  }
});

const isModalForced = ref(false);
const isModalOpenLocation = ref(false);

// Watch untuk sync modal state
watch(
  () => filterLocation.value,
  (newFilterLocation) => {
    if (!isModalForced.value) {
      isModalOpenLocation.value = !newFilterLocation;
    }
  },
  { immediate: true },
);

watch(isModalForced, (forced) => {
  if (forced) {
    isModalOpenLocation.value = true;
  }
});

const closeModalLocation = () => {
  isModalForced.value = false;
  isModalOpenLocation.value = false;
};

const closeModalBOQ = () => {
  isBOQBOMOpen.value = false;
};
</script>

<template>
  <div
    v-if="
      route.path !== '/notification/approved' &&
      route.path !== '/notification/rejected'
    "
    :class="[expandStore.isExpand && 'sticky top-0', 'z-50 p-6 flex']"
  >
    <!-- <Presence>
      <Motion
        v-show="isExpand && route.path === '/map'"
        :initial="{ opacity: 1 }"
        :animate="{ opacity: 1 }"
        :exit="{ opacity: 0 }"
        :transition="{ duration: 0.5 }"
      >
        <div
          class="bg-black/50 backdrop-blur-sm fixed top-0 left-0 w-screen h-screen z-50"
        ></div>
      </Motion>
    </Presence> -->
    <div
      :class="expandStore.isExpand ? 'w-full py-3 px-0' : 'w-0 p-0'"
      class="relative bg-white rounded-xs flex items-center justify-between z-50 min-w-fit transition-all duration-300 ease-in-out"
    >
      <div class="flex items-center gap-2">
        <div class="relative flex items-center p-3 gap-3 h-12">
          <UPopover
            v-model:open="isOpen"
            overlay
            :popper="{
              offsetDistance: 17,
              offsetSkid: -10,
              placement: 'bottom-start',
            }"
          >
            <UButton
              variant="ghost"
              trailing-icon="i-streamline:interface-setting-menu-1-button-parallel-horizontal-lines-menu-navigation-three-hamburger"
              size="xs"
            />

            <template #panel>
              <LayoutsNavbarMenu @close="handleClose()" />
            </template>
          </UPopover>
          <div>
            <img :src="imageLogo" alt="" srcset="" class="w-fit h-8" />
          </div>

          <TransitionRoot
            :show="expandStore.isExpand"
            enter="transition-opacity duration-100"
            enter-from="opacity-0"
            enter-to="opacity-1"
            leave="transition-opacity duration-100"
            leave-from="opacity-1"
            leave-to="opacity-0"
            class="absolute right-0 translate-x-full flex gap-4 whitespace-nowrap overflow-hidden opacity-1"
          >
            <NuxtLink
              to="/"
              @click="expandStore.isExpand = !expandStore.isExpand"
            >
              <UButton
                :color="route.path === '/' ? 'navActive' : 'navMenu'"
                label="Map"
                :ui="{ rounded: 'rounded-full' }"
                class="text-2xs py-2 px-3 ring-0"
              >
                <template #leading>
                  <IcMapFlat class="text-base" />
                </template>
              </UButton>
            </NuxtLink>
            <NuxtLink to="/home">
              <UButton
                :color="route.path === '/home' ? 'navActive' : 'navMenu'"
                label="Home"
                :ui="{ rounded: 'rounded-full' }"
                class="text-2xs py-2 px-3 ring-0"
              >
                <template #leading>
                  <IcHome class="text-base" />
                </template>
              </UButton>
            </NuxtLink>
          </TransitionRoot>
        </div>
      </div>

      <TransitionRoot
        :show="expandStore.isExpand"
        enter="transition-opacity duration-100"
        enter-from="opacity-0"
        enter-to="opacity-1"
        leave="transition-opacity duration-100"
        leave-from="opacity-1"
        leave-to="opacity-0"
        class="absolute right-0 flex items-center gap-2 px-3"
      >
        <UButton @click="openShareModal" label="Share Map">
          <template #trailing>
            <IcLink class="text-base" />
          </template>
        </UButton>

        <UButton
          @click="
            async () => {
              if (authStore.isSignedIn) {
                toast.add({
                  title: 'Sign Out Successful',
                  description: 'You are now browsing as a guest.',
                  icon: 'i-heroicons-information-circle',
                  ui: {
                    background: 'bg-white',
                    title: 'text-gray-900 text-md font-semibold',
                    description: 'text-gray-500',
                    icon: 'text-green-500',
                  },
                });
                navigateTo('/signin');
                await authStore.signout();
              } else navigateTo('/signin');
            }
          "
          class="h-9 w-9 rounded-full flex items-center justify-center"
        >
          <IcLogout v-if="authStore.isSignedIn" />
          <IcLogin v-else />
        </UButton>
      </TransitionRoot>
      <TransitionRoot
        :show="!expandStore.isExpand"
        enter="transition-opacity duration-1000"
        enter-from="opacity-0"
        enter-to="opacity-1"
        leave="transition-opacity duration-100"
        leave-from="opacity-1"
        leave-to="opacity-0"
        class="absolute top-0 -right-3 translate-x-full transition-opacity ease-in-out duration-100 flex items-center gap-2"
      >
        <div class="flex items-center bg-white rounded-xs h-12 p-3 max-w-2xl">
          <p class="whitespace-nowrap font-raleway text-black font-medium">
            {{ titleMap }}
          </p>
        </div>
        <div>
          <div
            class="flex gap-2 shrink transition-all ease-in-out duration-300 items-center"
          >
            <div
              class="p-2 bg-white rounded-xs shadow-md justify-center gap-2 overflow-hidden flex items-center cursor-pointer"
              @click="() => (isShowLayerManagement = !isShowLayerManagement)"
              :class="
                isShowLayerManagement
                  ? 'text-white bg-gradient-to-r from-blue-100 to-blue-600'
                  : 'bg-transparent'
              "
            >
              <IcMapLayer class="w-5 h-5" :fontControlled="false" />
              <p
                class="justify-start text-[10px] font-medium font-Raleway leading-none"
              >
                Layers
              </p>
            </div>
            <div
              v-if="typeFeature === 'ftth-mapping'"
              class="p-2 bg-white rounded-xs shadow-md justify-center gap-2 overflow-hidden flex items-center cursor-pointer"
              @click="() => (isShowProject = !isShowProject)"
              :class="
                isShowProject
                  ? 'text-white bg-gradient-to-r from-blue-100 to-blue-600'
                  : 'bg-transparent'
              "
            >
              <UIcon name="i-heroicons-folder" class="w-5 h-5" />
              <p
                class="justify-start text-[10px] font-medium font-Raleway leading-none"
              >
                Project
              </p>
            </div>
            <div
              class="p-2 bg-white rounded-xs shadow-md justify-center gap-2 overflow-hidden flex items-center cursor-pointer"
              @click="() => (isShowLegend = !isShowLegend)"
              :class="
                isShowLegend
                  ? 'text-white bg-gradient-to-r from-blue-100 to-blue-600'
                  : 'bg-transparent'
              "
            >
              <IcBasemap class="w-5 h-5" :fontControlled="false" />
              <p
                class="justify-start text-[10px] font-medium font-Raleway leading-none"
              >
                Legends
              </p>
            </div>
          </div>
        </div>
      </TransitionRoot>
    </div>
    <div
      class="absolute top-6 right-6 z-40 flex items-center gap-2 bg-white p-[6px] h-12 rounded-xs"
    >
      <div class="relative">
        <UInput
          v-model="searchQuery"
          :ui="{ rounded: 'rounded-xxs' }"
          placeholder="Search Location"
        >
          <template #trailing>
            <UButton
              variant="link"
              icon="i-heroicons-magnifying-glass-20-solid"
              :padded="false"
              :loading="isLoadingFetch"
            />
          </template>
        </UInput>
        <div
          v-if="showDropdown && addressSuggestions.length > 0"
          class="absolute z-50 w-full mt-1 bg-white rounded-xxs shadow-lg text-grey-800 text-xs"
        >
          <ul class="py-1">
            <li
              v-for="address in addressSuggestions"
              :key="address.name"
              @click="selectAddress(address)"
              class="px-3 py-2 hover:bg-grey-100 cursor-pointer"
            >
              {{ address.name }}
            </li>
          </ul>
        </div>
      </div>
      <UButton
        v-if="filterLocation"
        class="flex items-center gap-2 cursor-pointer"
        :ui="{ rounded: 'rounded-xs' }"
        @click="isModalForced = true"
      >
        <IcLocation />
        <p>Filter</p>
      </UButton>
      <UButton
        @click="openBOQBOMOpen"
        :ui="{ rounded: 'rounded-xs' }"
        label="BOQ & BOM"
      >
      </UButton>
      <LayoutsNavbarShare />
      <LayoutsNavbarAuth />
    </div>

    <transition name="modal-fade">
      <div
        v-if="isModalOpen"
        class="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50"
      >
        <div
          class="bg-[#232221] text-white rounded-xs shadow-lg p-6 w-full max-w-md"
        >
          <div class="flex items-start justify-between">
            <h3 class="text-base font-semibold mb-4">Share & Export</h3>
            <button @click="closeModal" class="text-white">&times;</button>
          </div>
          <div class="text-sm">
            <p class="mb-2">Copy View Mode Link</p>
            <UButton
              label="Share Map"
              @click="handleShare"
              :disabled="isLoading"
              class="w-full rounded-xs"
            >
              <template #trailing>
                <UIcon
                  v-if="isLoading"
                  name="i-heroicons-arrow-path-solid"
                  class="h-4 w-4 animate-spin"
                />
                <IcLink v-else class="text-base" />
              </template>
            </UButton>
          </div>
          <div class="text-sm mt-4">
            <p class="mb-2">Export Dashboard to PDF</p>
            <UButton
              label="Export PDF"
              :disabled="isLoading"
              class="w-full rounded-xs"
            >
              <template #trailing>
                <UIcon
                  v-if="isLoading"
                  name="i-heroicons-arrow-path-solid"
                  class="h-4 w-4 animate-spin"
                />
                <IcLink v-else class="text-base" />
              </template>
            </UButton>
          </div>
        </div>
      </div>
    </transition>
  </div>
  <LayoutsAuthModal :isExpand="expandStore.isExpand"> </LayoutsAuthModal>
  <UModal :prevent-close="true" v-model="isModalOpenLocation">
    <LandingModalPlayground @close="closeModalLocation" />
  </UModal>
  <UModal
    fullscreen
    :ui="{ fullscreen: 'w-[50%] h-[100%]' }"
    v-model="isBOQBOMOpen"
  >
    <Boqbom @close="closeModalBOQ" />
  </UModal>
</template>

<style scoped>
.modal-fade-enter-active,
.modal-fade-leave-active {
  transition: opacity 0.3s ease;
}

.modal-fade-enter,
.modal-fade-leave-to {
  opacity: 0;
}
</style>
