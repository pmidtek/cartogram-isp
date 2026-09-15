import geojsonhint from "@mapbox/geojsonhint/lib/object";

import BoundsWorker from "~/utils/worker/bounds?worker";

onmessage = async (event: MessageEvent<File>) => {
  const file = event.data;
  let geojsonObj: GeoJSON.GeoJSON;
  try {
    geojsonObj = JSON.parse(await file.text());
    const geojsonError = geojsonhint.hint(geojsonObj);
    if (geojsonError.length) {
      console.error(geojsonError);
      postMessage({ status: "error", message: "Invalid GeoJSON" });
      return;
    }
  } catch (error) {
    console.error(error);
    postMessage({ status: "error", message: "Error parsing GeoJSON" });
    return;
  }

  if (geojsonObj.type === "GeometryCollection") {
    postMessage({
      status: "error",
      message: "GeometryCollection is not supported",
    });
    return;
  }

  const boundsWorker = new BoundsWorker();
  boundsWorker.onerror = (e) => {
    postMessage({ status: "error", data: e.error, message: e.message });
    boundsWorker.terminate();
  };
  boundsWorker.onmessage = (
    e: MessageEvent<{ status: string; data: GeoJSON.Polygon }>
  ) => {
    postMessage({
      status: "success",
      data: { geojsonObj, bounds: e.data.data },
    });
    boundsWorker.terminate();
  };
  boundsWorker.postMessage(geojsonObj);
};
