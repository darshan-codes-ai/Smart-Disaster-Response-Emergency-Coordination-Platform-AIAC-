"use client";

import { FormEvent, useState } from "react";
import { createClient } from "../../lib/supabase/client";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
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
          setMessage("Account created. Check your email to confirm your account, then log in.");
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
    <main className="min-h-screen bg-[#05070d] px-6 py-12 text-white">
      <div className="mx-auto max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-4xl font-bold">🚨 AIAC</h1>
          <p className="mt-2 text-slate-400">Smart Disaster Response & Emergency Coordination</p>
        </div>

        <div className="rounded-2xl border border-white/10 bg-[#101522] p-7 shadow-2xl">
          <div className="mb-6 flex rounded-lg bg-black/20 p-1">
            <button onClick={() => setMode("login")} className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold ${mode === "login" ? "bg-blue-600" : "text-slate-400"}`}>
              Login
            </button>
            <button onClick={() => setMode("signup")} className={`flex-1 rounded-md px-4 py-2 text-sm font-semibold ${mode === "signup" ? "bg-blue-600" : "text-slate-400"}`}>
              Create Account
            </button>
          </div>

          <h2 className="text-2xl font-bold">{mode === "login" ? "Welcome back" : "Create your account"}</h2>
          <p className="mt-1 text-sm text-slate-400">
            {mode === "login" ? "Sign in to access the disaster response platform." : "New accounts are created with the citizen role."}
          </p>

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            {mode === "signup" && (
              <label className="block">
                <span className="mb-2 block text-sm font-medium">Full name</span>
                <input value={fullName} onChange={(e) => setFullName(e.target.value)} required className="w-full rounded-lg border border-white/10 bg-[#080b14] px-4 py-3 outline-none focus:border-blue-500" />
              </label>
            )}

            <label className="block">
              <span className="mb-2 block text-sm font-medium">Email</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required className="w-full rounded-lg border border-white/10 bg-[#080b14] px-4 py-3 outline-none focus:border-blue-500" />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-medium">Password</span>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} className="w-full rounded-lg border border-white/10 bg-[#080b14] px-4 py-3 outline-none focus:border-blue-500" />
            </label>

            {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">{error}</div>}
            {message && <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-3 text-sm text-green-300">{message}</div>}

            <button disabled={loading} className="w-full rounded-lg bg-red-600 px-5 py-3 font-bold transition hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50">
              {loading ? "Please wait..." : mode === "login" ? "Login" : "Create Account"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
