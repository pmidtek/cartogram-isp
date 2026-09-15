import { TCXLoader } from "@loaders.gl/kml";

import BoundsWorker from "~/utils/worker/bounds?worker";

onmessage = async (event: MessageEvent<File>) => {
  let parsed: GeoJSON.FeatureCollection;
  try {
    parsed = (await TCXLoader.parse(
      await event.data.arrayBuffer()
    )) as GeoJSON.FeatureCollection;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message || "Error parsing TCX"
        : "Error parsing TCX";
    postMessage({ status: "error", message, data: error });
    return;
  }
  const boundsWorker = new BoundsWorker();
  boundsWorker.onerror = (e) => {
    postMessage({ status: "error", data: e.error, message: e.message });
    boundsWorker.terminate();
  };
  boundsWorker.onmessage = (
    e: MessageEvent<{
      status: string;
      data: GeoJSON.Polygon;
    }>
  ) => {
    const { data } = e.data;
    postMessage({
      status: "success",
      data: {
        geojsonObj: parsed,
        bounds: data,
      },
    });
    boundsWorker.terminate();
  };
  boundsWorker.postMessage(parsed);
};
