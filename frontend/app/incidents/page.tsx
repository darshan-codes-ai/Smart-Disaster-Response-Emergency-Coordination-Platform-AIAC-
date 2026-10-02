"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Incident } from "../../components/disaster-map";
import { useCurrentUser } from "../../lib/supabase/use-current-user";
import Navbar from "../../components/navbar";
import StatusBadge from "../../components/status-badge";
import SeverityBadge from "../../components/severity-badge";

const DisasterMap = dynamic(() => import("../../components/disaster-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] sm:h-[480px] lg:h-[540px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#0c1220] text-slate-400 shadow-2xl">
      <div className="h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mb-3"></div>
      <p className="text-sm font-semibold text-slate-200">Loading Geospatial Engine...</p>
      <p className="text-xs text-slate-500 mt-1">Initializing MapLibre GL telemetry layer</p>
    </div>
  ),
});

function getTypeIcon(type: string): string {
  const t = (type || "").toLowerCase();
  if (t.includes("flood") || t.includes("water")) return "🌊";
  if (t.includes("fire")) return "🔥";
  if (t.includes("earthquake")) return "🏚️";
  if (t.includes("cyclone") || t.includes("storm") || t.includes("hurricane")) return "🌀";
  if (t.includes("medical") || t.includes("health")) return "🚑";
  if (t.includes("collapse") || t.includes("building")) return "🏢";
  if (t.includes("accident") || t.includes("crash")) return "🚗";
  return "⚠️";
}

export default function IncidentsPage() {
  const { isCommandCenter, isResponder } = useCurrentUser();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [mapRefreshTrigger, setMapRefreshTrigger] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [hasLoaded, setHasLoaded] = useState(false);

  const handleIncidentsLoaded = useCallback((incs: Incident[]) => {
    setIncidents(incs);
    setHasLoaded(true);
  }, []);

  const refreshMap = useCallback(() => {
    setMapRefreshTrigger((n) => n + 1);
  }, []);

  // Compute metrics
  const stats = useMemo(() => {
    let total = 0;
    let critical = 0;
    let high = 0;
    let active = 0;
    let resolved = 0;

    incidents.forEach((inc) => {
      total += 1;
      const sev = typeof inc.severity === "number" ? inc.severity : 0;
      if (sev >= 4) critical += 1;
      else if (sev === 3) high += 1;

      const st = (inc.status || "reported").toLowerCase();
      if (st === "resolved") resolved += 1;
      else if (st !== "cancelled") active += 1;
    });

    return { total, critical, high, active, resolved };
  }, [incidents]);

  // Filtered incidents
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      // Status filter
      if (statusFilter !== "all") {
        const incStatus = (inc.status || "reported").toLowerCase();
        if (incStatus !== statusFilter) return false;
      }

      // Severity filter
      const sev = typeof inc.severity === "number" ? inc.severity : 1;
      if (severityFilter === "critical" && sev < 4) return false;
      if (severityFilter === "high" && sev !== 3) return false;
      if (severityFilter === "medium" && sev !== 2) return false;
      if (severityFilter === "low" && sev !== 1) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesType = (inc.type || "").toLowerCase().includes(q);
        const matchesDesc = (inc.description || "").toLowerCase().includes(q);
        const matchesId = (inc.id || "").toLowerCase().includes(q);
        const matchesNote = (inc.note || "").toLowerCase().includes(q);
        if (!matchesType && !matchesDesc && !matchesId && !matchesNote) {
          return false;
        }
      }

      return true;
    });
  }, [incidents, statusFilter, severityFilter, searchQuery]);

  const selectedIncident = useMemo(() => {
    return incidents.find((i) => i.id === selectedIncidentId) || null;
  }, [incidents, selectedIncidentId]);

  return (
    <main className="min-h-screen bg-[#070b14] text-white flex flex-col">
      <Navbar
        currentSection="Incident Directory"
        actionButton={
          <button
            onClick={refreshMap}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-xs font-semibold text-sky-300 transition"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Sync Live Feed</span>
          </button>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 w-full flex-1 flex flex-col gap-6">
        {/* KPI SUMMARY CARDS */}
        <section className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#0e1424] p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Recorded</span>
            <p className="mt-1 text-2xl font-extrabold text-white">{stats.total}</p>
            <span className="text-[10px] text-slate-500">Live incidents on grid</span>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">Active Operations</span>
            <p className="mt-1 text-2xl font-extrabold text-amber-300">{stats.active}</p>
            <span className="text-[10px] text-amber-400/60">Triage &amp; field action</span>
          </div>

          <div className="rounded-xl border border-red-500/20 bg-red-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">Critical Severity</span>
            <p className="mt-1 text-2xl font-extrabold text-red-300">{stats.critical}</p>
            <span className="text-[10px] text-red-400/60">Severity level 4 - 5</span>
          </div>

          <div className="rounded-xl border border-orange-500/20 bg-orange-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider">High Severity</span>
            <p className="mt-1 text-2xl font-extrabold text-orange-300">{stats.high}</p>
            <span className="text-[10px] text-orange-400/60">Severity level 3</span>
          </div>

          <div className="hidden lg:block rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">Resolved</span>
            <p className="mt-1 text-2xl font-extrabold text-emerald-300">{stats.resolved}</p>
            <span className="text-[10px] text-emerald-400/60">Cleared emergencies</span>
          </div>
        </section>

        {/* SEARCH & FILTERS BAR */}
        <section className="rounded-xl border border-white/10 bg-[#0e1424] p-3.5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-md">
          {/* Status Tabs */}
          <div className="flex flex-wrap items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            <span className="text-xs font-semibold text-slate-400 mr-1.5">Status:</span>
            {[
              { id: "all", label: "All" },
              { id: "reported", label: "Reported" },
              { id: "verified", label: "Verified" },
              { id: "assigned", label: "Assigned" },
              { id: "in_progress", label: "In Progress" },
              { id: "resolved", label: "Resolved" },
            ].map((st) => (
              <button
                key={st.id}
                onClick={() => setStatusFilter(st.id)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  statusFilter === st.id
                    ? "bg-sky-600 text-white shadow-md shadow-sky-900/40"
                    : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {st.label}
              </button>
            ))}
          </div>

          {/* Right Filters */}
          <div className="flex items-center gap-2">
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#070b14] px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical (4-5)</option>
              <option value="high">High (3)</option>
              <option value="medium">Medium (2)</option>
              <option value="low">Low (1)</option>
            </select>

            <div className="relative flex-1 sm:w-64">
              <input
                type="text"
                placeholder="Search emergency feed..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#070b14] pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500"
              />
              <svg className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </section>

        {/* MAIN TWO-COLUMN WORKSPACE: MAP (LEFT) & FEED (RIGHT) */}
        <section className="grid gap-6 lg:grid-cols-3 flex-1 items-start">
          {/* MAP COLUMN */}
          <div className="lg:col-span-2 flex flex-col rounded-2xl border border-white/10 bg-[#0e1424] overflow-hidden shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-[#0a0f1d]">
              <div className="flex items-center gap-2.5">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></div>
                <h2 className="text-sm font-bold text-white tracking-wide">Live Geospatial Response Map</h2>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-400">
                <span>Displaying {filteredIncidents.length} pinned incidents</span>
              </div>
            </div>

            <div className="relative">
              <DisasterMap
                selectedIncidentId={selectedIncidentId}
                onIncidentSelect={(inc) => setSelectedIncidentId(inc ? inc.id : null)}
                onIncidentsLoaded={handleIncidentsLoaded}
                refreshTrigger={mapRefreshTrigger}
              />
            </div>
          </div>

          {/* INCIDENT FEED COLUMN */}
          <div className="flex flex-col rounded-2xl border border-white/10 bg-[#0e1424] overflow-hidden shadow-xl h-[620px]">
            <div className="border-b border-white/10 px-5 py-3.5 bg-[#0a0f1d] flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-white">Emergency Feed</h3>
                <p className="text-[11px] text-slate-400">
                  {filteredIncidents.length} incidents matching current filter
                </p>
              </div>
              {(isCommandCenter || isResponder) && (
                <div className="flex items-center gap-1.5">
                  {isCommandCenter && (
                    <Link
                      href="/command"
                      className="rounded-lg bg-sky-500/15 border border-sky-500/30 px-2 py-1 text-[11px] font-semibold text-sky-300 hover:bg-sky-500/25 transition"
                    >
                      Command HQ →
                    </Link>
                  )}
                  {isResponder && (
                    <Link
                      href="/responder"
                      className="rounded-lg bg-orange-500/15 border border-orange-500/30 px-2 py-1 text-[11px] font-semibold text-orange-300 hover:bg-orange-500/25 transition"
                    >
                      Field Unit →
                    </Link>
                  )}
                </div>
              )}
            </div>

            <div className="flex-1 space-y-2.5 overflow-y-auto p-3.5">
              {!hasLoaded ? (
                // SKELETON LOADERS
                <div className="space-y-3 p-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div key={i} className="animate-pulse rounded-xl border border-white/5 bg-white/[0.02] p-4 space-y-2.5">
                      <div className="flex items-center justify-between">
                        <div className="h-4 w-28 bg-white/10 rounded"></div>
                        <div className="h-4 w-16 bg-white/10 rounded-full"></div>
                      </div>
                      <div className="h-3 w-full bg-white/5 rounded"></div>
                      <div className="h-3 w-2/3 bg-white/5 rounded"></div>
                    </div>
                  ))}
                </div>
              ) : filteredIncidents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500 px-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl mb-3">
                    🛰️
                  </div>
                  <p className="font-semibold text-slate-300 text-sm">No Incidents in this View</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-[220px]">
                    No emergency records match your current filter settings.
                  </p>
                  <button
                    onClick={() => {
                      setStatusFilter("all");
                      setSeverityFilter("all");
                      setSearchQuery("");
                    }}
                    className="mt-4 text-xs font-semibold text-sky-400 hover:text-sky-300 underline"
                  >
                    Clear all filters
                  </button>
                </div>
              ) : (
                filteredIncidents.map((inc) => {
                  const isSelected = selectedIncidentId === inc.id;

                  return (
                    <button
                      key={inc.id}
                      type="button"
                      onClick={() =>
                        setSelectedIncidentId((prev) => (prev === inc.id ? null : inc.id))
                      }
                      className={`w-full rounded-xl border p-3.5 text-left transition ${
                        isSelected
                          ? "border-sky-500/80 bg-sky-950/30 ring-2 ring-sky-500/40 shadow-lg"
                          : "border-white/5 bg-white/[0.02] hover:border-white/15 hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{getTypeIcon(inc.type)}</span>
                          <div>
                            <span className="text-xs font-bold text-white capitalize block leading-tight">
                              {inc.type}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              ID: {inc.id.slice(0, 8)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <SeverityBadge severity={inc.severity} size="sm" />
                          <StatusBadge status={inc.status} size="sm" showIcon={false} />
                        </div>
                      </div>

                      <p className="mt-2 text-xs text-slate-300 line-clamp-2 leading-relaxed">
                        {inc.description || "No description provided."}
                      </p>

                      <div className="mt-2.5 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-slate-400">
                        <span className="font-mono flex items-center gap-1">
                          <span>📍</span>
                          <span>
                            {typeof inc.latitude === "number" && typeof inc.longitude === "number"
                              ? `${inc.latitude.toFixed(3)}, ${inc.longitude.toFixed(3)}`
                              : "No coordinates"}
                          </span>
                        </span>

                        <span>
                          {inc.created_at
                            ? new Date(inc.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                            : ""}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </section>
      </div>

      {/* DETAILED INSPECTION DRAWER / MODAL */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0d1424] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-white/10 pb-4">
              <div>
                <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider">
                  RescueGrid Incident Details
                </span>
                <h3 className="text-lg font-bold text-white flex items-center gap-2 mt-1 capitalize">
                  <span className="text-2xl">{getTypeIcon(selectedIncident.type)}</span>
                  <span>{selectedIncident.type}</span>
                </h3>
              </div>
              <button
                onClick={() => setSelectedIncidentId(null)}
                aria-label="Close modal"
                className="text-slate-400 hover:text-white text-2xl px-2 rounded-lg hover:bg-white/5"
              >
                ×
              </button>
            </div>

            <div className="flex items-center gap-2">
              <StatusBadge status={selectedIncident.status} size="md" />
              <SeverityBadge severity={selectedIncident.severity} size="md" showScore />
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Description</span>
              <p className="text-xs text-slate-200 bg-white/5 p-3 rounded-xl border border-white/5 leading-relaxed">
                {selectedIncident.description || "No situation description recorded."}
              </p>
            </div>

            {selectedIncident.note && (
              <div className="space-y-1">
                <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Operational Notes</span>
                <p className="text-xs text-amber-200/90 bg-amber-950/20 p-3 rounded-xl border border-amber-500/20 leading-relaxed italic">
                  &ldquo;{selectedIncident.note}&rdquo;
                </p>
              </div>
            )}

            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Location &amp; Telemetry</span>
              <div className="bg-white/5 p-3 rounded-xl border border-white/5 text-[11px] font-mono text-slate-300 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Incident ID:</span>
                  <span className="text-white">{selectedIncident.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Coordinates:</span>
                  <span className="text-white">{selectedIncident.latitude.toFixed(5)}, {selectedIncident.longitude.toFixed(5)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Reported At:</span>
                  <span className="text-white">
                    {selectedIncident.created_at ? new Date(selectedIncident.created_at).toLocaleString() : "Unknown"}
                  </span>
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4 flex items-center justify-between">
              <div>
                {isCommandCenter && (
                  <Link
                    href="/command"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-400 hover:text-sky-300"
                  >
                    Open in Command Center →
                  </Link>
                )}
                {!isCommandCenter && isResponder && (
                  <Link
                    href="/responder"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-orange-400 hover:text-orange-300"
                  >
                    Open in Responder Console →
                  </Link>
                )}
              </div>

              <button
                onClick={() => setSelectedIncidentId(null)}
                className="rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-slate-200 hover:bg-white/20 transition"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
