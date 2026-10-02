"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Incident } from "../../components/disaster-map";
import { getAccessToken, requestWithToken } from "../../lib/supabase/access-token";
import { useCurrentUser } from "../../lib/supabase/use-current-user";
import Navbar from "../../components/navbar";
import StatusBadge from "../../components/status-badge";
import SeverityBadge from "../../components/severity-badge";

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

export default function ResponderPage() {
  const { profile, role, isResponder, isCommandCenter, loading: userLoading } = useCurrentUser();

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"assigned_me" | "active" | "all" | "resolved">("assigned_me");
  const [searchQuery, setSearchQuery] = useState("");

  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const [activeNoteIncidentId, setActiveNoteIncidentId] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

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
        let detail = `Error ${res.status}: Failed to load responder incidents`;
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
      console.error("Responder fetch error:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to load incidents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    if (!userLoading && (isResponder || isCommandCenter || role === "admin")) {
      Promise.resolve().then(() => {
        if (!ignore) {
          fetchIncidents();
        }
      });
    }
    return () => {
      ignore = true;
    };
  }, [userLoading, isResponder, isCommandCenter, role, fetchIncidents]);

  // ------------------------------------------------------------
  // UPDATE INCIDENT (STATUS OR FIELD NOTE)
  // ------------------------------------------------------------
  const handleUpdate = async (incidentId: string, newStatus?: string, newNote?: string) => {
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

      let msg = `Incident updated successfully.`;
      if (newStatus === "in_progress") {
        msg = `Response underway. Status changed to "In Progress".`;
      } else if (newStatus === "resolved") {
        msg = `Emergency cleared. Status marked as "Resolved".`;
      } else if (newNote !== undefined) {
        msg = `Operational field note logged.`;
      }

      setSuccessMessage(msg);
      setActiveNoteIncidentId(null);
      setNoteText("");

      setTimeout(() => setSuccessMessage(null), 4000);
    } catch (err) {
      console.error("Responder update error:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to update incident");
    } finally {
      setActionLoadingId(null);
    }
  };

  // ------------------------------------------------------------
  // COMPUTED COUNTS & FILTERING
  // ------------------------------------------------------------
  const myAssignedCount = useMemo(() => {
    if (!profile?.id) return 0;
    return incidents.filter(
      (inc) =>
        inc.assigned_to === profile.id &&
        inc.status !== "resolved" &&
        inc.status !== "cancelled"
    ).length;
  }, [incidents, profile]);

  const activeCount = useMemo(() => {
    return incidents.filter(
      (inc) => inc.status !== "resolved" && inc.status !== "cancelled"
    ).length;
  }, [incidents]);

  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      // Tab filter
      const st = (inc.status || "reported").toLowerCase();
      if (tab === "assigned_me") {
        if (!profile?.id || inc.assigned_to !== profile.id || st === "resolved" || st === "cancelled") {
          return false;
        }
      } else if (tab === "active") {
        if (st === "resolved" || st === "cancelled") return false;
      } else if (tab === "resolved") {
        if (st !== "resolved") return false;
      }

      // Search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesType = (inc.type || "").toLowerCase().includes(q);
        const matchesDesc = (inc.description || "").toLowerCase().includes(q);
        const matchesNote = (inc.note || "").toLowerCase().includes(q);
        const matchesId = (inc.id || "").toLowerCase().includes(q);
        const matchesResp = (inc.assigned_responder_name || "").toLowerCase().includes(q);
        if (!matchesType && !matchesDesc && !matchesNote && !matchesId && !matchesResp) {
          return false;
        }
      }

      return true;
    });
  }, [incidents, tab, profile, searchQuery]);

  // Lead assignment hero card: pick user's active assignment, or highest priority active incident
  const leadAssignment = useMemo(() => {
    if (profile?.id) {
      const myTask = incidents.find(
        (inc) =>
          inc.assigned_to === profile.id &&
          inc.status !== "resolved" &&
          inc.status !== "cancelled"
      );
      if (myTask) return myTask;
    }

    return (
      incidents.find((inc) => inc.status === "in_progress") ||
      incidents.find((inc) => (inc.severity >= 4 || (inc.priority_score ?? 0) >= 80) && inc.status !== "resolved" && inc.status !== "cancelled") ||
      null
    );
  }, [incidents, profile]);

  // ------------------------------------------------------------
  // ACCESS GUARD
  // ------------------------------------------------------------
  if (userLoading) {
    return (
      <main className="min-h-screen bg-[#070b14] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-orange-500 border-t-transparent animate-spin"></div>
          <p className="text-slate-400 text-xs font-medium">Verifying Responder credentials...</p>
        </div>
      </main>
    );
  }

  if (!isResponder && !isCommandCenter && role !== "admin") {
    return (
      <main className="min-h-screen bg-[#070b14] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-orange-500/30 bg-orange-950/20 p-8 text-center shadow-2xl backdrop-blur">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10 border border-orange-500/30 text-2xl mx-auto mb-4">
            🚒
          </div>
          <h2 className="text-xl font-bold text-orange-300 mb-2">Access Restricted</h2>
          <p className="text-xs text-slate-300 mb-4 leading-relaxed">
            The RescueGrid Field Responder Console is restricted to verified emergency personnel and command dispatchers.
          </p>
          <div className="rounded-xl bg-black/40 border border-white/10 p-3 mb-6 text-xs text-slate-400">
            <span>Your current role: </span>
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
        currentSection="Responder Console"
        actionButton={
          <button
            onClick={fetchIncidents}
            disabled={loading}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 text-xs font-semibold text-orange-300 transition disabled:opacity-50"
          >
            <svg className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Refresh Queue</span>
          </button>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 w-full flex-1 flex flex-col gap-6">
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

        {/* DOMINANT LEAD ASSIGNMENT HERO CARD */}
        {leadAssignment && (
          <section className="rounded-2xl border border-orange-500/30 bg-gradient-to-r from-orange-950/25 via-[#0e1424] to-[#0e1424] p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 transform translate-x-8 -translate-y-8 w-44 h-44 bg-orange-600/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
              <div className="space-y-3 max-w-2xl">
                <div className="flex items-center gap-2 flex-wrap">
                  {leadAssignment.assigned_to === profile?.id ? (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-500/20 text-purple-300 border border-purple-500/40">
                      <span className="h-1.5 w-1.5 rounded-full bg-purple-400 animate-ping"></span>
                      Assigned to You
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/40">
                      <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-ping"></span>
                      Priority Field Deployment
                    </span>
                  )}

                  <PriorityBadge score={leadAssignment.priority_score} tier={leadAssignment.priority_tier} />

                  <span className="text-xs text-slate-500 font-mono">
                    ID: {leadAssignment.id.slice(0, 8)}...
                  </span>
                </div>

                <div className="flex items-center gap-3">
                  <span className="text-3xl">{getTypeIcon(leadAssignment.type)}</span>
                  <div>
                    <h2 className="text-xl font-bold text-white capitalize">
                      {leadAssignment.type}
                    </h2>
                    <div className="flex items-center gap-2 mt-1">
                      <SeverityBadge severity={leadAssignment.severity} size="sm" showScore />
                      <StatusBadge status={leadAssignment.status} size="sm" />
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-200 leading-relaxed bg-white/5 p-3 rounded-xl border border-white/5">
                  {leadAssignment.description || "No situation description recorded."}
                </p>

                {leadAssignment.note && (
                  <div className="text-xs text-orange-200 bg-orange-950/30 p-2.5 rounded-lg border border-orange-500/20 italic">
                    <strong className="text-orange-400 not-italic mr-1.5">Field Note:</strong>
                    &ldquo;{leadAssignment.note}&rdquo;
                  </div>
                )}

                <div className="flex items-center gap-4 text-xs font-mono text-slate-400">
                  <span>📍 {leadAssignment.latitude.toFixed(4)}, {leadAssignment.longitude.toFixed(4)}</span>
                  <span>
                    Reported: {leadAssignment.created_at ? new Date(leadAssignment.created_at).toLocaleTimeString() : ""}
                  </span>
                </div>
              </div>

              {/* ACTION BUTTONS FOR LEAD ASSIGNMENT */}
              <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 min-w-[200px] justify-center">
                {(leadAssignment.status || "").toLowerCase() !== "in_progress" && (
                  <button
                    onClick={() => handleUpdate(leadAssignment.id, "in_progress")}
                    disabled={actionLoadingId === leadAssignment.id}
                    className="w-full rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold py-3 px-4 text-xs transition shadow-lg shadow-orange-950/50 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <span>⚡</span>
                    <span>Start Response (In Progress)</span>
                  </button>
                )}

                {(leadAssignment.status || "").toLowerCase() === "in_progress" && (
                  <button
                    onClick={() => handleUpdate(leadAssignment.id, "resolved")}
                    disabled={actionLoadingId === leadAssignment.id}
                    className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-3 px-4 text-xs transition shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    <span>✓</span>
                    <span>Mark Incident Resolved</span>
                  </button>
                )}

                <button
                  onClick={() => {
                    setActiveNoteIncidentId(leadAssignment.id);
                    setNoteText(leadAssignment.note || "");
                  }}
                  className="w-full rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-200 font-semibold py-2.5 px-4 text-xs transition"
                >
                  {leadAssignment.note ? "Edit Field Note" : "+ Log Field Note"}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* CONTROLS & TABS */}
        <section className="rounded-xl border border-white/10 bg-[#0e1424] p-3.5 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 shadow-md">
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 md:pb-0">
            <button
              onClick={() => setTab("assigned_me")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition flex items-center gap-2 ${
                tab === "assigned_me"
                  ? "bg-purple-600 text-white shadow-md shadow-purple-900/40"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span>👤 Assigned to Me</span>
              <span className="rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] font-mono">
                {myAssignedCount}
              </span>
            </button>

            <button
              onClick={() => setTab("active")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition flex items-center gap-2 ${
                tab === "active"
                  ? "bg-orange-600 text-white shadow-md shadow-orange-900/40"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span>All Active ({activeCount})</span>
            </button>

            <button
              onClick={() => setTab("all")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === "all"
                  ? "bg-orange-600 text-white shadow-md shadow-orange-900/40"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              All Incidents ({incidents.length})
            </button>

            <button
              onClick={() => setTab("resolved")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${
                tab === "resolved"
                  ? "bg-orange-600 text-white shadow-md shadow-orange-900/40"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              Resolved History
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className="relative flex-1 sm:w-60">
              <input
                type="text"
                placeholder="Search emergency queue..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded-lg border border-white/10 bg-[#070b14] pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-orange-500"
              />
              <svg className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </div>
          </div>
        </section>

        {/* INCIDENT CARDS GRID */}
        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-64 rounded-2xl bg-white/[0.02] border border-white/5 animate-pulse" />
            ))}
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center rounded-2xl border border-white/10 bg-[#0e1424] p-8 shadow-sm">
            <span className="text-4xl mb-3">📋</span>
            <h3 className="text-sm font-bold text-white">
              {tab === "assigned_me" ? "No Incidents Assigned to You" : "No Emergency Incidents"}
            </h3>
            <p className="text-xs text-slate-400 mt-1 max-w-sm">
              {tab === "assigned_me"
                ? "You currently have no dispatched incidents. Check 'All Active' for unassigned queue items."
                : "No incidents match your current queue filter."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredIncidents.map((inc) => {
              const isUpdating = actionLoadingId === inc.id;
              const isAddingNote = activeNoteIncidentId === inc.id;
              const currentStatus = (inc.status || "reported").toLowerCase();
              const isAssignedToMe = profile?.id && inc.assigned_to === profile.id;

              return (
                <div
                  key={inc.id}
                  className={`rounded-2xl border ${
                    isAssignedToMe
                      ? "border-purple-500/40 bg-purple-950/10 shadow-lg shadow-purple-950/30"
                      : "border-white/10 bg-[#0e1424]"
                  } p-4 flex flex-col justify-between gap-4 shadow-sm hover:border-white/20 transition`}
                >
                  <div className="space-y-3">
                    {/* Header: Type, ID, Badges */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{getTypeIcon(inc.type)}</span>
                        <div>
                          <h3 className="font-bold text-white text-sm capitalize">
                            {inc.type}
                          </h3>
                          <span className="text-[10px] text-slate-500 font-mono">
                            ID: {inc.id.slice(0, 8)}...
                          </span>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-1">
                        <PriorityBadge score={inc.priority_score} tier={inc.priority_tier} />
                        <StatusBadge status={inc.status} size="sm" showIcon={false} />
                      </div>
                    </div>

                    {/* Assignment Pill */}
                    <div className="flex items-center justify-between text-[11px] bg-white/[0.02] px-2.5 py-1.5 rounded-xl border border-white/5">
                      <span className="text-slate-400 text-[10px] font-bold uppercase tracking-wider">Dispatch State</span>
                      {isAssignedToMe ? (
                        <span className="text-purple-300 font-bold flex items-center gap-1">
                          <span>👤</span>
                          <span>Assigned to You</span>
                        </span>
                      ) : inc.assigned_to ? (
                        <span className="text-slate-300 flex items-center gap-1">
                          <span>👤</span>
                          <span>{inc.assigned_responder_name || "Assigned Unit"}</span>
                        </span>
                      ) : (
                        <span className="text-amber-400/90 font-medium">Unassigned Queue</span>
                      )}
                    </div>

                    {/* Severity & Coordinates */}
                    <div className="flex items-center justify-between border-y border-white/5 py-2 text-xs">
                      <SeverityBadge severity={inc.severity} size="sm" />
                      <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                        <span>📍</span>
                        <span>{inc.latitude.toFixed(3)}, {inc.longitude.toFixed(3)}</span>
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-slate-300 leading-relaxed bg-white/[0.02] p-2.5 rounded-xl border border-white/5 line-clamp-3">
                      {inc.description || "No situation description provided."}
                    </p>

                    {/* Operational Note */}
                    {inc.note && (
                      <div className="rounded-xl bg-orange-950/20 border border-orange-500/20 p-2.5 text-xs text-orange-200/90 space-y-0.5">
                        <span className="text-[10px] uppercase font-bold text-orange-400 block tracking-wider">
                          Field Note:
                        </span>
                        <p className="italic">&ldquo;{inc.note}&rdquo;</p>
                      </div>
                    )}

                    {/* Note editor form */}
                    {isAddingNote && (
                      <div className="rounded-xl bg-black/40 border border-white/10 p-2.5 space-y-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Log Situation Note
                        </span>
                        <textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="e.g. Unit 3 on scene, triage established..."
                          rows={2}
                          className="w-full rounded-lg border border-white/20 bg-[#070b14] p-2 text-xs text-white outline-none focus:border-orange-500 resize-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleUpdate(inc.id, undefined, noteText.trim() || undefined)}
                            disabled={isUpdating}
                            className="rounded-lg bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                          >
                            Save Note
                          </button>
                          <button
                            onClick={() => setActiveNoteIncidentId(null)}
                            className="rounded-lg bg-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/20"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Operational Action Controls (Preserving strict responder permissions: in_progress, resolved) */}
                  <div className="pt-3 border-t border-white/10 space-y-2">
                    <div className="flex items-center gap-2">
                      {currentStatus !== "in_progress" && currentStatus !== "resolved" && (
                        <button
                          onClick={() => handleUpdate(inc.id, "in_progress")}
                          disabled={isUpdating}
                          className="flex-1 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold py-2 px-3 text-xs transition shadow-md shadow-orange-950/50 disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          <span>⚡ Start Response</span>
                        </button>
                      )}

                      {currentStatus === "in_progress" && (
                        <button
                          onClick={() => handleUpdate(inc.id, "resolved")}
                          disabled={isUpdating}
                          className="flex-1 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold py-2 px-3 text-xs transition shadow-md shadow-emerald-950/50 disabled:opacity-50 flex items-center justify-center gap-1.5"
                        >
                          <span>✓ Mark Resolved</span>
                        </button>
                      )}

                      {!isAddingNote && (
                        <button
                          onClick={() => {
                            setActiveNoteIncidentId(inc.id);
                            setNoteText(inc.note || "");
                          }}
                          className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 px-3 py-2 text-xs font-semibold transition"
                        >
                          {inc.note ? "Edit Note" : "+ Note"}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}
