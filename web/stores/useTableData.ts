import { defineStore } from "pinia";

export const useTableData = defineStore("tableData", () => {
  const activeCollection = ref<null | string>(null);
  const showTable = ref<boolean>(false);
  const fullscreen = ref<boolean>(false);
  function setActiveCollection(collection: string) {
    activeCollection.value = collection;
  }
  function toggleTable() {
    showTable.value = !showTable.value;
  }
  function toggleFullscreen() {
    fullscreen.value = !fullscreen.value;
  }
  return {
    activeCollection,
    showTable,
    toggleTable,
    fullscreen,
    setActiveCollection,
    toggleFullscreen,
  };
});
