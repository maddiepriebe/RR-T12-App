"use client";

import { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import NavBar from "@/components/shared/NavBar";
import CoStarUpload from "@/components/rentcomps/CoStarUpload";
import CompsSummaryTable from "@/components/rentcomps/CompsSummaryTable";
import UnitMixDetail from "@/components/rentcomps/UnitMixDetail";
import SubjectVsComps from "@/components/rentcomps/SubjectVsComps";
import ProgressIndicator from "@/components/shared/ProgressIndicator";
import type { RentCompsData } from "@/lib/schemas";
import { extractPDFPages } from "@/lib/extract-pdf-client";

type Status = "idle" | "processing" | "done" | "error";
type StepStatus = "pending" | "active" | "done" | "error";
type Tab = "summary" | "unitmix" | "comparison";

const INITIAL_STEPS = [
  { label: "Reading PDF in browser", status: "pending" as StepStatus },
  { label: "Parsing summary table", status: "pending" as StepStatus },
  { label: "Extracting unit mix details", status: "pending" as StepStatus },
];

interface Property { id: string; name: string; }

function RentCompsPage() {
  const searchParams = useSearchParams();
  const [file, setFile] = useState<File | null>(null);
  const [subjectName, setSubjectName] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [steps, setSteps] = useState(INITIAL_STEPS);
  const [data, setData] = useState<RentCompsData | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("summary");
  const [properties, setProperties] = useState<Property[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string>("");
  const [savedToLibrary, setSavedToLibrary] = useState(false);
  const [awaitingAIRetry, setAwaitingAIRetry] = useState(false);
  const [retryInFlight, setRetryInFlight] = useState(false);
  const pendingRetryRef = useRef<{ pages: string[]; subjectName: string } | null>(null);

  useEffect(() => {
    fetch("/api/properties").then((r) => r.json()).then((rows) => {
      if (Array.isArray(rows)) {
        setProperties(rows);
        const pid = searchParams.get("propertyId");
        if (pid && rows.some((p: Property) => p.id === pid)) {
          setSelectedPropertyId(pid);
        }
      }
    }).catch(() => {});
  }, [searchParams]);

  function updateStep(idx: number, s: StepStatus) {
    setSteps((prev) => prev.map((step, i) => (i === idx ? { ...step, status: s } : step)));
  }

  function autoSaveIfSelected(compsData: RentCompsData) {
    if (!selectedPropertyId) return;
    const label = file?.name || "Rent Comps";
    fetch(`/api/properties/${selectedPropertyId}/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "rentcomps",
        label,
        metadata: {
          compCount: compsData.comps.filter((c) => !c.isSubject).length,
          subject: compsData.subjectProperty?.propertyName ?? null,
        },
        processedData: { data: compsData },
      }),
    }).then(() => setSavedToLibrary(true)).catch(() => {});
  }

  async function processReport() {
    if (!file) return;

    setStatus("processing");
    setError(null);
    setData(null);
    setAwaitingAIRetry(false);
    pendingRetryRef.current = null;
    setSteps(INITIAL_STEPS.map((s, i) => ({ ...s, status: i === 0 ? "active" : "pending" })));

    try {
      // Step 1: Extract text client-side — PDF binary never leaves the browser.
      updateStep(0, "active");
      const t0 = performance.now();
      const pages = await extractPDFPages(file);
      const totalChars = pages.reduce((s, p) => s + p.length, 0);
      console.log(
        `1. PDF text extracted — ${pages.length} pages, ${totalChars} chars total, ` +
        `took ${((performance.now() - t0) / 1000).toFixed(1)}s`
      );
      updateStep(0, "done");

      // Step 2: Send page text to the server's regex parser.
      updateStep(1, "active");
      const t1 = performance.now();
      const res = await fetch("/api/rentcomps/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pages, subjectName }),
      });

      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `Parser request failed (${res.status})`);
      }

      const payload = (await res.json()) as
        | { status: "ok"; data: RentCompsData }
        | { status: "no_comps"; data: null };

      console.log(
        `2. Server parse complete — status=${payload.status}, ` +
        `took ${((performance.now() - t1) / 1000).toFixed(1)}s`
      );

      if (payload.status === "no_comps") {
        // Regex parser couldn't find any comps. Stash pages for an AI retry and
        // prompt the user — Claude extraction takes 30–60s so we don't auto-run it.
        pendingRetryRef.current = { pages, subjectName };
        setAwaitingAIRetry(true);
        setStatus("idle");
        setSteps(INITIAL_STEPS);
        return;
      }

      updateStep(1, "done");
      updateStep(2, "active");
      setSteps(INITIAL_STEPS.map((s) => ({ ...s, status: "done" as StepStatus })));

      setData(payload.data);
      setStatus("done");
      setActiveTab("summary");
      autoSaveIfSelected(payload.data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Processing failed";
      setError(msg);
      setStatus("error");
      setSteps((prev) =>
        prev.map((s) => (s.status === "active" ? { ...s, status: "error" } : s))
      );
    }
  }

  async function retryWithAI() {
    const pending = pendingRetryRef.current;
    if (!pending) return;
    const { pages, subjectName: subj } = pending;

    setRetryInFlight(true);
    setError(null);

    try {
      // Boundary between the summary table and per-comp detail pages is the
      // standalone "Photo Comparison" page, which appears exactly once.
      const photoIdx = pages.findIndex((p) => p.includes("Photo Comparison"));
      const boundary = photoIdx === -1 ? Math.ceil(pages.length / 3) : photoIdx;
      const summaryChunk = pages.slice(0, boundary).join("\n");
      const detailPages = pages.slice(boundary);
      const detailChunks: string[] = [];
      for (let i = 0; i < detailPages.length; i += 3) {
        detailChunks.push(detailPages.slice(i, i + 3).join("\n"));
      }

      const fullText = pages.join("\n");
      const countM = fullText.match(/(\d{1,3})\$[^\n]*\nNo\.\s*Rent\s*Comps/);
      const expectedCount = countM ? parseInt(countM[1], 10) : 0;

      const res = await fetch("/api/costar-parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ summaryChunk, detailChunks, subjectName: subj, expectedCount }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `AI extraction failed (${res.status})`);
      }

      const data = (await res.json()) as RentCompsData;
      if (!data.comps.length && !data.subjectProperty) {
        throw new Error("AI extraction returned no comps. Please verify this is a CoStar Underwriting Report.");
      }

      setData(data);
      setStatus("done");
      setActiveTab("summary");
      setAwaitingAIRetry(false);
      pendingRetryRef.current = null;
      autoSaveIfSelected(data);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "AI retry failed";
      setError(msg);
    } finally {
      setRetryInFlight(false);
    }
  }

  function cancelAIRetry() {
    setAwaitingAIRetry(false);
    pendingRetryRef.current = null;
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
    setSavedToLibrary(false);
    setAwaitingAIRetry(false);
    setRetryInFlight(false);
    pendingRetryRef.current = null;
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
              {properties.length > 0 && (
                <div>
                  <label className="block text-xs font-semibold text-gray-600 uppercase tracking-wide mb-1.5">
                    Property (optional)
                  </label>
                  <select
                    className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-navy-500 focus:ring-1 focus:ring-navy-500 disabled:opacity-50"
                    value={selectedPropertyId}
                    onChange={(e) => setSelectedPropertyId(e.target.value)}
                    disabled={status === "processing"}
                  >
                    <option value="">— Save to property library —</option>
                    {properties.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  {savedToLibrary && (
                    <p className="text-xs text-green-600 font-medium mt-1">✓ Saved to library</p>
                  )}
                </div>
              )}
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
              Parsing comp data from PDF — usually completes in under 10 seconds.
            </p>
          </div>
        )}

        {/* AI retry prompt */}
        {awaitingAIRetry && (
          <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm font-semibold text-amber-800">No comps detected with the fast parser</p>
            <p className="text-sm text-amber-700 mt-1">
              The regex parser couldn&apos;t find any comp data. Retry using AI extraction?
              This takes 30–60 seconds and uses Claude to read the report.
            </p>
            <div className="flex gap-2 mt-3">
              <button
                onClick={retryWithAI}
                disabled={retryInFlight}
                className="btn-primary text-sm px-4 py-2"
              >
                {retryInFlight ? "Running AI extraction…" : "Retry with AI"}
              </button>
              <button
                onClick={cancelAIRetry}
                disabled={retryInFlight}
                className="text-sm px-4 py-2 text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </div>
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

// useSearchParams requires a Suspense boundary in Next.js 14 static builds
export default function RentCompsPageWrapper() {
  return (
    <Suspense>
      <RentCompsPage />
    </Suspense>
  );
}
