<script setup lang="ts">
import { Tile3DLayer } from "@deck.gl/geo-layers";
import type { Tile3DLayerProps } from "@deck.gl/geo-layers";
import { Tiles3DLoader } from "@loaders.gl/3d-tiles";

const mapStore = useMapRef();
const featureStore = useFeature();

const props = defineProps<{
  data: ThreeDTiles[];
}>();

const mapLayerStore = useMapLayer();
const updateBounds = (id: string, center: [number, number], zoom: number) => {
  const prev: ThreeDLayerCenter[] = [...mapLayerStore.threeDLayerCenter];
  prev.push({ id, center, zoom });
  mapLayerStore.threeDLayerCenter = prev;
};

const layers = computed(() => {
  return props.data.map(
    (layer) =>
      new Tile3DLayer({
        id: layer.layer_id,
        data: "/panel/3d-tiles/" + layer.layer_id + "/tileset.json",
        opacity: layer.opacity,
        pointSize: layer.point_size || 1,
        visible: layer.layer_style.layout_visibility === "visible",
        loader: Tiles3DLoader,
        getPointColor: layer.point_color
          ? [
              hexToRgb(layer.point_color).r,
              hexToRgb(layer.point_color).g,
              hexToRgb(layer.point_color).b,
              100,
            ]
          : [200, 200, 200, 100],
        onTilesetLoad: (tileset: any) => {
          const { cartographicCenter, zoom } = tileset;
          updateBounds(
            layer.layer_id,
            [cartographicCenter[0], cartographicCenter[1]],
            zoom
          );
        },
        pickable: true,
        onClick: (info: any, event: any) => {
          if (info.object) {
            console.log(info.object);
            const { boundingVolume, children, ...header } = info.object.header;
            const {
              cartesianModelMatrix,
              cartographicModelMatrix,
              featureTableBinary,
              header: contentHeader,
              modelMatrix,
              attributes,
              ...content
            } = info.object.content;
            featureStore.set3DFeature({
              header,
              content,
            });
            featureStore.setRightSidebar("3d-feature");
          }
          event.preventDefault();
          event.stopPropagation();
        },
        onHover: ({ object, x, y }) => {
          const el = mapStore.map?.getCanvas()!; // Access the map canvas element
          if (object) {
            el.style.cursor = "pointer"; // Change cursor to pointer when hovering over an object
          } else {
            el.style.cursor = ""; // Reset cursor when not hovering over an object
          }
        },
      } as Tile3DLayerProps<unknown>)
  );
});
</script>

<template>
  <MapLayerDeckGLOverlay :layers="layers" />
</template>
