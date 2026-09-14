"use client";

import { useCallback, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { Incident } from "../../components/disaster-map";

const DisasterMap = dynamic(() => import("../../components/disaster-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[420px] sm:h-[480px] lg:h-[520px] w-full flex-col items-center justify-center rounded-2xl border border-white/10 bg-[#101522] text-slate-400 shadow-2xl">
      <div className="h-8 w-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin mb-3"></div>
      <p className="text-sm font-medium text-slate-300">Loading Interactive Disaster Map...</p>
      <p className="text-xs text-slate-500 mt-1">Initializing MapLibre GL engine</p>
    </div>
  ),
});

const severityValues = [1, 2, 3, 4, 5] as const;

function getSeverityBadge(severity: number) {
  switch (severity) {
    case 1:
      return { label: "Low", cls: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" };
    case 2:
      return { label: "Medium", cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" };
    case 3:
      return { label: "High", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" };
    default:
      return { label: "Critical", cls: "bg-red-500/10 text-red-400 border-red-500/20" };
  }
}

function getTypeIcon(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("flood") || t.includes("water")) return "\u{1F30A}";
  if (t.includes("fire")) return "\u{1F525}";
  if (t.includes("earthquake")) return "\u{1F3E2}";
  if (t.includes("cyclone") || t.includes("storm")) return "\u{1F300}";
  if (t.includes("medical") || t.includes("health")) return "\u{1F691}";
  if (t.includes("collapse")) return "\u{1F3E2}";
  if (t.includes("accident")) return "\u{1F697}";
  return "\u{26A0}\u{FE0F}";
}

export default function IncidentsPage() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [mapRefreshTrigger, setMapRefreshTrigger] = useState(0);
  const [refreshLabel, setRefreshLabel] = useState("No incidents yet");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const totals = useMemo(() => {
    const bySeverity = severityValues.reduce<Record<number, number>>(
      (acc, s) => ({ ...acc, [s]: 0 }),
      {}
    );
    let total = 0;
    let critical = 0;
    let high = 0;
    incidents.forEach((inc) => {
      const sev = typeof inc.severity === "number" ? inc.severity : 0;
      total += 1;
      if (sev >= 5) critical += 1;
      else if (sev === 4) high += 1;
      bySeverity[sev] = (bySeverity[sev] ?? 0) + 1;
    });
    return { total, critical, high, bySeverity };
  }, [incidents]);

  const handleIncidentsLoaded = useCallback((incs: Incident[]) => {
    setIncidents(incs);
    setRefreshLabel(incs.length === 0 ? "No incidents yet" : incs.length + " incidents synced");
  }, []);

  const refresh = useCallback(() => {
    setMapRefreshTrigger((n) => n + 1);
  }, []);

  return (
    <main className="min-h-screen bg-[#05070d] text-white">
      <header className="border-b border-white/10 bg-[#080b14]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">AIAC</h1>
            <p className="text-sm text-slate-400">Smart Disaster Response - Incident Directory</p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden items-center gap-2 rounded-full border border-green-500/20 bg-green-500/10 px-4 py-2 text-sm text-green-400 sm:flex">
              <span className="h-2 w-2 rounded-full bg-green-400"></span>
              System Online
            </div>
            <button
              onClick={refresh}
              className="rounded-lg bg-red-600 px-5 py-2.5 font-semibold transition hover:bg-red-700"
            >
              Refresh Incidents
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold">All Reported Incidents</h2>
            <p className="mt-1 text-sm text-slate-400">Live emergency feed</p>
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span className="text-slate-400">
              <strong className="text-white">{totals.total}</strong> total
            </span>
            <span className="text-red-400">
              <strong>{totals.critical}</strong> critical
            </span>
            <span className="text-orange-400">
              <strong>{totals.high}</strong> high
            </span>
            <span className="text-xs text-slate-500">{refreshLabel}</span>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="lg:col-span-2">
            <DisasterMap
              selectedIncidentId={selectedIncidentId}
              onIncidentSelect={(inc) =>
                setSelectedIncidentId(inc ? inc.id : null)
              }
              onIncidentsLoaded={handleIncidentsLoaded}
              refreshTrigger={mapRefreshTrigger}
            />
          </div>

          <div className="flex flex-col rounded-2xl border border-white/10 bg-[#101522] overflow-hidden max-h-[600px]">
            <div className="border-b border-white/10 p-5">
              <h3 className="font-bold text-white">All Incidents</h3>
              <p className="text-xs text-slate-400">Real-time emergency feed</p>
            </div>

            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {incidents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center text-slate-500">
                  <span className="text-3xl mb-2">{getTypeIcon("unknown")}</span>
                  <p className="font-medium text-slate-400">No incidents reported</p>
                  <p className="text-xs mt-1 max-w-[200px]">
                    New emergencies will appear here.
                  </p>
                </div>
              ) : (
                incidents.map((inc) => {
                  const isSelected = selectedIncidentId === inc.id;
                  const badge = getSeverityBadge(inc.severity as number);

                  return (
                    <button
                      key={inc.id}
                      type="button"
                      onClick={() =>
                        setSelectedIncidentId((prev) =>
                          prev === inc.id ? null : inc.id
                        )
                      }
                      className={`w-full rounded-xl border p-4 text-left transition ${
                        isSelected
                          ? "border-blue-500/80 bg-blue-950/40 ring-2 ring-blue-500/50"
                          : "border-white/5 bg-white/[0.03] hover:border-white/20"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold flex items-center gap-1.5">
                          <span>{getTypeIcon(inc.type)}</span>
                          <span className="truncate">{inc.type}</span>
                        </span>
                        <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase ${badge.cls}`}>
                          {badge.label}
                        </span>
                      </div>

                      <p className="mt-2 text-xs text-slate-300 line-clamp-2">
                        {inc.description || "No description provided."}
                      </p>

                      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2 text-[10px] text-slate-400">
                        <span className="capitalize">{inc.status || "Reported"}</span>
                        <span className="font-mono">
                          {typeof inc.latitude === "number" && typeof inc.longitude === "number"
                            ? inc.latitude.toFixed(3) + ", " + inc.longitude.toFixed(3)
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
      </div>
      {errorMessage && (
        <div className="fixed bottom-6 right-6 z-50 rounded-xl border border-red-500/50 bg-red-500/10 p-4 text-red-300 shadow-2xl">
          {errorMessage}
        </div>
      )}
    </main>
  );
}
