"use client";

import React, { useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCurrentUser } from "../lib/supabase/use-current-user";
import { createClient } from "../lib/supabase/client";

interface NavbarProps {
  currentSection?: string;
  actionButton?: React.ReactNode;
  className?: string;
}

export default function Navbar({ currentSection, actionButton, className = "" }: NavbarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { profile, role, isCommandCenter, isResponder } = useCurrentUser();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    try {
      setLoggingOut(true);
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/login");
      router.refresh();
    } catch (err) {
      console.error("Logout error:", err);
      setLoggingOut(false);
    }
  };

  const getRoleBadgeStyle = (r: string) => {
    switch (r) {
      case "admin":
        return "bg-purple-500/15 text-purple-300 border-purple-500/30";
      case "command_center":
        return "bg-sky-500/15 text-sky-300 border-sky-500/30";
      case "responder":
        return "bg-orange-500/15 text-orange-300 border-orange-500/30";
      case "hospital":
        return "bg-teal-500/15 text-teal-300 border-teal-500/30";
      case "shelter":
        return "bg-amber-500/15 text-amber-300 border-amber-500/30";
      case "citizen":
      default:
        return "bg-emerald-500/15 text-emerald-300 border-emerald-500/30";
    }
  };

  const navLinks = [
    { href: "/", label: "Dashboard", show: true },
    { href: "/incidents", label: "Incident Feed", show: true },
    { href: "/command", label: "Command Center", show: isCommandCenter },
    { href: "/responder", label: "Responder Console", show: isResponder },
  ].filter((item) => item.show);

  return (
    <header className={`border-b border-white/10 bg-[#070b14]/95 backdrop-blur-md sticky top-0 z-40 ${className}`}>
      <div className="mx-auto flex max-w-7xl items-center justify-between px-4 sm:px-6 py-3.5">
        {/* BRANDING WORDMARK */}
        <div className="flex items-center gap-6">
          <Link href="/" className="flex items-center gap-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500 rounded-lg">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-500 border border-white/20 shadow-md shadow-blue-900/30 group-hover:scale-105 transition-transform">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.8-3.7 5.3-.8L12 2z" />
              </svg>
            </div>
            <div className="flex flex-col">
              <div className="flex items-center gap-2">
                <span className="font-extrabold tracking-wider text-base text-white">
                  RESCUE<span className="text-sky-400">GRID</span>
                </span>
                {currentSection && (
                  <span className="hidden sm:inline-block text-[11px] font-medium text-slate-400 border-l border-white/10 pl-2">
                    {currentSection}
                  </span>
                )}
              </div>
              <span className="hidden lg:block text-[10px] text-slate-400 font-medium tracking-tight">
                Smart Disaster Response &amp; Emergency Coordination
              </span>
            </div>
          </Link>

          {/* DESKTOP NAV LINKS */}
          <nav className="hidden md:flex items-center gap-1.5 ml-2">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    isActive
                      ? "bg-white/10 text-white border border-white/15 shadow-sm"
                      : "text-slate-400 hover:text-slate-200 hover:bg-white/5"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </nav>
        </div>

        {/* RIGHT CONTROLS: ACTION BUTTON, USER, ROLE, LOGOUT */}
        <div className="flex items-center gap-2.5">
          {actionButton && <div className="hidden sm:block">{actionButton}</div>}

          {/* ROLE INDICATOR */}
          <div className="hidden sm:flex items-center">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-bold uppercase tracking-wider border ${getRoleBadgeStyle(
                role
              )}`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current mr-1.5 animate-pulse" />
              {role.replace("_", " ")}
            </span>
          </div>

          {/* USER PROFILE INFO */}
          <div className="hidden lg:flex flex-col text-right text-xs">
            <span className="font-medium text-slate-200 truncate max-w-[140px]">
              {profile?.full_name || profile?.email?.split("@")[0] || "Authenticated"}
            </span>
            <span className="text-[10px] text-slate-400 truncate max-w-[140px]">
              {profile?.email || ""}
            </span>
          </div>

          {/* LOGOUT BUTTON */}
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            title="Sign out"
            className="hidden sm:inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-white/10 bg-white/5 hover:bg-white/10 text-xs font-medium text-slate-300 hover:text-white transition disabled:opacity-50"
          >
            <span>{loggingOut ? "..." : "Sign Out"}</span>
          </button>

          {/* MOBILE MENU TOGGLE */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            aria-label="Toggle mobile menu"
            className="md:hidden flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10 transition"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {mobileMenuOpen ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* MOBILE DROPDOWN DRAWER */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-white/10 bg-[#0a0f1d] px-4 py-4 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between pb-3 border-b border-white/5">
            <div className="flex flex-col">
              <span className="text-xs font-semibold text-white">
                {profile?.full_name || "RescueGrid User"}
              </span>
              <span className="text-[11px] text-slate-400">{profile?.email}</span>
            </div>
            <span
              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${getRoleBadgeStyle(
                role
              )}`}
            >
              {role.replace("_", " ")}
            </span>
          </div>

          <nav className="flex flex-col space-y-1">
            {navLinks.map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  onClick={() => setMobileMenuOpen(false)}
                  className={`px-3 py-2 rounded-lg text-sm font-semibold transition flex items-center justify-between ${
                    isActive
                      ? "bg-sky-500/20 text-sky-300 border border-sky-500/30"
                      : "text-slate-300 hover:bg-white/5 hover:text-white"
                  }`}
                >
                  <span>{link.label}</span>
                  {isActive && <span className="h-1.5 w-1.5 rounded-full bg-sky-400" />}
                </Link>
              );
            })}
          </nav>

          {actionButton && <div className="pt-2">{actionButton}</div>}

          <div className="pt-2 border-t border-white/5">
            <button
              onClick={handleLogout}
              disabled={loggingOut}
              className="w-full rounded-lg border border-red-500/30 bg-red-950/30 hover:bg-red-900/40 text-red-300 px-4 py-2 text-xs font-semibold transition text-center"
            >
              {loggingOut ? "Signing Out..." : "Sign Out of RescueGrid"}
            </button>
          </div>
        </div>
      )}
    </header>
  );
}
