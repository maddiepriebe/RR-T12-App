// T12 Schema
export interface T12LineItem {
  category: "income" | "expense" | "noi";
  label: string;
  actual: number | null;
  perUnit: number | null;
  pctEGI: number | null;
  isSubtotal?: boolean;
  isTotal?: boolean;
  indent?: number;
}

export interface T12Data {
  propertyName?: string;
  period?: string;
  unitCount?: number;
  lineItems: T12LineItem[];
}

// Rent Roll Schema
export interface RentRollUnit {
  unit: string | null;
  unitType: string | null;
  bed: number | null;
  bath: number | null;
  sqFt: number | null;
  tenantName: string | null;
  leaseStart: string | null;
  leaseEnd: string | null;
  marketRent: number | null;
  actualRent: number | null;
  lossToLease: number | null;
  status: "Occupied" | "Vacant" | "Notice" | null;
  moveInDate: string | null;
  notes: string | null;
}

export interface RentRollData {
  propertyName?: string;
  date?: string;
  units: RentRollUnit[];
}

// Rent Comps Schema
export interface CompSummary {
  rank: number;
  isSubject?: boolean;
  name: string;
  address: string;
  city: string;
  state: string;
  yearBuilt: number | null;
  totalUnits: number | null;
  stories: number | null;
  avgUnitSF: number | null;
  distanceToSubjectMiles: number | null;
  coStarRating: number | null;
  studioAskingRent: number | null;
  oneBedAskingRent: number | null;
  twoBedAskingRent: number | null;
  threeBedAskingRent: number | null;
  rentPerSF: number | null;
  totalVacancyPct: number | null;
  totalAvailabilityPct: number | null;
  askingRentPerUnit: number | null;
  askingRentPerSF: number | null;
  effectiveRentPerUnit: number | null;
  effectiveRentPerSF: number | null;
  concessionsPct: number | null;
  owner?: string | null;
  propertyManager?: string | null;
}

export interface UnitTypeDetail {
  bed: number;
  bath: number | null;
  avgSF: number | null;
  units: number | null;
  mixPct: number | null;
  availableUnits: number | null;
  availabilityPct: number | null;
  askingRentPerUnit: number | null;
  askingRentPerSF: number | null;
  effectiveRentPerUnit: number | null;
  effectiveRentPerSF: number | null;
  concessionsPct: number | null;
  label?: string;
}

export interface CompDetail {
  propertyName: string;
  isSubject?: boolean;
  unitTypes: UnitTypeDetail[];
  amenities?: Record<string, string>;
  parking?: string | null;
  petPolicy?: string | null;
  yearBuilt?: number | null;
  address?: string;
}

export interface RentCompsData {
  subjectProperty: CompDetail | null;
  comps: CompSummary[];
  compDetails: CompDetail[];
  reportDate?: string;
}
