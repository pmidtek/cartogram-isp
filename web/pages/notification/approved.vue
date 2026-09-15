<script setup>
import { ref, onMounted } from "vue";
import { useRoute } from "vue-router";
import approveImg from "~/assets/images/approve.png";
import bgImg from "~/assets/images/background.webp";
const route = useRoute();

const updateStatus = async () => {
  try {
    const params = new URLSearchParams(window.location.search);
    const accessToken = params.get("access_token");
    const idData = params.get("id_data");
    const status = params.get("status") || "Approved"; // Just In Case

    if (!accessToken || !idData) {
      console.error("Missing required URL parameters");
      return;
    }

    const response = await fetch(
      `/panel/items/request_download_logs/${idData}`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          status: status,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log("Success:", data);
  } catch (error) {
    console.error("Error:", error);
  }
};

onMounted(() => {
  updateStatus();
});
</script>

<template>
  <div
    class="min-h-screen flex flex-col items-center justify-center relative overflow-hidden bg-white"
  >
    <!-- Background image -->
    <img
      :src="bgImg"
      class="absolute inset-0 w-full h-full object-cover opacity-5"
      alt="background"
    />

    <div
      class="relative z-10 flex flex-col items-center justify-center text-center px-4"
    >
      <div class="mb-12">
        <h1 class="text-2xl font-bold text-white font-raleway">Dashboard</h1>
        <span class="text-sm text-white/80">Geospatial Intelligence for Network Planning</span>
      </div>

      <div class="mb-8">
        <img :src="approveImg" class="w-72 h-auto" alt="approve icon" />
      </div>

      <h1 class="text-4xl text-white mb-6 font-semibold">Access Approved</h1>
    </div>
  </div>
</template>
