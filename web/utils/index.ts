import type { GeoJSONSource, Map } from "maplibre-gl";
import type { MapData, GeneralSettings, AuthPayload, ChartData } from "./types";
import type { Raw } from "vue";
import tailwindConfig from "~/tailwind.config";

export const getBrandColor = (colorStep: string): string =>
  (tailwindConfig.theme?.colors as any).brand[colorStep];

export const useMapData = async () => {
  const { pending, data } = await useFetch<MapData>("/panel/items/map/eng", {
    key: "map",
  });
  return { data, isLoading: pending };
};

export const useChartScore = async () => {
  const authStore = useAuth();
  const { pending, data } = await useFetch<ChartData[]>(
    "/panel/chart/count/kab/house_class",
    {
      key: "map",
      method: "POST",
      headers: {
        Authorization: `Bearer ${authStore.accessToken}`,
      },
    },
  );
  return { data, isLoading: pending };
};

export const useSharedMap = async () => {
  const route = useRoute();
  if (route.query.share_id) {
    const { data } = await useFetch<{ data: { map_state: any } }>(
      `/panel/items/shared_map/${route.query.share_id}`,
      { key: "sharedMap" },
    );
    return data;
  }
};

export const useGeneralSettings = async () => {
  const { pending, data } = await useFetch<GeneralSettings>("/panel/settings", {
    key: "settings",
  });
  return { data, isLoading: pending };
};

export const moveHighlightLayer = (map: Map, layerName: string) => {
  // Find the layer that comes after 'targetLayer', if it exists
  const layers = map.getStyle().layers;
  let targetIndex = layers.findIndex((layer) => layer.id === layerName);
  let layerAboveTarget;
  if (targetIndex !== -1 && targetIndex < layers.length - 1) {
    layerAboveTarget = layers[targetIndex + 1].id;
  }

  map.moveLayer("highlight-point-pulsing", layerAboveTarget);
  map.moveLayer("highlight-line-background", layerAboveTarget);
  map.moveLayer("highlight-line-dashed", layerAboveTarget);
  map.moveLayer("highlight-fill-background", layerAboveTarget);
  map.moveLayer("highlight-fill-outline", layerAboveTarget);
};

// === Animate polyline ===
// technique based on https://jsfiddle.net/2mws8y3q/
const dashArraySequence = [
  [0, 4, 3],
  [0.5, 4, 2.5],
  [1, 4, 2],
  [1.5, 4, 1.5],
  [2, 4, 1],
  [2.5, 4, 0.5],
  [3, 4, 0],
  [0, 0.5, 3, 3.5],
  [0, 1, 3, 3],
  [0, 1.5, 3, 2.5],
  [0, 2, 3, 2],
  [0, 2.5, 3, 1.5],
  [0, 3, 3, 1],
  [0, 3.5, 3, 0.5],
];
let frameId: number | null = null; // To keep track of the animation frame request
let step = 0;

function startPolylineAnimation(map: Map) {
  // Function to perform the animation
  function animateDashArray(timestamp: DOMHighResTimeStamp) {
    const newStep = Math.floor((timestamp / 60) % dashArraySequence.length);

    if (newStep !== step) {
      map.setPaintProperty(
        "highlight-line-dashed",
        "line-dasharray",
        dashArraySequence[newStep],
      );
      step = newStep;
    }

    // Continue requesting the next frame
    frameId = requestAnimationFrame(animateDashArray);
  }

  if (frameId === null) {
    // Prevent multiple animations from being started
    frameId = requestAnimationFrame(animateDashArray);
  }
}

// === Animate polygon ===
let opacityInterval: NodeJS.Timeout | null = null;

// const startPolygonAnimation = (map: Map) => {
//   // Prevent multiple intervals from being created
//   if (opacityInterval !== null) return;

//   // Check if the polygon layer exists before animating
//   if (!map.getLayer("highlight-fill-background")) return;

//   opacityInterval = setInterval(() => {
//     // Check if layer still exists before accessing properties
//     if (!map.getLayer("highlight-fill-background")) {
//       if (opacityInterval !== null) {
//         clearInterval(opacityInterval);
//         opacityInterval = null;
//       }
//       return;
//     }

//     const currentOpacity = map.getPaintProperty(
//       "highlight-fill-background",
//       "fill-opacity"
//     );
//     const newOpacity = currentOpacity === 0.6 ? 0 : 0.6; // Toggle between 0 and 0.6
//     map.setPaintProperty(
//       "highlight-fill-background",
//       "fill-opacity",
//       newOpacity
//     );
//   }, 900);
// };

// export const startAllAnimation = (map: Map) => {
//   startPolygonAnimation(map);
//   startPolylineAnimation(map);
// };

function pausePolylineAnimation() {
  if (frameId !== null) {
    cancelAnimationFrame(frameId);
    frameId = null; // Reset the frameId to indicate the animation is not running
  }
}
const pausePolygonAnimation = () => {
  if (opacityInterval !== null) {
    clearInterval(opacityInterval);
    opacityInterval = null; // Reset the interval variable
  }
};

export const pauseAllAnimation = () => {
  pausePolylineAnimation();
  pausePolygonAnimation();
};

export const addHighlightLayer = (map: Map) => {
  map.addSource("highlight", {
    type: "geojson",
    data: {
      type: "FeatureCollection",
      features: [],
    },
  });

  map.addLayer({
    type: "symbol",
    source: "highlight",
    id: "highlight-point-pulsing",
    layout: {
      "icon-image": "pulsing-dot",
    },
    filter: ["==", "$type", "Point"],
  });

  map.addLayer({
    type: "line",
    source: "highlight",
    id: "highlight-line-background",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": getBrandColor("500"),
      "line-width": 6,
      "line-opacity": 0.9,
    },
    filter: ["==", "$type", "LineString"],
  });

  map.addLayer({
    type: "line",
    source: "highlight",
    id: "highlight-line-dashed",
    layout: { "line-join": "round" },
    paint: {
      "line-color": getBrandColor("50"),
      "line-width": 6,
      "line-dasharray": dashArraySequence[0],
    },
    filter: ["==", "$type", "LineString"],
  });

  map.addLayer({
    type: "fill",
    source: "highlight",
    id: "highlight-fill-background",
    paint: {
      "fill-color": getBrandColor("600"),
      "fill-opacity": 0.6,
      "fill-opacity-transition": {
        duration: 900,
        delay: 0,
      },
    } as any,
    filter: ["==", "$type", "Polygon"],
  });

  map.addLayer({
    type: "line",
    source: "highlight",
    id: "highlight-fill-outline",
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": getBrandColor("300"),
      "line-width": 6,
      "line-opacity": 0.9,
    },
    filter: ["==", "$type", "Polygon"],
  });
};

export const showHighlightLayer = (
  map: Raw<Map>,
  featureList: { geom: GeoJSON.Geometry }[],
  layerName: string,
  isAll?: boolean,
) => {
  const newData: GeoJSON.FeatureCollection = {
    type: "FeatureCollection",
    features: featureList
      .filter((_, idx) => (isAll ? true : idx === 0))
      .map(({ geom, ...rest }) => ({
        type: "Feature",
        properties: rest,
        geometry: geom,
      })),
  };
  if (!map.getSource("highlight")) {
    addHighlightLayer(map);
  }

  (map.getSource("highlight") as GeoJSONSource).setData(newData);
  moveHighlightLayer(map, layerName);
  // if (frameId === null && opacityInterval === null) startAllAnimation(map);
  // console.log(featureList[0].geom.type);
};

export const createPulsingDot = ({
  map,
  size,
  strokeStyle,
  fillStyle,
}: {
  map: Map;
  size: number;
  strokeStyle: string;
  fillStyle?: string;
}) => ({
  width: size,
  height: size,
  data: new Uint8Array(size * size * 4),
  context: null as CanvasRenderingContext2D | null,

  // When the layer is added to the map,
  // get the rendering context for the map canvas.
  onAdd: function () {
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    this.context = canvas.getContext("2d");
  },

  // Call once before every frame where the icon will be used.
  render: function () {
    const duration = 1000;
    const t = (performance.now() % duration) / duration;

    const radius = (size / 2) * 0.3;
    const outerRadius = (size / 2) * 0.7 * t + radius;
    const context = this.context;

    // Draw the outer circle.
    context!.clearRect(0, 0, this.width, this.height);
    context!.beginPath();
    context!.arc(this.width / 2, this.height / 2, outerRadius, 0, Math.PI * 2);
    context!.fillStyle = `rgba(255, 200, 200, ${1 - t})`;
    context!.fill();

    // Draw the inner circle.
    context!.beginPath();
    context!.arc(this.width / 2, this.height / 2, radius, 0, Math.PI * 2);
    // context!.fillStyle = "rgba(255, 100, 100, 1)";
    if (fillStyle) {
      context!.fillStyle = fillStyle;
    }
    context!.strokeStyle = strokeStyle;
    context!.lineWidth = 2 + 4 * (1 - t);
    context!.fill();
    context!.stroke();

    // Update this image's data with data from the canvas.
    this.data = context!.getImageData(0, 0, this.width, this.height)
      .data as any;

    // Continuously repaint the map, resulting
    // in the smooth animation of the dot.
    map.triggerRepaint();

    // Return `true` to let the map know that the image was updated.
    return true;
  },
});

export const capitalizeEachWords = (text: string) => {
  const splitText = text.split("_");

  for (let i = 0; i < splitText.length; i++) {
    if (splitText[i]) {
      splitText[i] = splitText[i][0].toUpperCase() + splitText[i].substring(1);
    } else {
      splitText[i] = "";
    }
  }

  return splitText.join(" ");
};

export const refreshTokenKey = "geo_refresh";

export function isString(value: any) {
  return typeof value === "string";
}

export function parseString(input: string) {
  try {
    const parsed = JSON.parse(input);
    if (Array.isArray(parsed)) {
      return parsed;
    } else if (typeof parsed === "number") {
      return parsed;
    }
  } catch (e) {
    // Do nothing, will return the input string
  }
  return input;
}

export function debounce(func: Function, wait: number) {
  let timeout: NodeJS.Timeout;

  return function executedFunction(...args: any[]) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export const emptyFeatureCollection: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};
