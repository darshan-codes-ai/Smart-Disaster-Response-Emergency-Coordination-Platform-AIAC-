"use client";

import { createClient } from "./client";

let refreshingDeferred: Promise<string | null> | null = null;

/**
 * Returns a valid Supabase access token for backend API requests.
 *
 * - Uses the current session when one exists (the underlying Supabase client
 *   auto-refreshes tokens that are near or past expiry).
 * - Falls back to an explicit refresh when no usable session is available.
 * - When `forceRefresh` is true (e.g. after the backend returned a 401), it
 *   will always call `refreshSession()` so the caller receives a brand new,
 *   definitively fresh token for a retry.
 *
 * `null` is returned only when there is no authenticated session at all
 * (login required), or when token refresh fails.
 */
export async function getAccessToken(
  forceRefresh = false
): Promise<string | null> {
  const supabase = createClient();

  // Fast path: use the existing session token (getSession auto-refreshes
  // expired tokens).
  if (!forceRefresh) {
    const {
      data: { session },
    } = await supabase.auth.getSession();

    // Do not trust an old cached token indefinitely. If the token is
    // missing an expiry or is close to expiry, explicitly refresh it.
    const expiresAt = session?.expires_at ?? 0;
    const expiresSoon =
      expiresAt > 0 && expiresAt <= Math.floor(Date.now() / 1000) + 60;

    if (session?.access_token && !expiresSoon) {
      return session.access_token;
    }
  }

  // No valid session (or caller explicitly wants a fresh token): refresh.
  if (!refreshingDeferred) {
    refreshingDeferred = (async () => {
      const { data, error } = await supabase.auth.refreshSession();
      if (error) {
        console.error("Supabase refreshSession error:", error.message);
        return null;
      }
      return data.session?.access_token ?? null;
    })().finally(() => {
      refreshingDeferred = null;
    });
  }

  return refreshingDeferred;
}

/**
 * Request helper that attaches the given access token to the API request.
 * Uses the same API base URL as the rest of the dashboard.
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
