import type { BoqBomGenerateResult } from "~/utils/types";

export interface BoqBomRequestParams {
  feeder_code: string;
  pole_code: string;
  route_length_m: number;
}

// Shared across the whole Site Points panel: generating a BOQ/BOM in one
// accordion switches the entire panel (see index.vue) into a result-only
// view, replacing the accordion list until the user goes back.
const activeOwnerId = ref<number | null>(null);
const result = ref<BoqBomGenerateResult | null>(null);
const requestParams = ref<BoqBomRequestParams | null>(null);
const isDownloading = ref(false);

export function useBoqBomResult() {
  function show(
    ownerId: number,
    value: BoqBomGenerateResult,
    params: BoqBomRequestParams,
  ) {
    activeOwnerId.value = ownerId;
    result.value = value;
    requestParams.value = params;
  }

  // Only clears if `ownerId` is still the one currently shown — protects
  // against a different accordion's own reset wiping this one's result.
  function clearIfOwner(ownerId: number) {
    if (activeOwnerId.value !== ownerId) return;
    activeOwnerId.value = null;
    result.value = null;
    requestParams.value = null;
  }

  function clear() {
    activeOwnerId.value = null;
    result.value = null;
    requestParams.value = null;
  }

  // Re-issues the same generate-boq-bom request with download: "excel",
  // which switches the endpoint's response from JSON to an .xlsx file.
  async function downloadExcel() {
    if (!requestParams.value || isDownloading.value) return;
    const authStore = useAuth();
    const toast = useToast();

    isDownloading.value = true;
    try {
      const response = await fetch(
        "/panel/boq-bom/feeder-simple/generate-boq-bom",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authStore.accessToken}`,
          },
          body: JSON.stringify({
            ...requestParams.value,
            download: "excel",
          }),
        },
      );
      if (!response.ok) throw new Error(response.statusText);

      const blob = await response.blob();
      const href = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = href;
      anchor.download = "boq_bom_feeder_simple.xlsx";
      anchor.click();
      window.URL.revokeObjectURL(href);
      anchor.remove();
    } catch (error) {
      console.error("Error downloading BOQ/BOM:", error);
      toast.add({
        title: "Error",
        description: "Failed to download BOQ/BOM.",
        icon: "i-heroicons-exclamation-circle",
        ui: { background: "bg-white", title: "text-grey-800" },
      });
    } finally {
      isDownloading.value = false;
    }
  }

  return {
    activeOwnerId,
    result,
    isDownloading,
    show,
    clearIfOwner,
    clear,
    downloadExcel,
  };
}
