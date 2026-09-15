<script setup lang="ts">
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";

export interface IBlockInfoAccordionItem {
  id: number;
  title: string;
  subtitle: string;
  body: string;
  contents: {
    id: number;
    block_info_accordion_contents_id: {
      id: number;
      headline: string;
      body: string;
      image: string;
    };
  }[];
}

const props = defineProps<{
  item: IBlockInfoAccordionItem;
}>();

const accordionStates = ref(
  props.item.contents.map((_el, index) => index === 0)
);
const accordionHandler = (index: number) => {
  accordionStates.value.forEach((_el, i) => {
    if (i === index) {
      accordionStates.value[i] = !accordionStates.value[i];
    } else {
      accordionStates.value[i] = false;
    }
  });
};
</script>

<template>
  <div class="flex flex-col gap-3 bg-grey-100 rounded-lg p-11 min-h-[42rem]">
    <p class="font-medium text-lg">{{ item.subtitle }}</p>
    <div class="grid grid-cols-1 md:grid-cols-2 gap-x-7">
      <div class="space-y-3">
        <h1 class="font-medium text-4xl">{{ item.title }}</h1>
        <p class="text-grey-700">{{ item.body }}</p>
      </div>
      <div class="flex flex-col">
        <div v-for="(content, index) of item.contents" :key="content.id">
          <button
            :class="[
              'flex justify-between p-4 w-full text-xl font-medium rounded-t-lg',
              accordionStates[index] && 'bg-grey-800 text-grey-50',
            ]"
            @click="accordionHandler(index)"
          >
            {{ content.block_info_accordion_contents_id.headline }}
            <IcArrowReg :class="!accordionStates[index] && 'rotate-180'" />
          </button>
          <div
            v-if="accordionStates[index]"
            class="bg-grey-800 text-grey-50 rounded-b-lg overflow-hidden"
          >
            <div class="space-y-3 p-4">
              <NuxtImg
                provider="directus"
                :src="content.block_info_accordion_contents_id.image"
                class="w-full h-48 object-cover"
              />
              <p>{{ content.block_info_accordion_contents_id.body }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
