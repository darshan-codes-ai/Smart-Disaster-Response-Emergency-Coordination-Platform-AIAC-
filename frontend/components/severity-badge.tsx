"use client";

import React from "react";

interface SeverityBadgeProps {
  severity: number | null | undefined;
  size?: "sm" | "md";
  className?: string;
  showScore?: boolean;
}

export function getSeverityConfig(severity: number | null | undefined) {
  const sev = typeof severity === "number" ? severity : 3;

  switch (sev) {
    case 1:
      return {
        label: "Low",
        dotClass: "bg-emerald-400",
        badgeClass: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
        scoreLabel: "1/5",
      };
    case 2:
      return {
        label: "Medium",
        dotClass: "bg-amber-400",
        badgeClass: "bg-amber-500/15 text-amber-300 border-amber-500/30",
        scoreLabel: "2/5",
      };
    case 3:
      return {
        label: "High",
        dotClass: "bg-orange-400",
        badgeClass: "bg-orange-500/15 text-orange-300 border-orange-500/30",
        scoreLabel: "3/5",
      };
    case 4:
    case 5:
    default:
      return {
        label: "Critical",
        dotClass: "bg-red-400 animate-pulse",
        badgeClass: "bg-red-500/15 text-red-300 border-red-500/30",
        scoreLabel: `${sev}/5`,
      };
  }
}

export default function SeverityBadge({
  severity,
  size = "md",
  className = "",
  showScore = false,
}: SeverityBadgeProps) {
  const config = getSeverityConfig(severity);

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[10px] gap-1.5",
    md: "px-2.5 py-1 text-xs gap-1.5",
  }[size];

  return (
    <span
      className={`inline-flex items-center font-semibold rounded-full border tracking-wide uppercase ${sizeClasses} ${config.badgeClass} ${className}`}
    >
      <span className={`inline-block h-1.5 w-1.5 rounded-full ${config.dotClass}`} />
      <span>{config.label}</span>
      {showScore && <span className="opacity-75 font-mono text-[0.9em]">({config.scoreLabel})</span>}
    </span>
  );
}
