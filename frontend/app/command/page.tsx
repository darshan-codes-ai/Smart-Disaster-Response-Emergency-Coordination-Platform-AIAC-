"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import type { Incident } from "../../components/disaster-map";
import { getAccessToken, requestWithToken } from "../../lib/supabase/access-token";
import { useCurrentUser } from "../../lib/supabase/use-current-user";
import { createClient } from "../../lib/supabase/client";
import StatusBadge from "../../components/status-badge";
import SeverityBadge from "../../components/severity-badge";
import {
  ALLOWED_STATUSES,
  getStatusConfig,
  getNextRecommendedStatus,
} from "../../lib/status-workflow";

// Dynamic import for MapLibre map component to avoid SSR window issues
const DisasterMap = dynamic(() => import("../../components/disaster-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full flex-col items-center justify-center bg-[#050811] text-slate-400">
      <div className="h-8 w-8 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin mb-3"></div>
      <p className="text-xs font-mono uppercase tracking-wider text-cyan-400 font-bold">Initializing Geospatial Telemetry...</p>
      <p className="text-[11px] text-slate-500 mt-1 font-mono">MapLibre GL dark matter engine loading</p>
    </div>
  ),
});

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

interface Responder {
  id: string;
  full_name: string;
  role: string;
}

interface IncidentEvent {
  id: string;
  incident_id: string;
  actor_id: string | null;
  event_type: string;
  previous_state: Record<string, string | number | boolean | null> | null;
  new_state: Record<string, string | number | boolean | null> | null;
  metadata: {
    action_label?: string;
    actor_name?: string;
    actor_role?: string;
    assigned_responder_name?: string;
    [key: string]: string | number | boolean | null | undefined;
  };
  created_at: string;
}

type OperatingMode = "all" | "normal" | "disaster" | "world_cup";
type PriorityFilter = "all" | "critical" | "high" | "medium" | "low";
type DetailsTab = "triage" | "operator" | "details" | "activity";

function getTypeIcon(type: string): string {
  const t = (type || "").toLowerCase();
  if (t.includes("flood") || t.includes("water")) return "🌊";
  if (t.includes("fire")) return "🔥";
  if (t.includes("earthquake")) return "🏚️";
  if (t.includes("cyclone") || t.includes("storm") || t.includes("hurricane")) return "🌀";
  if (t.includes("medical") || t.includes("health")) return "🚑";
  if (t.includes("collapse") || t.includes("building")) return "🏢";
  if (t.includes("accident") || t.includes("crash")) return "🚗";
  if (t.includes("crowd") || t.includes("stadium") || t.includes("surge")) return "👥";
  return "⚠️";
}

function classifyMode(inc: Incident): "disaster" | "world_cup" | "normal" {
  const text = `${inc.type || ""} ${inc.description || ""}`.toLowerCase();
  if (
    text.includes("world cup") ||
    text.includes("stadium") ||
    text.includes("crowd") ||
    text.includes("fan zone") ||
    text.includes("match")
  ) {
    return "world_cup";
  }
  if (
    text.includes("flood") ||
    text.includes("earthquake") ||
    text.includes("cyclone") ||
    text.includes("hurricane") ||
    text.includes("storm") ||
    text.includes("collapse") ||
    text.includes("fire") ||
    text.includes("disaster") ||
    inc.severity >= 4
  ) {
    return "disaster";
  }
  return "normal";
}

function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "Just now";
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffSec = Math.floor((now.getTime() - d.getTime()) / 1000);
    if (diffSec < 60) return `${Math.max(1, diffSec)}s ago`;
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    return `${Math.floor(diffHours / 24)}d ago`;
  } catch {
    return "Recently";
  }
}

function PriorityTag({ score, tier }: { score?: number | null; tier?: string | null }) {
  const val = score ?? 0;
  const t = tier || (val >= 80 ? "CRITICAL" : val >= 60 ? "HIGH" : val >= 40 ? "MEDIUM" : "LOW");
  let badgeStyle = "bg-slate-500/15 text-slate-300 border-slate-500/30";

  if (t === "CRITICAL") {
    badgeStyle = "bg-red-500/20 text-red-300 border-red-500/40 ring-1 ring-red-500/30";
  } else if (t === "HIGH") {
    badgeStyle = "bg-orange-500/20 text-orange-300 border-orange-500/40";
  } else if (t === "MEDIUM") {
    badgeStyle = "bg-amber-500/20 text-amber-300 border-amber-500/40";
  } else if (t === "LOW") {
    badgeStyle = "bg-cyan-500/15 text-cyan-300 border-cyan-500/30";
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider border ${badgeStyle}`}
    >
      <span>{val}</span>
      <span className="opacity-90">{t}</span>
    </span>
  );
}

function ModeBadge({ mode }: { mode: "disaster" | "world_cup" | "normal" }) {
  if (mode === "world_cup") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-purple-500/20 text-purple-300 border border-purple-500/40 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider">
        <span>⚽</span>
        <span>World Cup</span>
      </span>
    );
  }
  if (mode === "disaster") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-red-500/20 text-red-300 border border-red-500/40 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider">
        <span>⚡</span>
        <span>Disaster</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30 px-1.5 py-0.5 text-[9px] font-mono font-bold uppercase tracking-wider">
      <span>●</span>
      <span>Normal</span>
    </span>
  );
}

export default function CommandCenterPage() {
  const { role, profile, isCommandCenter, loading: userLoading } = useCurrentUser();

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [responders, setResponders] = useState<Responder[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);

  // Operating modes & filters
  const [operatingMode, setOperatingMode] = useState<OperatingMode>("all");
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [responderFilter, setResponderFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  // UI Panel Tabs & Responsiveness
  const [activeDetailsTab, setActiveDetailsTab] = useState<DetailsTab>("triage");
  const [showQueue, setShowQueue] = useState<boolean>(true);
  const [showDetails, setShowDetails] = useState<boolean>(true);

  // Action states & Notifications
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [mapRefreshTrigger, setMapRefreshTrigger] = useState<number>(0);

  // Field note editing
  const [fieldNoteText, setFieldNoteText] = useState<string>("");
  const [isSavingNote, setIsSavingNote] = useState<boolean>(false);

  // Realtime connection state
  const [realtimeState, setRealtimeState] = useState<"live" | "polling">("polling");

  // Simulation & Safety Modals
  const [simulateDisasterOpen, setSimulateDisasterOpen] = useState<boolean>(false);
  const [simulateWorldCupOpen, setSimulateWorldCupOpen] = useState<boolean>(false);
  const [clearIncidentsOpen, setClearIncidentsOpen] = useState<boolean>(false);
  const [replaceExistingDemo, setReplaceExistingDemo] = useState<boolean>(false);
  const [isSimulating, setIsSimulating] = useState<boolean>(false);

  // Persistent Audit History (Phase 5.1 & Phase 5.5)
  const [auditEvents, setAuditEvents] = useState<IncidentEvent[]>([]);
  const [eventsLoading, setEventsLoading] = useState<boolean>(false);
  const [eventsError, setEventsError] = useState<string | null>(null);
  const activeFetchIncidentIdRef = useRef<string | null>(null);

  const fetchAuditEvents = useCallback(async (incidentId: string) => {
    activeFetchIncidentIdRef.current = incidentId;
    try {
      setEventsLoading(true);
      setEventsError(null);
      const token = await getAccessToken();
      if (!token) return;

      let res = await requestWithToken(`${API_URL}/incidents/${incidentId}/events`, token);
      if (res.status === 401) {
        const freshToken = await getAccessToken(true);
        if (freshToken) {
          res = await requestWithToken(`${API_URL}/incidents/${incidentId}/events`, freshToken);
        }
      }

      if (!res.ok) {
        let detail = "Failed to load audit history";
        try {
          const errData = await res.json();
          if (errData?.detail) detail = errData.detail;
        } catch {
          // ignore
        }
        throw new Error(detail);
      }

      const data = await res.json();
      // Ensure responses for previously selected incidents are discarded
      if (activeFetchIncidentIdRef.current === incidentId) {
        const list: IncidentEvent[] = Array.isArray(data?.events) ? data.events : [];
        const seen = new Set<string>();
        const uniqueEvents: IncidentEvent[] = [];
        for (const ev of list) {
          if (ev.id && !seen.has(ev.id)) {
            seen.add(ev.id);
            uniqueEvents.push(ev);
          }
        }
        setAuditEvents(uniqueEvents);
      }
    } catch (err) {
      if (activeFetchIncidentIdRef.current === incidentId) {
        console.error("Failed to load audit events:", err);
        setEventsError(err instanceof Error ? err.message : "Failed to load audit history");
      }
    } finally {
      if (activeFetchIncidentIdRef.current === incidentId) {
        setEventsLoading(false);
      }
    }
  }, []);

  const handleSelectIncident = useCallback((inc: Incident | null) => {
    setSelectedIncident(inc);
    setFieldNoteText(inc?.note || "");
    // Clear previous audit events immediately to avoid stale display
    setAuditEvents([]);
    setEventsError(null);
    if (inc) {
      setShowDetails(true);
      activeFetchIncidentIdRef.current = inc.id;
      void fetchAuditEvents(inc.id);
    } else {
      activeFetchIncidentIdRef.current = null;
    }
  }, [fetchAuditEvents]);

  // ------------------------------------------------------------
  // FETCH INCIDENTS (WITH ACCESS TOKEN HANDLING)
  // ------------------------------------------------------------
  const fetchIncidents = useCallback(async (isBackground = false) => {
    try {
      if (!isBackground) setLoading(true);
      const token = await getAccessToken();
      if (!token) return;

      let res = await requestWithToken(`${API_URL}/incidents`, token);
      if (res.status === 401) {
        const freshToken = await getAccessToken(true);
        if (freshToken) {
          res = await requestWithToken(`${API_URL}/incidents`, freshToken);
        }
      }

      if (!res.ok) {
        let detail = `Error ${res.status}: Failed to synchronize incident records`;
        try {
          const errData = await res.json();
          if (errData?.detail) detail = errData.detail;
        } catch {
          // ignore
        }
        if (!isBackground) setErrorMessage(detail);
        return;
      }

      const data = await res.json();
      const list: Incident[] = Array.isArray(data?.incidents) ? data.incidents : [];
      setIncidents(list);

      // Keep selected incident synchronized with fresh server data
      setSelectedIncident((current) => {
        if (!current) return null;
        const freshMatch = list.find((inc) => inc.id === current.id);
        return freshMatch || current;
      });
    } catch (err) {
      console.error("Command Center fetch error:", err);
      if (!isBackground) {
        setErrorMessage(err instanceof Error ? err.message : "Failed to load incidents");
      }
    } finally {
      if (!isBackground) setLoading(false);
    }
  }, []);

  // ------------------------------------------------------------
  // FETCH ACTIVE RESPONDERS
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

  // Initial load
  useEffect(() => {
    let ignore = false;
    if (!userLoading && (isCommandCenter || role === "admin")) {
      Promise.resolve().then(() => {
        if (!ignore) {
          fetchIncidents(false);
          fetchResponders();
        }
      });
    }
    return () => {
      ignore = true;
    };
  }, [userLoading, isCommandCenter, role, fetchIncidents, fetchResponders]);

  // Stable ref for selected incident to avoid re-subscribing channels on every click
  const selectedIncidentRef = useRef<Incident | null>(selectedIncident);
  useEffect(() => {
    selectedIncidentRef.current = selectedIncident;
  }, [selectedIncident]);

  // ------------------------------------------------------------
  // REAL-TIME UPDATES (SUPABASE REALTIME + 15s POLLING FALLBACK)
  // ------------------------------------------------------------
  useEffect(() => {
    let supabaseClient: ReturnType<typeof createClient> | null = null;
    let channel: ReturnType<ReturnType<typeof createClient>["channel"]> | null = null;

    try {
      supabaseClient = createClient();
      channel = supabaseClient
        .channel("rescuegrid-ecc-live")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "incidents" },
          () => {
            fetchIncidents(true);
            setMapRefreshTrigger((n) => n + 1);
          }
        )
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "incident_events",
          },
          (payload) => {
            const currentSelectedId = selectedIncidentRef.current?.id;
            const row = (payload.new && Object.keys(payload.new).length
              ? payload.new
              : payload.old) as { incident_id?: string } | undefined;
            if (currentSelectedId && row?.incident_id === currentSelectedId) {
              void fetchAuditEvents(currentSelectedId);
            }
          }
        )
        .subscribe((status) => {
          if (status === "SUBSCRIBED") {
            setRealtimeState("live");
          } else {
            setRealtimeState("polling");
          }
        });
    } catch (err) {
      console.warn("Supabase Realtime subscription initialized with polling fallback:", err);
    }

    // 15-second background polling fallback
    const intervalId = setInterval(() => {
      fetchIncidents(true);
    }, 15000);

    return () => {
      clearInterval(intervalId);
      if (supabaseClient && channel) {
        try {
          supabaseClient.removeChannel(channel);
        } catch {
          // ignore
        }
      }
    };
  }, [fetchIncidents, fetchAuditEvents]);

  // ------------------------------------------------------------
  // UPDATE INCIDENT (STATUS, NOTE, DISPATCH ASSIGNMENT)
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
        throw new Error(data?.detail || "Failed to update operational incident");
      }

      const updatedIncident: Incident = data.incident;
      setIncidents((prev) =>
        prev.map((inc) => (inc.id === incidentId ? updatedIncident : inc))
      );

      if (selectedIncident?.id === incidentId) {
        setSelectedIncident(updatedIncident);
        fetchAuditEvents(incidentId);
      }

      let msg = "Incident updated successfully.";
      if (assignedTo !== undefined) {
        msg = assignedTo
          ? `Unit dispatched: ${updatedIncident.assigned_responder_name || "Assigned"}.`
          : "Responder assignment cleared.";
      } else if (newStatus !== undefined) {
        msg = `Status advanced to "${updatedIncident.status || newStatus}".`;
      } else if (newNote !== undefined) {
        msg = "Operational field note logged.";
      }

      setSuccessMessage(msg);
      setMapRefreshTrigger((n) => n + 1);
      setTimeout(() => setSuccessMessage(null), 3500);
    } catch (err) {
      console.error("Command Center update error:", err);
      setErrorMessage(err instanceof Error ? err.message : "Failed to update incident");
    } finally {
      setActionLoadingId(null);
    }
  };

  // ------------------------------------------------------------
  // SIMULATION HANDLERS (POST /incidents)
  // ------------------------------------------------------------
  const handleSimulateDisaster = async () => {
    try {
      setIsSimulating(true);
      setErrorMessage(null);
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication required for simulation.");

      // Realistic disaster payload
      const payload = {
        type: "Flood",
        description:
          "[DEMO] Flash Flood & Structural Distress: High water levels causing severe transit disruption and structural threat near Downtown Sector.",
        location: {
          lat: 37.7749 + (Math.random() - 0.5) * 0.04,
          lng: -122.4194 + (Math.random() - 0.5) * 0.04,
        },
        severity: 4,
      };

      const res = await requestWithToken(`${API_URL}/incidents`, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.detail || "Failed to inject disaster simulation");
      }

      const created = await res.json();
      setSuccessMessage(`Disaster simulation injected: ${created?.type || "Flood"}`);
      setSimulateDisasterOpen(false);
      await fetchIncidents(false);
      setMapRefreshTrigger((n) => n + 1);
      if (created?.id) {
        handleSelectIncident(created);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Simulation injection failed");
    } finally {
      setIsSimulating(false);
    }
  };

  const handleSimulateWorldCup = async () => {
    try {
      setIsSimulating(true);
      setErrorMessage(null);
      const token = await getAccessToken();
      if (!token) throw new Error("Authentication required for simulation.");

      // Realistic World Cup crowd surge payload
      const payload = {
        type: "Medical Emergency",
        description:
          "[DEMO] World Cup Stadium Zone 3: Stadium perimeter gate congestion and crowd surge requiring rapid medical and security response.",
        location: {
          lat: 37.7833 + (Math.random() - 0.5) * 0.04,
          lng: -122.4167 + (Math.random() - 0.5) * 0.04,
        },
        severity: 3,
      };

      const res = await requestWithToken(`${API_URL}/incidents`, token, {
        method: "POST",
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err?.detail || "Failed to inject World Cup simulation");
      }

      const created = await res.json();
      setSuccessMessage(`World Cup simulation injected: ${created?.type || "Medical Emergency"}`);
      setSimulateWorldCupOpen(false);
      await fetchIncidents(false);
      setMapRefreshTrigger((n) => n + 1);
      if (created?.id) {
        handleSelectIncident(created);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : "Simulation injection failed");
    } finally {
      setIsSimulating(false);
    }
  };

  // ------------------------------------------------------------
  // FILTERED INCIDENTS & REAL-TIME DASHBOARD KPIS
  // ------------------------------------------------------------
  const filteredIncidents = useMemo(() => {
    return incidents.filter((inc) => {
      // Operating Mode filter
      const mode = classifyMode(inc);
      if (operatingMode !== "all" && mode !== operatingMode) {
        return false;
      }

      // Priority tier filter
      const pScore = inc.priority_score ?? inc.severity * 20;
      if (priorityFilter === "critical" && pScore < 80) return false;
      if (priorityFilter === "high" && (pScore < 60 || pScore >= 80)) return false;
      if (priorityFilter === "medium" && (pScore < 40 || pScore >= 60)) return false;
      if (priorityFilter === "low" && pScore >= 40) return false;

      // Status filter
      if (statusFilter !== "all" && (inc.status || "reported") !== statusFilter) {
        return false;
      }

      // Responder assignment filter
      if (responderFilter === "unassigned" && !!inc.assigned_to) return false;
      if (responderFilter === "assigned" && !inc.assigned_to) return false;
      if (
        responderFilter !== "all" &&
        responderFilter !== "unassigned" &&
        responderFilter !== "assigned" &&
        inc.assigned_to !== responderFilter
      ) {
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
  }, [incidents, operatingMode, priorityFilter, statusFilter, responderFilter, searchQuery]);

  // Real KPI calculations from operational database
  const stats = useMemo(() => {
    let active = 0;
    let critical = 0;
    let assigned = 0;
    const assignedResponderIds = new Set<string>();

    incidents.forEach((inc) => {
      const isClosed = inc.status === "resolved" || inc.status === "cancelled";
      if (!isClosed) active += 1;

      const score = inc.priority_score ?? inc.severity * 20;
      if ((score >= 80 || inc.severity >= 4) && !isClosed) {
        critical += 1;
      }

      if (inc.assigned_to && !isClosed) {
        assigned += 1;
        assignedResponderIds.add(inc.assigned_to);
      }
    });

    const totalUnits = responders.length;
    const occupiedUnits = assignedResponderIds.size;
    const availUnits = Math.max(0, totalUnits - occupiedUnits);
    const loadPercent =
      totalUnits > 0 ? Math.min(100, Math.round((assigned / totalUnits) * 100)) : 0;

    return {
      active,
      critical,
      loadPercent,
      availUnits,
      totalUnits,
    };
  }, [incidents, responders]);

  // Deterministic priority breakdown for selected incident
  const priorityBreakdown = useMemo(() => {
    if (!selectedIncident) return null;
    const sev = selectedIncident.severity;
    const baseSev =
      sev >= 5 ? 50 : sev === 4 ? 40 : sev === 3 ? 30 : sev === 2 ? 20 : 10;

    const ht = (selectedIncident.type || "").toLowerCase();
    let hazard = 10;
    if (ht.includes("medical") || ht.includes("collapse") || ht.includes("fire")) {
      hazard = 25;
    } else if (ht.includes("flood") || ht.includes("cyclone") || ht.includes("earthquake")) {
      hazard = 15;
    }

    const st = (selectedIncident.status || "reported").toLowerCase();
    let statusScore = 0;
    if (st === "reported") statusScore = 15;
    else if (st === "verified") statusScore = 10;
    else if (st === "assigned") statusScore = 5;

    const total = selectedIncident.priority_score ?? Math.min(100, baseSev + hazard + statusScore);
    const aging = Math.max(0, total - (baseSev + hazard + statusScore));

    return {
      baseSev,
      hazard,
      statusScore,
      aging,
      total,
      tier: selectedIncident.priority_tier || (total >= 80 ? "CRITICAL" : total >= 60 ? "HIGH" : total >= 40 ? "MEDIUM" : "LOW"),
    };
  }, [selectedIncident]);

  // ------------------------------------------------------------
  // ROLE SECURITY GUARD
  // ------------------------------------------------------------
  if (userLoading) {
    return (
      <main className="h-screen w-screen bg-[#050811] flex items-center justify-center text-white">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin"></div>
          <p className="text-cyan-400 font-mono text-xs uppercase tracking-wider font-bold">
            Verifying Tactical Command Credentials...
          </p>
        </div>
      </main>
    );
  }

  if (!isCommandCenter && role !== "admin") {
    return (
      <main className="h-screen w-screen bg-[#050811] text-white flex flex-col items-center justify-center p-6">
        <div className="max-w-md w-full rounded-2xl border border-red-500/30 bg-red-950/20 p-8 text-center shadow-2xl backdrop-blur">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-red-500/10 border border-red-500/30 text-2xl mx-auto mb-4">
            🛡️
          </div>
          <h2 className="text-lg font-bold text-red-300 mb-2 uppercase tracking-wide">
            Command Center Access Restricted
          </h2>
          <p className="text-xs text-slate-300 mb-4 leading-relaxed">
            The Emergency Command Center (ECC) is strictly reserved for authorized dispatch coordinators and system administrators.
          </p>
          <div className="rounded-xl bg-black/40 border border-white/10 p-3 mb-6 text-xs text-slate-400">
            <span>Your authenticated role: </span>
            <strong className="text-white uppercase font-mono">{role || "citizen"}</strong>
          </div>
          <div className="flex flex-col gap-2">
            <Link
              href="/"
              className="w-full rounded-xl bg-cyan-600 px-4 py-2.5 font-bold text-xs hover:bg-cyan-500 transition shadow-lg shadow-cyan-950/50"
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
  // MAIN EMERGENCY COMMAND CENTER INTERFACE
  // ------------------------------------------------------------
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#050811] text-slate-100 font-sans select-none">
      {/* ======================================================
          SECTION 2: TOP COMMAND BAR
      ====================================================== */}
      <header className="h-12 border-b border-cyan-500/20 bg-[#070c18] flex items-center justify-between px-3 text-xs shrink-0 z-30 shadow-md">
        {/* Left: ECC identifier & Title */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5">
            <span className="rounded bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 px-1.5 py-0.5 text-[10px] font-mono font-extrabold tracking-wider">
              ECC-01
            </span>
            <h1 className="text-xs sm:text-sm font-extrabold tracking-wider uppercase text-white font-mono flex items-center gap-1.5">
              <span>Emergency Command Center</span>
            </h1>
          </div>
          <span className="hidden md:inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[10px] font-mono text-emerald-400 font-bold">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>ALL MODES</span>
          </span>
        </div>

        {/* Center: Operator indicator & Mode selector */}
        <div className="flex items-center gap-2 lg:gap-4">
          <div className="hidden sm:flex items-center gap-1.5 bg-[#0a1122] border border-white/10 px-2 py-1 rounded text-[11px]">
            <span className="text-slate-400">OPERATOR:</span>
            <span className="font-mono text-cyan-300 font-bold max-w-[130px] truncate">
              {profile?.full_name || "COMMAND-COORD"}
            </span>
          </div>

          {/* Operating Mode Buttons */}
          <div className="flex items-center bg-[#050811] border border-cyan-500/30 rounded p-0.5">
            {(["all", "normal", "disaster", "world_cup"] as OperatingMode[]).map((mode) => {
              const active = operatingMode === mode;
              const label =
                mode === "all"
                  ? "All"
                  : mode === "normal"
                  ? "Normal"
                  : mode === "disaster"
                  ? "Disaster"
                  : "World Cup";

              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setOperatingMode(mode)}
                  className={`px-2 py-0.5 text-[10px] font-mono font-bold uppercase transition rounded ${
                    active
                      ? "bg-cyan-500 text-black shadow"
                      : "text-slate-400 hover:text-white hover:bg-white/5"
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Right: Real KPI metrics, Refresh, and Realtime Indicator */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden md:flex items-center gap-2 font-mono text-[11px]">
            <div className="flex items-center gap-1 bg-[#0a1122] border border-white/10 px-2 py-0.5 rounded">
              <span className="text-slate-400">ACT:</span>
              <span className="text-cyan-300 font-bold">{stats.active}</span>
            </div>
            <div className="flex items-center gap-1 bg-red-950/30 border border-red-500/30 px-2 py-0.5 rounded">
              <span className="text-red-400">CRIT:</span>
              <span className="text-red-300 font-bold">{stats.critical}</span>
            </div>
            <div className="hidden lg:flex items-center gap-1 bg-[#0a1122] border border-white/10 px-2 py-0.5 rounded">
              <span className="text-slate-400">LOAD:</span>
              <span className="text-amber-300 font-bold">{stats.loadPercent}%</span>
            </div>
            <div className="hidden lg:flex items-center gap-1 bg-[#0a1122] border border-white/10 px-2 py-0.5 rounded">
              <span className="text-emerald-400 font-bold">
                {stats.availUnits}/{stats.totalUnits}
              </span>
              <span className="text-slate-400">AVAIL</span>
            </div>
          </div>

          {/* Refresh Button */}
          <button
            type="button"
            onClick={() => {
              fetchIncidents(false);
              fetchResponders();
              setMapRefreshTrigger((n) => n + 1);
            }}
            disabled={loading}
            title="Refresh Operational Feed"
            className="p-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 hover:text-white transition disabled:opacity-50"
          >
            <span className={`inline-block text-xs ${loading ? "animate-spin" : ""}`}>↻</span>
          </button>

          {/* Realtime Live Pulse */}
          <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-black/40 border border-white/10">
            <span
              className={`h-2 w-2 rounded-full ${
                realtimeState === "live"
                  ? "bg-emerald-400 animate-pulse shadow-sm shadow-emerald-400"
                  : "bg-amber-400"
              }`}
            ></span>
            <span className="font-mono text-[9px] uppercase font-bold text-slate-300">
              {realtimeState === "live" ? "LIVE" : "POLL"}
            </span>
          </div>

          {/* Navigation link to public portal */}
          <Link
            href="/"
            title="Exit ECC to Portal"
            className="text-[10px] text-slate-400 hover:text-cyan-300 px-1 font-mono transition"
          >
            PORTAL ↗
          </Link>
        </div>
      </header>

      {/* ======================================================
          SECTION 3: DEMO AND OPERATIONS TOOLBAR
      ====================================================== */}
      <div className="h-10 border-b border-white/10 bg-[#070b16] flex items-center justify-between px-3 text-xs shrink-0 z-20">
        {/* Left: Simulation & Safety controls */}
        <div className="flex items-center gap-2 overflow-x-auto py-1">
          <button
            type="button"
            onClick={() => setSimulateDisasterOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-red-950/40 hover:bg-red-900/50 border border-red-500/40 text-red-300 text-[10px] font-mono font-bold uppercase transition"
          >
            <span>⚡</span>
            <span>Disaster Sim [DEMO]</span>
          </button>

          <button
            type="button"
            onClick={() => setSimulateWorldCupOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-purple-950/40 hover:bg-purple-900/50 border border-purple-500/40 text-purple-300 text-[10px] font-mono font-bold uppercase transition"
          >
            <span>⚽</span>
            <span>World Cup Sim [DEMO]</span>
          </button>

          <button
            type="button"
            onClick={() => setClearIncidentsOpen(true)}
            className="flex items-center gap-1 px-2.5 py-1 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-slate-400 hover:text-slate-200 text-[10px] font-mono uppercase transition"
          >
            <span>🗑️</span>
            <span>Clear Incidents</span>
          </button>

          <label className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono text-slate-400 cursor-pointer ml-1">
            <input
              type="checkbox"
              checked={replaceExistingDemo}
              onChange={(e) => setReplaceExistingDemo(e.target.checked)}
              className="rounded accent-cyan-500"
            />
            <span>Replace-Existing Mode</span>
          </label>
        </div>

        {/* Right: View controls & Mobile/Tablet toggles */}
        <div className="flex items-center gap-2">
          {selectedIncident && (
            <button
              type="button"
              onClick={() => handleSelectIncident(null)}
              className="px-2 py-0.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-slate-300 text-[10px] font-mono transition"
            >
              Reset Selection
            </button>
          )}

          {/* Mobile/Tablet Queue & Details Panel Toggles */}
          <div className="flex items-center lg:hidden gap-1">
            <button
              type="button"
              onClick={() => setShowQueue(!showQueue)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition ${
                showQueue
                  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                  : "bg-white/5 text-slate-400 border-white/10"
              }`}
            >
              Queue
            </button>
            <button
              type="button"
              onClick={() => setShowDetails(!showDetails)}
              className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition ${
                showDetails
                  ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/40"
                  : "bg-white/5 text-slate-400 border-white/10"
              }`}
            >
              Details
            </button>
          </div>
        </div>
      </div>

      {/* ======================================================
          TOAST FEEDBACK BANNERS
      ====================================================== */}
      {errorMessage && (
        <div className="bg-red-950/95 border-b border-red-500/40 px-3 py-1.5 text-xs text-red-200 flex items-center justify-between z-30 shrink-0">
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span className="font-mono text-[11px]">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="text-red-400 hover:text-white font-bold px-1"
          >
            ×
          </button>
        </div>
      )}

      {successMessage && (
        <div className="bg-emerald-950/95 border-b border-emerald-500/40 px-3 py-1.5 text-xs text-emerald-200 flex items-center justify-between z-30 shrink-0">
          <div className="flex items-center gap-2">
            <span>✓</span>
            <span className="font-mono text-[11px]">{successMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMessage(null)}
            className="text-emerald-400 hover:text-white font-bold px-1"
          >
            ×
          </button>
        </div>
      )}

      {/* ======================================================
          3-COLUMN MAIN OPERATIONS WORKSPACE
      ====================================================== */}
      <main className="flex-1 flex min-h-0 overflow-hidden relative">
        {/* ====================================================
            COLUMN 1: SECTION 4 - LEFT INCIDENT QUEUE
        ==================================================== */}
        <aside
          className={`${
            showQueue ? "flex" : "hidden"
          } lg:flex w-full sm:w-80 lg:w-[350px] shrink-0 border-r border-white/10 bg-[#060a15] flex-col h-full z-10`}
        >
          {/* Header & Filter Controls */}
          <div className="p-3 border-b border-white/10 bg-[#080d1b] space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-mono uppercase font-bold tracking-wider text-cyan-400 flex items-center gap-1.5">
                <span>📋</span>
                <span>Incident Queue</span>
              </span>
              <span className="font-mono text-[10px] text-slate-400 bg-black/40 border border-white/10 px-2 py-0.5 rounded">
                {filteredIncidents.length} / {incidents.length}
              </span>
            </div>

            {/* Search Input */}
            <div className="relative">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search type, location, responder..."
                className="w-full rounded bg-[#03060d] border border-white/10 px-2.5 py-1 text-xs text-slate-200 placeholder-slate-500 outline-none focus:border-cyan-500 transition font-mono"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1 text-slate-400 hover:text-white font-bold text-xs"
                >
                  ✕
                </button>
              )}
            </div>

            {/* Queue Filter Dropdowns */}
            <div className="grid grid-cols-3 gap-1.5">
              {/* Urgency / Priority */}
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value as PriorityFilter)}
                className="rounded bg-[#03060d] border border-white/10 px-1.5 py-1 text-[10px] font-mono text-slate-300 outline-none focus:border-cyan-500"
              >
                <option value="all">All Urgency</option>
                <option value="critical">Crit (80+)</option>
                <option value="high">High (60-79)</option>
                <option value="medium">Med (40-59)</option>
                <option value="low">Low (&lt;40)</option>
              </select>

              {/* Status */}
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="rounded bg-[#03060d] border border-white/10 px-1.5 py-1 text-[10px] font-mono text-slate-300 outline-none focus:border-cyan-500"
              >
                <option value="all">All Status</option>
                {ALLOWED_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {getStatusConfig(st).label}
                  </option>
                ))}
              </select>

              {/* Operator Assignment */}
              <select
                value={responderFilter}
                onChange={(e) => setResponderFilter(e.target.value)}
                className="rounded bg-[#03060d] border border-white/10 px-1.5 py-1 text-[10px] font-mono text-slate-300 outline-none focus:border-cyan-500"
              >
                <option value="all">All Units</option>
                <option value="unassigned">Unassigned</option>
                <option value="assigned">Assigned</option>
                {responders.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.full_name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Scrollable Incident Cards List */}
          <div className="flex-1 overflow-y-auto divide-y divide-white/5">
            {loading ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2 font-mono text-xs">
                <div className="h-6 w-6 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin"></div>
                <span>Syncing Queue Telemetry...</span>
              </div>
            ) : filteredIncidents.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 text-slate-500 px-4 text-center">
                <span className="text-2xl mb-1">🛰️</span>
                <p className="font-mono text-xs text-slate-300 font-bold uppercase">No matching incidents</p>
                <p className="text-[11px] text-slate-500 mt-1">
                  Adjust mode, urgency, or operator filters.
                </p>
              </div>
            ) : (
              filteredIncidents.map((inc) => {
                const isSelected = selectedIncident?.id === inc.id;
                const mode = classifyMode(inc);
                const score = inc.priority_score ?? inc.severity * 20;

                return (
                  <button
                    key={inc.id}
                    type="button"
                    onClick={() => handleSelectIncident(inc)}
                    className={`w-full text-left p-2.5 transition flex flex-col gap-1.5 ${
                      isSelected
                        ? "bg-[#0f1d38] border-l-2 border-cyan-400 ring-1 ring-cyan-500/30"
                        : "hover:bg-white/[0.03]"
                    }`}
                  >
                    {/* Top line: ID, Mode, Priority */}
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-1.5">
                        <span className="font-mono font-bold text-[10px] text-cyan-400">
                          #INC-{inc.id.slice(0, 6).toUpperCase()}
                        </span>
                        <ModeBadge mode={mode} />
                      </div>
                      <PriorityTag score={score} tier={inc.priority_tier} />
                    </div>

                    {/* Title & Type */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm">{getTypeIcon(inc.type)}</span>
                      <span className="text-xs font-bold text-slate-100 capitalize font-mono truncate">
                        {inc.type}
                      </span>
                    </div>

                    {/* Short Description */}
                    <p className="text-[11px] text-slate-400 line-clamp-2 leading-relaxed">
                      {inc.description || "No situation description provided."}
                    </p>

                    {/* Footer: Location, Status, Unit, Time */}
                    <div className="flex items-center justify-between text-[10px] text-slate-400 pt-1 font-mono">
                      <span>
                        📍 {inc.latitude.toFixed(2)}, {inc.longitude.toFixed(2)}
                      </span>
                      <span>{formatRelativeTime(inc.created_at)}</span>
                    </div>

                    <div className="flex items-center justify-between text-[10px] pt-0.5">
                      <StatusBadge status={inc.status} size="sm" showIcon={false} />
                      {inc.assigned_to ? (
                        <span className="text-purple-300 font-mono text-[9px] flex items-center gap-1">
                          <span>👤</span>
                          <span className="max-w-[100px] truncate">
                            {inc.assigned_responder_name || "Assigned"}
                          </span>
                        </span>
                      ) : (
                        <span className="text-amber-400/80 font-mono text-[9px]">
                          ⚠️ Unassigned
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </aside>

        {/* ====================================================
            COLUMN 2: SECTION 5 - LARGE CENTRAL INTERACTIVE MAP
        ==================================================== */}
        <section className="flex-1 h-full min-w-0 relative bg-[#050811]">
          <DisasterMap
            hideToolbar={true}
            fullHeight={true}
            showLayerPanel={true}
            incidents={filteredIncidents}
            selectedIncidentId={selectedIncident?.id}
            onIncidentSelect={handleSelectIncident}
            refreshTrigger={mapRefreshTrigger}
          />
        </section>

        {/* ====================================================
            COLUMN 3: SECTION 7 - RIGHT INCIDENT DETAILS PANEL
        ==================================================== */}
        <aside
          className={`${
            showDetails ? "flex" : "hidden"
          } xl:flex w-full sm:w-88 lg:w-[370px] shrink-0 border-l border-white/10 bg-[#060a15] flex-col h-full z-10 overflow-hidden`}
        >
          {!selectedIncident ? (
            /* EMPTY SELECTION STATE */
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-slate-500">
              <div className="h-14 w-14 rounded-2xl bg-cyan-950/20 border border-cyan-500/20 flex items-center justify-center text-2xl text-cyan-400 mb-3 animate-pulse">
                🎯
              </div>
              <h3 className="font-mono text-xs uppercase font-bold text-slate-300 tracking-wider">
                Select an Incident
              </h3>
              <p className="text-[11px] text-slate-400 mt-1.5 max-w-[240px] leading-relaxed">
                Click any incident card from the queue or select a map marker to inspect triage diagnostics, dispatch responders, and manage live response.
              </p>
            </div>
          ) : (
            /* ACTIVE INCIDENT DETAILS PANEL */
            <div className="flex-1 flex flex-col h-full overflow-hidden">
              {/* Header */}
              <div className="p-3 border-b border-white/10 bg-[#080d1b] space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs font-extrabold text-cyan-400">
                      #INC-{selectedIncident.id.slice(0, 8).toUpperCase()}
                    </span>
                    <ModeBadge mode={classifyMode(selectedIncident)} />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleSelectIncident(null)}
                    className="text-slate-400 hover:text-white font-mono text-xs px-1"
                    title="Close details"
                  >
                    ✕
                  </button>
                </div>

                <div className="flex items-center justify-between gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xl">{getTypeIcon(selectedIncident.type)}</span>
                    <div>
                      <h2 className="text-xs font-bold text-white uppercase font-mono">
                        {selectedIncident.type}
                      </h2>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {formatRelativeTime(selectedIncident.created_at)}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <PriorityTag
                      score={selectedIncident.priority_score}
                      tier={selectedIncident.priority_tier}
                    />
                    <StatusBadge status={selectedIncident.status} size="sm" showIcon={false} />
                  </div>
                </div>

                {/* Subheader Metadata */}
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-400 pt-1 border-t border-white/5">
                  <span>
                    📍 {selectedIncident.latitude.toFixed(4)}, {selectedIncident.longitude.toFixed(4)}
                  </span>
                  <div className="flex items-center gap-1">
                    <span>Severity:</span>
                    <SeverityBadge severity={selectedIncident.severity} size="sm" />
                  </div>
                </div>
              </div>

              {/* 4 Navigation Tabs */}
              <div className="flex items-center border-b border-white/10 bg-[#050811] text-[10px] font-mono">
                {(["triage", "operator", "details", "activity"] as DetailsTab[]).map((tab) => {
                  const active = activeDetailsTab === tab;
                  return (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => {
                        setActiveDetailsTab(tab);
                        if (tab === "activity" && selectedIncident) {
                          fetchAuditEvents(selectedIncident.id);
                        }
                      }}
                      className={`flex-1 py-1.5 text-center uppercase font-bold transition border-b-2 ${
                        active
                          ? "border-cyan-400 text-cyan-300 bg-cyan-950/20"
                          : "border-transparent text-slate-400 hover:text-white"
                      }`}
                    >
                      {tab}
                    </button>
                  );
                })}
              </div>

              {/* Tab Contents Container */}
              <div className="flex-1 overflow-y-auto p-3 space-y-3">
                {/* ---------------- TAB 1: TRIAGE ---------------- */}
                {activeDetailsTab === "triage" && (
                  <div className="space-y-3 text-xs">
                    {/* Explainable Smart Priority Formula */}
                    <div className="rounded-lg border border-cyan-500/20 bg-[#080d1b] p-2.5 space-y-2">
                      <span className="text-[10px] font-mono uppercase font-bold text-cyan-400 tracking-wider block">
                        Deterministic Priority Breakdown
                      </span>
                      <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                        <div className="bg-black/30 p-1.5 rounded border border-white/5">
                          <span className="text-slate-400 block text-[9px]">BASE SEVERITY</span>
                          <span className="text-white font-bold">+{priorityBreakdown?.baseSev} pts</span>
                        </div>
                        <div className="bg-black/30 p-1.5 rounded border border-white/5">
                          <span className="text-slate-400 block text-[9px]">HAZARD URGENCY</span>
                          <span className="text-white font-bold">+{priorityBreakdown?.hazard} pts</span>
                        </div>
                        <div className="bg-black/30 p-1.5 rounded border border-white/5">
                          <span className="text-slate-400 block text-[9px]">STATUS URGENCY</span>
                          <span className="text-white font-bold">+{priorityBreakdown?.statusScore} pts</span>
                        </div>
                        <div className="bg-black/30 p-1.5 rounded border border-white/5">
                          <span className="text-slate-400 block text-[9px]">AGING DECAY</span>
                          <span className="text-white font-bold">+{priorityBreakdown?.aging} pts</span>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-1 border-t border-white/10 font-mono text-xs">
                        <span className="text-slate-300">Composite Score:</span>
                        <span className="text-cyan-300 font-bold">
                          {priorityBreakdown?.total} / 100 ({priorityBreakdown?.tier})
                        </span>
                      </div>
                    </div>

                    {/* Recommended Next Workflow Action */}
                    {getNextRecommendedStatus(selectedIncident.status) && (
                      <div className="rounded-lg border border-white/10 bg-[#080d1b] p-2.5 space-y-1.5">
                        <span className="text-[10px] font-mono uppercase font-bold text-slate-400 tracking-wider block">
                          Recommended Protocol
                        </span>
                        <p className="text-[11px] text-slate-300">
                          Current status requires advancing to{" "}
                          <strong className="text-cyan-400 font-mono uppercase">
                            {getNextRecommendedStatus(selectedIncident.status)}
                          </strong>
                          .
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            const nxt = getNextRecommendedStatus(selectedIncident.status);
                            if (nxt) handleUpdate(selectedIncident.id, nxt);
                          }}
                          disabled={actionLoadingId === selectedIncident.id}
                          className="w-full mt-1 py-1 px-2.5 rounded bg-cyan-600 hover:bg-cyan-500 text-black font-mono font-bold text-xs uppercase transition disabled:opacity-50"
                        >
                          {actionLoadingId === selectedIncident.id
                            ? "Updating..."
                            : `Execute → ${getNextRecommendedStatus(selectedIncident.status)}`}
                        </button>
                      </div>
                    )}

                    {/* Operational Completeness Checklist */}
                    <div className="rounded-lg border border-white/10 bg-[#080d1b] p-2.5 space-y-1.5 font-mono text-[11px]">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block">
                        Readiness Checklist
                      </span>
                      <div className="flex items-center justify-between text-slate-300 py-0.5">
                        <span>Geospatial Coordinates:</span>
                        <span className="text-emerald-400">✓ VERIFIED</span>
                      </div>
                      <div className="flex items-center justify-between text-slate-300 py-0.5">
                        <span>Unit Dispatched:</span>
                        {selectedIncident.assigned_to ? (
                          <span className="text-emerald-400">✓ ASSIGNED</span>
                        ) : (
                          <span className="text-amber-400">⚠️ PENDING</span>
                        )}
                      </div>
                      <div className="flex items-center justify-between text-slate-300 py-0.5">
                        <span>Field Notes Logged:</span>
                        {selectedIncident.note ? (
                          <span className="text-emerald-400">✓ LOGGED</span>
                        ) : (
                          <span className="text-slate-500">OPTIONAL</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ---------------- TAB 2: OPERATOR ---------------- */}
                {activeDetailsTab === "operator" && (
                  <div className="space-y-3 text-xs">
                    <div className="rounded-lg border border-purple-500/20 bg-[#080d1b] p-3 space-y-2.5">
                      <span className="text-[10px] font-mono uppercase font-bold text-purple-300 tracking-wider block">
                        Emergency Unit Dispatch
                      </span>

                      {/* Current Assignment Status */}
                      <div className="bg-black/40 p-2 rounded border border-white/5 font-mono text-[11px]">
                        <span className="text-slate-400 block text-[9px]">ASSIGNED UNIT</span>
                        {selectedIncident.assigned_to ? (
                          <div className="flex items-center justify-between mt-0.5">
                            <span className="text-purple-200 font-bold flex items-center gap-1.5">
                              <span>👤</span>
                              <span>
                                {selectedIncident.assigned_responder_name || "Assigned Unit"}
                              </span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleUpdate(selectedIncident.id, undefined, undefined, null)}
                              disabled={actionLoadingId === selectedIncident.id}
                              className="text-red-400 hover:text-red-300 text-[10px] font-bold uppercase transition"
                            >
                              Unassign
                            </button>
                          </div>
                        ) : (
                          <span className="text-amber-400 font-bold block mt-0.5">
                            No unit currently dispatched
                          </span>
                        )}
                      </div>

                      {/* Dispatch Selector */}
                      <div className="space-y-1">
                        <label className="text-[9px] font-mono uppercase text-slate-400 block">
                          Select Unit from Active Roster:
                        </label>
                        <select
                          value={selectedIncident.assigned_to || ""}
                          onChange={(e) => {
                            const val = e.target.value;
                            handleUpdate(selectedIncident.id, undefined, undefined, val || null);
                          }}
                          disabled={actionLoadingId === selectedIncident.id}
                          className="w-full rounded bg-[#03060d] border border-white/10 px-2 py-1.5 text-xs font-mono text-slate-200 outline-none focus:border-purple-500 transition"
                        >
                          <option value="">
                            {selectedIncident.assigned_to ? "Reassign to different unit..." : "Dispatch responder..."}
                          </option>
                          {responders.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.full_name} ({r.role})
                            </option>
                          ))}
                        </select>
                      </div>

                      <p className="text-[10px] text-slate-500 font-mono">
                        Dispatching a unit enforces operational ownership. Only assigned responders and command operators may log status advancements.
                      </p>
                    </div>
                  </div>
                )}

                {/* ---------------- TAB 3: DETAILS ---------------- */}
                {activeDetailsTab === "details" && (
                  <div className="space-y-3 text-xs">
                    {/* Full Situation Description */}
                    <div className="rounded-lg border border-white/10 bg-[#080d1b] p-2.5 space-y-1">
                      <span className="text-[10px] font-mono uppercase font-bold text-slate-400 tracking-wider block">
                        Situation Brief
                      </span>
                      <p className="text-slate-200 text-xs leading-relaxed">
                        {selectedIncident.description || "No situation description provided."}
                      </p>
                    </div>

                    {/* Field Notes Editor */}
                    <div className="rounded-lg border border-white/10 bg-[#080d1b] p-2.5 space-y-2">
                      <span className="text-[10px] font-mono uppercase font-bold text-cyan-400 tracking-wider block">
                        Situational Field Notes
                      </span>
                      <textarea
                        value={fieldNoteText}
                        onChange={(e) => setFieldNoteText(e.target.value)}
                        placeholder="Log tactical field note or command update..."
                        rows={3}
                        className="w-full rounded bg-[#03060d] border border-white/10 p-2 text-xs text-white outline-none focus:border-cyan-500 resize-none font-mono"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          setIsSavingNote(true);
                          await handleUpdate(selectedIncident.id, undefined, fieldNoteText.trim() || undefined);
                          setIsSavingNote(false);
                        }}
                        disabled={isSavingNote || actionLoadingId === selectedIncident.id}
                        className="py-1 px-3 rounded bg-cyan-600 hover:bg-cyan-500 text-black font-mono font-bold text-[10px] uppercase transition disabled:opacity-50"
                      >
                        {isSavingNote ? "Saving Note..." : "Save Field Note"}
                      </button>
                    </div>

                    {/* Raw Telemetry Specs */}
                    <div className="rounded-lg border border-white/10 bg-[#080d1b] p-2.5 space-y-1 font-mono text-[10px] text-slate-400">
                      <span className="text-[10px] uppercase font-bold text-slate-400 tracking-wider block mb-1">
                        Technical Telemetry
                      </span>
                      <div className="flex justify-between py-0.5 border-b border-white/5">
                        <span>Incident UUID:</span>
                        <span className="text-slate-300 truncate max-w-[170px]">{selectedIncident.id}</span>
                      </div>
                      <div className="flex justify-between py-0.5 border-b border-white/5">
                        <span>Reporter ID:</span>
                        <span className="text-slate-300 truncate max-w-[170px]">{selectedIncident.user_id || "Anonymous"}</span>
                      </div>
                      <div className="flex justify-between py-0.5 border-b border-white/5">
                        <span>Severity:</span>
                        <span className="text-slate-300">{selectedIncident.severity} / 5</span>
                      </div>
                      <div className="flex justify-between py-0.5">
                        <span>Created At:</span>
                        <span className="text-slate-300">{selectedIncident.created_at || "N/A"}</span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ---------------- TAB 4: ACTIVITY / HISTORY ---------------- */}
                {activeDetailsTab === "activity" && (
                  <div className="space-y-2.5 text-xs font-mono">
                    {/* Header bar with count and refresh */}
                    <div className="flex items-center justify-between pb-1.5 border-b border-white/10">
                      <span className="text-[10px] uppercase font-bold text-cyan-400 tracking-wider flex items-center gap-1.5">
                        <span>📜</span>
                        <span>Persistent Audit Trail</span>
                      </span>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] bg-black/40 border border-white/10 px-1.5 py-0.5 rounded text-slate-400">
                          {auditEvents.length} Events
                        </span>
                        <button
                          type="button"
                          onClick={() => fetchAuditEvents(selectedIncident.id)}
                          disabled={eventsLoading}
                          title="Refresh audit history"
                          className="text-[11px] text-slate-400 hover:text-white transition disabled:opacity-50"
                        >
                          ↻
                        </button>
                      </div>
                    </div>

                    {/* Loading State */}
                    {eventsLoading && (
                      <div className="flex flex-col items-center justify-center py-8 text-slate-400 gap-2">
                        <div className="h-5 w-5 rounded-full border-2 border-cyan-500 border-t-transparent animate-spin"></div>
                        <span className="text-[10px] text-slate-400">Loading audit history...</span>
                      </div>
                    )}

                    {/* Error State */}
                    {!eventsLoading && eventsError && (
                      <div className="p-2.5 rounded bg-red-950/40 border border-red-500/30 text-red-200 text-[11px] space-y-1">
                        <div className="flex items-center gap-1.5">
                          <span>⚠️</span>
                          <span>{eventsError}</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => fetchAuditEvents(selectedIncident.id)}
                          className="text-[10px] text-cyan-400 hover:underline font-bold"
                        >
                          Retry
                        </button>
                      </div>
                    )}

                    {/* Empty State */}
                    {!eventsLoading && !eventsError && auditEvents.length === 0 && (
                      <div className="flex flex-col items-center justify-center py-8 text-slate-500 text-center px-2">
                        <span className="text-xl mb-1">📋</span>
                        <p className="text-[11px] text-slate-300 font-bold uppercase">No Audit Events Logged</p>
                        <p className="text-[10px] text-slate-500 mt-0.5">
                          Audit events are recorded when incidents are reported, updated, or dispatched.
                        </p>
                      </div>
                    )}

                    {/* Timeline items */}
                    {!eventsLoading && !eventsError && auditEvents.length > 0 && (
                      <div className="space-y-3 border-l border-white/10 pl-3.5 ml-1.5 mt-2">
                        {auditEvents.map((event) => {
                          let markerColor = "bg-slate-400";
                          if (event.event_type === "incident_created") {
                            markerColor = "bg-cyan-400 ring-2 ring-cyan-500/30";
                          } else if (event.event_type === "status_changed") {
                            markerColor = "bg-emerald-400 ring-2 ring-emerald-500/30";
                          } else if (event.event_type === "responder_assigned") {
                            markerColor = "bg-purple-400 ring-2 ring-purple-500/30";
                          } else if (event.event_type === "responder_unassigned") {
                            markerColor = "bg-amber-400 ring-2 ring-amber-500/30";
                          } else if (event.event_type === "note_added" || event.event_type === "note_updated") {
                            markerColor = "bg-sky-400 ring-2 ring-sky-500/30";
                          }

                          const label = event.metadata?.action_label || event.event_type.replace(/_/g, " ");
                          const actorName = event.metadata?.actor_name || "System Operator";
                          const actorRole = event.metadata?.actor_role || "user";

                          return (
                            <div key={event.id} className="relative group">
                              <span
                                className={`absolute -left-[19px] top-1 h-2 w-2 rounded-full ${markerColor}`}
                              ></span>

                              <div className="flex items-start justify-between gap-1">
                                <span className="text-[11px] font-bold text-slate-200 capitalize">
                                  {label}
                                </span>
                                <span className="text-[9px] text-slate-500 shrink-0">
                                  {formatRelativeTime(event.created_at)}
                                </span>
                              </div>

                              <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mt-0.5">
                                <span>by</span>
                                <strong className="text-cyan-300 font-semibold">{actorName}</strong>
                                <span className="text-[9px] text-slate-500 uppercase">({actorRole})</span>
                              </div>

                              {/* State changes / details */}
                              {event.event_type === "status_changed" && Boolean(event.new_state) && (
                                <div className="mt-1 bg-black/30 border border-white/5 p-1 rounded text-[10px] text-slate-300 flex items-center gap-1.5">
                                  <span className="text-slate-500">Transition:</span>
                                  <span className="text-slate-400">{String(event.previous_state?.status || "reported")}</span>
                                  <span>→</span>
                                  <span className="text-emerald-400 font-bold uppercase">{String(event.new_state?.status || "")}</span>
                                </div>
                              )}

                              {event.event_type === "responder_assigned" && (
                                <div className="mt-1 bg-purple-950/20 border border-purple-500/20 p-1 rounded text-[10px] text-purple-200 flex items-center gap-1">
                                  <span>👤 Unit:</span>
                                  <span className="font-bold">
                                    {String(event.metadata?.assigned_responder_name || event.new_state?.assigned_to || "Assigned")}
                                  </span>
                                </div>
                              )}

                              {(event.event_type === "note_added" || event.event_type === "note_updated") && Boolean(event.new_state?.note) && (
                                <div className="mt-1 bg-sky-950/20 border border-sky-500/20 p-1.5 rounded text-[10px] text-sky-200 italic">
                                  &ldquo;{String(event.new_state?.note)}&rdquo;
                                </div>
                              )}

                              <p className="text-[9px] text-slate-500 mt-0.5">
                                {new Date(event.created_at).toLocaleString()}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* ======================================================
                  BOTTOM WORKFLOW ACTION BUTTONS
              ====================================================== */}
              <div className="p-3 border-t border-white/10 bg-[#080d1b] space-y-2">
                <span className="text-[9px] font-mono uppercase font-bold text-slate-400 tracking-wider block">
                  Workflow State Controls:
                </span>
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[10px]">
                  {selectedIncident.status === "reported" && (
                    <button
                      type="button"
                      onClick={() => handleUpdate(selectedIncident.id, "verified")}
                      disabled={actionLoadingId === selectedIncident.id}
                      className="py-1.5 px-2 rounded bg-sky-600/30 hover:bg-sky-600/50 text-sky-200 border border-sky-500/40 font-bold transition disabled:opacity-50"
                    >
                      Verify Report
                    </button>
                  )}

                  {selectedIncident.status !== "in_progress" && selectedIncident.status !== "resolved" && selectedIncident.status !== "cancelled" && (
                    <button
                      type="button"
                      onClick={() => handleUpdate(selectedIncident.id, "in_progress")}
                      disabled={actionLoadingId === selectedIncident.id}
                      className="py-1.5 px-2 rounded bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 font-bold transition disabled:opacity-50"
                    >
                      Mark In Progress
                    </button>
                  )}

                  {selectedIncident.status !== "resolved" && selectedIncident.status !== "cancelled" && (
                    <button
                      type="button"
                      onClick={() => handleUpdate(selectedIncident.id, "resolved")}
                      disabled={actionLoadingId === selectedIncident.id}
                      className="py-1.5 px-2 rounded bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-200 border border-emerald-500/40 font-bold transition disabled:opacity-50"
                    >
                      Resolve Incident
                    </button>
                  )}

                  {selectedIncident.status !== "cancelled" && selectedIncident.status !== "resolved" && (
                    <button
                      type="button"
                      onClick={() => handleUpdate(selectedIncident.id, "cancelled")}
                      disabled={actionLoadingId === selectedIncident.id}
                      className="py-1.5 px-2 rounded bg-red-600/20 hover:bg-red-600/40 text-red-300 border border-red-500/30 font-bold transition disabled:opacity-50"
                    >
                      Cancel Incident
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </aside>
      </main>

      {/* ======================================================
          SIMULATION & SAFETY CONFIRMATION MODALS
      ====================================================== */}
      {/* 1. DISASTER SIMULATION MODAL */}
      {simulateDisasterOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="max-w-md w-full rounded-2xl border border-red-500/40 bg-[#080d1b] p-5 shadow-2xl space-y-3 font-mono">
            <div className="flex items-center gap-2 text-red-400">
              <span className="text-xl">⚡</span>
              <h3 className="font-bold text-sm uppercase">Launch Disaster Simulation Demo</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              This will report a severe emergency scenario (<strong>[DEMO] Flash Flood &amp; Structural Distress</strong>, Severity 4) through the authenticated incident reporting API.
            </p>
            {replaceExistingDemo && (
              <p className="text-[11px] text-amber-400 bg-amber-500/10 p-2 rounded border border-amber-500/20 font-sans">
                Note: Replace-Existing mode is active. Existing persistent database records are preserved to prevent data loss.
              </p>
            )}
            <div className="flex justify-end gap-2 pt-2 border-t border-white/10 text-xs font-mono">
              <button
                type="button"
                onClick={() => setSimulateDisasterOpen(false)}
                className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSimulateDisaster}
                disabled={isSimulating}
                className="px-4 py-1.5 rounded bg-red-600 hover:bg-red-500 text-white font-bold transition disabled:opacity-50"
              >
                {isSimulating ? "Injecting..." : "Confirm & Inject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 2. WORLD CUP SIMULATION MODAL */}
      {simulateWorldCupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="max-w-md w-full rounded-2xl border border-purple-500/40 bg-[#080d1b] p-5 shadow-2xl space-y-3 font-mono">
            <div className="flex items-center gap-2 text-purple-400">
              <span className="text-xl">⚽</span>
              <h3 className="font-bold text-sm uppercase">Launch World Cup Simulation Demo</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              This will report a high-density crowd management event (<strong>[DEMO] World Cup Stadium Zone 3: Crowd Congestion &amp; Medical Distress</strong>, Severity 3) through the authenticated incident reporting API.
            </p>
            <div className="flex justify-end gap-2 pt-2 border-t border-white/10 text-xs font-mono">
              <button
                type="button"
                onClick={() => setSimulateWorldCupOpen(false)}
                className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 text-slate-300"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSimulateWorldCup}
                disabled={isSimulating}
                className="px-4 py-1.5 rounded bg-purple-600 hover:bg-purple-500 text-white font-bold transition disabled:opacity-50"
              >
                {isSimulating ? "Injecting..." : "Confirm & Inject"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. ADMINISTRATIVE CLEAR SAFETY MODAL */}
      {clearIncidentsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="max-w-md w-full rounded-2xl border border-amber-500/40 bg-[#080d1b] p-5 shadow-2xl space-y-3 font-mono">
            <div className="flex items-center gap-2 text-amber-400">
              <span className="text-xl">🛡️</span>
              <h3 className="font-bold text-sm uppercase">Administrative Safety Lock</h3>
            </div>
            <p className="text-xs text-slate-300 leading-relaxed font-sans">
              Batch purging of emergency incident records is restricted in production. In compliance with emergency operations audit standards, incident records cannot be batch-deleted without root database administrative console credentials.
            </p>
            <p className="text-[11px] text-slate-400 font-sans">
              Operators should advance individual incidents to <strong>Resolved</strong> or <strong>Cancelled</strong> to maintain audit integrity.
            </p>
            <div className="flex justify-end pt-2 border-t border-white/10 text-xs font-mono">
              <button
                type="button"
                onClick={() => setClearIncidentsOpen(false)}
                className="px-4 py-1.5 rounded bg-cyan-600 hover:bg-cyan-500 text-black font-bold"
              >
                Understood
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
