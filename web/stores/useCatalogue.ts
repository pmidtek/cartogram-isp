import { defineStore } from "pinia";

export const useCatalogue = defineStore("catalogueData", () => {
  const showCatalogue = ref<boolean>(false);
  const selectedCategory = ref<string | null>(null);

  function toggleCatalogue() {
    showCatalogue.value = !showCatalogue.value;
  }

  function setCategory(categoryId: string) {
    selectedCategory.value = categoryId;
  }
  return { showCatalogue, toggleCatalogue, selectedCategory, setCategory };
});
