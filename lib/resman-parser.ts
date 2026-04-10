/**
 * Deterministic parser for ResMan "Rent Roll Market Survey RedIQ" format.
 *
 * Layout:
 *   Row 0: report title  ("Advenir Rent Roll Market Survey RedIQ")
 *   Row 1: property name
 *   Row 2: report date   (bare "MM/DD/YYYY")
 *   Row 4: section label ("Unit Details" or "Future Resident Details")
 *   Row 5: column headers starting with "Bldg-Unit"
 *   Row 6+: data — anchor rows (col 0 non-null) + charge continuation rows
 *
 * The file repeats the section-label + column-header pair for the
 * "Future Resident Details" section; those units are marked isFuture=true.
 */

import type { ParsedRentRoll, ParsedUnit, RawCharge, ChargeCode } from "./yardi-parser";
import { CHARGE_CODE_SLOTS, dateToExcelSerial } from "./yardi-parser";

// ─── Charge code normalisation ────────────────────────────────────
// Maps ResMan verbose charge names → internal slot codes used by
// assignCodesToSlots / sumChargesByCode.  Unrecognised codes are kept
// as-is (they will be silently skipped by assignCodesToSlots but are
// still collected so future mappings can be added without data loss).
function normalizeChargeCode(raw: string): ChargeCode {
  const s = raw.toLowerCase().trim();
  if (s === "rent") return "rent";
  if (s.includes("concession")) return "conc";
  if (s.includes("pet rent") || s === "pet fee") return "petrent";
  if (s.includes("parking")) return "park";
  if (s.includes("storage")) return "stor";
  if (s.includes("month-to-month") || s === "mtm") return "mtm";
  if (s.includes("housing assistance") || s === "hap") return "hap";
  if (s.includes("employee") || s.includes("emp mgmt")) return "empmgmt";
  // Amenity Rent, Admin Service Charge, Package Service, Pest Control,
  // Valet Trash, etc. — kept with raw name, excluded from slot mapping
  return raw as ChargeCode;
}

// ─── Occupancy status ─────────────────────────────────────────────
// ResMan status strings include: "Occupied No Notice", "Occupied Notice",
// "Vacant", "Vacant Rented Ready", "Notice Rented", etc.
function deriveOccStatus(
  unitStatus: string,
  isFuture: boolean
): "Occupied" | "Vacant" | "Notice" {
  if (isFuture) return "Vacant";
  const s = unitStatus.toLowerCase();
  if (s.includes("vacant")) return "Vacant";
  if (s.includes("no notice")) return "Occupied"; // "Occupied No Notice" — must check before "notice"
  if (s.includes("notice")) return "Notice";       // "Occupied Notice", "Notice Rented"
  return "Occupied";
}

// ─── Charge helpers (mirrors yardi-parser private fns) ────────────
function sumChargesByCode(charges: RawCharge[], codes: string[]): number {
  return charges
    .filter((c) => codes.includes(c.code as string))
    .reduce((acc, c) => acc + c.amount, 0);
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

// ─── Detection ────────────────────────────────────────────────────

/**
 * Returns true if the workbook has a "Bldg-Unit" column header in col 0
 * within the first 8 rows — the ResMan-specific layout marker.
 */
export async function isResManFormat(buffer: Buffer): Promise<boolean> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  if (!wb.SheetNames.length) return false;
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  for (let i = 0; i < Math.min(8, data.length); i++) {
    if (String(data[i]?.[0] ?? "").trim() === "Bldg-Unit") return true;
  }
  return false;
}

// ─── Parser ───────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════
// Format 1: ResMan "Rent Roll with Lease Charges" (sheet = Report1)
// ═══════════════════════════════════════════════════════════════════
//
// Layout:
//   Row 0: "Rent Roll with Lease Charges"
//   Row 1: property name  e.g. "The Flats 140 (ra707102)"
//   Row 2: "As Of = MM/DD/YYYY"
//   Row 3: "Month Year = MM/YYYY"
//   Rows 4-5: two-row column header (Unit | Unit Type | Unit Sq Ft | Resident | Name | Market Rent | Charge Code | Amount | …)
//   Row 6: "Current/Notice/Vacant Residents" section header
//   Row 7+: anchor rows + charge continuation rows
//
// Column mapping (0-indexed, confirmed from Bethesda RR w LC 3.19.26.xlsx):
// NOTE: This format has NO "Name" column — everything from col 4 onwards is
//       one position earlier than the original layout comment assumed.
//   0  Unit        1  PlanID     2  SqFt     3  ResidentID  4  MktRent
//   5  ChargeCode  6  Amount     7  ResDeposit  8  OtherDeposit
//   9  MoveIn(date/serial)  10  LeaseExp(date/serial)  11  MoveOut(date/serial)  12  Balance

// Normalise short ResMan charge codes ("rarent", "rapark", …) → slot codes
function normalizeRRLeaseCode(raw: string): ChargeCode {
  const s = raw.toLowerCase().trim();
  // Must check petrent before generic "rent" suffix
  if (s.endsWith("petren") || s.endsWith("petrent")) return "petrent";
  if (s.endsWith("rent")) return "rent";
  if (s.endsWith("park")) return "park";
  if (s.endsWith("stor")) return "stor";
  if (s.endsWith("mtm")) return "mtm";
  if (s.endsWith("conc")) return "conc";
  if (s.endsWith("hap")) return "hap";
  if (s.endsWith("empmgmt")) return "empmgmt";
  return raw as ChargeCode;
}

// OccStatus from residentId + moveOut (applies to Format 1 and Format 2)
function rrDeriveOccStatus(
  residentId: string | null,
  moveOut: number | null,
  isFuture: boolean
): "Occupied" | "Vacant" | "Notice" {
  if (isFuture) return "Vacant";
  if (!residentId || residentId.toUpperCase() === "VACANT") return "Vacant";
  if (moveOut != null) return "Notice";
  return "Occupied";
}

// Section-header test for Report1 format rows
function isRRSectionRow(col0Str: string): boolean {
  const s = col0Str.toLowerCase();
  return (
    s.startsWith("current/") ||
    s.startsWith("future ") ||
    s.startsWith("summary") ||
    s.startsWith("totals")
  );
}

// Property name: strip trailing " (code)" e.g. "The Flats 140 (ra707102)" → "The Flats 140"
function stripPropertyCode(raw: string): string {
  return raw.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export async function isResManLeaseChargesFormat(buffer: Buffer): Promise<boolean> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  if (!wb.SheetNames.length) return false;
  if (wb.SheetNames[0] !== "Report1") return false;
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  return String(data[0]?.[0] ?? "").toLowerCase().includes("rent roll with lease charges");
}

export async function parseResManLeaseCharges(buffer: Buffer): Promise<ParsedRentRoll> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  const propertyName = stripPropertyCode(String(rows[1]?.[0] ?? ""));

  const asOfStr = String(rows[2]?.[0] ?? "");
  const asOfMatch = asOfStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  let reportDateSerial: number | null = null;
  if (asOfMatch) {
    reportDateSerial = dateToExcelSerial(
      new Date(Number(asOfMatch[3]), Number(asOfMatch[1]) - 1, Number(asOfMatch[2]))
    );
  }

  const units: ParsedUnit[] = [];
  let isFutureSection = false;
  let currentUnit: (Partial<ParsedUnit> & { charges: RawCharge[] }) | null = null;

  function finalizeLeaseUnit() {
    if (!currentUnit?.unitId) return;
    const charges = currentUnit.charges;
    const inPlaceRent = sumChargesByCode(charges, ["rent"]) || null;
    const otherInc = sumChargesByCode(charges, ["park", "petrent", "stor", "pet2", "hap"]) || null;
    const recConc = sumChargesByCode(charges, ["conc"]) || null;
    const empOtherConc = sumChargesByCode(charges, ["empmgmt"]) || null;
    const hasMTM = charges.some((c) => c.code === "mtm");
    const netEffRent = inPlaceRent != null ? inPlaceRent + (recConc ?? 0) : null;
    const occStatus = rrDeriveOccStatus(
      currentUnit.residentId ?? null,
      currentUnit.moveOut ?? null,
      currentUnit.isFuture ?? false
    );
    units.push({
      unitId: currentUnit.unitId,
      planId: currentUnit.planId ?? "",
      sqFt: currentUnit.sqFt ?? null,
      residentId: currentUnit.residentId ?? null,
      mktRent: currentUnit.mktRent ?? null,
      charges,
      resDeposit: currentUnit.resDeposit ?? null,
      otherDeposit: currentUnit.otherDeposit ?? null,
      moveIn: currentUnit.moveIn ?? null,
      leaseExp: currentUnit.leaseExp ?? null,
      moveOut: currentUnit.moveOut ?? null,
      balance: currentUnit.balance ?? null,
      isFuture: currentUnit.isFuture ?? false,
      occStatus,
      inPlaceRent,
      otherInc,
      recConc: recConc !== 0 ? recConc : null,
      empOtherConc: empOtherConc !== 0 ? empOtherConc : null,
      netEffRent,
      hasMTM,
      codedCharges: assignCodesToSlots(charges),
    });
  }

  for (let i = 6; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const col0 = row[0];
    const col0Str = String(col0 ?? "").trim();

    if (!col0Str && row.slice(0, 14).every((v) => v == null)) continue; // blank row
    if (col0Str && isRRSectionRow(col0Str)) {
      const s = col0Str.toLowerCase();
      if (s.startsWith("summary")) break; // stop at Summary Groups
      if (s.startsWith("future")) isFutureSection = true;
      continue;
    }

    const chargeCode = row[5]; // col 5 (charge code; col 6 is market rent)
    const chargeAmt = row[6];  // col 6 (charge amount; col 7 is deposit)

    // Skip "Total" summary rows
    if (chargeCode != null && String(chargeCode).trim() === "Total") continue;

    if (col0 != null && col0Str !== "") {
      // Anchor row — new unit
      finalizeLeaseUnit();
      const resIdRaw = row[3] != null ? String(row[3]).trim() : null;
      const residentId = resIdRaw && resIdRaw.toUpperCase() !== "VACANT" ? resIdRaw : null;
      // This format has no "Name" column at position 4, so every field from
      // MktRent onwards sits one column earlier than the original layout comment.
      // Actual layout: 0=Unit 1=PlanID 2=SqFt 3=ResidentID 4=MktRent
      //   5=ChargeCode 6=Amount 7=ResDeposit 8=OtherDeposit
      //   9=MoveIn 10=LeaseExp 11=MoveOut 12=Balance
      currentUnit = {
        unitId: col0Str,
        planId: String(row[1] ?? ""),
        sqFt: row[2] != null ? Number(row[2]) : null,
        residentId,
        mktRent: row[4] != null ? Number(row[4]) : null,
        charges: [],
        resDeposit: row[7] != null ? Number(row[7]) : null,
        otherDeposit: row[8] != null ? Number(row[8]) : null,
        moveIn: row[9] != null ? Number(row[9]) : null,
        leaseExp: row[10] != null ? Number(row[10]) : null,
        moveOut: row[11] != null ? Number(row[11]) : null,
        balance: row[12] != null ? Number(row[12]) : null,
        isFuture: isFutureSection,
      };
      if (chargeCode != null && String(chargeCode).trim() !== "") {
        currentUnit.charges.push({
          code: normalizeRRLeaseCode(String(chargeCode)),
          amount: chargeAmt != null ? Number(chargeAmt) : 0,
        });
      }
    } else if (currentUnit && chargeCode != null && String(chargeCode).trim() !== "") {
      // Charge continuation row
      currentUnit.charges.push({
        code: normalizeRRLeaseCode(String(chargeCode)),
        amount: chargeAmt != null ? Number(chargeAmt) : 0,
      });
    }
  }
  finalizeLeaseUnit();

  return {
    propertyName,
    reportDate: reportDateSerial,
    totalUnits: units.filter((u) => !u.isFuture).length,
    units,
  };
}

// ═══════════════════════════════════════════════════════════════════
// Format 2: ResMan "Rent Roll" — no lease charges (sheet = Report1)
// ═══════════════════════════════════════════════════════════════════
//
// Layout: same header block as Format 1 but A1 = "Rent Roll" (not "with Lease Charges")
// One row per unit, no charge continuation rows.
//
// Column mapping (0-indexed, confirmed from files):
//   0  Unit     1  PlanID   2  SqFt  3  ResidentID  4  Name
//   5  MktRent  6  ActualRent  7  ResDeposit  8  OtherDeposit
//   9  MoveIn(serial)  10  LeaseExp(serial)  11  MoveOut(serial)  12  Balance

export async function isResManSimpleFormat(buffer: Buffer): Promise<boolean> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  if (!wb.SheetNames.length) return false;
  if (wb.SheetNames[0] !== "Report1") return false;
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null });
  const a1 = String(data[0]?.[0] ?? "").toLowerCase().trim();
  return a1 === "rent roll"; // exact match — excludes "rent roll with lease charges"
}

export async function parseResManSimple(buffer: Buffer): Promise<ParsedRentRoll> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  const propertyName = stripPropertyCode(String(rows[1]?.[0] ?? ""));

  const asOfStr = String(rows[2]?.[0] ?? "");
  const asOfMatch = asOfStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  let reportDateSerial: number | null = null;
  if (asOfMatch) {
    reportDateSerial = dateToExcelSerial(
      new Date(Number(asOfMatch[3]), Number(asOfMatch[1]) - 1, Number(asOfMatch[2]))
    );
  }

  const units: ParsedUnit[] = [];
  let isFutureSection = false;

  for (let i = 6; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const col0 = row[0];
    const col0Str = String(col0 ?? "").trim();

    if (!col0Str) continue; // blank or continuation (no charge rows in this format)
    if (isRRSectionRow(col0Str)) {
      const s = col0Str.toLowerCase();
      if (s.startsWith("summary")) break;
      if (s.startsWith("future")) isFutureSection = true;
      continue;
    }

    const resIdRaw = row[3] != null ? String(row[3]).trim() : null;
    const residentId = resIdRaw && resIdRaw.toUpperCase() !== "VACANT" ? resIdRaw : null;
    const mktRent = row[5] != null ? Number(row[5]) : null;
    const actualRent = row[6] != null ? Number(row[6]) : null;
    const moveOut = row[11] != null ? Number(row[11]) : null;
    const occStatus = rrDeriveOccStatus(residentId, moveOut, isFutureSection);

    // Synthesise charge list from actualRent so codedCharges slot 0 is populated
    const charges: RawCharge[] = actualRent != null ? [{ code: "rent", amount: actualRent }] : [];
    const inPlaceRent = actualRent;
    const netEffRent = inPlaceRent; // no concession data in this format

    units.push({
      unitId: col0Str,
      planId: String(row[1] ?? ""),
      sqFt: row[2] != null ? Number(row[2]) : null,
      residentId,
      mktRent,
      charges,
      resDeposit: row[7] != null ? Number(row[7]) : null,
      otherDeposit: row[8] != null ? Number(row[8]) : null,
      moveIn: row[9] != null ? Number(row[9]) : null,
      leaseExp: row[10] != null ? Number(row[10]) : null,
      moveOut,
      balance: row[12] != null ? Number(row[12]) : null,
      isFuture: isFutureSection,
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
    totalUnits: units.filter((u) => !u.isFuture).length,
    units,
  };
}

// ─── Original Market Survey parser (unchanged) ────────────────────
export async function parseResManRentRoll(buffer: Buffer): Promise<ParsedRentRoll> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  // ── Header metadata ───────────────────────────────────────────
  const propertyName = String(rows[1]?.[0] ?? "").trim();

  const reportDateStr = String(rows[2]?.[0] ?? "");
  const reportDateMatch = reportDateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  let reportDateSerial: number | null = null;
  if (reportDateMatch) {
    const d = new Date(
      Number(reportDateMatch[3]),
      Number(reportDateMatch[1]) - 1,
      Number(reportDateMatch[2])
    );
    reportDateSerial = dateToExcelSerial(d);
  }

  // ── State ─────────────────────────────────────────────────────
  const units: ParsedUnit[] = [];
  let isFutureSection = false;
  let inSummarySection = false; // true between "Status Summary" and "Future Resident Details"
  let currentUnit: (Partial<ParsedUnit> & { charges: RawCharge[]; rawStatus: string }) | null =
    null;

  function finalizeUnit() {
    if (!currentUnit?.unitId) return;
    const { charges, rawStatus } = currentUnit;

    const inPlaceRent = sumChargesByCode(charges, ["rent"]) || null;
    const otherInc =
      sumChargesByCode(charges, ["park", "petrent", "stor", "pet2", "hap"]) || null;
    const recConc = sumChargesByCode(charges, ["conc"]) || null;
    const empOtherConc = sumChargesByCode(charges, ["empmgmt"]) || null;
    const hasMTM = charges.some((c) => c.code === "mtm");
    const netEffRent = inPlaceRent != null ? inPlaceRent + (recConc ?? 0) : null;
    const occStatus = deriveOccStatus(rawStatus, currentUnit.isFuture ?? false);

    units.push({
      unitId: currentUnit.unitId,
      planId: currentUnit.planId ?? "",
      sqFt: currentUnit.sqFt ?? null,
      residentId: currentUnit.residentId ?? null,
      mktRent: currentUnit.mktRent ?? null,
      charges,
      resDeposit: currentUnit.resDeposit ?? null,
      otherDeposit: null,
      moveIn: currentUnit.moveIn ?? null,
      leaseExp: currentUnit.leaseExp ?? null,
      moveOut: currentUnit.moveOut ?? null,
      balance: currentUnit.balance ?? null,
      isFuture: currentUnit.isFuture ?? false,
      occStatus,
      inPlaceRent,
      otherInc,
      recConc: recConc !== 0 ? recConc : null,
      empOtherConc: empOtherConc !== 0 ? empOtherConc : null,
      netEffRent,
      hasMTM,
      codedCharges: assignCodesToSlots(charges),
    });
  }

  // ── Find first data row ───────────────────────────────────────
  // Skip all preamble (title, property name, date, section label) by
  // anchoring to the first "Bldg-Unit" column header row.
  // Column layout (0-indexed):
  //   0  Bldg-Unit       1  Unit Type     2  SQFT
  //   3  Unit Status     4  Resident      5  Market Rent
  //   6  Ledger          7  Charge Code   8  Scheduled Charges
  //   9  Balance        10  Deposit Held 11  Move-In
  //  12  Lease Start    13  Lease End    14  Expected Move-Out
  let dataStartRow = rows.length;
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i]?.[0] ?? "").trim() === "Bldg-Unit") {
      dataStartRow = i + 1;
      break;
    }
  }

  for (let i = dataStartRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const colA = row[0];
    const colAStr = String(colA ?? "").trim();

    // Summary block begins here — skip until "Future Resident Details"
    if (colAStr === "Status Summary") {
      finalizeUnit();
      currentUnit = null;
      inSummarySection = true;
      continue;
    }

    // Section header: "Future Resident Details" — exits summary block
    if (colAStr.toLowerCase() === "future resident details") {
      inSummarySection = false;
      isFutureSection = true;
      continue;
    }

    if (inSummarySection) continue;

    // Column header rows ("Bldg-Unit") — skip
    if (colAStr === "Bldg-Unit") continue;

    // "Charge Total:" summary rows — skip
    if (String(row[6] ?? "").trim() === "Charge Total:") continue;

    // Fully blank rows — skip
    if (row.slice(0, 15).every((v) => v == null)) continue;

    const colH = row[7]; // Charge Code
    const colI = row[8]; // Scheduled Charges amount

    if (colA != null && colAStr !== "") {
      // ── Anchor row: new unit ──────────────────────────────
      finalizeUnit();

      const rawStatus = String(row[3] ?? "");
      const residentRaw = row[4] != null ? String(row[4]).trim() : null;
      const residentId =
        residentRaw && residentRaw.toLowerCase() !== "vacant" ? residentRaw : null;

      currentUnit = {
        unitId: colAStr,
        planId: String(row[1] ?? ""),
        sqFt: row[2] != null ? Number(row[2]) : null,
        rawStatus,
        residentId,
        mktRent: row[5] != null ? Number(row[5]) : null,
        charges: [],
        resDeposit: row[10] != null ? Number(row[10]) : null,
        moveIn: row[11] != null ? Number(row[11]) : null,
        leaseExp: row[13] != null ? Number(row[13]) : null,
        moveOut: row[14] != null ? Number(row[14]) : null,
        balance: row[9] != null ? Number(row[9]) : null,
        isFuture: isFutureSection,
      };

      // First charge is inline in the anchor row
      if (colH != null && String(colH).trim() !== "") {
        currentUnit.charges.push({
          code: normalizeChargeCode(String(colH)),
          amount: colI != null ? Number(colI) : 0,
        });
      }
    } else if (currentUnit && colH != null && String(colH).trim() !== "") {
      // ── Continuation row: additional charge ───────────────
      currentUnit.charges.push({
        code: normalizeChargeCode(String(colH)),
        amount: colI != null ? Number(colI) : 0,
      });
    }
  }

  finalizeUnit();

  return {
    propertyName,
    reportDate: reportDateSerial,
    totalUnits: units.filter((u) => !u.isFuture).length,
    units,
  };
}
