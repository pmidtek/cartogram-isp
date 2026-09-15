<script setup lang="ts">
import { MenuItem } from "@headlessui/vue";
import type { RasterTileSource, StyleSpecification } from "maplibre-gl";

type Basemap = {
  name: string;
  url: string;
  thumbnailUrl: string;
  type: string;
};

const store = useMapRef();
const { data: generalSettingsData } = await useGeneralSettings();
const { currentBasemap, setCurrentBaseMap, map, mapLoad } = store;
const mapLayerStore = useMapLayer();
const basemapList = ref<null | Basemap[]>(null);
function isImgUrl(url: string) {
  const img = new Image();
  img.src = url;
  return new Promise((resolve) => {
    img.onload = () => resolve(true);
    img.onerror = () => resolve(false);
  });
}

watchEffect(async () => {
  const basemaps = [
    {
      name: "Topo",
      url: `https://tile.openstreetmap.org/{z}/{x}/{y}.png`,
      thumbnailUrl: `https://tile.openstreetmap.org/0/0/0.png`,
      type: "raster",
    },
    {
      name: "Dark Basemap",
      url: `https://basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png`,
      thumbnailUrl: `https://basemaps.cartocdn.com/dark_all/0/0/0.png`,
      type: "raster",
    },
  ];
  if (Array.isArray(generalSettingsData.value?.data.basemaps)) {
    for (const basemap of generalSettingsData.value.data.basemaps) {
      let item: Record<string, string> = {
        name: basemap.name,
        url: basemap.url,
        type: basemap.type,
      };
      if (basemap.type === "raster") {
        item["thumbnailUrl"] = basemap.url
          .replace("{z}", "0")
          .replace("{x}", "0")
          .replace("{y}", "0");
      } else if (basemap.type === "tile") {
        const check = await isImgUrl(
          basemap.url.replace("tiles.json", "0/0/0.png"),
        );
        if (check) {
          item["thumbnailUrl"] = basemap.url.replace("tiles.json", "0/0/0.png");
        } else {
          item["thumbnailUrl"] = basemap.url.replace("tiles.json", "0/0/0.jpg");
        }
      } else {
        const check = await isImgUrl(
          basemap.url.replace("style.json", "0/0/0.png"),
        );
        if (check) {
          item["thumbnailUrl"] = basemap.url.replace("style.json", "0/0/0.png");
        } else {
          item["thumbnailUrl"] = basemap.url.replace("style.json", "0/0/0.jpg");
        }
      }
      basemaps.push(item as Basemap);
    }
  }
  basemapList.value = basemaps;
});

const refreshActiveLayer = () => {
  setTimeout(() => {
    let current = JSON.parse(JSON.stringify(mapLayerStore.groupedActiveLayers));
    mapLayerStore.groupedActiveLayers = [...current];
  }, 500);
};

const handleChangeBasemap = async (name: string, url: string, type: string) => {
  if (map && mapLoad) {
    if (type === "raster") {
      map.setStyle({
        version: 8,
        sprite: window.location.origin + "/panel/sprites/sprite",
        glyphs: "/font/{fontstack}/{range}.pbf",
        sources: {
          "basemap-sources": {
            type: "raster",
            tiles: [url],
            tileSize: 256,
          },
        },
        layers: [
          {
            id: "basemap-tiles",
            type: "raster",
            source: "basemap-sources",
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      });
      refreshActiveLayer();
    } else if (type === "tile") {
      const tile: RasterTileSource = await $fetch(url);
      const style: StyleSpecification = {
        version: 8,
        sprite: window.location.origin + "/panel/sprites/sprite",
        glyphs: "/font/{fontstack}/{range}.pbf",
        sources: {
          "basemap-sources": {
            type: "raster",
            tiles: tile.tiles,
            tileSize: 256,
          },
        },
        layers: [
          {
            id: "basemap-tiles",
            type: "raster",
            source: "basemap-sources",
            minzoom: 0,
            maxzoom: 22,
          },
        ],
      };
      map.setStyle(style);
      refreshActiveLayer();
    } else {
      map.setStyle(url);
      refreshActiveLayer();
    }
    setCurrentBaseMap(name);
  }
};
</script>

<template>
  <div v-for="basemap in basemapList" :key="basemap.name">
    <MenuItem
      v-slot="{ active }"
      @click="handleChangeBasemap(basemap.name, basemap.url, basemap.type)"
    >
      <button
        :class="[
          active ? 'bg-grey-700' : 'bg-transparent text-grey-200',
          currentBasemap === basemap.name &&
            'bg-gradient-to-r from-blue-200/80 to-blue-600 text-white',
          'group flex w-full items-center gap-3 rounded-xxs p-2 text-xs text-grey-900 hover:bg-gradient-to-r hover:from-blue-200/80 hover:to-blue-600 hover:text-white',
        ]"
      >
        <NuxtImg
          width="64px"
          height="64px"
          class="rounded-xxs"
          :src="basemap.thumbnailUrl"
        />
        {{ basemap.name }}
      </button>
    </MenuItem>
  </div>
</template>
