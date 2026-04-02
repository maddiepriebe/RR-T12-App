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
      unit.leaseStart,
      unit.leaseEnd,
      unit.marketRent,
      unit.actualRent,
      unit.lossToLease,
      unit.status,
      unit.moveInDate,
      unit.notes,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 }, { wch: 12 }, { wch: 5 }, { wch: 5 }, { wch: 8 },
    { wch: 20 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 13 },
    { wch: 13 }, { wch: 10 }, { wch: 12 }, { wch: 20 },
  ];

  return ws;
}

// ─── Rent Comps Excel Builder ──────────────────────────────────────
export function buildRentCompsWorkbook(data: RentCompsData): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();

  XLSX.utils.book_append_sheet(wb, buildSummarySheet(data), "Rent Comps Summary");
  XLSX.utils.book_append_sheet(wb, buildUnitMixSheet(data), "Unit Mix Detail");
  XLSX.utils.book_append_sheet(wb, buildBedroomSheet(data, 0), "Studio Comparison");
  XLSX.utils.book_append_sheet(wb, buildBedroomSheet(data, 1), "1BR Comparison");
  XLSX.utils.book_append_sheet(wb, buildBedroomSheet(data, 2), "2BR Comparison");
  XLSX.utils.book_append_sheet(wb, buildBedroomSheet(data, 3), "3BR Comparison");
  XLSX.utils.book_append_sheet(wb, buildSubjectVsCompsSheet(data), "Subject vs Comps");

  return wb;
}

function buildSummarySheet(data: RentCompsData): XLSX.WorkSheet {
  const headers = [
    "Rank",
    "Property Name",
    "Address",
    "Year Built",
    "Units",
    "Stories",
    "Avg SF",
    "Distance (mi)",
    "Studio Rent",
    "1BR Rent",
    "2BR Rent",
    "3BR Rent",
    "Rent/SF",
    "Vacancy %",
    "Effective Rent/Unit",
    "Effective Rent/SF",
    "Concessions %",
  ];

  const rows: (string | number | null)[][] = [
    ["Rent Comps Summary", ...Array(headers.length - 1).fill("")],
    headers,
  ];

  // Subject first if available
  if (data.subjectProperty) {
    const s = data.comps.find((c) => c.isSubject) || {
      rank: 0,
      name: data.subjectProperty!.propertyName,
      address: data.subjectProperty!.address || "",
      city: "",
      state: "",
      yearBuilt: data.subjectProperty!.yearBuilt,
      totalUnits: null,
      stories: null,
      avgUnitSF: null,
      distanceToSubjectMiles: 0,
      studioAskingRent: null,
      oneBedAskingRent: null,
      twoBedAskingRent: null,
      threeBedAskingRent: null,
      rentPerSF: null,
      totalVacancyPct: null,
      totalAvailabilityPct: null,
      askingRentPerUnit: null,
      askingRentPerSF: null,
      effectiveRentPerUnit: null,
      effectiveRentPerSF: null,
      concessionsPct: null,
    };
    rows.push([
      "Subject",
      s.name,
      `${s.address}${s.city ? ", " + s.city : ""}`,
      s.yearBuilt ?? null,
      s.totalUnits ?? null,
      s.stories ?? null,
      s.avgUnitSF ?? null,
      s.distanceToSubjectMiles ?? null,
      s.studioAskingRent,
      s.oneBedAskingRent,
      s.twoBedAskingRent,
      s.threeBedAskingRent,
      s.rentPerSF,
      s.totalVacancyPct != null ? s.totalVacancyPct / 100 : null,
      s.effectiveRentPerUnit,
      s.effectiveRentPerSF,
      s.concessionsPct != null ? s.concessionsPct / 100 : null,
    ]);
  }

  for (const comp of data.comps.filter((c) => !c.isSubject)) {
    rows.push([
      comp.rank,
      comp.name,
      `${comp.address}${comp.city ? ", " + comp.city : ""}`,
      comp.yearBuilt,
      comp.totalUnits,
      comp.stories,
      comp.avgUnitSF,
      comp.distanceToSubjectMiles,
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

  // Averages row
  const compRows = data.comps.filter((c) => !c.isSubject);
  const avg = (key: keyof CompSummary) => {
    const vals = compRows.map((c) => c[key] as number | null).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };
  rows.push([
    "",
    "AVERAGE (Comps)",
    "",
    avg("yearBuilt") ? Math.round(avg("yearBuilt")!) : null,
    avg("totalUnits") ? Math.round(avg("totalUnits")!) : null,
    "",
    avg("avgUnitSF") ? Math.round(avg("avgUnitSF")!) : null,
    avg("distanceToSubjectMiles"),
    avg("studioAskingRent"),
    avg("oneBedAskingRent"),
    avg("twoBedAskingRent"),
    avg("threeBedAskingRent"),
    avg("rentPerSF"),
    avg("totalVacancyPct") != null ? avg("totalVacancyPct")! / 100 : null,
    avg("effectiveRentPerUnit"),
    avg("effectiveRentPerSF"),
    avg("concessionsPct") != null ? avg("concessionsPct")! / 100 : null,
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 7 }, { wch: 28 }, { wch: 30 }, { wch: 11 }, { wch: 7 },
    { wch: 8 }, { wch: 9 }, { wch: 13 }, { wch: 13 }, { wch: 11 },
    { wch: 11 }, { wch: 11 }, { wch: 10 }, { wch: 11 }, { wch: 18 },
    { wch: 18 }, { wch: 13 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 2 };
  return ws;
}

function buildUnitMixSheet(data: RentCompsData): XLSX.WorkSheet {
  const allProps: CompDetail[] = [];
  if (data.subjectProperty) allProps.push({ ...data.subjectProperty, isSubject: true });
  allProps.push(...data.compDetails);

  const headers = [
    "Bed",
    "Bath",
    "Avg SF",
    "Units",
    "Mix %",
    "Avail Units",
    "Avail %",
    "Asking Rent/Unit",
    "Asking Rent/SF",
    "Eff Rent/Unit",
    "Eff Rent/SF",
    "Concessions %",
  ];

  const rows: (string | number | null)[][] = [];

  for (const prop of allProps) {
    rows.push([
      `${prop.isSubject ? "[SUBJECT] " : ""}${prop.propertyName}`,
      prop.address || "",
      ...Array(headers.length - 2).fill(""),
    ]);
    rows.push(headers);

    for (const ut of prop.unitTypes) {
      rows.push([
        ut.bed,
        ut.bath,
        ut.avgSF,
        ut.units,
        ut.mixPct != null ? ut.mixPct / 100 : null,
        ut.availableUnits,
        ut.availabilityPct != null ? ut.availabilityPct / 100 : null,
        ut.askingRentPerUnit,
        ut.askingRentPerSF,
        ut.effectiveRentPerUnit,
        ut.effectiveRentPerSF,
        ut.concessionsPct != null ? ut.concessionsPct / 100 : null,
      ]);
    }

    rows.push(Array(headers.length).fill("")); // spacer
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 6 }, { wch: 6 }, { wch: 8 }, { wch: 7 }, { wch: 8 },
    { wch: 11 }, { wch: 9 }, { wch: 17 }, { wch: 16 }, { wch: 14 },
    { wch: 13 }, { wch: 14 },
  ];
  return ws;
}

function buildBedroomSheet(data: RentCompsData, bed: number): XLSX.WorkSheet {
  const label = bed === 0 ? "Studio" : `${bed}BR`;
  const headers = [
    "Property",
    "Address",
    "Year Built",
    "Total Units",
    "Units of Type",
    "Mix %",
    "Avg SF",
    "Asking Rent/Unit",
    "Asking Rent/SF",
    "Eff Rent/Unit",
    "Eff Rent/SF",
    "Concessions %",
  ];

  const rows: (string | number | null)[][] = [
    [`${label} Comparison`, ...Array(headers.length - 1).fill("")],
    headers,
  ];

  const allProps: Array<{ detail: CompDetail; summary?: CompSummary }> = [];
  if (data.subjectProperty) {
    allProps.push({
      detail: { ...data.subjectProperty, isSubject: true },
      summary: data.comps.find((c) => c.isSubject),
    });
  }
  for (const d of data.compDetails) {
    allProps.push({
      detail: d,
      summary: data.comps.find((c) => c.name === d.propertyName),
    });
  }

  for (const { detail, summary } of allProps) {
    const unitTypes = detail.unitTypes.filter((u) => u.bed === bed && !u.label?.startsWith("All"));
    if (unitTypes.length === 0) continue;

    for (const ut of unitTypes) {
      rows.push([
        `${detail.isSubject ? "[SUBJECT] " : ""}${detail.propertyName}`,
        detail.address || "",
        summary?.yearBuilt || detail.yearBuilt || null,
        summary?.totalUnits || null,
        ut.units,
        ut.mixPct != null ? ut.mixPct / 100 : null,
        ut.avgSF,
        ut.askingRentPerUnit,
        ut.askingRentPerSF,
        ut.effectiveRentPerUnit,
        ut.effectiveRentPerSF,
        ut.concessionsPct != null ? ut.concessionsPct / 100 : null,
      ]);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 28 }, { wch: 28 }, { wch: 11 }, { wch: 12 }, { wch: 13 },
    { wch: 8 }, { wch: 8 }, { wch: 17 }, { wch: 16 }, { wch: 14 },
    { wch: 13 }, { wch: 14 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 2 };
  return ws;
}

function buildSubjectVsCompsSheet(data: RentCompsData): XLSX.WorkSheet {
  const headers = [
    "Property",
    "Address",
    "Year Built",
    "Units",
    "Avg SF",
    "Rent/SF",
    "Asking Rent/Unit",
    "Eff Rent/Unit",
    "Eff Rent/SF",
    "Vacancy %",
    "Concessions %",
  ];

  const rows: (string | number | null)[][] = [
    ["Subject vs. Comps", ...Array(headers.length - 1).fill("")],
    headers,
  ];

  // Subject first
  const subjectComp = data.comps.find((c) => c.isSubject);
  if (subjectComp) {
    rows.push([
      `[SUBJECT] ${subjectComp.name}`,
      `${subjectComp.address}, ${subjectComp.city}`,
      subjectComp.yearBuilt,
      subjectComp.totalUnits,
      subjectComp.avgUnitSF,
      subjectComp.rentPerSF,
      subjectComp.askingRentPerUnit,
      subjectComp.effectiveRentPerUnit,
      subjectComp.effectiveRentPerSF,
      subjectComp.totalVacancyPct != null ? subjectComp.totalVacancyPct / 100 : null,
      subjectComp.concessionsPct != null ? subjectComp.concessionsPct / 100 : null,
    ]);
  }

  // Comps sorted by rent/SF descending
  const sorted = [...data.comps.filter((c) => !c.isSubject)].sort(
    (a, b) => (b.rentPerSF || 0) - (a.rentPerSF || 0)
  );

  for (const comp of sorted) {
    rows.push([
      comp.name,
      `${comp.address}, ${comp.city}`,
      comp.yearBuilt,
      comp.totalUnits,
      comp.avgUnitSF,
      comp.rentPerSF,
      comp.askingRentPerUnit,
      comp.effectiveRentPerUnit,
      comp.effectiveRentPerSF,
      comp.totalVacancyPct != null ? comp.totalVacancyPct / 100 : null,
      comp.concessionsPct != null ? comp.concessionsPct / 100 : null,
    ]);
  }

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws["!cols"] = [
    { wch: 30 }, { wch: 30 }, { wch: 11 }, { wch: 7 }, { wch: 9 },
    { wch: 10 }, { wch: 17 }, { wch: 15 }, { wch: 14 }, { wch: 11 }, { wch: 14 },
  ];
  ws["!freeze"] = { xSplit: 0, ySplit: 2 };
  return ws;
}

export function workbookToBuffer(wb: XLSX.WorkBook): Buffer {
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
  return Buffer.from(buf);
}
