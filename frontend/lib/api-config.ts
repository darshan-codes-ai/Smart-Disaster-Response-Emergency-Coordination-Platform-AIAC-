/**
 * RescueGrid API Configuration & Port Resilience
 *
 * Centralizes the FastAPI backend URL resolution, normalization,
 * and automatic port fallback between 8010 (preferred) and 8000 (legacy/default).
 */

export const DEFAULT_API_PORT = 8010;
export const FALLBACK_API_PORT = 8000;

function resolveConfiguredUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_API_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/+$/, "");
  }
  return `http://localhost:${DEFAULT_API_PORT}`;
}

let activeApiUrl: string = resolveConfiguredUrl();

/**
 * Returns the currently active backend API base URL (no trailing slash).
 */
export function getApiBaseUrl(): string {
  return activeApiUrl;
}

/**
 * Updates the active API base URL (e.g. after a successful fallback retry).
 */
export function setApiBaseUrl(newUrl: string): void {
  activeApiUrl = newUrl.trim().replace(/\/+$/, "");
}

/**
 * Returns an alternate local origin to try if connecting to the primary port fails.
 * If current is port 8010 -> returns port 8000.
 * If current is port 8000 -> returns port 8010.
 * Returns null if the URL is not a local host.
 */
export function getAlternateApiUrl(currentUrl: string): string | null {
  try {
    const url = new URL(currentUrl, activeApiUrl);
    const host = url.hostname.toLowerCase();
    if (host === "localhost" || host === "127.0.0.1") {
      const port = url.port || (url.protocol === "https:" ? "443" : "80");
      if (port === String(DEFAULT_API_PORT)) {
        return `${url.protocol}//${url.hostname}:${FALLBACK_API_PORT}`;
      } else if (port === String(FALLBACK_API_PORT)) {
        return `${url.protocol}//${url.hostname}:${DEFAULT_API_PORT}`;
      }
    }
  } catch {
    // Ignore invalid URLs
  }
  return null;
}

/**
 * Determines whether a given request URL targets the RescueGrid FastAPI backend.
 */
export function isBackendApiUrl(requestUrl: string): boolean {
  if (!requestUrl) return false;

  // Relative API paths
  if (
    requestUrl.startsWith("/") &&
    !requestUrl.startsWith("/_next") &&
    !requestUrl.startsWith("/api/") &&
    !requestUrl.startsWith("/favicon")
  ) {
    return true;
  }

  const clean = requestUrl.toLowerCase();
  const currentBase = activeApiUrl.toLowerCase();

  return (
    clean.startsWith(currentBase) ||
    clean.includes("localhost:8010") ||
    clean.includes("127.0.0.1:8010") ||
    clean.includes("localhost:8000") ||
    clean.includes("127.0.0.1:8000")
  );
}

export const API_BASE_URL = activeApiUrl;
