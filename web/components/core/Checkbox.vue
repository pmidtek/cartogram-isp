<script setup lang="ts">
import { Switch } from "@headlessui/vue";
import IcCheck from "~/assets/icons/ic-check.svg";
import IcDrawFree from "~/assets/icons/ic-draw-free.svg";
import IcMapLayerB from "~/assets/icons/ic-map-layer-b.svg";

const props = defineProps<{
  id: string;
  index: number | string;
  label?: string;
  icon?: string | Component;
  isChecked: boolean;
  forHeader?: boolean;
}>();
const emit = defineEmits<{
  onChange: [index: number | string, value: boolean];
}>();

const enabled = ref(props.isChecked);

watchEffect(() => {
  enabled.value = props.isChecked;
});
</script>

<template>
  <div>
    <Switch
      v-model="enabled"
      v-slot="{ checked }"
      @click="
        () => {
          emit('onChange', index, !isChecked);
        }
      "
      class="w-full"
      :disabled="id === 'all' && isChecked"
    >
      <div
        :class="[
          checked && !forHeader ? 'bg-brand-950' : 'bg-transparent',
          'flex items-center p-2 gap-2 rounded-xxs cursor-pointer',
        ]"
      >
        <div
          :class="[
            checked ? 'border-brand-500' : 'border-grey-600',
            'h-4 w-4 border rounded-xxs flex items-center justify-center p-[2px]',
          ]"
        >
          <IcCheck
            :class="[
              'text-2xs text-brand-500',
              checked ? 'visible' : 'invisible',
            ]"
          />
        </div>
        <component
          v-if="icon"
          :is="icon"
          :class="['w-4 h-4', checked ? 'text-brand-500' : 'text-grey-400']"
          :fontControlled="false"
        ></component>
        <p
          v-if="label"
          :class="[
            'text-xs select-none whitespace-nowrap',
            checked ? 'text-grey-50' : 'text-grey-200',
          ]"
        >
          {{ label }}
        </p>
      </div>
    </Switch>
  </div>
</template>
