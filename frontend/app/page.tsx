"use client";

import { FormEvent, useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { getAccessToken, requestWithToken } from "../lib/supabase/access-token";
import { useCurrentUser } from "../lib/supabase/use-current-user";
import type { Incident } from "../components/disaster-map";
import Navbar from "../components/navbar";
import StatusBadge from "../components/status-badge";
import SeverityBadge from "../components/severity-badge";

const DisasterMap = dynamic(() => import("../components/disaster-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] sm:h-[480px] lg:h-[540px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#0c1220] text-slate-400 shadow-2xl">
      <div className="h-8 w-8 rounded-full border-2 border-sky-500 border-t-transparent animate-spin mb-3"></div>
      <p className="text-sm font-semibold text-slate-200">Loading Geospatial Engine...</p>
      <p className="text-xs text-slate-500 mt-1">Initializing MapLibre GL telemetry layer</p>
    </div>
  ),
});

interface Location {
  latitude: number;
  longitude: number;
}

const emergencyTypes = [
  "Flood",
  "Fire",
  "Earthquake",
  "Cyclone",
  "Medical Emergency",
  "Building Collapse",
  "Road Accident",
] as const;

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

export default function Home() {
  const { profile, isCommandCenter, isResponder } = useCurrentUser();
  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [incidentsList, setIncidentsList] = useState<Incident[]>([]);
  const [mapRefreshTrigger, setMapRefreshTrigger] = useState(0);

  const [emergencyType, setEmergencyType] = useState("Flood");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState<Location | null>(null);
  const [locationStatus, setLocationStatus] = useState("Location not detected");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [feedFilter, setFeedFilter] = useState<"all" | "my">("all");

  const detectLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("Geolocation is not supported by your browser");
      return;
    }

    setLocationStatus("Detecting current coordinates...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        setLocationStatus("GPS coordinates locked successfully");
      },
      (err) => {
        console.warn("Geolocation prompt error:", err.message);
        setLocationStatus("Unable to retrieve location. Set manually or check GPS permissions.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, []);

  const openReportModal = useCallback(() => {
    setShowReportModal(true);
    setErrorMessage(null);
    if (!location) {
      detectLocation();
    }
  }, [detectLocation, location]);

  const handleIncidentsLoaded = useCallback((incs: Incident[]) => {
    setIncidentsList(incs);
  }, []);

  const handleSubmitReport = async (e: FormEvent) => {
    e.preventDefault();
    if (!location) {
      setErrorMessage("Please allow location detection or provide valid coordinates.");
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      // Submit through FastAPI so authentication, ownership, priority scoring,
      // and database writes all use the same backend workflow.
      let accessToken = await getAccessToken();

      if (!accessToken) {
        throw new Error("Your login session has expired. Please log in again.");
      }

      const payload = {
        type: emergencyType,
        description: description.trim() || `${emergencyType} reported by citizen`,
        location: {
          lat: location.latitude,
          lng: location.longitude,
        },
        severity:
          emergencyType === "Medical Emergency" ||
          emergencyType === "Building Collapse"
            ? 4
            : 3,
      };

      const submitIncident = (token: string) =>
        requestWithToken(`${process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"}/incidents`, token, {
          method: "POST",
          body: JSON.stringify(payload),
        });

      let response = await submitIncident(accessToken);

      if (response.status === 401) {
        accessToken = await getAccessToken(true);

        if (!accessToken) {
          throw new Error("Your login session has expired. Please log in again.");
        }

        response = await submitIncident(accessToken);
      }

      if (!response.ok) {
        let detail = `Failed to record incident (HTTP ${response.status})`;
        try {
          const errorData = await response.json();
          if (errorData?.detail) detail = errorData.detail;
        } catch {
          // Keep the HTTP fallback message.
        }
        throw new Error(detail);
      }

      const result = await response.json();
      const createdIncident = result?.incident;

      setShowReportModal(false);
      setDescription("");
      setSuccessMessage("Emergency incident registered on RescueGrid. Dispatch teams alerted.");
      setMapRefreshTrigger((prev) => prev + 1);

      if (createdIncident?.id) {
        setSelectedIncidentId(createdIncident.id);
      }

      setTimeout(() => setSuccessMessage(null), 5000);
    } catch (err) {
      console.error(
        "Incident reporting error:",
        err instanceof Error ? err.message : err
      );
      setErrorMessage(
        err instanceof Error ? err.message : "Failed to record incident"
      );
    } finally {
      setSubmitting(false);
    }
  };
  const stats = useMemo(() => {
    const total = incidentsList.length;
    let active = 0;
    let reported = 0;
    let resolved = 0;
    let critical = 0;

    incidentsList.forEach((inc) => {
      const st = (inc.status || "reported").toLowerCase();
      if (st !== "resolved" && st !== "cancelled") active++;
      if (st === "reported") reported++;
      if (st === "resolved") resolved++;
      if (typeof inc.severity === "number" && inc.severity >= 4) critical++;
    });

    return { total, active, reported, resolved, critical };
  }, [incidentsList]);

  const displayedIncidents = useMemo(() => {
    if (feedFilter === "my" && profile?.id) {
      return incidentsList.filter((inc) => inc.user_id === profile.id);
    }
    return incidentsList;
  }, [incidentsList, feedFilter, profile]);

  return (
    <main className="min-h-screen bg-[#070b14] text-white flex flex-col">
      <Navbar
        currentSection="Citizen Dashboard"
        actionButton={
          <button
            onClick={openReportModal}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-bold text-white transition shadow-md shadow-red-950/40"
          >
            <span>🚨</span>
            <span>Report Incident</span>
          </button>
        }
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 py-6 w-full flex-1 flex flex-col gap-6">
        {/* HERO GREETING & SYSTEM BANNER */}
        <section className="rounded-2xl border border-white/10 bg-gradient-to-r from-[#0d1424] via-[#09101d] to-[#0d1424] p-6 shadow-xl flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <span className="inline-block h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
                Emergency System Operational
              </span>
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Welcome back, {profile?.full_name || "Citizen Responder"}
            </h1>
            <p className="text-xs text-slate-400 max-w-2xl">
              Monitor nearby active disaster response activity, review your reported incidents, or immediately submit a new crisis report with GPS coordinates.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            {isCommandCenter && (
              <Link
                href="/command"
                className="rounded-xl border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 px-3.5 py-2 text-xs font-semibold text-sky-300 transition flex items-center gap-1.5"
              >
                <span>🛡️</span>
                <span>Command HQ</span>
              </Link>
            )}
            {isResponder && (
              <Link
                href="/responder"
                className="rounded-xl border border-orange-500/30 bg-orange-500/10 hover:bg-orange-500/20 px-3.5 py-2 text-xs font-semibold text-orange-300 transition flex items-center gap-1.5"
              >
                <span>🚑</span>
                <span>Responder Console</span>
              </Link>
            )}
            <button
              onClick={openReportModal}
              className="rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs px-4 py-2 transition shadow-lg shadow-red-950/50 flex items-center gap-1.5"
            >
              <span>🚨</span>
              <span>Report Emergency</span>
            </button>
          </div>
        </section>

        {/* FEEDBACK TOASTS */}
        {successMessage && (
          <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-950/80 p-4 text-xs text-emerald-200 flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-2">
              <span className="text-base">✓</span>
              <span className="font-semibold">{successMessage}</span>
            </div>
            <button onClick={() => setSuccessMessage(null)} className="text-emerald-400 hover:text-white px-2 text-lg font-bold">×</button>
          </div>
        )}

        {errorMessage && (
          <div role="alert" className="rounded-xl border border-red-500/30 bg-red-950/80 p-4 text-xs text-red-200 flex items-center justify-between shadow-xl">
            <div className="flex items-center gap-2">
              <span className="text-base">⚠️</span>
              <span className="font-semibold">{errorMessage}</span>
            </div>
            <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-white px-2 text-lg font-bold">×</button>
          </div>
        )}

        {/* 4 KPI SUMMARY CARDS */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <div className="rounded-xl border border-white/10 bg-[#0e1424] p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider">Active Incidents</span>
            <p className="mt-1 text-2xl font-extrabold text-white">{stats.active}</p>
            <span className="text-[10px] text-slate-500">In triage or field response</span>
          </div>

          <div className="rounded-xl border border-red-500/20 bg-red-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-red-400 uppercase tracking-wider">Critical Priority</span>
            <p className="mt-1 text-2xl font-extrabold text-red-300">{stats.critical}</p>
            <span className="text-[10px] text-red-400/60">Requires immediate attention</span>
          </div>

          <div className="rounded-xl border border-amber-500/20 bg-amber-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider">Awaiting Dispatch</span>
            <p className="mt-1 text-2xl font-extrabold text-amber-300">{stats.reported}</p>
            <span className="text-[10px] text-amber-400/60">Newly reported crises</span>
          </div>

          <div className="rounded-xl border border-emerald-500/20 bg-emerald-950/20 p-4 shadow-sm">
            <span className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider">Resolved Emergencies</span>
            <p className="mt-1 text-2xl font-extrabold text-emerald-300">{stats.resolved}</p>
            <span className="text-[10px] text-emerald-400/60">Cleared &amp; verified safe</span>
          </div>
        </section>

        {/* PROMINENT EMERGENCY REPORT CARD */}
        <section className="rounded-2xl border border-red-500/20 bg-gradient-to-r from-red-950/20 via-[#0e1424] to-[#0e1424] p-5 shadow-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-600/20 border border-red-500/40 text-2xl text-red-400">
              🚨
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Witnessing an Emergency or Natural Hazard?</h2>
              <p className="text-xs text-slate-300 mt-0.5">
                Every second matters. Submit real-time coordinates, hazard type, and brief situation notes.
              </p>
            </div>
          </div>
          <button
            onClick={openReportModal}
            className="rounded-xl bg-red-600 hover:bg-red-500 px-5 py-2.5 font-bold text-xs text-white transition shadow-lg shadow-red-950/50 whitespace-nowrap"
          >
            Report Incident Now →
          </button>
        </section>

        {/* SPLIT WORKSPACE: MAP (LEFT) & FEED (RIGHT) */}
        <section className="grid gap-6 lg:grid-cols-3 flex-1 items-start">
          {/* MAP */}
          <div className="lg:col-span-2 flex flex-col rounded-2xl border border-white/10 bg-[#0e1424] overflow-hidden shadow-xl">
            <div className="flex items-center justify-between border-b border-white/10 px-5 py-3.5 bg-[#0a0f1d]">
              <div className="flex items-center gap-2">
                <div className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse"></div>
                <h2 className="text-sm font-bold text-white tracking-wide">Live Response Map</h2>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                {incidentsList.length} total incidents pinned
              </span>
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

          {/* FEED */}
          <div className="flex flex-col rounded-2xl border border-white/10 bg-[#0e1424] overflow-hidden shadow-xl h-[580px]">
            {/* TABS */}
            <div className="border-b border-white/10 px-4 py-3 bg-[#0a0f1d] flex items-center justify-between">
              <div className="flex rounded-lg bg-black/40 border border-white/5 p-1 gap-1">
                <button
                  onClick={() => setFeedFilter("all")}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                    feedFilter === "all"
                      ? "bg-sky-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  All ({incidentsList.length})
                </button>
                <button
                  onClick={() => setFeedFilter("my")}
                  className={`rounded-md px-3 py-1 text-xs font-semibold transition ${
                    feedFilter === "my"
                      ? "bg-sky-600 text-white"
                      : "text-slate-400 hover:text-white"
                  }`}
                >
                  My Reports
                </button>
              </div>

              <Link
                href="/incidents"
                className="text-xs font-semibold text-sky-400 hover:text-sky-300"
              >
                Directory →
              </Link>
            </div>

            {/* LIST */}
            <div className="flex-1 space-y-2.5 overflow-y-auto p-3.5">
              {displayedIncidents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-20 text-center text-slate-500 px-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-2xl mb-3">
                    📋
                  </div>
                  <p className="font-semibold text-slate-300 text-sm">
                    {feedFilter === "my" ? "You Have No Submitted Reports" : "No Incidents Recorded"}
                  </p>
                  <p className="text-xs text-slate-500 mt-1 max-w-[200px]">
                    {feedFilter === "my"
                      ? "Incidents you report will appear here."
                      : "Emergency incidents will appear on the live feed."}
                  </p>
                </div>
              ) : (
                displayedIncidents.map((inc) => {
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
                        {inc.description || "No situation details provided."}
                      </p>

                      <div className="mt-2 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-slate-400">
                        <span className="font-mono flex items-center gap-1">
                          <span>📍</span>
                          <span>{inc.latitude.toFixed(3)}, {inc.longitude.toFixed(3)}</span>
                        </span>
                        <span>
                          {inc.created_at ? new Date(inc.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
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

      {/* REPORT EMERGENCY MODAL */}
      {showReportModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-2xl border border-white/15 bg-[#0d1424] p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-start justify-between border-b border-white/10 pb-4">
              <div>
                <span className="text-[11px] font-bold text-red-400 uppercase tracking-wider">
                  Emergency Situation Dispatch
                </span>
                <h3 className="text-xl font-bold text-white mt-0.5">Submit Incident Report</h3>
              </div>
              <button
                onClick={() => setShowReportModal(false)}
                aria-label="Close modal"
                className="text-slate-400 hover:text-white text-2xl px-2"
              >
                ×
              </button>
            </div>

            <form onSubmit={handleSubmitReport} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Hazard / Emergency Type
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {emergencyTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => setEmergencyType(type)}
                      className={`p-2 rounded-xl border text-xs font-semibold flex items-center gap-2 transition text-left ${
                        emergencyType === type
                          ? "border-red-500 bg-red-950/40 text-white"
                          : "border-white/10 bg-white/5 text-slate-300 hover:bg-white/10"
                      }`}
                    >
                      <span className="text-base">{getTypeIcon(type)}</span>
                      <span className="truncate">{type}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Situation Description
                </label>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Describe trapped victims, hazards, water levels, access routes..."
                  rows={3}
                  required
                  className="w-full rounded-xl border border-white/10 bg-[#070b14] p-3 text-xs text-white placeholder:text-slate-500 outline-none focus:border-red-500 resize-none"
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-semibold text-slate-300">
                    Incident Coordinates (GPS)
                  </label>
                  <button
                    type="button"
                    onClick={detectLocation}
                    className="text-[11px] text-sky-400 hover:text-sky-300 font-semibold"
                  >
                    ↻ Re-detect GPS
                  </button>
                </div>

                <div className="rounded-xl border border-white/10 bg-[#070b14] p-3 text-xs flex items-center justify-between">
                  <span className="font-mono text-slate-300">
                    {location
                      ? `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`
                      : "No coordinates detected"}
                  </span>
                  <span className="text-[10px] text-slate-500">{locationStatus}</span>
                </div>
              </div>

              <div className="pt-2 flex items-center justify-end gap-2 border-t border-white/10">
                <button
                  type="button"
                  onClick={() => setShowReportModal(false)}
                  className="rounded-xl bg-white/10 px-4 py-2.5 text-xs font-semibold text-slate-300 hover:bg-white/20 transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !location}
                  className="rounded-xl bg-red-600 hover:bg-red-500 text-white font-bold text-xs px-5 py-2.5 transition shadow-lg shadow-red-950/50 disabled:opacity-50 flex items-center gap-1.5"
                >
                  {submitting && (
                    <div className="h-3 w-3 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
                  )}
                  <span>{submitting ? "Broadcasting..." : "Confirm & Broadcast Emergency"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
