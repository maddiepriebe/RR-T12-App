"use client";

import { useState } from "react";
import type { RentCompsData, CompDetail } from "@/lib/schemas";

interface UnitMixDetailProps {
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

function bedLabel(bed: number) {
  return bed === 0 ? "Studio" : `${bed}BR`;
}

function PropertyCard({ detail }: { detail: CompDetail }) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className={`border rounded-lg overflow-hidden ${detail.isSubject ? "border-blue-300" : "border-gray-200"}`}>
      <button
        onClick={() => setExpanded((e) => !e)}
        className={`w-full flex items-center justify-between px-4 py-3 text-left ${
          detail.isSubject ? "bg-blue-700" : "bg-navy-700"
        } text-white`}
      >
        <div>
          <span className="font-semibold text-sm">
            {detail.isSubject && (
              <span className="bg-gold-500 text-navy-950 text-xs font-bold px-1.5 py-0.5 rounded mr-2">
                SUBJECT
              </span>
            )}
            {detail.propertyName}
          </span>
          {detail.address && (
            <span className="text-xs text-blue-200 ml-2">{detail.address}</span>
          )}
          {detail.yearBuilt && (
            <span className="text-xs text-blue-300 ml-2">
              Built {detail.yearBuilt}
              {detail.renovYear ? ` (Renov. ${detail.renovYear})` : ""}
            </span>
          )}
        </div>
        <svg
          className={`w-4 h-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {expanded && (
        <div className="overflow-x-auto">
          <table className="finance-table text-xs">
            <thead>
              <tr>
                <th>Type</th>
                <th className="text-center">Bath</th>
                <th className="text-center">Avg SF</th>
                <th className="text-center">Units</th>
                <th className="text-center">Mix %</th>
                <th className="text-center">Avail</th>
                <th className="text-center">Avail %</th>
                <th className="text-right">Asking/Unit</th>
                <th className="text-right">Asking/SF</th>
                <th className="text-right">Eff/Unit</th>
                <th className="text-right">Eff/SF</th>
                <th className="text-right">Concessions</th>
              </tr>
            </thead>
            <tbody>
              {detail.unitTypes.map((ut, idx) => {
                const isSummary =
                  ut.label?.startsWith("All") || ut.label === "Totals";
                return (
                  <tr
                    key={idx}
                    className={
                      isSummary
                        ? "row-subtotal"
                        : idx % 2 === 0
                        ? ""
                        : "bg-gray-50"
                    }
                  >
                    <td className={isSummary ? "font-bold" : ""}>
                      {ut.label || bedLabel(ut.bed)}
                    </td>
                    <td className="text-center">{ut.bath ?? "—"}</td>
                    <td className="text-center">{ut.avgSF || "—"}</td>
                    <td className="text-center">{ut.units ?? "—"}</td>
                    <td className="text-center">{fmtPct(ut.mixPct)}</td>
                    <td className="text-center">{ut.availableUnits ?? "—"}</td>
                    <td className="text-center">{fmtPct(ut.availabilityPct)}</td>
                    <td className="text-right font-mono">{fmtDollar(ut.askingRentPerUnit)}</td>
                    <td className="text-right font-mono">{fmtSF(ut.askingRentPerSF)}</td>
                    <td className="text-right font-mono">{fmtDollar(ut.effectiveRentPerUnit)}</td>
                    <td className="text-right font-mono">{fmtSF(ut.effectiveRentPerSF)}</td>
                    <td className="text-right font-mono">{fmtPct(ut.concessionsPct)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {(detail.parking || detail.petPolicy) && (
            <div className="px-4 py-2 bg-gray-50 border-t border-gray-100 flex gap-6 text-xs text-gray-500">
              {detail.parking && <span><strong>Parking:</strong> {detail.parking}</span>}
              {detail.petPolicy && <span><strong>Pets:</strong> {detail.petPolicy}</span>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function UnitMixDetail({ data }: UnitMixDetailProps) {
  const allDetails: CompDetail[] = [];
  if (data.subjectProperty) allDetails.push({ ...data.subjectProperty, isSubject: true });
  allDetails.push(...data.compDetails);

  return (
    <div className="space-y-4">
      {allDetails.map((detail, idx) => (
        <PropertyCard key={idx} detail={detail} />
      ))}
    </div>
  );
}
