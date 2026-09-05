"use client";

import { useEffect } from "react";
import { createClient } from "../lib/supabase/client";

const API_URL = "http://localhost:8000";

/**
 * Adds the current Supabase access token to browser requests sent to FastAPI.
 * This keeps the existing dashboard code compatible with the authenticated API.
 */
export default function ApiAuthProvider() {
  useEffect(() => {
    const supabase = createClient();
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

      const {
        data: { session },
      } = await supabase.auth.getSession();

      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined)
      );

      if (session?.access_token) {
        headers.set("Authorization", `Bearer ${session.access_token}`);
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
