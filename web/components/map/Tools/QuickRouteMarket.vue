<script lang="ts" setup>
import { ref } from "vue";
import { useQuery, useQueryClient } from "@tanstack/vue-query";

const analysisName = ref<string>("");
const selectedReference = ref<string | null>(null);
const isAnalyzing = ref(false);
const isQueued = ref(false);
const currentMessageId = ref<string | null>(null);
const authStore = useAuth();
const analysisStore = useAnalysisResult();
const toast = useToast();

// Fetch POI insight results for dropdown
const { data: poiResults, isLoading: isLoadingReferences } = useQuery({
  queryKey: ["poi_insight_result_list_for_route"],
  queryFn: async () => {
    const response = await $fetch<{ data: any[] }>(
      "/panel/items/poi_insight_result?fields=id,name&sort=-date_created&limit=-1",
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );
    return response.data;
  },
});

// Transform results for dropdown
const referenceOptions = computed(() => {
  if (!poiResults.value) return [];
  return poiResults.value.map((item) => ({
    label: item.name || `Analysis ${item.id}`,
    value: item.id,
  }));
});

const showToast = (
  message: string,
  type: "error" | "success" | "info" = "info",
) => {
  toast.add({
    title:
      type === "error"
        ? "Error"
        : type === "success"
          ? "Success"
          : "Information",
    description: message,
    icon:
      type === "error"
        ? "i-heroicons-x-circle"
        : type === "success"
          ? "i-heroicons-check-circle"
          : "i-heroicons-information-circle",
    ui: {
      background: "bg-white",
      title: "text-grey-900 text-md font-semibold",
      description: "text-grey-500",
    },
  });
};

const pollQueueStatus = async (messageId: string) => {
  isQueued.value = true;

  try {
    const response = await $fetch<{ data: any }>(
      `/panel/items/geoprocessing_queue/${messageId}`,
      {
        headers: {
          Authorization: `Bearer ${authStore.accessToken}`,
        },
      },
    );

    const { state, status, result } = response.data;

    if (state === "done" && status === "success") {
      const routeResultId = result?.poi_route_insight_result;

      if (routeResultId) {
        const routeResponse = await $fetch<{ data: any }>(
          `/panel/items/poi_route_insight_result/${routeResultId}`,
          {
            headers: {
              Authorization: `Bearer ${authStore.accessToken}`,
            },
          },
        );

        analysisStore.setQuickRouteInsightData(routeResponse.data);
        analysisStore.setCurrentAnalysisType("quick_route_insight_analysis");

        toast.add({
          title: "Analysis Complete",
          description: "Route analysis results are ready to view",
          icon: "i-heroicons-check-circle",
          ui: {
            background: "bg-white",
            title: "text-grey-900",
          },
        });

        isAnalyzing.value = false;
        isQueued.value = false;
        currentMessageId.value = null;
      }
    } else if (state === "rejected" || status === "error") {
      toast.add({
        title: "Analysis Failed",
        description: "The analysis task failed to complete",
        icon: "i-heroicons-x-circle",
        ui: {
          background: "bg-white",
          title: "text-grey-900",
        },
      });
      isAnalyzing.value = false;
      isQueued.value = false;
      currentMessageId.value = null;
    } else {
      setTimeout(() => pollQueueStatus(messageId), 2000);
    }
  } catch (error: any) {
    toast.add({
      title: "Error",
      description: error?.data?.message || "Failed to check queue status",
      icon: "i-heroicons-x-circle",
      ui: {
        background: "bg-white",
        title: "text-grey-900",
      },
    });
    isAnalyzing.value = false;
    isQueued.value = false;
    currentMessageId.value = null;
  }
};

const handleAnalyze = async () => {
  if (!selectedReference.value) {
    showToast("Please select a reference POI insight", "error");
    return;
  }

  if (!analysisName.value.trim()) {
    showToast("Please enter an analysis name", "error");
    return;
  }

  try {
    isAnalyzing.value = true;

    const token = authStore.accessToken;
    const response = await $fetch<{ data: { message_id: string } }>(
      `/panel/analysis/poi-route-insight`,
      {
        method: "POST",
        body: JSON.stringify({
          poi_insight_result_id: selectedReference.value,
          name: analysisName.value,
        }),
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    );

    const messageId = response?.message_id;

    if (!messageId) {
      throw new Error("No message_id received from API");
    }

    toast.add({
      title: "Analysis Started",
      description: "Processing your route analysis...",
      icon: "i-heroicons-information-circle",
      ui: {
        background: "bg-white",
        title: "text-grey-900",
      },
    });

    currentMessageId.value = messageId;
    await pollQueueStatus(messageId);
  } catch (error: any) {
    toast.add({
      title: "Analysis Failed",
      description:
        error?.data?.message || error?.message || "Unknown error occurred",
      icon: "i-heroicons-x-circle",
      ui: {
        background: "bg-white",
        title: "text-grey-900",
      },
    });
    console.error(error);
    isAnalyzing.value = false;
    isQueued.value = false;
    currentMessageId.value = null;
  }
};

const handleShowResults = () => {
  const toolsStore = useMapTools();
  const featureStore = useFeature();

  // Close the tools card
  toolsStore.showCard = false;
  toolsStore.showTools = true;

  // Open the list drawer for POI analysis results
  featureStore.setMapInfo("analytic");
};
</script>

<template>
  <div class="flex flex-col h-full overflow-y-auto">
    <div
      class="flex-1 overflow-y-auto p-2 flex flex-col gap-2 scrollbar-thin scrollbar-thumb-grey-400 scrollbar-track-grey-100"
    >
      <h3 class="text-brand-800 text-2xs">Reference POI Insight</h3>
      <USelectMenu
        v-model="selectedReference"
        :options="referenceOptions"
        placeholder="Select POI insight reference"
        value-attribute="value"
        option-attribute="label"
        :ui="{ rounded: 'rounded-xxs' }"
        size="xs"
        :loading="isLoadingReferences"
        :disabled="isLoadingReferences"
      />

      <h3 class="text-brand-800 text-2xs">Analysis Name</h3>
      <UInput
        v-model="analysisName"
        placeholder="Enter analysis name"
        class="rounded-xxs text-[10px]"
        size="xs"
        :disabled="isAnalyzing || isQueued"
      />

      <div class="flex flex-col gap-2 justify-between w-full mt-2">
        <div class="flex justify-between w-full gap-2">
          <UButton
            color="primary"
            size="xs"
            :ui="{ rounded: 'rounded-[4px]' }"
            class="w-[49%] justify-center text-sm"
            :disabled="
              isAnalyzing ||
              isQueued ||
              !selectedReference ||
              !analysisName.trim()
            "
            :loading="isAnalyzing || isQueued"
            @click="handleAnalyze"
          >
            {{ isAnalyzing || isQueued ? "Analyzing..." : "Analyze" }}
          </UButton>
          <UButton
            color="grey"
            size="xs"
            :loading="isAnalyzing || isQueued"
            :ui="{ rounded: 'rounded-[4px]' }"
            class="w-[49%] justify-center text-sm"
            @click="handleShowResults"
          >
            Result
          </UButton>
        </div>
      </div>
    </div>
  </div>
</template>
