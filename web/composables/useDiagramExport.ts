import jsPDF from "jspdf";
import html2canvas from "html2canvas";
import { utils, writeFile } from "xlsx";
import { useMapScreenshot } from "~/composables/useMapScreenshot";
import { Map as MaplibreMap } from "maplibre-gl";

export const useDiagramExport = () => {
  const toast = useToast();
  const { captureMapImage } = useMapScreenshot();

  const exportToPdf = async (element: HTMLElement, fileName: string) => {
    try {
      const canvas = await html2canvas(element, {
        useCORS: true,
        allowTaint: true,
        scale: 2, // Higher scale for better quality
      });

      // Use JPEG for smaller file size
      const imgData = canvas.toDataURL("image/jpeg", 0.8);
      const pdf = new jsPDF("l", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      const imgWidth = canvas.width;
      const imgHeight = canvas.height;

      const widthRatio = pdfWidth / imgWidth;
      const heightRatio = pdfHeight / imgHeight;
      const scale = Math.min(widthRatio, heightRatio);

      const newWidth = imgWidth * scale;
      const newHeight = imgHeight * scale;

      const x = (pdfWidth - newWidth) / 2;
      const y = (pdfHeight - newHeight) / 2;

      pdf.addImage(imgData, "JPEG", x, y, newWidth, newHeight);
      pdf.save(`${fileName}.pdf`);
    } catch (error) {
      console.error("Error exporting to PDF:", error);
      toast.add({
        title: "Export Failed",
        description: "An error occurred while exporting to PDF.",
        color: "red",
      });
    }
  };

  const exportMapToPdf = async (mapInstance: MaplibreMap, fileName: string) => {
    try {
      const mapImage = await captureMapImage(mapInstance, 0.95, 1920);
      if (!mapImage) {
        toast.add({
          title: "Export Failed",
          description:
            "Could not capture map image. The map may not be fully loaded.",
          color: "red",
        });
        return;
      }

      const pdf = new jsPDF("l", "mm", "a4");
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();

      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => resolve();
        img.src = mapImage;
      });

      const imgWidth = img.width;
      const imgHeight = img.height;

      const widthRatio = pdfWidth / imgWidth;
      const heightRatio = pdfHeight / imgHeight;
      const scale = Math.min(widthRatio, heightRatio);

      const newWidth = imgWidth * scale;
      const newHeight = imgHeight * scale;

      const x = (pdfWidth - newWidth) / 2;
      const y = (pdfHeight - newHeight) / 2;

      pdf.addImage(mapImage, "JPEG", x, y, newWidth, newHeight);
      pdf.save(`${fileName}.pdf`);
    } catch (error) {
      console.error("Error exporting map to PDF:", error);
      toast.add({
        title: "Export Failed",
        description: "An error occurred while exporting the map to PDF.",
        color: "red",
      });
    }
  };

  return {
    exportToPdf,
    exportMapToPdf,
  };
};
