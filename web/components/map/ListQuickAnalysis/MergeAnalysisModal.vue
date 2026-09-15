<script setup lang="ts">
interface Props {
  qmiResults: any[];
  selectedIds: Set<number>;
  mergeName: string;
  isMerging: boolean;
}

interface Emits {
  (e: "update:selectedIds", value: Set<number>): void;
  (e: "update:mergeName", value: string): void;
  (e: "merge"): void;
  (e: "cancel"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const toggleSelection = (qmiId: number) => {
  const newSet = new Set(props.selectedIds);
  if (newSet.has(qmiId)) {
    newSet.delete(qmiId);
  } else {
    newSet.add(qmiId);
  }
  emit("update:selectedIds", newSet);
};

const updateName = (value: string) => {
  emit("update:mergeName", value);
};

const formatDate = (dateString: string) => {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dateString;
  }
};
</script>

<template>
  <UCard
    :ui="{
      rounded: 'rounded-xs',
      divide: 'divide-y divide-grey-200',
      header: { padding: '' },
      body: { padding: '' },
    }"
  >
    <!-- Header -->
    <template #header>
      <div class="flex items-start justify-between p-4">
        <div>
          <h2 class="text-md font-semibold text-grey-900">Merge Analysis</h2>
          <p class="text-xs text-grey-600 mt-1">
            Combine multiple QMI results into a unified analysis
          </p>
        </div>
        <UButton
          color="gray"
          variant="ghost"
          icon="i-heroicons-x-mark"
          :disabled="isMerging"
          @click="emit('cancel')"
          class="-mr-2"
        />
      </div>
    </template>

    <!-- Content -->
    <div class="p-4 space-y-6 max-h-[60vh] overflow-y-auto">
      <!-- Merge Name Input -->
      <div>
        <label
          for="merge-name"
          class="block text-xs font-semibold text-grey-900 mb-2"
        >
          Analysis Name
          <span class="text-red-500 ml-1">*</span>
        </label>
        <UInput
          id="merge-name"
          :model-value="mergeName"
          @update:model-value="updateName"
          placeholder="Enter a descriptive name..."
          :disabled="isMerging"
          size="md"
        />
        <p class="text-brand italic text-[10px] mt-1">
          Notes: Please merge only matching data.
        </p>
      </div>

      <!-- Selection List -->
      <div>
        <div class="flex items-center justify-between mb-3">
          <label class="block text-xs font-semibold text-grey-900">
            Select Results to Merge
            <span class="text-red-500 ml-1">*</span>
          </label>
          <UBadge color="primary" variant="subtle" size="xs">
            {{ selectedIds.size }} selected
          </UBadge>
        </div>

        <div class="space-y-2">
          <div
            v-for="item in qmiResults"
            :key="item.id"
            @click="!isMerging && toggleSelection(item.id)"
            :class="[
              'flex items-center gap-3 py-2 px-4 rounded-xs border transition-all cursor-pointer',
              selectedIds.has(item.id)
                ? 'bg-brand-50 border-brand-500'
                : 'bg-white border-grey-200 hover:border-brand-300',
              isMerging && 'opacity-50 cursor-not-allowed',
            ]"
          >
            <!-- Checkbox -->
            <div class="flex-shrink-0 pt-0.5">
              <div
                :class="[
                  'w-4 h-4 rounded border-2 flex items-center justify-center transition-all',
                  selectedIds.has(item.id)
                    ? 'bg-brand-500 border-brand-500'
                    : 'bg-white border-grey-300',
                ]"
              >
                <UIcon
                  v-if="selectedIds.has(item.id)"
                  name="i-heroicons-check"
                  class="w-3 h-3 text-white"
                />
              </div>
            </div>

            <!-- Content -->
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-medium text-grey-900 truncate">
                {{ item.name || `Analysis ${item.geoprocessing_uuid}` }}
              </h3>
              <p class="text-xs text-grey-600 mt-0.5 flex items-center gap-1">
                <UIcon name="i-heroicons-calendar" class="w-3 h-3" />
                {{ formatDate(item.date_created) }}
              </p>
            </div>
          </div>
        </div>

        <!-- Validation Hint -->
        <div
          v-if="selectedIds.size < 2"
          class="mt-3 p-2 bg-red-50 border-l-2 border-red-500 rounded"
        >
          <p class="text-xs text-red-600">Select at least 2 results to merge</p>
        </div>
      </div>
    </div>

    <!-- Footer Actions -->
    <template #footer>
      <div class="flex gap-3 justify-end">
        <UButton
          color="gray"
          variant="ghost"
          @click="emit('cancel')"
          :disabled="isMerging"
        >
          Cancel
        </UButton>
        <UButton
          color="primary"
          @click="emit('merge')"
          :disabled="isMerging || selectedIds.size < 2 || !mergeName.trim()"
          :loading="isMerging"
          :ui="{ rounded: 'rounded-xxs' }"
        >
          {{ isMerging ? "Merging..." : "Merge Analysis" }}
        </UButton>
      </div>
    </template>
  </UCard>
</template>
