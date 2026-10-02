"use client";

import { FormEvent, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    setMessage("");

    try {
      if (mode === "signup") {
        const { data, error } = await supabase.auth.signUp({
          email,
          password,
          options: { data: { full_name: fullName } },
        });

        if (error) throw error;

        if (!data.session) {
          setMessage("Account registered successfully. Check your email to confirm your account, then log in.");
        } else {
          router.push("/");
          router.refresh();
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (error) throw error;
        router.push("/");
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-[#070b14] text-white flex items-center justify-center p-4 sm:p-6 lg:p-8">
      <div className="w-full max-w-5xl grid lg:grid-cols-2 rounded-3xl border border-white/10 bg-[#0e1424] shadow-2xl overflow-hidden">
        {/* LEFT COLUMN: HERO & BRANDING (DESKTOP) */}
        <div className="hidden lg:flex flex-col justify-between p-10 bg-gradient-to-br from-[#0c1322] via-[#09101d] to-[#060a14] border-r border-white/10 relative overflow-hidden">
          <div className="absolute top-0 right-0 transform translate-x-12 -translate-y-12 w-64 h-64 bg-sky-600/10 rounded-full blur-3xl pointer-events-none"></div>

          {/* BRAND WORDMARK */}
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-500 border border-white/20 shadow-lg shadow-blue-900/40">
              <svg className="w-6 h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.8-3.7 5.3-.8L12 2z" />
              </svg>
            </div>
            <div>
              <span className="font-extrabold tracking-wider text-xl text-white">
                RESCUE<span className="text-sky-400">GRID</span>
              </span>
              <p className="text-[11px] text-slate-400 font-medium tracking-tight">
                Smart Disaster Response &amp; Emergency Coordination
              </p>
            </div>
          </div>

          {/* HERO CONTENT */}
          <div className="space-y-6 my-auto py-8">
            <div className="inline-flex items-center gap-2 rounded-full border border-sky-500/30 bg-sky-500/10 px-3.5 py-1 text-xs font-semibold text-sky-300">
              <span className="h-2 w-2 rounded-full bg-sky-400 animate-pulse"></span>
              Operational Network Live
            </div>

            <h1 className="text-3xl font-extrabold tracking-tight text-white leading-tight">
              Rapid Emergency Response <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-blue-400">
                Coordinated in Real-Time
              </span>
            </h1>

            <p className="text-slate-300 text-sm leading-relaxed max-w-md">
              RescueGrid connects citizens, emergency dispatch centers, and field first responders on an integrated geospatial platform to streamline crisis management and lifesaving response.
            </p>

            <div className="grid grid-cols-2 gap-3 pt-2">
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <span className="text-xs font-bold text-white block">Geospatial Telemetry</span>
                <span className="text-[11px] text-slate-400">MapLibre GL incident tracking</span>
              </div>
              <div className="rounded-xl border border-white/5 bg-white/[0.02] p-3">
                <span className="text-xs font-bold text-white block">Triage Orchestration</span>
                <span className="text-[11px] text-slate-400">Role-governed response queues</span>
              </div>
            </div>
          </div>

          {/* FOOTER BADGE */}
          <div className="text-[11px] text-slate-400 flex items-center justify-between border-t border-white/5 pt-4">
            <span>RescueGrid Core v2.4</span>
            <span className="text-slate-400">Secure Protocol</span>
          </div>
        </div>

        {/* RIGHT COLUMN: AUTHENTICATION CARD */}
        <div className="p-8 sm:p-10 flex flex-col justify-center">
          {/* MOBILE LOGO */}
          <div className="lg:hidden flex items-center gap-2.5 mb-6">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 to-sky-500 border border-white/20">
              <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 2l2.4 4.8 5.3.8-3.8 3.7.9 5.3-4.8-2.5-4.8 2.5.9-5.3-3.8-3.7 5.3-.8L12 2z" />
              </svg>
            </div>
            <div>
              <span className="font-extrabold tracking-wider text-base text-white">
                RESCUE<span className="text-sky-400">GRID</span>
              </span>
              <p className="text-[10px] text-slate-400">Smart Disaster Response</p>
            </div>
          </div>

          {/* TABS */}
          <div className="mb-6 flex rounded-xl bg-black/40 border border-white/10 p-1">
            <button
              type="button"
              onClick={() => {
                setMode("login");
                setError("");
                setMessage("");
              }}
              className={`flex-1 rounded-lg px-4 py-2 text-xs font-bold transition ${
                mode === "login"
                  ? "bg-sky-600 text-white shadow-md shadow-sky-900/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setMode("signup");
                setError("");
                setMessage("");
              }}
              className={`flex-1 rounded-lg px-4 py-2 text-xs font-bold transition ${
                mode === "signup"
                  ? "bg-sky-600 text-white shadow-md shadow-sky-900/40"
                  : "text-slate-400 hover:text-white"
              }`}
            >
              Create Account
            </button>
          </div>

          <div className="mb-5">
            <h2 className="text-xl font-bold text-white">
              {mode === "login" ? "Welcome Back to RescueGrid" : "Create Citizen Account"}
            </h2>
            <p className="mt-1 text-xs text-slate-400 leading-relaxed">
              {mode === "login"
                ? "Enter your credentials to access your emergency dashboard."
                : "Register to submit verified emergency reports and receive area alerts."}
            </p>
          </div>

          {/* FORM */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === "signup" && (
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                  Full Name
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  placeholder="e.g. Alex Morgan"
                  required
                  className="w-full rounded-xl border border-white/10 bg-[#070b14] px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500 transition"
                />
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                required
                className="w-full rounded-xl border border-white/10 bg-[#070b14] px-3.5 py-2.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500 transition"
              />
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-slate-300">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  required
                  minLength={6}
                  className="w-full rounded-xl border border-white/10 bg-[#070b14] pl-3.5 pr-10 py-2.5 text-xs text-white placeholder:text-slate-500 outline-none focus:border-sky-500 transition"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label="Toggle password visibility"
                  className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-200 text-xs"
                >
                  {showPassword ? "Hide" : "Show"}
                </button>
              </div>
            </div>

            {error && (
              <div role="alert" className="rounded-xl border border-red-500/30 bg-red-950/40 p-3 text-xs text-red-200">
                {error}
              </div>
            )}

            {message && (
              <div role="status" className="rounded-xl border border-emerald-500/30 bg-emerald-950/40 p-3 text-xs text-emerald-200">
                {message}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full rounded-xl bg-gradient-to-r from-sky-600 to-blue-600 hover:from-sky-500 hover:to-blue-500 py-3 font-bold text-xs text-white transition shadow-lg shadow-sky-950/50 disabled:cursor-not-allowed disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && (
                <div className="h-3.5 w-3.5 rounded-full border-2 border-white border-t-transparent animate-spin"></div>
              )}
              <span>
                {loading
                  ? "Authenticating..."
                  : mode === "login"
                  ? "Sign In to RescueGrid"
                  : "Register Account"}
              </span>
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
