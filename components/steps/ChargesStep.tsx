"use client";

import { useState, useEffect } from "react";
import type { WizardState, ChargeMapping, ChargeCategory } from "../types";
import { CHARGE_CATEGORIES } from "../types";
import type { ParsedRentRoll, ParsedUnit } from "@/lib/yardi-parser";
import type { RentRollData, RentRollUnit } from "@/lib/schemas";
import type { RentRollFormat } from "@/lib/rent-roll-service";

// ── Auto-map lookup ───────────────────────────────────────────────────────────

function autoMap(code: string): ChargeCategory | null {
  const n = code.trim().toLowerCase();
  if (n === "rent" || n === "base" || n === "baserent" || n === "base rent") {
    return "Contractual Rent";
  }
  if (n === "hap" || n === "har" || n === "housing authority") {
    return "HAR (Housing Authority Rent)";
  }
  if (n === "conc" || n === "concession" || n === "concessions") {
    return "Concession";
  }
  if (
    n === "park" || n === "parking" ||
    n === "stor" || n === "storage" ||
    n === "petrent" || n === "pet" || n === "pet2" ||
    n === "trash" || n === "valet" || n === "valettrash" ||
    n === "amenity" || n === "amen" ||
    n === "admin" || n === "adminfee" ||
    n === "mtm" || n === "month to month"
  ) {
    return "Other Income";
  }
  if (n === "empmgmt" || n === "employee" || n === "emp") {
    return "Ignore / Exclude";
  }
  return null;
}

// ── Derivation ────────────────────────────────────────────────────────────────

function deriveChargeMappings(
  rawRentRoll: ParsedRentRoll | RentRollData | null,
  format: RentRollFormat | null
): ChargeMapping[] {
  if (!rawRentRoll || !format) return [];

  if (format === "yardi") {
    const parsed = rawRentRoll as ParsedRentRoll;

    // Group individual charge entries by code; skip future units.
    const totals = new Map<string, number>();
    for (const unit of parsed.units) {
      if ((unit as ParsedUnit).isFuture) continue;
      const charges = (unit as ParsedUnit).charges;
      // Guard: some parsers (e.g. AOG) return units with empty charge arrays.
      if (!Array.isArray(charges)) continue;
      for (const charge of charges) {
        // charge.code must be a string; coerce defensively in case the
        // underlying data has a numeric value due to a parser column-offset bug.
        const code = String(charge.code);
        const amount = Number(charge.amount) || 0;
        totals.set(code, (totals.get(code) ?? 0) + amount);
      }
    }
    return Array.from(totals.entries()).map(([chargeCode, totalAmount]) => ({
      chargeCode,
      totalAmount,
      category: autoMap(chargeCode),
    }));
  } else {
    // Generic format has no charge-code breakdown — synthesise a single "rent" row.
    const totalAmount = (rawRentRoll as RentRollData).units.reduce(
      (sum, u) => sum + ((u as RentRollUnit).actualRent ?? 0),
      0
    );
    return [{ chargeCode: "rent", totalAmount, category: autoMap("rent") }];
  }
}

// ── Exported validator ────────────────────────────────────────────────────────

export function isChargesValid(state: WizardState): boolean {
  const mappings = state.chargeMappings as ChargeMapping[];
  if (mappings.length === 0) return false;
  const allCategorized = mappings.every((m) => m.category !== null);
  const hasRentCategory = mappings.some(
    (m) =>
      m.category === "Contractual Rent" ||
      m.category === "HAR (Housing Authority Rent)"
  );
  return allCategorized && hasRentCategory;
}

// ── Formatter ─────────────────────────────────────────────────────────────────

function fmtAmount(v: number): { text: string; negative: boolean } {
  if (v === 0) return { text: "$0", negative: false };
  const abs = "$" + Math.round(Math.abs(v)).toLocaleString();
  return v < 0
    ? { text: `(${abs})`, negative: true }
    : { text: abs, negative: false };
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ChargesStepProps {
  state: WizardState;
  onChange: (chargeMappings: ChargeMapping[]) => void;
  /** Set to true by the wizard root after the user's first failed Next attempt. */
  showErrors: boolean;
}

export default function ChargesStep({ state, onChange, showErrors }: ChargesStepProps) {
  const [rows, setRows] = useState<ChargeMapping[]>(() =>
    (state.chargeMappings as ChargeMapping[]).length > 0
      ? [...(state.chargeMappings as ChargeMapping[])]
      : deriveChargeMappings(state.rawRentRoll, state.format)
  );

  // Sync derived rows into wizard state on first mount so isChargesValid
  // has data before the user interacts with the step.
  useEffect(() => {
    if ((state.chargeMappings as ChargeMapping[]).length === 0) {
      onChange(rows);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateRow(idx: number, patch: Partial<ChargeMapping>) {
    const updated = rows.map((row, i) => (i === idx ? { ...row, ...patch } : row));
    setRows(updated);
    onChange(updated);
  }

  // Local validity — checked against `rows` to avoid a one-render lag.
  const allCategorized = rows.length > 0 && rows.every((r) => r.category !== null);
  const hasRentCategory = rows.some(
    (r) =>
      r.category === "Contractual Rent" ||
      r.category === "HAR (Housing Authority Rent)"
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-semibold text-navy-800">Charges</p>
        <p className="text-xs text-gray-500 mt-0.5">
          Review the charge codes detected from your rent roll. Confirm the category for
          each code — at least one must be Contractual Rent or HAR to continue.
        </p>
      </div>

      {/* Rule-2 banner — shown above the table after a failed Next attempt */}
      {showErrors && !hasRentCategory && (
        <div className="flex items-start gap-2 px-3 py-2.5 bg-red-50 border border-red-200 rounded-lg">
          <svg
            className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5"
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
          <p className="text-xs text-red-700 font-medium">
            At least one charge code must be designated as Contractual Rent or HAR before
            continuing.
          </p>
        </div>
      )}

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-navy-800 text-white">
              <th className="px-3 py-2 text-left font-semibold tracking-wide whitespace-nowrap">
                Charge Code
              </th>
              <th className="px-3 py-2 text-right font-semibold tracking-wide whitespace-nowrap">
                Total Amount
              </th>
              <th className="px-3 py-2 text-left font-semibold tracking-wide whitespace-nowrap">
                Charge Category
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, idx) => {
              const isInvalid = showErrors && row.category === null;
              const isEven = idx % 2 === 0;
              const { text: amtText, negative } = fmtAmount(row.totalAmount);

              return (
                <tr
                  key={row.chargeCode}
                  className={`${isEven ? "bg-white" : "bg-gray-50"} border-b border-gray-100 last:border-0`}
                >
                  {/* Charge Code — read-only */}
                  <td className="px-3 py-1.5 font-mono font-medium text-navy-700 whitespace-nowrap">
                    {row.chargeCode}
                  </td>

                  {/* Total Amount — read-only; negative values shown in red with parens */}
                  <td className="px-3 py-1.5 text-right tabular-nums whitespace-nowrap">
                    <span className={negative ? "text-red-600" : "text-gray-600"}>
                      {amtText}
                    </span>
                  </td>

                  {/* Charge Category — dropdown */}
                  <td className="px-2 py-1">
                    <select
                      value={row.category ?? ""}
                      onChange={(e) => {
                        const val = e.target.value;
                        updateRow(idx, {
                          category: val === "" ? null : (val as ChargeCategory),
                        });
                      }}
                      className={[
                        "w-full rounded px-1.5 py-1 text-xs focus:outline-none focus:ring-1 bg-white",
                        isInvalid
                          ? "border border-red-200 border-l-[3px] border-l-red-500 bg-red-50 focus:ring-red-400"
                          : "border border-gray-200 focus:ring-navy-500",
                      ].join(" ")}
                    >
                      <option value="">— Select category —</option>
                      {CHARGE_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
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

      {/* Row-level validation message — only after a failed Next attempt */}
      {showErrors && !allCategorized && (
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
          Assign a category to every charge code before continuing.
        </p>
      )}
    </div>
  );
}
