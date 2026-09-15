import { read, utils } from "xlsx";

import BoundsWorker from "~/utils/worker/bounds?worker";

onmessage = async (event: MessageEvent<File>) => {
  const parsed: { fileName: string; geojsonObj: GeoJSON.FeatureCollection }[] =
    [];
  try {
    const workbook = read(await event.data.arrayBuffer());
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const data = utils.sheet_to_json<{ [key: string]: any }>(sheet);
      if (!data.length) {
        throw new Error(`${sheetName} in loaded file is empty`);
      }
      if (!Object.hasOwn(data[0], "lon")) {
        throw new Error(`Missing "lon" column in sheet ${sheetName}`);
      }
      if (!Object.hasOwn(data[0], "lat")) {
        throw new Error(`Missing "lat" column in sheet ${sheetName}`);
      }

      const features: GeoJSON.Feature[] = [];
      for (const row of data) {
        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [row.lon, row.lat] },
          properties: row,
        });
      }
      parsed.push({
        fileName: `${event.data.name}_${sheetName}`,
        geojsonObj: { type: "FeatureCollection", features },
      });
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message || "Error parsing file"
        : "Error parsing file";
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
      data: GeoJSON.Polygon[];
    }>
  ) => {
    const { data } = e.data;
    let results;
    if (parsed.length === 1) {
      results = { geojsonObj: parsed[0].geojsonObj, bounds: data[0] };
    } else {
      results = parsed.map((el, i) => {
        return {
          fileName: el.fileName,
          geojsonObj: el.geojsonObj,
          bounds: data[i],
        };
      });
    }
    postMessage({
      status: "success",
      data: results,
    });
    boundsWorker.terminate();
  };
  boundsWorker.postMessage(parsed.map((el) => el.geojsonObj));
};
