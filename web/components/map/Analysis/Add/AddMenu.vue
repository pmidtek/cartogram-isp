<script setup lang="ts">
import type { AddPanel } from "~/stores/useFtthManualAdd";

const manualAdd = useFtthManualAdd();

const options: Array<{
  key: AddPanel;
  label: string;
  desc: string;
  icon: string;
}> = [
  {
    key: "site_point",
    label: "Site Point",
    desc: "Tambah titik secara manual",
    icon: "i-heroicons-map-pin-20-solid",
  },
  {
    key: "route",
    label: "Route",
    desc: "Hubungkan 2 site point",
    icon: "i-material-symbols:alt-route-rounded",
  },
  {
    key: "cable",
    label: "Cable",
    desc: "Tambah kabel pada route",
    icon: "i-heroicons-bolt-20-solid",
  },
  {
    key: "asset",
    label: "Asset",
    desc: "Tambah aset & tipe detail",
    icon: "i-heroicons-cube-20-solid",
  },
];
</script>

<template>
  <div class="p-2 space-y-2">
    <p class="text-2xs text-[#626264]">Pilih yang ingin ditambahkan</p>
    <button
      v-for="opt in options"
      :key="opt.key"
      class="w-full flex items-center gap-3 border border-grey-200 rounded-xxs px-3 py-2 hover:bg-grey-50 transition-colors text-left"
      @click="manualAdd.openPanel(opt.key)"
    >
      <UIcon :name="opt.icon" class="w-5 h-5 text-brand-500 shrink-0" />
      <div class="flex-1">
        <p class="text-xs font-semibold text-grey-800">{{ opt.label }}</p>
        <p class="text-2xs text-grey-500">{{ opt.desc }}</p>
      </div>
      <UIcon
        name="i-heroicons-chevron-right-20-solid"
        class="w-4 h-4 text-grey-400"
      />
    </button>
  </div>
</template>
