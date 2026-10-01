"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Incident } from "../../components/disaster-map";
import { getAccessToken, requestWithToken } from "../../lib/supabase/access-token";
import { useCurrentUser } from "../../lib/supabase/use-current-user";
import {
  ALLOWED_STATUSES,
  STATUS_WORKFLOW_SEQUENCE,
  getStatusConfig,
  getNextRecommendedStatus,
} from "../../lib/status-workflow";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function getSeverityBadge(severity: number) {
  switch (severity) {
    case 1:
      return { label: "Low", cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" };
    case 2:
      return { label: "Medium", cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    case 3:
      return { label: "High", cls: "bg-orange-500/15 text-orange-400 border-orange-500/30" };
    default:
      return { label: "Critical", cls: "bg-red-500/15 text-red-400 border-red-500/30" };
  }
}

function getTypeIcon(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("flood") || t.includes("water")) return "🌊";
  if (t.includes("fire")) return "🔥";
  if (t.includes("earthquake")) return "🏚️";
  if (t.includes("cyclone") || t.includes("storm")) return "🌀";
  if (t.includes("medical") || t.includes("health")) return "🚑";
  if (t.includes("collapse")) return "🏢";
  if (t.includes("accident")) return "🚗";
  return "⚠️";
}

export default function CommandCenterPage() {
  const { profile, role, isCommandCenter, loading: userLoading } = useCurrentUser();

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState("");

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
        let detail = `Error ${res.status}: Failed to fetch incidents`;
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

  useEffect(() => {
    let ignore = false;
    if (!userLoading && isCommandCenter) {
      Promise.resolve().then(() => {
        if (!ignore) {
          fetchIncidents();
        }
      });
    }
    return () => {
      ignore = true;
    };
  }, [userLoading, isCommandCenter, fetchIncidents]);

  // ------------------------------------------------------------
  // UPDATE INCIDENT STATUS / NOTE
  // ------------------------------------------------------------
  const handleUpdate = async (
    incidentId: string,
    newStatus?: string,
    newNote?: string
  ) => {
    try {
      setActionLoadingId(incidentId);
      setErrorMessage(null);
      setSuccessMessage(null);

      const token = await getAccessToken();
      if (!token) {
        throw new Error("Your login session has expired. Please log in again.");
      }

      const bodyPayload: { status?: string; note?: string } = {};
      if (newStatus !== undefined) bodyPayload.status = newStatus;
      if (newNote !== undefined) bodyPayload.note = newNote;

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

      setSuccessMessage(
        `Incident updated: Status set to "${updatedIncident.status || newStatus}"`
      );
      setEditingNoteId(null);
      setNoteInput("");

      // Auto-clear success toast
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
      if (severityFilter === "critical" && (inc.severity < 4)) return false;
      if (severityFilter === "high" && inc.severity !== 3) return false;
      if (severityFilter === "medium" && inc.severity !== 2) return false;
      if (severityFilter === "low" && inc.severity !== 1) return false;

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesType = inc.type?.toLowerCase().includes(q);
        const matchesDesc = inc.description?.toLowerCase().includes(q);
        const matchesId = inc.id?.toLowerCase().includes(q);
        const matchesNote = inc.note?.toLowerCase().includes(q);
        if (!matchesType && !matchesDesc && !matchesId && !matchesNote) {
          return false;
        }
      }

      return true;
    });
  }, [incidents, statusFilter, severityFilter, searchQuery]);

  const stats = useMemo(() => {
    const total = incidents.length;
    let reported = 0;
    let verified = 0;
    let assigned = 0;
    let inProgress = 0;
    let resolved = 0;
    let critical = 0;

    incidents.forEach((inc) => {
      const s = (inc.status || "reported").toLowerCase();
      if (s === "reported") reported++;
      else if (s === "verified") verified++;
      else if (s === "assigned") assigned++;
      else if (s === "in_progress") inProgress++;
      else if (s === "resolved") resolved++;

      if (inc.severity >= 4) critical++;
    });

    return { total, reported, verified, assigned, inProgress, resolved, critical };
  }, [incidents]);

  // ------------------------------------------------------------
  // ROLE GUARD
  // ------------------------------------------------------------
  if (userLoading) {
    return (
      <main className="min-h-screen bg-[#05070d] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin"></div>
          <p className="text-slate-400 text-sm">Verifying Command Center credentials...</p>
        </div>
      </main>
    );
  }

  if (!isCommandCenter) {
    return (
      <main className="min-h-screen bg-[#05070d] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-950/20 p-8 text-center shadow-2xl">
          <div className="text-5xl mb-4">🛡️</div>
          <h2 className="text-2xl font-bold text-red-400 mb-2">Access Restricted</h2>
          <p className="text-sm text-slate-300 mb-4">
            The Command Center Console is restricted to authorized coordinators and emergency dispatch administrators.
          </p>
          <div className="rounded-lg bg-black/40 border border-white/10 p-3 mb-6 text-xs text-slate-400">
            <span>Your current role: </span>
            <strong className="text-white uppercase font-mono">{role}</strong>
          </div>
          <div className="flex flex-col gap-2">
            <Link
              href="/"
              className="w-full rounded-lg bg-red-600 px-4 py-2.5 font-semibold text-sm hover:bg-red-700 transition"
            >
              Go to Citizen Dashboard
            </Link>
            <Link
              href="/incidents"
              className="w-full rounded-lg bg-white/10 px-4 py-2.5 font-semibold text-sm hover:bg-white/20 transition"
            >
              View Public Incidents Directory
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
    <main className="min-h-screen bg-[#05070d] text-white flex flex-col">
      {/* HEADER */}
      <header className="border-b border-white/10 bg-[#080b14]/95 backdrop-blur sticky top-0 z-30">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600/20 border border-red-500/40 text-xl">
              🎖️
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight">AIAC Command Center</h1>
                <span className="rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold text-red-400 border border-red-500/30 uppercase tracking-wider">
                  Operational Console
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Incident Triage, Status Tracking & Emergency Coordination
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 border border-white/10 bg-white/5 rounded-lg px-3 py-1.5">
              <span>Coordinator:</span>
              <strong className="text-slate-200">{profile?.full_name || profile?.email || "HQ User"}</strong>
            </div>

            <Link
              href="/incidents"
              className="rounded-lg bg-white/10 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/20 transition"
            >
              Public Feed
            </Link>

            <Link
              href="/"
              className="rounded-lg bg-white/10 px-3.5 py-2 text-xs font-semibold text-slate-200 hover:bg-white/20 transition"
            >
              Citizen Dashboard
            </Link>
          </div>
        </div>
      </header>

      {/* BODY */}
      <div className="mx-auto max-w-7xl px-6 py-6 w-full flex-1 flex flex-col gap-6">
        {/* METRICS ROW */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#101522] p-4">
            <span className="text-[11px] font-medium text-slate-400 uppercase tracking-wider">Total</span>
            <p className="mt-1 text-2xl font-bold text-white">{stats.total}</p>
            <span className="text-[10px] text-slate-500">All emergencies</span>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4">
            <span className="text-[11px] font-medium text-amber-400 uppercase tracking-wider">Reported</span>
            <p className="mt-1 text-2xl font-bold text-amber-300">{stats.reported}</p>
            <span className="text-[10px] text-amber-400/60">Awaiting triage</span>
          </div>

          <div className="rounded-xl border border-blue-500/20 bg-blue-950/20 p-4">
            <span className="text-[11px] font-medium text-blue-400 uppercase tracking-wider">Verified</span>
            <p className="mt-1 text-2xl font-bold text-blue-300">{stats.verified}</p>
            <span className="text-[10px] text-blue-400/60">Ready to dispatch</span>
          </div>

          <div className="rounded-xl border border-purple-500/20 bg-purple-950/20 p-4">
            <span className="text-[11px] font-medium text-purple-400 uppercase tracking-wider">Assigned</span>
            <p className="mt-1 text-2xl font-bold text-purple-300">{stats.assigned}</p>
            <span className="text-[10px] text-purple-400/60">Dispatched units</span>
          </div>

          <div className="rounded-xl border border-orange-500/20 bg-orange-950/20 p-4">
            <span className="text-[11px] font-medium text-orange-400 uppercase tracking-wider">In Progress</span>
            <p className="mt-1 text-2xl font-bold text-orange-300">{stats.inProgress}</p>
            <span className="text-[10px] text-orange-400/60">Active response</span>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4">
            <span className="text-[11px] font-medium text-emerald-400 uppercase tracking-wider">Resolved</span>
            <p className="mt-1 text-2xl font-bold text-emerald-300">{stats.resolved}</p>
            <span className="text-[10px] text-emerald-400/60">Cleared emergencies</span>
          </div>
        </section>

        {/* FEEDBACK BANNERS */}
        {errorMessage && (
          <div role="alert" className="rounded-xl border border-red-500/40 bg-red-950/80 p-4 text-sm text-red-200 flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-2">
              <span>❌</span>
              <span>{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-white px-2">×</button>
          </div>
        )}

        {successMessage && (
          <div role="alert" className="rounded-xl border border-emerald-500/40 bg-emerald-950/80 p-4 text-sm text-emerald-200 flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-2">
              <span>✅</span>
              <span>{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-white px-2">×</button>
          </div>
        )}

        {/* FILTER & SEARCH TOOLBAR */}
        <section className="rounded-xl border border-white/10 bg-[#101522] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-slate-400 mr-1">Status:</span>
            {["all", ...ALLOWED_STATUSES].map((st) => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold capitalize transition ${
                  statusFilter === st
                    ? "bg-red-600 text-white shadow-md shadow-red-900/50"
                    : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                }`}
              >
                {st}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#080b14] px-3 py-1.5 text-xs text-slate-300 outline-none focus:border-red-500"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical (4-5)</option>
              <option value="high">High (3)</option>
              <option value="medium">Medium (2)</option>
              <option value="low">Low (1)</option>
            </select>

            <input
              type="text"
              placeholder="Search by ID, type, desc, notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#080b14] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-red-500 w-52 sm:w-64"
            />

            <button
              onClick={fetchIncidents}
              disabled={loading}
              title="Refresh incidents"
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition disabled:opacity-50"
            >
              ↻ Refresh
            </button>
          </div>
        </section>

        {/* OPERATIONAL INCIDENTS TABLE */}
        <section className="rounded-2xl border border-white/10 bg-[#101522] overflow-hidden flex-1 flex flex-col shadow-2xl">
          <div className="border-b border-white/10 p-4 bg-[#0c101c]/80 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="font-bold text-base text-white">Active Emergency Incidents</h2>
              <span className="rounded-full bg-white/5 border border-white/10 px-2 py-0.5 text-xs text-slate-400 font-mono">
                {filteredIncidents.length} of {incidents.length}
              </span>
            </div>
            <p className="text-xs text-slate-400">
              Workflow: <span className="text-amber-400">Reported</span> → <span className="text-blue-400">Verified</span> → <span className="text-purple-400">Assigned</span> → <span className="text-orange-400">In Progress</span> → <span className="text-emerald-400">Resolved</span>
            </p>
          </div>

          <div className="overflow-x-auto flex-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
                <div className="h-8 w-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin"></div>
                <p className="text-sm">Loading operational incident feed...</p>
              </div>
            ) : filteredIncidents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 text-slate-500 text-center">
                <span className="text-4xl mb-2">🛡️</span>
                <p className="text-slate-300 font-medium text-base">No incidents matching the selected criteria</p>
                <p className="text-xs text-slate-500 mt-1">Try resetting the status filter or search query</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs text-slate-300 border-collapse">
                <thead className="bg-[#080b14] text-[11px] uppercase tracking-wider text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="p-3.5">Type & Severity</th>
                    <th className="p-3.5">Current Status</th>
                    <th className="p-3.5">Description & Location</th>
                    <th className="p-3.5">Coordinator Notes</th>
                    <th className="p-3.5">Workflow Actions</th>
                    <th className="p-3.5 text-right">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5 font-sans">
                  {filteredIncidents.map((inc) => {
                    const statusConfig = getStatusConfig(inc.status);
                    const severity = getSeverityBadge(inc.severity);
                    const nextStatus = getNextRecommendedStatus(inc.status);
                    const isUpdating = actionLoadingId === inc.id;
                    const isEditingNote = editingNoteId === inc.id;

                    return (
                      <tr
                        key={inc.id}
                        className="hover:bg-white/[0.02] transition-colors"
                      >
                        {/* Type & Severity */}
                        <td className="p-3.5 align-top min-w-[150px]">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{getTypeIcon(inc.type)}</span>
                            <div>
                              <p className="font-bold text-sm text-white capitalize">{inc.type}</p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${severity.cls}`}>
                                  {severity.label}
                                </span>
                                <span className="rounded bg-amber-500/10 text-amber-300 border border-amber-500/20 px-1.5 py-0.5 text-[10px] font-mono font-bold">
                                  P:{inc.priority_score ?? inc.severity * 20}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Current Status */}
                        <td className="p-3.5 align-top min-w-[140px]">
                          <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 font-semibold uppercase tracking-wider text-xs ${statusConfig.badgeClass}`}>
                            <span>{statusConfig.icon}</span>
                            <span>{statusConfig.label}</span>
                          </span>
                          <p className="text-[10px] text-slate-500 mt-1 max-w-[140px] leading-tight">
                            {statusConfig.description}
                          </p>
                        </td>

                        {/* Description & Location */}
                        <td className="p-3.5 align-top max-w-[280px]">
                          <p className="text-slate-200 line-clamp-2 leading-relaxed">
                            {inc.description || "No description provided."}
                          </p>
                          <div className="mt-2 flex items-center gap-3 text-[11px] text-slate-400 font-mono">
                            <span>📍 {inc.latitude.toFixed(4)}, {inc.longitude.toFixed(4)}</span>
                            <span className="text-[10px] text-slate-500">
                              {inc.created_at ? new Date(inc.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ""}
                            </span>
                          </div>
                        </td>

                        {/* Coordinator Notes */}
                        <td className="p-3.5 align-top min-w-[180px] max-w-[220px]">
                          {isEditingNote ? (
                            <div className="space-y-1.5">
                              <textarea
                                value={noteInput}
                                onChange={(e) => setNoteInput(e.target.value)}
                                placeholder="Add situational note..."
                                rows={2}
                                className="w-full rounded border border-white/20 bg-[#080b14] p-1.5 text-xs text-white outline-none focus:border-red-500 resize-none"
                              />
                              <div className="flex items-center gap-1.5">
                                <button
                                  onClick={() => handleUpdate(inc.id, undefined, noteInput.trim() || undefined)}
                                  disabled={isUpdating}
                                  className="rounded bg-red-600 px-2 py-0.5 text-[11px] font-semibold text-white hover:bg-red-700 disabled:opacity-50"
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
                                {inc.note ? `"${inc.note}"` : <span className="text-slate-500">No notes recorded</span>}
                              </p>
                              <button
                                onClick={() => {
                                  setEditingNoteId(inc.id);
                                  setNoteInput(inc.note || "");
                                }}
                                className="mt-1 text-[11px] text-blue-400 hover:text-blue-300 hover:underline"
                              >
                                {inc.note ? "Edit note" : "+ Add note"}
                              </button>
                            </div>
                          )}
                        </td>

                        {/* Workflow Action Buttons */}
                        <td className="p-3.5 align-top min-w-[220px]">
                          <div className="flex flex-col gap-1.5">
                            {/* Recommended Next Step Button */}
                            {nextStatus && (
                              <button
                                onClick={() => handleUpdate(inc.id, nextStatus)}
                                disabled={isUpdating}
                                className="flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold py-1.5 px-3 text-xs transition shadow-sm disabled:opacity-50"
                              >
                                {isUpdating ? (
                                  <span>Updating...</span>
                                ) : (
                                  <span>Move to {getStatusConfig(nextStatus).label} →</span>
                                )}
                              </button>
                            )}

                            {/* Dropdown for other status changes */}
                            <div className="flex items-center gap-1.5">
                              <select
                                value={inc.status || "reported"}
                                onChange={(e) => {
                                  if (e.target.value !== inc.status) {
                                    handleUpdate(inc.id, e.target.value);
                                  }
                                }}
                                disabled={isUpdating}
                                className="rounded border border-white/10 bg-[#080b14] px-2 py-1 text-[11px] text-slate-300 outline-none focus:border-red-500 disabled:opacity-50 flex-1"
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
                                  title="Cancel false alarm or duplicate"
                                  className="rounded border border-red-500/30 bg-red-950/20 px-2 py-1 text-[11px] text-red-400 hover:bg-red-900/40 hover:text-white transition disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Inspect Details Button */}
                        <td className="p-3.5 align-top text-right">
                          <button
                            onClick={() => setSelectedIncident(inc)}
                            className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition"
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

      {/* DETAILED INCIDENT INSPECTOR MODAL */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border border-white/10 bg-[#0d1424] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-white/10 pb-4">
              <div>
                <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider">
                  Incident Record Inspector
                </span>
                <h3 className="text-xl font-bold text-white flex items-center gap-2 mt-0.5">
                  <span>{getTypeIcon(selectedIncident.type)}</span>
                  <span>{selectedIncident.type}</span>
                </h3>
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                className="text-slate-400 hover:text-white text-2xl px-2"
              >
                ×
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-xs">
              <div className="bg-white/5 p-3 rounded-lg border border-white/5">
                <span className="text-slate-400 block uppercase text-[10px]">Severity</span>
                <span className="text-sm font-bold text-white">
                  {getSeverityBadge(selectedIncident.severity).label} ({selectedIncident.severity}/5)
                </span>
              </div>

              <div className="bg-white/5 p-3 rounded-lg border border-white/5">
                <span className="text-slate-400 block uppercase text-[10px]">Priority Score</span>
                <span className="text-sm font-bold text-amber-400">
                  {selectedIncident.priority_score ?? selectedIncident.severity * 20}
                </span>
              </div>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 block uppercase text-[10px]">Description</span>
              <p className="text-sm text-slate-200 bg-white/5 p-3 rounded-lg border border-white/5 leading-relaxed">
                {selectedIncident.description || "No description provided."}
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 block uppercase text-[10px]">Operational Notes</span>
              <p className="text-xs text-slate-300 bg-white/5 p-3 rounded-lg border border-white/5 italic">
                {selectedIncident.note || "No coordinator notes recorded yet."}
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-slate-400 block uppercase text-[10px]">Metadata & Ownership</span>
              <div className="bg-white/5 p-3 rounded-lg border border-white/5 text-[11px] font-mono text-slate-400 space-y-1">
                <p>Incident ID: <strong className="text-slate-300">{selectedIncident.id}</strong></p>
                <p>Reporter UID: <strong className="text-slate-300">{selectedIncident.user_id || "Anonymous"}</strong></p>
                <p>Coordinates: <strong className="text-slate-300">{selectedIncident.latitude}, {selectedIncident.longitude}</strong></p>
                <p>Created: <strong className="text-slate-300">{selectedIncident.created_at ? new Date(selectedIncident.created_at).toLocaleString() : "Unknown"}</strong></p>
                <p>Updated: <strong className="text-slate-300">{selectedIncident.updated_at ? new Date(selectedIncident.updated_at).toLocaleString() : "Never"}</strong></p>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs text-slate-400">Quick Change:</span>
                {STATUS_WORKFLOW_SEQUENCE.map((st) => (
                  <button
                    key={st}
                    onClick={() => handleUpdate(selectedIncident.id, st)}
                    disabled={actionLoadingId === selectedIncident.id || selectedIncident.status === st}
                    className={`rounded px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                      selectedIncident.status === st
                        ? "bg-red-600 text-white"
                        : "bg-white/10 text-slate-300 hover:bg-white/20"
                    } disabled:opacity-40`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setSelectedIncident(null)}
                className="rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/20"
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
