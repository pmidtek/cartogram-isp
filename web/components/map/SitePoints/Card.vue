<script lang="ts" setup>
import IcPin from "~/assets/icons/ic-pin.svg";
import type { SitePointListItem } from "~/utils/types";

const props = defineProps<{
  data: SitePointListItem;
  selected?: boolean;
}>();

defineEmits<{
  select: [id: number];
  locate: [id: number];
}>();

const area = computed(() => {
  const city = props.data.area_city_id?.city;
  const province = props.data.area_city_id?.province;

  return [city, province].filter(Boolean).join(", ") || "-";
});
</script>

<template>
  <div
    role="button"
    @click="$emit('select', data.id)"
    class="p-2 border rounded-xxs flex gap-2 cursor-pointer transition-colors"
    :class="
      selected
        ? 'border-brand-500 bg-brand-50'
        : 'border-grey-700 hover:bg-grey-50'
    "
  >
    <div class="text-2xs flex-1 min-w-0">
      <p class="text-grey-500">Name</p>
      <p class="text-grey-800 truncate">{{ data.name || "-" }}</p>
    </div>
    <div class="text-2xs flex-1 min-w-0">
      <p class="text-grey-500">Location</p>
      <p class="text-grey-800 truncate" :title="area">
        {{ area }}
      </p>
    </div>
    <div class="flex items-center gap-1.5 shrink-0">
      <button
        type="button"
        title="Jump to site"
        @click.stop="$emit('locate', data.id)"
        class="flex items-center justify-center w-5 h-5 rounded-xxs text-grey-500 hover:text-brand-500 hover:bg-grey-100"
      >
        <IcPin class="w-3 h-3" :fontControlled="false" />
      </button>
      <UButton
        v-if="!selected"
        size="2xs"
        variant="solid"
        color="brand"
        label="Select"
        :ui="{ rounded: 'rounded-xxs' }"
        @click.stop="$emit('select', data.id)"
      />
    </div>
  </div>
</template>
