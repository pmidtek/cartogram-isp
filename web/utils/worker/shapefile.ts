import shp, { type FeatureCollectionWithFilename } from "shpjs/dist/shp"; // we use dist because of bundling issue when directly using shpjs

import BoundsWorker from "~/utils/worker/bounds?worker";

onmessage = async (event: MessageEvent<File>) => {
  const buffer = await event.data.arrayBuffer();
  let parsed: FeatureCollectionWithFilename | FeatureCollectionWithFilename[];
  try {
    parsed = await shp(buffer);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message || "Error parsing Shapefile"
        : "Error parsing Shapefile";
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
      data: GeoJSON.Polygon | GeoJSON.Polygon[];
    }>
  ) => {
    const { data } = e.data;
    if (Array.isArray(data)) {
      const results = (parsed as FeatureCollectionWithFilename[]).map(
        (el, i) => {
          return {
            fileName: el.fileName,
            geojsonObj: el,
            bounds: data[i],
          };
        }
      );
      postMessage({
        status: "success",
        data: results,
      });
    } else {
      postMessage({
        status: "success",
        data: {
          geojsonObj: parsed as FeatureCollectionWithFilename,
          bounds: data,
        },
      });
    }
    boundsWorker.terminate();
  };
  boundsWorker.postMessage(parsed);
};
