import { Map as MaplibreMap } from "maplibre-gl"; // Import Map type

export const useMapScreenshot = () => {
  const mapRefStore = useMapRef();

  const captureMapImage = async (
    mapInstance?: MaplibreMap,
    quality: number = 0.8,
    maxWidth: number = 1200
  ): Promise<string> => {
    const map = mapInstance || mapRefStore.map;

    if (!map) {
      console.warn("Map not initialized");
      return "";
    }

    try {
      // Wait for map to be fully loaded and idle
      await new Promise<void>((resolve) => {
        if (map.loaded() && map.isStyleLoaded() && !map.isMoving()) {
          resolve();
        } else {
          const checkLoaded = () => {
            if (map.loaded() && map.isStyleLoaded() && !map.isMoving()) {
              map.off("idle", checkLoaded);
              resolve();
            }
          };
          map.on("idle", checkLoaded);
        }
      });

      // Additional small delay to ensure all tiles are rendered
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Trigger a repaint to ensure fresh canvas
      map.triggerRepaint();

      // Wait one more frame for repaint
      await new Promise((resolve) => requestAnimationFrame(resolve));

      // Get canvas from map
      const canvas = map.getCanvas();

      // Validate canvas has content
      if (!canvas || canvas.width === 0 || canvas.height === 0) {
        console.error("Canvas is empty or invalid");
        return "";
      }

      // Create a temporary canvas for resizing if needed
      const originalWidth = canvas.width;
      const originalHeight = canvas.height;

      let finalCanvas = canvas;

      // Resize if canvas is too large
      if (originalWidth > maxWidth) {
        const scale = maxWidth / originalWidth;
        const newHeight = originalHeight * scale;

        const tempCanvas = document.createElement("canvas");
        tempCanvas.width = maxWidth;
        tempCanvas.height = newHeight;

        const ctx = tempCanvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(canvas, 0, 0, maxWidth, newHeight);
          finalCanvas = tempCanvas;
        }
      }

      // Convert to JPEG with compression for smaller file size
      const dataUrl = finalCanvas.toDataURL("image/jpeg", quality);

      // Verify the image is not blank (check for substantial data beyond header)
      if (dataUrl.length < 5000) {
        console.warn("Screenshot may be blank or too small");
      }

      return dataUrl;
    } catch (error) {
      console.error("Failed to capture map screenshot:", error);
      return "";
    }
  };

  return {
    captureMapImage,
  };
};
