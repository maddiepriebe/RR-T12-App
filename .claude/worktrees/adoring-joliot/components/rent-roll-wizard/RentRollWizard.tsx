"use client";

import { useState, useEffect } from "react";
import { processRentRoll, downloadRentRoll } from "@/lib/rent-roll-service";
import {
  INITIAL_WIZARD_STATE,
  stepIndex,
  nextPhase,
  prevPhase,
  type WizardState,
  type WizardPhase,
  type FloorPlan,
  type OccupancyMapping,
  type ChargeMapping,
} from "./types";
import WizardStepper from "./WizardStepper";
import UploadStep from "./steps/UploadStep";
import FloorplansStep, { isFloorplansValid } from "./steps/FloorplansStep";
import OccupancyStep, { isOccupancyValid } from "./steps/OccupancyStep";
import ChargesStep, { isChargesValid } from "./steps/ChargesStep";

interface RentRollWizardProps {
  onClose: () => void;
}

/**
 * Returns true if the user may advance past the given phase.
 * Each step exports its own validator; stubs return true until implemented.
 */
function isPhaseValid(phase: WizardPhase, state: WizardState): boolean {
  switch (phase) {
    case "upload":
      return state.rawRentRoll !== null;
    case "floorplans":
      return isFloorplansValid(state);
    case "occupancy":
      return isOccupancyValid(state);
    case "charges":
      return isChargesValid(state);
  }
}

export default function RentRollWizard({ onClose }: RentRollWizardProps) {
  const [phase, setPhase] = useState<WizardPhase>("upload");
  const [state, setState] = useState<WizardState>(INITIAL_WIZARD_STATE);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [completing, setCompleting] = useState(false);
  const [completeError, setCompleteError] = useState<string | null>(null);
  const [completedPhases, setCompletedPhases] = useState<Set<WizardPhase>>(new Set());
  // Flipped to true the first time the user clicks Next on an invalid step.
  // Reset whenever the active phase changes so errors don't bleed across steps.
  const [showErrors, setShowErrors] = useState(false);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Reset validation error display whenever the user moves to a different step
  useEffect(() => {
    setShowErrors(false);
  }, [phase]);

  // ── File upload ──────────────────────────────────────────────────────────────
  async function handleFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const result = await processRentRoll(file);
      // Replace the entire wizard state so that any previously derived step data
      // (floor plans, etc.) is discarded when the user uploads a different file.
      setState({
        rawRentRoll: result.data,
        format: result.format,
        floorPlans: [],
        occupancyMappings: [],
        chargeMappings: [],
      });
      markCompleted("upload");
      setPhase("floorplans");
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Processing failed");
    } finally {
      setUploading(false);
    }
  }

  // ── Step navigation ──────────────────────────────────────────────────────────
  function markCompleted(p: WizardPhase) {
    setCompletedPhases((prev) => new Set([...prev, p]));
  }

  /**
   * Attempt to advance to the next step.
   * If the current step is invalid: surface validation errors and stay.
   * The Next button is NOT HTML-disabled so this handler always fires on click,
   * letting the first invalid click reveal which fields need attention.
   */
  function advance() {
    if (!isPhaseValid(phase, state)) {
      setShowErrors(true);
      return;
    }
    const next = nextPhase(phase);
    if (next) {
      markCompleted(phase);
      setPhase(next);
    }
  }

  function retreat() {
    const prev = prevPhase(phase);
    if (prev) setPhase(prev);
  }

  // ── Final step: download ─────────────────────────────────────────────────────
  async function handleComplete() {
    if (!state.rawRentRoll || !state.format) return;
    setCompleting(true);
    setCompleteError(null);
    try {
      await downloadRentRoll(state.rawRentRoll, state.format);
      onClose();
    } catch (err) {
      setCompleteError(err instanceof Error ? err.message : "Download failed");
    } finally {
      setCompleting(false);
    }
  }

  // ── Derived ──────────────────────────────────────────────────────────────────
  const isLastStep = phase === "charges";
  const valid = isPhaseValid(phase, state);
  const curStepIdx = stepIndex(phase); // -1 when "upload"

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      {/* Card */}
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh]">

        {/* ── Header ──────────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-6 pt-5 pb-4 border-b border-gray-100">
          <h2 className="text-base font-bold text-navy-900">Import Rent Roll</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Stepper (hidden on upload phase) ────────────────────────────────── */}
        {phase !== "upload" && (
          <div className="px-6 pt-4 pb-2">
            <WizardStepper
              currentPhase={phase}
              completedPhases={completedPhases}
              onStepClick={(p) => {
                if (completedPhases.has(p)) setPhase(p);
              }}
            />
          </div>
        )}

        {/* ── Step content ────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {phase === "upload" && (
            <UploadStep
              onFile={handleFile}
              loading={uploading}
              error={uploadError}
            />
          )}

          {phase === "floorplans" && (
            <FloorplansStep
              state={state}
              onChange={(floorPlans: FloorPlan[]) =>
                setState((prev) => ({ ...prev, floorPlans }))
              }
              showErrors={showErrors}
            />
          )}

          {phase === "occupancy" && (
            <OccupancyStep
              state={state}
              onChange={(occupancyMappings: OccupancyMapping[]) =>
                setState((prev) => ({ ...prev, occupancyMappings }))
              }
              showErrors={showErrors}
            />
          )}

          {phase === "charges" && (
            <ChargesStep
              state={state}
              onChange={(chargeMappings: ChargeMapping[]) =>
                setState((prev) => ({ ...prev, chargeMappings }))
              }
              showErrors={showErrors}
            />
          )}
        </div>

        {/* ── Footer (hidden on upload phase — file selection drives navigation) */}
        {phase !== "upload" && (
          <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100">

            {/* Left: Edit Source Data */}
            <button
              type="button"
              onClick={() => setPhase("upload")}
              className="text-sm text-gray-500 hover:text-navy-700 transition-colors flex items-center gap-1.5"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536M9 13l6-6m-6 6l-3 3m3-3h.01" />
              </svg>
              Edit Source Data
            </button>

            {/* Right: navigation */}
            <div className="flex items-center gap-3">
              {curStepIdx > 0 && (
                <button
                  type="button"
                  onClick={retreat}
                  className="btn-outline text-sm px-4 py-2"
                >
                  Previous
                </button>
              )}

              {isLastStep ? (
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={handleComplete}
                    disabled={completing}
                    className="btn-gold"
                  >
                    {completing ? "Downloading…" : "Download Excel"}
                  </button>
                  {completeError && (
                    <p className="text-xs text-red-600">{completeError}</p>
                  )}
                </div>
              ) : (
                // Not HTML-disabled: allows click through to advance(), which
                // sets showErrors=true when the step is invalid before returning.
                // Visual disabled state is applied via conditional classes.
                <button
                  type="button"
                  onClick={advance}
                  aria-disabled={!valid}
                  className={`btn-primary transition-opacity${!valid ? " opacity-50 cursor-not-allowed" : ""}`}
                >
                  Next
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
