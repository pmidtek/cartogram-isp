<script setup lang="ts">
import IcLink from "~/assets/icons/ic-link.svg";

const isModalOpen = ref(false);
const mapRefStore = useMapRef();
const authStore = useAuth();
const isLoading = ref(false);
const toast = useToast();

const handleShare = async (event: Event) => {
  event.preventDefault();
  try {
    isLoading.value = true;
    const res = await $fetch<{ data: { id: string } }>(
      "/panel/items/shared_map?fields=id",
      {
        method: "POST",
        body: JSON.stringify({
          map_state: { boundArray: mapRefStore.map?.getBounds().toArray() },
        }),
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + authStore.accessToken,
        },
      }
    );
    navigator.clipboard.writeText(
      window.location.origin + "?share_id=" + res.data.id
    );
    toast.add({
      title: "Share Map Successful",
      description: "Shareable link copied to your clipboard.",
      icon: "i-heroicons-information-circle",
      ui: {
        background: "bg-white",
        title: "text-gray-900 text-md font-semibold",
        description: "text-gray-500",
        icon: "text-blue-500",
      },
    });
    isModalOpen.value = false; // Close the modal after sharing
  } catch (error) {
    console.error(error);
  } finally {
    isLoading.value = false;
  }
};

const closeModal = () => {
  isModalOpen.value = false;
};
</script>

<template>
  <div>
    <!-- Button to open modal -->
    <UButton class="rounded-xs" label="Share Map" @click="isModalOpen = true">
      <template #trailing>
        <IcLink class="text-base" />
      </template>
    </UButton>

    <!-- Basic modal structure -->
    <transition name="fade">
      <div
        v-if="isModalOpen"
        class="fixed inset-0 bg-gray-900 bg-opacity-50 flex items-center justify-center z-50"
      >
        <div
          class="bg-[#232221] text-white rounded-xs shadow-lg p-6 w-full max-w-md"
        >
          <div class="flex items-start justify-between">
            <h3 class="text-base font-semibold mb-4">Share & Export</h3>
            <button @click="closeModal" class="text-white">&times;</button>
          </div>
          <div class="text-sm">
            <p class="mb-2">Copy View Mode Link</p>
            <UButton
              label="Share Map"
              @click="handleShare"
              :disabled="isLoading"
              class="w-full rounded-xs"
            >
              <template #trailing>
                <UIcon
                  v-if="isLoading"
                  name="i-heroicons-arrow-path-solid"
                  class="h-4 w-4 animate-spin"
                />
                <IcLink v-else class="text-base" />
              </template>
            </UButton>
          </div>
          <div class="text-sm mt-4">
            <p class="mb-2">Export Dashboard to PDF</p>
            <UButton label="Export PDF" class="w-full rounded-xs">
              <!-- <template #trailing>
                <UIcon
                  v-if="isLoading"
                  name="i-heroicons-arrow-path-solid"
                  class="h-4 w-4 animate-spin"
                />
                <IcLink v-else class="text-base" />
              </template> -->
            </UButton>
          </div>
        </div>
      </div>
    </transition>
  </div>
</template>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}
.fade-enter,
.fade-leave-to {
  opacity: 0;
}
</style>
