export interface MapPickedSitePoint {
  id: number;
  name: string;
  coordinates: [number, number];
}

const openAccordionIds = ref(new Set<number>());
const activeAnchorId = ref<number | null>(null);
const stationSelectionSignal = ref<{
  anchorId: number;
  point: MapPickedSitePoint;
} | null>(null);

export function useSitePointPicker() {
  function isAccordionOpen(id: number) {
    return openAccordionIds.value.has(id);
  }

  function openAccordion(id: number) {
    if (!openAccordionIds.value.has(id)) {
      openAccordionIds.value = new Set(openAccordionIds.value).add(id);
    }
    activeAnchorId.value = id;
  }

  function closeAccordion(id: number) {
    if (!openAccordionIds.value.has(id)) return;
    const next = new Set(openAccordionIds.value);
    next.delete(id);
    openAccordionIds.value = next;
    if (activeAnchorId.value === id) {
      activeAnchorId.value = [...next].pop() ?? null;
    }
  }

  function pickStationFromMap(point: MapPickedSitePoint) {
    if (activeAnchorId.value == null) return;
    stationSelectionSignal.value = { anchorId: activeAnchorId.value, point };
  }

  return {
    openAccordionIds,
    activeAnchorId,
    stationSelectionSignal,
    isAccordionOpen,
    openAccordion,
    closeAccordion,
    pickStationFromMap,
  };
}
