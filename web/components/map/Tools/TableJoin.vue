<script lang="ts" setup>
import { useQueryClient } from "@tanstack/vue-query";

const queryClient = useQueryClient();
const emit = defineEmits<{
  onClose: [];
}>();
const toast = useToast();
const layerStore = useMapLayer();
const authStore = useAuth();
const queueStore = useGeoprocessingQueue();
const featureStore = useFeature();
const activeLayers = computed(() => {
  return layerStore.groupedActiveLayers
    ?.map(({ layerLists }) => layerLists)
    .flat()
    .filter((el) => el.source === "vector_tiles")
    .map((el: LayerLists) => {
      return {
        label: el.layer_alias || (el as VectorTiles).layer_name,
        layer_name: (el as VectorTiles).layer_name,
      };
    });
});
const selectedLayer = ref<{ layer_name: string; label: string }>();
const outputLayer = ref<string>();
const typesJoin = ["Spatial to Excel", "Excel to Excel"];
const selectedType = ref();
const fileName = ref("");
const fileName2 = ref("");
const idTarget = ref();
const idJoin = ref();
const headerFile1 = ref<string[]>([]);
const headerFile2 = ref<string[]>([]);

const disableSpatialJoin = computed(() => {
  const excel2excel =
    selectedType.value === "Excel to Excel" &&
    outputLayer.value &&
    idTarget.value &&
    fileName.value &&
    headerFile1.value;
  const spatial2excel =
    selectedType.value === "Spatial to Excel" &&
    outputLayer.value &&
    idTarget.value &&
    fileName2.value &&
    headerFile2.value &&
    idJoin.value &&
    selectedLayer.value;

  return excel2excel || spatial2excel;
});

const handleFileChange = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target?.files?.[0];
  fileName.value = file ? file.name : "";

  const reader = new FileReader();
  reader.onload = (event) => {
    if (!event.target) return;
    const csvText = event.target.result as string;
    const lines = csvText.split("\n");
    const header = lines[0].split(",");

    console.log("header: ", header);
    headerFile1.value = header;
  };
  if (file) {
    reader.readAsText(file);
  }
};

const handleFileChange2 = (event: Event) => {
  const target = event.target as HTMLInputElement;
  const file = target?.files?.[0];
  fileName2.value = file ? file.name : "";

  const reader = new FileReader();
  reader.onload = (event) => {
    if (!event.target) return;
    const csvText = event.target.result as string;
    const lines = csvText.split("\n");
    const header = lines[0].split(",");

    console.log("header: ", header);
    headerFile2.value = header;
  };
  if (file) {
    reader.readAsText(file);
  }
};

const handleTabularJoin = async () => {
  if (authStore.accessToken) {
    if (selectedType.value === "Spatial to Excel") {
      const fileInput2 = document.getElementById(
        "file-upload-2",
      ) as HTMLInputElement;

      if (!fileInput2?.files?.[0] || !idTarget.value || !idJoin.value) {
        toast.add({
          title: "Please select both files and identifiers",
          icon: "i-heroicons-x-mark",
        });
        return;
      }

      const formData = new FormData();
      formData.append("target_table", selectedLayer.value?.layer_name ?? "");
      formData.append("join_table", fileInput2.files[0]);
      formData.append("id_target", idTarget.value);
      formData.append("id_join", idJoin.value);
      formData.append("output_table", outputLayer.value ?? "joinedData");

      try {
        console.log(
          "JSON payload for spatial to excel: ",
          JSON.stringify(formData),
        );
        const response = await fetch("/panel/geoprocessing/table-join", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`,
          },
          body: formData,
        });
        const result = await response.json();

        if (result.errors?.length) throw new Error(result.errors[0].message);
        setTimeout(() => {
          queueStore.checkQueueState(result.message_id);
        }, 1000);

        toast.add({
          title:
            "Join successful spatial and table data. it is added to layer management",
          icon: "i-heroicons-check-badge",
        });

        featureStore.setRightSidebar("geoprocessing");
        featureStore.setMapInfo("");
        emit("onClose");
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to enqueue the spatial join task. Please try again.";
        toast.add({
          title: message,
          icon: "i-heroicons-x-mark",
        });
      } finally {
        queryClient.invalidateQueries({
          queryKey: ["geoprocessing_history_query_key"],
        });
        queryClient.invalidateQueries({
          queryKey: ["geoprocessing_queue_query_key"],
        });
      }
    } else if (selectedType.value === "Excel to Excel") {
      const fileInput1 = document.getElementById(
        "file-upload-1",
      ) as HTMLInputElement;
      const fileInput2 = document.getElementById(
        "file-upload-2",
      ) as HTMLInputElement;

      if (
        !fileInput1?.files?.[0] ||
        !fileInput2?.files?.[0] ||
        !idTarget.value ||
        !idJoin.value
      ) {
        toast.add({
          title: "Please select both files and identifiers",
          icon: "i-heroicons-x-mark",
        });
        return;
      }

      const formData = new FormData();
      formData.append("target", fileInput1.files[0]);
      formData.append("join", fileInput2.files[0]);
      formData.append("id_target", idTarget.value);
      formData.append("id_join", idJoin.value);
      formData.append("output_name", outputLayer.value ?? "joinedData");

      try {
        const response = await fetch("/panel/join-tabular", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${authStore.accessToken}`, // Only include Authorization manually
            // DO NOT set Content-Type here
          },
          body: formData,
        });

        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Server error: ${errText}`);
        }

        const blob = await response.blob();
        const url = URL.createObjectURL(blob);

        const a = document.createElement("a");
        a.href = url;
        a.download = outputLayer.value + ".csv";
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);

        toast.add({
          title: "Join successful. File downloaded.",
          icon: "i-heroicons-check-badge",
        });
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "Failed to join tables. Please try again.";
        toast.add({
          title: message,
          icon: "i-heroicons-x-mark",
        });
      }
    } else {
      toast.add({
        title: "Undefined error in the Table Join analysis",
        icon: "i-heroicons-check-badge",
      });
    }
  } else {
    toast.add({
      title: "Forbidden access",
      icon: "i-heroicons-x-mark",
      description: "You need to login to run the spatial join analysis",
    });
  }
};

const targetColumns = ref<string[]>([]);
watch(selectedLayer, async (data) => {
  const resp = await $fetch<string[]>("/panel/field-att/" + data?.layer_name);
  targetColumns.value = resp;
});
</script>

<template>
  <div class="p-2 flex flex-col gap-2">
    <div class="space-y-1">
      <p class="text-2xs text-grey-800">Types of Join</p>
      <USelectMenu
        v-model="selectedType"
        :options="typesJoin"
        option-attribute="label"
        placeholder="Select layer"
        :ui="{
          rounded: 'rounded-xxs',
        }"
        :uiMenu="{
          base: 'space-y-1',
          rounded: 'rounded-xxs',
          background: 'bg-white',
          ring: 'ring-1 ring-grey-600',
          option: {
            base: 'cursor-pointer text-grey-700 hover:text-grey-700',
            padding: 'px-1.5 py-1',
            selected: 'bg-grey-200 text-grey-700',
            color: 'text-grey-200',
            rounded: 'rounded-xxs',
            active: 'bg-grey-200 text-grey-700',
            size: 'text-xs',
          },
          input: 'bg-white text-grey-200 text-xs',
        }"
        size="2xs"
      />
    </div>
    <div class="space-y-1" v-if="selectedType === 'Excel to Excel'">
      <p class="text-2xs text-grey-800">Table Join from</p>
      <label
        for="file-upload-1"
        class="block w-full bg-gray-700 text-gray-200 text-xs px-3 py-2 rounded-xxs cursor-pointer flex items-center justify-between"
      >
        <span
          class="text-xs rounded-xxs px-1 py-[1px]"
          :class="
            fileName
              ? ' ring-1 ring-brand-600 text-brand-600'
              : 'ring-1 ring-white text-grey-800'
          "
        >
          {{ fileName ? "Selected" : "Select Excel File" }}</span
        >
        <span class="truncate text-gray-400 text-2xs ml-2">{{
          fileName || "No file selected"
        }}</span>
      </label>
      <input
        id="file-upload-1"
        type="file"
        class="hidden"
        @change="handleFileChange"
        accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
      />
      <div v-if="headerFile1.length > 0 && headerFile1">
        <p class="text-2xs text-grey-800">Select Table Target Identifier</p>
        <USelectMenu
          searchable
          searchable-placeholder="Search Layer"
          v-model="idTarget"
          :options="headerFile1"
          :search-attributes="['layer_name', 'label']"
          option-attribute="label"
          placeholder="Select layer"
          :ui="{
            rounded: 'rounded-xxs',
          }"
          :uiMenu="{
            base: 'space-y-1',
            rounded: 'rounded-xxs',
            background: 'bg-white',
            ring: 'ring-1 ring-grey-600',
            option: {
              base: 'cursor-pointer text-grey-700 hover:text-grey-700',
              padding: 'px-1.5 py-1',
              selected: 'bg-grey-200 text-grey-700',
              color: 'text-grey-200',
              rounded: 'rounded-xxs',
              active: 'bg-grey-200 text-grey-700',
              size: 'text-xs',
            },
            input: 'bg-white text-grey-200 text-xs',
          }"
          size="2xs"
        />
      </div>
    </div>
    <div class="space-y-1" v-else>
      <p class="text-2xs text-grey-800">Spatial Join from</p>
      <USelectMenu
        searchable
        searchable-placeholder="Search Layer"
        v-model="selectedLayer"
        :options="activeLayers"
        :search-attributes="['layer_name', 'label']"
        option-attribute="label"
        placeholder="Select layer"
        :ui="{
          rounded: 'rounded-xxs',
        }"
        :uiMenu="{
          base: 'space-y-1',
          rounded: 'rounded-xxs',
          background: 'bg-white',
          ring: 'ring-1 ring-grey-600',
          option: {
            base: 'cursor-pointer text-grey-700 hover:text-grey-700',
            padding: 'px-1.5 py-1',
            selected: 'bg-grey-200 text-grey-700',
            color: 'text-grey-200',
            rounded: 'rounded-xxs',
            active: 'bg-grey-200 text-grey-700',
            size: 'text-xs',
          },
          input: 'bg-white text-grey-200 text-xs',
        }"
        size="2xs"
      />

      <p class="text-2xs text-grey-800">Select Spatial Target Identifier</p>
      <USelectMenu
        searchable
        searchable-placeholder="Search Layer"
        :options="targetColumns"
        v-model="idTarget"
        option-attribute="label"
        placeholder="Select layer"
        :ui="{
          rounded: 'rounded-xxs',
        }"
        :uiMenu="{
          base: 'space-y-1',
          rounded: 'rounded-xxs',
          background: 'bg-white',
          ring: 'ring-1 ring-grey-600',
          option: {
            base: 'cursor-pointer text-grey-700 hover:text-grey-700',
            padding: 'px-1.5 py-1',
            selected: 'bg-grey-200 text-grey-700',
            color: 'text-grey-200',
            rounded: 'rounded-xxs',
            active: 'bg-grey-200 text-grey-700',
            size: 'text-xs',
          },
          input: 'bg-white text-grey-200 text-xs',
        }"
        size="2xs"
      />
    </div>
    <div class="space-y-1">
      <p class="text-2xs text-grey-800">Table Join with</p>
      <label
        for="file-upload-2"
        class="block w-full bg-white text-gray-800 text-xs px-3 py-2 rounded-xxs cursor-pointer flex items-center justify-between"
      >
        <span
          class="text-xs rounded-xxs px-1 py-[1px]"
          :class="
            fileName2
              ? ' ring-1 ring-brand-600 text-brand-600'
              : 'ring-1 ring-grey-300 text-grey-800'
          "
        >
          {{ fileName2 ? "Selected" : "Select Excel File" }}</span
        >
        <span class="truncate text-gray-400 text-2xs ml-2">{{
          fileName2 || "No file selected"
        }}</span>
      </label>
      <input
        id="file-upload-2"
        type="file"
        class="hidden"
        @change="handleFileChange2"
        accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
      />
      <p class="text-2xs text-grey-800">Select Target Identifier</p>
      <USelectMenu
        searchable
        searchable-placeholder="Search Layer"
        v-model="idJoin"
        :options="headerFile2"
        :search-attributes="['layer_name', 'label']"
        option-attribute="label"
        placeholder="Select layer"
        :ui="{
          rounded: 'rounded-xxs',
        }"
        :uiMenu="{
          base: 'space-y-1',
          rounded: 'rounded-xxs',
          background: 'bg-white',
          ring: 'ring-1 ring-grey-600',
          option: {
            base: 'cursor-pointer text-grey-700 hover:text-grey-700',
            padding: 'px-1.5 py-1',
            selected: 'bg-grey-200 text-grey-700',
            color: 'text-grey-200',
            rounded: 'rounded-xxs',
            active: 'bg-grey-200 text-grey-700',
            size: 'text-xs',
          },
          input: 'bg-white text-grey-200 text-xs',
        }"
        size="2xs"
      />
    </div>
    <div class="space-y-1">
      <p class="text-2xs text-grey-800">Output Layer Name</p>
      <UInput v-model="outputLayer" :ui="{ rounded: 'rounded-xxs' }" size="2xs">
      </UInput>
    </div>
  </div>
  <div class="p-2">
    <UButton
      @click="handleTabularJoin"
      color="brand"
      :ui="{ rounded: 'rounded-[4px]' }"
      :disabled="!disableSpatialJoin"
      class="w-full justify-center text-sm"
      :loading="false"
      >Apply Table Join
    </UButton>
  </div>
</template>
