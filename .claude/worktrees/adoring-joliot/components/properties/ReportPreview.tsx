"use client";

import YardiRentRollPreview from "@/components/rediq/YardiRentRollPreview";
import RentRollPreview from "@/components/rediq/RentRollPreview";
import T12Preview from "@/components/rediq/T12Preview";
import CompsSummaryTable from "@/components/rentcomps/CompsSummaryTable";
import type { ParsedRentRoll } from "@/lib/yardi-parser";
import type { RentRollData, T12Data, RentCompsData } from "@/lib/schemas";

interface TradeOutRow {
  unitId: string;
  planId: string;
  sqFt: number | null;
  periodLabels: string[];
  rents: (number | null)[];
  tradeOut: number | null;
  tradeOutPct: number | null;
}

interface FloorPlanSummary {
  planId: string;
  units: number;
  avgRent: (number | null)[];
  avgTradeOut: number | null;
}

interface ReportPreviewProps {
  type: string;
  processedData: Record<string, unknown>;
}

function fmt(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function fmtPct(v: number | null) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export default function ReportPreview({ type, processedData }: ReportPreviewProps) {
  if (type === "rentroll") {
    const pd = processedData as { format: string; data: unknown };
    if (pd.format === "yardi") {
      return <YardiRentRollPreview data={pd.data as ParsedRentRoll} />;
    }
    return <RentRollPreview data={pd.data as RentRollData} />;
  }

  if (type === "t12") {
    const pd = processedData as { data: T12Data };
    return <T12Preview data={pd.data} />;
  }

  if (type === "rentcomps") {
    const pd = processedData as { data: RentCompsData };
    return (
      <div>
        <p className="text-xs text-gray-500 mb-3">
          {pd.data.comps.filter((c) => !c.isSubject).length} comps ·{" "}
          {pd.data.compDetails.length} unit mix tables
          {pd.data.subjectProperty && ` · Subject: ${pd.data.subjectProperty.propertyName}`}
        </p>
        <CompsSummaryTable data={pd.data} />
      </div>
    );
  }

  if (type === "tradeout") {
    const pd = processedData as {
      tradeOuts: TradeOutRow[];
      planSummary: FloorPlanSummary[];
      periodLabels: string[];
    };
    const { tradeOuts, planSummary, periodLabels } = pd;

    return (
      <div className="space-y-5">
        {/* Floor plan summary */}
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-navy-600 mb-2">Floor Plan Summary</p>
          <div className="overflow-x-auto">
            <table className="finance-table text-xs">
              <thead>
                <tr>
                  <th>Floor Plan</th>
                  <th className="text-center">Units</th>
                  {periodLabels.map((l) => (
                    <th key={l} className="text-right">Avg Rent ({l})</th>
                  ))}
                  <th className="text-right">Avg Trade-Out</th>
                </tr>
              </thead>
              <tbody>
                {planSummary.map((p) => (
                  <tr key={p.planId}>
                    <td className="font-medium">{p.planId}</td>
                    <td className="text-center">{p.units}</td>
                    {p.avgRent.map((r, i) => (
                      <td key={i} className="text-right font-mono">{fmt(r)}</td>
                    ))}
                    <td className={`text-right font-mono font-semibold ${(p.avgTradeOut ?? 0) >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {fmt(p.avgTradeOut)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Unit-level table */}
        <div>
          <p className="text-xs font-bold uppercase tracking-widest text-navy-600 mb-2">Unit-Level Trade-Outs</p>
          <div className="overflow-x-auto max-h-80 overflow-y-auto">
            <table className="finance-table text-xs">
              <thead>
                <tr>
                  <th>Unit</th>
                  <th>Plan</th>
                  {periodLabels.map((l) => (
                    <th key={l} className="text-right">Rent ({l})</th>
                  ))}
                  <th className="text-right">Trade-Out $</th>
                  <th className="text-right">Trade-Out %</th>
                </tr>
              </thead>
              <tbody>
                {tradeOuts.map((row, idx) => (
                  <tr key={idx}>
                    <td className="font-medium">{row.unitId}</td>
                    <td className="text-gray-500">{row.planId}</td>
                    {row.rents.map((r, i) => (
                      <td key={i} className="text-right font-mono">{fmt(r)}</td>
                    ))}
                    <td className={`text-right font-mono font-semibold ${(row.tradeOut ?? 0) >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {fmt(row.tradeOut)}
                    </td>
                    <td className={`text-right font-mono ${(row.tradeOutPct ?? 0) >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {fmtPct(row.tradeOutPct)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  }

  return <p className="text-sm text-gray-400">No preview available for this report type.</p>;
}
