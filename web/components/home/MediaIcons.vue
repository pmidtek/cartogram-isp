<script setup lang="ts">
export interface IBlockMediaIconsItem {
  id: number;
  variant: "border" | "borderless";
  columns: number;
  title?: string;
  subtitle?: string;
  body?: string;
  contents: {
    id: number;
    block_media_icons_contents_id: {
      id: number;
      image: string;
      label?: string;
      caption?: string;
    };
  }[];
}

const props = defineProps<{
  item: IBlockMediaIconsItem;
}>();

const iconArr = computed(() => {
  const iconArr: number[][] = new Array(
    Math.ceil(props.item.contents.length / props.item.columns)
  );
  let idx = 0;
  for (let rowIdx = 0; rowIdx < iconArr.length; rowIdx++) {
    iconArr[rowIdx] = [];
    while (
      iconArr[rowIdx].length < props.item.columns &&
      idx < props.item.contents.length
    ) {
      iconArr[rowIdx].push(idx);
      idx++;
    }
  }
  return iconArr;
});

const genWidthClass = (totalCol: number) => {
  switch (totalCol) {
    case 2:
      return "w-1/2";
    case 3:
      return "w-1/3";
    case 4:
      return "w-1/4";
    default:
      return "w-full";
  }
};
</script>

<template>
  <div class="flex flex-col gap-3 bg-grey-100 rounded-lg p-11">
    <p v-if="item.subtitle" class="font-medium text-lg">
      {{ item.subtitle }}
    </p>
    <h1 v-if="item.title" class="font-medium text-4xl">{{ item.title }}</h1>
    <p v-if="item.body" class="text-grey-700">{{ item.body }}</p>
    <div
      :class="
        item.variant === 'border' &&
        'border border-grey-500 rounded-lg overflow-hidden'
      "
    >
      <table class="w-full">
        <tbody>
          <tr
            v-for="iconRow of iconArr"
            :class="
              item.variant === 'border' &&
              'border-t border-grey-500 first:border-0'
            "
          >
            <td
              v-for="iconIdx of iconRow"
              :class="[
                genWidthClass(iconRow.length),
                item.variant === 'border' &&
                  'border-l border-grey-500 first:border-0',
              ]"
              :colspan="12 / iconRow.length"
            >
              <div class="flex flex-col gap-y-3 p-4 text-center">
                <NuxtImg
                  provider="directus"
                  :src="
                    item.contents[iconIdx].block_media_icons_contents_id.image
                  "
                  class="w-full h-20 object-contain"
                />
                <p
                  v-if="
                    item.contents[iconIdx].block_media_icons_contents_id.label
                  "
                  class="text-sm font-medium text-grey-900"
                >
                  {{
                    item.contents[iconIdx].block_media_icons_contents_id.label
                  }}
                </p>
                <p
                  v-if="
                    item.contents[iconIdx].block_media_icons_contents_id.label
                  "
                  class="text-grey-700"
                >
                  {{
                    item.contents[iconIdx].block_media_icons_contents_id.caption
                  }}
                </p>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
