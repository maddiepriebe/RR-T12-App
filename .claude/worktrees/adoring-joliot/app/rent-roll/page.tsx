"use client";

import { useState } from "react";
import NavBar from "@/components/shared/NavBar";
import RentRollWizard from "@/components/rent-roll-wizard/RentRollWizard";

export default function RentRollPage() {
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-navy-900">Rent Roll</h1>
          <p className="text-gray-500 mt-1 text-sm">
            Yardi reports are parsed directly. All other formats are mapped with AI.
            Output matches the redIQ standardized structure.
          </p>
        </div>

        <div className="card">
          <p className="section-header">Import Rent Roll</p>
          <p className="text-sm text-gray-500 mb-5">
            Walk through three steps to review floorplans, occupancy, and charges before
            downloading the standardized redIQ Excel file.
          </p>
          <button
            type="button"
            onClick={() => setWizardOpen(true)}
            className="btn-primary"
          >
            Start Import
          </button>
        </div>
      </main>

      {wizardOpen && <RentRollWizard onClose={() => setWizardOpen(false)} />}
    </div>
  );
}
