<script lang="ts" setup>
import type { BoqBomGenerateResult, BoqBomGroup } from "~/utils/types";

const props = defineProps<{
  result: BoqBomGenerateResult;
}>();

const boqBom = useBoqBomResult();

function formatNumber(value: number | undefined) {
  if (value == null) return "-";
  return new Intl.NumberFormat("id-ID", { maximumFractionDigits: 0 }).format(
    value,
  );
}

function formatCurrency(value: number | undefined) {
  if (value == null) return "-";
  return `IDR ${formatNumber(value)}`;
}

function formatSummaryLabel(key: string) {
  return key
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatSummaryValue(key: string, value: unknown) {
  if (value == null || value === "") return "-";
  if (typeof value === "number") {
    return key.includes("cost") ? formatCurrency(value) : formatNumber(value);
  }
  return String(value);
}

function summaryEntries(group: BoqBomGroup) {
  return Object.entries(group.summary ?? {});
}

const sections = computed<BoqBomGroup[]>(() =>
  [props.result.boq.material, props.result.boq.services].filter(
    (group): group is BoqBomGroup => !!group,
  ),
);

const totalCost = computed(
  () =>
    props.result.boq.material?.summary?.total_cost ??
    sections.value.reduce((sum, group) => sum + group.group_total, 0),
);

// Counts up from 0 to the total whenever it (re)appears, rather than
// jumping straight to the final figure.
const animatedTotal = ref(0);
let animationFrameId: number | null = null;

function animateCounterTo(target: number) {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);

  const duration = 1000;
  const start = performance.now();

  function step(now: number) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3); // ease-out cubic
    animatedTotal.value = Math.round(target * eased);
    animationFrameId = progress < 1 ? requestAnimationFrame(step) : null;
  }

  animatedTotal.value = 0;
  animationFrameId = requestAnimationFrame(step);
}

watch(totalCost, (value) => animateCounterTo(value ?? 0), { immediate: true });

onUnmounted(() => {
  if (animationFrameId !== null) cancelAnimationFrame(animationFrameId);
});
</script>

<template>
  <div class="space-y-3">
    <div class="rounded-xs bg-brand-500 text-white p-3">
      <p class="text-2xs uppercase tracking-wide text-grey-100">
        Total Estimated Project Cost
      </p>
      <p class="text-base font-semibold">
        {{ formatCurrency(animatedTotal) }}
      </p>
    </div>

    <div
      v-for="group of sections"
      :key="group.group_name"
      class="border border-grey-700 rounded-xxs overflow-hidden"
    >
      <table class="w-full text-2xs border-collapse">
        <thead>
          <tr class="bg-grey-100 text-grey-500 uppercase">
            <th class="text-left font-normal px-2 py-1.5" colspan="4">
              {{ group.groups[0]?.name ?? group.group_name }} ·
              {{ formatCurrency(group.group_total) }}
            </th>
          </tr>
          <tr class="bg-grey-100 text-grey-500 uppercase">
            <th class="text-left font-normal px-2 py-1">Item</th>
            <th class="text-right font-normal px-2 py-1">Qty</th>
            <th class="text-right font-normal px-2 py-1">Unit Cost</th>
            <th class="text-right font-normal px-2 py-1">Total</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row of group.groups[0]?.rows ?? []"
            :key="row.code"
            class="border-t border-grey-700"
          >
            <td class="text-grey-800 px-2 py-1.5">
              <p class="truncate">{{ row.description || row.code }}</p>
              <p v-if="row.description" class="text-grey-500 truncate">
                {{ row.code }}
              </p>
            </td>
            <td class="text-grey-800 text-right px-2 py-1.5 align-top">
              {{ row.qty }}
            </td>
            <td class="text-grey-800 text-right px-2 py-1.5 align-top">
              {{ formatNumber(row.price) }}
            </td>
            <td
              class="text-grey-800 text-right font-medium px-2 py-1.5 align-top"
            >
              {{ formatNumber(row.total) }}
            </td>
          </tr>
        </tbody>
      </table>

      <div
        v-if="summaryEntries(group).length"
        class="border-t border-grey-700 p-2 space-y-1"
      >
        <p class="text-2xs text-grey-500 uppercase">
          {{ group.groups[0]?.name ?? group.group_name }} Summary
        </p>
        <div
          v-for="[key, value] of summaryEntries(group)"
          :key="key"
          class="flex justify-between gap-2 text-2xs"
        >
          <span class="text-grey-500">{{ formatSummaryLabel(key) }}</span>
          <span class="text-grey-800">{{ formatSummaryValue(key, value) }}</span>
        </div>
      </div>
    </div>
    <p v-if="!sections.length" class="text-2xs text-grey-500">
      No BOQ items.
    </p>

    <UButton
      variant="solid"
      color="brand"
      label="Download Excel"
      block
      :loading="boqBom.isDownloading.value"
      :ui="{ rounded: 'rounded-xxs' }"
      @click="boqBom.downloadExcel()"
    />
  </div>
</template>
