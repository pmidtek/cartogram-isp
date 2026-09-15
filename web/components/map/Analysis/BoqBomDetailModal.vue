<script setup lang="ts">
import { computed, ref } from "vue";

const props = defineProps<{
  modelValue: boolean;
  boqBomData: any;
  isPriceDefault: boolean;
  routeDistance: number;
  pointsCount: number;
  analysisType?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
}>();

const analysisStore = useAnalysisResult();
const authStore = useAuth();
const toast = useToast();

// Local state
const isExporting = ref(false);
const activeSection = ref<"summary" | "detail">("detail");

// Sidebar menu items
const menuItems = [
  {
    key: "summary",
    label: "Executive Summary",
    icon: "i-heroicons-chart-bar-square",
  },
  {
    key: "detail",
    label: "Detail BOQ / BOM",
    icon: "i-heroicons-document-text",
  },
];

// Computed properties
const isOpen = computed({
  get: () => props.modelValue,
  set: (value) => emit("update:modelValue", value),
});

const boqData = computed(() => props.boqBomData?.boq || null);

const boqCategories = computed(() => {
  if (!boqData.value) return [] as any[];
  const order = ["material", "homepass", "homeconnect"];
  return order
    .map((key) => {
      const cat = (boqData.value as any)[key];
      if (!cat) return null;
      return { key, ...cat };
    })
    .filter(Boolean) as any[];
});

const totalCost = computed(() => {
  if (!boqData.value) return 0;
  const fromMaterial = boqData.value?.material?.summary?.total_cost;
  if (typeof fromMaterial === "number") return fromMaterial;
  return boqCategories.value.reduce(
    (acc, c: any) => acc + (Number(c?.group_total) || 0),
    0,
  );
});

// Format number helper
const formatNumber = (value: number | string) => {
  const num = typeof value === "string" ? parseFloat(value) : value;
  return new Intl.NumberFormat("en-US").format(num);
};

const formatCurrency = (value: number) => {
  return `IDR ${formatNumber(value)}`;
};

// Humanize a snake_case key — "cost_service_homepass" → "Cost Service Homepass".
const humanizeKey = (key: string) =>
  key
    .replace(/_/g, " ")
    .replace(/\b(\w)/g, (m) => m.toUpperCase())
    .replace(/\bCpa\b/i, "CPA")
    .replace(/\bJia\b/i, "JIA")
    .replace(/\bLda\b/i, "LDA");

const isCurrencyKey = (key: string) => {
  const k = key.toLowerCase();
  if (k.startsWith("cost_") || k === "total_cost") return true;
  if (k.startsWith("cpa_") || k === "total_cpa") return true;
  if (k.startsWith("service_")) return true;
  if (k.startsWith("material_")) return true;
  return false;
};

const formatSummaryValue = (key: string, value: any): string => {
  const num = Number(value) || 0;
  if (isCurrencyKey(key)) return formatCurrency(num);
  return formatNumber(num);
};

const summaryEntriesOf = (
  category: any,
): { label: string; value: string }[] => {
  const entries: { label: string; value: string }[] = [];
  const desc = category?.description as Record<string, any> | undefined;
  if (desc) {
    Object.entries(desc).forEach(([k, v]) => {
      entries.push({
        label: humanizeKey(k),
        value: formatNumber(Number(v) || 0),
      });
    });
  }
  const summary = category?.summary as Record<string, any> | undefined;
  if (summary) {
    Object.entries(summary).forEach(([k, v]) => {
      entries.push({ label: humanizeKey(k), value: formatSummaryValue(k, v) });
    });
  }
  return entries;
};

// Handle export to Excel via the BOQ/BOM generator endpoint.
const handleExport = async () => {
  const projectId = analysisStore.ftthAnalysisProjectId;
  if (!projectId) {
    toast.add({
      title: "Cannot export",
      description: "Project context is missing.",
      color: "red",
    });
    return;
  }

  isExporting.value = true;
  try {
    const blob = (await $fetch("/panel/boq-bom/ftth/v2/generate-boq-bom", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: {
        project_id: projectId,
        manual_input: analysisStore.boqBomManualInput,
        download: "excel",
      },
      responseType: "blob",
    })) as Blob;

    const url = URL.createObjectURL(
      new Blob([blob], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
    const a = document.createElement("a");
    const projectName = analysisStore.ftthAnalysisProjectName || projectId;
    a.href = url;
    a.download = `BOQ_BOM_${projectName}_${Date.now()}.xlsx`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch (error) {
    console.error("Export error:", error);
    toast.add({
      title: "Export failed",
      description: "Could not download the Excel report.",
      color: "red",
    });
  } finally {
    isExporting.value = false;
  }
};

const closeModal = () => {
  isOpen.value = false;
};
</script>

<template>
  <UModal v-model="isOpen" fullscreen prevent-close>
    <UCard
      :ui="{
        base: 'h-full flex flex-col',
        rounded: '',
        divide: '',
        body: {
          base: 'flex-1 overflow-hidden p-0',
          padding: 'px-0 py-0 sm:p-0',
        },
        header: {
          base: 'border-b border-gray-200',
          padding: 'px-6 py-4',
        },
      }"
    >
      <!-- Modal Header -->
      <template #header>
        <div class="flex items-center justify-between w-full">
          <!-- Title -->
          <div class="flex items-center gap-4">
            <UButton
              icon="i-heroicons-x-mark-20-solid"
              color="gray"
              variant="ghost"
              size="sm"
              @click="closeModal"
              :ui="{ padding: { sm: 'p-1.5' } }"
            />
            <div>
              <h2 class="text-xl font-semibold text-gray-900">
                Internet Aerial Cabling BOQ/BOM Estimator
              </h2>
            </div>
          </div>

          <!-- Export Button -->
          <UButton
            color="gray"
            variant="outline"
            size="md"
            :loading="isExporting"
            :disabled="isExporting"
            @click="handleExport"
            :ui="{ rounded: 'rounded-xs' }"
          >
            <template #leading>
              <UIcon
                name="i-heroicons-arrow-down-tray-20-solid"
                class="w-4 h-4"
              />
            </template>
            {{ isExporting ? "Generating..." : "Export Calculation Report" }}
          </UButton>
        </div>
      </template>

      <!-- Modal Body with Sidebar -->
      <div class="flex h-full overflow-hidden">
        <!-- Left Sidebar Navigation -->
        <div class="w-80 border-r border-gray-200 flex-shrink-0">
          <nav class="p-4 space-y-2">
            <button
              v-for="item in menuItems"
              :key="item.key"
              @click="activeSection = item.key as any"
              :class="[
                'w-full text-left px-4 py-3 rounded-xs text-sm font-medium transition-colors flex items-center gap-2',
                activeSection === item.key
                  ? 'bg-brand-500 text-white'
                  : 'text-gray-700 hover:bg-brand-500/10',
              ]"
            >
              <UIcon :name="item.icon" class="w-4 h-4" />
              {{ item.label }}
            </button>
          </nav>
        </div>

        <!-- Main Content Area -->
        <div class="flex-1 overflow-y-auto bg-gray-50">
          <div class="p-8">
            <!-- Executive Summary Section -->
            <div v-if="activeSection === 'summary'" class="space-y-6">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="text-2xl font-semibold text-gray-900 mb-2">
                    Executive Summary
                  </h3>
                  <p class="text-sm text-gray-600">
                    High-level totals and KPIs per category.
                  </p>
                </div>
                <UBadge
                  :color="isPriceDefault ? 'blue' : 'green'"
                  variant="subtle"
                  size="lg"
                >
                  {{ isPriceDefault ? "Default Price" : "Defined Cost" }}
                </UBadge>
              </div>

              <!-- Total Cost banner -->
              <div
                v-if="boqData"
                class="bg-gradient-to-br from-brand-50 to-brand-100 rounded-xs p-6 border border-brand-200"
              >
                <p class="text-sm text-gray-700 mb-2">
                  Total Estimated Project Cost
                </p>
                <p class="text-3xl font-bold text-gray-900">
                  {{ formatCurrency(totalCost) }}
                </p>
              </div>

              <!-- Per-category summary cards -->
              <div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div
                  v-for="category in boqCategories"
                  :key="`exec-${category.key}`"
                  class="rounded-xs border border-gray-200 bg-white overflow-hidden"
                >
                  <div
                    class="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between"
                  >
                    <p class="text-sm font-semibold text-gray-900">
                      {{ category.group_name }}
                    </p>
                    <p class="text-sm font-semibold text-brand-600">
                      {{ formatCurrency(Number(category.group_total) || 0) }}
                    </p>
                  </div>
                  <div class="divide-y divide-gray-100">
                    <div
                      v-for="(entry, idx) in summaryEntriesOf(category)"
                      :key="`${category.key}-exec-${idx}`"
                      class="px-5 py-2.5 flex items-center justify-between text-sm"
                    >
                      <span class="text-gray-600">{{ entry.label }}</span>
                      <span class="text-gray-900 font-medium">
                        {{ entry.value }}
                        {{ entry.label === "Panjang Kabel" ? "m" : "" }}
                      </span>
                    </div>
                    <div
                      v-if="summaryEntriesOf(category).length === 0"
                      class="px-5 py-4 text-xs text-gray-500 text-center"
                    >
                      No summary data
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <!-- BOQ Detail Section -->
            <div v-else-if="activeSection === 'detail'" class="space-y-6">
              <div class="flex items-center justify-between">
                <div>
                  <h3 class="text-2xl font-semibold text-gray-900 mb-2">
                    Estimated BOQ / BOM
                  </h3>
                  <p class="text-sm text-gray-600">
                    Detailed breakdown of quantities and costs for the project.
                  </p>
                </div>
                <UBadge
                  :color="isPriceDefault ? 'blue' : 'green'"
                  variant="subtle"
                  size="lg"
                >
                  {{ isPriceDefault ? "Default Price" : "Defined Cost" }}
                </UBadge>
              </div>

              <!-- Project Info -->
              <div class="rounded-xs p-6 border border-gray-200">
                <!-- <div class="grid grid-cols-3 gap-6 mb-4">
                  <div>
                    <p class="text-xs text-gray-600">Analysis Type</p>
                    <p class="text-sm font-medium text-gray-900 mt-1">
                      {{ analysisType || "Draw Polygon" }}
                    </p>
                  </div>
                  <div>
                    <p class="text-xs text-gray-600">Route Distance</p>
                    <p class="text-sm font-medium text-gray-900 mt-1">
                      {{ (routeDistance / 1000).toFixed(2) }} km
                    </p>
                  </div>
                  <div>
                    <p class="text-xs text-gray-600">Number of Points</p>
                    <p class="text-sm font-medium text-gray-900 mt-1">
                      {{ pointsCount }}
                    </p>
                  </div>
                </div> -->

                <!-- Total Cost -->
                <div
                  v-if="boqData"
                  class="bg-gradient-to-br from-brand-50 to-brand-100 rounded-xs p-6 border border-brand-200"
                >
                  <p class="text-sm text-gray-700 mb-2">
                    Total Estimated Project Cost
                  </p>
                  <p class="text-3xl font-bold text-gray-900">
                    {{ formatCurrency(totalCost) }}
                  </p>
                </div>
              </div>

              <!-- BOQ Tables grouped by category and group -->
              <div class="space-y-6">
                <div
                  v-for="category in boqCategories"
                  :key="category.key"
                  class="rounded-xs border border-gray-200"
                >
                  <div
                    class="px-6 pt-3 bg-gray-50 rounded-xs border-gray-200 flex items-center justify-between"
                  >
                    <div>
                      <p class="text-md font-semibold text-gray-900">
                        {{ category.group_name }}
                      </p>
                    </div>
                    <p class="text-md font-semibold text-brand-600">
                      {{ formatCurrency(Number(category.group_total) || 0) }}
                    </p>
                  </div>

                  <div class="p-4 space-y-4 bg-gray-50/50">
                    <div
                      v-for="group in category.groups"
                      :key="`${category.key}-${group.name}`"
                      class="rounded-xs border border-gray-200 bg-white overflow-hidden"
                    >
                      <div
                        class="px-6 py-3 bg-white flex items-center justify-between border-b border-gray-200"
                      >
                        <p
                          class="text-xs font-semibold text-gray-700 uppercase"
                        >
                          {{ group.name }}
                        </p>
                        <p class="text-xs text-gray-700">
                          {{ formatCurrency(Number(group.total) || 0) }}
                        </p>
                      </div>
                      <div class="overflow-x-auto">
                        <table class="min-w-full divide-y divide-gray-200">
                          <thead class="bg-gray-50">
                            <tr>
                              <th
                                scope="col"
                                class="px-6 py-3 text-left text-xs font-semibold text-gray-900 uppercase tracking-wider"
                              >
                                Item
                              </th>
                              <th
                                scope="col"
                                class="px-6 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wider"
                              >
                                Quantity
                              </th>
                              <th
                                scope="col"
                                class="px-6 py-3 text-center text-xs font-semibold text-gray-900 uppercase tracking-wider"
                              >
                                Unit
                              </th>
                              <th
                                scope="col"
                                class="px-6 py-3 text-right text-xs font-semibold text-gray-900 uppercase tracking-wider"
                              >
                                Unit Cost
                              </th>
                              <th
                                scope="col"
                                class="px-6 py-3 text-right text-xs font-semibold text-gray-900 uppercase tracking-wider"
                              >
                                Total Cost
                              </th>
                            </tr>
                          </thead>
                          <tbody class="divide-y divide-gray-200">
                            <tr
                              v-for="(row, index) in group.rows"
                              :key="`${category.key}-${group.name}-${row.code}-${index}`"
                              class="hover:bg-gray-50 transition-colors"
                            >
                              <td class="px-6 py-4 text-sm text-gray-900">
                                <div>{{ row.description || row.code }}</div>
                                <div class="text-xs text-gray-500">
                                  {{ row.code }}
                                </div>
                              </td>
                              <td
                                class="px-6 py-4 text-sm text-gray-900 text-center"
                              >
                                {{ formatNumber(Number(row.qty) || 0) }}
                              </td>
                              <td
                                class="px-6 py-4 text-sm text-gray-600 text-center"
                              >
                                {{ row.uom }}
                              </td>
                              <td
                                class="px-6 py-4 text-sm text-gray-900 text-right"
                              >
                                {{ formatCurrency(Number(row.price) || 0) }}
                              </td>
                              <td
                                class="px-6 py-4 text-sm font-medium text-gray-900 text-right"
                              >
                                {{ formatCurrency(Number(row.total) || 0) }}
                              </td>
                            </tr>
                            <tr v-if="!group.rows || group.rows.length === 0">
                              <td
                                colspan="5"
                                class="px-6 py-4 text-sm text-gray-500 text-center"
                              >
                                No items
                              </td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Grand total -->
              <div
                v-if="boqCategories.length > 0"
                class="rounded-xs border border-gray-200 px-6 py-4 flex items-center justify-between bg-gray-50"
              >
                <p class="text-sm font-semibold text-gray-900">
                  Total Project Cost
                </p>
                <p class="text-sm font-bold text-brand-600">
                  {{ formatCurrency(totalCost) }}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </UCard>
  </UModal>
</template>
