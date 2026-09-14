"use client";

import { createClient } from "./client";

// Keep one browser auth client for the lifetime of this module. Multiple
// browser clients can race while rotating the same Supabase refresh token.
const supabase = createClient();

let refreshingDeferred: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  if (refreshingDeferred) return refreshingDeferred;

  refreshingDeferred = (async () => {
    try {
      // Read the current session first, then explicitly pass its refresh token.
      // This avoids refreshSession() selecting an older cached session while
      // another component is already rotating the session.
      const { data: sessionData, error: sessionError } =
        await supabase.auth.getSession();

      if (sessionError || !sessionData.session?.refresh_token) {
        return null;
      }

      const { data, error } = await supabase.auth.refreshSession({
        refresh_token: sessionData.session.refresh_token,
      });

      if (error || !data.session?.access_token) {
        console.error(
          "Supabase session refresh failed:",
          error?.message ?? "No access token returned"
        );
        return null;
      }

      return data.session.access_token;
    } catch (error) {
      console.error("Supabase session refresh failed:", error);
      return null;
    } finally {
      refreshingDeferred = null;
    }
  })();

  return refreshingDeferred;
}

/**
 * Returns an access token suitable for FastAPI.
 *
 * Normal calls use the current session. Expired/near-expiry sessions are
 * explicitly refreshed. forceRefresh=true always performs an explicit
 * refresh and is used after a backend 401.
 */
export async function getAccessToken(
  forceRefresh = false
): Promise<string | null> {
  try {
    const {
      data: { session },
      error,
    } = await supabase.auth.getSession();

    if (error) {
      console.error("Supabase getSession failed:", error.message);
      return null;
    }

    const expiresAt = session?.expires_at ?? 0;
    const now = Math.floor(Date.now() / 1000);
    const expiresSoon = !expiresAt || expiresAt <= now + 60;

    if (!forceRefresh && session?.access_token && !expiresSoon) {
      return session.access_token;
    }

    return refreshAccessToken();
  } catch (error) {
    console.error("Supabase access-token lookup failed:", error);
    return null;
  }
}

/**
 * Sends a request with an explicitly selected Supabase access token.
 * The Authorization header is never allowed to be overwritten by another
 * interceptor.
 */
export async function requestWithToken(
  url: string,
  accessToken: string,
  init: RequestInit = {}
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${accessToken}`);

  return fetch(url, { ...init, headers });
}
