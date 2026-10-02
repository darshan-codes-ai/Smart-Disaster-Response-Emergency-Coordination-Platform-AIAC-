"use client";

import React from "react";
import { getStatusConfig } from "../lib/status-workflow";

interface StatusBadgeProps {
  status: string | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
  showIcon?: boolean;
}

export default function StatusBadge({
  status,
  size = "md",
  className = "",
  showIcon = true,
}: StatusBadgeProps) {
  const config = getStatusConfig(status);

  const sizeClasses = {
    sm: "px-2 py-0.5 text-[10px] gap-1",
    md: "px-2.5 py-1 text-xs gap-1.5",
    lg: "px-3 py-1.5 text-sm gap-2",
  }[size];

  return (
    <span
      className={`inline-flex items-center font-semibold rounded-full border tracking-wide uppercase ${sizeClasses} ${config.badgeClass} ${className}`}
    >
      {showIcon && <span className="text-[1.1em] leading-none">{config.icon}</span>}
      <span>{config.label}</span>
    </span>
  );
}
