<script setup lang="ts">
export interface IBlockHeroSingleItem {
  id: number;
  title: string;
  subtitle: string;
  body: string;
  image: string;
  primary_button_text?: string;
  primary_button_url?: string;
  secondary_button_text?: string;
  secondary_button_url?: string;
}

defineProps<{
  item: IBlockHeroSingleItem;
}>();
</script>

<template>
  <div class="flex flex-col gap-3 bg-grey-100 rounded-lg p-11">
    <p class="font-semibold text-lg">{{ item.subtitle }}</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-7">
      <h1 class="text-6xl font-medium line-clamp-3 leading-tight">
        {{ item.title }}
      </h1>
      <div class="space-y-3">
        <p class="line-clamp-6">{{ item.body }}</p>
        <div
          v-if="
            (item.primary_button_text && item.primary_button_url) ||
            (item.secondary_button_text && item.secondary_button_url)
          "
          class="flex gap-3 pt-3 pb-7"
        >
          <UButton
            v-if="item.primary_button_text && item.primary_button_url"
            color="brand"
            :ui="{ rounded: 'rounded-[4px]' }"
            class="p-3"
            :to="item.primary_button_url"
            target="_blank"
          >
            {{ item.primary_button_text }}
          </UButton>
          <UButton
            v-if="item.secondary_button_text && item.secondary_button_url"
            color="brand"
            variant="outline"
            :ui="{ rounded: 'rounded-[4px]' }"
            class="p-3"
            :to="item.secondary_button_url"
            target="_blank"
          >
            {{ item.secondary_button_text }}
          </UButton>
        </div>
      </div>
    </div>
    <NuxtImg
      class="w-full h-[40rem] mt-3 rounded-lg object-cover"
      provider="directus"
      :src="item.image"
    />
  </div>
</template>
