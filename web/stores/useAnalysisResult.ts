import { defineStore } from "pinia";
import type { AnalysisResult, MarketAnalysisData } from "~/utils/types";

export type AnalysisEnum =
  | "buffer_analysis"
  | "potential_analysis"
  | "market_analysis"
  | "route_analysis"
  | "fwa_analysis"
  | "ftth_analysis"
  | "boq_bom_analysis"
  | "quadrant_based_analysis"
  | "directional_quadrant_analysis"
  | "qmi_result_analysis"
  | "quick_route_insight_analysis"
  | "antenna_direction_analysis"
  | "poi_insight_analysis"
  | "digitize_analysis"
  | "";

export const useAnalysisResult = defineStore("analysisResult", () => {
  const results = ref<AnalysisResult[]>([]);
  const dataBufferLineAnalysis = ref<any>(null);
  const dataMarketAnalysis = ref<MarketAnalysisData[]>([]);
  const dataBufferAnalysis = ref<any[]>([]);
  const currentAnalysisType = ref<AnalysisEnum | null>(null);
  const boqBomValue = ref<
    String | "ftth" | "draw_polygon" | "selection_polygon" | ""
  >("");
  const boqBomToolActive = ref<
    "draw_polygon" | "selection_polygon" | "ftth" | ""
  >("");
  const bufferToolActive = ref<boolean>(false);
  const isPriceDefault = ref<boolean>(true);
  const boqBomAnalysisData = ref<any>(null);
  const boqBomRouteGeometry = ref<any>(null);
  const boqBomPointsData = ref<any[]>([]);
  const boqBomManualInput = ref<any>(null);
  const qmiResultData = ref<any>(null);
  const quickRouteInsightData = ref<any>(null);
  const antennaDirectionData = ref<any>(null);
  const ftthAnalysisData = ref<any>(null);
  const ftthAnalysisProjectId = ref<number | null>(null);
  const ftthAnalysisProjectName = ref<string>("");

  function setResults(newResults: AnalysisResult[]) {
    results.value = newResults;
  }

  function setBoqBomAnalysisData(data: any) {
    boqBomAnalysisData.value = data;
  }

  function setBoqBomRouteGeometry(geometry: any) {
    boqBomRouteGeometry.value = geometry;
  }

  function setBoqBomPointsData(points: any[]) {
    boqBomPointsData.value = points;
  }

  function setBoqBomManualInput(input: any) {
    boqBomManualInput.value = input;
  }

  function clearBoqBomManualInput() {
    boqBomManualInput.value = null;
  }

  function clearBoqBomAnalysisData() {
    boqBomAnalysisData.value = null;
    boqBomRouteGeometry.value = null;
    boqBomPointsData.value = [];
    boqBomManualInput.value = null;
  }

  function setQmiResultData(data: any) {
    qmiResultData.value = data;
  }

  function clearQmiResultData() {
    qmiResultData.value = null;
  }

  function setQuickRouteInsightData(data: any) {
    quickRouteInsightData.value = data;
  }

  function clearQuickRouteInsightData() {
    quickRouteInsightData.value = null;
  }

  function setAntennaDirectionData(data: any) {
    antennaDirectionData.value = data;
  }

  function clearAntennaDirectionData() {
    antennaDirectionData.value = null;
  }

  function setFtthAnalysisData(
    data: any,
    projectId: number,
    projectName: string,
  ) {
    ftthAnalysisData.value = data;
    ftthAnalysisProjectId.value = projectId;
    ftthAnalysisProjectName.value = projectName;
  }

  function clearFtthAnalysisData() {
    ftthAnalysisData.value = null;
    ftthAnalysisProjectId.value = null;
    ftthAnalysisProjectName.value = "";
  }

  function addResult(res: AnalysisResult) {
    results.value = [...results.value, res];
  }
  function removeResult(date: string) {
    results.value = results.value.filter((r) => r.date !== date);
  }

  function addDataMarketAnalysis(data: any) {
    dataMarketAnalysis.value.push(data);
  }

  function addDataBufferAnalysis(data: any) {
    dataBufferAnalysis.value = data;
  }

  function setCurrentAnalysisType(type: AnalysisEnum | null) {
    currentAnalysisType.value = type;
  }

  function clearCurrentAnalysisType() {
    currentAnalysisType.value = null;
  }

  function setPriceNotDefault() {
    isPriceDefault.value = false;
  }

  function setBoqBom(
    method: String | "ftth" | "draw_polygon" | "selection_polygon" | "",
  ) {
    boqBomValue.value = method;
  }

  function setBoqBomToolActive(
    tool: "draw_polygon" | "selection_polygon" | "ftth" | "",
  ) {
    boqBomToolActive.value = tool;
  }

  function clearBoqBomToolActive() {
    boqBomToolActive.value = "";
  }

  function setBufferToolActive(active: boolean) {
    bufferToolActive.value = active;
  }

  return {
    results,
    setResults,
    addResult,
    removeResult,
    boqBomValue,
    boqBomToolActive,
    bufferToolActive,
    isPriceDefault,
    setBoqBom,
    setBoqBomToolActive,
    clearBoqBomToolActive,
    setBufferToolActive,
    setPriceNotDefault,
    dataBufferLineAnalysis,
    dataMarketAnalysis,
    addDataMarketAnalysis,
    dataBufferAnalysis,
    addDataBufferAnalysis,
    currentAnalysisType,
    setCurrentAnalysisType,
    clearCurrentAnalysisType,
    boqBomAnalysisData,
    boqBomRouteGeometry,
    boqBomPointsData,
    boqBomManualInput,
    setBoqBomAnalysisData,
    setBoqBomRouteGeometry,
    setBoqBomPointsData,
    setBoqBomManualInput,
    clearBoqBomManualInput,
    clearBoqBomAnalysisData,
    qmiResultData,
    setQmiResultData,
    clearQmiResultData,
    quickRouteInsightData,
    setQuickRouteInsightData,
    clearQuickRouteInsightData,
    antennaDirectionData,
    setAntennaDirectionData,
    clearAntennaDirectionData,
    ftthAnalysisData,
    ftthAnalysisProjectId,
    ftthAnalysisProjectName,
    setFtthAnalysisData,
    clearFtthAnalysisData,
  };
});
