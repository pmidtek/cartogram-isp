<script lang="ts" setup>
import { storeToRefs } from "pinia";
import { useQuery, useQueryClient } from "@tanstack/vue-query";

const selectProvience = ref<any>([]);
const selectCities = ref<any>([]);
const showAllData = ref(false);
const authStore = useAuth();
const { dataUser } = storeToRefs(authStore);
const clientQuery = useQueryClient();
const toast = useToast();
const featureStore = useFeature();
const { filterLocation } = storeToRefs(featureStore);
const mapLayerStore = useMapLayer();
const { fetchActiveLayers } = mapLayerStore;
const moduleStore = useMapModule();
const { currentModule } = storeToRefs(moduleStore);
const mapRefStore = useMapRef();
const { map } = storeToRefs(mapRefStore);

// Check if user is a city account (has area_city but it's not null/0)
const isCityAccount = computed(() => {
  return dataUser.value?.role?.role_type === "city";
});

// Check if user is a province account (has area_province but area_city is null/0)
const isProvinceAccount = computed(() => {
  return dataUser.value?.role?.role_type === "province";
});
const removeProvince = (index: number) => {
  selectProvience.value.splice(index, 1);
};

const removeCity = (index: number) => {
  selectCities.value.splice(index, 1);
};

// Watch showAllData to clear selections when enabled
watch(showAllData, (newValue) => {
  if (newValue) {
    selectProvience.value = [];
    selectCities.value = [];
  }
});

const emit = defineEmits(["close"]);

const closeModal = () => {
  emit("close");
};

const cancelModal = () => {
  emit("close");
};

const resetFilter = () => {
  selectProvience.value = [];
  selectCities.value = [];
  showAllData.value = false;
};

const { data: dataProvience } = useQuery({
  queryKey: ["data-provience"],
  queryFn: async () => {
    const res = await $fetch<any>(
      "/panel/items/area_provinces?fields=province_id,province",
      {
        method: "GET",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return res.data;
  },
});
const { data: dataCity } = useQuery({
  queryKey: [
    "data-city",
    computed(() =>
      Array.isArray(selectProvience.value)
        ? selectProvience.value.map((p: any) => p.province_id).join(",")
        : "",
    ),
  ],
  queryFn: async () => {
    const idProvience = selectProvience.value.map(
      (item: any) => item.province_id,
    );
    const res = await $fetch<any>(`/panel/items/area_cities`, {
      method: "GET",
      params: {
        fields: "city_id,city",
        sort: "city_id",
        limit: -1,
        "filter[province_id][_in]": idProvience.join(","),
      },
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    return res.data;
  },
  enabled: computed(
    () =>
      Array.isArray(selectProvience.value) && selectProvience.value.length > 0,
  ),
});

const handleApplyLocation = async () => {
  try {
    await $fetch("/panel/playgrounds", {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify({
        provinces: showAllData.value
          ? []
          : selectProvience.value.map((item: any) => {
              return {
                key: item.province_id,
                value: item.province,
              };
            }),
        cities: showAllData.value
          ? []
          : selectCities.value.map((item: any) => {
              return {
                key: item.city_id,
                value: item.city,
              };
            }),
      }),
    });

    // Update filterLocation in store BEFORE fetching layers
    if (showAllData.value) {
      // Show all data mode - empty arrays
      filterLocation.value = {
        province: [],
        cities: [],
      };
    } else {
      // Filtered mode - update with selected values
      filterLocation.value = {
        province: selectProvience.value,
        cities: selectCities.value,
      };
    }

    // Clear existing layers before refetching
    if (map.value) {
      const currentLayers = mapLayerStore.groupedActiveLayers;
      const layerSourceIds = new Set<string>();

      // Remove all current layers from the map
      currentLayers.forEach((group) => {
        group.layerLists.forEach((layer) => {
          try {
            if (map.value!.getLayer(layer.layer_id)) {
              map.value!.removeLayer(layer.layer_id);
            }
            // Track the source ID for this layer
            if (layer.source === "vector_tiles" && "layer_name" in layer) {
              layerSourceIds.add(layer.layer_name);
            }
          } catch (e) {
            console.warn(`Failed to remove layer ${layer.layer_id}:`, e);
          }
        });
      });

      // Remove only the vector tile sources that were used by our layers
      layerSourceIds.forEach((sourceId) => {
        try {
          if (map.value!.getSource(sourceId)) {
            map.value!.removeSource(sourceId);
          }
        } catch (e) {
          console.warn(`Failed to remove source ${sourceId}:`, e);
        }
      });
    }

    // Refetch layer list after successful location change
    // This will trigger the layer components to re-render with new data
    await fetchActiveLayers(currentModule.value?.slug);

    toast.add({
      title: "Location Change Success",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: `Location has been changed successfully.`,
      icon: "i-heroicons-check-circle",
    });
    closeModal();
  } catch (error) {
    console.log(error);
    toast.add({
      title: "Location Change Unsuccess",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
      description: `Please try again later`,
      icon: "i-heroicons-x-mark",
    });
  }
};

// Query untuk fetch user location data
const { data: userLocationData, refetch: refetchUserData } = useQuery({
  queryKey: ["modal-user-location"],
  queryFn: async () => {
    const res = await $fetch<any>("/panel/playgrounds", {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });

    if (res.data) {
      // Check if showing all data (both empty arrays)
      const isShowingAll =
        res.data.provinces?.length === 0 && res.data.cities?.length === 0;

      if (isShowingAll) {
        // Show all data mode
        showAllData.value = true;
        selectProvience.value = [];
        selectCities.value = [];
        filterLocation.value = {
          province: [],
          cities: [],
        };
      } else if (res.data.provinces?.length > 0) {
        // Filtered mode - has at least province data
        const formatData = {
          province: res.data.provinces.map((i: any) => ({
            province_id: i.key,
            province: i.value,
          })),
          cities:
            res.data.cities?.map((i: any) => ({
              city_id: i.key,
              city: i.value,
            })) || [],
        };

        // Set form values
        selectProvience.value = formatData.province;
        selectCities.value = formatData.cities;
        showAllData.value = false;

        // Update store
        filterLocation.value = formatData;
      }
    }

    return res.data;
  },
  enabled: false, // Manual trigger
});

onMounted(async () => {
  await refetchUserData();
});
</script>

<template>
  <UCard
    :ui="{
      rounded: 'rounded-xxs',
      base: 'p-3',
      header: {
        padding: 'sm:p-0',
      },
      body: {
        padding: 'sm:p-0',
      },
      footer: {
        padding: 'sm:p-0',
      },
    }"
  >
    <template #header>
      <div class="flex items-center justify-between pb-1">
        <div>
          <p class="text-[12px] font-medium">Location Filter</p>
          <p class="text-[10px] text-grey-500">
            Filter your specific location to run the map
          </p>
        </div>
        <UButton
          variant="ghost"
          icon="i-line-md:close"
          color="gray"
          size="2xs"
          :ui="{
            icon: {
              base: 'text-gray-300',
            },
          }"
          @click="closeModal"
        />
      </div>
    </template>

    <div class="py-3 space-y-3">
      <!-- Show All Data Checkbox - Hide for city and province accounts -->
      <div
        v-if="!isCityAccount && !isProvinceAccount"
        class="flex items-center gap-2"
      >
        <UCheckbox
          v-model="showAllData"
          :ui="{ rounded: 'rounded-sm' }"
          label="Show all data (no filter)"
        />
      </div>

      <div class="space-y-2">
        <p class="text-[10px] font-normal">Provience</p>
        <USelectMenu
          v-model="selectProvience"
          :ui="{ rounded: 'rounded-xxs' }"
          :ui-menu="{ rounded: 'rounded-xxs' }"
          size="md"
          placeholder="-- Choose Province --"
          multiple
          :options="dataProvience"
          :option-attribute="'province'"
          :disabled="showAllData || isCityAccount || isProvinceAccount"
        >
          <template #label>
            <div v-if="selectProvience?.length" class="flex flex-wrap gap-1">
              <span
                v-for="(item, index) in selectProvience"
                :key="item.province_id"
                class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-primary-50 text-primary-600 rounded-xxs"
              >
                {{ item.province }}
                <button
                  v-if="!isCityAccount && !isProvinceAccount"
                  @click.stop="removeProvince(index)"
                  class="hover:bg-primary-100 rounded-full p-0.5"
                >
                  <Icon name="i-heroicons:x-mark-20-solid" class="w-3 h-3" />
                </button>
              </span>
            </div>
            <span v-else class="text-gray-400">-- Choose Province --</span>
          </template>
        </USelectMenu>
      </div>
      <div class="space-y-2">
        <p class="text-[10px] font-normal">City or Region</p>
        <USelectMenu
          v-model="selectCities"
          :ui="{ rounded: 'rounded-xxs' }"
          :ui-menu="{ rounded: 'rounded-xxs' }"
          size="md"
          placeholder="-- City or Region--"
          multiple
          :options="dataCity"
          :option-attribute="'city'"
          :disabled="showAllData || isCityAccount"
        >
          <template #label>
            <div v-if="selectCities?.length" class="flex flex-wrap gap-1">
              <span
                v-for="(item, index) in selectCities"
                :key="item.city_id"
                class="inline-flex items-center gap-1 px-2 py-1 text-xs bg-primary-50 text-primary-600 rounded-xxs"
              >
                {{ item.city }}
                <button
                  v-if="!isCityAccount"
                  @click.stop="removeCity(index)"
                  class="hover:bg-primary-100 rounded-full p-0.5"
                >
                  <Icon name="i-heroicons:x-mark-20-solid" class="w-3 h-3" />
                </button>
              </span>
            </div>
            <span v-else class="text-gray-400">-- City or Region --</span>
          </template>
        </USelectMenu>
      </div>
      <!-- Hide Reset Filter button for city accounts, show for province accounts -->
      <div v-if="!isCityAccount" class="pb-[179px]">
        <UButton
          v-if="!isProvinceAccount"
          variant="ghost"
          label="Reset Filter"
          icon="i-ri:reset-left-line"
          size="2xs"
          color="gray"
          :disabled="
            !selectProvience?.length && !selectCities?.length && !showAllData
          "
          @click="resetFilter"
        >
        </UButton>
      </div>
      <!-- Add spacing for city accounts -->
      <div v-else class="pb-[179px]"></div>
    </div>

    <template #footer>
      <!-- Show footer buttons for province accounts, hide for city accounts -->
      <div class="flex items-center justify-end pt-3 gap-2">
        <UButton
          :ui="{ rounded: 'rounded-xxs' }"
          size="lg"
          variant="outline"
          color="gray"
          label="Cancel"
          @click="cancelModal"
        />
        <UButton
          @click="handleApplyLocation"
          :ui="{ rounded: 'rounded-xxs' }"
          variant="solid"
          label="Apply Location"
          size="lg"
          :disabled="
            isCityAccount || (!showAllData && !selectProvience?.length)
          "
        />
      </div>
    </template>
  </UCard>
</template>
