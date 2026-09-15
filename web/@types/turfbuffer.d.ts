// types/buffer.d.ts
declare module "@turf/buffer" {
  import { FeatureCollection } from "@turf/helpers";

  /**
   * Plans a buffer around the given feature.
   *
   * @param feature The feature to buffer.
   * @param radius The radius of the buffer.
   * @param options Optional parameters for buffering.
   * @returns A new Feature representing the buffered area.
   */
  export default function buffer(
    feature: FeatureCollection,
    radius: number,
    options?: {
      units?:
        | "kilometers"
        | "meters"
        | "miles"
        | "feet"
        | "yards"
        | "inches"
        | "nauticalmiles"
        | "centimeters";
      steps?: number;
    }
  ): FeatureCollection;
}
