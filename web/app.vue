<script setup lang="ts">
import { expiresTokenKey } from "./constants";
import { useGeneralSettings } from "./utils";

const authStore = useAuth();
const { tryRefresh } = useAuth();
const { data } = await useGeneralSettings();

const visibilityChangeListener = () => {
  if (document.visibilityState === "visible") {
    console.log("welcome back at" + new Date());
    const epoch_expires_token = localStorage.getItem(expiresTokenKey);

    if (epoch_expires_token) {
      console.log((Number(epoch_expires_token) - Date.now()) / 1000);
      if (Number(epoch_expires_token) < Date.now()) {
        console.log("refresh token");
        tryRefresh();
      }
    }
  }
};

onMounted(() => {
  tryRefresh();
  document.addEventListener("visibilitychange", visibilityChangeListener);
});

onBeforeUnmount(() => {
  document.removeEventListener("visibilitychange", visibilityChangeListener);
});
</script>

<template>
  <Head>
    <Link
      rel="icon"
      type="image/png"
      :href="`/panel/assets/${data?.data.public_favicon}`"
  /></Head>
  <NuxtLayout v-if="!authStore.appLoad">
    <NuxtPage />
  </NuxtLayout>
  <!-- <NuxtWelcome /> -->
  <UNotifications />
</template>
