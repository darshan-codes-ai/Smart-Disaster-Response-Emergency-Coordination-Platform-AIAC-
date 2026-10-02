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
  STATUS_WORKFLOW_SEQUENCE,
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

export default function CommandCenterPage() {
  const { role, isCommandCenter, loading: userLoading } = useCurrentUser();

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
        throw new Error(data?.detail || "Failed to update operational incident");
      }

      const updatedIncident: Incident = data.incident;
      setIncidents((prev) =>
        prev.map((inc) => (inc.id === incidentId ? updatedIncident : inc))
      );

      if (selectedIncident?.id === incidentId) {
        setSelectedIncident(updatedIncident);
      }

      setMapRefreshTrigger((n) => n + 1);

      setSuccessMessage(
        newStatus
          ? `Status updated to "${getStatusConfig(updatedIncident.status).label}"`
          : "Situational note updated successfully."
      );
      setEditingNoteId(null);
      setNoteInput("");

      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Command Center update error:", err);
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
      const sev = typeof inc.severity === "number" ? inc.severity : 1;
      if (severityFilter === "critical" && sev < 4) return false;
      if (severityFilter === "high" && sev !== 3) return false;
      if (severityFilter === "medium" && sev !== 2) return false;
      if (severityFilter === "low" && sev !== 1) return false;

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

  const priorityIncidents = useMemo(() => {
    return incidents
      .filter((inc) => {
        const s = (inc.status || "reported").toLowerCase();
        if (s === "resolved" || s === "cancelled") return false;
        return (inc.severity >= 3);
      })
      .slice(0, 5);
  }, [incidents]);

  const stats = useMemo(() => {
    const total = incidents.length;
    let reported = 0;
    let verified = 0;
    let assigned = 0;
    let inProgress = 0;
    let resolved = 0;
    let critical = 0;
    let active = 0;

    incidents.forEach((inc) => {
      const s = (inc.status || "reported").toLowerCase();
      if (s === "reported") reported++;
      else if (s === "verified") verified++;
      else if (s === "assigned") assigned++;
      else if (s === "in_progress") inProgress++;
      else if (s === "resolved") resolved++;

      if (s !== "resolved" && s !== "cancelled") active++;
      if (inc.severity >= 4) critical++;
    });

    return { total, reported, verified, assigned, inProgress, resolved, critical, active };
  }, [incidents]);

  // ------------------------------------------------------------
  // ROLE GUARD & ACCESS RESTRICTED SCREEN
  // ------------------------------------------------------------
  if (userLoading) {
    return (
      <main className="min-h-screen bg-[#070b14] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin"></div>
          <p className="text-slate-400 text-sm font-medium">Verifying Command Center authorization...</p>
        </div>
      </main>
    );
  }

  if (!isCommandCenter) {
    return (
      <main className="min-h-screen bg-[#070b14] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-sky-500/30 bg-[#0e1424] p-8 text-center shadow-2xl space-y-5">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-sky-500/10 border border-sky-500/30 text-2xl text-sky-400">
            🛡️
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-wider text-white">
              RESCUE<span className="text-sky-400">GRID</span>
            </h1>
            <h2 className="text-xl font-bold text-slate-100 mt-2">Command Center Restricted</h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              The Command Center Console is restricted to authorized coordinators, dispatch officers, and platform administrators.
            </p>
          </div>

          <div className="rounded-xl bg-black/40 border border-white/10 p-3 text-xs text-slate-400 flex items-center justify-between">
            <span>Your Current Role:</span>
            <span className="font-mono font-bold text-sky-300 uppercase">{role}</span>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <Link
              href="/"
              className="w-full rounded-xl bg-sky-600 hover:bg-sky-500 px-4 py-2.5 font-semibold text-xs text-white transition shadow-md shadow-sky-900/40"
            >
              Return to Citizen Dashboard
            </Link>
            <Link
              href="/incidents"
              className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 px-4 py-2.5 font-semibold text-xs text-slate-300 transition"
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
    <main className="min-h-screen bg-[#070b14] text-white flex flex-col">
      <Navbar
        currentSection="Command Center"
        actionButton={
          <button
            onClick={() => {
              fetchIncidents();
              setMapRefreshTrigger((n) => n + 1);
            }}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-xs font-semibold text-sky-300 transition disabled:opacity-50"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Refresh Operations</span>
          </button>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 w-full flex-1 flex flex-col gap-6">
        {/* KPI OVERVIEW CARDS */}
        <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#0e1424] p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Total Recorded</span>
            <p className="mt-1 text-2xl font-extrabold text-white">{stats.total}</p>
            <span className="text-[10px] text-slate-500">All registered incidents</span>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">Active Operations</span>
            <p className="mt-1 text-2xl font-extrabold text-amber-300">{stats.active}</p>
            <span className="text-[10px] text-amber-400/60">Triage &amp; field execution</span>
          </div>

          <div className="rounded-xl border border-red-500/20 bg-red-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">Critical Priority</span>
            <p className="mt-1 text-2xl font-extrabold text-red-300">{stats.critical}</p>
            <span className="text-[10px] text-red-400/60">Severity level 4 - 5</span>
          </div>

          <div className="rounded-xl border border-purple-500/20 bg-purple-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-purple-400 uppercase tracking-wider">Units Assigned</span>
            <p className="mt-1 text-2xl font-extrabold text-purple-300">{stats.assigned}</p>
            <span className="text-[10px] text-purple-400/60">Dispatched field units</span>
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

        {/* TOP SPLIT: LIVE MAP (LEFT) & HIGH-PRIORITY TRIAGE QUEUE (RIGHT) */}
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
                <p className="text-[11px] text-slate-400">High &amp; critical active incidents</p>
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
                    All critical &amp; high severity incidents have been addressed.
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
                              ID: {inc.id.slice(0, 8)}
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <SeverityBadge severity={inc.severity} size="sm" />
                          <StatusBadge status={inc.status} size="sm" showIcon={false} />
                        </div>
                      </div>

                      <p className="text-xs text-slate-300 line-clamp-2 leading-relaxed">
                        {inc.description || "No description provided."}
                      </p>

                      <div className="flex items-center justify-between pt-1 border-t border-white/5 gap-2">
                        <button
                          onClick={() => setSelectedIncident(inc)}
                          className="text-[11px] font-semibold text-sky-400 hover:text-sky-300 underline"
                        >
                          Inspect →
                        </button>

                        {nextStatus && (
                          <button
                            onClick={() => handleUpdate(inc.id, nextStatus)}
                            disabled={isUpdating}
                            className="rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-semibold py-1 px-2.5 text-[11px] transition disabled:opacity-50"
                          >
                            {isUpdating ? "..." : `Advance: ${getStatusConfig(nextStatus).label}`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </section>

        {/* INCIDENT OPERATIONS SECTION */}
        <section className="rounded-2xl border border-white/10 bg-[#0e1424] overflow-hidden shadow-2xl flex flex-col">
          {/* TOOLBAR */}
          <div className="p-4 border-b border-white/10 bg-[#0a0f1d] flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            {/* Status Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-400 mr-1.5">Filter:</span>
              {["all", ...ALLOWED_STATUSES].map((st) => (
                <button
                  key={st}
                  onClick={() => setStatusFilter(st)}
                  className={`rounded-lg px-2.5 py-1 text-xs font-semibold capitalize transition ${
                    statusFilter === st
                      ? "bg-sky-600 text-white shadow-md shadow-sky-900/40"
                      : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            {/* Severity + Search */}
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

              <div className="relative flex-1 sm:w-60">
                <input
                  type="text"
                  placeholder="Search ID, type, notes..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full rounded-lg border border-white/10 bg-[#070b14] pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500"
                />
                <svg className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
            </div>
          </div>

          {/* TABLE */}
          <div className="overflow-x-auto flex-1">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-400 gap-3">
                <div className="h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin"></div>
                <p className="text-xs font-semibold">Synchronizing operational database...</p>
              </div>
            ) : filteredIncidents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-slate-500 text-center px-4">
                <span className="text-3xl mb-2">🛰️</span>
                <p className="text-slate-300 font-semibold text-sm">No incidents match this filter</p>
                <p className="text-xs text-slate-500 mt-1">Try resetting the status filter or search parameters</p>
              </div>
            ) : (
              <table className="w-full text-left text-xs text-slate-300 border-collapse">
                <thead className="bg-[#070b14] text-[11px] uppercase tracking-wider text-slate-400 border-b border-white/10">
                  <tr>
                    <th className="p-3.5">Type &amp; Severity</th>
                    <th className="p-3.5">Workflow Status</th>
                    <th className="p-3.5">Situation &amp; Coordinates</th>
                    <th className="p-3.5">Situational Notes</th>
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
                        <td className="p-3.5 align-top min-w-[150px]">
                          <div className="flex items-center gap-2">
                            <span className="text-xl">{getTypeIcon(inc.type)}</span>
                            <div>
                              <p className="font-bold text-sm text-white capitalize">{inc.type}</p>
                              <div className="flex items-center gap-1.5 mt-1">
                                <SeverityBadge severity={inc.severity} size="sm" />
                                <span className="rounded bg-sky-500/10 text-sky-300 border border-sky-500/20 px-1.5 py-0.5 text-[10px] font-mono font-bold">
                                  P:{inc.priority_score ?? inc.severity * 20}
                                </span>
                              </div>
                            </div>
                          </div>
                        </td>

                        {/* Status */}
                        <td className="p-3.5 align-top min-w-[140px]">
                          <StatusBadge status={inc.status} size="sm" />
                          <p className="text-[10px] text-slate-500 mt-1 max-w-[130px] leading-tight">
                            {getStatusConfig(inc.status).description}
                          </p>
                        </td>

                        {/* Description & Location */}
                        <td className="p-3.5 align-top max-w-[280px]">
                          <p className="text-slate-200 line-clamp-2 leading-relaxed">
                            {inc.description || "No situation description provided."}
                          </p>
                          <div className="mt-2 flex items-center gap-3 text-[10px] text-slate-400 font-mono">
                            <span>📍 {inc.latitude.toFixed(4)}, {inc.longitude.toFixed(4)}</span>
                            <span>
                              {inc.created_at ? new Date(inc.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                            </span>
                          </div>
                        </td>

                        {/* Notes */}
                        <td className="p-3.5 align-top min-w-[180px] max-w-[220px]">
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
                                {inc.note ? `"${inc.note}"` : <span className="text-slate-500">No notes recorded</span>}
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
                        </td>

                        {/* Workflow Actions */}
                        <td className="p-3.5 align-top min-w-[200px]">
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
                                  title="Cancel false alarm or duplicate"
                                  className="rounded border border-red-500/30 bg-red-950/20 px-2 py-1 text-[11px] text-red-400 hover:bg-red-900/40 hover:text-white transition disabled:opacity-50"
                                >
                                  Cancel
                                </button>
                              )}
                            </div>
                          </div>
                        </td>

                        {/* Details */}
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

      {/* DETAILED INSPECTION MODAL */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-xl rounded-2xl border border-white/15 bg-[#0d1424] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-white/10 pb-4">
              <div>
                <span className="text-[11px] font-bold text-sky-400 uppercase tracking-wider">
                  Command Center Record Inspector
                </span>
                <h3 className="text-xl font-bold text-white flex items-center gap-2 mt-1 capitalize">
                  <span className="text-2xl">{getTypeIcon(selectedIncident.type)}</span>
                  <span>{selectedIncident.type}</span>
                </h3>
              </div>
              <button
                onClick={() => setSelectedIncident(null)}
                aria-label="Close modal"
                className="text-slate-400 hover:text-white text-2xl px-2"
              >
                ×
              </button>
            </div>

            <div className="flex items-center gap-2">
              <StatusBadge status={selectedIncident.status} size="md" />
              <SeverityBadge severity={selectedIncident.severity} size="md" showScore />
              <span className="rounded-lg bg-sky-500/10 border border-sky-500/20 px-2.5 py-1 text-xs font-mono font-bold text-sky-300">
                Priority Score: {selectedIncident.priority_score ?? selectedIncident.severity * 20}
              </span>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Description</span>
              <p className="text-xs text-slate-200 bg-white/5 p-3 rounded-xl border border-white/5 leading-relaxed">
                {selectedIncident.description || "No situation description provided."}
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-amber-400 uppercase tracking-wider">Situational Notes</span>
              <p className="text-xs text-slate-300 bg-white/5 p-3 rounded-xl border border-white/5 italic">
                {selectedIncident.note || "No coordinator notes recorded yet."}
              </p>
            </div>

            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">Telemetry &amp; Ownership</span>
              <div className="bg-white/5 p-3 rounded-xl border border-white/5 text-[11px] font-mono text-slate-400 space-y-1">
                <div className="flex justify-between">
                  <span className="text-slate-500">Incident ID:</span>
                  <span className="text-slate-200">{selectedIncident.id}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Reporter UID:</span>
                  <span className="text-slate-200">{selectedIncident.user_id || "Anonymous Citizen"}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Coordinates:</span>
                  <span className="text-slate-200">{selectedIncident.latitude.toFixed(5)}, {selectedIncident.longitude.toFixed(5)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Created:</span>
                  <span className="text-slate-200">{selectedIncident.created_at ? new Date(selectedIncident.created_at).toLocaleString() : "Unknown"}</span>
                </div>
              </div>
            </div>

            <div className="border-t border-white/10 pt-4 flex items-center justify-between">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-xs text-slate-400 mr-1">Direct Transition:</span>
                {STATUS_WORKFLOW_SEQUENCE.map((st) => (
                  <button
                    key={st}
                    onClick={() => handleUpdate(selectedIncident.id, st)}
                    disabled={actionLoadingId === selectedIncident.id || selectedIncident.status === st}
                    className={`rounded px-2.5 py-1 text-[11px] font-semibold capitalize transition ${
                      selectedIncident.status === st
                        ? "bg-sky-600 text-white"
                        : "bg-white/10 text-slate-300 hover:bg-white/20"
                    } disabled:opacity-40`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              <button
                onClick={() => setSelectedIncident(null)}
                className="rounded-lg bg-white/10 px-4 py-2 text-xs font-semibold text-slate-300 hover:bg-white/20 transition"
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
