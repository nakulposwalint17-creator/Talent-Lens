/**
 * Holds the bearer token for the signed-in user.
 *
 * The token lives in sessionStorage: it survives reloads but not closing the tab,
 * and it is never sent automatically by the browser (unlike a cookie), so
 * cross-site requests can't act on the user's behalf. Storage may be unavailable
 * (private mode, blocked site data); the in-memory copy keeps the tab working.
 */

const KEY = "talentlens.session";

let memory: string | null = null;
let loaded = false;
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (!loaded) {
    loaded = true;
    try {
      memory = storage()?.getItem(KEY) ?? null;
    } catch {
      memory = null;
    }
  }
  return memory;
}

export function setToken(token: string | null) {
  memory = token;
  loaded = true;
  try {
    if (token) storage()?.setItem(KEY, token);
    else storage()?.removeItem(KEY);
  } catch {
    // Storage blocked: keep the in-memory copy only.
  }
  listeners.forEach((listener) => listener());
}

export function clearToken() {
  setToken(null);
}

export function subscribeToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Only same-app relative paths are followed after sign-in (prevents open redirects). */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || next.startsWith("/login")) {
    return "/";
  }
  return next;
}
