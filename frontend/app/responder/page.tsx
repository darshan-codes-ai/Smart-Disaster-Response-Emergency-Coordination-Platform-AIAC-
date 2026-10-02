"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Incident } from "../../components/disaster-map";
import { getAccessToken, requestWithToken } from "../../lib/supabase/access-token";
import { useCurrentUser } from "../../lib/supabase/use-current-user";
import Navbar from "../../components/navbar";
import StatusBadge from "../../components/status-badge";
import SeverityBadge from "../../components/severity-badge";
import { getStatusConfig } from "../../lib/status-workflow";

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

export default function ResponderPage() {
  const { role, isResponder, isCommandCenter, loading: userLoading } = useCurrentUser();

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"active" | "all" | "resolved">("active");
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
    if (!userLoading && (isResponder || isCommandCenter)) {
      Promise.resolve().then(() => {
        if (!ignore) {
          fetchIncidents();
        }
      });
    }
    return () => {
      ignore = true;
    };
  }, [userLoading, isResponder, isCommandCenter, fetchIncidents]);

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

      const payload: { status?: string; note?: string } = {};
      if (newStatus !== undefined) payload.status = newStatus;
      if (newNote !== undefined) payload.note = newNote;

      let res = await requestWithToken(`${API_URL}/incidents/${incidentId}`, token, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });

      if (res.status === 401) {
        const freshToken = await getAccessToken(true);
        if (freshToken) {
          res = await requestWithToken(`${API_URL}/incidents/${incidentId}`, freshToken, {
            method: "PATCH",
            body: JSON.stringify(payload),
          });
        }
      }

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data?.detail || "Failed to update incident");
      }

      const updated: Incident = data.incident;
      setIncidents((prev) =>
        prev.map((i) => (i.id === incidentId ? updated : i))
      );

      setSuccessMessage(
        newStatus
          ? `Status updated to "${getStatusConfig(updated.status).label}"`
          : "Field note recorded successfully."
      );
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
  // FILTERING & QUEUE
  // ------------------------------------------------------------
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      const s = (inc.status || "reported").toLowerCase();

      if (tab === "active") {
        if (s === "resolved" || s === "cancelled") return false;
      } else if (tab === "resolved") {
        if (s !== "resolved") return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchType = inc.type?.toLowerCase().includes(q);
        const matchDesc = inc.description?.toLowerCase().includes(q);
        const matchNote = inc.note?.toLowerCase().includes(q);
        const matchId = inc.id?.toLowerCase().includes(q);
        if (!matchType && !matchDesc && !matchNote && !matchId) return false;
      }

      return true;
    });
  }, [incidents, tab, searchQuery]);

  const activeCount = useMemo(() => {
    return incidents.filter(
      (i) => !["resolved", "cancelled"].includes((i.status || "reported").toLowerCase())
    ).length;
  }, [incidents]);

  const leadAssignment = useMemo(() => {
    // Look for in_progress first, then assigned, then highest severity
    const activeOnes = incidents.filter(
      (i) => !["resolved", "cancelled"].includes((i.status || "reported").toLowerCase())
    );
    if (activeOnes.length === 0) return null;

    const inProg = activeOnes.find((i) => (i.status || "").toLowerCase() === "in_progress");
    if (inProg) return inProg;

    const assigned = activeOnes.find((i) => (i.status || "").toLowerCase() === "assigned");
    if (assigned) return assigned;

    return activeOnes.sort((a, b) => (b.severity || 1) - (a.severity || 1))[0];
  }, [incidents]);

  // ------------------------------------------------------------
  // ROLE GUARD & ACCESS RESTRICTED SCREEN
  // ------------------------------------------------------------
  if (userLoading) {
    return (
      <main className="min-h-screen bg-[#070b14] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-orange-500 border-t-transparent animate-spin"></div>
          <p className="text-slate-400 text-sm font-medium">Verifying Responder credentials...</p>
        </div>
      </main>
    );
  }

  if (!isResponder && !isCommandCenter) {
    return (
      <main className="min-h-screen bg-[#070b14] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-orange-500/30 bg-[#0e1424] p-8 text-center shadow-2xl space-y-5">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-orange-500/10 border border-orange-500/30 text-2xl text-orange-400">
            🚑
          </div>
          <div>
            <h1 className="text-lg font-extrabold tracking-wider text-white">
              RESCUE<span className="text-sky-400">GRID</span>
            </h1>
            <h2 className="text-xl font-bold text-slate-100 mt-2">Responder Console Restricted</h2>
            <p className="text-xs text-slate-400 mt-2 leading-relaxed">
              The Responder Console is restricted to field rescue teams, medical personnel, and emergency first responders.
            </p>
          </div>

          <div className="rounded-xl bg-black/40 border border-white/10 p-3 text-xs text-slate-400 flex items-center justify-between">
            <span>Your Current Role:</span>
            <span className="font-mono font-bold text-orange-300 uppercase">{role}</span>
          </div>

          <div className="flex flex-col gap-2 pt-2">
            <Link
              href="/"
              className="w-full rounded-xl bg-orange-600 hover:bg-orange-500 px-4 py-2.5 font-semibold text-xs text-white transition shadow-md shadow-orange-900/40"
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

        {/* DOMINANT "CURRENT RESPONSE ASSIGNMENT" HERO CARD */}
        {leadAssignment && (
          <section className="rounded-2xl border border-orange-500/30 bg-gradient-to-r from-orange-950/25 via-[#0e1424] to-[#0e1424] p-6 shadow-2xl relative overflow-hidden">
            <div className="absolute top-0 right-0 transform translate-x-8 -translate-y-8 w-44 h-44 bg-orange-600/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
              <div className="space-y-3 max-w-2xl">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-orange-500/20 text-orange-300 border border-orange-500/40">
                    <span className="h-1.5 w-1.5 rounded-full bg-orange-400 animate-ping"></span>
                    Priority Response Deployment
                  </span>
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
              onClick={() => setTab("active")}
              className={`rounded-lg px-3.5 py-1.5 text-xs font-bold transition flex items-center gap-2 ${
                tab === "active"
                  ? "bg-orange-600 text-white shadow-md shadow-orange-900/40"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span>Active Response Queue</span>
              <span className="rounded-full bg-black/40 px-1.5 py-0.5 text-[10px] font-mono">
                {activeCount}
              </span>
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
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="animate-pulse rounded-2xl border border-white/5 bg-[#0e1424] p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="h-4 w-32 bg-white/10 rounded"></div>
                  <div className="h-4 w-16 bg-white/10 rounded-full"></div>
                </div>
                <div className="h-10 bg-white/5 rounded-xl"></div>
                <div className="h-8 bg-white/5 rounded-xl"></div>
              </div>
            ))}
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#0e1424] p-16 flex flex-col items-center justify-center text-center text-slate-500">
            <span className="text-4xl mb-3">🛡️</span>
            <p className="text-base font-semibold text-slate-200">No Incidents in this Queue</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm leading-relaxed">
              {tab === "active"
                ? "All emergencies have been handled. No active deployments pending."
                : "No matching records found for current criteria."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredIncidents.map((inc) => {
              const isUpdating = actionLoadingId === inc.id;
              const isAddingNote = activeNoteIncidentId === inc.id;
              const currentStatus = (inc.status || "reported").toLowerCase();

              return (
                <div
                  key={inc.id}
                  className="rounded-2xl border border-white/10 bg-[#0e1424] p-5 flex flex-col justify-between hover:border-white/20 transition shadow-lg space-y-4"
                >
                  <div className="space-y-3">
                    {/* Header: Type, Severity, Status */}
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

                      <div className="flex items-center gap-1.5">
                        <SeverityBadge severity={inc.severity} size="sm" />
                        <StatusBadge status={inc.status} size="sm" showIcon={false} />
                      </div>
                    </div>

                    {/* Coordinates & Timestamp */}
                    <div className="flex items-center justify-between border-y border-white/5 py-2 text-xs">
                      <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                        <span>📍</span>
                        <span>{inc.latitude.toFixed(4)}, {inc.longitude.toFixed(4)}</span>
                      </span>

                      <span className="text-[10px] text-slate-500">
                        {inc.created_at ? new Date(inc.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
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

                  {/* Operational Action Controls */}
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
                          className="rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-slate-300 font-semibold py-2 px-3 text-xs transition"
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

