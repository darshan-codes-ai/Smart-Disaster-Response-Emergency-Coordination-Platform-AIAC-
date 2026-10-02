"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Incident } from "../../components/disaster-map";
import { getAccessToken, requestWithToken } from "../../lib/supabase/access-token";
import { useCurrentUser } from "../../lib/supabase/use-current-user";
import Navbar from "../../components/navbar";
import StatusBadge from "../../components/status-badge";
import SeverityBadge from "../../components/severity-badge";
import {
  ALLOWED_STATUSES,
  getStatusConfig,
  getNextRecommendedStatus,
} from "../../lib/status-workflow";

const DisasterMap = dynamic(() => import("../../components/disaster-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[360px] sm:h-[420px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#0c1220] text-slate-400 shadow-2xl">
      <div className="h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mb-3"></div>
      <p className="text-sm font-semibold text-slate-200">Loading Geospatial Engine...</p>
      <p className="text-xs text-slate-500 mt-1">Initializing MapLibre GL telemetry layer</p>
    </div>
  ),
});

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Responder {
  id: string;
  full_name: string;
  role: string;
}

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

export default function CommandCenterPage() {
  const { role, isCommandCenter, loading: userLoading } = useCurrentUser();

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assignmentFilter, setAssignmentFilter] = useState<string>("all");
  const [responderFilter, setResponderFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState("");
  const [mapRefreshTrigger, setMapRefreshTrigger] = useState(0);

  // ------------------------------------------------------------
  // FETCH INCIDENTS
  // ------------------------------------------------------------
  const fetchIncidents = useCallback(async () => {
    try {
      setLoading(true);
      setErrorMessage(null);

      const token = await getAccessToken();
      if (!token) {
        throw new Error("Your login session has expired. Please log in again.");
      }

      let res = await requestWithToken(`${API_URL}/incidents`, token);
      if (res.status === 401) {
        const freshToken = await getAccessToken(true);
        if (freshToken) {
          res = await requestWithToken(`${API_URL}/incidents`, freshToken);
        }
      }

      if (!res.ok) {
        let detail = `Error ${res.status}: Failed to fetch operational incidents`;
        try {
          const errData = await res.json();
          if (errData?.detail) detail = errData.detail;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }

      const data = await res.json();
      setIncidents(Array.isArray(data?.incidents) ? data.incidents : []);
    } catch (err) {
      console.error("Command Center fetch error:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, []);

  // ------------------------------------------------------------
  // FETCH RESPONDERS
  // ------------------------------------------------------------
  const fetchResponders = useCallback(async () => {
    try {
      const token = await getAccessToken();
      if (!token) return;

      let res = await requestWithToken(`${API_URL}/responders`, token);
      if (res.status === 401) {
        const freshToken = await getAccessToken(true);
        if (freshToken) {
          res = await requestWithToken(`${API_URL}/responders`, freshToken);
        }
      }

      if (res.ok) {
        const data = await res.json();
        setResponders(Array.isArray(data?.responders) ? data.responders : []);
      }
    } catch (err) {
      console.error("Command Center fetch responders error:", err);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    if (!userLoading && (isCommandCenter || role === "admin")) {
      Promise.resolve().then(() => {
        if (!ignore) {
          fetchIncidents();
          fetchResponders();
        }
      });
    }
    return () => {
      ignore = true;
    };
  }, [userLoading, isCommandCenter, role, fetchIncidents, fetchResponders]);

  // ------------------------------------------------------------
  // UPDATE INCIDENT (STATUS, NOTE, ASSIGNMENT)
  // ------------------------------------------------------------
  const handleUpdate = async (
    incidentId: string,
    newStatus?: string,
    newNote?: string,
    assignedTo?: string | null
  ) => {
    try {
      setActionLoadingId(incidentId);
      setErrorMessage(null);
      setSuccessMessage(null);

      const token = await getAccessToken();
      if (!token) {
        throw new Error("Your login session has expired. Please log in again.");
      }

      const bodyPayload: { status?: string; note?: string; assigned_to?: string | null } = {};
      if (newStatus !== undefined) bodyPayload.status = newStatus;
      if (newNote !== undefined) bodyPayload.note = newNote;
      if (assignedTo !== undefined) bodyPayload.assigned_to = assignedTo;

      let res = await requestWithToken(`${API_URL}/incidents/${incidentId}`, token, {
        method: "PATCH",
        body: JSON.stringify(bodyPayload),
      });

      if (res.status === 401) {
        const freshToken = await getAccessToken(true);
        if (freshToken) {
          res = await requestWithToken(`${API_URL}/incidents/${incidentId}`, freshToken, {
            method: "PATCH",
            body: JSON.stringify(bodyPayload),
          });
        }
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail || "Failed to update incident");
      }

      const updatedIncident: Incident = data.incident;
      setIncidents((prev) =>
        prev.map((inc) => (inc.id === incidentId ? updatedIncident : inc))
      );

      if (selectedIncident?.id === incidentId) {
        setSelectedIncident(updatedIncident);
      }

      let msg = `Incident updated successfully.`;
      if (assignedTo !== undefined) {
        msg = assignedTo ? `Incident dispatched to responder.` : `Incident unassigned.`;
      } else if (newStatus !== undefined) {
        msg = `Status set to "${updatedIncident.status || newStatus}".`;
      }
      setSuccessMessage(msg);
      setEditingNoteId(null);
      setNoteInput("");
      setMapRefreshTrigger((n) => n + 1);

      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Update error:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to update incident");
    } finally {
      setActionLoadingId(null);
    }
  };

  // ------------------------------------------------------------
  // FILTERED INCIDENTS & STATS
  // ------------------------------------------------------------
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      // Status filter
      if (statusFilter !== "all" && (inc.status || "reported") !== statusFilter) {
        return false;
      }

      // Severity filter
      if (severityFilter === "critical" && inc.severity < 4) return false;
      if (severityFilter === "high" && inc.severity !== 3) return false;
      if (severityFilter === "medium" && inc.severity !== 2) return false;
      if (severityFilter === "low" && inc.severity !== 1) return false;

      // Priority tier filter
      const pScore = inc.priority_score ?? inc.severity * 20;
      if (priorityFilter === "critical" && pScore < 80) return false;
      if (priorityFilter === "high" && (pScore < 60 || pScore >= 80)) return false;
      if (priorityFilter === "medium" && (pScore < 40 || pScore >= 60)) return false;
      if (priorityFilter === "low" && pScore >= 40) return false;

      // Assignment state filter
      if (assignmentFilter === "assigned" && !inc.assigned_to) return false;
      if (assignmentFilter === "unassigned" && !!inc.assigned_to) return false;

      // Specific responder filter
      if (responderFilter !== "all" && inc.assigned_to !== responderFilter) {
        return false;
      }

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
  }, [incidents, statusFilter, severityFilter, priorityFilter, assignmentFilter, responderFilter, searchQuery]);

  const priorityIncidents = useMemo(() => {
    return incidents
      .filter((inc) => {
        const score = inc.priority_score ?? inc.severity * 20;
        return (inc.severity >= 3 || score >= 60) && inc.status !== "resolved" && inc.status !== "cancelled";
      })
      .sort((a, b) => {
        const scoreA = a.priority_score ?? a.severity * 20;
        const scoreB = b.priority_score ?? b.severity * 20;
        return scoreB - scoreA;
      })
      .slice(0, 8);
  }, [incidents]);

  const stats = useMemo(() => {
    let critical = 0;
    let highPriority = 0;
    let assigned = 0;
    let unassigned = 0;
    let resolved = 0;

    incidents.forEach((inc) => {
      const score = inc.priority_score ?? inc.severity * 20;
      if (score >= 80 || inc.severity >= 4) critical += 1;
      if (score >= 60) highPriority += 1;
      if (inc.assigned_to) assigned += 1;
      else if (inc.status !== "resolved" && inc.status !== "cancelled") unassigned += 1;
      if (inc.status === "resolved") resolved += 1;
    });

    return { total: incidents.length, critical, highPriority, assigned, unassigned, resolved };
  }, [incidents]);

  // ------------------------------------------------------------
  // ROLE GUARD
  // ------------------------------------------------------------
  if (userLoading) {
    return (
      <main className="min-h-screen bg-[#070b14] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin"></div>
          <p className="text-slate-400 text-xs font-medium">Verifying Command Center credentials...</p>
        </div>
      </main>
    );
  }

  if (!isCommandCenter && role !== "admin") {
    return (
      <main className="min-h-screen bg-[#070b14] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-950/20 p-8 text-center shadow-2xl backdrop-blur">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/30 text-2xl mx-auto mb-4">
            🛡️
          </div>
          <h2 className="text-xl font-bold text-red-300 mb-2">Access Restricted</h2>
          <p className="text-xs text-slate-300 mb-4 leading-relaxed">
            The RescueGrid Command Center is strictly restricted to authorized emergency dispatch coordinators and system administrators.
          </p>
          <div className="rounded-xl bg-black/40 border border-white/10 p-3 mb-6 text-xs text-slate-400">
            <span>Your current authenticated role: </span>
            <strong className="text-white uppercase font-mono">{role || "citizen"}</strong>
          </div>
          <div className="flex flex-col gap-2">
            <Link
              href="/"
              className="w-full rounded-xl bg-sky-600 px-4 py-2.5 font-bold text-xs hover:bg-sky-500 transition shadow-lg shadow-sky-950/50"
            >
              Go to Citizen Dashboard
            </Link>
            <Link
              href="/incidents"
              className="w-full rounded-xl bg-white/10 px-4 py-2.5 font-semibold text-xs hover:bg-white/20 transition text-slate-300"
            >
              View Public Incident Feed
            </Link>
          </div>
        </div>
      </main>
    );
  }

  // ------------------------------------------------------------
  // MAIN VIEW
  // ------------------------------------------------------------
  return (
    <main className="min-h-screen bg-[#070b14] text-white flex flex-col">
      <Navbar />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 w-full flex-1 flex flex-col gap-6">
        {/* TOP TITLE BAR */}
        <section className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-5">
          <div>
            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5 rounded-full bg-sky-400 animate-pulse"></span>
              <h1 className="text-xl font-bold tracking-tight text-white">Emergency Command Center</h1>
              <span className="rounded-full bg-sky-500/10 border border-sky-500/30 px-2 py-0.5 text-[10px] font-bold text-sky-300 uppercase tracking-wider">
                Live Operations
              </span>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Geospatial dispatch, smart incident triage, responder assignment, and real-time response management.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                fetchIncidents();
                fetchResponders();
              }}
              disabled={loading}
              className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-200 transition flex items-center gap-1.5"
            >
              <span>{loading ? "Syncing..." : "↻ Refresh Feed"}</span>
            </button>
            <Link
              href="/incidents"
              className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-3 py-1.5 text-xs font-semibold text-slate-300 transition"
            >
              Public Feed
            </Link>
          </div>
        </section>

        {/* METRICS ROW */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#0e1424] p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total</span>
            <p className="mt-1 text-2xl font-extrabold text-white">{stats.total}</p>
            <span className="text-[10px] text-slate-500">All emergencies</span>
          </div>

          <div className="rounded-xl border border-red-500/20 bg-red-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">Critical Priority</span>
            <p className="mt-1 text-2xl font-extrabold text-red-300">{stats.critical}</p>
            <span className="text-[10px] text-red-400/60">Score 80-100 or Sev 4-5</span>
          </div>

          <div className="rounded-xl border border-orange-500/20 bg-orange-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-orange-400 uppercase tracking-wider">High Urgency</span>
            <p className="mt-1 text-2xl font-extrabold text-orange-300">{stats.highPriority}</p>
            <span className="text-[10px] text-orange-400/60">Score 60+ priority</span>
          </div>

          <div className="rounded-xl border border-purple-500/20 bg-purple-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-purple-400 uppercase tracking-wider">Assigned Units</span>
            <p className="mt-1 text-2xl font-extrabold text-purple-300">{stats.assigned}</p>
            <span className="text-[10px] text-purple-400/60">Active dispatch units</span>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">Unassigned Queue</span>
            <p className="mt-1 text-2xl font-extrabold text-amber-300">{stats.unassigned}</p>
            <span className="text-[10px] text-amber-400/60">Awaiting assignment</span>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">Resolved</span>
            <p className="mt-1 text-2xl font-extrabold text-emerald-300">{stats.resolved}</p>
            <span className="text-[10px] text-emerald-400/60">Cleared emergencies</span>
          </div>
        </section>

        {/* FEEDBACK BANNERS */}
        {errorMessage && (
          <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/90 p-4 text-xs text-red-200 flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span className="font-medium">{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-white px-2 text-lg font-bold">×</button>
          </div>
        )}

        {successMessage && (
          <div role="alert" className="rounded-xl border border-emerald-500/40 bg-emerald-950/90 p-4 text-xs text-emerald-200 flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-2">
              <span className="text-base">✓</span>
              <span className="font-medium">{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-white px-2 text-lg font-bold">×</button>
          </div>
        )}

        {/* TOP SPLIT: LIVE MAP & HIGH-PRIORITY TRIAGE QUEUE */}
        <section className="grid gap-6 lg:grid-cols-3 items-start">
          {/* MAP */}
          <div className="lg:col-span-2 flex flex-col rounded-2xl border border-white/10 bg-[#0e1424] overflow-hidden shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-[#0a0f1d]">
              <div className="flex items-center gap-2.5">
                <div className="h-2 w-2 rounded-full bg-sky-400 animate-pulse"></div>
                <h2 className="text-sm font-bold text-white tracking-wide">Command Center Geospatial Overview</h2>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {incidents.length} active nodes
              </span>
            </div>

            <div className="relative">
              <DisasterMap
                selectedIncidentId={selectedIncident?.id}
                onIncidentSelect={(inc) => setSelectedIncident(inc)}
                refreshTrigger={mapRefreshTrigger}
              />
            </div>
          </div>

          {/* PRIORITY QUEUE */}
          <div className="flex flex-col rounded-2xl border border-white/10 bg-[#0e1424] overflow-hidden shadow-xl h-[520px]">
            <div className="border-b border-white/10 px-5 py-3.5 bg-[#0a0f1d] flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-white">Priority Triage Queue</h3>
                <p className="text-[11px] text-slate-400">Deterministic Score &ge; 60 or Severity &ge; 3</p>
              </div>
              <span className="rounded-full bg-red-500/15 border border-red-500/30 px-2 py-0.5 text-[10px] font-bold text-red-400 uppercase">
                {priorityIncidents.length} Urgent
              </span>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-3.5">
              {priorityIncidents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500 px-4">
                  <span className="text-3xl mb-2">✅</span>
                  <p className="font-semibold text-slate-300 text-sm">No Urgent Triage Backlog</p>
                  <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
                    All critical &amp; high priority incidents have been addressed.
                  </p>
                </div>
              ) : (
                priorityIncidents.map((inc) => {
                  const nextStatus = getNextRecommendedStatus(inc.status);
                  const isUpdating = actionLoadingId === inc.id;

                  return (
                    <div
                      key={inc.id}
                      className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5 space-y-2.5 hover:border-white/20 transition"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{getTypeIcon(inc.type)}</span>
                          <div>
                            <span className="text-xs font-bold text-white capitalize block leading-tight">
                              {inc.type}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              ID: {inc.id.slice(0, 8)}...
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <PriorityBadge score={inc.priority_score} tier={inc.priority_tier} />
                          <StatusBadge status={inc.status} size="sm" showIcon={false} />
                        </div>
                      </div>

                      {/* Assignment indicator */}
                      <div className="flex items-center justify-between text-[11px] bg-white/[0.03] px-2.5 py-1.5 rounded-lg border border-white/5">
                        <span className="text-slate-400">Assigned:</span>
                        {inc.assigned_to ? (
                          <span className="text-purple-300 font-semibold flex items-center gap-1">
                            <span>👤</span>
                            <span>{inc.assigned_responder_name || "Assigned Unit"}</span>
                          </span>
                        ) : (
                          <span className="text-amber-400/80 font-medium">Unassigned</span>
                        )}
                      </div>

                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                        {inc.description || "No situation description provided."}
                      </p>

                      <div className="flex items-center justify-between pt-1 border-t border-white/5 text-[10px] text-slate-400">
                        <span className="font-mono">
                          📍 {inc.latitude.toFixed(3)}, {inc.longitude.toFixed(3)}
                        </span>
                        {nextStatus ? (
                          <button
                            onClick={() => handleUpdate(inc.id, nextStatus)}
                            disabled={isUpdating}
                            className="rounded-lg bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 border border-sky-500/30 px-2 py-0.5 font-bold transition disabled:opacity-50"
                          >
                            Advance → {nextStatus}
                          </button>
                        ) : (
                          <span className="text-emerald-400 font-semibold">Triage Complete</span>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {/* OPERATIONS TABLE WITH MULTI-DIMENSIONAL FILTERS */}
        <section className="flex flex-col rounded-2xl border border-white/10 bg-[#0e1424] overflow-hidden shadow-xl">
          {/* FILTER CONTROLS BAR */}
          <div className="border-b border-white/10 bg-[#0a0f1d] p-4 flex flex-col gap-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="font-bold text-sm text-white">Live Operations Dispatch Console</h3>
                <p className="text-[11px] text-slate-400">
                  Showing {filteredIncidents.length} of {incidents.length} total incidents
                </p>
              </div>

              {/* SEARCH */}
              <div className="relative min-w-[240px]">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search type, location, responder..."
                  className="w-full rounded-xl border border-white/10 bg-[#070b14] px-3.5 py-1.5 text-xs text-white placeholder-slate-500 outline-none focus:border-sky-500 transition"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery("")}
                    className="absolute right-2.5 top-1.5 text-slate-500 hover:text-white text-xs font-bold"
                  >
                    ×
                  </button>
                )}
              </div>
            </div>

            {/* FILTER DROPDOWNS ROW */}
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 pt-1">
              {/* STATUS FILTER */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#070b14] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                >
                  <option value="all">All Statuses</option>
                  {ALLOWED_STATUSES.map((st) => (
                    <option key={st} value={st}>
                      {getStatusConfig(st).label}
                    </option>
                  ))}
                </select>
              </div>

              {/* SEVERITY FILTER */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Severity</label>
                <select
                  value={severityFilter}
                  onChange={(e) => setSeverityFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#070b14] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                >
                  <option value="all">All Severities</option>
                  <option value="critical">Critical (4-5)</option>
                  <option value="high">High (3)</option>
                  <option value="medium">Medium (2)</option>
                  <option value="low">Low (1)</option>
                </select>
              </div>

              {/* PRIORITY SCORE TIER FILTER */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Smart Priority</label>
                <select
                  value={priorityFilter}
                  onChange={(e) => setPriorityFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#070b14] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                >
                  <option value="all">All Priority Scores</option>
                  <option value="critical">Critical (80-100)</option>
                  <option value="high">High (60-79)</option>
                  <option value="medium">Medium (40-59)</option>
                  <option value="low">Low (1-39)</option>
                </select>
              </div>

              {/* ASSIGNMENT FILTER */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Dispatch State</label>
                <select
                  value={assignmentFilter}
                  onChange={(e) => setAssignmentFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#070b14] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                >
                  <option value="all">All Assignment States</option>
                  <option value="unassigned">Unassigned Only</option>
                  <option value="assigned">Assigned Units</option>
                </select>
              </div>

              {/* SPECIFIC RESPONDER FILTER */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Assigned Responder</label>
                <select
                  value={responderFilter}
                  onChange={(e) => setResponderFilter(e.target.value)}
                  className="rounded-lg border border-white/10 bg-[#070b14] px-2.5 py-1.5 text-xs text-slate-200 outline-none focus:border-sky-500"
                >
                  <option value="all">All Responders</option>
                  {responders.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* TABLE */}
          <div className="overflow-x-auto">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
                <div className="h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin"></div>
                <p className="text-xs font-semibold">Synchronizing operational database...</p>
              </div>
            ) : filteredIncidents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-center px-4">
                <span className="text-3xl mb-2">🛰️</span>
                <p className="text-slate-300 font-semibold text-sm">No incidents match this filter</p>
                <p className="text-xs text-slate-500 mt-1">Try resetting the status, priority, or assignment filter</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs text-slate-300 border-collapse">
                <thead className="bg-[#070b14] text-[11px] uppercase tracking-wider text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="p-3.5">Type &amp; Severity</th>
                    <th className="p-3.5">Priority</th>
                    <th className="p-3.5">Workflow Status</th>
                    <th className="p-3.5">Assigned Responder</th>
                    <th className="p-3.5">Situation &amp; Notes</th>
                    <th className="p-3.5">Workflow Actions</th>
                    <th className="p-3.5 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-sans">
                  {filteredIncidents.map((inc) => {
                    const nextStatus = getNextRecommendedStatus(inc.status);
                    const isUpdating = actionLoadingId === inc.id;
                    const isEditingNote = editingNoteId === inc.id;

                    return (
                      <tr key={inc.id} className="hover:bg-white/[0.02] transition-colors">
                        {/* Type & Severity */}
                        <td className="p-3.5 align-top min-w-[140px]">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{getTypeIcon(inc.type)}</span>
                            <div>
                              <p className="font-bold text-sm text-white capitalize">{inc.type}</p>
                              <div className="mt-1">
                                <SeverityBadge severity={inc.severity} size="sm" />
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Priority Score & Tier */}
                        <td className="p-3.5 align-top min-w-[110px]">
                          <PriorityBadge score={inc.priority_score} tier={inc.priority_tier} />
                        </td>

                        {/* Status */}
                        <td className="p-3.5 align-top min-w-[130px]">
                          <StatusBadge status={inc.status} size="sm" />
                          <p className="text-[10px] text-slate-500 mt-1 max-w-[120px] leading-tight">
                            {getStatusConfig(inc.status).description}
                          </p>
                        </td>

                        {/* Assigned Responder (Dispatch Dropdown) */}
                        <td className="p-3.5 align-top min-w-[180px]">
                          <div className="space-y-1.5">
                            {inc.assigned_to ? (
                              <div className="flex items-center justify-between gap-1 bg-purple-500/10 border border-purple-500/25 px-2.5 py-1 rounded-lg">
                                <span className="text-purple-200 font-semibold text-xs flex items-center gap-1">
                                  <span>👤</span>
                                  <span>{inc.assigned_responder_name || "Assigned"}</span>
                                </span>
                                <button
                                  onClick={() => handleUpdate(inc.id, undefined, undefined, null)}
                                  disabled={isUpdating}
                                  title="Unassign responder"
                                  className="text-purple-400 hover:text-red-400 text-xs font-bold px-1"
                                >
                                  ×
                                </button>
                              </div>
                            ) : (
                              <span className="inline-block text-[11px] text-amber-400/90 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full font-medium">
                                Unassigned
                              </span>
                            )}

                            {/* Reassign / Assign select */}
                            <select
                              value={inc.assigned_to || ""}
                              onChange={(e) => {
                                const val = e.target.value;
                                handleUpdate(inc.id, undefined, undefined, val ? val : null);
                              }}
                              disabled={isUpdating}
                              className="w-full rounded-lg border border-white/10 bg-[#070b14] px-2 py-1 text-[11px] text-slate-300 outline-none focus:border-purple-500 disabled:opacity-50"
                            >
                              <option value="">{inc.assigned_to ? "Reassign responder..." : "Assign to responder..."}</option>
                              {responders.map((r) => (
                                <option key={r.id} value={r.id}>
                                  {r.full_name}
                                </option>
                              ))}
                            </select>
                          </div>
                        </td>

                        {/* Situation & Notes */}
                        <td className="p-3.5 align-top max-w-[260px]">
                          <p className="text-slate-200 line-clamp-2 leading-relaxed">
                            {inc.description || "No situation description provided."}
                          </p>
                          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-400 font-mono">
                            <span>📍 {inc.latitude.toFixed(3)}, {inc.longitude.toFixed(3)}</span>
                          </div>

                          <div className="mt-2 pt-1 border-t border-white/5">
                            {isEditingNote ? (
                              <div className="space-y-1.5">
                                <textarea
                                  value={noteInput}
                                  onChange={(e) => setNoteInput(e.target.value)}
                                  placeholder="Add situational note..."
                                  rows={2}
                                  className="w-full rounded-lg border border-white/20 bg-[#070b14] p-1.5 text-xs text-white outline-none focus:border-sky-500 resize-none"
                                />
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleUpdate(inc.id, undefined, noteInput.trim() || undefined)}
                                    disabled={isUpdating}
                                    className="rounded bg-sky-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-sky-500 disabled:opacity-50"
                                  >
                                    Save
                                  </button>
                                  <button
                                    onClick={() => setEditingNoteId(null)}
                                    className="rounded bg-white/10 px-2 py-0.5 text-[11px] text-slate-300 hover:bg-white/20"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </div>
                            ) : (
                              <div>
                                <p className="text-xs text-slate-300 italic line-clamp-2">
                                  {inc.note ? `"${inc.note}"` : <span className="text-slate-500 text-[11px]">No operational note</span>}
                                </p>
                                <button
                                  onClick={() => {
                                    setEditingNoteId(inc.id);
                                    setNoteInput(inc.note || "");
                                  }}
                                  className="mt-1 text-[11px] text-sky-400 hover:text-sky-300 hover:underline"
                                >
                                  {inc.note ? "Edit note" : "+ Add note"}
                                </button>
                              </div>
                            )}
                          </div>
                        </td>

                        {/* Workflow Actions */}
                        <td className="p-3.5 align-top min-w-[190px]">
                          <div className="flex flex-col gap-1.5">
                            {nextStatus && (
                              <button
                                onClick={() => handleUpdate(inc.id, nextStatus)}
                                disabled={isUpdating}
                                className="flex items-center justify-center gap-1.5 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold py-1.5 px-3 text-xs transition shadow-sm disabled:opacity-50"
                              >
                                {isUpdating ? (
                                  <span>Updating...</span>
                                ) : (
                                  <span>Move to {getStatusConfig(nextStatus).label} →</span>
                                )}
                              </button>
                            )}

                            <div className="flex items-center gap-1.5">
                              <select
                                value={inc.status || "reported"}
                                onChange={(e) => {
                                  if (e.target.value !== inc.status) {
                                    handleUpdate(inc.id, e.target.value);
                                  }
                                }}
                                disabled={isUpdating}
                                className="rounded border border-white/10 bg-[#070b14] px-2 py-1 text-[11px] text-slate-300 outline-none focus:border-sky-500 disabled:opacity-50 flex-1"
                              >
                                {ALLOWED_STATUSES.map((st) => (
                                  <option key={st} value={st}>
                                    Status: {st}
                                  </option>
                                ))}
                              </select>

                              {inc.status !== "cancelled" && inc.status !== "resolved" && (
                                <button
                                  onClick={() => handleUpdate(inc.id, "cancelled")}
                                  disabled={isUpdating}
                                  title="Cancel report"
                                  className="rounded border border-red-500/20 bg-red-950/20 px-2 py-1 text-[11px] font-semibold text-red-300 hover:bg-red-900/40 transition disabled:opacity-50"
                                >
                                  ✕
                                </button>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Inspect Details */}
                        <td className="p-3.5 align-top text-right">
                          <button
                            onClick={() => setSelectedIncident(inc)}
                            className="rounded-lg bg-white/10 px-2.5 py-1 text-xs font-semibold text-slate-200 hover:bg-white/20 transition"
                          >
                            Inspect
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {/* INSPECT MODAL */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="max-w-xl w-full rounded-2xl border border-white/10 bg-[#0e1424] p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2">
                <span className="text-2xl">{getTypeIcon(selectedIncident.type)}</span>
                <div>
                  <h3 className="text-base font-bold text-white capitalize">{selectedIncident.type}</h3>
                  <p className="text-[11px] text-slate-400 font-mono">ID: {selectedIncident.id}</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                className="text-slate-400 hover:text-white text-xl font-bold p-1"
              >
                ✕
              </button>
            </div>

            {/* STATUS & PRIORITY TIERS */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Status</span>
                <StatusBadge status={selectedIncident.status} size="sm" />
              </div>
              <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Severity</span>
                <SeverityBadge severity={selectedIncident.severity} size="sm" />
              </div>
              <div className="bg-white/5 p-3 rounded-xl border border-white/5 space-y-1">
                <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Priority</span>
                <PriorityBadge score={selectedIncident.priority_score} tier={selectedIncident.priority_tier} />
              </div>
            </div>

            {/* ASSIGNED RESPONDER SECTION */}
            <div className="rounded-xl border border-purple-500/20 bg-purple-950/20 p-3.5 space-y-2">
              <span className="text-[10px] font-bold text-purple-300 uppercase tracking-wider block">
                Assigned Emergency Responder
              </span>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <p className="text-xs font-semibold text-white">
                  {selectedIncident.assigned_to ? (
                    <span className="flex items-center gap-1.5 text-purple-200">
                      <span>👤</span>
                      <span>{selectedIncident.assigned_responder_name || "Assigned Unit"}</span>
                    </span>
                  ) : (
                    <span className="text-amber-400">No responder currently dispatched</span>
                  )}
                </p>

                <div className="flex items-center gap-2">
                  <select
                    value={selectedIncident.assigned_to || ""}
                    onChange={(e) => {
                      const val = e.target.value;
                      handleUpdate(selectedIncident.id, undefined, undefined, val ? val : null);
                    }}
                    className="rounded-lg border border-white/10 bg-[#070b14] px-2.5 py-1 text-xs text-slate-200 outline-none focus:border-purple-500"
                  >
                    <option value="">{selectedIncident.assigned_to ? "Reassign..." : "Assign responder..."}</option>
                    {responders.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.full_name}
                      </option>
                    ))}
                  </select>

                  {selectedIncident.assigned_to && (
                    <button
                      onClick={() => handleUpdate(selectedIncident.id, undefined, undefined, null)}
                      className="rounded-lg border border-red-500/30 bg-red-950/30 hover:bg-red-900/40 text-red-300 px-2.5 py-1 text-xs font-semibold transition"
                    >
                      Unassign
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* DESCRIPTION */}
            <div className="bg-white/5 p-3.5 rounded-xl border border-white/5 space-y-1">
              <span className="text-[10px] text-slate-400 font-bold uppercase tracking-wider block">Situation Description</span>
              <p className="text-xs text-slate-200 leading-relaxed">
                {selectedIncident.description || "No situation description provided."}
              </p>
            </div>

            {/* SITUATIONAL NOTE */}
            {selectedIncident.note && (
              <div className="bg-sky-950/20 p-3.5 rounded-xl border border-sky-500/20 space-y-1">
                <span className="text-[10px] text-sky-400 font-bold uppercase tracking-wider block">Operational Note</span>
                <p className="text-xs text-sky-200 italic">&ldquo;{selectedIncident.note}&rdquo;</p>
              </div>
            )}

            {/* ACTIONS */}
            <div className="flex items-center justify-between pt-2 border-t border-white/10">
              <div className="text-[10px] text-slate-500 font-mono">
                📍 {selectedIncident.latitude.toFixed(4)}, {selectedIncident.longitude.toFixed(4)}
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                className="rounded-xl bg-white/10 px-4 py-1.5 text-xs font-bold text-slate-300 hover:bg-white/20 transition"
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
