"use client";

import { useState } from "react";
import type { ParsedRentRoll } from "@/lib/yardi-parser";

interface Props {
  data: ParsedRentRoll;
}

function fmt(v: number | null) {
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

// Convert Excel serial to MM/DD/YYYY
function fmtDate(serial: number | null): string {
  if (serial == null) return "—";
  const excelEpoch = new Date(1899, 11, 30);
  const d = new Date(excelEpoch.getTime() + serial * 86400000);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

type View = "summary" | "units" | "floorplan";

export default function YardiRentRollPreview({ data }: Props) {
  const [view, setView] = useState<View>("summary");

  const nonFuture = data.units.filter((u) => !u.isFuture);
  const occupied = nonFuture.filter((u) => u.occStatus === "Occupied").length;
  const vacant = nonFuture.filter((u) => u.occStatus === "Vacant").length;
  const notice = nonFuture.filter((u) => u.occStatus === "Notice").length;
  const total = nonFuture.length;
  const occPct = total > 0 ? ((occupied + notice) / total) * 100 : 0;

  // Aggregate by floor plan
  const planMap = new Map<string, typeof nonFuture>();
  for (const unit of nonFuture) {
    if (!planMap.has(unit.planId)) planMap.set(unit.planId, []);
    planMap.get(unit.planId)!.push(unit);
  }

  const planSummaries = Array.from(planMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([planId, units]) => {
      const occ = units.filter((u) => u.occStatus !== "Vacant").length;
      const vac = units.filter((u) => u.occStatus === "Vacant").length;
      const avgMkt = units.filter((u) => u.mktRent).reduce((a, u) => a + u.mktRent!, 0) / units.filter((u) => u.mktRent).length;
      const occUnits = units.filter((u) => u.inPlaceRent);
      const avgInPlace = occUnits.length
        ? occUnits.reduce((a, u) => a + u.inPlaceRent!, 0) / occUnits.length
        : null;
      return { planId, total: units.length, occ, vac, avgMkt, avgInPlace, sf: units[0]?.sqFt };
    });

  const statusColor: Record<string, string> = {
    Occupied: "bg-green-100 text-green-800",
    Vacant: "bg-yellow-100 text-yellow-800",
    Notice: "bg-orange-100 text-orange-800",
  };

  const tabs: Array<{ id: View; label: string }> = [
    { id: "summary", label: "Summary" },
    { id: "units", label: `All Units (${total})` },
    { id: "floorplan", label: "Floor Plans" },
  ];

  return (
    <div>
      {/* Stats bar */}
      <div className="flex flex-wrap gap-4 mb-4">
        <div className="text-center">
          <p className="text-2xl font-bold text-navy-800">{total}</p>
          <p className="text-xs text-gray-500">Total Units</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-green-600">{occupied}</p>
          <p className="text-xs text-gray-500">Occupied</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-orange-500">{notice}</p>
          <p className="text-xs text-gray-500">Notice</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-yellow-600">{vacant}</p>
          <p className="text-xs text-gray-500">Vacant</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold text-navy-700">{occPct.toFixed(1)}%</p>
          <p className="text-xs text-gray-500">Occupancy</p>
        </div>
        {data.reportDate && (
          <div className="text-center">
            <p className="text-sm font-semibold text-gray-600">{fmtDate(data.reportDate)}</p>
            <p className="text-xs text-gray-500">Report Date</p>
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 mb-4">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setView(tab.id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              view === tab.id
                ? "border-navy-700 text-navy-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Summary view */}
      {view === "summary" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              {
                label: "Avg Market Rent",
                value: fmt(
                  nonFuture.filter((u) => u.mktRent).reduce((a, u) => a + u.mktRent!, 0) /
                    nonFuture.filter((u) => u.mktRent).length || null
                ),
              },
              {
                label: "Avg In-Place Rent",
                value: fmt(
                  (() => {
                    const occ = nonFuture.filter((u) => u.inPlaceRent);
                    return occ.length ? occ.reduce((a, u) => a + u.inPlaceRent!, 0) / occ.length : null;
                  })()
                ),
              },
              {
                label: "Total Potential Rent",
                value: fmt(nonFuture.reduce((a, u) => a + (u.mktRent ?? 0), 0)),
              },
              {
                label: "Total In-Place Rent",
                value: fmt(nonFuture.reduce((a, u) => a + (u.inPlaceRent ?? 0), 0)),
              },
            ].map((stat) => (
              <div key={stat.label} className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-lg font-bold text-navy-800">{stat.value}</p>
                <p className="text-xs text-gray-500 mt-0.5">{stat.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-navy-50 rounded-lg p-3">
            <p className="text-xs font-semibold text-navy-700 mb-2">Charge Code Totals</p>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-xs">
              {[
                { code: "rent", label: "Rent" },
                { code: "park", label: "Parking" },
                { code: "petrent", label: "Pet Rent" },
                { code: "stor", label: "Storage" },
                { code: "mtm", label: "MTM" },
                { code: "conc", label: "Concessions" },
              ].map(({ code, label }) => {
                const total = nonFuture.reduce((acc, u) => {
                  return acc + u.charges.filter((c) => c.code === code).reduce((a, c) => a + c.amount, 0);
                }, 0);
                return total !== 0 ? (
                  <div key={code} className="text-center">
                    <p className={`font-bold ${total < 0 ? "text-red-600" : "text-navy-800"}`}>
                      {fmt(total)}
                    </p>
                    <p className="text-gray-500">{label}</p>
                  </div>
                ) : null;
              })}
            </div>
          </div>
        </div>
      )}

      {/* All units view */}
      {view === "units" && (
        <div className="overflow-x-auto">
          <table className="finance-table text-xs">
            <thead>
              <tr>
                <th>Unit</th>
                <th>Plan</th>
                <th className="text-right">SF</th>
                <th>Status</th>
                <th className="text-right">Mkt Rent</th>
                <th className="text-right">In-Place</th>
                <th className="text-right">Other Inc</th>
                <th className="text-right">Net Eff</th>
                <th>Lease Exp</th>
                <th>Move In</th>
              </tr>
            </thead>
            <tbody>
              {nonFuture.map((unit, idx) => (
                <tr
                  key={idx}
                  className={
                    unit.occStatus === "Vacant"
                      ? "bg-yellow-50"
                      : unit.occStatus === "Notice"
                      ? "bg-orange-50"
                      : ""
                  }
                >
                  <td className="font-medium">{unit.unitId}</td>
                  <td className="text-gray-500">{unit.planId}</td>
                  <td className="text-right">{unit.sqFt?.toLocaleString() ?? "—"}</td>
                  <td>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${statusColor[unit.occStatus] ?? "bg-gray-100 text-gray-600"}`}>
                      {unit.occStatus}
                    </span>
                    {unit.hasMTM && (
                      <span className="ml-1 text-xs bg-purple-100 text-purple-700 px-1 py-0.5 rounded font-medium">MTM</span>
                    )}
                  </td>
                  <td className="text-right font-mono">{fmt(unit.mktRent)}</td>
                  <td className="text-right font-mono">{fmt(unit.inPlaceRent)}</td>
                  <td className="text-right font-mono text-gray-500">{fmt(unit.otherInc)}</td>
                  <td className="text-right font-mono">{fmt(unit.netEffRent)}</td>
                  <td className="font-mono text-gray-500">{fmtDate(unit.leaseExp)}</td>
                  <td className="font-mono text-gray-500">{fmtDate(unit.moveIn)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Floor plan view */}
      {view === "floorplan" && (
        <div className="overflow-x-auto">
          <table className="finance-table text-xs">
            <thead>
              <tr>
                <th>Floor Plan</th>
                <th className="text-right">SF</th>
                <th className="text-center">Total</th>
                <th className="text-center">Occ</th>
                <th className="text-center">Vac</th>
                <th className="text-right">Avg Mkt Rent</th>
                <th className="text-right">Avg In-Place</th>
              </tr>
            </thead>
            <tbody>
              {planSummaries.map((p, idx) => (
                <tr key={idx}>
                  <td className="font-medium">{p.planId}</td>
                  <td className="text-right">{p.sf?.toLocaleString() ?? "—"}</td>
                  <td className="text-center">{p.total}</td>
                  <td className="text-center text-green-700">{p.occ}</td>
                  <td className="text-center text-yellow-700">{p.vac}</td>
                  <td className="text-right font-mono">{fmt(p.avgMkt)}</td>
                  <td className="text-right font-mono">{fmt(p.avgInPlace)}</td>
                </tr>
              ))}
              <tr className="row-subtotal">
                <td className="font-bold">Total</td>
                <td></td>
                <td className="text-center font-bold">{total}</td>
                <td className="text-center font-bold text-green-700">{occupied + notice}</td>
                <td className="text-center font-bold text-yellow-700">{vacant}</td>
                <td className="text-right font-mono font-bold">
                  {fmt(
                    nonFuture.filter((u) => u.mktRent).reduce((a, u) => a + u.mktRent!, 0) /
                      nonFuture.filter((u) => u.mktRent).length
                  )}
                </td>
                <td className="text-right font-mono font-bold">
                  {fmt(
                    (() => {
                      const occ = nonFuture.filter((u) => u.inPlaceRent);
                      return occ.length ? occ.reduce((a, u) => a + u.inPlaceRent!, 0) / occ.length : null;
                    })()
                  )}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
