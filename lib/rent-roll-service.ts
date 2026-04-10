/**
 * rent-roll-service.ts
 *
 * Client-side service layer for rent roll upload, export, and library operations.
 * Wraps the /api/rediq/process-rentroll and /api/rediq/download endpoints so that
 * UI components never call fetch directly. The wizard and the current page both
 * import from here — guaranteeing identical output shape regardless of which UI
 * collected the data.
 */

import type { RentRollData } from "@/lib/schemas";
import type { ParsedRentRoll } from "@/lib/yardi-parser";

export type RentRollFormat = "yardi" | "generic";

export interface ProcessRentRollResult {
  data: ParsedRentRoll | RentRollData;
  format: RentRollFormat;
}

/**
 * Upload a rent roll file to the processing endpoint and return parsed data.
 * Throws if the server returns an error.
 */
export async function processRentRoll(file: File): Promise<ProcessRentRollResult> {
  const fd = new FormData();
  fd.append("file", file);

  const res = await fetch("/api/rediq/process-rentroll", { method: "POST", body: fd });
  const j = await res.json();

  if (!j.success) throw new Error(j.error || "Processing failed");

  return { data: j.data as ParsedRentRoll | RentRollData, format: j.format as RentRollFormat };
}

/**
 * POST parsed rent roll data to the download endpoint and trigger a browser
 * file-save. Throws if the server returns an error.
 */
export async function downloadRentRoll(
  data: ParsedRentRoll | RentRollData,
  format: RentRollFormat
): Promise<void> {
  const res = await fetch("/api/rediq/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rentRoll: data, rentRollFormat: format }),
  });

  if (!res.ok) {
    const j = await res.json();
    throw new Error(j.error || "Download failed");
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    res.headers.get("Content-Disposition")?.split('filename="')[1]?.replace('"', "") ||
    "rent-roll.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Save processed rent roll data to a property's report library.
 */
export async function saveRentRollToLibrary(
  propertyId: string,
  label: string,
  data: ParsedRentRoll | RentRollData,
  format: RentRollFormat
): Promise<void> {
  const unitCount =
    format === "yardi"
      ? (data as ParsedRentRoll).totalUnits
      : (data as RentRollData).units.length;

  await fetch(`/api/properties/${propertyId}/reports`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "rentroll",
      label,
      metadata: { format, units: unitCount ?? null },
      processedData: { format, data },
    }),
  });
}
