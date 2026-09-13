"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import type { Incident } from "../components/disaster-map";

const DisasterMap = dynamic(() => import("../components/disaster-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] sm:h-[480px] lg:h-[520px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#101522] text-slate-400 shadow-2xl">
      <div className="h-8 w-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin mb-3"></div>
      <p className="text-sm font-medium text-slate-300">Loading Interactive Disaster Map...</p>
      <p className="text-xs text-slate-500 mt-1">Initializing MapLibre GL engine</p>
    </div>
  ),
});

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

type Location = {
  lat: number;
  lng: number;
};

const emergencyTypes = [
  "Flood",
  "Fire",
  "Earthquake",
  "Cyclone",
  "Medical Emergency",
  "Building Collapse",
  "Road Accident",
  "Other",
];

function getSidebarSeverityBadge(severity: number) {
  switch (severity) {
    case 1:
      return {
        label: "Low",
        badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      };
    case 2:
      return {
        label: "Medium",
        badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      };
    case 3:
      return {
        label: "High",
        badgeClass: "bg-orange-500/10 text-orange-400 border-orange-500/20",
      };
    case 4:
    case 5:
    default:
      return {
        label: "Critical",
        badgeClass: "bg-red-500/10 text-red-400 border-red-500/20",
      };
  }
}

function getSidebarTypeIcon(type: string): string {
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

export default function Home() {
  // ============================================================
  // STATE
  // ============================================================

  const [showReportModal, setShowReportModal] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [incidentsList, setIncidentsList] = useState<Incident[]>([]);
  const [mapRefreshTrigger, setMapRefreshTrigger] = useState(0);

  const [emergencyType, setEmergencyType] = useState("Flood");

  const [description, setDescription] = useState("");

  const [location, setLocation] = useState<Location | null>(null);

  const [locationStatus, setLocationStatus] =
    useState("Location not detected");

  const [submitting, setSubmitting] = useState(false);

  const [successMessage, setSuccessMessage] =
    useState("");

  const [errorMessage, setErrorMessage] =
    useState("");

  // ============================================================
  // DETECT LOCATION
  // ============================================================

  const detectLocation = () => {
    setLocationStatus("Detecting location...");
    setErrorMessage("");

    if (!navigator.geolocation) {
      setLocationStatus("Location not supported");
      setErrorMessage(
        "Geolocation is not supported by your browser."
      );
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const newLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setLocation(newLocation);

        setLocationStatus(
          `${newLocation.lat.toFixed(5)}, ${newLocation.lng.toFixed(5)}`
        );
      },

      (error) => {
        console.error("Location error:", error);

        setLocationStatus("Unable to detect location");

        setErrorMessage(
          "Unable to detect your location. Please allow location access and try again."
        );
      },

      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  // ============================================================
  // OPEN EMERGENCY FORM
  // ============================================================

  const openReportModal = () => {
    setShowReportModal(true);

    setSuccessMessage("");
    setErrorMessage("");

    // Automatically request location
    detectLocation();
  };

  // ============================================================
  // CLOSE EMERGENCY FORM
  // ============================================================

  const closeReportModal = () => {
    if (submitting) return;

    setShowReportModal(false);
    setErrorMessage("");
    setSuccessMessage("");
  };

  // ============================================================
  // SUBMIT EMERGENCY
  // ============================================================

  const handleSubmit = async () => {
    setErrorMessage("");
    setSuccessMessage("");

    // Validate description
    if (!description.trim()) {
      setErrorMessage(
        "Please describe the emergency."
      );
      return;
    }

    // Validate location
    if (!location) {
      setErrorMessage(
        "Please detect your location before submitting."
      );
      return;
    }

    setSubmitting(true);

    try {
      // --------------------------------------------------------
      // SEND REQUEST TO FASTAPI
      // --------------------------------------------------------

      const response = await fetch(
        `${API_URL}/incidents`,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
          },

          body: JSON.stringify({
            type: emergencyType,

            description: description.trim(),

            location: {
              lat: location.lat,
              lng: location.lng,
            },

            severity: 3,
          }),
        }
      );

      // --------------------------------------------------------
      // READ RESPONSE
      // --------------------------------------------------------

      const data = await response.json();

      console.log(
        "Backend response:",
        data
      );

      // --------------------------------------------------------
      // HANDLE BACKEND ERROR
      // --------------------------------------------------------

      if (!response.ok) {
        throw new Error(
          data?.detail ||
            "Failed to submit emergency report."
        );
      }

      // --------------------------------------------------------
      // GET INCIDENT ID SAFELY
      // --------------------------------------------------------

      const incidentId =
        data?.incident?.id;

      if (!incidentId) {
        console.error(
          "Unexpected backend response:",
          data
        );

        throw new Error(
          "Emergency was submitted, but no incident ID was returned."
        );
      }

      // --------------------------------------------------------
      // SUCCESS
      // --------------------------------------------------------

      setSuccessMessage(
        `Emergency reported successfully! Incident ID: ${incidentId}`
      );

      // Trigger map refresh to load the new incident immediately
      setMapRefreshTrigger((prev) => prev + 1);

      // Clear description
      setDescription("");

      // Keep modal open so user can see the incident ID
    } catch (error) {
      console.error(
        "Emergency submission error:",
        error
      );

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Something went wrong while submitting the emergency."
      );
    } finally {
      setSubmitting(false);
    }
  };

  // ============================================================
  // MAIN UI
  // ============================================================

  return (
    <main className="min-h-screen bg-[#05070d] text-white">

      {/* ======================================================
          HEADER
      ====================================================== */}

      <header className="border-b border-white/10 bg-[#080b14]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">

          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              🚨 AIAC
            </h1>

            <p className="text-sm text-slate-400">
              Smart Disaster Response & Emergency Coordination
            </p>
          </div>

          <div className="hidden items-center gap-3 md:flex">

            <div className="flex items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-sm text-green-400">
              <span className="h-2 w-2 rounded-full bg-green-400"></span>
              System Online
            </div>

            <button
              onClick={openReportModal}
              className="rounded-lg bg-red-600 px-5 py-2.5 font-semibold transition hover:bg-red-700"
            >
              Report Emergency
            </button>

          </div>

        </div>
      </header>


      {/* ======================================================
          MAIN CONTENT
      ====================================================== */}

      <div className="mx-auto max-w-7xl px-6 py-8">

        {/* ----------------------------------------------------
            CRITICAL ALERT
        ---------------------------------------------------- */}

        <div className="mb-8 rounded-xl border border-red-500/30 bg-red-950/40 p-5">

          <div className="flex items-start gap-4">

            <div className="text-2xl">
              ⚠️
            </div>

            <div>

              <h2 className="font-bold text-red-300">
                Critical Flood Alert
              </h2>

              <p className="mt-1 text-sm text-red-200/80">
                Stay alert and follow local evacuation instructions.
                Emergency services are monitoring the situation.
              </p>

            </div>

          </div>

        </div>


        {/* ----------------------------------------------------
            DASHBOARD TITLE
        ---------------------------------------------------- */}

        <div className="mb-8">

          <p className="mb-2 text-sm font-medium text-blue-400">
            CITIZEN DASHBOARD
          </p>

          <h2 className="text-3xl font-bold">
            Stay Safe. Stay Informed.
          </h2>

          <p className="mt-2 max-w-2xl text-slate-400">
            Report emergencies, find nearby emergency resources,
            and receive important disaster information.
          </p>

        </div>


        {/* ----------------------------------------------------
            REPORT EMERGENCY CARD
        ---------------------------------------------------- */}

        <div className="mb-8 rounded-2xl border border-red-500/20 bg-gradient-to-r from-red-950/50 to-slate-900 p-6">

          <div className="flex flex-col items-start justify-between gap-5 md:flex-row md:items-center">

            <div>

              <div className="mb-2 text-3xl">
                🚨
              </div>

              <h3 className="text-2xl font-bold">
                Are you experiencing an emergency?
              </h3>

              <p className="mt-2 text-slate-400">
                Report the emergency and share your location
                with emergency response teams.
              </p>

            </div>

            <button
              onClick={openReportModal}
              className="w-full rounded-xl bg-red-600 px-7 py-4 font-bold transition hover:bg-red-700 md:w-auto"
            >
              Report Emergency
            </button>

          </div>

        </div>


        {/* ----------------------------------------------------
            QUICK ACTIONS
        ---------------------------------------------------- */}

        <section className="mb-8">

          <h3 className="mb-4 text-xl font-bold">
            Quick Actions
          </h3>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">

            <button
              onClick={() => {
                document.getElementById("disaster-map-section")?.scrollIntoView({ behavior: "smooth" });
              }}
              className="rounded-xl border border-white/10 bg-[#101522] p-5 text-left transition hover:border-blue-500/40 hover:bg-[#151c2c]"
            >
              <div className="mb-3 text-3xl">
                🗺️
              </div>

              <h4 className="font-semibold">
                Disaster Map
              </h4>

              <p className="mt-1 text-sm text-slate-400">
                View nearby emergencies
              </p>

            </button>


            <button className="rounded-xl border border-white/10 bg-[#101522] p-5 text-left transition hover:border-blue-500/40 hover:bg-[#151c2c]">

              <div className="mb-3 text-3xl">
                🏠
              </div>

              <h4 className="font-semibold">
                Shelters
              </h4>

              <p className="mt-1 text-sm text-slate-400">
                Find nearby shelters
              </p>

            </button>


            <button className="rounded-xl border border-white/10 bg-[#101522] p-5 text-left transition hover:border-blue-500/40 hover:bg-[#151c2c]">

              <div className="mb-3 text-3xl">
                🏥
              </div>

              <h4 className="font-semibold">
                Hospitals
              </h4>

              <p className="mt-1 text-sm text-slate-400">
                Find emergency hospitals
              </p>

            </button>


            <button className="rounded-xl border border-white/10 bg-[#101522] p-5 text-left transition hover:border-blue-500/40 hover:bg-[#151c2c]">

              <div className="mb-3 text-3xl">
                🚶
              </div>

              <h4 className="font-semibold">
                Evacuation
              </h4>

              <p className="mt-1 text-sm text-slate-400">
                View evacuation information
              </p>

            </button>

          </div>

        </section>


        {/* ----------------------------------------------------
            MAP + INCIDENTS
        ---------------------------------------------------- */}

        <div id="disaster-map-section" className="grid gap-6 lg:grid-cols-3">

          {/* REAL INTERACTIVE MAP */}
          <div className="lg:col-span-2">
            <DisasterMap
              selectedIncidentId={selectedIncidentId}
              onIncidentSelect={(incident) =>
                setSelectedIncidentId(incident ? incident.id : null)
              }
              onIncidentsLoaded={(incs) => setIncidentsList(incs)}
              refreshTrigger={mapRefreshTrigger}
            />
          </div>

          {/* NEARBY INCIDENTS LIST */}
          <div className="flex flex-col rounded-2xl border border-white/10 bg-[#101522] overflow-hidden max-h-[580px]">

            <div className="border-b border-white/10 p-5 flex items-center justify-between bg-[#0c101c]/80 backdrop-blur">
              <div>
                <h3 className="font-bold text-white">
                  Nearby Incidents
                </h3>
                <p className="text-xs text-slate-400">
                  Real-time emergency feed
                </p>
              </div>

              <span className="rounded-full bg-blue-500/10 px-2.5 py-1 text-xs font-semibold text-blue-400 border border-blue-500/20">
                {incidentsList.length} Total
              </span>
            </div>

            <div className="space-y-3 p-4 overflow-y-auto flex-1">
              {incidentsList.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
                  <span className="text-3xl mb-2">🛡️</span>
                  <p className="font-medium text-slate-400">No active incidents</p>
                  <p className="text-xs mt-1 max-w-[200px]">
                    Use &quot;Report Emergency&quot; above if you are facing an emergency.
                  </p>
                </div>
              ) : (
                incidentsList.map((inc) => {
                  const isSelected = selectedIncidentId === inc.id;
                  const config = getSidebarSeverityBadge(inc.severity);
                  const typeIcon = getSidebarTypeIcon(inc.type);

                  return (
                    <button
                      key={inc.id}
                      type="button"
                      onClick={() =>
                        setSelectedIncidentId((prev) =>
                          prev === inc.id ? null : inc.id
                        )
                      }
                      className={`w-full text-left rounded-xl border p-4 transition-all duration-150 ${
                        isSelected
                          ? "border-blue-500/80 bg-blue-950/40 ring-2 ring-blue-500/50 shadow-lg shadow-blue-950/50"
                          : "border-white/5 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.06]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-white flex items-center gap-1.5 text-sm">
                          <span>{typeIcon}</span>
                          <span className="truncate">{inc.type}</span>
                        </span>

                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${config.badgeClass}`}
                        >
                          {config.label}
                        </span>
                      </div>

                      <p className="mt-2 text-xs text-slate-300 line-clamp-2 leading-relaxed">
                        {inc.description || "No description provided."}
                      </p>

                      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-slate-400">
                        <span className="flex items-center gap-1">
                          <span>Status:</span>
                          <strong className="text-slate-200 capitalize font-medium">
                            {inc.status || "Reported"}
                          </strong>
                        </span>

                        <span className="font-mono text-slate-400">
                          {typeof inc.latitude === "number" &&
                          typeof inc.longitude === "number"
                            ? `${inc.latitude.toFixed(3)}, ${inc.longitude.toFixed(3)}`
                            : "No coords"}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>

          </div>

        </div>


        {/* ----------------------------------------------------
            SAFETY INFORMATION
        ---------------------------------------------------- */}

        <section className="mt-8 rounded-2xl border border-white/10 bg-[#101522] p-6">

          <h3 className="mb-5 text-xl font-bold">
            🛡️ Emergency Safety Instructions
          </h3>

          <div className="grid gap-4 md:grid-cols-3">

            <div>

              <h4 className="font-semibold text-blue-300">
                Stay Informed
              </h4>

              <p className="mt-2 text-sm text-slate-400">
                Follow official emergency alerts and instructions
                from local authorities.
              </p>

            </div>


            <div>

              <h4 className="font-semibold text-green-300">
                Stay Safe
              </h4>

              <p className="mt-2 text-sm text-slate-400">
                Move to a safe location and avoid dangerous
                or flooded areas.
              </p>

            </div>


            <div>

              <h4 className="font-semibold text-orange-300">
                Help Others
              </h4>

              <p className="mt-2 text-sm text-slate-400">
                Help children, elderly people, and vulnerable
                individuals when it is safe to do so.
              </p>

            </div>

          </div>

        </section>

      </div>


      {/* ======================================================
          EMERGENCY REPORT MODAL
      ====================================================== */}

      {showReportModal && (

        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/80 p-4 backdrop-blur-sm">

          <div className="w-full max-w-2xl rounded-2xl border border-white/10 bg-[#0d1424] shadow-2xl">

            {/* ------------------------------------------------
                MODAL HEADER
            ------------------------------------------------ */}

            <div className="flex items-center justify-between border-b border-white/10 p-6">

              <div>

                <p className="text-sm font-medium text-red-400">
                  EMERGENCY REPORT
                </p>

                <h2 className="mt-1 text-2xl font-bold">
                  Report an Emergency
                </h2>

              </div>

              <button
                onClick={closeReportModal}
                disabled={submitting}
                className="rounded-lg px-3 py-2 text-2xl text-slate-400 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
              >
                ×
              </button>

            </div>


            {/* ------------------------------------------------
                MODAL BODY
            ------------------------------------------------ */}

            <div className="space-y-6 p-6">

              {/* Emergency Type */}

              <div>

                <label className="mb-2 block text-sm font-medium">
                  Emergency type
                </label>

                <select
                  value={emergencyType}
                  onChange={(e) =>
                    setEmergencyType(e.target.value)
                  }
                  disabled={submitting}
                  className="w-full rounded-xl border border-white/10 bg-[#1c293e] px-4 py-4 text-white outline-none transition focus:border-blue-500 disabled:opacity-50"
                >

                  {emergencyTypes.map((type) => (
                    <option
                      key={type}
                      value={type}
                      className="bg-[#1c293e]"
                    >
                      {type}
                    </option>
                  ))}

                </select>

              </div>


              {/* Description */}

              <div>

                <label className="mb-2 block text-sm font-medium">
                  Describe the emergency
                </label>

                <textarea
                  value={description}
                  onChange={(e) =>
                    setDescription(e.target.value)
                  }
                  disabled={submitting}
                  rows={5}
                  placeholder="Describe what happened, how many people are affected, and any other important information..."
                  className="w-full resize-none rounded-xl border border-white/10 bg-[#1c293e] px-4 py-4 text-white outline-none placeholder:text-slate-500 focus:border-blue-500 disabled:opacity-50"
                />

              </div>


              {/* Photo */}

              <div>

                <div className="flex h-36 cursor-not-allowed flex-col items-center justify-center rounded-xl border border-dashed border-white/20 bg-[#0e1729]">

                  <div className="text-3xl">
                    📷
                  </div>

                  <p className="mt-2 font-medium">
                    Add photo
                  </p>

                  <p className="mt-1 text-sm text-slate-500">
                    Photo upload will be connected later
                  </p>

                </div>

              </div>


              {/* Location */}

              <div className="rounded-xl bg-[#14234d] p-5">

                <div className="flex items-center justify-between gap-4">

                  <div>

                    <div className="flex items-center gap-2">

                      <span className="text-xl">
                        📍
                      </span>

                      <span className="font-semibold text-blue-200">
                        Location
                      </span>

                    </div>

                    <p className="mt-2 text-sm text-slate-400">
                      {location
                        ? `${location.lat.toFixed(5)}, ${location.lng.toFixed(5)}`
                        : locationStatus}
                    </p>

                  </div>


                  <button
                    onClick={detectLocation}
                    disabled={submitting}
                    className="rounded-lg bg-blue-600 px-5 py-3 font-semibold transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Detect
                  </button>

                </div>

              </div>


              {/* Success */}

              {successMessage && (

                <div className="rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-green-300">

                  <div className="font-semibold">
                    ✅ {successMessage}
                  </div>

                  <p className="mt-2 text-sm text-green-300/70">
                    Your emergency report has been saved.
                    Emergency response teams can now process
                    the incident.
                  </p>

                </div>

              )}


              {/* Error */}

              {errorMessage && (

                <div className="rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-red-300">

                  <div className="font-semibold">
                    ❌ {errorMessage}
                  </div>

                </div>

              )}


              {/* Submit */}

              <button
                onClick={handleSubmit}
                disabled={submitting}
                className="w-full rounded-xl bg-red-600 px-6 py-4 text-lg font-bold transition hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-red-900"
              >

                {submitting
                  ? "Submitting Emergency Report..."
                  : "Submit Emergency Report"}

              </button>


              <p className="text-center text-xs text-slate-500">
                Your location will be shared with emergency
                response services for coordination purposes.
              </p>

            </div>

          </div>

        </div>

      )}

    </main>
  );
}