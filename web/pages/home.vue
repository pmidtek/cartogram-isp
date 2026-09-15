<script setup lang="ts">
import type { IBlockHeroSlidesItem } from "~/components/home/HeroSlides.vue";
import type { IBlockHeroSingleItem } from "~/components/home/HeroSingle.vue";
import type { IBlockInfoSingleItem } from "~/components/home/InfoSingleBottom.vue";
import type { IBlockInfoSlidesItem } from "~/components/home/InfoSlides.vue";
import type { IBlockInfoAccordionItem } from "~/components/home/InfoAccordion.vue";
import type { IBlockMediaVideoItem } from "~/components/home/MediaVideo.vue";
import type { IBlockMediaIconsItem } from "~/components/home/MediaIcons.vue";
import type { IBlockCTAItem } from "~/components/home/CTA.vue";
import type { IBlockFooterItem } from "~/components/home/FooterFull.vue";

interface IHomeBlocks {
  id: number;
}
interface IBlockHeroSlides extends IHomeBlocks {
  collection: "block_hero_slides";
  item: IBlockHeroSlidesItem;
}
interface IBlockHeroSingle extends IHomeBlocks {
  collection: "block_hero_single";
  item: IBlockHeroSingleItem;
}
interface IBlockInfoSingle extends IHomeBlocks {
  collection: "block_info_single";
  item: IBlockInfoSingleItem;
}
interface IBlockInfoSlides extends IHomeBlocks {
  collection: "block_info_slides";
  item: IBlockInfoSlidesItem;
}
interface IBlockInfoAccordion extends IHomeBlocks {
  collection: "block_info_accordion";
  item: IBlockInfoAccordionItem;
}
interface IBlockMediaVideo extends IHomeBlocks {
  collection: "block_media_video";
  item: IBlockMediaVideoItem;
}
interface IBlockMediaIcons extends IHomeBlocks {
  collection: "block_media_icons";
  item: IBlockMediaIconsItem;
}
interface IBlockCTA extends IHomeBlocks {
  collection: "block_cta";
  item: IBlockCTAItem;
}
interface IBlockFooter extends IHomeBlocks {
  collection: "block_footer";
  item: IBlockFooterItem;
}

interface IHomeData {
  data: {
    blocks: (
      | IBlockHeroSlides
      | IBlockHeroSingle
      | IBlockInfoSingle
      | IBlockInfoSlides
      | IBlockInfoAccordion
      | IBlockMediaVideo
      | IBlockMediaIcons
      | IBlockCTA
      | IBlockFooter
    )[];
  };
}

const { data: homeData, error: homeDataError } = await useFetch<IHomeData>(
  `/panel/items/home/eng?fields=blocks.id,blocks.collection,blocks.item:block_hero_slides.contents.id,blocks.item:block_hero_slides.contents.block_hero_slides_contents_id.*,blocks.item:block_hero_single.*,blocks.item:block_info_single.*,blocks.item:block_info_slides.contents.id,blocks.item:block_info_slides.contents.block_info_slides_contents_id.*,blocks.item:block_info_accordion.*,blocks.item:block_info_accordion.contents.id,blocks.item:block_info_accordion.contents.block_info_accordion_contents_id.*,blocks.item:block_media_video.*,blocks.item:block_media_icons.*,blocks.item:block_media_icons.contents.id,blocks.item:block_media_icons.contents.block_media_icons_contents_id.*,blocks.item:block_cta.*,blocks.item:block_footer.*`
);
</script>

<template>
  <UContainer>
    <div class="space-y-3 pb-6 text-grey-800">
      <template
        v-if="!homeDataError && homeData"
        v-for="block in homeData.data.blocks"
        :key="block.id"
      >
        <HomeHeroSlides
          v-if="block.collection === 'block_hero_slides'"
          :item="block.item"
        />
        <HomeHeroSingle
          v-else-if="block.collection === 'block_hero_single'"
          :item="block.item"
        />
        <HomeInfoSingleBottom
          v-else-if="
            block.collection === 'block_info_single' &&
            block.item.variant === 'bottom'
          "
          :item="block.item"
        />
        <HomeInfoSingleSide
          v-else-if="
            block.collection === 'block_info_single' &&
            block.item.variant === 'side'
          "
          :item="block.item"
        />
        <HomeInfoSlides
          v-else-if="block.collection === 'block_info_slides'"
          :item="block.item"
        />
        <HomeInfoAccordion
          v-else-if="block.collection === 'block_info_accordion'"
          :item="block.item"
        />
        <HomeMediaVideo
          v-else-if="block.collection === 'block_media_video'"
          :item="block.item"
        />
        <HomeMediaIcons
          v-else-if="block.collection === 'block_media_icons'"
          :item="block.item"
        />
        <HomeCTA
          v-else-if="block.collection === 'block_cta'"
          :item="block.item"
        />
        <HomeFooterFull
          v-else-if="
            block.collection === 'block_footer' && block.item.variant === 'full'
          "
          :item="block.item"
        />
        <HomeFooterCompact
          v-else-if="
            block.collection === 'block_footer' &&
            block.item.variant === 'compact'
          "
          :item="block.item"
        />
      </template>
    </div>
  </UContainer>
</template>
