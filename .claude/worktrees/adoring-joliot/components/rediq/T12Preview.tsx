"use client";

import type { T12Data } from "@/lib/schemas";

interface T12PreviewProps {
  data: T12Data;
}

function fmt(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

function fmtPct(v: number | null): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

export default function T12Preview({ data }: T12PreviewProps) {
  const sections = ["income", "expense", "noi"] as const;

  return (
    <div className="overflow-x-auto">
      <div className="mb-3">
        <p className="font-bold text-navy-800">
          {data.propertyName || "T12 Summary"}
        </p>
        {data.period && (
          <p className="text-xs text-gray-500">Period: {data.period}</p>
        )}
        {data.unitCount && (
          <p className="text-xs text-gray-500">{data.unitCount} units</p>
        )}
      </div>

      <table className="finance-table">
        <thead>
          <tr>
            <th className="w-2/5">Line Item</th>
            <th className="text-right">Actual ($)</th>
            <th className="text-right">Per Unit</th>
            <th className="text-right">% EGI</th>
          </tr>
        </thead>
        <tbody>
          {data.lineItems.map((item, idx) => {
            const rowClass = item.isTotal
              ? "row-total"
              : item.isSubtotal
              ? "row-subtotal"
              : item.category !== data.lineItems[idx - 1]?.category &&
                !item.isSubtotal &&
                !item.isTotal
              ? ""
              : "";

            // Section header row
            const prevCategory = idx > 0 ? data.lineItems[idx - 1].category : null;
            const showSectionHeader = item.category !== prevCategory;

            return (
              <>
                {showSectionHeader && (
                  <tr key={`header-${item.category}`} className="row-header">
                    <td colSpan={4}>
                      {item.category === "income"
                        ? "INCOME"
                        : item.category === "expense"
                        ? "EXPENSES"
                        : "NET OPERATING INCOME"}
                    </td>
                  </tr>
                )}
                <tr key={idx} className={rowClass}>
                  <td
                    style={{
                      paddingLeft: item.indent
                        ? `${(item.indent + 1) * 0.75}rem`
                        : undefined,
                    }}
                  >
                    {item.label}
                  </td>
                  <td className="text-right font-mono text-sm">
                    {fmt(item.actual)}
                  </td>
                  <td className="text-right font-mono text-sm text-gray-500">
                    {fmt(item.perUnit)}
                  </td>
                  <td className="text-right font-mono text-sm text-gray-500">
                    {fmtPct(item.pctEGI)}
                  </td>
                </tr>
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
