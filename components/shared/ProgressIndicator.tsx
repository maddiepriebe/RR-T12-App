"use client";

interface Step {
  label: string;
  status: "pending" | "active" | "done" | "error";
}

interface ProgressIndicatorProps {
  steps: Step[];
}

export default function ProgressIndicator({ steps }: ProgressIndicatorProps) {
  return (
    <div className="flex flex-col gap-2">
      {steps.map((step, idx) => (
        <div key={idx} className="flex items-center gap-3">
          <div
            className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold transition-all ${
              step.status === "done"
                ? "bg-green-500 text-white"
                : step.status === "active"
                ? "bg-gold-500 text-navy-950 animate-pulse"
                : step.status === "error"
                ? "bg-red-500 text-white"
                : "bg-gray-200 text-gray-400"
            }`}
          >
            {step.status === "done" ? (
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
              </svg>
            ) : step.status === "error" ? (
              "!"
            ) : step.status === "active" ? (
              <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              idx + 1
            )}
          </div>
          <span
            className={`text-sm ${
              step.status === "active"
                ? "text-navy-800 font-semibold"
                : step.status === "done"
                ? "text-gray-500 line-through"
                : step.status === "error"
                ? "text-red-600 font-medium"
                : "text-gray-400"
            }`}
          >
            {step.label}
          </span>
        </div>
      ))}
    </div>
  );
}
