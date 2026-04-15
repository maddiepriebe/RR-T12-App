"use client";

import NavBar from "@/components/shared/NavBar";
import RentRollWizard from "@/components/RentRollWizard";

export default function RentRollPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <RentRollWizard onClose={() => window.history.back()} />
    </div>
  );
}
