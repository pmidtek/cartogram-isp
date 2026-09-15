import { defineStore } from "pinia";
import type { DigitizeResult } from "~/utils/types";

export const useDigitizeStore = defineStore("digitize", () => {
  const digitizedData = ref<DigitizeResult[]>([]);
  const idCounter = ref<number>(1); // Auto-incrementing ID counter

  function setDigitizedData(newData: DigitizeResult[]) {
    digitizedData.value = newData;
  }

  function addDigitizedData(data: Omit<DigitizeResult, "id">) {
    digitizedData.value = [
      ...digitizedData.value,
      { ...data, id: idCounter.value++ },
    ];
  }

  function removeDigitizedData(id: number) {
    digitizedData.value = digitizedData.value.filter((item) => item.id !== id);
  }

  function resetDigitizedData() {
    digitizedData.value = [];
    idCounter.value = 1;
  }

  return {
    digitizedData,
    setDigitizedData,
    addDigitizedData,
    removeDigitizedData,
    resetDigitizedData,
  };
});
