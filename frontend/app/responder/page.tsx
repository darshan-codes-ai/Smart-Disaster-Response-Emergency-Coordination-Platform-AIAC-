"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { Incident } from "../../components/disaster-map";
import { getAccessToken, requestWithToken } from "../../lib/supabase/access-token";
import { useCurrentUser } from "../../lib/supabase/use-current-user";
import {
  getStatusConfig,
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

export default function ResponderPage() {
  const { profile, role, isResponder, isCommandCenter, loading: userLoading } = useCurrentUser();

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
        let detail = `Error ${res.status}: Failed to load incidents`;
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
  // FILTERING
  // ------------------------------------------------------------
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      const s = (inc.status || "reported").toLowerCase();

      if (tab === "active") {
        // Operational active queue
        if (s === "resolved" || s === "cancelled") return false;
      } else if (tab === "resolved") {
        if (s !== "resolved") return false;
      }

      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchType = inc.type?.toLowerCase().includes(q);
        const matchDesc = inc.description?.toLowerCase().includes(q);
        const matchNote = inc.note?.toLowerCase().includes(q);
        if (!matchType && !matchDesc && !matchNote) return false;
      }

      return true;
    });
  }, [incidents, tab, searchQuery]);

  const activeCount = useMemo(() => {
    return incidents.filter(
      (i) => !["resolved", "cancelled"].includes((i.status || "reported").toLowerCase())
    ).length;
  }, [incidents]);

  // ------------------------------------------------------------
  // ROLE GUARD
  // ------------------------------------------------------------
  if (userLoading) {
    return (
      <main className="min-h-screen bg-[#05070d] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin"></div>
          <p className="text-slate-400 text-sm">Verifying Responder credentials...</p>
        </div>
      </main>
    );
  }

  if (!isResponder && !isCommandCenter) {
    return (
      <main className="min-h-screen bg-[#05070d] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-950/20 p-8 text-center shadow-2xl">
          <div className="text-5xl mb-4">🚑</div>
          <h2 className="text-2xl font-bold text-red-400 mb-2">Access Restricted</h2>
          <p className="text-sm text-slate-300 mb-4">
            The Responder Operations console is restricted to first responders and emergency personnel.
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
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-600/20 border border-orange-500/40 text-xl">
              🚑
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight">AIAC Responder Console</h1>
                <span className="rounded-full bg-orange-500/20 px-2 py-0.5 text-[10px] font-bold text-orange-400 border border-orange-500/30 uppercase tracking-wider">
                  Field Operations
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Live Incident Response, Status Updates & On-Scene Notes
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400 border border-white/10 bg-white/5 rounded-lg px-3 py-1.5">
              <span>Responder:</span>
              <strong className="text-slate-200">{profile?.full_name || profile?.email || "Field Unit"}</strong>
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
        {/* NOTIFICATIONS */}
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

        {/* CONTROLS & TABS */}
        <section className="rounded-xl border border-white/10 bg-[#101522] p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => setTab("active")}
              className={`rounded-lg px-4 py-2 text-xs font-bold transition flex items-center gap-2 ${
                tab === "active"
                  ? "bg-orange-600 text-white shadow-md shadow-orange-900/50"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span>Active Response Queue</span>
              <span className="rounded-full bg-black/30 px-1.5 py-0.5 text-[10px] font-mono">
                {activeCount}
              </span>
            </button>

            <button
              onClick={() => setTab("all")}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                tab === "all"
                  ? "bg-orange-600 text-white"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              All Incidents ({incidents.length})
            </button>

            <button
              onClick={() => setTab("resolved")}
              className={`rounded-lg px-4 py-2 text-xs font-semibold transition ${
                tab === "resolved"
                  ? "bg-orange-600 text-white"
                  : "bg-white/5 text-slate-400 hover:bg-white/10 hover:text-white"
              }`}
            >
              Resolved History
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              placeholder="Search active incidents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded-lg border border-white/10 bg-[#080b14] px-3 py-1.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-orange-500 w-56"
            />
            <button
              onClick={fetchIncidents}
              disabled={loading}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10 hover:text-white transition disabled:opacity-50"
            >
              ↻ Refresh
            </button>
          </div>
        </section>

        {/* INCIDENT CARDS GRID */}
        {loading ? (
          <div className="flex flex-col items-center justify-center py-24 text-slate-400 gap-3">
            <div className="h-8 w-8 rounded-full border-2 border-orange-500 border-t-transparent animate-spin"></div>
            <p className="text-sm">Loading responder queue...</p>
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="rounded-2xl border border-white/10 bg-[#101522] p-16 flex flex-col items-center justify-center text-center text-slate-500">
            <span className="text-4xl mb-2">🛡️</span>
            <p className="text-base font-semibold text-slate-300">No incidents in this queue</p>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              {tab === "active"
                ? "No active emergencies currently require field deployment."
                : "No matching incidents found for the current filter."}
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {filteredIncidents.map((inc) => {
              const statusConfig = getStatusConfig(inc.status);
              const severity = getSeverityBadge(inc.severity);
              const isUpdating = actionLoadingId === inc.id;
              const isAddingNote = activeNoteIncidentId === inc.id;
              const currentStatus = (inc.status || "reported").toLowerCase();

              return (
                <div
                  key={inc.id}
                  className="rounded-2xl border border-white/10 bg-[#101522] p-5 flex flex-col justify-between hover:border-white/20 transition shadow-lg space-y-4"
                >
                  <div className="space-y-3">
                    {/* Header: Type, Severity, Status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="text-2xl">{getTypeIcon(inc.type)}</span>
                        <div>
                          <h3 className="font-bold text-white text-base leading-tight capitalize">
                            {inc.type}
                          </h3>
                          <span className="text-[10px] text-slate-400 font-mono">
                            ID: {inc.id.slice(0, 8)}...
                          </span>
                        </div>
                      </div>

                      <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${statusConfig.badgeClass}`}>
                        <span>{statusConfig.icon}</span>
                        <span>{statusConfig.label}</span>
                      </span>
                    </div>

                    {/* Severity & Coordinates Pill */}
                    <div className="flex items-center justify-between gap-2 border-y border-white/5 py-2 text-xs">
                      <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${severity.cls}`}>
                        {severity.label} ({inc.severity}/5)
                      </span>

                      <span className="text-[11px] font-mono text-slate-400 flex items-center gap-1">
                        <span>📍</span>
                        <span>{inc.latitude.toFixed(4)}, {inc.longitude.toFixed(4)}</span>
                      </span>
                    </div>

                    {/* Description */}
                    <p className="text-xs text-slate-300 leading-relaxed bg-white/[0.02] p-2.5 rounded-lg border border-white/5 line-clamp-3">
                      {inc.description || "No description provided."}
                    </p>

                    {/* Field / Coordinator Note */}
                    {inc.note && (
                      <div className="rounded-lg bg-orange-950/20 border border-orange-500/20 p-2 text-xs text-orange-200/90 space-y-0.5">
                        <span className="text-[10px] uppercase font-bold text-orange-400 block tracking-wider">
                          Operational Note:
                        </span>
                        <p className="italic">{inc.note}</p>
                      </div>
                    )}

                    {/* Note editor form */}
                    {isAddingNote && (
                      <div className="rounded-lg bg-black/40 border border-white/10 p-2.5 space-y-2">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                          Log Field Note
                        </span>
                        <textarea
                          value={noteText}
                          onChange={(e) => setNoteText(e.target.value)}
                          placeholder="E.g. Unit 3 on scene, perimeter secured..."
                          rows={2}
                          className="w-full rounded border border-white/20 bg-[#080b14] p-2 text-xs text-white outline-none focus:border-orange-500 resize-none"
                        />
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => handleUpdate(inc.id, undefined, noteText.trim() || undefined)}
                            disabled={isUpdating}
                            className="rounded bg-orange-600 px-3 py-1 text-xs font-semibold text-white hover:bg-orange-500 disabled:opacity-50"
                          >
                            Save Note
                          </button>
                          <button
                            onClick={() => setActiveNoteIncidentId(null)}
                            className="rounded bg-white/10 px-3 py-1 text-xs text-slate-300 hover:bg-white/20"
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
                      {/* Workflow primary step button */}
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
                          <span>✅ Mark Resolved</span>
                        </button>
                      )}

                      {/* Add Note Button */}
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

                    <div className="flex items-center justify-between text-[10px] text-slate-500 pt-1 font-mono">
                      <span>Reported: {inc.created_at ? new Date(inc.created_at).toLocaleTimeString() : ""}</span>
                      {inc.updated_at && (
                        <span>Updated: {new Date(inc.updated_at).toLocaleTimeString()}</span>
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
