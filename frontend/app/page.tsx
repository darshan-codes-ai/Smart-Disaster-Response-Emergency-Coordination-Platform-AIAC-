"use client";

import { useState } from "react";

const API_URL = "http://localhost:8000";

type Location = {
  lat: number;
  lng: number;
};

export default function Home() {
  const [showEmergency, setShowEmergency] = useState(false);

  const [emergencyType, setEmergencyType] = useState("flood");
  const [description, setDescription] = useState("");

  const [location, setLocation] = useState<Location | null>(null);
  const [locationStatus, setLocationStatus] = useState(
    "Location not detected"
  );

  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  // --------------------------------------------------
  // GET USER LOCATION
  // --------------------------------------------------

  function getLocation() {
    if (!navigator.geolocation) {
      setLocationStatus("Geolocation is not supported");
      return;
    }

    setLocationStatus("Detecting your location...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const detectedLocation = {
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        };

        setLocation(detectedLocation);

        setLocationStatus(
          `${detectedLocation.lat.toFixed(5)}, ${detectedLocation.lng.toFixed(5)}`
        );
      },
      () => {
        setLocationStatus("Unable to detect location");
      }
    );
  }

  // --------------------------------------------------
  // OPEN EMERGENCY FORM
  // --------------------------------------------------

  function openEmergencyForm() {
    setShowEmergency(true);
    setSuccessMessage("");
    setErrorMessage("");
    getLocation();
  }

  // --------------------------------------------------
  // SUBMIT INCIDENT
  // --------------------------------------------------

  async function submitEmergency() {
    setErrorMessage("");
    setSuccessMessage("");

    if (!description.trim()) {
      setErrorMessage("Please describe what happened.");
      return;
    }

    if (!location) {
      setErrorMessage("Please allow location access before submitting.");
      getLocation();
      return;
    }

    try {
      setSubmitting(true);

      const response = await fetch(`${API_URL}/incidents`, {
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
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(
          result.detail || "Failed to submit emergency."
        );
      }

      console.log("Incident created:", result);

      setSuccessMessage(
        `Emergency reported successfully. Incident ID: ${result.data.id}`
      );

      setDescription("");
    } catch (error) {
      console.error(error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Unable to submit emergency."
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 text-white">

      {/* ================================================= */}
      {/* HEADER */}
      {/* ================================================= */}

      <header className="sticky top-0 z-50 border-b border-slate-800 bg-slate-950/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6">

          <div className="flex items-center gap-3">

            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-600 text-xl">
              🚨
            </div>

            <div>
              <h1 className="text-lg font-bold">
                Smart Disaster Response
              </h1>

              <p className="text-xs text-slate-400">
                Emergency Coordination Platform
              </p>
            </div>

          </div>

          <div className="flex items-center gap-3">

            <button className="rounded-lg px-3 py-2 text-sm text-slate-300 hover:bg-slate-800">
              🔔 Alerts
            </button>

            <div className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2">

              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-bold">
                C
              </div>

              <span className="hidden text-sm sm:block">
                Citizen
              </span>

            </div>

          </div>

        </div>
      </header>

      {/* ================================================= */}
      {/* CONTENT */}
      {/* ================================================= */}

      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6">

        {/* CRITICAL ALERT */}

        <section className="mb-6 rounded-2xl border border-red-800 bg-red-950/50 p-5">

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">

            <div>

              <div className="mb-2 flex items-center gap-2">

                <span className="animate-pulse text-red-500">
                  ●
                </span>

                <span className="text-xs font-bold uppercase tracking-wider text-red-400">
                  Critical Alert
                </span>

              </div>

              <h2 className="text-xl font-bold">
                Flash flood warning in your zone
              </h2>

              <p className="mt-1 text-sm text-slate-300">
                Move to higher ground and follow the nearest evacuation route.
              </p>

            </div>

            <button className="rounded-xl bg-red-600 px-5 py-3 font-semibold transition hover:bg-red-500">
              View Alert
            </button>

          </div>

        </section>

        {/* WELCOME */}

        <section className="mb-6">

          <p className="text-sm text-slate-400">
            Citizen Dashboard
          </p>

          <h2 className="mt-1 text-3xl font-bold">
            Stay safe. Get help fast.
          </h2>

          <p className="mt-2 max-w-2xl text-slate-400">
            Report an emergency, find nearby shelters and hospitals,
            and receive real-time disaster information.
          </p>

        </section>

        {/* ================================================= */}
        {/* EMERGENCY BUTTON */}
        {/* ================================================= */}

        <section className="mb-8">

          <button
            onClick={openEmergencyForm}
            className="group flex w-full items-center justify-between rounded-2xl bg-red-600 p-6 text-left shadow-lg shadow-red-950 transition hover:bg-red-500"
          >

            <div className="flex items-center gap-5">

              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-3xl">
                🆘
              </div>

              <div>

                <p className="text-2xl font-bold">
                  Report Emergency
                </p>

                <p className="mt-1 text-sm text-red-100">
                  Share your location and request immediate assistance
                </p>

              </div>

            </div>

            <span className="hidden text-3xl transition group-hover:translate-x-1 sm:block">
              →
            </span>

          </button>

        </section>

        {/* ================================================= */}
        {/* QUICK ACTIONS */}
        {/* ================================================= */}

        <section className="mb-8 grid grid-cols-2 gap-4 md:grid-cols-4">

          <QuickAction
            icon="🗺️"
            title="Disaster Map"
            description="View nearby incidents"
          />

          <QuickAction
            icon="🏠"
            title="Shelters"
            description="Find safe locations"
          />

          <QuickAction
            icon="🏥"
            title="Hospitals"
            description="Find medical help"
          />

          <QuickAction
            icon="🧭"
            title="Evacuation"
            description="View safe routes"
          />

        </section>

        {/* ================================================= */}
        {/* MAIN GRID */}
        {/* ================================================= */}

        <div className="grid gap-6 lg:grid-cols-3">

          {/* MAP */}

          <section className="overflow-hidden rounded-2xl border border-slate-800 bg-slate-900 lg:col-span-2">

            <div className="flex items-center justify-between border-b border-slate-800 p-5">

              <div>

                <h3 className="font-bold">
                  Live Disaster Map
                </h3>

                <p className="text-xs text-slate-400">
                  Your approximate location
                </p>

              </div>

              <span className="rounded-full bg-green-950 px-3 py-1 text-xs text-green-400">
                ● Live
              </span>

            </div>

            <div className="relative h-[420px] overflow-hidden bg-slate-800">

              <div
                className="absolute inset-0 opacity-20"
                style={{
                  backgroundImage:
                    "linear-gradient(#64748b 1px, transparent 1px), linear-gradient(90deg, #64748b 1px, transparent 1px)",
                  backgroundSize: "40px 40px",
                }}
              />

              <div className="absolute left-0 top-1/2 h-3 w-full rotate-6 bg-slate-500/50" />

              <div className="absolute left-1/3 top-0 h-full w-3 -rotate-12 bg-slate-500/50" />

              <MapMarker
                position="left-[27%] top-[30%]"
                color="bg-red-600"
                icon="⚠️"
              />

              <MapMarker
                position="left-[58%] top-[55%]"
                color="bg-orange-500"
                icon="🌊"
              />

              <MapMarker
                position="left-[73%] top-[25%]"
                color="bg-blue-600"
                icon="🏥"
              />

              <MapMarker
                position="left-[68%] top-[75%]"
                color="bg-green-600"
                icon="🏠"
              />

              <div className="absolute left-[45%] top-[48%]">

                <div className="relative flex h-7 w-7 items-center justify-center rounded-full border-4 border-white bg-blue-500 shadow-xl">

                  <div className="absolute h-12 w-12 animate-ping rounded-full bg-blue-500/30" />

                </div>

              </div>

              <div className="absolute bottom-4 left-4 rounded-xl border border-slate-700 bg-slate-950/90 p-3 text-xs backdrop-blur">

                <p className="mb-2 font-semibold">
                  Map Legend
                </p>

                <div className="space-y-1.5 text-slate-300">

                  <LegendItem
                    color="bg-red-600"
                    text="Critical incident"
                  />

                  <LegendItem
                    color="bg-orange-500"
                    text="High-risk incident"
                  />

                  <LegendItem
                    color="bg-blue-600"
                    text="Hospital"
                  />

                  <LegendItem
                    color="bg-green-600"
                    text="Shelter"
                  />

                </div>

              </div>

            </div>

          </section>

          {/* RIGHT COLUMN */}

          <div className="space-y-6">

            {/* INCIDENTS */}

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">

              <div className="mb-4 flex items-center justify-between">

                <h3 className="font-bold">
                  Nearby Incidents
                </h3>

                <button className="text-xs text-blue-400 hover:text-blue-300">
                  View all
                </button>

              </div>

              <Incident
                color="bg-red-600"
                title="People trapped"
                type="Flood"
                distance="1.2 km"
                priority="Critical"
              />

              <Incident
                color="bg-orange-500"
                title="Road blocked"
                type="Flood"
                distance="2.4 km"
                priority="High"
              />

              <Incident
                color="bg-yellow-500"
                title="Water rising"
                type="Flood"
                distance="3.1 km"
                priority="Medium"
              />

            </section>

            {/* SAFETY */}

            <section className="rounded-2xl border border-slate-800 bg-slate-900 p-5">

              <div className="mb-4 flex items-center gap-2">

                <span className="text-xl">
                  🛡️
                </span>

                <h3 className="font-bold">
                  Safety Instructions
                </h3>

              </div>

              <ul className="space-y-3 text-sm text-slate-300">

                <li className="flex gap-3">
                  <span className="text-green-400">✓</span>
                  Move to higher ground during flooding.
                </li>

                <li className="flex gap-3">
                  <span className="text-green-400">✓</span>
                  Do not walk or drive through flood water.
                </li>

                <li className="flex gap-3">
                  <span className="text-green-400">✓</span>
                  Keep your phone charged.
                </li>

                <li className="flex gap-3">
                  <span className="text-green-400">✓</span>
                  Follow official evacuation instructions.
                </li>

              </ul>

            </section>

          </div>

        </div>

        {/* FOOTER */}

        <footer className="mt-10 border-t border-slate-800 py-6 text-center text-xs text-slate-500">

          Smart Disaster Response & Emergency Coordination Platform

          <br />

          AI-assisted decision support — not an official emergency service

        </footer>

      </div>

      {/* ================================================= */}
      {/* EMERGENCY MODAL */}
      {/* ================================================= */}

      {showEmergency && (

        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">

          <div className="w-full max-w-lg rounded-2xl border border-slate-700 bg-slate-900 p-6 shadow-2xl">

            {/* MODAL HEADER */}

            <div className="mb-6 flex items-start justify-between">

              <div>

                <p className="text-sm text-red-400">
                  Emergency Report
                </p>

                <h2 className="mt-1 text-2xl font-bold">
                  What happened?
                </h2>

              </div>

              <button
                onClick={() => setShowEmergency(false)}
                className="rounded-lg px-3 py-2 text-xl text-slate-400 hover:bg-slate-800 hover:text-white"
              >
                ×
              </button>

            </div>

            {/* EMERGENCY TYPE */}

            <label className="mb-2 block text-sm font-medium">
              Emergency type
            </label>

            <select
              value={emergencyType}
              onChange={(e) => setEmergencyType(e.target.value)}
              className="mb-5 w-full rounded-xl border border-slate-700 bg-slate-800 p-3 text-white outline-none focus:border-red-500"
            >

              <option value="flood">
                Flood
              </option>

              <option value="fire">
                Fire
              </option>

              <option value="earthquake">
                Earthquake
              </option>

              <option value="medical">
                Medical Emergency
              </option>

              <option value="building_collapse">
                Building Collapse
              </option>

              <option value="road_accident">
                Road Accident
              </option>

              <option value="other">
                Other
              </option>

            </select>

            {/* DESCRIPTION */}

            <label className="mb-2 block text-sm font-medium">
              Describe the emergency
            </label>

            <textarea
              rows={4}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Tell us what happened..."
              className="mb-5 w-full resize-none rounded-xl border border-slate-700 bg-slate-800 p-3 text-white outline-none placeholder:text-slate-500 focus:border-red-500"
            />

            {/* PHOTO */}

            <div className="mb-5 rounded-xl border border-dashed border-slate-700 p-4 text-center">

              <p className="text-2xl">
                📷
              </p>

              <p className="mt-2 text-sm font-medium">
                Add photo
              </p>

              <p className="text-xs text-slate-500">
                Photo upload will be connected later
              </p>

            </div>

            {/* LOCATION */}

            <div className="mb-5 rounded-xl bg-blue-950/50 p-4">

              <div className="flex items-center justify-between">

                <div>

                  <p className="text-sm font-medium text-blue-300">
                    📍 Location
                  </p>

                  <p className="mt-1 text-xs text-slate-400">
                    {locationStatus}
                  </p>

                </div>

                <button
                  onClick={getLocation}
                  className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold hover:bg-blue-500"
                >
                  Detect
                </button>

              </div>

            </div>

            {/* ERROR */}

            {errorMessage && (

              <div className="mb-4 rounded-xl border border-red-800 bg-red-950/50 p-3 text-sm text-red-300">
                ❌ {errorMessage}
              </div>

            )}

            {/* SUCCESS */}

            {successMessage && (

              <div className="mb-4 rounded-xl border border-green-800 bg-green-950/50 p-3 text-sm text-green-300 break-all">
                ✅ {successMessage}
              </div>

            )}

            {/* SUBMIT */}

            <button
              onClick={submitEmergency}
              disabled={submitting}
              className="w-full rounded-xl bg-red-600 py-3 font-bold transition hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
            >

              {submitting
                ? "Submitting Emergency..."
                : "Submit Emergency Report"}

            </button>

          </div>

        </div>

      )}

    </main>
  );
}


/* ===================================================== */
/* QUICK ACTION */
/* ===================================================== */

function QuickAction({
  icon,
  title,
  description,
}: {
  icon: string;
  title: string;
  description: string;
}) {
  return (
    <button className="rounded-2xl border border-slate-800 bg-slate-900 p-5 text-left transition hover:-translate-y-1 hover:border-slate-600">

      <div className="mb-4 text-2xl">
        {icon}
      </div>

      <p className="font-semibold">
        {title}
      </p>

      <p className="mt-1 text-xs text-slate-500">
        {description}
      </p>

    </button>
  );
}


/* ===================================================== */
/* MAP MARKER */
/* ===================================================== */

function MapMarker({
  position,
  color,
  icon,
}: {
  position: string;
  color: string;
  icon: string;
}) {
  return (
    <div className={`absolute ${position}`}>

      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full ${color} border-2 border-white text-lg shadow-xl`}
      >
        {icon}
      </div>

    </div>
  );
}


/* ===================================================== */
/* MAP LEGEND */
/* ===================================================== */

function LegendItem({
  color,
  text,
}: {
  color: string;
  text: string;
}) {
  return (
    <div className="flex items-center gap-2">

      <span
        className={`h-2.5 w-2.5 rounded-full ${color}`}
      />

      {text}

    </div>
  );
}


/* ===================================================== */
/* INCIDENT */
/* ===================================================== */

function Incident({
  color,
  title,
  type,
  distance,
  priority,
}: {
  color: string;
  title: string;
  type: string;
  distance: string;
  priority: string;
}) {
  return (
    <div className="border-b border-slate-800 py-3 last:border-0">

      <div className="flex items-start gap-3">

        <span
          className={`mt-1.5 h-2.5 w-2.5 rounded-full ${color}`}
        />

        <div className="flex-1">

          <p className="text-sm font-medium">
            {title}
          </p>

          <p className="mt-1 text-xs text-slate-500">
            {type} • {distance}
          </p>

        </div>

        <span className="text-[10px] font-bold uppercase text-slate-400">
          {priority}
        </span>

      </div>

    </div>
  );
}