"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import NavBar from "@/components/shared/NavBar";
import Link from "next/link";

interface Property {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  units: number | null;
}

interface Report {
  id: string;
  type: string;
  label: string | null;
  excelUrl: string | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

const TYPE_LABELS: Record<string, string> = {
  t12: "T12",
  rentroll: "Rent Roll",
  rentcomps: "Rent Comps",
  tradeout: "Trade-Out",
};

const TYPE_COLORS: Record<string, string> = {
  t12: "bg-blue-100 text-blue-700",
  rentroll: "bg-green-100 text-green-700",
  rentcomps: "bg-orange-100 text-orange-700",
  tradeout: "bg-purple-100 text-purple-700",
};

export default function PropertyPage() {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      fetch(`/api/properties/${id}`).then((r) => r.json()),
      fetch(`/api/properties/${id}/reports`).then((r) => r.json()),
    ]).then(([prop, reps]) => {
      setProperty(prop);
      setReports(Array.isArray(reps) ? reps : []);
      setLoading(false);
    });
  }, [id]);

  // Group reports by type
  const grouped = reports.reduce<Record<string, Report[]>>((acc, r) => {
    if (!acc[r.type]) acc[r.type] = [];
    acc[r.type].push(r);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center py-32 text-gray-400">Loading...</div>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavBar />
        <div className="flex items-center justify-center py-32 text-gray-400">Property not found.</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Breadcrumb */}
        <div className="flex items-center gap-2 text-sm text-gray-400 mb-6">
          <Link href="/properties" className="hover:text-navy-700 transition-colors">Properties</Link>
          <span>/</span>
          <span className="text-navy-800 font-medium">{property.name}</span>
        </div>

        {/* Property Header */}
        <div className="card mb-6">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-navy-900">{property.name}</h1>
              <p className="text-gray-500 text-sm mt-1">
                {[property.address, property.city, property.state, property.zip].filter(Boolean).join(", ")}
              </p>
              {property.units && (
                <p className="text-xs text-gray-400 mt-1">{property.units.toLocaleString()} units</p>
              )}
            </div>
            <div className="flex gap-2">
              <Link href={`/rent-roll?propertyId=${id}`} className="btn-outline text-sm py-1.5 px-4">
                + Rent Roll
              </Link>
              <Link href={`/t12?propertyId=${id}`} className="btn-outline text-sm py-1.5 px-4">
                + T12
              </Link>
              <Link href={`/rent-comps?propertyId=${id}`} className="btn-outline text-sm py-1.5 px-4">
                + Rent Comps
              </Link>
              <Link href={`/trade-out?propertyId=${id}`} className="btn-outline text-sm py-1.5 px-4">
                + Trade-Out
              </Link>
            </div>
          </div>
        </div>

        {/* Reports */}
        {reports.length === 0 ? (
          <div className="card text-center py-12">
            <p className="text-gray-400 text-sm">No reports yet for this property.</p>
            <p className="text-gray-400 text-xs mt-1">Upload a Rent Roll, T12, Rent Comps, or run a Trade-Out analysis.</p>
          </div>
        ) : (
          <div className="space-y-6">
            {["rentroll", "t12", "rentcomps", "tradeout"].filter((t) => grouped[t]).map((type) => (
              <div key={type} className="card">
                <p className="section-header">{TYPE_LABELS[type]} Reports</p>
                <table className="finance-table text-xs">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Date</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[type].map((r) => (
                      <tr key={r.id}>
                        <td>
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium mr-2 ${TYPE_COLORS[r.type] ?? "bg-gray-100 text-gray-600"}`}>
                            {TYPE_LABELS[r.type] ?? r.type}
                          </span>
                          {r.label || "Report"}
                        </td>
                        <td className="text-gray-400">
                          {new Date(r.createdAt).toLocaleDateString()}
                        </td>
                        <td className="text-right">
                          {r.excelUrl && (
                            <a
                              href={r.excelUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-xs font-semibold text-navy-700 hover:text-gold-500 transition-colors"
                            >
                              Download ↓
                            </a>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
