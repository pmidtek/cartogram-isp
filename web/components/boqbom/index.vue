<script setup lang="ts">
import { useQuery, useQueryClient } from "@tanstack/vue-query";
import { reactive, watch } from "vue";
import IcSpinner from "~/assets/icons/ic-spinner.svg";

const analysisStore = useAnalysisResult();

const emit = defineEmits(["close"]);

const authStore = useAuth();
const toast = useToast();
const queryClient = useQueryClient();
const toolsStore = useMapTools();
const { showCard, showTools } = storeToRefs(toolsStore);

// Multi-step state
const currentStep = ref<"method" | "pricing">("method");
const selectedMethod = ref<String>("");

// Calculation method options
const calculationMethods = [
  {
    value: "ftth",
    label: "FTTH Analysis",
    description:
      "Calculate BOQ/BOM based on existing FTTH network analysis results",
    icon: "i-heroicons-signal",
    color: "blue",
  },
  {
    value: "draw_polygon",
    label: "Draw Polygon",
    description:
      "Draw a custom polygon area on the map to define calculation boundary",
    icon: "i-heroicons-pencil-square",
    color: "green",
  },
  {
    value: "selection_polygon",
    label: "Selection Polygon",
    description:
      "Select from existing polygon layers to define calculation area",
    icon: "i-heroicons-cursor-arrow-rays",
    color: "purple",
  },
];

// Toggle between default and custom mode
const isCustomMode = ref(false);

const closeModal = () => {
  emit("close");
};

// Handle method selection and move to next step
const handleMethodSelect = (method: String) => {
  selectedMethod.value = method;
  analysisStore.setBoqBom(method);
};

const proceedToPricing = () => {
  if (!selectedMethod.value) {
    toast.add({
      title: "Selection Required",
      description: "Please select a calculation method to continue",
      icon: "i-heroicons-exclamation-triangle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-yellow-500",
      },
    });
    return;
  }
  currentStep.value = "pricing";
};

const backToMethodSelection = () => {
  currentStep.value = "method";
};

// Fetch price list from API based on mode
const {
  data: priceList,
  isLoading,
  isError,
  refetch,
} = useQuery({
  queryKey: computed(() => ["boq-bom-price-list", isCustomMode.value]),
  queryFn: async () => {
    let endpoint = "";

    if (isCustomMode.value) {
      // Fetch custom/user prices
      endpoint = "/panel/boq-bom/my-price-list";
    } else {
      // Fetch default prices
      endpoint =
        "/panel/items/boq_bom_price?filter[type][_eq]=default&fields=id,asset_type_id.id,asset_type_id.name,price";
    }

    const res = await $fetch<any>(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    return res.data;
  },
});

// Form data - dynamically populated from API
const formData = reactive<Record<number, number>>({});

// handle calculate (show toolcard hide tools)

const handleCalculate = () => {
  emit("close");

  // Set price mode
  if (isCustomMode.value) {
    analysisStore.setPriceNotDefault();
  }

  // Route to appropriate tool based on selected method
  if (selectedMethod.value === "draw_polygon") {
    // Activate draw polygon tool
    showCard.value = true;
    showTools.value = false;
    analysisStore.setBoqBomToolActive("draw_polygon");
  } else if (selectedMethod.value === "selection_polygon") {
    // Activate selection polygon tool
    showCard.value = true;
    showTools.value = false;
    analysisStore.setBoqBomToolActive("selection_polygon");
  } else if (selectedMethod.value === "ftth") {
    // For FTTH, show result directly
    showTools.value = false;
    showCard.value = true;
    analysisStore.setBoqBomToolActive("ftth");

    toast.add({
      title: "Processing FTTH Analysis",
      description: "Calculating BOQ/BOM from FTTH analysis results...",
      icon: "i-heroicons-cpu-chip",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
  }
};

// Initialize form data when price list is loaded
watch(
  priceList,
  (newPriceList) => {
    if (newPriceList && newPriceList.length > 0) {
      newPriceList.forEach((item: any) => {
        formData[item.id] = parseFloat(item.price);
      });
    }
  },
  { immediate: true }
);

const handleSave = async () => {
  try {
    // Prepare body in the required format
    const body = Object.entries(formData).map(([id, price]) => ({
      id: parseInt(id),
      price: (price as number).toFixed(2),
    }));

    await $fetch("/panel/boq-bom/my-price-list", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    // Invalidate query to refetch the updated data
    await queryClient.invalidateQueries({
      queryKey: ["boq-bom-price-list"],
    });

    toast.add({
      title: "Success",
      description: "Price list updated successfully",
      icon: "i-heroicons-check-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-green-500",
      },
    });
  } catch (error) {
    console.error("Save error:", error);
    toast.add({
      title: "Error",
      description: "Failed to update price list",
      icon: "i-heroicons-x-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-red-500",
      },
    });
  }
};
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
      <div class="space-y-3 py-3">
        <!-- Step 1: Method Selection Header -->
        <div
          v-if="currentStep === 'method'"
          class="flex items-center justify-between"
        >
          <div>
            <p class="text-[16px] font-semibold text-grey-900">
              Select Calculation Method
            </p>
            <p class="text-xs text-grey-600 mt-1">
              Choose how you want to define the area for BOQ/BOM calculation
            </p>
          </div>
          <UButton
            variant="ghost"
            icon="i-line-md:close"
            color="gray"
            size="lg"
            :ui="{
              icon: {
                base: 'text-gray-300',
              },
            }"
            @click="closeModal"
          />
        </div>

        <!-- Step 2: Pricing Header -->
        <div v-else class="space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center gap-3">
              <UButton
                variant="ghost"
                icon="i-heroicons-arrow-left"
                color="gray"
                size="sm"
                @click="backToMethodSelection"
              />
              <div>
                <p class="text-[16px] font-semibold text-grey-900">
                  Customize Unit Cost (IDR)
                </p>
                <p class="text-xs text-grey-600 mt-1">
                  Set custom unit prices for materials to calculate project
                  costs
                </p>
              </div>
            </div>
            <UButton
              variant="ghost"
              icon="i-line-md:close"
              color="gray"
              size="lg"
              :ui="{
                icon: {
                  base: 'text-gray-300',
                },
              }"
              @click="closeModal"
            />
          </div>

          <!-- Toggle Switch -->
          <div
            class="flex items-center justify-between pt-2 border-t border-grey-200"
          >
            <div class="flex items-center gap-3">
              <span class="text-sm font-medium text-grey-700">Default</span>
              <UToggle
                v-model="isCustomMode"
                size="md"
                :ui="{
                  active: 'bg-brand-500',
                  inactive: 'bg-grey-300',
                }"
              />
              <span class="text-sm font-medium text-grey-700">Define Cost</span>
            </div>
            <p class="text-xs text-grey-500">
              {{
                isCustomMode
                  ? "Custom pricing enabled - You can edit and save"
                  : "Using default prices - Read only"
              }}
            </p>
          </div>
        </div>
      </div>
    </template>

    <div class="py-3">
      <!-- Step 1: Method Selection -->
      <div v-if="currentStep === 'method'" class="space-y-4">
        <!-- Method Cards Grid -->
        <div class="grid grid-cols-1 gap-3">
          <button
            v-for="method in calculationMethods"
            :key="method.value"
            @click="handleMethodSelect(method.value)"
            :class="[
              'group relative p-4 rounded-lg border-2 transition-all duration-200 text-left',
              selectedMethod === method.value
                ? 'border-brand-500 bg-brand-50 shadow-md'
                : 'border-grey-200 bg-white hover:border-brand-300 hover:bg-brand-25',
            ]"
          >
            <div class="flex items-start gap-4">
              <!-- Icon -->
              <div
                :class="[
                  'flex-shrink-0 w-12 h-12 rounded-lg flex items-center justify-center transition-colors',
                  selectedMethod === method.value
                    ? 'bg-brand-100'
                    : 'bg-grey-100 group-hover:bg-brand-100',
                ]"
              >
                <UIcon
                  :name="method.icon"
                  :class="[
                    'w-6 h-6 transition-colors',
                    selectedMethod === method.value
                      ? 'text-brand-600'
                      : 'text-grey-600 group-hover:text-brand-600',
                  ]"
                />
              </div>

              <!-- Content -->
              <div class="flex-1 min-w-0">
                <div class="flex items-center justify-between mb-1">
                  <h3
                    :class="[
                      'text-sm font-semibold transition-colors',
                      selectedMethod === method.value
                        ? 'text-brand-700'
                        : 'text-grey-900 group-hover:text-brand-700',
                    ]"
                  >
                    {{ method.label }}
                  </h3>
                  <!-- Check Icon -->
                  <div
                    v-if="selectedMethod === method.value"
                    class="flex-shrink-0 w-5 h-5 bg-brand-500 rounded-full flex items-center justify-center"
                  >
                    <UIcon
                      name="i-heroicons-check"
                      class="w-3 h-3 text-white"
                    />
                  </div>
                </div>
                <p class="text-xs text-grey-600 leading-relaxed">
                  {{ method.description }}
                </p>
              </div>
            </div>
          </button>
        </div>

        <!-- Info Banner -->
        <div class="mt-6 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div class="flex gap-3">
            <UIcon
              name="i-heroicons-information-circle"
              class="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5"
            />
            <div>
              <p class="text-xs font-medium text-blue-900 mb-1">
                Selection Guide
              </p>
              <ul class="text-xs text-blue-700 space-y-1">
                <li>
                  <strong>FTTH Analysis:</strong> Uses your previous network
                  analysis results
                </li>
                <li>
                  <strong>Draw Polygon:</strong> Manually draw area boundaries
                  on the map
                </li>
                <li>
                  <strong>Selection Polygon:</strong> Choose from pre-existing
                  area layers
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>

      <!-- Step 2: Pricing Configuration -->
      <div v-else>
        <!-- Loading State -->
        <div v-if="isLoading" class="flex items-center justify-center py-8">
          <div class="flex items-center gap-2">
            <IcSpinner class="animate-spin h-5 w-5 text-gray-500" />
            <span class="text-sm text-gray-600">Loading price list...</span>
          </div>
        </div>

        <!-- Error State -->
        <div
          v-else-if="isError"
          class="flex flex-col items-center justify-center py-8"
        >
          <svg
            class="w-12 h-12 text-red-400 mb-3"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              stroke-width="2"
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <p class="text-sm text-gray-600">Failed to load price list</p>
        </div>

        <!-- Form Fields -->
        <div
          v-else-if="priceList && priceList.length > 0"
          class="grid grid-cols-3 gap-4"
        >
          <div v-for="item in priceList" :key="item.id">
            <label class="block text-sm font-medium text-gray-700 mb-1">
              {{ item.asset_type_id.name }}:
            </label>
            <UInput
              v-model.number="formData[item.id]"
              type="number"
              step="0.01"
              :disabled="!isCustomMode"
              :ui="{
                rounded: 'rounded-xxs',
                color: {
                  gray: {
                    outline: !isCustomMode ? 'bg-grey-100' : '',
                  },
                },
              }"
            />
          </div>
        </div>

        <!-- Empty State -->
        <div v-else class="flex flex-col items-center justify-center py-8">
          <p class="text-sm text-gray-600">No price items available</p>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="flex items-center justify-end pt-3 gap-2">
        <!-- Step 1: Method Selection Footer -->
        <template v-if="currentStep === 'method'">
          <UButton
            :ui="{ rounded: 'rounded-xxs' }"
            size="lg"
            variant="outline"
            color="gray"
            label="Cancel"
            @click="closeModal"
          />
          <UButton
            :ui="{ rounded: 'rounded-xxs' }"
            variant="solid"
            label="Continue"
            size="lg"
            icon="i-heroicons-arrow-right"
            trailing
            :disabled="!selectedMethod"
            @click="proceedToPricing"
          />
        </template>

        <!-- Step 2: Pricing Footer -->
        <template v-else>
          <UButton
            :ui="{ rounded: 'rounded-xxs' }"
            size="lg"
            variant="outline"
            color="gray"
            label="Cancel"
            @click="closeModal"
          />
          <UButton
            :ui="{ rounded: 'rounded-xxs' }"
            variant="solid"
            label="Calculate"
            size="lg"
            @click="handleCalculate"
          />
          <UButton
            :ui="{ rounded: 'rounded-xxs' }"
            variant="solid"
            label="Save Data"
            size="lg"
            :disabled="isLoading || !isCustomMode"
            @click="handleSave"
          />
        </template>
      </div>
    </template>
  </UCard>
</template>
