import bbox from "@turf/bbox";

const buildPolygon = (
  xmin: number,
  ymin: number,
  xmax: number,
  ymax: number
): GeoJSON.Polygon => {
  return {
    type: "Polygon",
    coordinates: [
      [
        [xmin, ymin],
        [xmin, ymax],
        [xmax, ymax],
        [xmax, ymin],
        [xmin, ymin],
      ],
    ],
  };
};

onmessage = (event: MessageEvent<GeoJSON.GeoJSON | GeoJSON.GeoJSON[]>) => {
  if (Array.isArray(event.data)) {
    const boundsArr: GeoJSON.Polygon[] = [];
    for (const geojson of event.data) {
      const [xmin, ymin, xmax, ymax] = bbox(geojson);
      boundsArr.push(buildPolygon(xmin, ymin, xmax, ymax));
    }
    postMessage({
      status: "success",
      data: boundsArr,
    });
  } else {
    const [xmin, ymin, xmax, ymax] = bbox(event.data);
    postMessage({
      status: "success",
      data: buildPolygon(xmin, ymin, xmax, ymax),
    });
  }
};
