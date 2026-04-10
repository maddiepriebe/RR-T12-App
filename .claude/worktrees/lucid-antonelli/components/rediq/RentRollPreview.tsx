"use client";

import type { RentRollData } from "@/lib/schemas";

interface RentRollPreviewProps {
  data: RentRollData;
}

function fmt(v: number | null): string {
  if (v == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(v);
}

export default function RentRollPreview({ data }: RentRollPreviewProps) {
  const statusColor: Record<string, string> = {
    Occupied: "bg-green-100 text-green-800",
    Vacant: "bg-yellow-100 text-yellow-800",
    Notice: "bg-orange-100 text-orange-800",
  };

  const occupied = data.units.filter((u) => u.status === "Occupied").length;
  const vacant = data.units.filter((u) => u.status === "Vacant").length;
  const notice = data.units.filter((u) => u.status === "Notice").length;
  const totalUnits = data.units.length;

  return (
    <div>
      <div className="mb-4">
        <p className="font-bold text-navy-800">{data.propertyName || "Rent Roll"}</p>
        {data.date && <p className="text-xs text-gray-500">As of: {data.date}</p>}

        <div className="flex gap-4 mt-2">
          <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded-full font-medium">
            {occupied} Occupied
          </span>
          <span className="text-xs bg-yellow-100 text-yellow-800 px-2 py-0.5 rounded-full font-medium">
            {vacant} Vacant
          </span>
          {notice > 0 && (
            <span className="text-xs bg-orange-100 text-orange-800 px-2 py-0.5 rounded-full font-medium">
              {notice} Notice
            </span>
          )}
          <span className="text-xs text-gray-500">
            {totalUnits} total | {((occupied / totalUnits) * 100).toFixed(1)}% occupied
          </span>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="finance-table text-xs">
          <thead>
            <tr>
              <th>Unit</th>
              <th>Type</th>
              <th>Bed/Bath</th>
              <th>SF</th>
              <th>Tenant</th>
              <th>Lease End</th>
              <th className="text-right">Mkt Rent</th>
              <th className="text-right">Act Rent</th>
              <th className="text-right">LTL</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.units.map((unit, idx) => (
              <tr
                key={idx}
                className={
                  unit.status === "Vacant"
                    ? "bg-yellow-50"
                    : unit.status === "Notice"
                    ? "bg-orange-50"
                    : ""
                }
              >
                <td className="font-medium">{unit.unit || "—"}</td>
                <td>{unit.unitType || "—"}</td>
                <td>
                  {unit.bed != null ? unit.bed : "—"}
                  {unit.bath != null ? `/${unit.bath}` : ""}
                </td>
                <td>{unit.sqFt?.toLocaleString() || "—"}</td>
                <td className="max-w-[120px] truncate">{unit.tenantName || "—"}</td>
                <td>{unit.leaseEnd || "—"}</td>
                <td className="text-right font-mono">{fmt(unit.marketRent)}</td>
                <td className="text-right font-mono">{fmt(unit.actualRent)}</td>
                <td className="text-right font-mono text-red-600">
                  {unit.lossToLease != null && unit.lossToLease > 0
                    ? fmt(unit.lossToLease)
                    : "—"}
                </td>
                <td>
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${
                      statusColor[unit.status || ""] || "bg-gray-100 text-gray-600"
                    }`}
                  >
                    {unit.status || "—"}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
