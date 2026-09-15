<script setup lang="ts">
import { useKeenSlider } from "keen-slider/vue";

export interface IBlockInfoSlidesItem {
  contents: {
    id: number;
    block_info_slides_contents_id: {
      id: number;
      title: string;
      subtitle: string;
      body: string;
      image: string;
      button_text?: string;
      button_url?: string;
    };
  }[];
}

defineProps<{
  item: IBlockInfoSlidesItem;
}>();

const current = ref(0);

const [container, slider] = useKeenSlider({
  loop: true,
  initial: current.value,
  slideChanged: (s) => {
    current.value = s.track.details.rel;
  },
});
</script>

<template v-if="item.contents.length">
  <div class="grid grid-cols-2 gap-x-7 bg-grey-100 rounded-lg p-11">
    <div class="flex flex-col justify-between">
      <div class="space-y-3">
        <p class="font-medium text-lg">
          {{ item.contents[current].block_info_slides_contents_id.subtitle }}
        </p>
        <h1 class="font-medium text-4xl">
          {{ item.contents[current].block_info_slides_contents_id.title }}
        </h1>
      </div>
      <div class="space-y-3 text-grey-700">
        <p>{{ item.contents[current].block_info_slides_contents_id.body }}</p>
        <UButton
          v-if="
            item.contents[current].block_info_slides_contents_id.button_text &&
            item.contents[current].block_info_slides_contents_id.button_url
          "
          color="brand"
          :ui="{ rounded: 'rounded-[4px]' }"
          class="p-3"
          :to="item.contents[current].block_info_slides_contents_id.button_url"
          target="_blank"
        >
          {{ item.contents[current].block_info_slides_contents_id.button_text }}
        </UButton>
        <div class="flex gap-x-2 h-5 items-end">
          <button
            v-if="slider"
            v-for="(_slide, i) in item.contents"
            class="h-2 w-full rounded-full"
            :class="{
              'bg-brand-500': current === i,
              'bg-grey-800/20': current !== i,
            }"
            @click="slider.moveToIdx(i)"
            :key="i"
          />
        </div>
      </div>
    </div>
    <div class="w-full h-[42rem] rounded-lg overflow-hidden">
      <NuxtImg
        v-if="!slider"
        provider="directus"
        :src="item.contents[0].block_info_slides_contents_id.image"
        class="object-cover h-full"
      />
      <div ref="container" class="keen-slider h-full">
        <NuxtImg
          v-for="slide of item.contents"
          :key="slide.id"
          class="keen-slider__slide object-cover"
          provider="directus"
          :src="slide.block_info_slides_contents_id.image"
        />
      </div>
    </div>
  </div>
</template>
