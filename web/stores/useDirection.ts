import type { GeoJSONSource, LngLatBoundsLike } from "maplibre-gl";
import { defineStore } from "pinia";
import { orsApiKey } from "~/constants";
import marker from "~/assets/images/marker.png";
import waypoint from "~/assets/images/waypoint.png";
import type { Raw } from "vue";

const defaultLocations = [
  {
    id: "default-id-1",
    feature: null,
    label: "",
  },
  {
    id: "default-id-2",
    feature: null,
    label: "",
  },
];

export type DirectionProfile =
  | "driving-car"
  | "cycling-road"
  | "driving-hgv"
  | "foot-walking";

export const useDirection = defineStore("direction", () => {
  const toast = useToast();
  const mapStore = useMapRef();

  const focusedInputId = ref<null | string>();
  const markerRef = ref<null | Raw<any>>(null);
  const removeMarker = () => {
    markerRef.value?.remove();
    markerRef.value = null;
  };

  const directionProfile = ref<DirectionProfile>("driving-car");

  const locations =
    ref<{ id: string; feature: GeoJSON.Feature | null; label?: string }[]>(
      defaultLocations
    );

  const directions = ref<GeoJSON.FeatureCollection | null>(null);

  const updateLocations = (
    id: string,
    newFeature: GeoJSON.Feature | null,
    newLabel: string
  ) => {
    const indexToUpdate = locations.value.findIndex((el) => el.id === id);
    locations.value[indexToUpdate].feature = newFeature;
    locations.value[indexToUpdate].label = newLabel;
  };

  const reverseLocations = () => {
    const current = [...locations.value];
    locations.value = current.reverse();
  };

  const deleteLocationsById = (id: string) => {
    const indexToUpdate = locations.value.findIndex((el) => el.id === id);
    locations.value[indexToUpdate].feature = null;
    locations.value[indexToUpdate].label = "";
  };

  const getDirections = async (coordinates: any) => {
    try {
      const response = await fetch(
        `https://api.openrouteservice.org/v2/directions/${directionProfile.value}/geojson`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: orsApiKey,
          },
          body: JSON.stringify({
            coordinates: coordinates,
          }),
        }
      );
      const result = await response.json();

      if (result.errors?.length) throw new Error(result.errors[0].message);

      directions.value = result;
      mapStore.map?.fitBounds(result.bbox as LngLatBoundsLike, {
        maxZoom: 17,
        padding: 100,
      });
      addDirectionsLayer(result.features);
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : "Something went wrong. Please try again.";
      toast.add({
        title: message,
        icon: "i-heroicons-x-mark",
        ui: {
          background: "bg-white",
          title: "text-gray-900 text-md font-semibold",
          description: "text-gray-500",
          icon: "text-blue-500",
        },
      });
    }
  };

  const addDirectionsLayer = async (features: GeoJSON.Feature[]) => {
    const sourceData = [...features];
    for (const wayPoint of features[0].properties?.way_points) {
      sourceData.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: (features as any)[0].geometry.coordinates[wayPoint],
        },
        properties: {
          endPoint:
            wayPoint === (features as any)[0].geometry.coordinates.length - 1
              ? true
              : false,
        },
      });
    }

    if (!mapStore.map?.getSource("ors-directions")) {
      const markerImg = new Image(28, 28);
      markerImg.src = marker;
      markerImg.onload = () => {
        if (mapStore.map && !mapStore.map.hasImage("destination-marker")) {
          mapStore.map.addImage("destination-marker", markerImg);
        }
      };

      const waypointImg = new Image(24, 24);
      waypointImg.src = waypoint;
      waypointImg.onload = () => {
        if (mapStore.map && !mapStore.map.hasImage("waypoint-marker")) {
          mapStore.map.addImage("waypoint-marker", waypointImg);
        }
      };

      mapStore.map?.addSource("ors-directions", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: sourceData,
        },
      });

      mapStore.map?.addLayer({
        type: "line",
        source: "ors-directions",
        id: "ors-direction-line",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": getBrandColor("500"),
          "line-width": 6,
          "line-opacity": 0.9,
        },
        filter: ["==", "$type", "LineString"],
      });

      mapStore.map?.addLayer({
        type: "symbol",
        layout: {
          "icon-image": [
            "case",
            ["==", ["get", "endPoint"], true],
            "destination-marker",
            "waypoint-marker",
          ],
          "icon-offset": [
            "case",
            ["==", ["get", "endPoint"], true],
            ["literal", [0, -14]],
            ["literal", [0, 0]],
          ],
        },
        source: "ors-directions",
        id: "ors-direction-symbol",
        filter: ["==", "$type", "Point"],
      });
    } else {
      (mapStore.map!.getSource("ors-directions") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: sourceData,
      });
    }
  };

  const reset = () => {
    locations.value = [
      {
        id: "default-id-1",
        feature: null,
        label: "",
      },
      {
        id: "default-id-2",
        feature: null,
        label: "",
      },
    ];

    directions.value = null;
    if (mapStore.map!.getSource("ors-directions")) {
      mapStore.map?.removeLayer("ors-direction-line");
      mapStore.map?.removeLayer("ors-direction-symbol");
      mapStore.map?.removeSource("ors-directions");
    }
  };

  return {
    focusedInputId,
    directionProfile,
    locations,
    updateLocations,
    reverseLocations,
    deleteLocationsById,
    getDirections,
    reset,
    markerRef,
    removeMarker,
  };
});
