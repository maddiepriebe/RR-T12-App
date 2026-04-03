"use client";

import { useState, useEffect } from "react";
import NavBar from "@/components/shared/NavBar";
import Link from "next/link";

interface Property {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  units: number | null;
  createdAt: string;
}

export default function PropertiesPage() {
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedState, setSelectedState] = useState<string | null>(null);
  const [showNewModal, setShowNewModal] = useState(false);
  const [form, setForm] = useState({ name: "", address: "", city: "", state: "", zip: "", units: "" });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetchProperties();
  }, []);

  async function fetchProperties() {
    setLoading(true);
    const res = await fetch("/api/properties");
    if (res.ok) {
      const data = await res.json();
      setProperties(data);
    }
    setLoading(false);
  }

  async function createProperty() {
    setSaving(true);
    const res = await fetch("/api/properties", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, units: form.units ? Number(form.units) : null }),
    });
    if (res.ok) {
      setShowNewModal(false);
      setForm({ name: "", address: "", city: "", state: "", zip: "", units: "" });
      fetchProperties();
    }
    setSaving(false);
  }

  // Group by state for sidebar
  const stateGroups = properties.reduce<Record<string, Property[]>>((acc, p) => {
    const s = p.state || "Other";
    if (!acc[s]) acc[s] = [];
    acc[s].push(p);
    return acc;
  }, {});
  const sortedStates = Object.keys(stateGroups).sort();

  const filtered = selectedState
    ? properties.filter((p) => (p.state || "Other") === selectedState)
    : properties;

  return (
    <div className="min-h-screen bg-gray-50">
      <NavBar />
      <div className="flex">
        {/* Sidebar */}
        <aside className="w-64 min-h-[calc(100vh-64px)] bg-white border-r border-gray-200 p-4 flex-shrink-0">
          <p className="text-xs font-bold uppercase tracking-widest text-navy-600 mb-3">Portfolio</p>
          <button
            onClick={() => setSelectedState(null)}
            className={`w-full text-left px-3 py-2 rounded-md text-sm font-medium mb-1 transition-colors ${
              !selectedState ? "bg-navy-700 text-white" : "text-gray-600 hover:bg-gray-100"
            }`}
          >
            All Properties ({properties.length})
          </button>
          <div className="mt-2 space-y-0.5">
            {sortedStates.map((state) => (
              <button
                key={state}
                onClick={() => setSelectedState(state)}
                className={`w-full text-left px-3 py-1.5 rounded-md text-sm transition-colors flex items-center justify-between ${
                  selectedState === state
                    ? "bg-gold-500 text-navy-950 font-semibold"
                    : "text-gray-600 hover:bg-gray-100"
                }`}
              >
                <span>{state}</span>
                <span className="text-xs opacity-60">{stateGroups[state].length}</span>
              </button>
            ))}
          </div>
        </aside>

        {/* Main */}
        <main className="flex-1 p-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-navy-900">Property Library</h1>
              <p className="text-gray-500 text-sm mt-0.5">
                {selectedState ? `${selectedState} — ${filtered.length} properties` : `${properties.length} properties`}
              </p>
            </div>
            <button onClick={() => setShowNewModal(true)} className="btn-primary">
              + New Property
            </button>
          </div>

          {loading ? (
            <div className="text-center py-16 text-gray-400">Loading...</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-gray-400 text-sm">No properties yet.</p>
              <button onClick={() => setShowNewModal(true)} className="mt-3 btn-primary">
                Add your first property
              </button>
            </div>
          ) : (
            <div className="card p-0 overflow-hidden">
              <table className="finance-table">
                <thead>
                  <tr>
                    <th>Property</th>
                    <th>Location</th>
                    <th className="text-right">Units</th>
                    <th>Added</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((p) => (
                    <tr key={p.id} className="hover:bg-blue-50 cursor-pointer transition-colors">
                      <td className="font-semibold text-navy-800">{p.name}</td>
                      <td className="text-gray-500 text-xs">
                        {[p.city, p.state].filter(Boolean).join(", ")}
                        {p.zip && ` ${p.zip}`}
                      </td>
                      <td className="text-right">{p.units?.toLocaleString() ?? "—"}</td>
                      <td className="text-gray-400 text-xs">
                        {new Date(p.createdAt).toLocaleDateString()}
                      </td>
                      <td className="text-right">
                        <Link
                          href={`/properties/${p.id}`}
                          className="text-xs font-semibold text-navy-700 hover:text-gold-500 transition-colors"
                        >
                          View →
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </main>
      </div>

      {/* New Property Modal */}
      {showNewModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <h2 className="text-lg font-bold text-navy-900 mb-4">New Property</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Property Name *</label>
                <input
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  placeholder="e.g. Elme Bethesda"
                />
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Address</label>
                <input
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
                  value={form.address}
                  onChange={(e) => setForm({ ...form, address: e.target.value })}
                  placeholder="123 Main St"
                />
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div className="col-span-1">
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">City</label>
                  <input
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
                    value={form.city}
                    onChange={(e) => setForm({ ...form, city: e.target.value })}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">State</label>
                  <input
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
                    value={form.state}
                    onChange={(e) => setForm({ ...form, state: e.target.value })}
                    placeholder="MD"
                    maxLength={2}
                  />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Zip</label>
                  <input
                    className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
                    value={form.zip}
                    onChange={(e) => setForm({ ...form, zip: e.target.value })}
                  />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 uppercase tracking-wide">Units</label>
                <input
                  type="number"
                  className="w-full mt-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-navy-700"
                  value={form.units}
                  onChange={(e) => setForm({ ...form, units: e.target.value })}
                  placeholder="193"
                />
              </div>
            </div>
            <div className="flex gap-3 mt-6">
              <button onClick={createProperty} disabled={!form.name || saving} className="btn-primary flex-1">
                {saving ? "Saving..." : "Create Property"}
              </button>
              <button onClick={() => setShowNewModal(false)} className="btn-outline flex-1">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
