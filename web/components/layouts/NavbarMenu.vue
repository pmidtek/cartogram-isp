<script lang="ts" setup>
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/vue";
import { ref, nextTick, computed } from "vue";
import IcArrow from "~/assets/icons/ic-arrow-reg.svg";
import IcLogout from "~/assets/icons/ic-logout.svg";

import { useMapModule } from "~/stores/useMapModule";

const businessPlanningRef = ref<HTMLElement | null>(null);
const planningPosition = ref({ top: 130, left: 375 });
const businessOperationRef = ref<HTMLElement | null>(null);
const operationPosition = ref({ top: 210, left: 375 });
const featureStore = useFeature();
const { typeFeature } = storeToRefs(featureStore);
const router = useRouter();
const toast = useToast();
const authStore = useAuth();
const emit = defineEmits(["close"]);
const mapModuleStore = useMapModule();

// Filter planning modules based on user's access
const planningModules = computed(() => {
  return mapModuleStore.planningModules.filter((module) =>
    authStore.hasModule(module.slug),
  );
});

// Check if user has any business planning access
const hasBusinessPlanningAccess = computed(
  () => planningModules.value.length > 0,
);

// Filter operation modules based on user's access
const operationModules = computed(() => {
  return mapModuleStore.operationModules.filter((module) =>
    authStore.hasModule(module.slug),
  );
});

// Check if user has any business operation access
const hasBusinessOperationAccess = computed(
  () => operationModules.value.length > 0,
);

const goToModule = async (slug: string) => {
  const module = mapModuleStore.getModule(slug as any);
  if (!module) return;
  mapModuleStore.setActiveModule(slug as any);
  await router.push(mapModuleStore.resolveRoute(module));
  emit("close");
};

const updatePosition = (buttonRef: any, positionRef: any) => {
  if (buttonRef.value) {
    const rect = buttonRef.value.getBoundingClientRect();
    positionRef.value = {
      top: rect.top,
      left: rect.right + 8, // 8px gap
    };
  }
};

const onPlanningOpen = async () => {
  await nextTick();
  updatePosition(businessPlanningRef, planningPosition);
};

const onOperationOpen = async () => {
  await nextTick();
  updatePosition(businessOperationRef, operationPosition);
};
</script>

<template>
  <div class="p-3 space-y-2 w-[337px]">
    <div
      @click="router.push('/hero')"
      class="w-full flex items-center gap-2 p-2 cursor-pointer"
    >
      <IcArrow class="-rotate-90" />
      <p class="font-raleway text-xs">Back to Landing Page</p>
    </div>

    <!-- Business Planning with nested popover -->
    <Popover
      v-if="hasBusinessPlanningAccess"
      class="relative"
      @mouseenter="onPlanningOpen"
    >
      <PopoverButton
        ref="businessPlanningRef"
        class="w-full flex justify-between items-center pb-2 hover:bg-grey-100 p-2 rounded-xs cursor-pointer"
        @click="onPlanningOpen"
      >
        <div class="font-raleway text-xs text-left">
          <p class="text-black">Business Planning</p>
          <p class="text-grey-500">
            Optimize routes, assess FWA, and generate BOQ/BOM with optical
            budget insights.
          </p>
        </div>
        <IcArrow class="rotate-90 shrink-0" />
      </PopoverButton>

      <Teleport to="body">
        <PopoverPanel
          class="fixed z-[9999]"
          :style="{
            top: planningPosition.top + 'px',
            left: planningPosition.left + 'px',
          }"
        >
          <div
            class="bg-white border border-gray-200 rounded-xs shadow-lg p-2 space-y-2 w-[280px]"
          >
            <div
              v-for="module in planningModules"
              :key="module.slug"
              @click="goToModule(module.slug)"
              class="p-2 rounded-xs cursor-pointer hover:bg-gradient-to-r hover:from-blue-200/80 hover:to-blue-600 hover:text-white"
            >
              <p class="font-raleway text-xs font-medium">
                {{ module.name }}
              </p>
            </div>
          </div>
        </PopoverPanel>
      </Teleport>
    </Popover>

    <!-- Business Operation with nested popover -->
    <Popover
      v-if="hasBusinessOperationAccess"
      class="relative"
      @mouseenter="onOperationOpen"
    >
      <PopoverButton
        ref="businessOperationRef"
        class="w-full flex justify-between items-center py-2 hover:bg-grey-100 p-2 rounded-xs cursor-pointer"
        @click="onOperationOpen"
      >
        <div class="font-raleway text-xs text-left">
          <p class="text-black">Business Operation</p>
          <p class="text-grey-500">
            Integrated data sync and automated FTTH mapping powered by GIS
            intelligence.
          </p>
        </div>
        <IcArrow class="rotate-90 shrink-0" />
      </PopoverButton>

      <Teleport to="body">
        <PopoverPanel
          class="fixed z-[9999]"
          :style="{
            top: operationPosition.top + 'px',
            left: operationPosition.left + 'px',
          }"
        >
          <div
            class="bg-white border border-gray-200 rounded-xs shadow-lg p-2 space-y-2 w-[280px]"
          >
            <div
              v-for="module in operationModules"
              :key="module.slug"
              @click="goToModule(module.slug)"
              class="p-2 rounded-xs cursor-pointer hover:bg-gradient-to-r hover:from-blue-200/80 hover:to-blue-600 hover:text-white"
            >
              <p class="font-raleway text-xs font-medium">
                {{ module.name }}
              </p>
            </div>
          </div>
        </PopoverPanel>
      </Teleport>
    </Popover>

    <!-- Log Out (no nested popover needed) -->
    <div
      @click="
        async () => {
          toast.add({
            title: 'Sign Out Successful',
            ui: {
              background: 'bg-white',
              title: 'text-gray-900 text-md font-semibold',
              description: 'text-gray-500',
              icon: 'text-green-500',
            },
            description: 'You are now browsing as a guest.',
            icon: 'i-heroicons-information-circle',
          });
          await authStore.signout();
        }
      "
      class="p-2 flex items-center justify-between cursor-pointer hover:bg-grey-100 rounded-xs"
    >
      <p class="text-red-500 text-xs">Log Out</p>
      <IcLogout class="text-red-500 shrink-0" />
    </div>
  </div>
</template>
