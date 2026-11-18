"use client";

import { useEffect } from "react";
import { getAccessToken } from "../lib/supabase/access-token";
import {
  getApiBaseUrl,
  isBackendApiUrl,
  getAlternateApiUrl,
  setApiBaseUrl,
} from "../lib/api-config";

/**
 * Adds the current Supabase access token to browser requests sent to FastAPI.
 * This keeps the existing dashboard code compatible with the authenticated API
 * while providing port fallback between 8010 and 8000.
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

      if (!isBackendApiUrl(requestUrl)) {
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

      try {
        return await originalFetch(input, {
          ...init,
          headers,
        });
      } catch (err: unknown) {
        const isNetworkErr =
          err instanceof TypeError &&
          (err.message.includes("fetch") ||
            err.message.includes("network") ||
            err.message.includes("Failed"));

        if (isNetworkErr) {
          const altOrigin = getAlternateApiUrl(requestUrl);
          if (altOrigin) {
            try {
              const parsed = new URL(requestUrl, getApiBaseUrl());
              const altUrl = `${altOrigin}${parsed.pathname}${parsed.search}`;
              const altInput =
                typeof input === "string" ? altUrl : new Request(altUrl, init);
              const retryRes = await originalFetch(altInput, {
                ...init,
                headers,
              });
              if (retryRes) {
                setApiBaseUrl(altOrigin);
                return retryRes;
              }
            } catch {
              // Both ports unreachable
            }
          }
          console.error(
            `[ApiAuthProvider] Network error contacting backend at ${requestUrl}. Check if FastAPI is running on ${getApiBaseUrl()}`
          );
          throw new Error(
            `Unable to connect to backend at ${requestUrl}. Please verify the FastAPI backend is running.`
          );
        }
        throw err;
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return null;
}
