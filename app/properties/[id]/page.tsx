"use client";

import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import NavBar from "@/components/shared/NavBar";
import ReportPreview from "@/components/properties/ReportPreview";
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

interface ReportWithData extends Report {
  processedData: Record<string, unknown> | null;
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

// Maps a report's stored processedData to a download API call
async function downloadReport(report: ReportWithData) {
  if (!report.processedData) {
    alert("No processed data available to download.");
    return;
  }

  let endpoint = "";
  let body: Record<string, unknown> = {};

  if (report.type === "rentroll") {
    const pd = report.processedData as { format: string; data: unknown };
    endpoint = "/api/rediq/download";
    body = { rentRoll: pd.data, rentRollFormat: pd.format };
  } else if (report.type === "t12") {
    const pd = report.processedData as { data: unknown };
    endpoint = "/api/rediq/download";
    body = { t12: pd.data };
  } else if (report.type === "rentcomps") {
    const pd = report.processedData as { data: unknown };
    endpoint = "/api/rentcomps/download";
    body = pd.data as Record<string, unknown>;
  } else {
    alert("Download not yet supported for this report type.");
    return;
  }

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const j = await res.json();
    alert(j.error || "Download failed");
    return;
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download =
    res.headers.get("Content-Disposition")?.split('filename="')[1]?.replace('"', "") ||
    `${report.type}-report.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PropertyPage() {
  const { id } = useParams<{ id: string }>();
  const [property, setProperty] = useState<Property | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [loading, setLoading] = useState(true);

  // Inline preview state
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [previewCache, setPreviewCache] = useState<Record<string, ReportWithData>>({});
  const [previewLoading, setPreviewLoading] = useState(false);

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

  async function togglePreview(reportId: string) {
    // Collapse if already open
    if (expandedId === reportId) {
      setExpandedId(null);
      return;
    }

    setExpandedId(reportId);

    // Use cache if already fetched
    if (previewCache[reportId]) return;

    setPreviewLoading(true);
    try {
      const res = await fetch(`/api/properties/${id}/reports/${reportId}`);
      const data: ReportWithData = await res.json();
      setPreviewCache((prev) => ({ ...prev, [reportId]: data }));
    } catch {
      // leave expandedId set; preview will show error state
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDownload(e: React.MouseEvent, report: Report) {
    e.stopPropagation(); // don't toggle preview when clicking Download

    // Fetch full report data if not cached
    let full = previewCache[report.id];
    if (!full) {
      const res = await fetch(`/api/properties/${id}/reports/${report.id}`);
      full = await res.json();
      setPreviewCache((prev) => ({ ...prev, [report.id]: full }));
    }
    await downloadReport(full);
  }

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
            <div className="flex flex-wrap gap-2 justify-end">
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
              <div key={type} className="card p-0 overflow-hidden">
                <div className="px-6 py-3 bg-gray-50 border-b border-gray-200">
                  <p className="text-xs font-bold uppercase tracking-widest text-navy-600">
                    {TYPE_LABELS[type]} Reports
                  </p>
                </div>
                <table className="finance-table text-xs">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Details</th>
                      <th>Date</th>
                      <th className="text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {grouped[type].map((r) => (
                      <>
                        {/* Report row */}
                        <tr
                          key={r.id}
                          onClick={() => togglePreview(r.id)}
                          className={`cursor-pointer transition-colors ${
                            expandedId === r.id
                              ? "bg-navy-50"
                              : "hover:bg-blue-50"
                          }`}
                        >
                          <td>
                            <div className="flex items-center gap-2">
                              <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${TYPE_COLORS[r.type] ?? "bg-gray-100 text-gray-600"}`}>
                                {TYPE_LABELS[r.type] ?? r.type}
                              </span>
                              <span className="font-medium text-navy-800">{r.label || "Report"}</span>
                            </div>
                          </td>
                          <td className="text-gray-400">
                            {r.type === "rentroll" && r.metadata && (
                              <span>{(r.metadata as Record<string, unknown>).units as number} units · {String((r.metadata as Record<string, unknown>).format ?? "")}</span>
                            )}
                            {r.type === "t12" && r.metadata && (
                              <span>{(r.metadata as Record<string, unknown>).lineItems as number} line items</span>
                            )}
                            {r.type === "rentcomps" && r.metadata && (
                              <span>{(r.metadata as Record<string, unknown>).compCount as number} comps</span>
                            )}
                            {r.type === "tradeout" && r.metadata && (
                              <span>{(r.metadata as Record<string, unknown>).unitCount as number} units · {((r.metadata as Record<string, unknown>).periods as string[])?.join(" → ")}</span>
                            )}
                          </td>
                          <td className="text-gray-400 whitespace-nowrap">
                            {new Date(r.createdAt).toLocaleDateString()}
                          </td>
                          <td className="text-right">
                            <div className="flex items-center justify-end gap-3">
                              <button
                                onClick={(e) => { e.stopPropagation(); togglePreview(r.id); }}
                                className="text-xs font-semibold text-navy-700 hover:text-navy-900 transition-colors"
                              >
                                {expandedId === r.id ? "▲ Hide" : "▼ View"}
                              </button>
                              {r.type !== "tradeout" && (
                                <button
                                  onClick={(e) => handleDownload(e, r)}
                                  className="text-xs font-semibold text-gold-600 hover:text-gold-700 transition-colors"
                                >
                                  Download ↓
                                </button>
                              )}
                              {r.excelUrl && (
                                <a
                                  href={r.excelUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  onClick={(e) => e.stopPropagation()}
                                  className="text-xs font-semibold text-navy-700 hover:text-gold-500 transition-colors"
                                >
                                  File ↓
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Inline preview row */}
                        {expandedId === r.id && (
                          <tr key={`${r.id}-preview`}>
                            <td colSpan={4} className="p-0 border-t-2 border-navy-200">
                              <div className="bg-white px-6 py-5">
                                {previewLoading && !previewCache[r.id] ? (
                                  <p className="text-sm text-gray-400 py-4 text-center">Loading preview...</p>
                                ) : previewCache[r.id]?.processedData ? (
                                  <ReportPreview
                                    type={r.type}
                                    processedData={previewCache[r.id].processedData!}
                                  />
                                ) : (
                                  <p className="text-sm text-gray-400 py-4 text-center">
                                    No preview available — this report was saved before inline previews were enabled.
                                  </p>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </>
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
