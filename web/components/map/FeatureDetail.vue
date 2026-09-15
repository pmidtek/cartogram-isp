<script setup lang="ts">
import type { Attachment } from "~/utils/types";
import KeenSlider, {
  type KeenSliderInstance,
  type KeenSliderPlugin,
} from "keen-slider";
import IcArrowReg from "~/assets/icons/ic-arrow-reg.svg";
import IcCross from "~/assets/icons/ic-cross.svg";
import IcRectangleList from "~/assets/icons/ic-rectangle-list.svg";
import {
  TransitionRoot,
  TransitionChild,
  Dialog,
  DialogPanel,
  DialogTitle,
} from "@headlessui/vue";
import type { GeoJSONSource } from "maplibre-gl";
import { useQuery } from "@tanstack/vue-query";

type DetailData = {
  markdown: string | null;
  attachments: Attachment[];
  gallery: string[];
};

const mapRefStore = useMapRef();
const ResizePlugin: KeenSliderPlugin = (slider) => {
  const observer = new ResizeObserver(function () {
    slider.update();
  });

  slider.on("created", () => {
    observer.observe(slider.container);
  });
  slider.on("destroyed", () => {
    observer.unobserve(slider.container);
  });
};

const authStore = useAuth();
const current = ref<number>(0);
const sliderContainer = ref<HTMLElement | null>(null);
let slider: KeenSliderInstance | null = null;
let nextImage: (e: MouseEvent) => void;
let prevImage: (e: MouseEvent) => void;

watchEffect((onInvalidate) => {
  if (sliderContainer.value) {
    slider = new KeenSlider(
      sliderContainer.value!,
      {
        loop: true,
        initial: 0,
        slideChanged: (s) => {
          current.value = s.track.details.rel;
        },
      },
      [ResizePlugin]
    );
    nextImage = (e: MouseEvent) => {
      slider?.update();
      slider?.next();
    };

    prevImage = (e: MouseEvent) => {
      slider?.update();
      slider?.prev();
    };
  }

  onInvalidate(() => {
    slider?.destroy();
  });
});

const isOpen = ref(false);

function closeModal() {
  isOpen.value = false;
}
function openModal(idx: number) {
  isOpen.value = true;
  if (idx)
    setTimeout(() => {
      slider?.update();
      slider?.moveToIdx(idx);
    }, 500);
  else current.value = 0;
}

const featureStore = useFeature();
const { feature } = storeToRefs(featureStore);

const cleanLayerId = computed(() =>
  feature.value?.layerId?.replace(/_(fill|circle|line)$/, "")
);

// Check if the feature is a site_points layer
const isSitePoint = computed(() => feature.value?.tableName === "site_points");

const { data: layerData } = useQuery({
  queryKey: ["/panel/items/vector_tiles", cleanLayerId.value],
  queryFn: async ({ queryKey }) => {
    const res = await $fetch<{ data: any }>(queryKey.join("/"), {
      headers: {
        Authorization: "Bearer " + authStore.accessToken,
      },
    });
    return res.data.layer_name;
  },
  enabled: !!cleanLayerId.value,
});

// Query for site point info
const {
  data: sitePointData,
  isFetching: isSitePointFetching,
  isError: isSitePointError,
} = useQuery({
  queryKey: ["/panel/data/site-point-info", feature.value?.rowId],
  queryFn: async ({ queryKey }) => {
    const [baseUrl, rowId] = queryKey;
    const res = await $fetch<{ data: any }>(`${baseUrl}/${rowId}`, {
      headers: {
        Authorization: "Bearer " + authStore.accessToken,
      },
    });
    return res.data;
  },
  enabled: isSitePoint.value && !!feature.value?.rowId,
});

const {
  data: detailData,
  error: detailError,
  isFetching: isDetailFetching,
  isError: isDetailError,
} = useQuery({
  queryKey: [
    "/panel/feature-detail",
    feature.value?.tableName,
    feature.value?.rowId,
    layerData.value,
  ],
  queryFn: async ({ queryKey }) => {
    const [baseUrl, tableName, rowId, layerData] = queryKey;

    const layerName = layerData.replace(/sp_data_(footprint|roadmap)\??/, "");
    if (!layerName) {
      throw new Error("Layer name is not available");
    }

    const res = await $fetch<DetailData>(
      `${baseUrl}/${tableName}/${rowId}?${layerName}`,
      {
        headers: {
          Authorization: "Bearer " + authStore.accessToken,
        },
      }
    );
    return res;
  },
  enabled:
    !isSitePoint.value &&
    !!layerData.value &&
    !!feature.value?.tableName &&
    !!feature.value?.rowId,
  placeholderData: { markdown: null, attachments: [], gallery: [] },
});

const clearSelection = () => {
  (mapRefStore.map!.getSource("highlight") as GeoJSONSource)?.setData(
    emptyFeatureCollection
  );
  pauseAllAnimation();
  featureStore.setRightSidebar("");
  setTimeout(() => {
    featureStore.setFeature(undefined);
  }, 500);
};
</script>

<template>
  <div class="flex justify-between items-center m-3">
    <h2 class="text-white">Feature Detail</h2>
    <IcCross
      role="button"
      @click="featureStore.setRightSidebar('')"
      :fontControlled="false"
      class="w-3 h-3 rotate-180 text-grey-50"
    />
  </div>
  <hr class="mx-3" />
  <div class="grow overflow-y-auto px-3 my-3">
    <div
      v-if="!featureStore.feature"
      class="h-full flex flex-col justify-center items-center text-white text-center gap-3"
    >
      <IcRectangleList
        :fontControlled="false"
        class="w-12 h-12 text-brand-500"
      />
      <h4 class="text-sm text-grey-50">Feature Detail will be shown here.</h4>
      <p class="text-xs text-grey-400">
        Please click layer feature first to show the feature properties here.
      </p>
    </div>

    <div
      v-else-if="(isSitePoint && isSitePointFetching) || (!isSitePoint && !detailData && isDetailFetching)"
      class="h-full animate-pulse space-y-3"
    >
      <div class="w-full h-8 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-8 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-44 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-4 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-4 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-4 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-4 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-4 bg-grey-700 rounded-xs"></div>
      <div class="w-full h-4 bg-grey-700 rounded-xs"></div>
    </div>

    <!-- Site Point Data Display -->
    <template v-else-if="isSitePoint && sitePointData">
      <div class="space-y-4 text-white">
        <!-- Main Site Information -->
        <div class="bg-grey-800 rounded-xs p-3">
          <h3 class="text-sm font-semibold mb-3 text-brand-500">Site Point Information</h3>
          <div class="space-y-2 text-xs">
            <div class="flex">
              <span class="w-1/3 text-grey-400">Name:</span>
              <span class="flex-1">{{ sitePointData.name || '-' }}</span>
            </div>
            <div class="flex">
              <span class="w-1/3 text-grey-400">Code:</span>
              <span class="flex-1">{{ sitePointData.code || '-' }}</span>
            </div>
            <div v-if="sitePointData.description" class="flex">
              <span class="w-1/3 text-grey-400">Description:</span>
              <span class="flex-1">{{ sitePointData.description }}</span>
            </div>
            <div v-if="sitePointData.site_point_type_id" class="flex">
              <span class="w-1/3 text-grey-400">Type:</span>
              <span class="flex-1">{{ sitePointData.site_point_type_id.name }}</span>
            </div>
            <div v-if="sitePointData.area_city_id" class="flex">
              <span class="w-1/3 text-grey-400">City:</span>
              <span class="flex-1">{{ sitePointData.area_city_id.city }}</span>
            </div>
            <div v-if="sitePointData.area_city_id" class="flex">
              <span class="w-1/3 text-grey-400">Province:</span>
              <span class="flex-1">{{ sitePointData.area_city_id.province }}</span>
            </div>
            <div v-if="sitePointData.user_created" class="flex">
              <span class="w-1/3 text-grey-400">Owner:</span>
              <span class="flex-1">{{ sitePointData.user_created.name }}</span>
            </div>
          </div>

          <!-- Other Attributes -->
          <div v-if="sitePointData.other_attributes && sitePointData.other_attributes.length" class="mt-3 pt-3 border-t border-grey-700">
            <h4 class="text-xs font-medium mb-2 text-grey-300">Other Attributes</h4>
            <div class="space-y-2 text-xs">
              <div v-for="attr in sitePointData.other_attributes" :key="attr.label" class="flex">
                <span class="w-1/3 text-grey-400">{{ attr.label }}:</span>
                <span class="flex-1">{{ attr.value || '-' }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Assets Section -->
        <div v-if="sitePointData.assets && sitePointData.assets.length" class="bg-grey-800 rounded-xs p-3">
          <h3 class="text-sm font-semibold mb-3 text-brand-500">Assets ({{ sitePointData.assets.length }})</h3>
          <div class="space-y-3">
            <div v-for="(asset, idx) in sitePointData.assets" :key="idx" class="bg-grey-900 rounded-xs p-2">
              <div class="space-y-1 text-xs">
                <div class="flex">
                  <span class="w-1/3 text-grey-400">Name:</span>
                  <span class="flex-1 font-medium">{{ asset.name || '-' }}</span>
                </div>
                <div v-if="asset.code" class="flex">
                  <span class="w-1/3 text-grey-400">Code:</span>
                  <span class="flex-1">{{ asset.code }}</span>
                </div>
                <div v-if="asset.asset_type_id" class="flex">
                  <span class="w-1/3 text-grey-400">Type:</span>
                  <span class="flex-1">{{ asset.asset_type_id.name }}</span>
                </div>
                <div v-if="asset.description" class="flex">
                  <span class="w-1/3 text-grey-400">Description:</span>
                  <span class="flex-1">{{ asset.description }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Routes Section -->
        <div v-if="sitePointData.routes && sitePointData.routes.length" class="bg-grey-800 rounded-xs p-3">
          <h3 class="text-sm font-semibold mb-3 text-brand-500">Routes ({{ sitePointData.routes.length }})</h3>
          <div class="space-y-3">
            <div v-for="(route, idx) in sitePointData.routes" :key="idx" class="bg-grey-900 rounded-xs p-2">
              <div class="space-y-1 text-xs">
                <div class="flex">
                  <span class="w-1/3 text-grey-400">Name:</span>
                  <span class="flex-1 font-medium">{{ route.name || '-' }}</span>
                </div>
                <div v-if="route.code" class="flex">
                  <span class="w-1/3 text-grey-400">Code:</span>
                  <span class="flex-1">{{ route.code }}</span>
                </div>
                <div v-if="route.route_type_id" class="flex">
                  <span class="w-1/3 text-grey-400">Type:</span>
                  <span class="flex-1">{{ route.route_type_id.name }}</span>
                </div>
                <div v-if="route.description" class="flex">
                  <span class="w-1/3 text-grey-400">Description:</span>
                  <span class="flex-1">{{ route.description }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Cables Section -->
        <div v-if="sitePointData.cables && sitePointData.cables.length" class="bg-grey-800 rounded-xs p-3">
          <h3 class="text-sm font-semibold mb-3 text-brand-500">Cables ({{ sitePointData.cables.length }})</h3>
          <div class="space-y-3">
            <div v-for="(cable, idx) in sitePointData.cables" :key="idx" class="bg-grey-900 rounded-xs p-2">
              <div class="space-y-1 text-xs">
                <div class="flex">
                  <span class="w-1/3 text-grey-400">Name:</span>
                  <span class="flex-1 font-medium">{{ cable.name || '-' }}</span>
                </div>
                <div v-if="cable.code" class="flex">
                  <span class="w-1/3 text-grey-400">Code:</span>
                  <span class="flex-1">{{ cable.code }}</span>
                </div>
                <div v-if="cable.cable_type_id" class="flex">
                  <span class="w-1/3 text-grey-400">Type:</span>
                  <span class="flex-1">{{ cable.cable_type_id.name }}</span>
                </div>
                <div v-if="cable.description" class="flex">
                  <span class="w-1/3 text-grey-400">Description:</span>
                  <span class="flex-1">{{ cable.description }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- Empty state for no related data -->
        <div v-if="!sitePointData.assets?.length && !sitePointData.routes?.length && !sitePointData.cables?.length" class="bg-grey-800 rounded-xs p-4 text-center">
          <p class="text-xs text-grey-400">No related assets, routes, or cables found for this site point.</p>
        </div>
      </div>
    </template>

    <div
      v-else-if="
        !detailData ||
        (detailData.markdown === null &&
          detailData.attachments.length === 0 &&
          detailData.gallery.length === 0) ||
        isDetailError
      "
      class="h-full flex flex-col justify-center items-center text-white text-center gap-3"
    >
      <IcRectangleList
        :fontControlled="false"
        class="w-12 h-12 text-brand-500"
      />
      <h4 class="text-sm text-grey-50">Content structure has not been set.</h4>
      <p class="text-xs text-grey-400">
        Please contact data owner to set content structure for this layer
        feature detail.
      </p>
    </div>

    <template v-else-if="detailData">
      <MapMarkdownRenderer
        v-if="detailData.markdown"
        :source="detailData.markdown"
      />

      <div v-if="detailData.gallery?.length">
        <p class="text-white text-sm my-3">Image Gallery</p>
        <ul class="flex space-x-1 relative">
          <img
            role="button"
            @click="() => openModal(idx)"
            class="rounded-[4px] w-16 h-16 object-cover"
            v-for="(source, idx) of detailData.gallery
              .map((src, idx) =>
                idx > 3 ? [] : src.includes(',') ? src.split(',') : src
              )
              .flat()"
            :key="idx"
            :src="source"
          />
          <button
            v-if="
              detailData.gallery
                .map((src) => (src.includes(',') ? src.split(',') : src))
                .flat().length > 4
            "
            @click="() => openModal(4)"
            class="absolute top-0 right-1 w-16 h-16 bg-white bg-opacity-30 flex justify-center items-center text-white text-2xs"
          >
            More
          </button>
        </ul>
      </div>

      <ul class="mt-3 space-y-3" v-if="detailData.attachments?.length">
        <p class="text-white text-sm">Attachment</p>
        <MapAttachmentLink
          v-for="attachment in detailData.attachments"
          :title="attachment.title"
          :description="attachment.description"
          :url="attachment.url"
          :icon="attachment.icon"
        />
      </ul>
    </template>
  </div>
  <UButton
    v-if="featureStore.feature && (detailData || sitePointData)"
    :ui="{ rounded: 'rounded-xxs' }"
    label="Clear Feature Selection"
    variant="outline"
    color="brand"
    class="m-3"
    @click="clearSelection"
  >
  </UButton>

  <TransitionRoot v-if="detailData" appear :show="isOpen" as="template">
    <Dialog as="div" @close="closeModal" class="relative z-10">
      <TransitionChild
        as="template"
        enter="duration-300 ease-out"
        enter-from="opacity-0"
        enter-to="opacity-100"
        leave="duration-200 ease-in"
        leave-from="opacity-100"
        leave-to="opacity-0"
      >
        <div class="fixed inset-0 bg-black/25" />
      </TransitionChild>

      <div class="fixed inset-0 overflow-y-auto rounded-xs">
        <div
          class="flex min-h-full items-center justify-center p-4 text-center rounded-xs"
        >
          <TransitionChild
            as="template"
            enter="duration-300 ease-out"
            enter-from="opacity-0 scale-95"
            enter-to="opacity-100 scale-100"
            leave="duration-200 ease-in"
            leave-from="opacity-100 scale-100"
            leave-to="opacity-0 scale-95"
          >
            <DialogPanel
              class="w-full max-w-2xl transform overflow-hidden rounded-xs bg-white p-3 text-left align-middle shadow-xl transition-all"
              ><DialogTitle
                class="text-base font-medium leading-6 flex justify-between items-center"
              >
                <h2 class="text-white">Image Gallery</h2>
                <IcCross
                  role="button"
                  @click="closeModal"
                  :fontControlled="false"
                  class="w-3 h-3 rotate-180 text-grey-50"
                />
              </DialogTitle>
              <div class="relative w-full my-3">
                <div
                  ref="sliderContainer"
                  class="keen-slider h-full w-full rounded-xs"
                >
                  <img
                    class="keen-slider__slide object-cover min-w-full max-w-full"
                    v-for="(source, idx) of detailData.gallery
                      .map((src) => (src.includes(',') ? src.split(',') : src))
                      .flat()"
                    :key="idx"
                    :src="source"
                  />
                </div>

                <button
                  v-if="detailData.gallery.length"
                  @click="prevImage"
                  class="absolute left-8 top-1/2 -translate-y-1/2 flex justify-center items-center border rounded-xs bg-black opacity-40"
                >
                  <IcArrowReg
                    :fontControlled="false"
                    class="w-5 h-5 m-1 -rotate-90 text-grey-50"
                  />
                </button>

                <button
                  v-if="detailData.gallery.length"
                  @click="nextImage"
                  class="absolute right-8 top-1/2 -translate-y-1/2 flex justify-center items-center border rounded-xs bg-black opacity-40"
                >
                  <IcArrowReg
                    :fontControlled="false"
                    class="w-5 h-5 m-1 rotate-90 text-grey-50"
                  />
                </button>
              </div>
              <ul class="flex space-x-1 overflow-x-scroll">
                <img
                  role="button"
                  @click="() => slider?.moveToIdx(idx)"
                  :class="`rounded-[4px] w-16 h-16 object-cover ${
                    idx === current && 'border-4 border-brand-500'
                  }`"
                  v-for="(source, idx) of detailData.gallery
                    .map((src, idx) =>
                      idx > 3 ? [] : src.includes(',') ? src.split(',') : src
                    )
                    .flat()"
                  :key="idx"
                  :src="source"
                />
              </ul>
            </DialogPanel>
          </TransitionChild>
        </div>
      </div>
    </Dialog>
  </TransitionRoot>
</template>

<style>
@import url("keen-slider/keen-slider.css");
</style>
