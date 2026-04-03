"use client";

import { useState, useEffect } from "react";
import NavBar from "@/components/shared/NavBar";
import UploadZone from "@/components/rediq/UploadZone";
import RentRollPreview from "@/components/rediq/RentRollPreview";
import YardiRentRollPreview from "@/components/rediq/YardiRentRollPreview";
import ProgressIndicator from "@/components/shared/ProgressIndicator";
import type { RentRollData } from "@/lib/schemas";
import type { ParsedRentRoll } from "@/lib/yardi-parser";

type Status = "idle" | "processing" | "done" | "error";
type StepStatus = "pending" | "active" | "done" | "error";

interface Property { id: string; name: string; }

export default function RentRollPage() {
  const [rrFile, setRRFile] = useState<File | null>(null);
  const [rrData, setRRData] = useState<RentRollData | null>(null);
  const [yardiData, setYardiData] = useState<ParsedRentRoll | null>(null);
  const [rrFormat, setRRFormat] = useState<"yardi" | "generic" | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState([
    { label: "Detecting format", status: "pending" as StepStatus },
    { label: "Parsing rent roll", status: "pending" as StepStatus },
    { label: "Building output", status: "pending" as StepStatus },
  ]);
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [savedToLibrary, setSavedToLibrary] = useState(false);

  useEffect(() => {
    fetch("/api/properties").then((r) => r.json()).then((data) => {
      if (Array.isArray(data)) setProperties(data);
    }).catch(() => {});
  }, []);

  function updateStep(idx: number, s: StepStatus) {
    setSteps((prev) => prev.map((step, i) => (i === idx ? { ...step, status: s } : step)));
  }

  async function processFile() {
    if (!rrFile) return;
    setStatus("processing");
    setError(null);
    setRRData(null);
    setYardiData(null);
    setRRFormat(null);
    setSavedToLibrary(false);
    setSteps([
      { label: "Detecting format", status: "active" },
      { label: "Parsing rent roll", status: "pending" },
      { label: "Building output", status: "pending" },
    ]);

    try {
      const fd = new FormData();
      fd.append("file", rrFile);
      updateStep(0, "done");
      updateStep(1, "active");

      const res = await fetch("/api/rediq/process-rentroll", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || "Processing failed");

      setRRFormat(j.format);
      if (j.format === "yardi") {
        setYardiData(j.data as ParsedRentRoll);
      } else {
        setRRData(j.data as RentRollData);
      }

      updateStep(1, "done");
      updateStep(2, "active");
      await new Promise((r) => setTimeout(r, 300));
      updateStep(2, "done");
      setStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An error occurred";
      setError(msg);
      setStatus("error");
      setSteps((prev) => prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s)));
    }
  }

  async function downloadExcel() {
    const res = await fetch("/api/rediq/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rentRoll: yardiData ?? rrData, rentRollFormat: rrFormat }),
    });
    if (!res.ok) { const j = await res.json(); alert(j.error || "Download failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("Content-Disposition")?.split('filename="')[1]?.replace('"', "") || "rent-roll.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveToLibrary() {
    if (!selectedPropertyId) return;
    const label = rrFile?.name || "Rent Roll";
    await fetch(`/api/properties/${selectedPropertyId}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "rentroll", label, metadata: yardiData ? { format: "yardi", units: yardiData.totalUnits } : { format: "generic" } }),
    });
    setSavedToLibrary(true);
  }

  function reset() {
    setRRFile(null);
    setRRData(null);
    setYardiData(null);
    setRRFormat(null);
    setStatus("idle");
    setError(null);
    setSavedToLibrary(false);
    setSteps([
      { label: "Detecting format", status: "pending" },
      { label: "Parsing rent roll", status: "pending" },
      { label: "Building output", status: "pending" },
    ]);
  }

  const hasResults = rrData || yardiData;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy-900">Rent Roll</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Yardi reports are parsed directly. All other formats are mapped with AI. Output matches the redIQ standardized structure.
          </p>
        </div>

        <div className="card mb-6">
          <p className="section-header">Upload Rent Roll</p>

          {/* Property picker */}
          {properties.length > 0 && (
            <div className="mb-4">
              <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Property (optional)</label>
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

          <UploadZone
            label="Upload Rent Roll"
            sublabel="Yardi export or any Excel/PDF format"
            file={rrFile}
            onFile={setRRFile}
            disabled={status === "processing"}
          />

          <div className="flex items-center gap-4 mt-5">
            <button onClick={processFile} disabled={!rrFile || status === "processing"} className="btn-primary">
              {status === "processing" ? "Processing..." : "Process"}
            </button>
            {hasResults && (
              <button onClick={downloadExcel} className="btn-gold">
                {rrFormat === "yardi" ? "Download redIQ Excel" : "Download Excel"}
              </button>
            )}
            {hasResults && selectedPropertyId && !savedToLibrary && (
              <button onClick={saveToLibrary} className="btn-outline">
                Save to Library
              </button>
            )}
            {savedToLibrary && (
              <span className="text-sm text-green-600 font-medium">Saved to library</span>
            )}
            {rrFile && status !== "processing" && (
              <button onClick={reset} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                Clear
              </button>
            )}
          </div>
        </div>

        {status === "processing" && (
          <div className="card mb-6">
            <p className="section-header">Processing</p>
            <ProgressIndicator steps={steps} />
          </div>
        )}

        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm font-semibold text-red-700">Processing Error</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        )}

        {yardiData && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <p className="section-header mb-0">Rent Roll — redIQ Format</p>
              <div className="flex items-center gap-2">
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">Yardi detected</span>
                <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                  {yardiData.units.filter((u) => !u.isFuture).length} units
                </span>
              </div>
            </div>
            <YardiRentRollPreview data={yardiData} />
          </div>
        )}

        {rrData && !yardiData && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <p className="section-header mb-0">Rent Roll</p>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                {rrData.units.length} units mapped
              </span>
            </div>
            <RentRollPreview data={rrData} />
          </div>
        )}
      </main>
    </div>
  );
}
