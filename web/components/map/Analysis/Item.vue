<script lang="ts" setup>
import { ref } from "vue";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";
import IcTrash from "~/assets/icons/ic-trash.svg";
import { TransitionRoot } from "@headlessui/vue";
import type { AnalysisResult } from "~/utils/types";

const props = defineProps<{
  result: AnalysisResult;
}>();

const isExpand = ref(false);
const analysisStore = useAnalysisResult();
</script>

<template>
  <div>
    <div
      :class="[
        isExpand
          ? 'bg-grey-700 rounded-t-xxs'
          : 'bg-transparent hover:ring-1 hover:ring-grey-500 rounded-xxs',
        'cursor-pointer text-xs',
        'p-2 flex justify-between items-center gap-2 w-full',
      ]"
    >
      <div class="w-8/12">
        <p :class="['text-grey-200 truncate']">Buffer Analysis</p>
        <p :class="['text-grey-400 truncate']">
          {{ result.date }}
        </p>
      </div>
      <div class="flex gap-2 items-center justify-end w-4/12">
        <button
          @click="
            () => {
              analysisStore.removeResult(result.date);
            }
          "
        >
          <IcTrash
            :class="['text-brand-500 w-3 h-3']"
            :fontControlled="false"
          />
        </button>
        <button @click="isExpand = !isExpand" class="text-grey-400">
          <IcArrowReg
            :class="`w-3 h-3 ${isExpand ? '' : 'rotate-180'}`"
            :fontControlled="false"
          />
        </button>
      </div>
    </div>
    <TransitionRoot
      :show="isExpand"
      enter="transition duration-500 ease-in-out"
      enterFrom="transform max-h-0 opacity-0"
      enterTo="transform max-h-96 opacity-100"
      leave="transition duration-500 ease-in-out"
      leaveFrom="transform max-h-96 opacity-100"
      leaveTo="transform max-h-0 opacity-0"
      class="transition-all duration-500 ease-in-out text-grey-400 text-xs"
    >
      <div class="border-x border-grey-700 p-2">
        <h5>Area</h5>
        <p class="text-grey-200 font-medium">{{ result.description }}</p>
      </div>
      <div class="border border-grey-700 rounded-b-xxs p-2">
        <h5>Layers intersect Buffer Area</h5>
        <div class="my-2 space-y-1">
          <h6 class="text-grey-500">{{ result.layer }}</h6>
          <div
            class="flex items-center text-grey-200"
            v-for="item in result.result"
          >
            <UIcon class="w-4 h-4" name="i-heroicons-bars-3-bottom-left" />
            <p class="flex-grow mx-2 truncate">{{ item.category }}</p>
            <span class="h-[1px] flex-grow bg-grey-700 rounded-xxs"></span>
            <p class="w-1/6 text-right">{{ item.count }}</p>
          </div>
        </div>
      </div>
    </TransitionRoot>
  </div>
</template>
