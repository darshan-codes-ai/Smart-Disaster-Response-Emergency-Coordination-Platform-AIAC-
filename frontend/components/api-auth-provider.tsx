"use client";

import { useEffect } from "react";
import { getAccessToken } from "../lib/supabase/access-token";

const API_URL = "http://localhost:8000";

/**
 * Adds the current Supabase access token to browser requests sent to FastAPI.
 * This keeps the existing dashboard code compatible with the authenticated API.
 */
export default function ApiAuthProvider() {
  useEffect(() => {
    const originalFetch = window.fetch.bind(window);

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const requestUrl =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (!requestUrl.startsWith(API_URL)) {
        return originalFetch(input, init);
      }

      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );

      // Callers like disaster-map.tsx already attach a freshly-refreshed
      // Authorization header (see requestWithToken). Never overwrite it here
      // with a potentially-stale session token from getSession().
      if (!headers.has("Authorization")) {
        const accessToken = await getAccessToken();
        if (accessToken) {
          headers.set("Authorization", `Bearer ${accessToken}`);
        }
      }

      return originalFetch(input, {
        ...init,
        headers,
      });
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
