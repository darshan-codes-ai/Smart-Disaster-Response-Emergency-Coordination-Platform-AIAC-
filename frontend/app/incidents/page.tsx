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

function PriorityBadge({ score, tier }: { score?: number | null; tier?: string | null }) {
  const val = score ?? 0;
  const t = tier || (val >= 80 ? "CRITICAL" : val >= 60 ? "HIGH" : val >= 40 ? "MEDIUM" : "LOW");
  let cls = "bg-slate-500/15 text-slate-300 border-slate-500/30";
  if (t === "CRITICAL") cls = "bg-red-500/20 text-red-300 border-red-500/40 animate-pulse";
  else if (t === "HIGH") cls = "bg-orange-500/20 text-orange-300 border-orange-500/40";
  else if (t === "MEDIUM") cls = "bg-amber-500/20 text-amber-300 border-amber-500/40";
  else if (t === "LOW") cls = "bg-sky-500/15 text-sky-300 border-sky-500/30";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      <span className="font-mono">{val}</span>
      <span className="text-[9px] opacity-80">{t}</span>
    </span>
  );
}

export default function IncidentsPage() {
  const { isCommandCenter, isResponder } = useCurrentUser();
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [mapRefreshTrigger, setMapRefreshTrigger] = useState(0);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<string>("all");
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

      // Priority tier filter
      const pScore = inc.priority_score ?? inc.severity * 20;
      if (priorityFilter === "critical" && pScore < 80) return false;
      if (priorityFilter === "high" && (pScore < 60 || pScore >= 80)) return false;
      if (priorityFilter === "medium" && (pScore < 40 || pScore >= 60)) return false;
      if (priorityFilter === "low" && pScore >= 40) return false;

      // Assignment state filter
      if (assignmentFilter === "assigned" && !inc.assigned_to) return false;
      if (assignmentFilter === "unassigned" && !!inc.assigned_to) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesType = (inc.type || "").toLowerCase().includes(q);
        const matchesDesc = (inc.description || "").toLowerCase().includes(q);
        const matchesId = (inc.id || "").toLowerCase().includes(q);
        const matchesNote = (inc.note || "").toLowerCase().includes(q);
        const matchesResp = (inc.assigned_responder_name || "").toLowerCase().includes(q);
        if (!matchesType && !matchesDesc && !matchesId && !matchesNote && !matchesResp) {
          return false;
        }
      }

      return true;
    });
  }, [incidents, statusFilter, severityFilter, priorityFilter, assignmentFilter, searchQuery]);

  // Find currently inspected incident
  const selectedIncident = useMemo(() => {
    if (!selectedIncidentId) return null;
    return incidents.find((i) => i.id === selectedIncidentId) || null;
  }, [incidents, selectedIncidentId]);

  return (
    <main className="min-h-screen bg-[#070b14] text-white flex flex-col">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 w-full flex-1 flex flex-col gap-6">
        {/* PAGE HEADER */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400"></span>
              <h1 className="text-xl font-bold tracking-tight text-white">Live Incident Directory</h1>
              <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
                Public Transparency Feed
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Real-time situational awareness, smart triage telemetry, and verified disaster response coordination.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refreshMap}
              className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 transition flex items-center gap-1.5"
            >
              <span>↻ Sync Map</span>
            </button>
            <Link
              href="/"
              className="rounded-xl bg-sky-600 hover:bg-sky-500 text-white px-3.5 py-1.5 text-xs font-bold transition shadow-md shadow-sky-950/50"
            >
              + Report Emergency
            </Link>
          </div>
        </section>

        {/* METRICS ROW */}
        <section className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#0e1424] p-3.5 shadow-sm">
            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Total Synced</span>
            <p className="mt-1 text-2xl font-extrabold text-white">{stats.total}</p>
            <span className="text-[10px] text-slate-500">Live incidents</span>
          </div>

          <div className="rounded-xl border border-red-500/20 bg-red-950/20 p-3.5 shadow-sm">
            <span className="text-[10px] font-bold text-red-400 uppercase tracking-wider">Critical Priority</span>
            <p className="mt-1 text-2xl font-extrabold text-red-300">{stats.critical}</p>
            <span className="text-[10px] text-red-400/60">Urgent life threat</span>
          </div>

          <div className="rounded-xl border border-orange-500/20 bg-orange-950/20 p-3.5 shadow-sm">
            <span className="text-[10px] font-bold text-orange-400 uppercase tracking-wider">High Urgency</span>
            <p className="mt-1 text-2xl font-extrabold text-orange-300">{stats.high}</p>
            <span className="text-[10px] text-orange-400/60">Severe hazard</span>
          </div>

          <div className="rounded-xl border border-sky-500/20 bg-sky-950/20 p-3.5 shadow-sm">
            <span className="text-[10px] font-bold text-sky-400 uppercase tracking-wider">Active Response</span>
            <p className="mt-1 text-2xl font-extrabold text-sky-300">{stats.active}</p>
            <span className="text-[10px] text-sky-400/60">In progress / triage</span>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-3.5 shadow-sm col-span-2 sm:col-span-1">
            <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">Resolved</span>
            <p className="mt-1 text-2xl font-extrabold text-emerald-300">{stats.resolved}</p>
            <span className="text-[10px] text-emerald-400/60">Cleared emergencies</span>
          </div>
        </section>

        {/* SEARCH & FILTERS BAR */}
        <section className="rounded-xl border border-white/10 bg-[#0e1424] p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-md">
          {/* SEARCH INPUT */}
          <div className="relative flex-1 max-w-md">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by disaster type, location, note, or ID..."
              className="w-full rounded-xl border border-white/10 bg-[#070b14] px-4 py-2 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500 transition"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-2 text-slate-500 hover:text-white text-xs font-bold"
              >
                ×
              </button>
            )}
          </div>

          {/* FILTER PILLS */}
          <div className="flex flex-wrap items-center gap-2">
            {/* STATUS FILTER */}
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#070b14] px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500"
            >
              <option value="all">Status: All</option>
              <option value="reported">Status: Reported</option>
              <option value="verified">Status: Verified</option>
              <option value="assigned">Status: Assigned</option>
              <option value="in_progress">Status: In Progress</option>
              <option value="resolved">Status: Resolved</option>
              <option value="cancelled">Status: Cancelled</option>
            </select>

            {/* SEVERITY FILTER */}
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#070b14] px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500"
            >
              <option value="all">Severity: All</option>
              <option value="critical">Severity: Critical (4-5)</option>
              <option value="high">Severity: High (3)</option>
              <option value="medium">Severity: Medium (2)</option>
              <option value="low">Severity: Low (1)</option>
            </select>

            {/* PRIORITY FILTER */}
            <select
              value={priorityFilter}
              onChange={(e) => setPriorityFilter(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#070b14] px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500"
            >
              <option value="all">Priority: All</option>
              <option value="critical">Priority: Critical (80-100)</option>
              <option value="high">Priority: High (60-79)</option>
              <option value="medium">Priority: Medium (40-59)</option>
              <option value="low">Priority: Low (&lt;40)</option>
            </select>

            {/* ASSIGNMENT FILTER */}
            <select
              value={assignmentFilter}
              onChange={(e) => setAssignmentFilter(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#070b14] px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-sky-500"
            >
              <option value="all">Dispatch: All</option>
              <option value="assigned">Dispatched Units</option>
              <option value="unassigned">Awaiting Dispatch</option>
            </select>

            {(statusFilter !== "all" || severityFilter !== "all" || priorityFilter !== "all" || assignmentFilter !== "all" || searchQuery) && (
              <button
                onClick={() => {
                  setStatusFilter("all");
                  setSeverityFilter("all");
                  setPriorityFilter("all");
                  setAssignmentFilter("all");
                  setSearchQuery("");
                }}
                className="text-xs text-sky-400 hover:text-sky-300 font-semibold px-2 py-1"
              >
                Reset
              </button>
            )}
          </div>
        </section>

        {/* 2-COLUMN VIEW: MAP (LEFT) & FEED (RIGHT) */}
        <section className="grid gap-6 lg:grid-cols-3 items-start">
          {/* MAP COLUMN */}
          <div className="lg:col-span-2 flex flex-col rounded-2xl border border-white/10 bg-[#0e1424] overflow-hidden shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-[#0a0f1d]">
              <div className="flex items-center gap-2.5">
                <div className="h-2 w-2 rounded-full bg-sky-400 animate-pulse"></div>
                <h2 className="text-sm font-bold text-white tracking-wide">Geospatial Telemetry Map</h2>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {incidents.length} active nodes
              </span>
            </div>

            <div className="relative">
              <DisasterMap
                selectedIncidentId={selectedIncidentId}
                onIncidentSelect={(inc) => setSelectedIncidentId(inc?.id || null)}
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
                      setPriorityFilter("all");
                      setAssignmentFilter("all");
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

                        <div className="flex flex-col items-end gap-1">
                          <PriorityBadge score={inc.priority_score} tier={inc.priority_tier} />
                          <div className="flex items-center gap-1">
                            <SeverityBadge severity={inc.severity} size="sm" />
                            <StatusBadge status={inc.status} size="sm" showIcon={false} />
                          </div>
                        </div>
                      </div>

                      {/* Assignment Pill */}
                      {inc.assigned_to ? (
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-purple-300 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded-md w-fit font-medium">
                          <span>👤 Dispatched: {inc.assigned_responder_name || "Assigned Unit"}</span>
                        </div>
                      ) : (
                        <div className="mt-2 flex items-center gap-1 text-[10px] text-amber-400/80 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-md w-fit font-medium">
                          <span>Awaiting Dispatch</span>
                        </div>
                      )}

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

            {/* STATUS, SEVERITY & PRIORITY */}
            <div className="grid grid-cols-3 gap-2.5">
              <div className="bg-white/5 p-2.5 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Status</span>
                <StatusBadge status={selectedIncident.status} size="sm" />
              </div>
              <div className="bg-white/5 p-2.5 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Severity</span>
                <SeverityBadge severity={selectedIncident.severity} size="sm" showScore />
              </div>
              <div className="bg-white/5 p-2.5 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Priority</span>
                <PriorityBadge score={selectedIncident.priority_score} tier={selectedIncident.priority_tier} />
              </div>
            </div>

            {/* DISPATCH ASSIGNMENT STATE (READ-ONLY) */}
            <div className="bg-purple-950/20 p-3 rounded-xl border border-purple-500/20 text-xs flex items-center justify-between">
              <span className="text-purple-300 font-semibold text-[11px]">Dispatch Status:</span>
              {selectedIncident.assigned_to ? (
                <span className="text-purple-200 font-bold flex items-center gap-1">
                  <span>👤</span>
                  <span>{selectedIncident.assigned_responder_name || "Assigned Unit"}</span>
                </span>
              ) : (
                <span className="text-amber-400/90 font-medium">Awaiting Dispatch</span>
              )}
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
