<script setup lang="ts">
import { useKeenSlider } from "keen-slider/vue";

export interface IBlockHeroSlidesItem {
  contents: {
    id: number;
    block_hero_slides_contents_id: {
      id: number;
      title: string;
      subtitle: string;
      body: string;
      image: string;
      primary_button_text?: string;
      primary_button_url?: string;
      secondary_button_text?: string;
      secondary_button_url?: string;
    };
  }[];
}

defineProps<{
  item: IBlockHeroSlidesItem;
}>();

const current = ref(0);
const timeout = ref<NodeJS.Timeout>();
const mouseOver = ref(false);

const [container, slider] = useKeenSlider(
  {
    loop: true,
    initial: current.value,
    slideChanged: (s) => {
      current.value = s.track.details.rel;
    },
  },
  [
    (slider) => {
      slider.on("created", () => {
        nextTimeout();
      });
      slider.on("dragStarted", clearNextTimeout);
      slider.on("animationEnded", nextTimeout);
      slider.on("updated", nextTimeout);
    },
  ]
);

function clearNextTimeout() {
  clearTimeout(timeout.value);
}
function nextTimeout() {
  clearTimeout(timeout.value);
  if (mouseOver.value) return;
  timeout.value = setTimeout(() => {
    slider.value?.next();
  }, 3000);
}
</script>

<template v-if="item.contents.length">
  <div
    class="relative w-full h-[50rem] rounded-lg overflow-hidden"
    @mouseover="
      () => {
        mouseOver = true;
        clearNextTimeout();
      }
    "
    @mouseout="
      () => {
        mouseOver = false;
        nextTimeout();
      }
    "
  >
    <div
      class="flex flex-col justify-end h-full w-1/2 pt-12 pb-24 px-11 gap-y-3 backdrop-blur-sm bg-grey-50/20 absolute left-0 z-10 text-brand-50"
    >
      <p class="text-lg font-semibold text-brand-50">
        {{ item.contents[current].block_hero_slides_contents_id.subtitle }}
      </p>
      <h1 class="text-6xl font-medium line-clamp-4 leading-tight">
        {{ item.contents[current].block_hero_slides_contents_id.title }}
      </h1>
      <div
        v-if="
          (item.contents[current].block_hero_slides_contents_id
            .primary_button_text &&
            item.contents[current].block_hero_slides_contents_id
              .primary_button_url) ||
          (item.contents[current].block_hero_slides_contents_id
            .secondary_button_text &&
            item.contents[current].block_hero_slides_contents_id
              .secondary_button_url)
        "
        class="flex gap-3 pt-3 pb-7"
      >
        <UButton
          v-if="
            item.contents[current].block_hero_slides_contents_id
              .primary_button_text &&
            item.contents[current].block_hero_slides_contents_id
              .primary_button_url
          "
          color="brand"
          :ui="{ rounded: 'rounded-[4px]' }"
          class="p-3"
          :to="
            item.contents[current].block_hero_slides_contents_id
              .primary_button_url
          "
          target="_blank"
        >
          {{
            item.contents[current].block_hero_slides_contents_id
              .primary_button_text
          }}
        </UButton>
        <UButton
          v-if="
            item.contents[current].block_hero_slides_contents_id
              .secondary_button_text &&
            item.contents[current].block_hero_slides_contents_id
              .secondary_button_url
          "
          color="brand"
          variant="outline"
          :ui="{ rounded: 'rounded-[4px]' }"
          class="p-3"
          :to="
            item.contents[current].block_hero_slides_contents_id
              .secondary_button_url
          "
          target="_blank"
        >
          {{
            item.contents[current].block_hero_slides_contents_id
              .secondary_button_text
          }}
        </UButton>
      </div>
      <p class="text-brand-50">
        {{ item.contents[current].block_hero_slides_contents_id.body }}
      </p>
    </div>
    <NuxtImg
      v-if="!slider"
      class="h-full w-full object-cover"
      provider="directus"
      :src="item.contents[0].block_hero_slides_contents_id.image"
    />
    <div ref="container" class="keen-slider h-full">
      <NuxtImg
        v-for="slide of item.contents"
        :key="slide.id"
        class="keen-slider__slide object-cover"
        provider="directus"
        :src="slide.block_hero_slides_contents_id.image"
      />
    </div>
    <div
      v-if="slider"
      class="flex absolute bottom-0 left-0 px-11 pb-12 w-1/2 gap-x-2"
    >
      <button
        v-for="(_slide, i) in item.contents"
        class="h-2 w-full rounded-full z-20"
        :class="{
          'bg-brand-500': current === i,
          'bg-grey-800/20': current !== i,
        }"
        @click="slider.moveToIdx(i)"
        :key="i"
      />
    </div>
  </div>
</template>

<style>
@import url("keen-slider/keen-slider.css");
</style>
