import { GeoPackageLoader } from "@loaders.gl/geopackage";

import BoundsWorker from "~/utils/worker/bounds?worker";

onmessage = async (event: MessageEvent<File>) => {
  let parsed: GeoJSON.FeatureCollection;
  try {
    parsed = (await GeoPackageLoader.parse(await event.data.arrayBuffer(), {
      geopackage: {
        shape: "geojson-table",
        sqlJsCDN: "https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.8.0/",
      },
    })) as GeoJSON.FeatureCollection;
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message || "Error parsing Geopackage"
        : "Error parsing Geopackage";
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
