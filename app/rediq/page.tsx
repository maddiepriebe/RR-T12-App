"use client";

import { useState } from "react";
import NavBar from "@/components/shared/NavBar";
import UploadZone from "@/components/rediq/UploadZone";
import T12Preview from "@/components/rediq/T12Preview";
import RentRollPreview from "@/components/rediq/RentRollPreview";
import YardiRentRollPreview from "@/components/rediq/YardiRentRollPreview";
import ProgressIndicator from "@/components/shared/ProgressIndicator";
import type { T12Data, RentRollData } from "@/lib/schemas";
import type { ParsedRentRoll } from "@/lib/yardi-parser";

type Status = "idle" | "processing" | "done" | "error";
type StepStatus = "pending" | "active" | "done" | "error";

export default function RedIQPage() {
  const [t12File, setT12File] = useState<File | null>(null);
  const [rrFile, setRRFile] = useState<File | null>(null);

  const [t12Data, setT12Data] = useState<T12Data | null>(null);
  const [rrData, setRRData] = useState<RentRollData | null>(null);
  const [yardiData, setYardiData] = useState<ParsedRentRoll | null>(null);
  const [rrFormat, setRRFormat] = useState<"yardi" | "generic" | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const [steps, setSteps] = useState([
    { label: "Extracting document text", status: "pending" as StepStatus },
    { label: "Mapping fields with AI", status: "pending" as StepStatus },
    { label: "Building output", status: "pending" as StepStatus },
  ]);

  function updateStep(idx: number, s: StepStatus) {
    setSteps((prev) => prev.map((step, i) => (i === idx ? { ...step, status: s } : step)));
  }

  async function processFiles() {
    if (!t12File && !rrFile) return;

    setStatus("processing");
    setError(null);
    setT12Data(null);
    setRRData(null);
    setYardiData(null);
    setRRFormat(null);
    setSteps([
      { label: "Extracting document text", status: "active" },
      { label: "Mapping fields with AI", status: "pending" },
      { label: "Building output", status: "pending" },
    ]);

    try {
      updateStep(0, "active");
      const fetches: Promise<void>[] = [];

      if (t12File) {
        const fd = new FormData();
        fd.append("file", t12File);
        fetches.push(
          fetch("/api/rediq/process-t12", { method: "POST", body: fd })
            .then((r) => r.json())
            .then((j) => {
              if (!j.success) throw new Error(j.error || "T12 processing failed");
              setT12Data(j.data);
            })
        );
      }

      if (rrFile) {
        const fd = new FormData();
        fd.append("file", rrFile);
        fetches.push(
          fetch("/api/rediq/process-rentroll", { method: "POST", body: fd })
            .then((r) => r.json())
            .then((j) => {
              if (!j.success) throw new Error(j.error || "Rent roll processing failed");
              setRRFormat(j.format);
              if (j.format === "yardi") {
                setYardiData(j.data as ParsedRentRoll);
              } else {
                setRRData(j.data as RentRollData);
              }
            })
        );
      }

      updateStep(0, "done");
      updateStep(1, "active");

      await Promise.all(fetches);

      updateStep(1, "done");
      updateStep(2, "active");
      await new Promise((r) => setTimeout(r, 400));
      updateStep(2, "done");
      setStatus("done");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "An error occurred";
      setError(msg);
      setStatus("error");
      setSteps((prev) =>
        prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s))
      );
    }
  }

  async function downloadExcel() {
    if (!t12Data && !rrData && !yardiData) return;

    const res = await fetch("/api/rediq/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        t12: t12Data,
        rentRoll: yardiData ?? rrData,
        rentRollFormat: rrFormat,
      }),
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
      "underwriting.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setT12File(null);
    setRRFile(null);
    setT12Data(null);
    setRRData(null);
    setYardiData(null);
    setRRFormat(null);
    setStatus("idle");
    setError(null);
    setSteps([
      { label: "Extracting document text", status: "pending" },
      { label: "Mapping fields with AI", status: "pending" },
      { label: "Building output", status: "pending" },
    ]);
  }

  const canProcess = (t12File || rrFile) && status !== "processing";
  const hasResults = t12Data || rrData || yardiData;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy-900">T12 & Rent Roll</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Upload in any format. Yardi reports are parsed directly; all other formats are mapped
            with AI. Output matches the redIQ standardized structure.
          </p>
        </div>

        {/* Upload zone */}
        <div className="card mb-6">
          <p className="section-header">Upload Documents</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
                Trailing 12 (T12)
              </p>
              <UploadZone
                label="Upload T12"
                sublabel="Income statement in any format"
                file={t12File}
                onFile={setT12File}
                disabled={status === "processing"}
              />
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">
                Rent Roll
              </p>
              <UploadZone
                label="Upload Rent Roll"
                sublabel="Yardi export or any format"
                file={rrFile}
                onFile={setRRFile}
                disabled={status === "processing"}
              />
            </div>
          </div>

          <div className="flex items-center gap-4 mt-5">
            <button
              onClick={processFiles}
              disabled={!canProcess}
              className="btn-primary"
            >
              {status === "processing" ? "Processing..." : "Process"}
            </button>

            {hasResults && (
              <button onClick={downloadExcel} className="btn-gold">
                {rrFormat === "yardi" ? "Download redIQ Excel" : "Download Excel"}
              </button>
            )}

            {(t12File || rrFile) && status !== "processing" && (
              <button onClick={reset} className="text-sm text-gray-400 hover:text-gray-600 transition-colors">
                Clear all
              </button>
            )}
          </div>
        </div>

        {/* Processing indicator */}
        {status === "processing" && (
          <div className="card mb-6">
            <p className="section-header">Processing</p>
            <ProgressIndicator steps={steps} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-sm font-semibold text-red-700">Processing Error</p>
            <p className="text-sm text-red-600 mt-1">{error}</p>
          </div>
        )}

        {/* Results */}
        {hasResults && (
          <div className="space-y-6">
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

            {yardiData && (
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <p className="section-header mb-0">Rent Roll — redIQ Format</p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-medium">
                      Yardi detected
                    </span>
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

            <div className="flex justify-center pb-4">
              <button onClick={downloadExcel} className="btn-gold text-base px-8 py-3">
                {rrFormat === "yardi"
                  ? "Download redIQ Workbook (Floor Plan + Rent Roll + Source Data)"
                  : "Download Excel Workbook"}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
