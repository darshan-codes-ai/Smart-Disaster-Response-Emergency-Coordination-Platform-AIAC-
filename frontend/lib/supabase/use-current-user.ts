"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "./client";
import { getAccessToken, requestWithToken } from "./access-token";

export interface UserProfile {
  id: string;
  email: string | null;
  role: "citizen" | "responder" | "hospital" | "shelter" | "command_center" | "admin" | string;
  full_name: string | null;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

export function useCurrentUser() {
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchProfile = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();

      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const token = await getAccessToken();
      if (!token) {
        // Fallback to citizen with user metadata if token is unavailable
        setProfile({
          id: user.id,
          email: user.email ?? null,
          role: "citizen",
          full_name: (user.user_metadata?.full_name as string) ?? null,
        });
        setLoading(false);
        return;
      }

      let res = await requestWithToken(`${API_URL}/me`, token);
      if (res.status === 401) {
        const freshToken = await getAccessToken(true);
        if (freshToken) {
          res = await requestWithToken(`${API_URL}/me`, freshToken);
        }
      }

      if (res.ok) {
        const data = await res.json();
        setProfile(data);
      } else {
        // Graceful fallback to citizen
        setProfile({
          id: user.id,
          email: user.email ?? null,
          role: "citizen",
          full_name: (user.user_metadata?.full_name as string) ?? null,
        });
      }
    } catch (err) {
      console.warn("Failed to load user profile:", err);
      setError(err instanceof Error ? err.message : "Failed to load profile");
      // Default to citizen
      setProfile((prev) => prev ?? {
        id: "anonymous",
        email: null,
        role: "citizen",
        full_name: null,
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.resolve().then(() => {
      if (!ignore) {
        fetchProfile();
      }
    });
    return () => {
      ignore = true;
    };
  }, [fetchProfile]);

  const role = profile?.role ?? "citizen";
  const isOperational = ["responder", "command_center", "admin", "hospital", "shelter"].includes(role);
  const isCommandCenter = ["command_center", "admin"].includes(role);
  const isResponder = ["responder", "admin"].includes(role);

  return {
    profile,
    role,
    isOperational,
    isCommandCenter,
    isResponder,
    loading,
    error,
    refresh: fetchProfile,
  };
}
