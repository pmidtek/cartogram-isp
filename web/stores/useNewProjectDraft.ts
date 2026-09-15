import { defineStore } from "pinia";

export const useNewProjectDraft = defineStore("newProjectDraft", () => {
  const projectName = ref("");
  const projectDescription = ref("");
  const uploadedFile = ref<File | null>(null);
  const parsedGeometry = ref<any>(null);
  const currentStep = ref(1);

  // Area analysis result (persisted here so it survives the modal being
  // unmounted while the user picks start points on the map)
  const analysisResult = ref<{
    totalHomes: number;
    odcNeeded: number;
    totalLines: number;
    lines: { line: number; odc: number; cable: string }[];
  } | null>(null);

  // OLT start point selection (multi-select)
  const oltMode = ref<"site" | "input" | "tower">("site");
  const oltCoordinates = ref<[number, number][]>([]);
  const oltTowers = ref<{ id: number | string; label: string }[]>([]);
  // Analysis-derived inputs that bound how many start points are required
  const oltTotalLines = ref(0);
  const oltLastLineFull = ref(false);

  function resetOltSelection() {
    oltCoordinates.value = [];
    oltTowers.value = [];
  }

  function reset() {
    projectName.value = "";
    projectDescription.value = "";
    uploadedFile.value = null;
    parsedGeometry.value = null;
    currentStep.value = 1;
    analysisResult.value = null;
    oltMode.value = "site";
    oltCoordinates.value = [];
    oltTowers.value = [];
    oltTotalLines.value = 0;
    oltLastLineFull.value = false;
  }

  return {
    projectName,
    projectDescription,
    uploadedFile,
    parsedGeometry,
    currentStep,
    analysisResult,
    oltMode,
    oltCoordinates,
    oltTowers,
    oltTotalLines,
    oltLastLineFull,
    resetOltSelection,
    reset,
  };
});
