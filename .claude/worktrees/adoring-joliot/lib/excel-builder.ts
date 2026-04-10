import * as XLSX from "xlsx";
import type { T12Data, RentRollData, RentCompsData, CompSummary, CompDetail } from "./schemas";

// ─── Color constants ───────────────────────────────────────────────
const NAVY_BG = "1a3f5f";
const GOLD_BG = "eebb38";
const LIGHT_BLUE_BG = "dce9f5";
const LIGHT_GRAY_BG = "f5f5f5";
const GREEN_BG = "c6efce";
const RED_BG = "ffc7ce";
const ORANGE_BG = "ffeb9c";
const YELLOW_BG = "ffff99";
const WHITE_BG = "ffffff";
const HEADER_FONT_COLOR = "ffffff";
const DARK_FONT = "1a1a1a";

function moneyFmt(v: number | null) {
  return v == null ? "" : v;
}

function isoToExcelSerial(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const excelEpoch = new Date(1899, 11, 30);
  return Math.round((d.getTime() - excelEpoch.getTime()) / 86400000);
}

function pctFmt(v: number | null) {
  return v == null ? "" : v / 100;
}

// ─── T12 Excel Builder ─────────────────────────────────────────────
export function buildT12Workbook(t12: T12Data, rentRoll?: RentRollData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  if (t12) {
    const ws = buildT12Sheet(t12);
    XLSX.utils.book_append_sheet(wb, ws, "T12 Summary");
  }

  if (rentRoll) {
    const ws = buildRentRollSheet(rentRoll);
    XLSX.utils.book_append_sheet(wb, ws, "Rent Roll");
  }

  return wb;
}

function buildT12Sheet(t12: T12Data): XLSX.WorkSheet {
  const rows: (string | number | null)[][] = [];

  // Title rows
  rows.push([t12.propertyName || "Property", "", "", ""]);
  rows.push(["T12 Income Statement", "", "", ""]);
  if (t12.period) rows.push([`Period: ${t12.period}`, "", "", ""]);
  rows.push(["", "", "", ""]);

  // Header
  rows.push(["Line Item", "Actual ($)", "Per Unit", "% of EGI"]);

  let currentSection = "";

  for (const item of t12.lineItems) {
    if (item.category !== currentSection) {
      currentSection = item.category;
      rows.push([
        currentSection === "income"
          ? "INCOME"
          : currentSection === "expense"
          ? "EXPENSES"
          : "NET OPERATING INCOME",
        "",
        "",
        "",
      ]);
    }

    const indent = item.indent ? "  ".repeat(item.indent) : "";
    rows.push([
      `${indent}${item.label}`,
      moneyFmt(item.actual),
      moneyFmt(item.perUnit),
      item.pctEGI != null ? item.pctEGI / 100 : null,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths
  ws["!cols"] = [{ wch: 38 }, { wch: 16 }, { wch: 14 }, { wch: 12 }];

  return ws;
}

function buildRentRollSheet(rr: RentRollData): XLSX.WorkSheet {
  const headers = [
    "Unit",
    "Unit Type",
    "Bed",
    "Bath",
    "Sq Ft",
    "Tenant Name",
    "Lease Start",
    "Lease End",
    "Market Rent",
    "Actual Rent",
    "Loss to Lease",
    "Status",
    "Move-In Date",
    "Notes",
  ];

  const rows: (string | number | null)[][] = [
    [rr.propertyName || "Property", ...Array(headers.length - 1).fill("")],
    ["Rent Roll", ...Array(headers.length - 1).fill("")],
    headers,
  ];

  for (const unit of rr.units) {
    rows.push([
      unit.unit,
      unit.unitType,
      unit.bed,
      unit.bath,
      unit.sqFt,
      unit.tenantName,
      isoToExcelSerial(unit.leaseStart),
      isoToExcelSerial(unit.leaseEnd),
      unit.marketRent,
      unit.actualRent,
      unit.lossToLease,
      unit.status,
      isoToExcelSerial(unit.moveInDate),
      unit.notes,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 }, { wch: 12 }, { wch: 5 }, { wch: 5 }, { wch: 8 },
    { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 13 },
    { wch: 13 }, { wch: 10 }, { wch: 12 }, { wch: 20 },
  ];

  // Apply short date format to date columns: LeaseStart=6, LeaseEnd=7, MoveInDate=12
  // Data rows start at row 3 (2 title rows + 1 header row)
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let R = 3; R <= range.e.r; R++) {
    for (const C of [6, 7, 12]) {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === "n") cell.z = "m/d/yy";
    }
  }

  return ws;
}

// ─── Rent Comps Excel Builder ──────────────────────────────────────
// Produces exactly 2 sheets matching Arel Capital reference format:
//   Sheet 1: "Rent Comps Summary" — 18-column table, subject in gold, comps ranked by Rent/SF
//   Sheet 2: "Data Sheet"         — columns A–E blank, 4 bedroom sections with per-floor-plan rows
export function buildRentCompsWorkbook(data: RentCompsData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, buildRCSheet1(data), "Rent Comps Summary");
  XLSX.utils.book_append_sheet(wb, buildRCSheet2(data), "Data Sheet");
  return wb;
}

// ── Sheet 1: Rent Comps Summary ────────────────────────────────────
function buildRCSheet1(data: RentCompsData): XLSX.WorkSheet {
  const NUM_COLS = 18;

  // Sort comps (non-subject) by Rent/SF descending and re-rank 1..N
  const subjectComp = data.comps.find((c) => c.isSubject);
  const sortedComps = [...data.comps.filter((c) => !c.isSubject)]
    .sort((a, b) => (b.rentPerSF ?? 0) - (a.rentPerSF ?? 0))
    .map((c, i) => ({ ...c, rank: i + 1 }));

  const rows: (string | number | null)[][] = [];

  // Row 0: Title (will be merged)
  rows.push(["Rent Comps Summary", ...Array(NUM_COLS - 1).fill(null)]);

  // Row 1: Column headers
  rows.push([
    "Rank", "Property Name", "Address", "Year Built", "Units", "Stories", "Avg SF",
    "Distance (mi)", "CoStar Rating", "Studio Rent", "1BR Rent", "2BR Rent", "3BR Rent",
    "Rent/SF", "Vacancy %", "Effective Rent/Unit", "Effective Rent/SF", "Concessions %",
  ]);

  // Row 2: Subject property ("Subject" in Rank col, no Distance)
  if (subjectComp) {
    rows.push([
      "Subject",
      subjectComp.name,
      [subjectComp.address, subjectComp.city].filter(Boolean).join(", "),
      subjectComp.yearBuilt,
      subjectComp.totalUnits,
      subjectComp.stories,
      subjectComp.avgUnitSF,
      null,                                       // no distance for subject
      subjectComp.coStarRating ?? null,
      subjectComp.studioAskingRent,
      subjectComp.oneBedAskingRent,
      subjectComp.twoBedAskingRent,
      subjectComp.threeBedAskingRent,
      subjectComp.rentPerSF,
      subjectComp.totalVacancyPct != null ? subjectComp.totalVacancyPct / 100 : null,
      subjectComp.effectiveRentPerUnit,
      subjectComp.effectiveRentPerSF,
      subjectComp.concessionsPct != null ? subjectComp.concessionsPct / 100 : null,
    ]);
  }

  // Rows 3+: Comps ranked 1..N sorted by Rent/SF desc
  for (const comp of sortedComps) {
    rows.push([
      comp.rank,
      comp.name,
      [comp.address, comp.city].filter(Boolean).join(", "),
      comp.yearBuilt,
      comp.totalUnits,
      comp.stories,
      comp.avgUnitSF,
      comp.distanceToSubjectMiles,
      comp.coStarRating ?? null,
      comp.studioAskingRent,
      comp.oneBedAskingRent,
      comp.twoBedAskingRent,
      comp.threeBedAskingRent,
      comp.rentPerSF,
      comp.totalVacancyPct != null ? comp.totalVacancyPct / 100 : null,
      comp.effectiveRentPerUnit,
      comp.effectiveRentPerSF,
      comp.concessionsPct != null ? comp.concessionsPct / 100 : null,
    ]);
  }

  // Final row: AVERAGE (Comps) — simple avg for most cols, weighted avg by units for rent metrics
  const simpleAvg = (key: keyof CompSummary): number | null => {
    const vals = sortedComps
      .map((c) => c[key] as number | null)
      .filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  const weightedAvg = (key: keyof CompSummary): number | null => {
    const pairs = sortedComps
      .map((c) => ({ v: c[key] as number | null, u: c.totalUnits }))
      .filter((p): p is { v: number; u: number } => p.v != null && p.u != null);
    const sumU = pairs.reduce((s, p) => s + p.u, 0);
    if (sumU === 0 || pairs.length === 0) return simpleAvg(key);
    return pairs.reduce((s, p) => s + p.v * p.u, 0) / sumU;
  };

  const avgYearBuilt = simpleAvg("yearBuilt");
  const avgUnits = simpleAvg("totalUnits");
  const avgSF = simpleAvg("avgUnitSF");
  const avgVacancy = simpleAvg("totalVacancyPct");
  const avgConc = simpleAvg("concessionsPct");

  rows.push([
    null,
    "AVERAGE (Comps)",
    null,
    avgYearBuilt != null ? Math.round(avgYearBuilt) : null,
    avgUnits != null ? Math.round(avgUnits) : null,
    null,
    avgSF != null ? Math.round(avgSF) : null,
    simpleAvg("distanceToSubjectMiles"),
    null,                                          // no avg for CoStar Rating
    simpleAvg("studioAskingRent"),
    simpleAvg("oneBedAskingRent"),
    simpleAvg("twoBedAskingRent"),
    simpleAvg("threeBedAskingRent"),
    weightedAvg("rentPerSF"),
    avgVacancy != null ? avgVacancy / 100 : null,
    weightedAvg("effectiveRentPerUnit"),
    weightedAvg("effectiveRentPerSF"),
    avgConc != null ? avgConc / 100 : null,
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Merge title row across all 18 columns
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: NUM_COLS - 1 } }];

  // Freeze below header row (rows 0 + 1)
  ws["!freeze"] = { xSplit: 0, ySplit: 2 };

  // Column widths
  ws["!cols"] = [
    { wch: 8 },  // Rank
    { wch: 28 }, // Property Name
    { wch: 32 }, // Address
    { wch: 11 }, // Year Built
    { wch: 7 },  // Units
    { wch: 8 },  // Stories
    { wch: 9 },  // Avg SF
    { wch: 13 }, // Distance
    { wch: 12 }, // CoStar Rating
    { wch: 13 }, // Studio Rent
    { wch: 11 }, // 1BR Rent
    { wch: 11 }, // 2BR Rent
    { wch: 11 }, // 3BR Rent
    { wch: 10 }, // Rent/SF
    { wch: 11 }, // Vacancy %
    { wch: 18 }, // Effective Rent/Unit
    { wch: 18 }, // Effective Rent/SF
    { wch: 13 }, // Concessions %
  ];

  // Apply number formats (rows 2+ = subject + comps + avg)
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let R = 2; R <= range.e.r; R++) {
    // Studio, 1BR, 2BR, 3BR rents, Effective Rent/Unit → $#,##0
    [9, 10, 11, 12, 15].forEach((C) => {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === "n") cell.z = "$#,##0";
    });
    // Rent/SF, Effective Rent/SF → $0.00
    [13, 16].forEach((C) => {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === "n") cell.z = "$0.00";
    });
    // Vacancy %, Concessions % → stored as decimal, format 0.0%
    [14, 17].forEach((C) => {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell && cell.t === "n") cell.z = "0.0%";
    });
    // Distance → 0.00
    const distCell = ws[XLSX.utils.encode_cell({ r: R, c: 7 })];
    if (distCell && distCell.t === "n") distCell.z = "0.00";
  }

  return ws;
}

// ── Sheet 2: Data Sheet ────────────────────────────────────────────
// Columns A–E blank; data in F–R (0-indexed cols 5–17).
// Four bedroom-type sections (Studio, 1BR, 2BR, 3BR), each structured as:
//   blank separator row
//   column header row  (Property Name | Bed | Bath | … | Stars)
//   one data row per floor plan  (subject property first, then comps in
//     first-appearance order matching the source document)
//   weighted-average footer row  (no Property Name / Bed / Bath /
//     Concessions / Vintage / Stars — just numeric aggregates)
//
// mixPct and concessionsPct arrive already as true decimals (e.g. 0.061,
// 0.01) from toRentCompsData — do NOT divide by 100 again.
function buildRCSheet2(data: RentCompsData): XLSX.WorkSheet {
  const BLANK5 = [null, null, null, null, null] as const;

  const COL_HEADERS = [
    "Property Name", "Bed", "Bath", "Avg SF", "Units", "Mix %",
    "ASK Per Unit", "ASK Per SF", "EFF Per Unit", "EFF Per SF",
    "Concessions", "Vintage", "Stars",
  ];

  // 0-indexed column positions for number-format application (cols 5–17 = F–R)
  const C_ASK_UNIT  = 11; // L  $#,##0
  const C_ASK_SF    = 12; // M  $0.00
  const C_EFF_UNIT  = 13; // N  $#,##0
  const C_EFF_SF    = 14; // O  $0.00
  const C_MIX_PCT   = 10; // K  0.0%
  const C_CONC      = 15; // P  0.0%

  // Property order: compDetails preserves insertion order from toRentCompsData,
  // which mirrors the source document order (subject first).
  const orderedDetails: CompDetail[] = data.subjectProperty
    ? [
        { ...data.subjectProperty, isSubject: true },
        ...data.compDetails.filter(
          (d) => d.propertyName !== data.subjectProperty!.propertyName
        ),
      ]
    : [...data.compDetails];

  // CompSummary lookup for yearBuilt / coStarRating
  const summaryByName = new Map<string, CompSummary>();
  for (const c of data.comps) summaryByName.set(c.name.toLowerCase().trim(), c);

  type FPRow = {
    propertyName: string;
    bedDisplay: string | number;
    bath: number | null;
    avgSF: number | null;
    units: number | null;
    mixPct: number | null;       // true decimal, e.g. 0.061
    askPerUnit: number | null;
    askPerSF: number | null;
    effPerUnit: number | null;
    effPerSF: number | null;
    concessions: number | null;  // true decimal, e.g. 0.01
    vintage: number | null;
    stars: number | null;
  };

  const wAvg = (fpRows: FPRow[], getValue: (r: FPRow) => number | null): number | null => {
    const pairs = fpRows
      .map((r) => ({ v: getValue(r), u: r.units }))
      .filter((p): p is { v: number; u: number } => p.v != null && p.u != null);
    const sumU = pairs.reduce((s, p) => s + p.u, 0);
    if (!sumU || !pairs.length) return null;
    return pairs.reduce((s, p) => s + p.v * p.u, 0) / sumU;
  };

  const rows: (string | number | null)[][] = [];

  for (const bed of [0, 1, 2, 3]) {
    const sectionRows: FPRow[] = [];

    for (const detail of orderedDetails) {
      const summary = summaryByName.get(detail.propertyName.toLowerCase().trim());
      const vintage = detail.yearBuilt ?? summary?.yearBuilt ?? null;
      const rawStars = summary?.coStarRating ?? 0;
      const stars = rawStars > 0 ? rawStars : null;

      const unitTypes = detail.unitTypes.filter((ut) => {
        if (ut.bed !== bed) return false;
        // Defensive: skip any aggregate rows that slipped through
        const lbl = (ut.label ?? "").toLowerCase().trim();
        return !lbl.startsWith("all ") && lbl !== "totals" && lbl !== "total";
      });

      for (const ut of unitTypes) {
        sectionRows.push({
          propertyName: detail.propertyName,
          bedDisplay: bed === 0 ? "Studio" : bed,
          bath: ut.bath,
          avgSF: ut.avgSF,
          units: ut.units,
          mixPct: ut.mixPct ?? null,            // already decimal
          askPerUnit: ut.askingRentPerUnit,
          askPerSF: ut.askingRentPerSF,
          effPerUnit: ut.effectiveRentPerUnit,
          effPerSF: ut.effectiveRentPerSF,
          concessions: ut.concessionsPct ?? null, // already decimal
          vintage,
          stars,
        });
      }
    }

    if (sectionRows.length === 0) continue;

    // ── Blank separator ──────────────────────────────────────────────
    rows.push([...BLANK5, ...Array(13).fill(null)]);

    // ── Per-section column header row ────────────────────────────────
    rows.push([...BLANK5, ...COL_HEADERS]);

    // ── Floor-plan data rows ─────────────────────────────────────────
    for (const r of sectionRows) {
      rows.push([
        ...BLANK5,
        r.propertyName,
        r.bedDisplay,
        r.bath,
        r.avgSF,
        r.units,
        r.mixPct,
        r.askPerUnit,
        r.askPerSF,
        r.effPerUnit,
        r.effPerSF,
        r.concessions,
        r.vintage,
        r.stars,
      ]);
    }

    // ── Weighted-average footer row ───────────────────────────────────
    const totalUnits = sectionRows.reduce((s, r) => s + (r.units ?? 0), 0);
    const totalMixPct = sectionRows.reduce((s, r) => s + (r.mixPct ?? 0), 0);

    rows.push([
      ...BLANK5,
      null,                              // Property Name — blank
      null,                              // Bed — blank
      null,                              // Bath — blank
      wAvg(sectionRows, (r) => r.avgSF), // Avg SF — weighted avg by units
      totalUnits,                        // Units — sum
      totalMixPct,                       // Mix % — sum (≈ 1.0)
      wAvg(sectionRows, (r) => r.askPerUnit),
      wAvg(sectionRows, (r) => r.askPerSF),
      wAvg(sectionRows, (r) => r.effPerUnit),
      wAvg(sectionRows, (r) => r.effPerSF),
      null,                              // Concessions — blank
      null,                              // Vintage — blank
      null,                              // Stars — blank
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Column widths: A–E very narrow, F–R data columns
  ws["!cols"] = [
    { wch: 1 },  { wch: 1 },  { wch: 1 },  { wch: 1 },  { wch: 1 }, // A–E blank
    { wch: 30 }, // F  Property Name
    { wch: 8 },  // G  Bed
    { wch: 6 },  // H  Bath
    { wch: 9 },  // I  Avg SF
    { wch: 7 },  // J  Units
    { wch: 9 },  // K  Mix %
    { wch: 14 }, // L  ASK Per Unit
    { wch: 12 }, // M  ASK Per SF
    { wch: 14 }, // N  EFF Per Unit
    { wch: 12 }, // O  EFF Per SF
    { wch: 12 }, // P  Concessions
    { wch: 9 },  // Q  Vintage
    { wch: 7 },  // R  Stars
  ];

  // Apply number formats to every row (header cells are text; only numeric
  // cells get a format, so this is safe to run over the whole sheet).
  const range = XLSX.utils.decode_range(ws["!ref"]!);
  for (let R = 0; R <= range.e.r; R++) {
    [C_ASK_UNIT, C_EFF_UNIT].forEach((C) => {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell?.t === "n") cell.z = "$#,##0";
    });
    [C_ASK_SF, C_EFF_SF].forEach((C) => {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell?.t === "n") cell.z = "$0.00";
    });
    [C_MIX_PCT, C_CONC].forEach((C) => {
      const cell = ws[XLSX.utils.encode_cell({ r: R, c: C })];
      if (cell?.t === "n") cell.z = "0.0%";
    });
  }

  return ws;
}

export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf);
}
