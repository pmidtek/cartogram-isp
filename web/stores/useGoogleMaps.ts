import { googleMapsApiKey } from "~/constants";

export const useGoogleMaps = () => {
  const load = (): Promise<typeof google> => {
    return new Promise((resolve, reject) => {
      if (typeof window.google !== "undefined") {
        resolve(window.google);
        return;
      }

      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${googleMapsApiKey}`;
      script.async = true;
      script.onload = () => resolve(window.google);
      script.onerror = reject;
      document.head.appendChild(script);
    });
  };

  return { load };
};
