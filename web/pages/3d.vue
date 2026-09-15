<script setup lang="ts">
import { ref, watchEffect } from "vue";
import {
  Viewer,
  TreeViewPlugin,
  NavCubePlugin,
  XKTLoaderPlugin,
  SectionPlanesPlugin,
  math,
  PointerLens,
  DistanceMeasurementsPlugin,
  DistanceMeasurementsMouseControl,
  ContextMenu,
} from "@xeokit/xeokit-sdk";

const list3D = [
  {
    id: "jembatan-sei-hampangen",
    cesium: "2418832",
    name: "Jembatan Sei Hampangen",
    src: "/panel/assets/a9b71ba2-ea8b-4022-b792-22ad35c8299f",
    long: 113.5064618088,
    lat: -1.8897180463,
    zoom: 18,
  },
  {
    id: "embung-bokondini",
    cesium: "2421499",
    name: "Embung Bokondini",
    src: "/panel/assets/06ec4c92-1aa3-49cb-bb61-fccf757f5441",
    long: 138.6670112611,
    lat: -3.6874015645,
    zoom: 18,
  },
  {
    id: "bendungan-sepaku-semoi",
    cesium: "2426584",
    name: "Bendungan Sepaku Semoi",
    src: "/panel/assets/096406c0-f3f6-47fb-9614-f4316f076f5b",
  },
  {
    id: "dermaga-logistik",
    cesium: "2426587",
    name: "Dermaga Logistik",
    src: "/panel/assets/27210f03-9449-4776-9d4e-57c2b1f6ba94",
    long: 116.72235667,
    lat: -1.1339615,
    zoom: 18,
  },
  {
    id: "basic-house",
    cesium: "000",
    name: "Basic House",
    src: "/panel/xkt/2e07eb96-a067-49d9-9cb0-8ece322bd0df",
    long: 116.72235667,
    lat: -1.1339615,
    zoom: 18,
  },
];

const queryObject = useRoute().query;

const viewerObj = ref<Viewer | null>(null);
const loaded = ref(false);

const activeMeasure = ref(false);
const activeSlice = ref(false);

onMounted(() => {
  const viewer = new Viewer({
    canvasId: "myCanvas",
    transparent: true,
  });
  viewerObj.value = viewer;
  viewer.camera.eye = [-3.933, 2.855, 27.018];
  viewer.camera.look = [4.4, 3.724, 8.899];
  viewer.camera.up = [-0.018, 0.999, 0.039];

  new TreeViewPlugin(viewer, {
    containerElement: document.getElementById("treeViewContainer")!,
    autoExpandDepth: 3, // Initially expand the root tree node
  });

  const xktLoader = new XKTLoaderPlugin(viewer);

  // TODO : dynamic selection
  const idx: number = queryObject.model ? +queryObject.model : 0;
  const sceneModel = xktLoader.load({
    id: "myModel",
    src: list3D[idx].src,
    saoEnabled: true,
    edges: false,
    dtxEnabled: true,
  } as any);

  new NavCubePlugin(viewer, {
    canvasId: "myNavCubeCanvas",
    visible: true,
    size: 250,
    alignment: "bottomRight",
    bottomMargin: 100,
    rightMargin: 10,
  } as any);

  sceneModel.on("loaded", () => {
    viewer.cameraFlight.jumpTo(sceneModel);
    loaded.value = true;
  });

  return () => {};
});

watchEffect((onCleanup) => {
  if (!loaded.value) return;

  let distanceMeasurementsPlugin: DistanceMeasurementsPlugin | undefined;

  if (activeMeasure.value) {
    distanceMeasurementsPlugin = new DistanceMeasurementsPlugin(
      viewerObj.value as Viewer
    );

    const distanceMeasurementsMouseControl =
      new DistanceMeasurementsMouseControl(distanceMeasurementsPlugin, {
        pointerLens: new PointerLens(viewerObj.value as Viewer),
      });

    distanceMeasurementsMouseControl.snapping = true;
    distanceMeasurementsMouseControl.activate();

    const distanceMeasurementsContextMenu = new ContextMenu({
      items: [
        [
          {
            title: "Clear",
            doAction: function (context: any) {
              context.distanceMeasurement.destroy();
            },
          },
          {
            getTitle: (context: any) => {
              return context.distanceMeasurement.axisVisible
                ? "Hide Axis"
                : "Show Axis";
            },
            doAction: function (context: any) {
              context.distanceMeasurement.axisVisible =
                !context.distanceMeasurement.axisVisible;
            },
          },
          {
            getTitle: (context: any) => {
              return context.distanceMeasurement.labelsVisible
                ? "Hide Labels"
                : "Show Labels";
            },
            doAction: function (context: any) {
              context.distanceMeasurement.labelsVisible =
                !context.distanceMeasurement.labelsVisible;
            },
          },
        ],
        [
          {
            title: "Clear All",
            getEnabled: function (context: any) {
              return (
                Object.keys(context.distanceMeasurementsPlugin.measurements)
                  .length > 0
              );
            },
            doAction: function (context: any) {
              context.distanceMeasurementsPlugin.clear();
            },
          },
        ],
      ],
    });

    distanceMeasurementsContextMenu.on("hidden", () => {
      if (distanceMeasurementsContextMenu.context.distanceMeasurement) {
        distanceMeasurementsContextMenu.context.distanceMeasurement.setHighlighted(
          false
        );
      }
    });
  } else {
    distanceMeasurementsPlugin?.clear();
    distanceMeasurementsPlugin?.destroy();
  }

  onCleanup(() => {
    distanceMeasurementsPlugin?.clear();
    distanceMeasurementsPlugin?.destroy();
  });
});

watchEffect((onCleanup) => {
  if (!loaded.value) return;

  let sectionPlanes: SectionPlanesPlugin | undefined;

  if (activeSlice.value) {
    sectionPlanes = new SectionPlanesPlugin(viewerObj.value as Viewer, {
      overviewCanvasId: "mySectionPlanesOverviewCanvas",
      overviewVisible: false,
    });

    const sectionPlane = sectionPlanes.createSectionPlane({
      id: "mySectionPlane",
      pos: viewerObj.value!.scene.center,
      dir: math.normalizeVec3([1.0, 0.01, 1]),
    });

    sectionPlanes.showControl(sectionPlane.id);
  } else {
    sectionPlanes?.destroy();
  }

  onCleanup(() => {
    sectionPlanes?.destroy();
  });
});
</script>

<template>
  <main class="w-screen h-screen fixed top-0 left-0">
    <canvas id="myCanvas" class="w-full h-full"></canvas>
    <canvas
      id="myNavCubeCanvas"
      class="absolute right-6 bottom-6 z-10 bg-gray-200 rounded-xs"
    ></canvas>
    <div class="z-10">
      <div
        id="treeViewContainer"
        class="absolute top-28 left-6 h-96 w-72 overflow-y-auto bg-gray-800 text-white rounded-xs p-3"
      />

      <UButtonGroup
        orientation="horizontal"
        class="absolute bottom-6 left-6 divide-x"
        :ui="{ rounded: 'rounded-sm' }"
        ><UButton
          icon="i-heroicons-scissors-20-solid"
          label="Slice"
          :color="activeSlice ? 'brand' : 'gray'"
          @click="
            () => {
              activeMeasure = false;
              activeSlice = !activeSlice;
            }
          "
        />
        <UButton
          icon="i-heroicons-cursor-arrow-rays-20-solid"
          label="Measure"
          :color="activeMeasure ? 'brand' : 'gray'"
          @click="
            () => {
              activeSlice = false;
              activeMeasure = !activeMeasure;
            }
          "
        />
      </UButtonGroup>
    </div>
  </main>
</template>
