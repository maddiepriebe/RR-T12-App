"use client";

import { useState } from "react";
import NavBar from "@/components/shared/NavBar";
import CoStarUpload from "@/components/rentcomps/CoStarUpload";
import CompsSummaryTable from "@/components/rentcomps/CompsSummaryTable";
import UnitMixDetail from "@/components/rentcomps/UnitMixDetail";
import SubjectVsComps from "@/components/rentcomps/SubjectVsComps";
import ProgressIndicator from "@/components/shared/ProgressIndicator";
import type { RentCompsData } from "@/lib/schemas";

type Status = "idle" | "processing" | "done" | "error";
type StepStatus = "pending" | "active" | "done" | "error";
type Tab = "summary" | "unitmix" | "comparison";

const INITIAL_STEPS = [
  { label: "Extracting PDF text", status: "pending" as StepStatus },
  { label: "Parsing comp summary table", status: "pending" as StepStatus },
  { label: "Extracting unit mix details", status: "pending" as StepStatus },
  { label: "Building analysis", status: "pending" as StepStatus },
];

export default function RentCompsPage() {
  const [file, setFile] = useState<File | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState(INITIAL_STEPS);
  const [data, setData] = useState<RentCompsData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("summary");

  function updateStep(idx: number, s: StepStatus) {
    setSteps((prev) => prev.map((step, i) => (i === idx ? { ...step, status: s } : step)));
  }

  async function processReport() {
    if (!file) return;

    setStatus("processing");
    setError(null);
    setData(null);
    setSteps(INITIAL_STEPS.map((s, i) => ({ ...s, status: i === 0 ? "active" : "pending" })));

    try {
      const fd = new FormData();
      fd.append("file", file);
      if (subjectName) fd.append("subjectName", subjectName);

      updateStep(0, "active");

      // The API handles the multi-step extraction
      // We simulate progress steps while waiting
      const progressTimer = setTimeout(() => updateStep(1, "active"), 3000);
      const progressTimer2 = setTimeout(() => {
        updateStep(1, "done");
        updateStep(2, "active");
      }, 8000);
      const progressTimer3 = setTimeout(() => {
        updateStep(2, "done");
        updateStep(3, "active");
      }, 20000);

      const res = await fetch("/api/rentcomps/process", {
        method: "POST",
        body: fd,
      });

      clearTimeout(progressTimer);
      clearTimeout(progressTimer2);
      clearTimeout(progressTimer3);

      const json = await res.json();

      if (!json.success) {
        throw new Error(json.error || "Processing failed");
      }

      setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "done" as StepStatus })));
      setData(json.data as RentCompsData);
      setStatus("done");
      setActiveTab("summary");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Processing failed";
      setError(msg);
      setStatus("error");
      setSteps((prev) =>
        prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s))
      );
    }
  }

  async function downloadExcel() {
    if (!data) return;

    const res = await fetch("/api/rentcomps/download", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
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
      "rent_comps.xlsx";
    a.click();
    URL.revokeObjectURL(url);
  }

  function reset() {
    setFile(null);
    setSubjectName("");
    setStatus("idle");
    setError(null);
    setData(null);
    setSteps(INITIAL_STEPS);
  }

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "summary", label: "Summary Table" },
    { id: "unitmix", label: "Unit Mix Detail" },
    { id: "comparison", label: "Subject vs. Comps" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Page header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy-900">Rent Comps</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Upload a CoStar Underwriting Report PDF. AI extracts all comp data and builds a
            standardized analysis — replacing the macro workflow.
          </p>
        </div>

        {/* Upload section */}
        <div className="card mb-6">
          <p className="section-header">Upload CoStar Report</p>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <CoStarUpload
                file={file}
                onFile={setFile}
                disabled={status === "processing"}
              />
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                  Subject Property Name
                </label>
                <input
                  type="text"
                  value={subjectName}
                  onChange={(e) => setSubjectName(e.target.value)}
                  placeholder="e.g. Elme Bethesda"
                  disabled={status === "processing"}
                  className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-500 focus:ring-1 focus:ring-navy-500 disabled:opacity-50"
                />
                <p className="text-xs text-gray-400 mt-1">
                  Optional — helps AI identify subject vs. comps
                </p>
              </div>

              <div className="space-y-2">
                <button
                  onClick={processReport}
                  disabled={!file || status === "processing"}
                  className="btn-primary w-full"
                >
                  {status === "processing" ? "Processing..." : "Process Report"}
                </button>

                {data && (
                  <button onClick={downloadExcel} className="btn-gold w-full">
                    Download Excel
                  </button>
                )}

                {(file || data) && status !== "processing" && (
                  <button
                    onClick={reset}
                    className="w-full text-sm text-gray-400 hover:text-gray-600 transition-colors py-1"
                  >
                    Clear
                  </button>
                )}
              </div>

              {data && (
                <div className="text-xs text-gray-500 space-y-1 pt-2 border-t border-gray-100">
                  <p>
                    <span className="font-medium text-gray-700">
                      {data.comps.filter((c) => !c.isSubject).length}
                    </span>{" "}
                    comps extracted
                  </p>
                  <p>
                    <span className="font-medium text-gray-700">
                      {data.compDetails.length}
                    </span>{" "}
                    unit mix tables
                  </p>
                  {data.subjectProperty && (
                    <p className="text-blue-600 font-medium">
                      Subject: {data.subjectProperty.propertyName}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Progress */}
        {status === "processing" && (
          <div className="card mb-6">
            <p className="section-header">Processing CoStar Report</p>
            <ProgressIndicator steps={steps} />
            <p className="text-xs text-gray-400 mt-3">
              Large reports may take 30–60 seconds. AI is extracting and parsing all comp data...
            </p>
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
        {data && status === "done" && (
          <div>
            {/* Tabs */}
            <div className="flex border-b border-gray-200 mb-0 -mb-px">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? "border-navy-700 text-navy-700"
                      : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="card rounded-tl-none">
              {activeTab === "summary" && <CompsSummaryTable data={data} />}
              {activeTab === "unitmix" && <UnitMixDetail data={data} />}
              {activeTab === "comparison" && <SubjectVsComps data={data} />}
            </div>

            <div className="flex justify-center mt-6 pb-4">
              <button onClick={downloadExcel} className="btn-gold text-base px-8 py-3">
                Download Excel Workbook (7 Sheets)
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
