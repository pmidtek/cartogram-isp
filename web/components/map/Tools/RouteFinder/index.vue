<script lang="ts" setup>
import { storeToRefs } from "pinia";
import IcCar from "~/assets/icons/ic-car.svg";
import IcCycling from "~/assets/icons/ic-cycling.svg";
import IcBus from "~/assets/icons/ic-bus.svg";
import IcWalk from "~/assets/icons/ic-walk.svg";
import IcReverse from "~/assets/icons/ic-reverse.svg";
import type { DirectionProfile } from "~/stores/useDirection";
import { useDirection } from "~/stores/useDirection";

const travelModeOptions = [
  { id: "driving-car", label: "Driving", icon: IcCar },
  { id: "cycling-road", label: "Cycling", icon: IcCycling },
  { id: "driving-hgv", label: "Bus", icon: IcBus },
  { id: "foot-walking", label: "Walk", icon: IcWalk },
];

const directionStore = useDirection();
const { reverseLocations, getDirections, reset, removeMarker } = directionStore;
const { directionProfile, locations } = storeToRefs(directionStore);

onUnmounted(() => {
  removeMarker();
});
</script>

<template>
  <div class="p-2 space-y-1">
    <p class="text-xs text-grey-800">Travel Mode</p>
    <div class="flex gap-1">
      <UButton
        v-for="option in travelModeOptions"
        :key="option.id"
        @click="
          () => {
            directionProfile = option.id as DirectionProfile;
          }
        "
        :color="directionProfile === option.id ? 'brand' : 'grey'"
        :ui="{
          rounded: 'rounded-xxs',
        }"
        class="flex-1 text-2xs py-1 px-2 space-x-1 whitespace-nowrap"
      >
        <template #leading>
          <component
            :is="option.icon"
            class="w-3 h-3"
            :fontControlled="false"
          ></component>
        </template>
        {{ option.label }}
      </UButton>
    </div>
  </div>
  <div class="p-2 space-y-2">
    <p class="text-xs text-grey-800">Route</p>
    <MapToolsRouteFinderInput
      v-for="(item, index) in locations"
      :key="item.id"
      :item="item"
      :endPoint="index === locations.length - 1"
    />
    <button
      :disabled="locations.filter((el) => el.feature !== null).length < 2"
      @click="reverseLocations"
      class="text-grey-50 flex gap-1 items-center"
    >
      <IcReverse class="w-3 h-3" :fontControlled="false" />
      <p class="text-2xs">Reverse</p>
    </button>
  </div>
  <div class="p-2 grid grid-cols-2 gap-x-3">
    <UButton
      @click="
        () => {
          removeMarker();
          reset();
        }
      "
      color="brand"
      :ui="{ rounded: 'rounded-[4px]' }"
      class="w-full justify-center text-sm"
      >Reset</UButton
    >
    <UButton
      @click="
        () => {
          removeMarker();
          getDirections(
            locations.map((el: any) => el.feature?.geometry.coordinates),
          );
        }
      "
      color="brand"
      :ui="{ rounded: 'rounded-[4px]' }"
      class="w-full justify-center text-sm"
      :loading="false"
      >Find Route</UButton
    >
  </div>
</template>
