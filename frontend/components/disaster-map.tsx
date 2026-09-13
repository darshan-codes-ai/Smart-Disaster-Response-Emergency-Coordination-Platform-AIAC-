"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as maplibregl from "maplibre-gl";
import { createClient } from "../lib/supabase/client";

export interface Incident {
  id: string;
  user_id?: string | null;
  type: string;
  description: string;
  latitude: number;
  longitude: number;
  severity: number;
  status: string;
  priority_score?: number | null;
  note?: string | null;
  created_at: string;
  updated_at?: string | null;
}

interface DisasterMapProps {
  onIncidentSelect?: (incident: Incident | null) => void;
  selectedIncidentId?: string | null;
  onIncidentsLoaded?: (incidents: Incident[]) => void;
  refreshTrigger?: number;
}

// Fallback center coordinates (Telangana / Warangal area where initial incidents are located)
const DEFAULT_CENTER: [number, number] = [79.4687, 18.0873];
const DEFAULT_ZOOM = 12;
const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// Severity metadata config
interface SeverityConfig {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
  textColor: string;
  badgeClass: string;
  icon: string;
}

function getSeverityConfig(severity: number): SeverityConfig {
  switch (severity) {
    case 1:
      return {
        label: "Low",
        color: "#10b981",
        bgColor: "rgba(16, 185, 129, 0.2)",
        borderColor: "#10b981",
        textColor: "#34d399",
        badgeClass: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
        icon: "ℹ️",
      };
    case 2:
      return {
        label: "Medium",
        color: "#f59e0b",
        bgColor: "rgba(245, 158, 11, 0.2)",
        borderColor: "#f59e0b",
        textColor: "#fbbf24",
        badgeClass: "bg-amber-500/10 text-amber-400 border-amber-500/20",
        icon: "⚠️",
      };
    case 3:
      return {
        label: "High",
        color: "#f97316",
        bgColor: "rgba(249, 115, 22, 0.2)",
        borderColor: "#f97316",
        textColor: "#fb923c",
        badgeClass: "bg-orange-500/10 text-orange-400 border-orange-500/20",
        icon: "⚠️",
      };
    case 4:
    case 5:
    default:
      return {
        label: "Critical",
        color: "#ef4444",
        bgColor: "rgba(239, 68, 68, 0.2)",
        borderColor: "#ef4444",
        textColor: "#f87171",
        badgeClass: "bg-red-500/10 text-red-400 border-red-500/20",
        icon: "🚨",
      };
  }
}

function getIncidentTypeIcon(type: string): string {
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

function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    !isNaN(lat) &&
    !isNaN(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export default function DisasterMap({
  onIncidentSelect,
  selectedIncidentId,
  onIncidentsLoaded,
  refreshTrigger,
}: DisasterMapProps) {
  const mapContainerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const userMarkerRef = useRef<maplibregl.Marker | null>(null);
  const activePopupRef = useRef<maplibregl.Popup | null>(null);
  const isInitialLoadRef = useRef<boolean>(true);
  const isMountedRef = useRef<boolean>(true);

  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locatingUser, setLocatingUser] = useState<boolean>(false);

  // ------------------------------------------------------------
  // FETCH INCIDENTS FROM BACKEND
  // ------------------------------------------------------------
  const fetchIncidents = useCallback(
    async () => {
      try {
        const supabase = createClient();
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (session?.access_token) {
          headers["Authorization"] = `Bearer ${session.access_token}`;
        }

        const response = await fetch(`${API_URL}/incidents`, {
          method: "GET",
          headers,
        });

        if (!response.ok) {
          let errorDetail = `Error ${response.status}: Failed to load incidents`;
          try {
            const errData = await response.json();
            if (errData?.detail) errorDetail = errData.detail;
          } catch {
            // keep default
          }
          throw new Error(errorDetail);
        }

        const data = await response.json();
        const fetchedIncidents: Incident[] = Array.isArray(data?.incidents)
          ? data.incidents
          : [];

        if (isMountedRef.current) {
          setIncidents(fetchedIncidents);
          onIncidentsLoaded?.(fetchedIncidents);
        }
      } catch (err) {
        console.error("DisasterMap fetch error:", err);
        if (isMountedRef.current) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : "Unable to connect to incident backend. Please check connection."
          );
        }
      } finally {
        if (isMountedRef.current) {
          setLoading(false);
          setIsRefreshing(false);
        }
      }
    },
    [onIncidentsLoaded]
  );

  // ------------------------------------------------------------
  // INITIALIZE MAP
  // ------------------------------------------------------------
  useEffect(() => {
    isMountedRef.current = true;

    if (!mapContainerRef.current || mapRef.current) return;

    try {
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: {
          version: 8,
          sources: {
            "osm-tiles": {
              type: "raster",
              tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
              tileSize: 256,
              attribution:
                '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
            },
          },
          layers: [
            {
              id: "osm-tiles-layer",
              type: "raster",
              source: "osm-tiles",
              minzoom: 0,
              maxzoom: 19,
            },
          ],
        },
        center: DEFAULT_CENTER,
        zoom: DEFAULT_ZOOM,
        attributionControl: false,
      });

      // Navigation controls: Zoom + Compass
      const navControl = new maplibregl.NavigationControl({
        showCompass: true,
        showZoom: true,
        visualizePitch: true,
      });
      map.addControl(navControl, "top-right");

      // Custom compact attribution control in bottom-right
      map.addControl(
        new maplibregl.AttributionControl({
          compact: true,
        }),
        "bottom-right"
      );

      mapRef.current = map;
    } catch (err) {
      console.error("Failed to initialize MapLibre GL map:", err);
      if (isMountedRef.current) {
        setErrorMessage("Interactive map initialization failed.");
      }
    }

    return () => {
      isMountedRef.current = false;
      if (activePopupRef.current) {
        activePopupRef.current.remove();
        activePopupRef.current = null;
      }
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      if (userMarkerRef.current) {
        userMarkerRef.current.remove();
        userMarkerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, []);

  // Manual refresh with visual spinner
  const handleManualRefresh = useCallback(() => {
    setIsRefreshing(true);
    setErrorMessage(null);
    fetchIncidents();
  }, [fetchIncidents]);

  // Initial fetch and external refresh trigger
  useEffect(() => {
    let ignore = false;

    Promise.resolve().then(() => {
      if (!ignore && isMountedRef.current) {
        fetchIncidents();
      }
    });

    return () => {
      ignore = true;
    };
  }, [fetchIncidents, refreshTrigger]);

  // ------------------------------------------------------------
  // AUTOMATIC REFRESH INTERVAL (15 seconds)
  // ------------------------------------------------------------
  useEffect(() => {
    const interval = setInterval(() => {
      if (isMountedRef.current) {
        fetchIncidents();
      }
    }, 15000);

    return () => clearInterval(interval);
  }, [fetchIncidents]);

  // ------------------------------------------------------------
  // CREATE INCIDENT POPUP CONTENT (Safe DOM creation to prevent XSS)
  // ------------------------------------------------------------
  const createPopupContent = useCallback(
    (incident: Incident): HTMLElement => {
      const config = getSeverityConfig(incident.severity);
      const typeIcon = getIncidentTypeIcon(incident.type);

      const container = document.createElement("div");
      container.className = "p-4 space-y-3 font-sans text-sm text-slate-200";

      // Header with Type and Severity Badge
      const header = document.createElement("div");
      header.className = "flex items-start justify-between gap-3 border-b border-white/10 pb-2.5";

      const titleWrap = document.createElement("div");
      titleWrap.className = "flex items-center gap-2";

      const iconSpan = document.createElement("span");
      iconSpan.className = "text-xl";
      iconSpan.textContent = typeIcon;

      const typeTitle = document.createElement("h4");
      typeTitle.className = "font-bold text-base text-white tracking-wide uppercase";
      typeTitle.textContent = incident.type;

      titleWrap.appendChild(iconSpan);
      titleWrap.appendChild(typeTitle);

      const badgeWrap = document.createElement("span");
      badgeWrap.className = `inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold border ${config.badgeClass}`;
      badgeWrap.textContent = `${config.label} (${incident.severity}/5)`;

      header.appendChild(titleWrap);
      header.appendChild(badgeWrap);
      container.appendChild(header);

      // Description section
      const descBox = document.createElement("div");
      descBox.className = "space-y-1";

      const descLabel = document.createElement("p");
      descLabel.className = "text-[11px] font-medium uppercase tracking-wider text-slate-400";
      descLabel.textContent = "Description";

      const descText = document.createElement("p");
      descText.className = "text-xs text-slate-300 leading-relaxed bg-white/5 p-2 rounded-lg border border-white/5 max-h-24 overflow-y-auto";
      descText.textContent = incident.description || "No description provided.";

      descBox.appendChild(descLabel);
      descBox.appendChild(descText);
      container.appendChild(descBox);

      // Details Grid (Status, Priority Score, Coordinates)
      const detailsGrid = document.createElement("div");
      detailsGrid.className = "grid grid-cols-2 gap-2 text-xs";

      // Status
      const statusBox = document.createElement("div");
      statusBox.className = "bg-white/5 p-2 rounded-lg border border-white/5";
      const statusLabel = document.createElement("span");
      statusLabel.className = "block text-[10px] text-slate-400 uppercase font-medium";
      statusLabel.textContent = "Status";
      const statusVal = document.createElement("span");
      statusVal.className = "font-semibold text-slate-200 capitalize";
      statusVal.textContent = incident.status || "Reported";
      statusBox.appendChild(statusLabel);
      statusBox.appendChild(statusVal);
      detailsGrid.appendChild(statusBox);

      // Priority Score
      const priorityBox = document.createElement("div");
      priorityBox.className = "bg-white/5 p-2 rounded-lg border border-white/5";
      const prioLabel = document.createElement("span");
      prioLabel.className = "block text-[10px] text-slate-400 uppercase font-medium";
      prioLabel.textContent = "Priority Score";
      const prioVal = document.createElement("span");
      prioVal.className = "font-bold text-amber-400";
      prioVal.textContent = String(
        incident.priority_score ?? incident.severity * 20
      );
      priorityBox.appendChild(prioLabel);
      priorityBox.appendChild(prioVal);
      detailsGrid.appendChild(priorityBox);

      container.appendChild(detailsGrid);

      // Footer: Coordinates, ID, and Date
      const footer = document.createElement("div");
      footer.className = "pt-2 border-t border-white/10 space-y-1 text-[11px] text-slate-400";

      const locText = document.createElement("div");
      locText.className = "flex items-center justify-between";
      const locLabel = document.createElement("span");
      locLabel.textContent = "📍 Coordinates:";
      const locVal = document.createElement("span");
      locVal.className = "font-mono text-slate-300";
      locVal.textContent = `${incident.latitude.toFixed(5)}, ${incident.longitude.toFixed(5)}`;
      locText.appendChild(locLabel);
      locText.appendChild(locVal);
      footer.appendChild(locText);

      const idText = document.createElement("div");
      idText.className = "flex items-center justify-between";
      const idLabel = document.createElement("span");
      idLabel.textContent = "🆔 Incident ID:";
      const idVal = document.createElement("span");
      idVal.className = "font-mono text-slate-400 text-[10px]";
      idVal.textContent = incident.id.slice(0, 13) + "...";
      idText.appendChild(idLabel);
      idText.appendChild(idVal);
      footer.appendChild(idText);

      if (incident.created_at) {
        const timeText = document.createElement("div");
        timeText.className = "flex items-center justify-between text-[10px] text-slate-500 pt-1";
        const timeLabel = document.createElement("span");
        timeLabel.textContent = "Reported:";
        const timeVal = document.createElement("span");
        try {
          timeVal.textContent = new Date(incident.created_at).toLocaleString();
        } catch {
          timeVal.textContent = incident.created_at;
        }
        timeText.appendChild(timeLabel);
        timeText.appendChild(timeVal);
        footer.appendChild(timeText);
      }

      container.appendChild(footer);
      return container;
    },
    []
  );

  // ------------------------------------------------------------
  // RENDER MARKERS ON MAP
  // ------------------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // Clear existing incident markers
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = [];

    const validIncidents: Incident[] = [];

    incidents.forEach((incident) => {
      if (!isValidCoordinate(incident.latitude, incident.longitude)) {
        console.warn("Skipping incident with invalid coordinates:", incident);
        return;
      }

      validIncidents.push(incident);

      const config = getSeverityConfig(incident.severity);
      const isSelected = selectedIncidentId === incident.id;

      // Outer wrapper element
      const el = document.createElement("div");
      el.className = "relative flex items-center justify-center cursor-pointer transition-transform duration-200 hover:scale-115";
      el.style.width = "42px";
      el.style.height = "42px";
      el.setAttribute("role", "button");
      el.setAttribute(
        "aria-label",
        `${incident.type} emergency, severity ${config.label}, level ${incident.severity}`
      );
      el.tabIndex = 0;

      // Pulsing radar ring for High & Critical (severity >= 3)
      if (incident.severity >= 3) {
        const pulse = document.createElement("div");
        pulse.className = "absolute inset-0 rounded-full animate-ping pointer-events-none opacity-40";
        pulse.style.backgroundColor = config.color;
        el.appendChild(pulse);
      }

      // Marker circular pin
      const pin = document.createElement("div");
      pin.className = `relative flex items-center justify-center w-9 h-9 rounded-full shadow-lg border-2 transition-all ${
        isSelected
          ? "ring-4 ring-white ring-offset-2 ring-offset-[#05070d] scale-110"
          : ""
      }`;
      pin.style.backgroundColor = config.color;
      pin.style.borderColor = "#ffffff";
      pin.style.boxShadow = `0 4px 14px ${config.color}66`;

      // Icon inside pin
      const iconSpan = document.createElement("span");
      iconSpan.className = "text-base select-none";
      iconSpan.textContent = getIncidentTypeIcon(incident.type);
      pin.appendChild(iconSpan);

      // Severity number badge attached to top-right of pin for color-independent accessibility
      const numBadge = document.createElement("span");
      numBadge.className = "absolute -top-1.5 -right-1.5 flex items-center justify-center w-4 h-4 rounded-full bg-black/90 text-white font-bold text-[9px] border border-white/40 shadow";
      numBadge.textContent = String(incident.severity);
      pin.appendChild(numBadge);

      el.appendChild(pin);

      // Create popup
      const popup = new maplibregl.Popup({
        offset: 24,
        closeButton: true,
        closeOnClick: false,
        className: "aiac-incident-popup",
      }).setDOMContent(createPopupContent(incident));

      popup.on("close", () => {
        onIncidentSelect?.(null);
      });

      // Marker instance
      const marker = new maplibregl.Marker({
        element: el,
        anchor: "center",
      })
        .setLngLat([incident.longitude, incident.latitude])
        .setPopup(popup)
        .addTo(map);

      // Click & Keyboard Enter listener
      const openIncident = () => {
        if (activePopupRef.current && activePopupRef.current !== popup) {
          activePopupRef.current.remove();
        }
        activePopupRef.current = popup;
        marker.togglePopup();
        onIncidentSelect?.(incident);
      };

      el.addEventListener("click", openIncident);
      el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          openIncident();
        }
      });

      markersRef.current.push(marker);
    });

    // Auto-fit bounds on initial load if we have incidents
    if (isInitialLoadRef.current && validIncidents.length > 0) {
      if (validIncidents.length === 1) {
        map.flyTo({
          center: [validIncidents[0].longitude, validIncidents[0].latitude],
          zoom: 14,
          duration: 1000,
        });
      } else {
        const bounds = new maplibregl.LngLatBounds();
        validIncidents.forEach((inc) => {
          bounds.extend([inc.longitude, inc.latitude]);
        });
        map.fitBounds(bounds, {
          padding: 60,
          maxZoom: 15,
          duration: 1000,
        });
      }
      isInitialLoadRef.current = false;
    }
  }, [incidents, selectedIncidentId, onIncidentSelect, createPopupContent]);

  // ------------------------------------------------------------
  // FLY TO SELECTED INCIDENT IF SELECTED OUTSIDE MAP
  // ------------------------------------------------------------
  useEffect(() => {
    if (!selectedIncidentId || !mapRef.current) return;

    const incident = incidents.find((i) => i.id === selectedIncidentId);
    if (!incident || !isValidCoordinate(incident.latitude, incident.longitude))
      return;

    mapRef.current.flyTo({
      center: [incident.longitude, incident.latitude],
      zoom: 15,
      essential: true,
      duration: 1200,
    });
  }, [selectedIncidentId, incidents]);

  // ------------------------------------------------------------
  // USER GEOLOCATION ("📍 My Location")
  // ------------------------------------------------------------
  const handleMyLocation = () => {
    setLocationMessage(null);

    if (!navigator.geolocation) {
      setLocationMessage("Geolocation is not supported by your browser.");
      return;
    }

    setLocatingUser(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocatingUser(false);
        const { latitude, longitude } = position.coords;
        const map = mapRef.current;
        if (!map) return;

        // Remove previous user marker if any
        if (userMarkerRef.current) {
          userMarkerRef.current.remove();
        }

        // Create distinct pulsating user location indicator
        const el = document.createElement("div");
        el.className = "relative flex items-center justify-center";
        el.style.width = "32px";
        el.style.height = "32px";

        const pulse = document.createElement("div");
        pulse.className = "absolute inset-0 rounded-full bg-blue-500/30 animate-ping";
        el.appendChild(pulse);

        const centerDot = document.createElement("div");
        centerDot.className = "relative flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 border-2 border-white shadow-lg text-white text-xs font-bold";
        centerDot.textContent = "📍";
        el.appendChild(centerDot);

        const userPopup = new maplibregl.Popup({ offset: 16 }).setHTML(
          `<div class="p-2 text-xs font-sans text-slate-200">
            <p class="font-bold text-blue-400">📍 You Are Here</p>
            <p class="text-[11px] text-slate-400 mt-0.5 font-mono">${latitude.toFixed(5)}, ${longitude.toFixed(5)}</p>
          </div>`
        );

        userMarkerRef.current = new maplibregl.Marker({
          element: el,
          anchor: "center",
        })
          .setLngLat([longitude, latitude])
          .setPopup(userPopup)
          .addTo(map);

        map.flyTo({
          center: [longitude, latitude],
          zoom: 15,
          essential: true,
          duration: 1200,
        });
      },
      (err) => {
        setLocatingUser(false);
        console.warn("Geolocation denied or failed:", err);
        if (err.code === 1) {
          setLocationMessage("Location permission was not granted.");
        } else {
          setLocationMessage("Unable to detect your location. Please try again.");
        }

        // Auto clear message after 5 seconds
        setTimeout(() => {
          if (isMountedRef.current) {
            setLocationMessage(null);
          }
        }, 5000);
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  // Valid count
  const validIncidentsCount = incidents.filter((i) =>
    isValidCoordinate(i.latitude, i.longitude)
  ).length;

  return (
    <div className="relative flex flex-col w-full overflow-hidden rounded-2xl border border-white/10 bg-[#101522] shadow-2xl">
      {/* ======================================================
          TOP TOOLBAR / CONTROLS
      ====================================================== */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 p-4 bg-[#0c101c]/90 backdrop-blur z-20">
        <div className="flex items-center gap-3">
          <div>
            <h3 className="font-bold text-base text-white flex items-center gap-2">
              <span>Nearby Disaster Map</span>
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
              </span>
            </h3>
            <p className="text-xs text-slate-400">
              Live emergency activity in real time
            </p>
          </div>

          {/* Incident Count Indicator */}
          <div className="hidden sm:inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold bg-white/5 border border-white/10 text-slate-300">
            {loading ? (
              <span className="flex items-center gap-1.5 text-slate-400">
                <span className="inline-block h-2 w-2 rounded-full bg-slate-400 animate-pulse"></span>
                Loading incidents...
              </span>
            ) : validIncidentsCount > 0 ? (
              <span className="flex items-center gap-1.5 text-blue-400">
                <span className="inline-block h-2 w-2 rounded-full bg-blue-400"></span>
                {validIncidentsCount} {validIncidentsCount === 1 ? "incident" : "incidents"}
              </span>
            ) : (
              <span className="text-slate-400">No incidents reported</span>
            )}
          </div>
        </div>

        {/* Action Buttons: My Location & Refresh */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleMyLocation}
            disabled={locatingUser}
            aria-label="Show my location"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 hover:border-blue-500/50 hover:text-white transition disabled:opacity-50"
          >
            <span>{locatingUser ? "⏳" : "📍"}</span>
            <span>{locatingUser ? "Locating..." : "My Location"}</span>
          </button>

          <button
            type="button"
            onClick={handleManualRefresh}
            disabled={isRefreshing}
            aria-label="Refresh incidents"
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 hover:border-blue-500/50 hover:text-white transition disabled:opacity-50"
          >
            <span
              className={`inline-block transition-transform duration-700 ${
                isRefreshing ? "rotate-180" : ""
              }`}
            >
              ↻
            </span>
            <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
          </button>
        </div>
      </div>

      {/* ======================================================
          NOTIFICATION / ERROR BANNERS
      ====================================================== */}
      {locationMessage && (
        <div
          role="alert"
          className="absolute top-16 left-4 right-4 z-30 flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-950/80 p-3 text-xs text-amber-200 backdrop-blur"
        >
          <div className="flex items-center gap-2">
            <span>⚠️</span>
            <span>{locationMessage}</span>
          </div>
          <button
            onClick={() => setLocationMessage(null)}
            className="text-amber-400 hover:text-white text-base px-1"
          >
            ×
          </button>
        </div>
      )}

      {errorMessage && (
        <div
          role="alert"
          className="absolute top-16 left-4 right-4 z-30 flex items-center justify-between rounded-xl border border-red-500/40 bg-red-950/90 p-3 text-xs text-red-200 backdrop-blur shadow-xl"
        >
          <div className="flex items-center gap-2">
            <span>❌</span>
            <span>{errorMessage}</span>
          </div>
          <button
            onClick={handleManualRefresh}
            className="ml-2 px-2 py-0.5 rounded bg-red-800 text-white font-medium hover:bg-red-700 transition"
          >
            Retry
          </button>
        </div>
      )}

      {/* ======================================================
          MAP CANVAS CONTAINER
      ====================================================== */}
      <div className="relative w-full h-[420px] sm:h-[480px] lg:h-[520px] bg-[#070b14]">
        <div ref={mapContainerRef} className="w-full h-full" />

        {/* Loading Overlay */}
        {loading && (
          <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-[#070b14]/75 backdrop-blur-sm">
            <div className="h-8 w-8 rounded-full border-2 border-red-500 border-t-transparent animate-spin mb-3"></div>
            <p className="text-sm font-medium text-slate-300">Loading incidents...</p>
            <p className="text-xs text-slate-500 mt-1">Connecting to emergency coordination server</p>
          </div>
        )}

        {/* Empty State Banner if 0 incidents */}
        {!loading && !errorMessage && validIncidentsCount === 0 && (
          <div className="absolute bottom-6 left-6 z-10 flex items-center gap-2 px-3.5 py-2 rounded-xl bg-black/75 border border-white/10 text-xs text-slate-300 backdrop-blur shadow-lg">
            <span className="text-green-400">🛡️</span>
            <span>No incidents reported in this region.</span>
          </div>
        )}

        {/* ======================================================
            ACCESSIBLE MAP LEGEND
        ====================================================== */}
        <div className="absolute bottom-5 left-5 z-10 rounded-xl border border-white/10 bg-[#0d1424]/90 p-3 backdrop-blur shadow-xl text-xs max-w-[190px]">
          <p className="font-semibold text-[11px] uppercase tracking-wider text-slate-400 mb-2">
            Severity Legend
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-sm shadow-emerald-500/50"></span>
                <span className="text-slate-300">Low</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">1</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-amber-500 shadow-sm shadow-amber-500/50"></span>
                <span className="text-slate-300">Medium</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">2</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-orange-500 shadow-sm shadow-orange-500/50"></span>
                <span className="text-slate-300">High</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">3</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500 shadow-sm shadow-red-500/50"></span>
                <span className="text-slate-300">Critical</span>
              </div>
              <span className="text-[10px] text-slate-500 font-mono">4-5</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
