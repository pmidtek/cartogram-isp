import { defineStore } from "pinia";

/**
 * Lightweight state for the FTTH manual-add feature (Site Point / Route / Cable
 * / Asset on an active project). Each add POSTs directly to the backend, so this
 * store only tracks panel navigation and how many items were added this session
 * (to decide whether "Selesai" needs to refresh the project summary).
 */

export type AddPanel = "" | "menu" | "site_point" | "route" | "cable" | "asset";

export const useFtthManualAdd = defineStore("ftthManualAdd", () => {
  const addPanel = ref<AddPanel>("");
  const projectId = ref<number | null>(null);
  // Count of items added since the last refresh (any type).
  const addedCount = ref(0);

  function openPanel(panel: AddPanel) {
    addPanel.value = panel;
  }

  function closePanel() {
    addPanel.value = "";
  }

  function markAdded(n = 1) {
    addedCount.value += n;
  }

  function resetCount() {
    addedCount.value = 0;
  }

  // Reset everything when the active project changes.
  function setProject(id: number | null) {
    if (projectId.value === id) return;
    projectId.value = id;
    addPanel.value = "";
    addedCount.value = 0;
  }

  return {
    addPanel,
    projectId,
    addedCount,
    openPanel,
    closePanel,
    markAdded,
    resetCount,
    setProject,
  };
});
