<script setup lang="ts">
import IcFileSort from "~/assets/icons/ic-file-sort.svg";
import IcPlus from "~/assets/icons/ic-plus.svg";
const addNewFolder = () => {
  console.log("add new folder");
};
</script>

<template>
  <div
    class="flex flex-col justify-between gap-2 border border-grey-700 bg-grey-800 rounded-xs p-2 h-64"
  >
    <div class="flex flex-col flex-1 items-center justify-center py-8 gap-3">
      <IcFileSort class="h-6 w-6 text-brand-500" :fontControlled="false" />
      <div>
        <p class="line-clamp-3 text-grey-50 text-center">Create a Folder</p>
        <p class="line-clamp-3 text-grey-400 text-sm text-center">
          Datasets uploaded by User will be contained in a Folder.
        </p>
      </div>
      <UButton
        :ui="{ rounded: 'rounded-xxs' }"
        label="New Folder"
        class="h-9 justify-between gap-10"
        variant="outline"
        color="brand"
        @click="addNewFolder"
      >
        <template #trailing>
          <IcPlus />
        </template>
        <!-- <IcSpinner
          :class="[
            isActive ? 'text-brand-500' : 'text-white',
            'w-4 h-4 animate-spin',
          ]"
          :fontControlled="false"
          v-if="isLoad"
        /> -->
      </UButton>
    </div>
  </div>
</template>
