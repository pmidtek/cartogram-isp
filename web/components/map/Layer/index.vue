<script lang="ts" setup>
const store = useMapLayer();
const renderedLayers = computed(() => {
  return store.groupedActiveLayers
    .map(({ layerLists }) => layerLists)
    .flat()
    .filter((el) => el.source !== "three_d_tiles");
});
const threeDRenderedLayers = computed(() => {
  return store.groupedActiveLayers?.map(({ layerLists }) => layerLists).flat();
});
</script>

<template>
  <MapLayer3D
    v-if="threeDRenderedLayers"
    :data="(threeDRenderedLayers?.filter((el) => el.source === 'three_d_tiles') as ThreeDTiles[])"
  />
  <template
    v-if="renderedLayers"
    v-for="(layerItem, index) in renderedLayers"
    :key="layerItem.layer_id"
  >
    <!-- <template v-for="layerItem in groupItem.layerLists"> -->
    <MapLayerVector
      v-if="
        layerItem.source === 'vector_tiles' ||
        layerItem.source === 'loaded_geojson'
      "
      :renderedLayers="renderedLayers"
      :order="index"
      :item="(layerItem as VectorTiles | LoadedGeoJson)"
    />
    <MapLayerRasterTerrain
      v-else-if="layerItem.source === 'raster_tiles' && layerItem.terrain_rgb"
      :renderedLayers="renderedLayers"
      :order="index"
      :item="(layerItem as RasterTiles)"
    />
    <MapLayerRaster
      v-else-if="layerItem.source === 'raster_tiles'"
      :renderedLayers="renderedLayers"
      :order="index"
      :item="(layerItem as RasterTiles)"
    />
    <!-- </template> -->
  </template>
</template>
