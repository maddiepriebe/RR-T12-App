"use client";

import { useState, useEffect, useRef } from "react";
import type { WizardState, FloorPlan } from "../types";
import type { ParsedRentRoll, ParsedUnit } from "@/lib/yardi-parser";
import type { RentRollData, RentRollUnit } from "@/lib/schemas";
import type { RentRollFormat } from "@/lib/rent-roll-service";

// ── Helpers ───────────────────────────────────────────────────────────────────

function avgRounded(values: number[]): number | null {
  if (values.length === 0) return null;
  return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
}

function deriveFloorPlans(
  rawRentRoll: ParsedRentRoll | RentRollData | null,
  format: RentRollFormat | null
): FloorPlan[] {
  if (!rawRentRoll || !format) return [];

  if (format === "yardi") {
    const parsed = rawRentRoll as ParsedRentRoll;
    // Group non-future units by planId; preserve insertion order
    const groups = new Map<string, ParsedUnit[]>();
    for (const unit of parsed.units) {
      if (unit.isFuture) continue;
      const key = unit.planId || "—";
      const arr = groups.get(key) ?? [];
      arr.push(unit);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([planCode, units]) => ({
      planCode,
      unitType: "Residential" as const,
      unitCount: units.length,
      netSF: avgRounded(units.map((u) => u.sqFt).filter((v): v is number => v !== null)),
      marketRent: avgRounded(units.map((u) => u.mktRent).filter((v): v is number => v !== null)),
      floorPlanName: planCode,
      bedrooms: null,
      baths: null,
    }));
  } else {
    const data = rawRentRoll as RentRollData;
    const groups = new Map<string, RentRollUnit[]>();
    for (const unit of data.units) {
      const key = unit.unitType ?? "Unknown";
      const arr = groups.get(key) ?? [];
      arr.push(unit);
      groups.set(key, arr);
    }
    return Array.from(groups.entries()).map(([planCode, units]) => ({
      planCode,
      unitType: "Residential" as const,
      unitCount: units.length,
      netSF: avgRounded(units.map((u) => u.sqFt).filter((v): v is number => v !== null)),
      marketRent: avgRounded(
        units.map((u) => u.marketRent).filter((v): v is number => v !== null)
      ),
      floorPlanName: planCode,
      bedrooms: null,
      baths: null,
    }));
  }
}

// ── Exported validator (wired into RentRollWizard.isPhaseValid) ───────────────

export function isFloorplansValid(state: WizardState): boolean {
  const plans = state.floorPlans as FloorPlan[];
  if (plans.length === 0) return false;
  return plans.every((fp) => fp.bedrooms !== null);
}

// ── Component ─────────────────────────────────────────────────────────────────

interface FloorplansStepProps {
  state: WizardState;
  onChange: (floorPlans: FloorPlan[]) => void;
  /** Set to true by the wizard root after the user's first failed Next attempt. */
  showErrors: boolean;
}

export default function FloorplansStep({ state, onChange, showErrors }: FloorplansStepProps) {
  const [rows, setRows] = useState<FloorPlan[]>(() =>
    (state.floorPlans as FloorPlan[]).length > 0
      ? [...(state.floorPlans as FloorPlan[])]
      : deriveFloorPlans(state.rawRentRoll, state.format)
  );

  // inputRefs["2-bedrooms"] → the <input> in row 2, bedrooms column
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Push the initial derived rows into wizard state so isFloorplansValid has data.
  // Only runs once on mount; skipped if wizard state is already populated
  // (i.e. user navigated back to this step after filling it in).
  useEffect(() => {
    if ((state.floorPlans as FloorPlan[]).length === 0) {
      onChange(rows);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Mutations ────────────────────────────────────────────────────────────────

  function updateRow(idx: number, patch: Partial<FloorPlan>) {
    const updated = rows.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    setRows(updated);
    onChange(updated);
  }

  // ── Keyboard shortcuts ───────────────────────────────────────────────────────

  function handleNumberKeyDown(
    e: React.KeyboardEvent<HTMLInputElement>,
    idx: number,
    field: "bedrooms" | "baths"
  ) {
    if (!e.shiftKey) return;
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();

    const targetIdx = e.key === "ArrowDown" ? idx + 1 : idx - 1;
    if (targetIdx < 0 || targetIdx >= rows.length) return;

    updateRow(targetIdx, { [field]: rows[idx][field] });

    // Focus the target cell after the state update renders
    setTimeout(() => {
      inputRefs.current[`${targetIdx}-${field}`]?.focus();
    }, 0);
  }

  // ── Formatters ───────────────────────────────────────────────────────────────

  const fmtSF = (v: number | null) => (v == null ? "—" : v.toLocaleString());
  const fmtRent = (v: number | null) => (v == null ? "—" : `$${v.toLocaleString()}`);

  // Local validity is checked against `rows` (always current) rather than
  // `state.floorPlans` to avoid a one-render lag between local and wizard state.
  const allValid =
    rows.length > 0 && rows.every((r) => r.bedrooms !== null);

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold text-navy-800">Floor Plans</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Review the floor plan types detected from your rent roll.
          Enter bedrooms for each plan — required to continue. Baths is optional.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-navy-800 text-white">
              <th className="px-3 py-2 text-left font-semibold tracking-wide whitespace-nowrap">
                Plan Code
              </th>
              <th className="px-2 py-2 text-left font-semibold tracking-wide whitespace-nowrap">
                Unit Type
              </th>
              <th className="px-2 py-2 text-right font-semibold tracking-wide">#</th>
              <th className="px-3 py-2 text-right font-semibold tracking-wide whitespace-nowrap">
                Net SF
              </th>
              <th className="px-3 py-2 text-right font-semibold tracking-wide whitespace-nowrap">
                Mkt Rent
              </th>
              <th className="px-3 py-2 text-left font-semibold tracking-wide whitespace-nowrap">
                Floor Plan Name
              </th>
              <th className="px-2 py-2 text-center font-semibold tracking-wide w-16">Beds</th>
              <th className="px-2 py-2 text-center font-semibold tracking-wide w-16">Baths</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const bedsInvalid = showErrors && row.bedrooms === null;
              const bathsInvalid = false;
              const isEven = idx % 2 === 0;

              return (
                <tr
                  key={row.planCode}
                  className={`${isEven ? "bg-white" : "bg-gray-50"} border-b border-gray-100 last:border-0`}
                >
                  {/* Plan Code — read-only */}
                  <td className="px-3 py-1.5 font-mono font-medium text-navy-700 whitespace-nowrap">
                    {row.planCode}
                  </td>

                  {/* Unit Type — dropdown */}
                  <td className="px-2 py-1">
                    <select
                      value={row.unitType}
                      onChange={(e) =>
                        updateRow(idx, {
                          unitType: e.target.value as FloorPlan["unitType"],
                        })
                      }
                      className="w-full border border-gray-200 rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-navy-500 bg-white"
                    >
                      <option value="Residential">Residential</option>
                      <option value="Commercial">Commercial</option>
                      <option value="Other">Other</option>
                    </select>
                  </td>

                  {/* # Units — read-only */}
                  <td className="px-2 py-1.5 text-right tabular-nums text-gray-600">
                    {row.unitCount}
                  </td>

                  {/* Net SF — read-only */}
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 whitespace-nowrap">
                    {fmtSF(row.netSF)}
                  </td>

                  {/* Market Rent — read-only */}
                  <td className="px-3 py-1.5 text-right tabular-nums text-gray-600 whitespace-nowrap">
                    {fmtRent(row.marketRent)}
                  </td>

                  {/* Floor Plan Name — editable text */}
                  <td className="px-2 py-1">
                    <input
                      type="text"
                      value={row.floorPlanName}
                      onChange={(e) => updateRow(idx, { floorPlanName: e.target.value })}
                      className="w-full border border-gray-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-navy-500"
                    />
                  </td>

                  {/* Bedrooms — required numeric */}
                  <td className="px-2 py-1">
                    <input
                      ref={(el) => {
                        inputRefs.current[`${idx}-bedrooms`] = el;
                      }}
                      type="number"
                      min="0"
                      step="1"
                      value={row.bedrooms ?? ""}
                      placeholder="—"
                      onChange={(e) => {
                        if (e.target.value === "") {
                          updateRow(idx, { bedrooms: null });
                        } else {
                          const v = parseInt(e.target.value, 10);
                          updateRow(idx, { bedrooms: isNaN(v) ? null : v });
                        }
                      }}
                      onKeyDown={(e) => handleNumberKeyDown(e, idx, "bedrooms")}
                      className={[
                        "w-full rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-1",
                        "appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                        bedsInvalid
                          ? "border border-red-200 border-l-[3px] border-l-red-500 bg-red-50 focus:ring-red-400"
                          : "border border-gray-200 focus:ring-navy-500",
                      ].join(" ")}
                    />
                  </td>

                  {/* Baths — required numeric, allows 0.5 steps */}
                  <td className="px-2 py-1">
                    <input
                      ref={(el) => {
                        inputRefs.current[`${idx}-baths`] = el;
                      }}
                      type="number"
                      min="0"
                      step="0.5"
                      value={row.baths ?? ""}
                      placeholder="—"
                      onChange={(e) => {
                        if (e.target.value === "") {
                          updateRow(idx, { baths: null });
                        } else {
                          const v = parseFloat(e.target.value);
                          updateRow(idx, { baths: isNaN(v) ? null : v });
                        }
                      }}
                      onKeyDown={(e) => handleNumberKeyDown(e, idx, "baths")}
                      className={[
                        "w-full rounded px-2 py-1 text-xs text-center focus:outline-none focus:ring-1",
                        "appearance-none [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
                        bathsInvalid
                          ? "border border-red-200 border-l-[3px] border-l-red-500 bg-red-50 focus:ring-red-400"
                          : "border border-gray-200 focus:ring-navy-500",
                      ].join(" ")}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Validation message — only shown after user has attempted to advance */}
      {showErrors && !allValid && (
        <p className="text-xs text-red-600 flex items-center gap-1.5">
          <svg
            className="w-3.5 h-3.5 flex-shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          Enter bedrooms for every floor plan before continuing.
        </p>
      )}

      {/* Keyboard shortcut hint */}
      {rows.length > 1 && (
        <p className="text-xs text-gray-400">
          Tip: while focused in Beds or Baths,{" "}
          <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-200 rounded font-mono text-gray-500">
            Shift ↓
          </kbd>{" "}
          /{" "}
          <kbd className="px-1 py-0.5 bg-gray-100 border border-gray-200 rounded font-mono text-gray-500">
            Shift ↑
          </kbd>{" "}
          copies the value to the row below / above.
        </p>
      )}
    </div>
  );
}
