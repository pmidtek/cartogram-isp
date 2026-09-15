import { defineStore } from "pinia";

export const useMapTools = defineStore("mapTools", () => {
  const expandTools = ref<boolean>(true);
  const showCard = ref<boolean>(false);
  const showTools = ref<boolean>(true);
  function toggleExpandTools() {
    expandTools.value = !expandTools.value;
  }
  return { expandTools, toggleExpandTools, showCard, showTools };
});
