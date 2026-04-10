/**
 * Deterministic parser for RealPage OneSite "Rent Roll Detail" format.
 *
 * Detection: A1 contains "OneSite Reports" OR A2 = "RENT ROLL DETAIL"
 *
 * Layout (confirmed from 20260112_H2121_RR.xls):
 *   Row 0: "OneSite Reports - <property name>"
 *   Row 1: "RENT ROLL DETAIL"
 *   Row 2: timestamp
 *   Row 3: "As of Date: MM/DD/YYYY"
 *   Row 4: parameters
 *   Row 5: column headers
 *   Row 6+: data rows (one per resident/vacancy slot)
 *
 * Column mapping (0-indexed):
 *   0  Resh ID      1  Lease ID   2  Bldg/Unit (UnitID)  3  Floorplan (PlanID)
 *   4  Unit Designation  5  SQFT  6  Unit/Lease Status   7  Name
 *   8  Move-In (MM/DD/YYYY string)   9  Move-Out (string)
 *  10  Lease Start (string)         11  Lease End / LeaseExp (string)
 *  12  Market + Addl. (MktRent)
 *
 * Status values: "Occupied", "Occupied-NTV", "Occupied-NTVL",
 *                "Vacant", "Vacant-Leased", "Applicant"
 *
 * "Applicant" rows are skipped entirely.
 * "Occupied-NTV" / "Occupied-NTVL" → Notice (NTV = Notice To Vacate)
 */

import type { ParsedRentRoll, ParsedUnit, RawCharge } from "./yardi-parser";
import { CHARGE_CODE_SLOTS, dateToExcelSerial } from "./yardi-parser";

// ─── Helpers ─────────────────────────────────────────────────────

/** Parse "MM/DD/YYYY" string → Excel serial date, or null. */
function parseMDY(s: string | null | undefined): number | null {
  if (!s) return null;
  const str = String(s).trim();
  const parts = str.split("/");
  if (parts.length !== 3) return null;
  const [m, d, y] = parts.map(Number);
  if (!y || !m || !d) return null;
  return dateToExcelSerial(new Date(y, m - 1, d));
}

function deriveOccStatus(
  status: string
): "Occupied" | "Vacant" | "Notice" {
  const s = status.toLowerCase();
  if (s === "occupied") return "Occupied";
  if (s.startsWith("occupied-ntv")) return "Notice"; // NTV / NTVL
  if (s.startsWith("vacant")) return "Vacant";
  return "Occupied"; // fallback for any unknown occupied variant
}

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

export async function isRealPageFormat(buffer: Buffer): Promise<boolean> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  if (!wb.SheetNames.length) return false;
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  const a1 = String(data[0]?.[0] ?? "").toLowerCase();
  const a2 = String(data[1]?.[0] ?? "").trim().toUpperCase();
  return a1.includes("onesite reports") || a2 === "RENT ROLL DETAIL";
}

// ─── Parser ──────────────────────────────────────────────────────

export async function parseRealPage(buffer: Buffer): Promise<ParsedRentRoll> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  // Property name: "OneSite Reports - Heights 2121" → "Heights 2121"
  const titleRaw = String(rows[0]?.[0] ?? "");
  const propertyName = titleRaw.includes(" - ")
    ? titleRaw.split(" - ").slice(1).join(" - ").trim()
    : titleRaw.trim();

  // Report date from "As of Date: MM/DD/YYYY" at row 3
  const asOfStr = String(rows[3]?.[0] ?? "");
  const asOfMatch = asOfStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  const reportDateSerial = asOfMatch
    ? dateToExcelSerial(
        new Date(Number(asOfMatch[3]), Number(asOfMatch[1]) - 1, Number(asOfMatch[2]))
      )
    : null;

  // Find column header row (contains "Bldg/Unit") — typically row 5 but search to be safe
  let dataStartRow = 6;
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    if (rows[i]?.some((v) => String(v ?? "").trim() === "Bldg/Unit")) {
      dataStartRow = i + 1;
      break;
    }
  }

  const units: ParsedUnit[] = [];
  // Track seen unitIds to deduplicate: Vacant-Leased and its Applicant row share a unitId.
  // We keep the Vacant-Leased row (unit record) and skip Applicant rows.
  const seenUnitIds = new Set<string>();

  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const col0 = row[0];
    const col0Str = String(col0 ?? "").trim();

    // Stop at totals / disclaimer rows (col 0 becomes a string label)
    if (col0Str === "Totals:") break;
    if (col0Str.startsWith("--") || col0Str.startsWith("Note:")) break;

    const unitId = String(row[2] ?? "").trim();
    if (!unitId) continue;

    const statusRaw = String(row[6] ?? "").trim();

    // Skip applicant rows entirely
    if (statusRaw === "Applicant") continue;

    // Skip if we already captured this unit (Vacant-Leased followed by Applicant)
    if (seenUnitIds.has(unitId)) continue;
    seenUnitIds.add(unitId);

    const mktRent = row[12] != null ? Number(row[12]) : null;
    const occStatus = deriveOccStatus(statusRaw);
    const inPlaceRent = occStatus !== "Vacant" ? mktRent : null;
    const netEffRent = inPlaceRent; // no concession data in this format

    const charges: RawCharge[] =
      inPlaceRent != null ? [{ code: "rent", amount: inPlaceRent }] : [];

    units.push({
      unitId,
      planId: String(row[3] ?? ""),
      sqFt: row[5] != null ? Number(row[5]) : null,
      residentId: null,
      mktRent,
      charges,
      resDeposit: null,
      otherDeposit: null,
      moveIn: parseMDY(row[8] as string | null),
      leaseExp: parseMDY(row[11] as string | null),
      moveOut: parseMDY(row[9] as string | null),
      balance: null,
      isFuture: false,
      occStatus,
      inPlaceRent,
      otherInc: null,
      recConc: null,
      empOtherConc: null,
      netEffRent,
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
