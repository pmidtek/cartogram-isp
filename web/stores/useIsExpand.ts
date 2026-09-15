import { defineStore } from "pinia";
import { ref } from "vue";

export const useExpandStore = defineStore("expand", () => {
  const isExpand = ref(true);

  function toggleExpand() {
    isExpand.value = !isExpand.value;
  }

  return { isExpand, toggleExpand };
});
