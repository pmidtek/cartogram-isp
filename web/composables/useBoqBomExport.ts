import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface ExportOptions {
  boqBomData: any;
  isPriceDefault: boolean;
  routeDistance: number;
  pointsCount: number;
  analysisType?: string;
}

export const useBoqBomExport = () => {
  const toast = useToast();
  const { captureMapImage } = useMapScreenshot();

  /**
   * Format currency to IDR format
   */
  const formatCurrency = (value: number): string => {
    return `IDR ${new Intl.NumberFormat("en-US").format(value)}`;
  };

  /**
   * Format number with thousand separators
   */
  const formatNumber = (value: number | string): string => {
    const num = typeof value === "string" ? parseFloat(value) : value;
    return new Intl.NumberFormat("en-US").format(num);
  };

  /**
   * Export BOQ/BOM data to PDF
   */
  const exportToPdf = async (options: ExportOptions): Promise<void> => {
    const {
      boqBomData,
      isPriceDefault,
      routeDistance,
      pointsCount,
      analysisType,
    } = options;

    try {
      // Create new PDF document
      const doc = new jsPDF({
        orientation: "portrait",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const margin = 15;
      let yPos = margin;

      // ===== COVER PAGE =====
      // Header
      doc.setFontSize(24);
      doc.setFont("helvetica", "bold");
      doc.text("BOQ/BOM Calculation Report", pageWidth / 2, yPos, {
        align: "center",
      });
      yPos += 15;

      // Subtitle
      doc.setFontSize(12);
      doc.setFont("helvetica", "normal");
      const currentDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      doc.text(`Generated on ${currentDate}`, pageWidth / 2, yPos, {
        align: "center",
      });
      yPos += 20;

      // Price Type Badge
      if (isPriceDefault) {
        doc.setFillColor(59, 130, 246); // Blue
      } else {
        doc.setFillColor(34, 197, 94); // Green
      }
      doc.roundedRect(margin, yPos, 60, 10, 2, 2, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(10);
      doc.setFont("helvetica", "bold");
      doc.text(
        isPriceDefault ? "Default Price" : "Defined Cost",
        margin + 30,
        yPos + 6.5,
        { align: "center" }
      );
      doc.setTextColor(0, 0, 0);
      yPos += 20;

      // Analysis Metadata
      doc.setFontSize(11);
      doc.setFont("helvetica", "bold");
      doc.text("Analysis Information", margin, yPos);
      yPos += 8;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);

      const metadata = [
        ["Analysis Type:", analysisType || "Draw Polygon"],
        ["Route Distance:", `${(routeDistance / 1000).toFixed(2)} km`],
        ["Number of Points:", pointsCount.toString()],
      ];

      metadata.forEach(([label, value]) => {
        doc.text(label, margin + 5, yPos);
        doc.text(value, margin + 70, yPos);
        yPos += 6;
      });
      yPos += 10;

      // Build BOQ categories list (material / homepass / homeconnect)
      const categoryOrder = ["material", "homepass", "homeconnect"];
      const boqCategories = (boqBomData?.boq
        ? categoryOrder
            .map((key) =>
              boqBomData.boq[key] ? { key, ...boqBomData.boq[key] } : null
            )
            .filter(Boolean)
        : []) as any[];

      const totalCost: number = (() => {
        const fromMaterial = boqBomData?.boq?.material?.summary?.total_cost;
        if (typeof fromMaterial === "number") return fromMaterial;
        return boqCategories.reduce(
          (acc: number, c: any) => acc + (Number(c?.group_total) || 0),
          0
        );
      })();

      // Total Cost Summary
      if (totalCost > 0) {
        doc.setFillColor(219, 234, 254);
        doc.roundedRect(margin, yPos, pageWidth - 2 * margin, 25, 3, 3, "F");

        doc.setFontSize(11);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(75, 85, 99);
        doc.text("Total Estimated Project Cost", margin + 5, yPos + 8);

        doc.setFontSize(16);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(17, 24, 39);
        doc.text(formatCurrency(totalCost), margin + 5, yPos + 18);
        doc.setTextColor(0, 0, 0);
        yPos += 35;
      }

      // ===== MAP IMAGE ON FIRST PAGE =====
      const mapImage = await captureMapImage(0.85, 1200);
      if (mapImage) {
        // Add section title
        doc.setFontSize(11);
        doc.setFont("helvetica", "bold");
        doc.text("Project Location Map", margin, yPos);
        yPos += 8;

        // Get actual image dimensions to preserve aspect ratio
        const img = new Image();
        await new Promise<void>((resolve) => {
          img.onload = () => resolve();
          img.src = mapImage;
        });

        // Calculate dimensions to fit remaining space on first page
        const maxWidth = pageWidth - 2 * margin;
        const maxHeight = pageHeight - yPos - margin - 10; // Leave space for footer

        const imgAspectRatio = img.width / img.height;
        let imgWidth = maxWidth;
        let imgHeight = imgWidth / imgAspectRatio;

        // If height exceeds available space, scale down based on height
        if (imgHeight > maxHeight) {
          imgHeight = maxHeight;
          imgWidth = imgHeight * imgAspectRatio;
        }

        // Center the image horizontally if it's narrower than max width
        const xPosition = margin + (maxWidth - imgWidth) / 2;

        doc.addImage(mapImage, "JPEG", xPosition, yPos, imgWidth, imgHeight);
      }

      // ===== BOQ TABLE (grouped by category and group) =====
      if (boqCategories.length > 0) {
        doc.addPage();
        yPos = margin;

        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.text("Bill of Quantity (BOQ)", margin, yPos);
        yPos += 10;

        for (const category of boqCategories) {
          // Category heading
          doc.setFontSize(12);
          doc.setFont("helvetica", "bold");
          doc.text(
            `${category.group_name} — ${formatCurrency(
              Number(category.group_total) || 0
            )}`,
            margin,
            yPos
          );
          yPos += 6;

          const groups = Array.isArray(category.groups) ? category.groups : [];
          for (const group of groups) {
            doc.setFontSize(10);
            doc.setFont("helvetica", "bold");
            doc.text(
              `${group.name} (${formatCurrency(Number(group.total) || 0)})`,
              margin,
              yPos
            );
            yPos += 4;

            const rows = Array.isArray(group.rows) ? group.rows : [];
            const tableBody = rows.map((row: any) => [
              row.description || row.code || "",
              formatNumber(Number(row.qty) || 0),
              row.uom || "",
              formatCurrency(Number(row.price) || 0),
              formatCurrency(Number(row.total) || 0),
            ]);

            autoTable(doc, {
              startY: yPos,
              head: [["Item", "Quantity", "Unit", "Unit Cost", "Total Cost"]],
              body: tableBody.length
                ? tableBody
                : [["No items", "-", "-", "-", "-"]],
              theme: "grid",
              styles: {
                fontSize: 9,
                cellPadding: 3,
              },
              headStyles: {
                fillColor: [59, 130, 246],
                textColor: 255,
                fontStyle: "bold",
                halign: "center",
              },
              columnStyles: {
                0: { cellWidth: 60 },
                1: { halign: "center", cellWidth: 20 },
                2: { halign: "center", cellWidth: 18 },
                3: { halign: "right", cellWidth: 40 },
                4: { halign: "right", cellWidth: 42 },
              },
              margin: { left: margin, right: margin },
            });

            yPos = (doc as any).lastAutoTable.finalY + 6;

            if (yPos > pageHeight - 30) {
              doc.addPage();
              yPos = margin;
            }
          }

          yPos += 4;
        }

        // Grand total
        if (totalCost > 0) {
          if (yPos > pageHeight - 25) {
            doc.addPage();
            yPos = margin;
          }
          doc.setFillColor(243, 244, 246);
          doc.rect(margin, yPos, pageWidth - 2 * margin, 10, "F");

          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.text("Total Project Cost:", pageWidth - margin - 50, yPos + 7, {
            align: "right",
          });
          doc.text(
            formatCurrency(totalCost),
            pageWidth - margin - 5,
            yPos + 7,
            { align: "right" }
          );
        }
      }

      // ===== BOM TABLE (new shape: bom is null/undefined for now) =====
      if (boqBomData?.bom) {
        // No-op when BOM data is not yet available in the new API.
      }

      // ===== FOOTER ON ALL PAGES =====
      const totalPages = doc.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(128, 128, 128);

        // Page number
        doc.text(`Page ${i} of ${totalPages}`, pageWidth / 2, pageHeight - 10, {
          align: "center",
        });

        // Watermark
        doc.text(
          "Generated by Dashboard",
          pageWidth - margin,
          pageHeight - 10,
          { align: "right" }
        );
      }

      // Save the PDF
      const timestamp = new Date().getTime();
      const fileName = `BOQ_BOM_Report_${timestamp}.pdf`;
      doc.save(fileName);
    } catch (error) {
      console.error("Error generating PDF:", error);
      toast.add({
        title: "Export Failed",
        description: "Failed to generate PDF. Please try again.",
        color: "red",
        icon: "i-heroicons-x-circle",
        ui: {
          background: "bg-white",
          title: "text-grey-800",
        },
      });
    }
  };

  return {
    exportToPdf,
  };
};
