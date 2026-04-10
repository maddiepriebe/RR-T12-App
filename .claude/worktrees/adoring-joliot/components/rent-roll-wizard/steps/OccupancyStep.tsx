"use client";

import { useState, useEffect } from "react";
import type { WizardState, OccupancyMapping, OccupancyStatus } from "../types";
import { OCCUPANCY_STATUSES } from "../types";
import type { ParsedRentRoll, ParsedUnit } from "@/lib/yardi-parser";
import type { RentRollData, RentRollUnit } from "@/lib/schemas";
import type { RentRollFormat } from "@/lib/rent-roll-service";

// ── Auto-map lookup ───────────────────────────────────────────────────────────

function autoMap(code: string): OccupancyStatus | null {
  const n = code.trim().toLowerCase();
  if (n === "occupied" || n === "occ") return "Occupied";
  if (n === "vacant" || n === "vac") return "Vacant";
  if (n === "vacant-rented" || n === "vac-r" || n === "vacrented") return "Vacant";
  if (n === "ntr" || n === "notice rented" || n === "notice-rented") return "Notice - Rented";
  if (n === "ntv" || n === "notice unrented" || n === "notice-unrented") return "Notice - Unrented";
  if (n === "model") return "Model";
  return null;
}

// ── Derivation ────────────────────────────────────────────────────────────────

type GroupAccum = { count: number; totalCharges: number };

function deriveOccupancyMappings(
  rawRentRoll: ParsedRentRoll | RentRollData | null,
  format: RentRollFormat | null
): OccupancyMapping[] {
  if (!rawRentRoll || !format) return [];

  const groups = new Map<string, GroupAccum>();

  function accumulate(key: string, charges: number) {
    const prev = groups.get(key) ?? { count: 0, totalCharges: 0 };
    groups.set(key, { count: prev.count + 1, totalCharges: prev.totalCharges + charges });
  }

  if (format === "yardi") {
    for (const unit of (rawRentRoll as ParsedRentRoll).units) {
      if ((unit as ParsedUnit).isFuture) continue;
      const u = unit as ParsedUnit;
      const chargeTotal = u.charges.reduce((sum, c) => sum + c.amount, 0);
      accumulate(u.occStatus, chargeTotal);
    }
  } else {
    for (const unit of (rawRentRoll as RentRollData).units) {
      const u = unit as RentRollUnit;
      const key = u.status ?? "Unknown";
      accumulate(key, u.actualRent ?? 0);
    }
  }

  return Array.from(groups.entries()).map(([occCode, { count, totalCharges }]) => ({
    occCode,
    unitCount: count,
    totalCharges,
    status: autoMap(occCode),
  }));
}

// ── Exported validator ────────────────────────────────────────────────────────

export function isOccupancyValid(state: WizardState): boolean {
  const mappings = state.occupancyMappings as OccupancyMapping[];
  if (mappings.length === 0) return false;
  return mappings.every((m) => m.status !== null);
}

// ── Formatter ─────────────────────────────────────────────────────────────────

function fmtCharges(v: number): string {
  if (v === 0) return "—";
  return "$" + Math.round(v).toLocaleString();
}

// ── Component ─────────────────────────────────────────────────────────────────

interface OccupancyStepProps {
  state: WizardState;
  onChange: (occupancyMappings: OccupancyMapping[]) => void;
  /** Set to true by the wizard root after the user's first failed Next attempt. */
  showErrors: boolean;
}

export default function OccupancyStep({ state, onChange, showErrors }: OccupancyStepProps) {
  const [rows, setRows] = useState<OccupancyMapping[]>(() =>
    (state.occupancyMappings as OccupancyMapping[]).length > 0
      ? [...(state.occupancyMappings as OccupancyMapping[])]
      : deriveOccupancyMappings(state.rawRentRoll, state.format)
  );

  // Sync derived rows into wizard state on first mount so isOccupancyValid
  // has data before the user interacts with the step.
  useEffect(() => {
    if ((state.occupancyMappings as OccupancyMapping[]).length === 0) {
      onChange(rows);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRow(idx: number, patch: Partial<OccupancyMapping>) {
    const updated = rows.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    setRows(updated);
    onChange(updated);
  }

  // Local validity — checked against `rows` to avoid a one-render lag.
  const allValid = rows.length > 0 && rows.every((r) => r.status !== null);

  // Count how many rows still need a status
  const unmappedCount = rows.filter((r) => r.status === null).length;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold text-navy-800">Occupancy</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Review the occupancy codes detected from your rent roll. Confirm or correct the
          status mapping for each code — every row is required to continue.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-navy-800 text-white">
              <th className="px-3 py-2 text-left font-semibold tracking-wide whitespace-nowrap">
                Occupancy Code
              </th>
              <th className="px-3 py-2 text-right font-semibold tracking-wide whitespace-nowrap">
                Total Units
              </th>
              <th className="px-3 py-2 text-right font-semibold tracking-wide whitespace-nowrap">
                Total Charges
              </th>
              <th className="px-3 py-2 text-left font-semibold tracking-wide whitespace-nowrap">
                Occupancy Status
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isInvalid = showErrors && row.status === null;
              const isEven = idx % 2 === 0;

              return (
                <tr
                  key={row.occCode}
                  className={`${isEven ? "bg-white" : "bg-gray-50"} border-b border-gray-100 last:border-0`}
                >
                  {/* Occupancy Code — read-only */}
                  <td className="px-3 py-1.5 font-mono font-medium text-navy-700 whitespace-nowrap">
                    {row.occCode}
                  </td>

                  {/* Total Units — read-only */}
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600">
                    {row.unitCount}
                  </td>

                  {/* Total Charges — read-only */}
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 whitespace-nowrap">
                    {fmtCharges(row.totalCharges)}
                  </td>

                  {/* Occupancy Status — dropdown */}
                  <td className="px-2 py-1">
                    <select
                      value={row.status ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateRow(idx, {
                          status: val === "" ? null : (val as OccupancyStatus),
                        });
                      }}
                      className={[
                        "w-full rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 bg-white",
                        isInvalid
                          ? "border border-red-200 border-l-[3px] border-l-red-500 bg-red-50 focus:ring-red-400"
                          : "border border-gray-200 focus:ring-navy-500",
                      ].join(" ")}
                    >
                      <option value="">— Select status —</option>
                      {OCCUPANCY_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {s}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Auto-map summary — shown when not all rows were recognized */}
      {!showErrors && unmappedCount > 0 && (
        <p className="text-xs text-amber-600 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          {unmappedCount === 1
            ? "1 code could not be auto-mapped — assign a status before continuing."
            : `${unmappedCount} codes could not be auto-mapped — assign a status for each before continuing.`}
        </p>
      )}

      {/* Validation error — only after a failed Next attempt */}
      {showErrors && !allValid && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Assign a status to every occupancy code before continuing.
        </p>
      )}
    </div>
  );
}
