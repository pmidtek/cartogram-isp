<script setup>
const authStore = useAuth();
const currentSlide = ref(0);
const isOpen = ref(true);

const { pending: loading, data: introData } = await useFetch(
  "/panel/items/introduction",
  {
    key: "intro",
  }
);

const sortedData = computed(() => {
  if (!introData.value?.data) return [];
  return [...introData.value.data].sort((a, b) => a.sort - b.sort);
});

const handleNext = () => {
  if (currentSlide.value < sortedData.value.length - 1) {
    currentSlide.value++;
  } else {
    isOpen.value = false;
  }
};

const handleLeftButton = () => {
  if (currentSlide.value === 0) {
    isOpen.value = false;
  } else {
    currentSlide.value--;
  }
};

const closeModal = () => {
  isOpen.value = false;
};
</script>

<template>
  <Teleport to="body">
    <div
      v-if="isOpen && !loading"
      class="fixed inset-0 flex items-center justify-center bg-black/50 backdrop-blur-sm"
    >
      <div
        class="bg-white rounded-xs text-white max-w-[50%] w-full mx-4 relative h-[40rem] flex flex-col"
      >
        <div class="p-6 pb-0">
          <!-- <button
            @click="closeModal"
            class="absolute right-4 top-4 p-1 hover:bg-gray-100 rounded-full"
          >
            Close
          </button> -->
        </div>

        <div
          v-if="sortedData[currentSlide]"
          class="flex-1 overflow-y-auto p-6 pt-0"
        >
          <div class="space-y-4 h-full flex flex-col">
            <div class="h-[22rem] flex-shrink-0">
              <img
                :src="`/panel/assets/${sortedData[currentSlide].image}`"
                :alt="sortedData[currentSlide].title"
                class="w-full h-full rounded-xs object-cover"
              />
            </div>

            <div class="flex-1">
              <h2 class="text-md font-semibold">
                {{ sortedData[currentSlide].title }}
              </h2>

              <div
                v-html="sortedData[currentSlide].description"
                class="text-gray-300 mt-2 text-sm"
              ></div>
            </div>
          </div>
        </div>

        <div class="p-6 border-t border-grey-800">
          <div class="flex justify-between items-center">
            <UButton
              @click="handleLeftButton"
              class="rounded-xxs bg-transparent border border-brand-500 text-sm w-28 justify-center text-brand-500 hover:bg-transparent"
              size="md"
            >
              {{ currentSlide === 0 ? "Skip" : "Back" }}
            </UButton>
            <!-- Dot -->
            <div class="flex gap-1">
              <div
                v-for="(_, index) in sortedData"
                :key="index"
                class="w-2 h-2 rounded-full"
                :class="index === currentSlide ? 'bg-grey-600' : 'bg-grey-800'"
              ></div>
            </div>

            <UButton
              @click="handleNext"
              class="rounded-xxs bg-transparent bg-brand-500 text-sm w-28 justify-center text-white"
              size="md"
            >
              {{
                currentSlide === sortedData.length - 1
                  ? "Finish"
                  : currentSlide === 0
                  ? "Learn More"
                  : "Continue"
              }}
            </UButton>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>
