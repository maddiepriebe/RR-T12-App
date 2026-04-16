"use client";

import type { RentCompsData, CompSummary } from "@/lib/schemas";

interface SubjectVsCompsProps {
  data: RentCompsData;
}

function fmtDollar(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtPct(v: number | null) {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtSF(v: number | null) {
  if (v == null) return "—";
  return `$${v.toFixed(2)}`;
}

function DeltaCell({
  value,
  reference,
  format,
  row,
}: {
  value: number | null;
  reference: number | null;
  format: (v: number | null, row?: CompSummary) => string;
  row?: CompSummary;
}) {
  if (value == null || reference == null) {
    return <td className="text-right font-mono text-gray-400">{format(value, row)}</td>;
  }

  const above = value > reference;
  const below = value < reference;

  return (
    <td
      className={`text-right font-mono text-sm ${
        above ? "text-green-700 bg-green-50" : below ? "text-red-700 bg-red-50" : ""
      }`}
    >
      {format(value, row)}
    </td>
  );
}

export default function SubjectVsComps({ data }: SubjectVsCompsProps) {
  const subject = data.comps.find((c) => c.isSubject);
  const comps = [...data.comps.filter((c) => !c.isSubject)].sort(
    (a, b) => (b.rentPerSF ?? 0) - (a.rentPerSF ?? 0)
  );

  const fields: Array<{
    key: keyof CompSummary;
    label: string;
    format: (v: number | null, row?: CompSummary) => string;
  }> = [
    {
      key: "yearBuilt",
      label: "Year Built",
      format: (v, row) =>
        v ? (row?.renovYear ? `${v} (Renov. ${row.renovYear})` : String(v)) : "—",
    },
    { key: "totalUnits", label: "Total Units", format: (v) => String(v ?? "—") },
    { key: "avgUnitSF", label: "Avg SF", format: (v) => String(v ?? "—") },
    { key: "rentPerSF", label: "Rent/SF", format: fmtSF },
    { key: "askingRentPerUnit", label: "Asking/Unit", format: fmtDollar },
    { key: "effectiveRentPerUnit", label: "Eff Rent/Unit", format: fmtDollar },
    { key: "effectiveRentPerSF", label: "Eff Rent/SF", format: fmtSF },
    { key: "totalVacancyPct", label: "Vacancy %", format: fmtPct },
    { key: "concessionsPct", label: "Concessions %", format: fmtPct },
  ];

  return (
    <div className="overflow-x-auto">
      <table className="finance-table text-xs">
        <thead>
          <tr>
            <th className="text-left">Metric</th>
            {subject && (
              <th className="text-right bg-blue-800">
                {subject.name} (Subject)
              </th>
            )}
            {comps.map((c, idx) => (
              <th key={idx} className="text-right">
                {c.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {fields.map((field, fIdx) => (
            <tr key={fIdx}>
              <td className="font-semibold text-gray-600 uppercase text-xs tracking-wide">
                {field.label}
              </td>
              {subject && (
                <td className="text-right font-mono font-semibold bg-blue-50">
                  {field.format(subject[field.key] as number | null, subject)}
                </td>
              )}
              {comps.map((comp, cIdx) => (
                <DeltaCell
                  key={cIdx}
                  value={comp[field.key] as number | null}
                  reference={subject ? (subject[field.key] as number | null) : null}
                  format={field.format}
                  row={comp}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-xs text-gray-400 mt-2">
        Green = above subject | Red = below subject (sorted by Rent/SF)
      </p>
    </div>
  );
}
