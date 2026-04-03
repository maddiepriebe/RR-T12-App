"use client";

import { useState, useEffect } from "react";
import NavBar from "@/components/shared/NavBar";
import UploadZone from "@/components/rediq/UploadZone";
import T12Preview from "@/components/rediq/T12Preview";
import ProgressIndicator from "@/components/shared/ProgressIndicator";
import type { T12Data } from "@/lib/schemas";

type Status = "idle" | "processing" | "done" | "error";
type StepStatus = "pending" | "active" | "done" | "error";

interface Property { id: string; name: string; }

export default function T12Page() {
  const [t12File, setT12File] = useState<File | null>(null);
  const [t12Data, setT12Data] = useState<T12Data | null>(null);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState([
    { label: "Extracting document text", status: "pending" as StepStatus },
    { label: "Mapping fields with AI", status: "pending" as StepStatus },
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
    if (!t12File) return;
    setStatus("processing");
    setError(null);
    setT12Data(null);
    setSavedToLibrary(false);
    setSteps([
      { label: "Extracting document text", status: "active" },
      { label: "Mapping fields with AI", status: "pending" },
      { label: "Building output", status: "pending" },
    ]);

    try {
      updateStep(0, "done");
      updateStep(1, "active");

      const fd = new FormData();
      fd.append("file", t12File);
      const res = await fetch("/api/rediq/process-t12", { method: "POST", body: fd });
      const j = await res.json();
      if (!j.success) throw new Error(j.error || "T12 processing failed");

      setT12Data(j.data);
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
      body: JSON.stringify({ t12: t12Data }),
    });
    if (!res.ok) { const j = await res.json(); alert(j.error || "Download failed"); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = res.headers.get("Content-Disposition")?.split('filename="')[1]?.replace('"', "") || "t12.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function saveToLibrary() {
    if (!selectedPropertyId || !t12Data) return;
    const label = t12File?.name || "T12";
    await fetch(`/api/properties/${selectedPropertyId}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "t12", label, metadata: { lineItems: t12Data.lineItems.length } }),
    });
    setSavedToLibrary(true);
  }

  function reset() {
    setT12File(null);
    setT12Data(null);
    setStatus("idle");
    setError(null);
    setSavedToLibrary(false);
    setSteps([
      { label: "Extracting document text", status: "pending" },
      { label: "Mapping fields with AI", status: "pending" },
      { label: "Building output", status: "pending" },
    ]);
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy-900">T12 Analysis</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Upload a trailing 12-month income statement in any format. AI maps line items to the standardized template.
          </p>
        </div>

        <div className="card mb-6">
          <p className="section-header">Upload T12</p>

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
            label="Upload T12"
            sublabel="Income statement in any format (PDF, Excel)"
            file={t12File}
            onFile={setT12File}
            disabled={status === "processing"}
          />

          <div className="flex items-center gap-4 mt-5">
            <button onClick={processFile} disabled={!t12File || status === "processing"} className="btn-primary">
              {status === "processing" ? "Processing..." : "Process"}
            </button>
            {t12Data && (
              <button onClick={downloadExcel} className="btn-gold">Download Excel</button>
            )}
            {t12Data && selectedPropertyId && !savedToLibrary && (
              <button onClick={saveToLibrary} className="btn-outline">Save to Library</button>
            )}
            {savedToLibrary && (
              <span className="text-sm text-green-600 font-medium">Saved to library</span>
            )}
            {t12File && status !== "processing" && (
              <button onClick={reset} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">Clear</button>
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

        {t12Data && (
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <p className="section-header mb-0">T12 Summary</p>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                {t12Data.lineItems.length} line items mapped
              </span>
            </div>
            <T12Preview data={t12Data} />
          </div>
        )}
      </main>
    </div>
  );
}
