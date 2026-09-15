<script setup lang="ts">
import IcLink from "~/assets/icons/ic-link.svg";
import IcForm from "~/assets/icons/ic-form.svg";
import type { Attachment } from "~/utils/types";

defineProps<Attachment>();
</script>

<template>
  <a
    :href="$props.url"
    class="text-white flex items-center border border-grey-600 rounded-xs p-2"
    target="_blank"
  >
    <div class="grow text-xs">
      <p class="text-brand-600">{{ $props.title }}</p>
      <p>{{ $props.description }}</p>
    </div>
    <IcForm
      v-if="$props.icon === 'form'"
      class="text-grey-400 w-6"
      :fontControlled="false"
    />
    <IcLink
      v-if="$props.icon === 'link'"
      class="text-grey-400 w-6"
      :fontControlled="false"
    />
  </a>
</template>
