<script setup lang="ts">
export interface IBlockMediaVideoItem {
  id: number;
  title?: string;
  subtitle?: string;
  body?: string;
  url: string;
}

const props = defineProps<{
  item: IBlockMediaVideoItem;
}>();

const iframeSrc = computed(() => {
  const getYoutubeSrc = (id: string) =>
    `https://www.youtube-nocookie.com/embed/${id}`;

  try {
    const url = new URL(props.item.url);
    if (url.hostname === "www.youtube.com" || url.hostname === "youtube.com") {
      const videoId = url.searchParams.get("v");
      if (videoId) {
        return getYoutubeSrc(videoId);
      } else {
        return null;
      }
    } else if (url.hostname === "youtu.be" && url.pathname) {
      if (url.pathname) {
        return getYoutubeSrc(url.pathname.slice(1));
      } else {
        return null;
      }
    } else {
      return null;
    }
  } catch (error) {
    return null;
  }
});
</script>

<template>
  <div class="flex flex-col gap-3 bg-grey-100 rounded-lg p-11">
    <p v-if="item.subtitle" class="font-medium text-lg">
      {{ item.subtitle }}
    </p>
    <h1 v-if="item.title" class="font-medium text-4xl">{{ item.title }}</h1>
    <p class="text-grey-700">{{ item.body }}</p>
    <div
      v-if="iframeSrc"
      class="w-full rounded-lg aspect-w-16 aspect-h-9 mt-3 overflow-hidden"
    >
      <iframe
        class="w-full h-full"
        :src="iframeSrc"
        title="Video player"
        allowfullscreen
        referrerpolicy="no-referrer"
        loading="lazy"
      />
    </div>
  </div>
</template>
