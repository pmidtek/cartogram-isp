<script setup lang="ts">
interface ILink {
  text: string;
  url: string;
  sort: number;
}

export interface IBlockFooterItem {
  id: number;
  variant: "full" | "compact";
  title: string;
  body: string;
  links?: ILink[];
  sites_label: string;
  sites: ILink[];
  contacts_label: string;
  contacts_content: string;
  contacts_phone: string;
  contacts_email: string;
  rights_label: string;
  credits: string;
  logo_footer: string;
}

const props = defineProps<{
  item: IBlockFooterItem;
}>();

const creditsWithReplacedYear = computed(() => {
  return props.item.credits.replaceAll(
    "{{year}}",
    new Date().getFullYear().toString()
  );
});

console.log(props.item);
</script>

<template>
  <div
    class="grid grid-cols-4 gap-x-6 bg-grey-800 rounded-lg p-11 text-grey-50 relative"
  >
    <div class="flex flex-col justify-between gap-y-3.5 col-span-2">
      <div class="space-y-3">
        <h1 class="font-medium text-4xl">{{ item.title }}</h1>
        <p class="text-grey-400">{{ item.body }}</p>
        <img
          class="absolute bottom-12"
          :src="`https://linknet.geodashboard.io/panel/assets/${props.item.logo_footer}`"
          alt="Footer Logo"
        />
      </div>
      <div class="flex gap-3 mt-24">
        <a
          v-if="Array.isArray(item.links)"
          v-for="link of item.links"
          :href="link.url"
          >{{ link.text }}</a
        >
      </div>
    </div>
    <div class="flex flex-col justify-between">
      <div class="flex flex-col gap-y-3.5">
        <p class="font-semibold text-lg text-grey-500">
          {{ item.sites_label }}
        </p>
        <a v-for="site of item.sites" :href="site.url">{{ site.text }}</a>
      </div>
      <p class="text-grey-500 mt-24">{{ item.rights_label }}</p>
    </div>
    <div class="flex flex-col justify-between">
      <div class="flex flex-col gap-y-3.5">
        <p class="font-semibold text-lg text-grey-500">
          {{ item.contacts_label }}
        </p>
        <p>{{ item.contacts_content }}</p>
        <p>{{ item.contacts_phone }}</p>
        <a :href="`mailto:${item.contacts_email}`">{{ item.contacts_email }}</a>
      </div>
      <p class="text-grey-500 mt-24">
        {{ creditsWithReplacedYear }}
      </p>
    </div>
  </div>
</template>
