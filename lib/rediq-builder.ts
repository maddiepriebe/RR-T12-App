/**
 * Builds a workbook in the exact redIQ "RR Simplified" format:
 *   Sheet 1: Floor Plan
 *   Sheet 2: Rent Roll
 *   Sheet 3: Source Data
 *   Sheet 4: Sheet2 (metadata)
 *
 * Based on the exact structure reverse-engineered from RR Simplified.xlsx.
 */

import * as XLSX from "xlsx";
import type { ParsedRentRoll, ParsedUnit } from "./yardi-parser";
import { CHARGE_CODE_SLOTS } from "./yardi-parser";

// ─── Floor plan bed/bath lookup ────────────────────────────────────
// Derived from the Floor Plan sheet in RR Simplified.xlsx.
// Falls back to inferring from plan code if unknown.
const KNOWN_PLAN_INFO: Record<string, { bed: number; bath: number }> = {
  "1005A1A": { bed: 1, bath: 1 },
  "1005B2A": { bed: 2, bath: 2 },
  "1005B2B": { bed: 2, bath: 2 },
  "1005B2C": { bed: 2, bath: 2 },
  "1005B2D": { bed: 2, bath: 2 },
  "1005B2I": { bed: 2, bath: 2 },
  "1005B2F": { bed: 2, bath: 2 },
  "1005B2E": { bed: 2, bath: 2 },
  "1005B2G": { bed: 2, bath: 2 },
  "1005B2H": { bed: 2, bath: 2 },
  "1005C3A": { bed: 3, bath: 2 },
};

function getPlanInfo(planId: string): { bed: number; bath: number } {
  if (KNOWN_PLAN_INFO[planId]) return KNOWN_PLAN_INFO[planId];
  // Infer from plan code: letter before digit is type indicator
  // e.g. "XYZB2A" → "B2" → 2 beds, 2 baths
  const match = planId.match(/([A-Z])(\d)(?:[A-Z])?$/);
  if (match) {
    const bed = parseInt(match[2]);
    const bath = bed <= 2 ? bed : 2;
    return { bed, bath };
  }
  return { bed: 2, bath: 2 };
}

function avg(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Floor Plan sheet ─────────────────────────────────────────────
function buildFloorPlanSheet(rr: ParsedRentRoll): XLSX.WorkSheet {
  const { propertyName, reportDate, units } = rr;
  const dateLabel = reportDate
    ? `Floor Plans as of:  ${excelSerialToDateStr(reportDate)}`
    : "Floor Plans";

  // Aggregate by planId (exclude future units from counts)
  const planMap = new Map<
    string,
    { sqFts: number[]; occupied: number; vacant: number; nonRev: number; mktRents: number[]; inPlaceRents: number[]; netEffRents: number[] }
  >();

  for (const unit of units) {
    if (unit.isFuture) continue;
    if (!planMap.has(unit.planId)) {
      planMap.set(unit.planId, {
        sqFts: [],
        occupied: 0,
        vacant: 0,
        nonRev: 0,
        mktRents: [],
        inPlaceRents: [],
        netEffRents: [],
      });
    }
    const p = planMap.get(unit.planId)!;
    if (unit.sqFt) p.sqFts.push(unit.sqFt);
    if (unit.mktRent) p.mktRents.push(unit.mktRent);
    if (unit.occStatus === "Occupied" || unit.occStatus === "Notice") {
      p.occupied++;
      if (unit.inPlaceRent) p.inPlaceRents.push(unit.inPlaceRent);
      if (unit.netEffRent) p.netEffRents.push(unit.netEffRent);
    } else {
      p.vacant++;
    }
  }

  // Total SF for % calculation
  const totalSF = Array.from(planMap.values()).reduce((acc, p) => {
    const planSF = p.sqFts.length ? avg(p.sqFts) : 0;
    return acc + planSF * (p.occupied + p.vacant + p.nonRev);
  }, 0);

  const rows: (string | number | null)[][] = [
    // Row 0: title
    [propertyName, null, null, null, null, null, "Floor Plan Summary"],
    // Row 1: date
    [dateLabel],
    // Row 2: blank
    [],
    // Row 3: section headers
    ["FLOOR PLAN INFORMATION", null, null, null, null, null, null, null, null, null, "MONTHLY RENT"],
    // Row 4: sub-headers
    [null, "Lease", "Renov.", null, null, null, null, null, null, null, "Market Rent", null, "Contractual Rent", null, "Net Effective Rent", null],
    // Row 5: display headers
    ["Floor Plan", "Type", "Status", "Bed", "Net sf", "%", "Occupied", "Vacant", "Non-Rev", "Total", "per unit", "psf", "per unit", "psf", "per unit", "psf"],
    // Row 6: machine-readable headers
    ["PlanID", "LeaseType", "Renovated", "Bed", "AvgNetSF", "%NetSF", "OccupUnits", "VacUnits", "NonRevUnits", "TotalUnits", "AvgMktRent", "MktRentPSF", "AvgInPlaceRent", "InPlaceRentPSF", "AvgNetEffective", "NetEffectiveRentPSF"],
  ];

  // Sort plan IDs
  const sortedPlanIds = Array.from(planMap.keys()).sort();

  let totalOccup = 0, totalVac = 0, totalNonRev = 0, totalUnits = 0;
  let totalSFAll = 0;
  const allMkt: number[] = [], allInPlace: number[] = [], allNetEff: number[] = [];

  for (const planId of sortedPlanIds) {
    const p = planMap.get(planId)!;
    const { bed, bath: _bath } = getPlanInfo(planId);
    const avgSF = p.sqFts.length ? Math.round(avg(p.sqFts)) : null;
    const total = p.occupied + p.vacant + p.nonRev;
    const planTotalSF = (avgSF ?? 0) * total;
    const pctSF = totalSF > 0 ? planTotalSF / totalSF : null;
    const avgMkt = p.mktRents.length ? round2(avg(p.mktRents)) : null;
    const avgInPlace = p.inPlaceRents.length ? round2(avg(p.inPlaceRents)) : null;
    const avgNetEff = p.netEffRents.length ? round2(avg(p.netEffRents)) : null;
    const mktPSF = avgMkt && avgSF ? round2(avgMkt / avgSF) : null;
    const inPlacePSF = avgInPlace && avgSF ? round2(avgInPlace / avgSF) : null;
    const netEffPSF = avgNetEff && avgSF ? round2(avgNetEff / avgSF) : null;

    rows.push([planId, "", "", bed, avgSF, pctSF, p.occupied, p.vacant, p.nonRev, total, avgMkt, mktPSF, avgInPlace, inPlacePSF, avgNetEff, netEffPSF]);

    totalOccup += p.occupied;
    totalVac += p.vacant;
    totalNonRev += p.nonRev;
    totalUnits += total;
    totalSFAll += planTotalSF;
    allMkt.push(...p.mktRents);
    allInPlace.push(...p.inPlaceRents);
    allNetEff.push(...p.netEffRents);
  }

  // Totals row
  rows.push([
    "Total", null, null, null, totalSFAll || null, totalSF > 0 ? 1 : null,
    totalOccup, totalVac, totalNonRev, totalUnits,
    allMkt.reduce((a, b) => a + b, 0) || null, null,
    allInPlace.reduce((a, b) => a + b, 0) || null, null,
    allNetEff.reduce((a, b) => a + b, 0) || null, null,
  ]);

  // Average row
  rows.push([
    "Average", null, null, null,
    totalUnits > 0 ? round2(totalSFAll / totalUnits) : null,
    null, null, null, null, null,
    allMkt.length ? round2(avg(allMkt)) : null,
    allMkt.length && totalSFAll ? round2(avg(allMkt) / (totalSFAll / totalUnits)) : null,
    allInPlace.length ? round2(avg(allInPlace)) : null,
    allInPlace.length && totalSFAll ? round2(avg(allInPlace) / (totalSFAll / totalUnits)) : null,
    allNetEff.length ? round2(avg(allNetEff)) : null,
    allNetEff.length && totalSFAll ? round2(avg(allNetEff) / (totalSFAll / totalUnits)) : null,
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 8 }, { wch: 8 }, { wch: 5 }, { wch: 8 }, { wch: 7 },
    { wch: 10 }, { wch: 8 }, { wch: 9 }, { wch: 7 }, { wch: 12 }, { wch: 7 },
    { wch: 14 }, { wch: 7 }, { wch: 14 }, { wch: 9 },
  ];
  return ws;
}

// ─── Rent Roll sheet ──────────────────────────────────────────────
function buildRentRollSheet(rr: ParsedRentRoll): XLSX.WorkSheet {
  const { propertyName, reportDate, units } = rr;
  const dateLabel = reportDate
    ? `Rent Roll as of:  ${excelSerialToDateStr(reportDate)}`
    : "Rent Roll";
  const totalNonFuture = units.filter((u) => !u.isFuture).length;

  const rows: (string | number | null | boolean)[][] = [
    // Row 0
    [null, `${propertyName} (${totalNonFuture} units)`, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, 1],
    // Row 1: blank
    new Array(36).fill(null),
    // Row 2
    [null, dateLabel, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, "FUTURE LEASE"],
    // Row 3: blank
    new Array(36).fill(null),
    // Row 4: section headers
    ["DEAL INFORMATION", "UNIT INFORMATION", null, null, null, null, null, "UNIT STATUS", null, "CURRENT LEASE", null, null, null, null, null, null, null, null, null, null, null, null, null, null, "FUTURE LEASE"],
    // Row 5: sub-headers
    [null, null, null, null, null, null, null, "Renovation", "Occupancy", "Market", "Contractual", "Recurring", "Net Effective", "Supplement'l", "Upfront", "Emp. / Other", "Other", "Lease", "Lease", "Lease Term", null, "Move In", "Move Out", "Vac.", "Contractual", "Recurring", "Net Effective", "Supp.", "Upfront", "Emp. / Other", "Other", "Lease", "Lease", "Lease Term", "Move In", null],
    // Row 6: display headers
    ["Property", "Unit No.", "Floor Plan", "Net sf", "Bed", "Bath", "Lease Type", "Status", "Status", "Rent", "Rent", "Concessions", "Rent", "Rent", "Concessions", "Discounts", "Income", "Start Date", "Expiration", "(months)", "MTM", "Date", "Date", "Notice", "Rent", "Concessions", "Rent", "Rent", "Concessions", "Discounts", "Income", "Start Date", "Expiration", "(months)", "Date", null],
    // Row 7: machine-readable headers
    ["PropName", "UnitID", "PlanID", "NetSF", "Bed", "Bath", "LeaseType", "RenStatus", "OccStatus", "MktRent", "InPlaceRent", "RecConc", "NetEffRent", "SuppRent", "UpConc", "EmpOtherConc", "OtherInc", "LeaseStart", "LeaseExp", "LeaseTerm", "mtm", "MoveIn", "MoveOut", "NoticeToVac", "InPlaceRentFuture", "RecConcFuture", "NetEffRentFuture", "SuppRentFuture", "UpConcFuture", "OtherConcFuture", "OtherIncFuture", "LeaseStartFuture", "LeaseExpFuture", "LeaseTermFuture", "MoveInFuture", "FutureLease"],
  ];

  // Data rows (non-future first, then future)
  const nonFuture = units.filter((u) => !u.isFuture);
  const future = units.filter((u) => u.isFuture);

  for (const unit of [...nonFuture, ...future]) {
    const { bed, bath } = getPlanInfo(unit.planId);
    const leaseType = unit.charges.some((c) => c.code === "hap") ? "Affordable" : "Market";
    const mtmVal = unit.hasMTM ? 1 : null;
    const noticeToVac = unit.occStatus === "Notice" ? "1" : null;

    rows.push([
      null,                    // PropName
      unit.unitId,             // UnitID
      unit.planId,             // PlanID
      unit.sqFt,               // NetSF
      bed,                     // Bed
      bath,                    // Bath
      leaseType,               // LeaseType
      null,                    // RenStatus
      unit.occStatus,          // OccStatus
      unit.mktRent,            // MktRent
      unit.inPlaceRent,        // InPlaceRent
      unit.recConc,            // RecConc
      unit.netEffRent,         // NetEffRent
      null,                    // SuppRent
      null,                    // UpConc
      unit.empOtherConc,       // EmpOtherConc
      unit.otherInc,           // OtherInc
      null,                    // LeaseStart
      unit.leaseExp,           // LeaseExp
      null,                    // LeaseTerm
      mtmVal,                  // mtm
      unit.moveIn,             // MoveIn
      unit.moveOut,            // MoveOut
      noticeToVac,             // NoticeToVac
      // Future lease fields (all null)
      null, null, null, null, null, null, null, null, null, null, null, null,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 7 }, { wch: 5 }, { wch: 5 },
    { wch: 10 }, { wch: 8 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 },
    { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 13 }, { wch: 10 }, { wch: 12 },
    { wch: 12 }, { wch: 12 }, { wch: 5 }, { wch: 12 }, { wch: 12 }, { wch: 8 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 8 };
  return ws;
}

// ─── Source Data sheet ────────────────────────────────────────────
function buildSourceDataSheet(rr: ParsedRentRoll): XLSX.WorkSheet {
  const { propertyName, reportDate, totalUnits, units } = rr;

  // Build charge code label row (row 9) — first 11 unit info labels, then slot labels
  const chargeLabelRow: (string | null)[] = [
    "Unit No.", "Floor Plan Code", "Net sf", "Status / Code",
    'Enter "F" for', "Market", "Lease", "Lease", "Lease Term",
    "Move In", "Move Out",
    ...CHARGE_CODE_SLOTS,
  ];

  // Machine-readable header row (row 10)
  const machineHeaderRow: string[] = [
    "UnitID", "PlanID", "NetSF", "OccStatus", "IsFuture",
    "MktRent", "LeaseSign", "LeaseExp", "LeaseTerm", "MoveInDate", "MoveOutDate",
    ...CHARGE_CODE_SLOTS.map((_, i) => `Code${i + 1}`),
  ];

  const rows: (string | number | null | boolean)[][] = [
    // Row 0
    ["Required", "Optional", "Error"],
    // Row 1: blank
    [],
    // Row 2
    [`${propertyName} (${totalUnits} units)`, null, null, null, null, null, null, null, null, null, null, "Rent Roll Details"],
    // Row 3: blank
    [],
    // Row 4
    ["Rent Roll", reportDate ?? null, null, null, "", "entered"],
    // Row 5: blank
    [],
    // Row 6: blank
    [],
    // Row 7: section headers
    ["UNIT INFORMATION", null, null, null, null, null, "LEASE TERMS", null, null, null, null, "CHARGE CODES                      "],
    // Row 8: sub-headers
    [null, null, null, "Occupancy", 'Enter "F" for', "Market", "Lease", "Lease", "Lease Term", "Move In", "Move Out", "Enter individual charge codes into the blue cells below..."],
    // Row 9: human-readable charge code labels
    chargeLabelRow,
    // Row 10: machine-readable headers
    machineHeaderRow,
  ];

  // Data rows — all units (non-future then future, sorted by unitId)
  const nonFuture = units.filter((u) => !u.isFuture).sort((a, b) => a.unitId.localeCompare(b.unitId));
  const future = units.filter((u) => u.isFuture).sort((a, b) => a.unitId.localeCompare(b.unitId));

  for (const unit of [...nonFuture, ...future]) {
    rows.push([
      unit.unitId,
      unit.planId,
      unit.sqFt,
      unit.occStatus,
      unit.isFuture ? "F" : null,
      unit.mktRent,
      null,            // LeaseSign (not available in Yardi export)
      unit.leaseExp,
      null,            // LeaseTerm
      unit.moveIn,
      unit.moveOut,
      ...unit.codedCharges,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 10 }, { wch: 12 }, { wch: 7 }, { wch: 10 }, { wch: 10 },
    { wch: 9 }, { wch: 10 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 12 },
    ...CHARGE_CODE_SLOTS.map(() => ({ wch: 8 })),
  ];
  return ws;
}

// ─── Sheet2 (metadata) ────────────────────────────────────────────
function buildSheet2(rr: ParsedRentRoll): XLSX.WorkSheet {
  const { propertyName, reportDate, totalUnits } = rr;
  const rows = [
    [reportDate ?? null, "OldDateStamp", "<- Datestamp for initial download. Used for display on rent roll and floor plan tabs"],
    [null, "UniqueDealId", "<- UDID of deal downloaded from."],
    [null, "IsValid", "<- No Precedents, no dependents."],
    [null, "IsTemplate", "<- downloaded as template on wizard."],
    [propertyName, "DealName", null],
    [totalUnits, "DealUnits", "<- Dynamic: num units in rent roll tab"],
    [null, "UnitsPopulated", "<- Dynamic: current num units in source tab"],
    [reportDate ?? null, "DateStamp", "<- Datestamp"],
    [true, "isEdit or IsTemplate", "<- Now hardcoded, used in conditional formatting"],
    [totalUnits, "NumTotalUnits", "<- Total units (num raw units at time of download)"],
  ];
  return XLSX.utils.aoa_to_sheet(rows);
}

// ─── Main export ──────────────────────────────────────────────────
export function buildRedIQWorkbook(rr: ParsedRentRoll): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildFloorPlanSheet(rr), "Floor Plan");
  XLSX.utils.book_append_sheet(wb, buildRentRollSheet(rr), "Rent Roll");
  XLSX.utils.book_append_sheet(wb, buildSourceDataSheet(rr), "Source Data");
  XLSX.utils.book_append_sheet(wb, buildSheet2(rr), "Sheet2");
  return wb;
}

// ─── Helper ───────────────────────────────────────────────────────
function excelSerialToDateStr(serial: number): string {
  // Excel epoch: Dec 30, 1899
  const excelEpoch = new Date(1899, 11, 30);
  const d = new Date(excelEpoch.getTime() + serial * 86400000);
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const year = d.getFullYear();
  return `${month}/${day}/${year}`;
}
