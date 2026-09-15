interface GeoJSONHintOptions {
  noDuplicateMembers?: boolean;
  precisionWarning?: boolean;
  ignoreRightHandRule?: boolean;
}

declare module "@mapbox/geojsonhint/lib/object" {
  export function hint(
    gj: string | GeoJSON.GeoJSON,
    options?: GeoJSONHintOptions
  ): Map<string, string>[];
}
