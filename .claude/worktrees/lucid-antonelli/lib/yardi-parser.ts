/**
 * Deterministic parser for Yardi "Rent Roll with Lease Charges" multi-row format.
 * Identifies sections, groups charge code rows per unit, and resolves occupancy status.
 */

// Charge code slots as defined in the redIQ Source Data template (row 9)
export const CHARGE_CODE_SLOTS = [
  "rent",     // Code1
  "park",     // Code2
  "park",     // Code3
  "park",     // Code4
  "park",     // Code5
  "petrent",  // Code6
  "petrent",  // Code7
  "mtm",      // Code8
  "stor",     // Code9
  "stor",     // Code10
  "stor",     // Code11
  "pet2",     // Code12
  "hap",      // Code13
  "empmgmt",  // Code14
  "conc",     // Code15
] as const;

export type ChargeCode = (typeof CHARGE_CODE_SLOTS)[number] | string;

export interface RawCharge {
  code: ChargeCode;
  amount: number;
}

export interface ParsedUnit {
  unitId: string;
  planId: string;
  sqFt: number | null;
  residentId: string | null;
  mktRent: number | null;
  charges: RawCharge[];
  resDeposit: number | null;
  otherDeposit: number | null;
  moveIn: number | null;      // Excel serial date
  leaseExp: number | null;    // Excel serial date
  moveOut: number | null;     // Excel serial date
  balance: number | null;
  isFuture: boolean;
  // Derived
  occStatus: "Occupied" | "Vacant" | "Notice";
  inPlaceRent: number | null;
  otherInc: number | null;
  recConc: number | null;
  empOtherConc: number | null;
  netEffRent: number | null;
  hasMTM: boolean;
  // Code1–Code15 assignments
  codedCharges: (number | null)[];
}

export interface ParsedRentRoll {
  propertyName: string;
  reportDate: number | null;  // Excel serial
  totalUnits: number;
  units: ParsedUnit[];
}

// Section header strings from the Yardi report
const SECTION_CURRENT = "current/notice/vacant residents";
const SECTION_FUTURE = "future residents/applicants";
// Stop parsing when we hit the summary section
const SECTION_SUMMARY = "summary groups";

function isNullRow(row: (unknown)[]): boolean {
  return row.every((v) => v == null || v === "");
}

function isSectionHeader(row: (unknown)[]): boolean {
  const first = String(row[0] ?? "").toLowerCase();
  return (
    first.startsWith(SECTION_CURRENT) ||
    first.startsWith(SECTION_FUTURE) ||
    first.startsWith(SECTION_SUMMARY)
  );
}

function isSummarySection(row: (unknown)[]): boolean {
  return String(row[0] ?? "").toLowerCase().startsWith(SECTION_SUMMARY);
}

function assignCodesToSlots(charges: RawCharge[]): (number | null)[] {
  const result: (number | null)[] = new Array(CHARGE_CODE_SLOTS.length).fill(null);
  const used = new Array(CHARGE_CODE_SLOTS.length).fill(false);

  for (const charge of charges) {
    if (charge.code === "Total" || charge.code === "total") continue;
    for (let i = 0; i < CHARGE_CODE_SLOTS.length; i++) {
      if (CHARGE_CODE_SLOTS[i] === charge.code && !used[i]) {
        result[i] = charge.amount;
        used[i] = true;
        break;
      }
    }
    // If charge code isn't in slots (e.g. unknown code), skip it
  }

  return result;
}

function deriveOccStatus(
  residentId: string | null,
  moveOut: number | null,
  isFuture: boolean
): "Occupied" | "Vacant" | "Notice" {
  if (isFuture) return "Vacant"; // future resident → current unit is vacant
  if (!residentId || residentId.toUpperCase() === "VACANT") return "Vacant";
  if (moveOut != null) return "Notice";
  return "Occupied";
}

function sumChargesByCode(charges: RawCharge[], codes: ChargeCode[]): number {
  return charges
    .filter((c) => codes.includes(c.code as ChargeCode))
    .reduce((acc, c) => acc + c.amount, 0);
}

/**
 * Detect if this buffer is a Yardi "Rent Roll with Lease Charges" report.
 */
export async function isYardiFormat(buffer: Buffer): Promise<boolean> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  if (!wb.SheetNames.length) return false;
  const ws = wb.Sheets[wb.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json<(unknown)[]>(ws, { header: 1, defval: null });
  // Check row 0 for "Rent Roll with Lease Charges"
  return String(data[0]?.[0] ?? "")
    .toLowerCase()
    .includes("rent roll with lease charges");
}

export async function parseYardiRentRoll(buffer: Buffer): Promise<ParsedRentRoll> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "buffer" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<(string | number | null)[]>(ws, {
    header: 1,
    defval: null,
  });

  // Extract property name from row 1: "Elme Bethesda (10101005)" → "Elme Bethesda"
  const propRaw = String(rows[1]?.[0] ?? "");
  const propertyName = propRaw.replace(/\s*\(\d+\)\s*$/, "").trim();

  // Extract report date Excel serial — it's easier to derive from the date string
  // Row 2: "As Of = 03/19/2026" — but we don't need to convert, just track units
  // The actual date serial used in the template (Sheet2.DateStamp) we'll recompute
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

  // Data rows start at row 7 (index 6 = section header, index 7 = first unit)
  let isFutureSection = false;
  let currentUnit: Partial<ParsedUnit> & { charges: RawCharge[] } | null = null;
  const units: ParsedUnit[] = [];

  function finalizeUnit() {
    if (!currentUnit?.unitId) return;
    const charges = currentUnit.charges;

    const inPlaceRent = sumChargesByCode(charges, ["rent"]) || null;
    const otherInc =
      sumChargesByCode(charges, ["park", "petrent", "stor", "pet2", "hap"]) || null;
    const recConc = sumChargesByCode(charges, ["conc"]) || null;
    const empOtherConc = sumChargesByCode(charges, ["empmgmt"]) || null;
    const hasMTM = charges.some((c) => c.code === "mtm");
    const netEffRent =
      inPlaceRent != null
        ? inPlaceRent + (recConc ?? 0)
        : null;

    const occStatus = deriveOccStatus(
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

    // Stop at summary section
    if (isSummarySection(row)) break;

    // Skip null rows
    if (isNullRow(row)) continue;

    // Section headers
    if (isSectionHeader(row)) {
      const label = String(row[0] ?? "").toLowerCase();
      isFutureSection = label.startsWith(SECTION_FUTURE);
      continue;
    }

    // Check if this row starts a new unit (col A has a unit-like value)
    const colA = row[0];
    const colF = row[5]; // Charge code column
    const colG = row[6]; // Amount column

    if (colA != null && colA !== "") {
      // New unit — finalize previous
      finalizeUnit();

      const chargeCode = String(colF ?? "");
      const chargeAmt = Number(colG ?? 0);

      const rawResidentId = row[3] != null ? String(row[3]) : null;
      currentUnit = {
        unitId: String(colA),
        planId: String(row[1] ?? ""),
        sqFt: row[2] != null ? Number(row[2]) : null,
        residentId: rawResidentId?.toUpperCase() === "VACANT" ? null : rawResidentId,
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

      // First row also has the first charge inline (col F/G)
      if (chargeCode && chargeCode !== "Total") {
        currentUnit.charges.push({ code: chargeCode, amount: chargeAmt });
      }
    } else if (currentUnit && colF != null && colF !== "") {
      // Continuation row — just a charge code + amount
      const code = String(colF);
      const amt = Number(colG ?? 0);
      if (code !== "Total") {
        currentUnit.charges.push({ code, amount: amt });
      }
    }
  }

  // Finalize last unit
  finalizeUnit();

  return {
    propertyName,
    reportDate: reportDateSerial,
    totalUnits: units.filter((u) => !u.isFuture).length,
    units,
  };
}

/** Convert JS Date to Excel serial number (1900 date system) */
export function dateToExcelSerial(date: Date): number {
  // Excel epoch: Dec 30, 1899
  const excelEpoch = new Date(1899, 11, 30);
  const msPerDay = 86400000;
  return Math.round((date.getTime() - excelEpoch.getTime()) / msPerDay);
}
