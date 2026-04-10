/**
 * Deterministic parser for AOG Living "Rent Roll" format (produced by ResMan).
 *
 * Detection: A3 (row 2, col 0) contains "AOG Living" AND A4 (row 3, col 0) = "Rent Roll"
 *
 * Layout (confirmed from The Paramount - Rent Roll - 20260112.xlsx):
 *   Row 0: blank
 *   Row 1: property name  ("The Paramount")
 *   Row 2: "AOG Living "
 *   Row 3: "Rent Roll"
 *   Row 4: report date  ("1/12/2026")
 *   Row 5: "Printed …"
 *   Row 6: blank
 *   Row 7: "Current"
 *   Row 8: column header row (null, "Unit", "Type", null, "Sq. Feet", "Residents", …, "Status", …, "Market Rent")
 *   Row 9+: anchor rows (col 0 = unit number) + continuation rows (col 0 null)
 *
 * Column mapping for anchor rows (0-indexed):
 *   0  Unit ID        2  Type (PlanID)   4  Sq. Feet (NetSF)
 *   5  Residents      10 Status ("C" = current, null = vacant)
 *  12  Market Rent
 *
 * No lease dates or in-place rent available in this format.
 * Vacant: col 5 = "Vacant Unit"
 * Stop: col 0 = "Totals" or col 0 starts with "*"
 */

import type { ParsedRentRoll, ParsedUnit, RawCharge } from "./yardi-parser";
import { CHARGE_CODE_SLOTS, dateToExcelSerial } from "./yardi-parser";

function assignCodesToSlots(charges: RawCharge[]): (number | null)[] {
  const result: (number | null)[] = new Array(CHARGE_CODE_SLOTS.length).fill(null);
  const used = new Array(CHARGE_CODE_SLOTS.length).fill(false);
  for (const charge of charges) {
    for (let i = 0; i < CHARGE_CODE_SLOTS.length; i++) {
      if (CHARGE_CODE_SLOTS[i] === charge.code && !used[i]) {
        result[i] = charge.amount;
        used[i] = true;
        break;
      }
    }
  }
  return result;
}

// ─── Detection ───────────────────────────────────────────────────

export async function isAOGFormat(buffer: Buffer): Promise<boolean> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  if (!wb.SheetNames.length) return false;
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  const a3 = String(data[2]?.[0] ?? "").toLowerCase();
  const a4 = String(data[3]?.[0] ?? "").toLowerCase().trim();
  return a3.includes("aog living") && a4 === "rent roll";
}

// ─── Parser ──────────────────────────────────────────────────────

export async function parseAOG(buffer: Buffer): Promise<ParsedRentRoll> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  const propertyName = String(rows[1]?.[0] ?? "").trim();

  // Report date at row 4: "1/12/2026" or "M/D/YYYY"
  const dateParts = String(rows[4]?.[0] ?? "").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const reportDateSerial = dateParts
    ? dateToExcelSerial(
        new Date(Number(dateParts[3]), Number(dateParts[1]) - 1, Number(dateParts[2]))
      )
    : null;

  const units: ParsedUnit[] = [];

  // Data starts at row 9 (after column header row 8)
  for (let i = 9; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const col0 = row[0];
    const col0Str = String(col0 ?? "").trim();

    // Skip blank rows and continuation rows
    if (!col0Str) continue;

    // Stop at totals or footer
    if (col0Str.toLowerCase() === "totals" || col0Str.startsWith("*")) break;

    const residentsRaw = String(row[5] ?? "").trim();
    const isVacant = residentsRaw.toLowerCase() === "vacant unit" || !residentsRaw;
    const statusVal = String(row[10] ?? "").trim();
    const occStatus: "Occupied" | "Vacant" | "Notice" = isVacant
      ? "Vacant"
      : statusVal
      ? "Occupied"
      : "Vacant";

    const mktRent = row[12] != null ? Number(row[12]) : null;
    // No in-place rent available in this format
    const inPlaceRent = null;
    const charges: RawCharge[] = [];

    units.push({
      unitId: col0Str,
      planId: String(row[2] ?? ""),
      sqFt: row[4] != null ? Number(row[4]) : null,
      residentId: isVacant ? null : residentsRaw || null,
      mktRent,
      charges,
      resDeposit: null,
      otherDeposit: null,
      moveIn: null,
      leaseExp: null,
      moveOut: null,
      balance: null,
      isFuture: false,
      occStatus,
      inPlaceRent,
      otherInc: null,
      recConc: null,
      empOtherConc: null,
      netEffRent: null,
      hasMTM: false,
      codedCharges: assignCodesToSlots(charges),
    });
  }

  return {
    propertyName,
    reportDate: reportDateSerial,
    totalUnits: units.length,
    units,
  };
}
