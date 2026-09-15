<script lang="ts" setup>
import IcTrash from "~/assets/icons/ic-trash.svg";
import IcLayerPlus from "~/assets/icons/ic-layer-plus.svg";
import IcCross from "~/assets/icons/ic-cross.svg";
import IcDownload from "~/assets/icons/ic-download.svg";
import IcCheck from "~/assets/icons/ic-check.svg";
import type { Queue } from "~/utils/types";
import {
  TransitionRoot,
  TransitionChild,
  Dialog,
  DialogPanel,
  DialogTitle,
} from "@headlessui/vue";
import { useQueryClient } from "@tanstack/vue-query";

const props = withDefaults(
  defineProps<{
    data: Queue;
    isAddLayerAction: boolean;
  }>(),
  {
    isAddLayerAction: false,
  },
);

const queryClient = useQueryClient();

const authStore = useAuth();
const mapLayerStore = useMapLayer();
const toast = useToast();

const isOpenModal = ref(false);
function closeModal() {
  isOpenModal.value = false;
}

const errorMessage = computed(() =>
  props.data.result && typeof props.data.result.error === "string"
    ? props.data.result.error
    : "",
);

const statusLabel = computed(() =>
  capitalizeEachWords(props.data.status ?? props.data.state),
);

const hasImportResult = computed(
  () =>
    !!props.data.result &&
    ("total_valid" in props.data.result ||
      "total_invalid" in props.data.result),
);

const isDownloadingReport = ref(false);

const handleDownloadReport = async () => {
  if (!props.data.file_report) return;
  try {
    isDownloadingReport.value = true;
    const response = await fetch(
      `/panel/assets/${props.data.file_report}?download`,
      { headers: { Authorization: `Bearer ${authStore.accessToken}` } },
    );
    if (!response.ok) throw new Error(response.statusText);

    const blob = await response.blob();
    const href = window.URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `report-${props.data.message_id}.xlsx`;
    anchor.click();
    window.URL.revokeObjectURL(href);
    anchor.remove();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    toast.add({
      title: "Failed to download report",
      description: message,
      ui: {
        background: "bg-white",
        title: "text-grey-800",
        description: "text-grey-800",
      },
    });
  } finally {
    isDownloadingReport.value = false;
  }
};

const handleAddLayer = async () => {
  const response = await fetch(
    `/panel/items/vector_tiles/${props.data.result.layer_id}?fields=*.*.*&sort=layer_name`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    },
  );
  const result = await response.json();
  if (result.data) {
    const item = mapLayerStore.getLayersArr({
      vectorTiles: { data: [result.data] },
    });
    mapLayerStore.addLayer(item[0]);
  }
  toast.add({
    description: `Data layer has been added to Layer Management`,
    icon: "i-heroicons-check-circle",
    ui: {
      background: "bg-white",
      title: "text-grey-800",
      description: "text-grey-800",
    },
  });
};

const handleDelete = async () => {
  try {
    const res = await Promise.all(
      [
        { key: "vector_tiles", id: props.data.result.layer_id },
        { key: "geoprocessing_queue", id: props.data.message_id },
      ].map(async (el) => {
        const resp = await fetch(`/panel/items/${el.key}`, {
          method: "DELETE",
          body: JSON.stringify([el.id]),
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${authStore.accessToken}`,
          },
        });
        if (!resp.ok) {
          throw new Error(resp.statusText);
        }

        return await resp;
      }),
    );
    if (res) {
      toast.add({
        description: `Layer ${props.data.message.kwargs.output_table} has been successfully deleted`,
        icon: "i-heroicons-check-circle",
        ui: {
          background: "bg-white",
          title: "text-grey-800",
          description: "text-grey-800",
        },
      });
      queryClient.refetchQueries({
        queryKey: ["geoprocessing_history_query_key"],
        type: "active",
        exact: true,
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Error";
    toast.add({
      title: "Error",
      description: message,
      ui: {
        background: "bg-white",
        title: "text-grey-800",
        description: "text-grey-800",
      },
    });
  }
};
</script>

<template>
  <div>
    <div
      class="p-2 bg-brand-500 rounded-t-xxs flex gap-2 justify-between items-center"
    >
      <div class="text-2xs">
        <p class="text-white">{{ data.message.actor_name }}</p>
      </div>
    </div>
    <div class="p-2 border border-grey-700 space-y-2">
      <div class="text-2xs">
        <p class="text-grey-500">Queue ID</p>
        <p class="text-grey-800">{{ data.message_id }}</p>
      </div>
      <div class="text-2xs">
        <p class="text-grey-500">Initiator</p>
        <p class="text-grey-800">
          {{
            data.uploader
              ? data.uploader.first_name + " " + data.uploader.last_name
              : "-"
          }}
        </p>
      </div>
      <div class="text-2xs">
        <p class="text-grey-500">Created at</p>
        <p class="text-grey-800">
          {{ data.mtime ? new Date(data.mtime).toLocaleString() : "-" }}
        </p>
      </div>
      <div
        v-if="errorMessage"
        class="rounded-xxs bg-red-50 border border-red-100 overflow-hidden"
      >
        <div
          class="flex items-center gap-1.5 px-2 py-1.5 border-b border-red-100"
        >
          <p class="text-2xs font-semibold text-red-700">
            {{ statusLabel }}
          </p>
        </div>
        <div class="px-2 py-1.5 text-2xs">
          <p class="text-red-400">Error Message</p>
          <p class="text-red-700 break-words leading-relaxed">
            {{ errorMessage }}
          </p>
        </div>
      </div>
      <div v-else class="text-2xs">
        <p class="text-grey-500">Status</p>
        <div class="flex items-center gap-2">
          <UBadge
            :label="statusLabel"
            :color="
              (data.status ?? data.state)?.toLowerCase().includes('error') ||
              (data.status ?? data.state)?.toLowerCase().includes('failed')
                ? 'red'
                : (data.status ?? data.state)
                      ?.toLowerCase()
                      .includes('success') ||
                    (data.status ?? data.state)
                      ?.toLowerCase()
                      .includes('completed')
                  ? 'green'
                  : 'green'
            "
            size="xs"
            variant="solid"
            :ui="{ rounded: 'rounded-xxs' }"
          />
        </div>
      </div>
      <div
        v-if="hasImportResult"
        class="rounded-xxs bg-grey-50 border border-grey-100 p-2 space-y-2"
      >
        <div class="text-2xs">
          <p class="text-grey-500">Result</p>
          <p class="text-grey-800 capitalize">{{ data.result.result }}</p>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <div
            class="flex items-center gap-1.5 rounded-xxs bg-white border border-green-200 px-2 py-1.5"
          >
            <span
              class="flex items-center justify-center w-4 h-4 rounded-full bg-green-100"
            >
              <IcCheck
                class="w-2.5 h-2.5 text-green-600"
                :fontControlled="false"
              />
            </span>
            <div class="text-2xs leading-tight">
              <p class="text-grey-500">Valid</p>
              <p class="text-green-600 font-semibold">
                {{ data.result.total_valid ?? 0 }}
              </p>
            </div>
          </div>
          <div
            class="flex items-center gap-1.5 rounded-xxs bg-white border border-red-200 px-2 py-1.5"
          >
            <span
              class="flex items-center justify-center w-4 h-4 rounded-full bg-red-100"
            >
              <IcCross
                class="w-2.5 h-2.5 text-red-600"
                :fontControlled="false"
              />
            </span>
            <div class="text-2xs leading-tight">
              <p class="text-grey-500">Invalid</p>
              <p class="text-red-600 font-semibold">
                {{ data.result.total_invalid ?? 0 }}
              </p>
            </div>
          </div>
        </div>
      </div>
      <UButton
        v-if="data.file_report"
        block
        size="xs"
        color="white"
        variant="solid"
        :loading="isDownloadingReport"
        :ui="{
          rounded: 'rounded-xxs',
          base: 'transition-colors hover:bg-grey-50',
        }"
        @click="handleDownloadReport"
      >
        <template #leading>
          <IcDownload
            class="w-[14px] h-[14px] text-grey-700"
            :fontControlled="false"
          />
        </template>
        Download Report
      </UButton>
    </div>
  </div>
</template>
