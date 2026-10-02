export type IncidentStatus =
  | "reported"
  | "verified"
  | "assigned"
  | "in_progress"
  | "resolved"
  | "cancelled";

export const ALLOWED_STATUSES: IncidentStatus[] = [
  "reported",
  "verified",
  "assigned",
  "in_progress",
  "resolved",
  "cancelled",
];

export const STATUS_WORKFLOW_SEQUENCE: IncidentStatus[] = [
  "reported",
  "verified",
  "assigned",
  "in_progress",
  "resolved",
];

export interface StatusConfig {
  label: string;
  badgeClass: string;
  icon: string;
  description: string;
}

export function getStatusConfig(status: string | null | undefined): StatusConfig {
  const s = (status || "reported").toLowerCase();

  switch (s) {
    case "verified":
      return {
        label: "Verified",
        badgeClass: "bg-sky-500/15 text-sky-400 border-sky-500/30",
        icon: "🔍",
        description: "Verified by emergency dispatch",
      };
    case "assigned":
      return {
        label: "Assigned",
        badgeClass: "bg-purple-500/15 text-purple-400 border-purple-500/30",
        icon: "📋",
        description: "Dispatched to emergency responders",
      };
    case "in_progress":
      return {
        label: "In Progress",
        badgeClass: "bg-blue-500/15 text-blue-400 border-blue-500/30",
        icon: "⚡",
        description: "Active response underway",
      };
    case "resolved":
      return {
        label: "Resolved",
        badgeClass: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
        icon: "✅",
        description: "Emergency cleared and resolved",
      };
    case "cancelled":
      return {
        label: "Cancelled",
        badgeClass: "bg-slate-500/15 text-slate-400 border-slate-500/30",
        icon: "✖",
        description: "Report cancelled or false alarm",
      };
    case "reported":
    default:
      return {
        label: "Reported",
        badgeClass: "bg-amber-500/15 text-amber-400 border-amber-500/30",
        icon: "⚠️",
        description: "Awaiting triage and verification",
      };
  }
}

export function getNextRecommendedStatus(
  currentStatus: string | null | undefined
): IncidentStatus | null {
  const s = (currentStatus || "reported").toLowerCase();
  switch (s) {
    case "reported":
      return "verified";
    case "verified":
      return "assigned";
    case "assigned":
      return "in_progress";
    case "in_progress":
      return "resolved";
    default:
      return null;
  }
}

