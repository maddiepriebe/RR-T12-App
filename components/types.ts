import type { RentRollData } from "@/lib/schemas";
import type { ParsedRentRoll } from "@/lib/yardi-parser";
import type { RentRollFormat } from "@/lib/rent-roll-service";

// ── Step output types ─────────────────────────────────────────────────────────

export interface FloorPlan {
  planCode: string;
  unitType: "Residential" | "Commercial" | "Other";
  unitCount: number;
  netSF: number | null;        // derived from source; read-only in the step
  marketRent: number | null;   // derived from source; read-only in the step
  floorPlanName: string;       // editable, defaults to planCode
  bedrooms: number | null;     // required — validates before Next
  baths: number | null;        // optional
}

export type OccupancyStatus =
  | "Occupied"
  | "Vacant"
  | "Model"
  | "Notice - Rented"
  | "Notice - Unrented"
  | "Down / Offline";

export const OCCUPANCY_STATUSES: OccupancyStatus[] = [
  "Occupied",
  "Vacant",
  "Model",
  "Notice - Rented",
  "Notice - Unrented",
  "Down / Offline",
];

export interface OccupancyMapping {
  occCode: string;               // raw value from the rent roll; read-only
  unitCount: number;             // read-only
  totalCharges: number;          // read-only
  status: OccupancyStatus | null; // required — validates before Next
}
export type ChargeCategory =
  | "Contractual Rent"
  | "HAR (Housing Authority Rent)"
  | "Other Income"
  | "Concession"
  | "Ignore / Exclude";

export const CHARGE_CATEGORIES: ChargeCategory[] = [
  "Contractual Rent",
  "HAR (Housing Authority Rent)",
  "Other Income",
  "Concession",
  "Ignore / Exclude",
];

export interface ChargeMapping {
  chargeCode: string;              // raw value from the rent roll; read-only
  totalAmount: number;             // read-only; may be negative (concessions)
  category: ChargeCategory | null; // required — validates before Download
}

// ── Wizard root state ─────────────────────────────────────────────────────────
export interface WizardState {
  /** Full parsed result from processRentRoll(). Null before any file is uploaded. */
  rawRentRoll: ParsedRentRoll | RentRollData | null;
  format: RentRollFormat | null;
  floorPlans: FloorPlan[];
  occupancyMappings: OccupancyMapping[];
  chargeMappings: ChargeMapping[];
}

export const INITIAL_WIZARD_STATE: WizardState = {
  rawRentRoll: null,
  format: null,
  floorPlans: [],
  occupancyMappings: [],
  chargeMappings: [],
};

// ── Navigation ────────────────────────────────────────────────────────────────
export type WizardPhase = "upload" | "floorplans" | "occupancy" | "charges";

export const WIZARD_STEPS = [
  { phase: "floorplans" as WizardPhase, label: "Floorplans" },
  { phase: "occupancy" as WizardPhase, label: "Occupancy" },
  { phase: "charges" as WizardPhase, label: "Charges" },
];

/** Returns 0-based index of the given phase within WIZARD_STEPS, or -1 for "upload". */
export function stepIndex(phase: WizardPhase): number {
  return WIZARD_STEPS.findIndex((s) => s.phase === phase);
}

/** Returns the phase that follows the given phase, or null if already last. */
export function nextPhase(phase: WizardPhase): WizardPhase | null {
  const idx = stepIndex(phase);
  return idx >= 0 && idx < WIZARD_STEPS.length - 1 ? WIZARD_STEPS[idx + 1].phase : null;
}

/** Returns the phase that precedes the given phase, or null if already first. */
export function prevPhase(phase: WizardPhase): WizardPhase | null {
  const idx = stepIndex(phase);
  return idx > 0 ? WIZARD_STEPS[idx - 1].phase : null;
}
