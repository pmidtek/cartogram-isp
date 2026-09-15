<script setup lang="ts">
import type { IBlockInfoSingleItem } from "./InfoSingleBottom.vue";

defineProps<{
  item: IBlockInfoSingleItem;
}>();
</script>

<template>
  <div
    class="grid grid-cols-1 md:grid-cols-2 gap-x-7 bg-grey-100 rounded-lg p-11"
  >
    <div class="flex flex-col justify-between gap-y-3">
      <div class="space-y-3">
        <p class="font-medium text-lg">{{ item.subtitle }}</p>
        <h1 class="font-medium text-4xl">{{ item.title }}</h1>
      </div>
      <div class="space-y-3 text-grey-700">
        <p>{{ item.body }}</p>
        <UButton
          v-if="item.button_text && item.button_url"
          color="brand"
          :ui="{ rounded: 'rounded-[4px]' }"
          class="p-3"
          :to="item.button_url"
          target="_blank"
        >
          {{ item.button_text }}
        </UButton>
      </div>
    </div>
    <NuxtImg
      v-if="item.image"
      provider="directus"
      :src="item.image"
      class="w-full h-[28rem] rounded-lg object-cover"
    />
  </div>
</template>
