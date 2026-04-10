"use client";

import { WIZARD_STEPS, type WizardPhase } from "./types";

interface WizardStepperProps {
  currentPhase: WizardPhase;
  /** Set of phases the user is allowed to navigate back to. */
  completedPhases: Set<WizardPhase>;
  onStepClick: (phase: WizardPhase) => void;
}

export default function WizardStepper({
  currentPhase,
  completedPhases,
  onStepClick,
}: WizardStepperProps) {
  const currentIdx = WIZARD_STEPS.findIndex((s) => s.phase === currentPhase);

  return (
    <nav aria-label="Wizard steps" className="flex items-center gap-0">
      {WIZARD_STEPS.map((step, idx) => {
        const isActive = step.phase === currentPhase;
        const isCompleted = completedPhases.has(step.phase);
        const isFuture = !isActive && !isCompleted;
        const isClickable = isCompleted;

        return (
          <div key={step.phase} className="flex items-center flex-1 min-w-0">
            {/* Step node */}
            <button
              type="button"
              disabled={!isClickable}
              onClick={() => isClickable && onStepClick(step.phase)}
              className={`flex flex-col items-center gap-1.5 flex-1 min-w-0 py-1 transition-opacity
                ${isClickable ? "cursor-pointer hover:opacity-80" : "cursor-default"}
                ${isFuture ? "opacity-40" : ""}`}
            >
              {/* Circle */}
              <div
                className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 transition-colors
                  ${isActive ? "bg-navy-700 text-white ring-2 ring-navy-700 ring-offset-2" : ""}
                  ${isCompleted ? "bg-green-500 text-white" : ""}
                  ${isFuture ? "bg-gray-200 text-gray-400" : ""}`}
              >
                {isCompleted ? (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  idx + 1
                )}
              </div>

              {/* Label */}
              <span
                className={`text-xs font-medium leading-none whitespace-nowrap
                  ${isActive ? "text-navy-800" : ""}
                  ${isCompleted ? "text-gray-500" : ""}
                  ${isFuture ? "text-gray-400" : ""}`}
              >
                {step.label}
              </span>
            </button>

            {/* Connector line (not after last step) */}
            {idx < WIZARD_STEPS.length - 1 && (
              <div
                className={`h-px flex-1 max-w-12 mx-1 flex-shrink-0 transition-colors
                  ${idx < currentIdx ? "bg-green-400" : "bg-gray-200"}`}
              />
            )}
          </div>
        );
      })}
    </nav>
  );
}
