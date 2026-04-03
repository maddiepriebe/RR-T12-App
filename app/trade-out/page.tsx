"use client";

import { useState, useEffect } from "react";
import NavBar from "@/components/shared/NavBar";
import UploadZone from "@/components/rediq/UploadZone";
import ProgressIndicator from "@/components/shared/ProgressIndicator";
import type { ParsedRentRoll } from "@/lib/yardi-parser";

type Status = "idle" | "processing" | "done" | "error";
type StepStatus = "pending" | "active" | "done" | "error";

interface Property { id: string; name: string; }

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

function fmt(v: number | null) {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function fmtPct(v: number | null) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
}

export default function TradeOutPage() {
  const [periods, setPeriods] = useState<{ file: File | null; label: string }[]>([
    { file: null, label: "Period 1" },
    { file: null, label: "Period 2" },
  ]);
  const [parsedPeriods, setParsedPeriods] = useState<ParsedRentRoll[]>([]);
  const [tradeOuts, setTradeOuts] = useState<TradeOutRow[]>([]);
  const [planSummary, setPlanSummary] = useState<FloorPlanSummary[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState([
    { label: "Parsing rent rolls", status: "pending" as StepStatus },
    { label: "Matching units", status: "pending" as StepStatus },
    { label: "Computing trade-outs", status: "pending" as StepStatus },
  ]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [savedToLibrary, setSavedToLibrary] = useState(false);

  useEffect(() => {
    fetch("/api/properties").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setProperties(data);
    }).catch(() => {});
  }, []);

  function addPeriod() {
    setPeriods((prev) => [...prev, { file: null, label: `Period ${prev.length + 1}` }]);
  }

  function removePeriod(idx: number) {
    setPeriods((prev) => prev.filter((_, i) => i !== idx));
  }

  function updateStep(idx: number, s: StepStatus) {
    setSteps((prev) => prev.map((step, i) => (i === idx ? { ...step, status: s } : step)));
  }

  async function processFiles() {
    const validPeriods = periods.filter((p) => p.file);
    if (validPeriods.length < 2) {
      setError("Please upload at least 2 rent roll periods.");
      return;
    }

    setStatus("processing");
    setError(null);
    setParsedPeriods([]);
    setTradeOuts([]);
    setPlanSummary([]);
    setSavedToLibrary(false);
    setSteps([
      { label: "Parsing rent rolls", status: "active" },
      { label: "Matching units", status: "pending" },
      { label: "Computing trade-outs", status: "pending" },
    ]);

    try {
      // Parse all periods in parallel
      const parseResults = await Promise.all(
        validPeriods.map(async (p) => {
          const fd = new FormData();
          fd.append("file", p.file!);
          const res = await fetch("/api/rediq/process-rentroll", { method: "POST", body: fd });
          const j = await res.json();
          if (!j.success) throw new Error(j.error || "Failed to parse period");
          if (j.format !== "yardi") throw new Error("Trade-Out analysis currently requires Yardi format rent rolls.");
          return j.data as ParsedRentRoll;
        })
      );

      updateStep(0, "done");
      updateStep(1, "active");
      setParsedPeriods(parseResults);

      // Build unit map from all periods
      const allUnitIds = new Set<string>();
      parseResults.forEach((pr) => {
        pr.units.filter((u) => !u.isFuture).forEach((u) => allUnitIds.add(u.unitId));
      });

      updateStep(1, "done");
      updateStep(2, "active");

      const periodLabels = validPeriods.map((p) => p.label);
      const rows: TradeOutRow[] = [];

      for (const unitId of allUnitIds) {
        const unitData = parseResults.map((pr) => {
          return pr.units.find((u) => u.unitId === unitId && !u.isFuture) ?? null;
        });

        const rents = unitData.map((u) => u?.inPlaceRent ?? null);
        const firstRent = rents[0];
        const lastRent = rents[rents.length - 1];
        const tradeOut = firstRent != null && lastRent != null ? lastRent - firstRent : null;
        const tradeOutPct = tradeOut != null && firstRent ? (tradeOut / firstRent) * 100 : null;

        const firstUnit = unitData.find((u) => u != null);
        rows.push({
          unitId,
          planId: firstUnit?.planId ?? "",
          sqFt: firstUnit?.sqFt ?? null,
          periodLabels,
          rents,
          tradeOut,
          tradeOutPct,
        });
      }

      rows.sort((a, b) => a.unitId.localeCompare(b.unitId));
      setTradeOuts(rows);

      // Floor plan summary
      const planMap = new Map<string, TradeOutRow[]>();
      for (const row of rows) {
        if (!planMap.has(row.planId)) planMap.set(row.planId, []);
        planMap.get(row.planId)!.push(row);
      }

      const plans: FloorPlanSummary[] = Array.from(planMap.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([planId, planRows]) => {
          const avgRent = parseResults.map((_, pIdx) => {
            const vals = planRows.map((r) => r.rents[pIdx]).filter((v): v is number => v != null);
            return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
          });
          const trades = planRows.map((r) => r.tradeOut).filter((v): v is number => v != null);
          return {
            planId,
            units: planRows.length,
            avgRent,
            avgTradeOut: trades.length ? trades.reduce((a, b) => a + b, 0) / trades.length : null,
          };
        });

      setPlanSummary(plans);

      updateStep(2, "done");
      setStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An error occurred";
      setError(msg);
      setStatus("error");
      setSteps((prev) => prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s)));
    }
  }

  async function saveToLibrary() {
    if (!selectedPropertyId) return;
    await fetch(`/api/properties/${selectedPropertyId}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "tradeout",
        label: `Trade-Out (${periods.filter((p) => p.file).length} periods)`,
        metadata: { periods: periods.filter((p) => p.file).map((p) => p.label), unitCount: tradeOuts.length },
      }),
    });
    setSavedToLibrary(true);
  }

  const validPeriodCount = periods.filter((p) => p.file).length;
  const periodLabels = periods.filter((p) => p.file).map((p) => p.label);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy-900">Trade-Out Analysis</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Upload multiple rent roll snapshots to compare unit-level rent changes across periods. Requires Yardi format.
          </p>
        </div>

        <div className="card mb-6">
          <p className="section-header">Upload Periods</p>

          {properties.length > 0 && (
            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Property (optional)</label>
              <select
                className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
                value={selectedPropertyId}
                onChange={(e) => setSelectedPropertyId(e.target.value)}
              >
                <option value="">— Select property to save to library —</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-3 mb-4">
            {periods.map((period, idx) => (
              <div key={idx} className="flex items-center gap-3">
                <div className="w-32 flex-shrink-0">
                  <input
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
                    value={period.label}
                    onChange={(e) => {
                      const newPeriods = [...periods];
                      newPeriods[idx] = { ...period, label: e.target.value };
                      setPeriods(newPeriods);
                    }}
                    placeholder="Label"
                  />
                </div>
                <div className="flex-1">
                  <UploadZone
                    label={`${period.label} Rent Roll`}
                    sublabel="Yardi rent roll Excel"
                    file={period.file}
                    onFile={(f) => {
                      const newPeriods = [...periods];
                      newPeriods[idx] = { ...period, file: f };
                      setPeriods(newPeriods);
                    }}
                    disabled={status === "processing"}
                    compact
                  />
                </div>
                {periods.length > 2 && (
                  <button onClick={() => removePeriod(idx)} className="text-gray-400 hover:text-red-500 text-sm">x</button>
                )}
              </div>
            ))}
          </div>

          <div className="flex items-center gap-4">
            <button onClick={addPeriod} className="text-sm text-navy-700 hover:text-navy-900 font-medium">
              + Add Period
            </button>
          </div>

          <div className="flex items-center gap-4 mt-5">
            <button
              onClick={processFiles}
              disabled={validPeriodCount < 2 || status === "processing"}
              className="btn-primary"
            >
              {status === "processing" ? "Processing..." : "Analyze Trade-Outs"}
            </button>
            {tradeOuts.length > 0 && selectedPropertyId && !savedToLibrary && (
              <button onClick={saveToLibrary} className="btn-outline">Save to Library</button>
            )}
            {savedToLibrary && (
              <span className="text-sm text-green-600 font-medium">Saved to library</span>
            )}
          </div>
        </div>

        {status === "processing" && (
          <div className="card mb-6">
            <p className="section-header">Processing</p>
            <ProgressIndicator steps={steps} />
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm font-semibold text-red-700">Error</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        )}

        {tradeOuts.length > 0 && (
          <div className="space-y-6">
            {/* Floor Plan Summary */}
            <div className="card">
              <p className="section-header">Floor Plan Summary</p>
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

            {/* Lease Maturity Chart */}
            <LeaseMaturityChart data={parsedPeriods[parsedPeriods.length - 1]} label={periodLabels[periodLabels.length - 1]} />

            {/* Unit-level trade-out table */}
            <div className="card">
              <p className="section-header">Unit-Level Trade-Outs</p>
              <div className="overflow-x-auto">
                <table className="finance-table text-xs">
                  <thead>
                    <tr>
                      <th>Unit</th>
                      <th>Plan</th>
                      <th className="text-right">SF</th>
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
                        <td className="text-right">{row.sqFt?.toLocaleString() ?? "—"}</td>
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
        )}
      </main>
    </div>
  );
}

// Separate client component for chart to avoid SSR issues
function LeaseMaturityChart({ data, label }: { data: ParsedRentRoll | undefined; label: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);
  if (!mounted || !data) return null;

  // Group lease expirations by month
  const monthCounts: Record<string, number> = {};
  for (const unit of data.units.filter((u) => !u.isFuture && u.leaseExp)) {
    const excelEpoch = new Date(1899, 11, 30);
    const d = new Date(excelEpoch.getTime() + unit.leaseExp! * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    monthCounts[key] = (monthCounts[key] || 0) + 1;
  }

  const chartData = Object.entries(monthCounts)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(0, 18)
    .map(([month, count]) => ({ month: month.replace(/^(\d{4})-0?(\d+)$/, "$2/$1"), count }));

  if (chartData.length === 0) return null;

  const maxCount = Math.max(...chartData.map((d) => d.count));

  return (
    <div className="card">
      <p className="section-header">Lease Maturity Schedule ({label})</p>
      <div className="flex items-end gap-1 h-32 overflow-x-auto pb-2">
        {chartData.map((d) => (
          <div key={d.month} className="flex flex-col items-center flex-shrink-0 w-10">
            <span className="text-xs text-navy-700 font-semibold mb-1">{d.count}</span>
            <div
              className="w-8 bg-navy-700 rounded-t transition-all"
              style={{ height: `${(d.count / maxCount) * 88}px` }}
            />
            <span className="text-xs text-gray-400 mt-1 whitespace-nowrap" style={{ fontSize: "0.6rem" }}>
              {d.month}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
