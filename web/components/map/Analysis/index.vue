<script lang="ts" setup>
import IcArrowLeft from "~/assets/icons/ic-arrow-left.svg";
import IcSpinner from "~/assets/icons/ic-spinner.svg";

const featureStore = useFeature();
const closeAnalytic = () => {
  featureStore.setMapInfo("");
};

const analysisStore = useAnalysisResult();
const digitizeStore = useDigitizeStore();
const authStore = useAuth();
const toast = useToast();
const manualAdd = useFtthManualAdd();
const { refreshAllProjectLayers } = useFtthProjectLayers();

// === Manual add (Tambah) ===
const refreshing = ref(false);

const addPanelTitle = computed(() => {
  switch (manualAdd.addPanel) {
    case "menu":
      return "Tambah";
    case "site_point":
      return "Tambah Site Point";
    case "route":
      return "Tambah Route";
    case "cable":
      return "Tambah Cable";
    case "asset":
      return "Tambah Asset";
    default:
      return "";
  }
});

const backFromAdd = () => {
  if (manualAdd.addPanel === "menu") manualAdd.closePanel();
  else manualAdd.openPanel("menu");
};

// Re-fetch the project summary (counts) after manual additions.
const refreshSummary = async (pid: number) => {
  try {
    const response = await $fetch<any>(`/panel/project-map/info/${pid}`, {
      headers: { Authorization: `Bearer ${authStore.accessToken}` },
    });
    analysisStore.setFtthAnalysisData(
      response.data,
      pid,
      analysisStore.ftthAnalysisProjectName,
    );
  } catch (e) {
    console.error("Failed to refresh project summary:", e);
  }
};

// "Selesai" — refresh map layers + network summary, then back to summary view.
const finishManual = async () => {
  const pid = analysisStore.ftthAnalysisProjectId;
  if (!pid) return;
  refreshing.value = true;
  try {
    await refreshAllProjectLayers(pid);
    await refreshSummary(pid);
    toast.add({
      title: "Project diperbarui",
      description: "Visual map & network summary ter-update.",
      icon: "i-heroicons-check-circle",
      color: "green",
      ui: { background: "bg-white", title: "text-grey-800" },
    });
    manualAdd.resetCount();
    manualAdd.closePanel();
  } finally {
    refreshing.value = false;
  }
};

// Reset add state when the active FTTH project changes.
watch(
  () => analysisStore.ftthAnalysisProjectId,
  (id) => {
    manualAdd.setProject(id ?? null);
  },
  { immediate: true },
);

// Price modal state
const showPriceModal = ref(false);
const isCustomMode = ref(false);
const loadingPriceList = ref(false);
const savingPriceList = ref(false);
const priceList = ref<any[]>([]);
const formData = reactive<Record<number, number>>({});

// Two-step flow: 'price' (Step 1) -> 'manual' (Step 2)
const currentStep = ref<"price" | "manual">("price");

// Fixed schema of codes the backend expects in `manual_input`.
const MANUAL_INPUT_SCHEMA = {
  material: {
    feeder: [
      "M-PC-F-SMSCLC/U-DX3M",
      "M-PC-F-SMSCLC/U-DX5M",
      "M-PC-F-SMSCLC/U-DX10M",
      "M-HDPE-F-40/33MM",
    ],
  },
  homepass: {
    add_on_services: [
      "S-PMT-AO-CND",
      "S-AQS-AO",
      "S-TRP-AO",
      "S-HB-AO",
      "S-DOC-AO",
      "S-OPTRCND-AO-0.4",
      "S-SRCND-AO",
      "S-IPCLCND-AO",
      "S-IFCCND-AO",
      "S-IPVCCND-AO",
      "S-IPRBSCND-AO",
      "S-HDPE-AO-40/33/1P",
      "S-HDPE-AO-40/33/2P",
      "S-HDPE-AO-50/42/1P",
      "S-HDPE-AO-50/42/2P",
      "S-BC-AO-1.5-40/33",
    ],
    add_on_material: [
      "M-PL-AO-9M",
      "M-HDPECND-AO-40/30MM",
      "M-PCLCND-AO-4M/2",
      "M-FCCND-AO-W",
      "M-SPCND-AO",
      "M-CPCND-AO",
      "M-FSCND-AO",
      "M-PGLCND-AO-6M/2IN",
      "M-CGLCND-AO-2IN",
      "M-DYBCND-AO-10MM",
      "M-DYBCND-AO-12MM",
    ],
  },
};

const ALL_MANUAL_CODES: string[] = [
  ...MANUAL_INPUT_SCHEMA.material.feeder,
  ...MANUAL_INPUT_SCHEMA.homepass.add_on_services,
  ...MANUAL_INPUT_SCHEMA.homepass.add_on_material,
];

const manualQty = reactive<Record<string, number>>({});
const homepassDesc = reactive({ site: 1, timeline: 1, term_of_payment: 1 });
const homeconnectDesc = reactive({
  site: 1,
  timeline: 1,
  term_of_payment: 1,
});

// Codes that default to 1; every other code defaults to 0.
const DEFAULT_ONE_CODES = ["S-TRP-AO", "S-HB-AO", "S-DOC-AO"];

const resetManualInput = () => {
  ALL_MANUAL_CODES.forEach((code) => {
    manualQty[code] = DEFAULT_ONE_CODES.includes(code) ? 1 : 0;
  });
  homepassDesc.site = 1;
  homepassDesc.timeline = 1;
  homepassDesc.term_of_payment = 1;
  homeconnectDesc.site = 1;
  homeconnectDesc.timeline = 1;
  homeconnectDesc.term_of_payment = 1;
};

const loadingBoqBom = ref(false);
const downloadingKml = ref(false);

async function downloadKml() {
  const projectId = analysisStore.ftthAnalysisProjectId;
  if (!projectId) return;
  downloadingKml.value = true;
  try {
    const res = await $fetch(`/panel/data/ftth-project/export-kml`, {
      params: { project_id: projectId },
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      responseType: "blob",
    });
    const blob = new Blob([res as BlobPart], {
      type: "application/vnd.google-earth.kml+xml",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${analysisStore.ftthAnalysisProjectName || "ftth-project"}.kml`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  } catch (e) {
    console.error("Failed to download KML:", e);
    toast.add({
      title: "Error",
      description: "Failed to download KML",
      color: "red",
    });
  } finally {
    downloadingKml.value = false;
  }
}

// Open price modal when clicking "Analysis BOQ & BOM"
const openPriceModal = () => {
  showPriceModal.value = true;
  isCustomMode.value = false;
  currentStep.value = "price";
  resetManualInput();
  fetchPriceList();
};

// Fetch price list
const fetchPriceList = async () => {
  loadingPriceList.value = true;
  try {
    let endpoint = "";
    if (isCustomMode.value) {
      endpoint = "/panel/boq-bom/ftth/my-price-list";
    } else {
      endpoint =
        "/panel/items/boq_bom_price_default?fields=id,code,description,uom,price_rp,category";
    }

    const res = await $fetch<any>(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    });
    priceList.value = res.data || [];

    // Initialize form data — supports both old (price) and new (price_rp) shapes.
    Object.keys(formData).forEach((key) => delete formData[Number(key)]);
    priceList.value.forEach((item: any) => {
      const raw = item.price_rp ?? item.price ?? 0;
      formData[item.id] = parseFloat(raw);
    });
  } catch (error) {
    console.error("Failed to fetch price list:", error);
    toast.add({
      title: "Error",
      description: "Failed to load price list",
      color: "red",
    });
  } finally {
    loadingPriceList.value = false;
  }
};

// Watch custom mode toggle to refetch
watch(isCustomMode, () => {
  fetchPriceList();
});

// Save custom prices
const handleSavePrices = async () => {
  savingPriceList.value = true;
  try {
    const body = Object.entries(formData).map(([id, price]) => ({
      id: parseInt(id),
      price: (price as number).toFixed(2),
    }));

    await $fetch("/panel/boq-bom/ftth/my-price-list", {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body,
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
      color: "red",
    });
  } finally {
    savingPriceList.value = false;
  }
};

// Calculate BOQ & BOM
const handleCalculate = async () => {
  const projectId = analysisStore.ftthAnalysisProjectId;
  if (!projectId) return;

  showPriceModal.value = false;
  loadingBoqBom.value = true;

  try {
    const manualInput = buildManualInput();
    analysisStore.setBoqBomManualInput(manualInput);
    await patchManualInput();
    const response = await $fetch<any>(
      "/panel/boq-bom/ftth/v2/generate-boq-bom",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authStore.accessToken}`,
        },
        body: {
          project_id: projectId,
          manual_input: manualInput,
        },
      },
    );

    if (response.data) {
      analysisStore.setBoqBomAnalysisData(response.data);
      analysisStore.setCurrentAnalysisType("boq_bom_analysis");
    }
  } catch (error) {
    console.error("Error generating BOQ & BOM:", error);
    toast.add({
      title: "Error",
      description: "Failed to generate BOQ & BOM analysis",
      color: "red",
    });
  } finally {
    loadingBoqBom.value = false;
  }
};

const goNextStep = () => {
  currentStep.value = "manual";
};
const goBackStep = () => {
  currentStep.value = "price";
};

// Group price list by category (new shape) with fallback to item_type_name (old shape).
const groupedPriceList = computed(() => {
  const groups: Record<string, any[]> = {};
  priceList.value.forEach((item: any) => {
    const key = item.category || item.item_type_name || "Other";
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  });
  return groups;
});

// O(1) lookup of price list rows by code.
const priceByCode = computed(() => {
  const m = new Map<string, any>();
  priceList.value.forEach((p: any) => {
    if (p?.code) m.set(p.code, p);
  });
  return m;
});

// Effective unit price: when in custom mode, prefer the user-edited formData value.
const effectivePrice = (item: any): number => {
  if (!item) return 0;
  const custom = formData[item.id];
  if (
    isCustomMode.value &&
    typeof custom === "number" &&
    !Number.isNaN(custom)
  ) {
    return custom;
  }
  return Number(item.price_rp ?? item.price ?? custom ?? 0) || 0;
};

const lineTotal = (code: string): number => {
  const item = priceByCode.value.get(code);
  const qty = Number(manualQty[code]) || 0;
  return effectivePrice(item) * qty;
};

const manualInputTotal = computed(() =>
  ALL_MANUAL_CODES.reduce((sum, c) => sum + lineTotal(c), 0),
);

const formatCurrency = (value: number) =>
  `IDR ${new Intl.NumberFormat("en-US").format(value || 0)}`;

const buildManualInput = () => {
  const map = (codes: string[]) =>
    Object.fromEntries(codes.map((c) => [c, Number(manualQty[c]) || 0]));

  return {
    material: {
      feeder: map(MANUAL_INPUT_SCHEMA.material.feeder),
    },
    homepass: {
      description: { ...homepassDesc },
      add_on_services: map(MANUAL_INPUT_SCHEMA.homepass.add_on_services),
      add_on_material: map(MANUAL_INPUT_SCHEMA.homepass.add_on_material),
    },
    homeconnect: {
      description: { ...homeconnectDesc },
    },
  };
};

// Persist manual_input to project_map record. Debounced via the watcher below;
// also called explicitly before Calculate to guarantee the latest values are saved.
let patchAbortCtrl: AbortController | null = null;
let patchTimer: ReturnType<typeof setTimeout> | null = null;

async function patchManualInput() {
  const projectId = analysisStore.ftthAnalysisProjectId;
  if (!projectId) return;

  patchAbortCtrl?.abort();
  patchAbortCtrl = new AbortController();

  try {
    await $fetch(`/panel/items/project_map/${projectId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
      body: { manual_input: buildManualInput() },
      signal: patchAbortCtrl.signal,
    });
  } catch (e: any) {
    if (e?.name === "AbortError") return;
    toast.add({
      title: "Save failed",
      description: "Could not save manual input. It will retry on next edit.",
      color: "red",
      icon: "i-heroicons-exclamation-circle",
    });
  }
}

watch(
  [manualQty, homepassDesc, homeconnectDesc],
  () => {
    if (!showPriceModal.value) return;
    if (!analysisStore.ftthAnalysisProjectId) return;
    if (patchTimer) clearTimeout(patchTimer);
    patchTimer = setTimeout(patchManualInput, 800);
  },
  { deep: true },
);

watch(showPriceModal, (isOpen) => {
  if (!isOpen && patchTimer) {
    // Drop the queued debounced PATCH so an unsubmitted intermediate value
    // isn't persisted just because the user closed the modal.
    // (In-flight PATCHes are left alone — Calculate may have triggered one.)
    clearTimeout(patchTimer);
    patchTimer = null;
  }
});
</script>

<template>
  <div class="flex justify-between items-center m-3">
    <div v-if="analysisStore.currentAnalysisType !== 'ftth_analysis'">
      <h2 class="text-grey-900">Analysis Result</h2>
      <p class="text-[10px] font-raleway text-grey-600">
        Buffer Analysis Result based on Analytic Tools
      </p>
    </div>
    <div v-else>
      <h2 class="text-grey-900 font-semibold">Network Summary</h2>
      <p class="text-grey700 text-[12px]">
        Project {{ analysisStore.ftthAnalysisProjectName }}
      </p>
    </div>
    <IcArrowLeft
      role="button"
      @click="closeAnalytic"
      :fontControlled="false"
      class="w-3 h-3 rotate-180 text-grey-900"
    />
  </div>
  <hr class="mx-3" />
  <div class="flex-1 overflow-y-auto px-3 py-1 space-y-2">
    <!-- Empty State -->
    <div
      v-if="!analysisStore.currentAnalysisType"
      class="flex flex-col items-center justify-center h-full py-8 px-4"
    >
      <div class="text-center space-y-3">
        <div
          class="w-16 h-16 mx-auto bg-grey-100 rounded-full flex items-center justify-center"
        >
          <svg
            class="w-8 h-8 text-grey-400"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
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
          <h3 class="text-sm font-semibold text-grey-900">No Analysis Yet</h3>
          <p class="text-xs text-grey-600 mt-1 font-raleway">
            Run an analysis tool to see results here
          </p>
        </div>
      </div>
    </div>

    <!-- Analysis Results -->
    <MapAnalysisBufferAnalysis
      v-if="analysisStore.currentAnalysisType === 'fwa_analysis'"
    />
    <MapToolsPotentialAnalysis
      v-else-if="analysisStore.currentAnalysisType === 'potential_analysis'"
    />
    <MapAnalysisBoqBomResult
      v-else-if="analysisStore.currentAnalysisType === 'boq_bom_analysis'"
    />
    <MapAnalysisQuadrantBasedAnalysis
      v-else-if="
        analysisStore.currentAnalysisType === 'quadrant_based_analysis' ||
        analysisStore.currentAnalysisType === 'directional_quadrant_analysis'
      "
    />
    <MapAnalysisQmiResultAnalysis
      v-else-if="analysisStore.currentAnalysisType === 'qmi_result_analysis'"
    />
    <MapAnalysisPOIInsight
      v-else-if="analysisStore.currentAnalysisType === 'poi_insight_analysis'"
    />
    <MapAnalysisQuickRouteInsightAnalysis
      v-else-if="
        analysisStore.currentAnalysisType === 'quick_route_insight_analysis' &&
        featureStore.typeFeature !== 'market-potential'
      "
    />
    <MapAnalysisPOIRouteInsight
      v-else-if="
        analysisStore.currentAnalysisType === 'quick_route_insight_analysis' &&
        featureStore.typeFeature === 'market-potential'
      "
    />
    <MapAnalysisAntennaDirectionAnalysis
      v-else-if="
        analysisStore.currentAnalysisType === 'antenna_direction_analysis'
      "
    />
    <template
      v-else-if="analysisStore.currentAnalysisType === 'ftth_analysis'"
    >
      <MapAnalysisFtthAnalysis v-if="manualAdd.addPanel === ''" />
      <div v-else>
        <!-- Add panel header with back button -->
        <div class="flex items-center gap-2 py-1">
          <UButton
            size="2xs"
            color="gray"
            variant="ghost"
            icon="i-heroicons-arrow-left-20-solid"
            :ui="{ rounded: 'rounded-xxs' }"
            @click="backFromAdd"
          />
          <span class="text-xs font-semibold text-grey-800">
            {{ addPanelTitle }}
          </span>
        </div>
        <MapAnalysisAddMenu v-if="manualAdd.addPanel === 'menu'" />
        <MapAnalysisAddSitePoint
          v-else-if="manualAdd.addPanel === 'site_point'"
        />
        <MapAnalysisAddRoute v-else-if="manualAdd.addPanel === 'route'" />
        <MapAnalysisAddCable v-else-if="manualAdd.addPanel === 'cable'" />
        <MapAnalysisAddAsset v-else-if="manualAdd.addPanel === 'asset'" />
      </div>
    </template>
    <MapAnalysisDigitzeItem
      v-else-if="analysisStore.currentAnalysisType === 'digitize_analysis'"
      v-for="digitizedData in digitizeStore.digitizedData"
      :digtizeResult="digitizedData"
    />
  </div>

  <!-- Sticky bottom buttons -->
  <div
    v-if="analysisStore.currentAnalysisType === 'ftth_analysis'"
    class="p-3 border-t space-y-2"
  >
    <!-- Summary actions (only on summary view) -->
    <template v-if="manualAdd.addPanel === ''">
      <div class="grid grid-cols-2 gap-2">
        <UButton
          block
          icon="i-heroicons-arrow-down-tray-20-solid"
          :ui="{ rounded: 'rounded-xxs' }"
          class="justify-center"
          :loading="downloadingKml"
          @click="downloadKml"
        >
          Download KML
        </UButton>
        <UButton
          block
          icon="i-ix:analysis"
          color="primary"
          :ui="{ rounded: 'rounded-xxs' }"
          class="justify-center"
          :loading="loadingBoqBom"
          @click="openPriceModal"
        >
          Analysis BOQ & BOM
        </UButton>
      </div>
      <UButton
        block
        icon="i-heroicons-plus-20-solid"
        color="gray"
        variant="outline"
        :ui="{ rounded: 'rounded-xxs' }"
        class="justify-center"
        @click="manualAdd.openPanel('menu')"
      >
        Tambah
      </UButton>
    </template>

    <!-- Finish & refresh project (after manual additions) -->
    <UButton
      v-if="manualAdd.addedCount > 0"
      block
      color="primary"
      icon="i-heroicons-check-20-solid"
      :ui="{ rounded: 'rounded-xxs' }"
      class="justify-center"
      :loading="refreshing"
      @click="finishManual"
    >
      Selesai ({{ manualAdd.addedCount }})
    </UButton>
  </div>

  <!-- Price Modal -->
  <UModal v-model="showPriceModal" :ui="{ width: 'sm:max-w-2xl' }">
    <UCard
      :ui="{
        rounded: 'rounded-xxs',
        base: 'p-3',
        header: { padding: 'sm:p-0' },
        body: { padding: 'sm:p-0' },
        footer: { padding: 'sm:p-0' },
      }"
    >
      <template #header>
        <div class="space-y-3 py-3">
          <div class="flex items-center justify-between">
            <div>
              <p class="text-[10px] font-semibold uppercase text-brand-500">
                Step {{ currentStep === "price" ? "1" : "2" }} of 2
              </p>
              <p class="text-[16px] font-semibold text-grey-900">
                {{
                  currentStep === "price"
                    ? "Customize Unit Cost (IDR)"
                    : "Set Quantities (pcs)"
                }}
              </p>
              <p class="text-xs text-grey-600 mt-1">
                {{
                  currentStep === "price"
                    ? "Set unit prices for materials to calculate project costs"
                    : "Input the quantity for each item used in this project"
                }}
              </p>
            </div>
            <UButton
              variant="ghost"
              icon="i-line-md:close"
              color="gray"
              size="lg"
              :ui="{ icon: { base: 'text-gray-300' } }"
              @click="showPriceModal = false"
            />
          </div>
        </div>
      </template>

      <div class="py-3">
        <!-- Loading State -->
        <div
          v-if="loadingPriceList"
          class="flex items-center justify-center py-8"
        >
          <div class="flex items-center gap-2">
            <IcSpinner class="animate-spin h-5 w-5 text-gray-500" />
            <span class="text-sm text-gray-600">Loading price list...</span>
          </div>
        </div>

        <!-- ====== STEP 1: Price List ====== -->
        <div
          v-else-if="currentStep === 'price' && priceList.length > 0"
          class="space-y-4 max-h-[50vh] overflow-y-auto"
        >
          <div
            v-for="(items, groupName) in groupedPriceList"
            :key="groupName"
            class="space-y-2"
          >
            <p
              class="text-xs font-semibold text-grey-900 sticky top-0 bg-white py-1"
            >
              {{ groupName.toUpperCase() }}
            </p>
            <div class="space-y-1">
              <div
                v-for="item in items"
                :key="item.id"
                class="grid grid-cols-[2fr_1fr] gap-2 items-center p-2 rounded-xxs hover:bg-grey-50"
              >
                <div>
                  <p class="text-xs text-grey-900">
                    {{ item.description || item.item_type_group }}
                  </p>
                  <p class="text-[10px] text-grey-500">
                    {{ item.code }}
                    <span v-if="item.uom"> &middot; {{ item.uom }}</span>
                  </p>
                </div>
                <UInput
                  v-model.number="formData[item.id]"
                  type="number"
                  step="0.01"
                  size="sm"
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
          </div>
        </div>

        <!-- ====== STEP 2: Manual Input (Quantities) ====== -->
        <div
          v-else-if="currentStep === 'manual'"
          class="space-y-5 max-h-[55vh] overflow-y-auto pr-1"
        >
          <!-- Material > Feeder -->
          <div class="space-y-2">
            <p
              class="text-xs font-semibold text-grey-900 sticky top-0 bg-white py-1"
            >
              MATERIAL · FEEDER
            </p>
            <div class="space-y-1">
              <div
                v-for="code in MANUAL_INPUT_SCHEMA.material.feeder"
                :key="code"
                class="grid grid-cols-[2fr_0.7fr_1fr] gap-2 items-center p-2 rounded-xxs hover:bg-grey-50"
              >
                <div>
                  <p class="text-xs text-grey-900">
                    {{ priceByCode.get(code)?.description || code }}
                  </p>
                  <p class="text-[10px] text-grey-500">
                    {{ code }}
                    <span v-if="priceByCode.get(code)?.uom">
                      &middot; {{ priceByCode.get(code).uom }}
                    </span>
                  </p>
                </div>
                <UInput
                  v-model.number="manualQty[code]"
                  type="number"
                  min="0"
                  step="1"
                  size="sm"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
                <p class="text-xs text-grey-700 text-right">
                  {{ formatCurrency(lineTotal(code)) }}
                </p>
              </div>
            </div>
          </div>

          <!-- Homepass > description -->
          <div class="space-y-2">
            <p
              class="text-xs font-semibold text-grey-900 sticky top-0 bg-white py-1"
            >
              HOMEPASS · DESCRIPTION
            </p>
            <div class="grid grid-cols-3 gap-2">
              <div>
                <label class="text-[10px] text-grey-500 mb-1 block">Site</label>
                <UInput
                  v-model.number="homepassDesc.site"
                  type="number"
                  min="0"
                  step="1"
                  size="sm"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
              </div>
              <div>
                <label class="text-[10px] text-grey-500 mb-1 block">
                  Timeline
                </label>
                <UInput
                  v-model.number="homepassDesc.timeline"
                  type="number"
                  min="0"
                  step="1"
                  size="sm"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
              </div>
              <div>
                <label class="text-[10px] text-grey-500 mb-1 block">
                  Term of Payment
                </label>
                <UInput
                  v-model.number="homepassDesc.term_of_payment"
                  type="number"
                  min="0"
                  step="1"
                  size="sm"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
              </div>
            </div>
          </div>

          <!-- Homepass > Add-On Services -->
          <div class="space-y-2">
            <p
              class="text-xs font-semibold text-grey-900 sticky top-0 bg-white py-1"
            >
              HOMEPASS · ADD-ON SERVICES
            </p>
            <div class="space-y-1">
              <div
                v-for="code in MANUAL_INPUT_SCHEMA.homepass.add_on_services"
                :key="code"
                class="grid grid-cols-[2fr_0.7fr_1fr] gap-2 items-center p-2 rounded-xxs hover:bg-grey-50"
              >
                <div>
                  <p class="text-xs text-grey-900">
                    {{ priceByCode.get(code)?.description || code }}
                  </p>
                  <p class="text-[10px] text-grey-500">
                    {{ code }}
                    <span v-if="priceByCode.get(code)?.uom">
                      &middot; {{ priceByCode.get(code).uom }}
                    </span>
                  </p>
                </div>
                <UInput
                  v-model.number="manualQty[code]"
                  type="number"
                  min="0"
                  step="1"
                  size="sm"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
                <p class="text-xs text-grey-700 text-right">
                  {{ formatCurrency(lineTotal(code)) }}
                </p>
              </div>
            </div>
          </div>

          <!-- Homepass > Add-On Material -->
          <div class="space-y-2">
            <p
              class="text-xs font-semibold text-grey-900 sticky top-0 bg-white py-1"
            >
              HOMEPASS · ADD-ON MATERIAL
            </p>
            <div class="space-y-1">
              <div
                v-for="code in MANUAL_INPUT_SCHEMA.homepass.add_on_material"
                :key="code"
                class="grid grid-cols-[2fr_0.7fr_1fr] gap-2 items-center p-2 rounded-xxs hover:bg-grey-50"
              >
                <div>
                  <p class="text-xs text-grey-900">
                    {{ priceByCode.get(code)?.description || code }}
                  </p>
                  <p class="text-[10px] text-grey-500">
                    {{ code }}
                    <span v-if="priceByCode.get(code)?.uom">
                      &middot; {{ priceByCode.get(code).uom }}
                    </span>
                  </p>
                </div>
                <UInput
                  v-model.number="manualQty[code]"
                  type="number"
                  min="0"
                  step="1"
                  size="sm"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
                <p class="text-xs text-grey-700 text-right">
                  {{ formatCurrency(lineTotal(code)) }}
                </p>
              </div>
            </div>
          </div>

          <!-- Home Connect > description -->
          <div class="space-y-2">
            <p
              class="text-xs font-semibold text-grey-900 sticky top-0 bg-white py-1"
            >
              HOME CONNECT · DESCRIPTION
            </p>
            <div class="grid grid-cols-3 gap-2">
              <div>
                <label class="text-[10px] text-grey-500 mb-1 block">Site</label>
                <UInput
                  v-model.number="homeconnectDesc.site"
                  type="number"
                  min="0"
                  step="1"
                  size="sm"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
              </div>
              <div>
                <label class="text-[10px] text-grey-500 mb-1 block">
                  Timeline
                </label>
                <UInput
                  v-model.number="homeconnectDesc.timeline"
                  type="number"
                  min="0"
                  step="1"
                  size="sm"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
              </div>
              <div>
                <label class="text-[10px] text-grey-500 mb-1 block">
                  Term of Payment
                </label>
                <UInput
                  v-model.number="homeconnectDesc.term_of_payment"
                  type="number"
                  min="0"
                  step="1"
                  size="sm"
                  :ui="{ rounded: 'rounded-xxs' }"
                />
              </div>
            </div>
          </div>

          <!-- Live total -->
          <div
            class="sticky bottom-0 bg-brand-50 border border-brand-200 rounded-xxs px-3 py-2 flex items-center justify-between"
          >
            <span class="text-xs font-medium text-grey-700">
              Estimated Total
            </span>
            <span class="text-sm font-semibold text-brand-600">
              {{ formatCurrency(manualInputTotal) }}
            </span>
          </div>
        </div>

        <!-- Empty State -->
        <div
          v-else-if="currentStep === 'price'"
          class="flex flex-col items-center justify-center py-8"
        >
          <p class="text-sm text-gray-600">No price items available</p>
        </div>
      </div>

      <template #footer>
        <div class="flex items-center justify-between pt-3 gap-2">
          <UButton
            v-if="currentStep === 'manual'"
            :ui="{ rounded: 'rounded-xxs' }"
            size="lg"
            variant="outline"
            color="gray"
            icon="i-heroicons-arrow-left-20-solid"
            label="Back"
            @click="goBackStep"
          />
          <span v-else />

          <div class="flex items-center gap-2">
            <UButton
              :ui="{ rounded: 'rounded-xxs' }"
              size="lg"
              variant="outline"
              color="gray"
              label="Cancel"
              @click="showPriceModal = false"
            />
            <UButton
              v-if="currentStep === 'price' && isCustomMode"
              :ui="{ rounded: 'rounded-xxs' }"
              variant="solid"
              color="gray"
              label="Save Prices"
              size="lg"
              :loading="savingPriceList"
              @click="handleSavePrices"
            />
            <UButton
              v-if="currentStep === 'price'"
              :ui="{ rounded: 'rounded-xxs' }"
              variant="solid"
              label="Next"
              trailing-icon="i-heroicons-arrow-right-20-solid"
              size="lg"
              @click="goNextStep"
            />
            <UButton
              v-else
              :ui="{ rounded: 'rounded-xxs' }"
              variant="solid"
              label="Calculate"
              size="lg"
              @click="handleCalculate"
            />
          </div>
        </div>
      </template>
    </UCard>
  </UModal>
</template>
