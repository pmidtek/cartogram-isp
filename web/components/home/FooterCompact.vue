<script setup lang="ts">
import type { IBlockFooterItem } from "./FooterFull.vue";

const props = defineProps<{
  item: IBlockFooterItem;
}>();

const creditsWithReplacedYear = computed(() => {
  return props.item.credits.replaceAll(
    "{{year}}",
    new Date().getFullYear().toString()
  );
});
</script>

<template>
  <div
    class="grid grid-cols-4 gap-x-6 bg-grey-800 rounded-lg p-11 text-grey-50"
  >
    <h1 class="font-medium text-3xl">{{ item.title }}</h1>
    <p class="text-grey-400">{{ item.body }}</p>
    <div class="flex flex-col justify-between">
      <div class="flex flex-col gap-3">
        <p>{{ item.contacts_phone }}</p>
        <a :href="`mailto:${item.contacts_email}`">{{ item.contacts_email }}</a>
      </div>
      <p class="text-grey-500 mt-24">
        {{ creditsWithReplacedYear }}
      </p>
    </div>
    <div class="flex flex-col justify-between">
      <div class="flex flex-col gap-3">
        <a
          v-if="Array.isArray(item.links)"
          v-for="link of item.links"
          :href="link.url"
          >{{ link.text }}</a
        >
      </div>
      <p class="text-grey-500 mt-24">{{ item.rights_label }}</p>
    </div>
  </div>
</template>
