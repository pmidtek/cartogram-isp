<script setup lang="ts">
import { ref, computed } from "vue";
import { useQuery } from "@tanstack/vue-query";
import draggable from "vuedraggable";

const props = defineProps<{
  savedRanking?: any[];
}>();

const emit = defineEmits<{
  (e: "update:ranking", towers: any[]): void;
  (e: "close", value: boolean): void;
}>();

const authStore = useAuth();
const toast = useToast();

// Fetch tower list from API
const { data: towersData, isLoading: isLoadingTowers } = useQuery({
  queryKey: ["/panel/data/tower-list"],
  queryFn: async () => {
    const res = await $fetch<{
      data: { owner: string; latest_date_created: string }[];
    }>("/panel/data/tower-list", {
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    return res.data.map((tower, index) => ({
      id: `tower-${index}`,
      code: tower.owner,
      name: tower.owner,
      displayName: tower.owner,
      latest_date_created: tower.latest_date_created,
      rank: index + 1,
    }));
  },
});

// Local state for draggable towers
const rankedTowers = ref<any[]>([]);

// Initialize rankedTowers when data loads or savedRanking changes
watch(
  [towersData, () => props.savedRanking],
  ([towers, savedRanking]) => {
    if (savedRanking && savedRanking.length > 0) {
      rankedTowers.value = [...savedRanking];
    } else if (towers && towers.length > 0) {
      rankedTowers.value = [...towers];
    }
  },
  { immediate: true },
);

// Format date to "DD Mon YYYY"
const formatDate = (dateString: string) => {
  const date = new Date(dateString);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const day = date.getDate().toString().padStart(2, "0");
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day} ${month} ${year}`;
};

const handleSave = () => {
  // Update ranks based on current order
  const updatedTowers = rankedTowers.value.map((tower, index) => ({
    ...tower,
    rank: index + 1,
  }));

  toast.add({
    title: "Success",
    description: "Tower ranking saved successfully",
    icon: "i-heroicons-check-circle",
    ui: {
      background: "bg-white",
      title: "text-gray-900 text-md font-semibold",
      description: "text-gray-500",
      icon: "text-green-500",
    },
  });
  emit("update:ranking", updatedTowers);
  emit("close", true);
};

const resetRanking = () => {
  if (towersData.value && towersData.value.length > 0) {
    rankedTowers.value = [...towersData.value];
  }
};
</script>

<template>
  <UCard
    :ui="{
      rounded: 'rounded-xs',
      ring: '',
      divide: 'divide-y divide-gray-200',
      header: { padding: 'px-2 py-2 sm:px-2' },
      body: { padding: 'p-0, sm:p-2' },
      footer: { padding: 'px-2 py-2 sm:px-2' },
    }"
  >
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <h3 class="text-base font-semibold text-grey-900">
            Tower Priority Ranking
          </h3>
          <p class="text-xs text-grey-600 mt-0.5">
            Drag and drop to reorder towers by priority
          </p>
        </div>
      </div>
    </template>

    <!-- Loading State -->
    <div
      v-if="isLoadingTowers"
      class="flex flex-col items-center justify-center py-12"
    >
      <div
        class="animate-spin rounded-full h-10 w-10 border-b-2 border-brand-500"
      ></div>
      <p class="text-sm text-grey-500 mt-3">Loading towers...</p>
    </div>

    <!-- No Towers Found -->
    <div
      v-else-if="!isLoadingTowers && rankedTowers.length === 0"
      class="flex flex-col items-center justify-center py-12"
    >
      <UIcon
        name="i-heroicons-exclamation-circle"
        class="w-12 h-12 text-grey-400 mb-3"
      />
      <p class="text-sm text-grey-700 font-medium">No towers available</p>
      <p class="text-xs text-grey-500 mt-1">No tower data configured</p>
    </div>

    <!-- Towers List -->
    <div v-else class="space-y-3">
      <div class="max-h-[50vh] overflow-y-auto">
        <draggable
          v-model="rankedTowers"
          item-key="id"
          handle=".drag-handle"
          ghost-class="ghost"
          animation="200"
          class="space-y-2"
        >
          <template #item="{ element, index }">
            <div
              class="group relative border rounded-xxs p-2 bg-white border-grey-200 hover:border-brand-400 hover:shadow-sm transition-all cursor-grab active:cursor-grabbing"
            >
              <div class="flex items-center gap-3 drag-handle">
                <!-- Tower Info -->
                <div class="flex-1 min-w-0">
                  <div class="flex gap-2 items-center">
                    <h4 class="text-[14px] font-medium text-grey-900 truncate">
                      {{ element.displayName }}
                    </h4>
                    <p
                      v-if="element.latest_date_created"
                      class="text-[11px] text-grey-500"
                    >
                      Last update: {{ formatDate(element.latest_date_created) }}
                    </p>
                  </div>
                </div>
                <UIcon name="i-heroicons-bars-3" class="w-5 h-5" />
              </div>
            </div>
          </template>
        </draggable>
      </div>
    </div>

    <template #footer>
      <div class="grid grid-cols-2 gap-2 w-full">
        <UButton
          label="Reset"
          color="gray"
          variant="outline"
          size="sm"
          block
          @click="resetRanking"
          :ui="{ rounded: 'rounded-xxs' }"
        />
        <UButton
          label="Save Ranking"
          color="brand"
          size="sm"
          block
          @click="handleSave"
          :disabled="rankedTowers.length === 0"
          :ui="{ rounded: 'rounded-xxs' }"
        />
      </div>
    </template>
  </UCard>
</template>
