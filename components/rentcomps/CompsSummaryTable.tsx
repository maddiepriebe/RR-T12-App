"use client";

import type { RentCompsData } from "@/lib/schemas";

interface CompsSummaryTableProps {
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

export default function CompsSummaryTable({ data }: CompsSummaryTableProps) {
  const allProps = [
    ...(data.comps.filter((c) => c.isSubject)),
    ...data.comps.filter((c) => !c.isSubject),
  ];

  // Averages (comps only, not subject)
  const comps = data.comps.filter((c) => !c.isSubject);
  const avgOrNull = (key: keyof (typeof comps)[0]) => {
    const vals = comps.map((c) => c[key] as number | null).filter((v): v is number => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  return (
    <div className="overflow-x-auto">
      <table className="finance-table text-xs">
        <thead>
          <tr>
            <th className="w-5">#</th>
            <th>Property</th>
            <th className="text-center">Built</th>
            <th className="text-center">Units</th>
            <th className="text-center">Avg SF</th>
            <th className="text-center">Dist</th>
            <th className="text-right">Studio</th>
            <th className="text-right">1BR</th>
            <th className="text-right">2BR</th>
            <th className="text-right">3BR</th>
            <th className="text-right">Rent/SF</th>
            <th className="text-right">Vacancy</th>
            <th className="text-right">Eff Rent</th>
            <th className="text-right">Concessions</th>
          </tr>
        </thead>
        <tbody>
          {allProps.map((comp, idx) => (
            <tr
              key={idx}
              className={comp.isSubject ? "bg-blue-50 font-semibold" : ""}
            >
              <td className="text-gray-400">
                {comp.isSubject ? "S" : comp.rank}
              </td>
              <td>
                <div className="font-medium text-navy-800 leading-tight">
                  {comp.name}
                </div>
                <div className="text-gray-400 text-xs leading-tight">
                  {comp.address}
                  {comp.city ? `, ${comp.city}` : ""}
                </div>
              </td>
              <td className="text-center">
                {comp.yearBuilt
                  ? comp.renovYear
                    ? `${comp.yearBuilt} (Renov. ${comp.renovYear})`
                    : comp.yearBuilt
                  : "—"}
              </td>
              <td className="text-center">{comp.totalUnits || "—"}</td>
              <td className="text-center">{comp.avgUnitSF || "—"}</td>
              <td className="text-center">
                {comp.distanceToSubjectMiles != null
                  ? `${comp.distanceToSubjectMiles.toFixed(2)} mi`
                  : "—"}
              </td>
              <td className="text-right font-mono">{fmtDollar(comp.studioAskingRent)}</td>
              <td className="text-right font-mono">{fmtDollar(comp.oneBedAskingRent)}</td>
              <td className="text-right font-mono">{fmtDollar(comp.twoBedAskingRent)}</td>
              <td className="text-right font-mono">{fmtDollar(comp.threeBedAskingRent)}</td>
              <td className="text-right font-mono">{fmtSF(comp.rentPerSF)}</td>
              <td className="text-right font-mono">{fmtPct(comp.totalVacancyPct)}</td>
              <td className="text-right font-mono">{fmtDollar(comp.effectiveRentPerUnit)}</td>
              <td className="text-right font-mono">{fmtPct(comp.concessionsPct)}</td>
            </tr>
          ))}

          {/* Averages row */}
          <tr className="row-subtotal">
            <td></td>
            <td>COMP AVERAGES</td>
            <td className="text-center">
              {avgOrNull("yearBuilt") ? Math.round(avgOrNull("yearBuilt")!) : "—"}
            </td>
            <td className="text-center">
              {avgOrNull("totalUnits") ? Math.round(avgOrNull("totalUnits")!) : "—"}
            </td>
            <td className="text-center">
              {avgOrNull("avgUnitSF") ? Math.round(avgOrNull("avgUnitSF")!) : "—"}
            </td>
            <td className="text-center">
              {avgOrNull("distanceToSubjectMiles")?.toFixed(2) || "—"} mi
            </td>
            <td className="text-right font-mono">{fmtDollar(avgOrNull("studioAskingRent"))}</td>
            <td className="text-right font-mono">{fmtDollar(avgOrNull("oneBedAskingRent"))}</td>
            <td className="text-right font-mono">{fmtDollar(avgOrNull("twoBedAskingRent"))}</td>
            <td className="text-right font-mono">{fmtDollar(avgOrNull("threeBedAskingRent"))}</td>
            <td className="text-right font-mono">{fmtSF(avgOrNull("rentPerSF"))}</td>
            <td className="text-right font-mono">{fmtPct(avgOrNull("totalVacancyPct"))}</td>
            <td className="text-right font-mono">{fmtDollar(avgOrNull("effectiveRentPerUnit"))}</td>
            <td className="text-right font-mono">{fmtPct(avgOrNull("concessionsPct"))}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}
