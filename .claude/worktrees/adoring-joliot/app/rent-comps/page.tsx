"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { extractPDFPages } from "@/lib/extract-pdf-client";
import type { RentCompsData, CompSummary, CompDetail } from "@/lib/schemas";

// ── Formatting helpers ────────────────────────────────────────────────────────

function dash(v: unknown): string {
  return v == null ? "—" : String(v);
}

function fmtInt(v: number | null | undefined): string {
  if (v == null) return "—";
  return Math.round(v).toLocaleString("en-US");
}

function fmtCurrency(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${Math.round(v).toLocaleString("en-US")}`;
}

function fmtPerSF(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${v.toFixed(2)}`;
}

function fmtPct(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${(v * 100).toFixed(1)}%`;
}

function fmtDist(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)} mi`;
}

function renderStars(n: number | null | undefined): string {
  if (n == null) return "—";
  return "★".repeat(Math.max(0, Math.min(5, Math.round(n))));
}

// Match compDetail to a CompSummary by name (case-insensitive).
function findDetail(data: RentCompsData, name: string): CompDetail | undefined {
  const key = name.toLowerCase().trim();
  return data.compDetails.find((d) => d.propertyName.toLowerCase().trim() === key);
}

// ── Excel export ──────────────────────────────────────────────────────────────

async function downloadExcel(data: RentCompsData) {
  const res = await fetch("/api/rentcomps/download", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "Rent Comps.xlsx";
  a.click();
  URL.revokeObjectURL(url);
}

function bedStr(bed: number): string {
  if (bed === 0) return "Studio";
  return `${bed}BR`;
}

// ── Page component ────────────────────────────────────────────────────────────

type Status = "idle" | "extracting" | "processing" | "done" | "error";

interface Property { id: string; name: string; }

export default function RentCompsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [statusMsg, setStatusMsg] = useState("");
  const [data, setData] = useState<RentCompsData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [subjectName, setSubjectName] = useState("");
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState("");
  const [savedToLibrary, setSavedToLibrary] = useState(false);

  useEffect(() => {
    fetch("/api/properties")
      .then((r) => r.json())
      .then((d) => { if (Array.isArray(d)) setProperties(d); })
      .catch(() => {});
  }, []);

  const handleFile = useCallback((f: File) => {
    if (!f.name.toLowerCase().endsWith(".pdf")) return;
    setFile(f);
    setData(null);
    setError(null);
    setStatus("idle");
    setExpanded(new Set());
    setSavedToLibrary(false);
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const f = e.dataTransfer.files[0];
      if (f) handleFile(f);
    },
    [handleFile]
  );

  const process = async () => {
    if (!file) return;
    setError(null);
    setStatus("extracting");
    setStatusMsg("Reading PDF in browser…");
    setSavedToLibrary(false);

    try {
      const [pages, pdfBase64] = await Promise.all([
        extractPDFPages(file),
        file.arrayBuffer().then((buf) => {
          const bytes = new Uint8Array(buf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          return btoa(binary);
        }),
      ]);
      setStatus("processing");
      setStatusMsg(`Extracted ${pages.length} pages — processing…`);

      const res = await fetch("/api/rentcomps/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, pdfBase64, subjectName: subjectName.trim() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
        throw new Error(err.error ?? `HTTP ${res.status}`);
      }

      const result: RentCompsData = await res.json();
      setData(result);
      setStatus("done");
    } catch (err) {
      console.error("[RentCompsPage] process() crashed:", err);
      setError(err instanceof Error ? err.message : "Processing failed");
      setStatus("error");
    }
  };

  async function saveToLibrary() {
    if (!selectedPropertyId || !data) return;
    const label = file?.name || "Rent Comps";
    await fetch(`/api/properties/${selectedPropertyId}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "rentcomps",
        label,
        metadata: { comps: data.comps.filter((c) => !c.isSubject).length },
        processedData: { data },
      }),
    });
    setSavedToLibrary(true);
  }

  const toggleRow = (name: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  };

  const isBusy = status === "extracting" || status === "processing";

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-navy-950 text-white px-6 py-4 shadow">
        <div className="max-w-screen-2xl mx-auto flex items-center gap-3">
          <span className="text-gold-500 font-bold text-lg tracking-tight">AREL</span>
          <span className="text-navy-600">|</span>
          <h1 className="text-sm font-semibold tracking-wide uppercase text-navy-100">
            Rent Comps Analysis
          </h1>
        </div>
      </header>

      <main className="max-w-screen-2xl mx-auto px-6 py-8 space-y-6">
        {/* Upload card */}
        <div className="card">
          <p className="section-header">Upload CoStar PDF</p>

          {/* Property selector */}
          {properties.length > 0 && (
            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
                Property (optional)
              </label>
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

          {/* Subject name */}
          <div className="mb-4">
            <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">
              Subject Property Name
            </label>
            <input
              type="text"
              className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
              placeholder="e.g. Elme Bethesda"
              value={subjectName}
              onChange={(e) => setSubjectName(e.target.value)}
            />
            <p className="text-xs text-gray-400 mt-1">
              Helps identify the subject property in the report. Leave blank to auto-detect.
            </p>
          </div>

          {/* Drop zone */}
          <div
            className={`upload-zone${isDragging ? " drag-active" : ""}${file ? " has-file" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
              }}
            />
            {file ? (
              <p className="text-green-700 font-medium">{file.name}</p>
            ) : (
              <>
                <p className="text-gray-500 font-medium">Drop CoStar PDF here or click to browse</p>
                <p className="text-gray-400 text-sm mt-1">Rent Comps PDF only</p>
              </>
            )}
          </div>

          {/* Action row */}
          <div className="mt-4 flex items-center gap-4 flex-wrap">
            <button className="btn-primary" disabled={!file || isBusy} onClick={process}>
              {status === "extracting"
                ? "Extracting text…"
                : status === "processing"
                ? "Processing…"
                : "Process PDF"}
            </button>
            {isBusy && <span className="text-sm text-gray-500">{statusMsg}</span>}
            {data && (
              <button
                className="btn-gold"
                onClick={() => downloadExcel(data).catch((e) => alert(`Download failed: ${e.message}`))}
              >
                Download Excel
              </button>
            )}
            {data && selectedPropertyId && !savedToLibrary && (
              <button className="btn-outline" onClick={saveToLibrary}>
                Save to Library
              </button>
            )}
            {savedToLibrary && (
              <span className="text-sm text-green-600 font-medium">Saved to library</span>
            )}
          </div>
        </div>

        {/* Error */}
        {status === "error" && error && (
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Results */}
        {status === "done" && data && (
          <>
            {/* Toolbar */}
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {data.comps.length} properties
                {data.reportDate ? ` · ${data.reportDate}` : ""}
              </p>
            </div>

            {/* Summary table */}
            <div className="card p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm border-collapse">
                  <thead>
                    <tr>
                      {[
                        ["#", "w-10 text-center"],
                        ["Property", "text-left min-w-[180px]"],
                        ["Yr Built", "text-right"],
                        ["Units", "text-right"],
                        ["Avg SF", "text-right"],
                        ["Distance", "text-right"],
                        ["Stars", "text-center"],
                        ["Studio", "text-right"],
                        ["1BR", "text-right"],
                        ["2BR", "text-right"],
                        ["3BR", "text-right"],
                        ["Ask/SF", "text-right"],
                        ["Vacancy", "text-right"],
                        ["Concessions", "text-right"],
                      ].map(([label, cls]) => (
                        <th
                          key={label}
                          className={`bg-navy-800 text-white font-semibold px-3 py-2 text-xs uppercase tracking-wider ${cls}`}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {data.comps.map((comp: CompSummary) => {
                      const isExpanded = expanded.has(comp.name);
                      const detail = findDetail(data, comp.name);
                      const isSubject = !!comp.isSubject;

                      return (
                        <Fragment key={comp.name}>
                          {/* Summary row */}
                          <tr
                            className={`cursor-pointer border-b border-gray-100 transition-colors ${
                              isSubject
                                ? "bg-amber-50 hover:bg-amber-100"
                                : "bg-white hover:bg-gray-50"
                            }`}
                            onClick={() => toggleRow(comp.name)}
                          >
                            <td className="px-3 py-2 text-center text-gray-400 text-xs select-none whitespace-nowrap">
                              <span className="mr-1">{isExpanded ? "▼" : "▶"}</span>
                              {comp.rank === 0 ? "S" : dash(comp.rank)}
                            </td>
                            <td className="px-3 py-2 font-medium text-left">
                              <span className={isSubject ? "text-amber-900" : "text-navy-800"}>
                                {comp.name}
                              </span>
                              {isSubject && (
                                <span className="ml-2 text-xs bg-amber-200 text-amber-800 px-1.5 py-0.5 rounded font-semibold">
                                  Subject
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{dash(comp.yearBuilt)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtInt(comp.totalUnits)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtInt(comp.avgUnitSF)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtDist(comp.distanceToSubjectMiles)}</td>
                            <td className="px-3 py-2 text-center text-gold-500 text-xs">
                              {renderStars(comp.coStarRating)}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(comp.studioAskingRent)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(comp.oneBedAskingRent)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(comp.twoBedAskingRent)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtCurrency(comp.threeBedAskingRent)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtPerSF(comp.askingRentPerSF)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtPct(comp.totalVacancyPct)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{fmtPct(comp.concessionsPct)}</td>
                          </tr>

                          {/* Expanded detail sub-table */}
                          {isExpanded && (
                            <tr
                              className={
                                isSubject ? "bg-amber-50/60" : "bg-blue-50/30"
                              }
                            >
                              <td colSpan={14} className="px-0 py-0 border-b border-gray-200">
                                {detail && detail.unitTypes.length > 0 ? (
                                  <table className="w-full text-xs border-collapse">
                                    <thead>
                                      <tr className="bg-gray-100 border-b border-gray-200">
                                        <th className="pl-10 pr-3 py-1.5 text-left text-gray-500 font-semibold uppercase tracking-wider w-40">
                                          Unit Type
                                        </th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-semibold uppercase tracking-wider">Bath</th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-semibold uppercase tracking-wider">Avg SF</th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-semibold uppercase tracking-wider">Units</th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-semibold uppercase tracking-wider">Mix%</th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-semibold uppercase tracking-wider">ASK/Unit</th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-semibold uppercase tracking-wider">ASK/SF</th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-semibold uppercase tracking-wider">EFF/Unit</th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-semibold uppercase tracking-wider">EFF/SF</th>
                                        <th className="px-3 py-1.5 text-right text-gray-500 font-semibold uppercase tracking-wider pr-4">Concessions</th>
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {detail.unitTypes.map((ut, i) => (
                                        <tr
                                          key={i}
                                          className={
                                            i % 2 === 0 ? "bg-white" : "bg-gray-50"
                                          }
                                        >
                                          <td className="pl-10 pr-3 py-1.5 text-navy-700 font-medium">
                                            {ut.label ?? bedStr(ut.bed)}
                                          </td>
                                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{dash(ut.bath)}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{fmtInt(ut.avgSF)}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{fmtInt(ut.units)}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{fmtPct(ut.mixPct)}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{fmtCurrency(ut.askingRentPerUnit)}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{fmtPerSF(ut.askingRentPerSF)}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{fmtCurrency(ut.effectiveRentPerUnit)}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700">{fmtPerSF(ut.effectiveRentPerSF)}</td>
                                          <td className="px-3 py-1.5 text-right tabular-nums text-gray-700 pr-4">{fmtPct(ut.concessionsPct)}</td>
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                ) : (
                                  <p className="pl-10 py-2 text-xs text-gray-400 italic">
                                    No unit type data available
                                  </p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
