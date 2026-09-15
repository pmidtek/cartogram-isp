<script setup lang="ts">
export interface IBlockCTAItem {
  id: number;
  variant: "image_bg" | "image_bg_text_card" | "image_card";
  title: string;
  subtitle: string;
  body: string;
  image: string;
  primary_button_text: string;
  primary_button_url: string;
  secondary_button_text?: string;
  secondary_button_url?: string;
}

const props = defineProps<{
  item: IBlockCTAItem;
}>();

const img = useImage();
const bgImgUrl = computed(
  () =>
    `url('${img(props.item.image, undefined, {
      provider: "directus",
    })}')`
);
</script>

<template>
  <div
    :class="[
      'grid grid-cols-1 md:grid-cols-2 gap-7 rounded-lg bg-cover bg-center',
      item.variant === 'image_bg_text_card' ? 'p-6' : 'p-11',
      item.variant === 'image_card' && 'bg-grey-100',
    ]"
    :style="item.variant !== 'image_card' && `background-image: ${bgImgUrl}`"
  >
    <div
      :class="[
        'flex flex-col gap-3 p-6',
        item.variant === 'image_bg_text_card' &&
          'bg-grey-800 text-grey-50 rounded-lg',
      ]"
    >
      <p class="font-medium text-lg">{{ item.subtitle }}</p>
      <h1 class="font-medium text-4xl">{{ item.title }}</h1>
      <p :class="item.variant !== 'image_bg_text_card' && 'text-grey-700'">{{ item.body }}</p>
      <div
        v-if="
          (item.primary_button_text && item.primary_button_url) ||
          (item.secondary_button_text && item.secondary_button_url)
        "
        class="flex gap-3 mt-3"
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
    <div
      v-if="item.variant === 'image_card'"
      class="w-full h-full rounded-lg bg-cover bg-center"
      :style="`background-image: ${bgImgUrl}`"
    />
  </div>
</template>
