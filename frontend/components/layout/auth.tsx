"use client";

import { Loader2 } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { ErrorState } from "@/components/shared/states";
import { ApiError, api } from "@/lib/api";
import { clearToken, getToken, safeNextPath, setToken, subscribeToken } from "@/lib/auth";
import type { User } from "@/types/api";

export const LOGIN_PATH = "/login";

export type AuthStatus = "loading" | "authenticated" | "anonymous" | "unreachable";

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** Why the session couldn't be checked, when status is "unreachable". */
  error: unknown;
  signIn: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  retry: () => void;
}

const AuthContext = createContext<AuthContextValue>({
  status: "loading",
  user: null,
  error: null,
  signIn: () => Promise.reject(new Error("AuthProvider is missing")),
  signOut: () => Promise.resolve(),
  retry: () => undefined,
});

const noopSubscribe = () => () => undefined;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  // Server render and hydration see no token; the real one is read once mounted.
  const mounted = useSyncExternalStore(noopSubscribe, () => true, () => false);
  const token = useSyncExternalStore(subscribeToken, getToken, () => null);
  // The verified user is tied to the token it was loaded for, so a changed or
  // cleared token can never show a stale user.
  const [session, setSession] = useState<{ token: string; user: User } | null>(null);
  const [unreachable, setUnreachable] = useState<{ token: string; error: unknown } | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!token || session?.token === token) return;
    let cancelled = false;
    api
      .me()
      .then((user) => {
        if (!cancelled) {
          setUnreachable(null);
          setSession({ token, user });
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        // A rejected token is already cleared by the API client; anything else
        // (backend down) keeps the token so a retry can succeed.
        if (!(error instanceof ApiError && error.status === 401)) setUnreachable({ token, error });
      });
    return () => {
      cancelled = true;
    };
  }, [token, session?.token, attempt]);

  const signIn = useCallback(async (email: string, password: string) => {
    const result = await api.login(email, password);
    setSession({ token: result.token, user: result.user });
    setToken(result.token);
    return result.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // The token is discarded locally either way.
    } finally {
      clearToken();
    }
  }, []);

  const retry = useCallback(() => {
    setUnreachable(null);
    setAttempt((n) => n + 1);
  }, []);

  const authenticated = Boolean(token && session?.token === token);
  const status: AuthStatus = !mounted
    ? "loading"
    : !token
      ? "anonymous"
      : authenticated
        ? "authenticated"
        : unreachable?.token === token
          ? "unreachable"
          : "loading";

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: authenticated ? session!.user : null,
      error: status === "unreachable" ? unreachable?.error : null,
      signIn,
      signOut,
      retry,
    }),
    [status, authenticated, session, unreachable, signIn, signOut, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}

function Splash() {
  return (
    <div className="grid min-h-dvh place-items-center" role="status" aria-live="polite">
      <Loader2 className="size-5 animate-spin text-subtle" aria-hidden />
      <span className="sr-only">Checking your session…</span>
    </div>
  );
}

/**
 * Renders the app only for a signed-in user. Everyone else is sent to the
 * sign-in page, which returns them to where they were afterwards.
 */
export function AuthGate({ children }: { children: React.ReactNode }) {
  const { status, error, retry } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const onLogin = pathname === LOGIN_PATH;

  useEffect(() => {
    if (status === "anonymous" && !onLogin) {
      const here = `${pathname}${window.location.search}`;
      router.replace(here === "/" ? LOGIN_PATH : `${LOGIN_PATH}?next=${encodeURIComponent(here)}`);
    } else if (status === "authenticated" && onLogin) {
      router.replace(safeNextPath(new URLSearchParams(window.location.search).get("next")));
    }
  }, [status, onLogin, pathname, router]);

  if (status === "unreachable") {
    return (
      <div className="mx-auto max-w-lg px-4 pt-24">
        <ErrorState title="Can't reach TalentLens" error={error} onRetry={retry} />
      </div>
    );
  }
  if (onLogin) return status === "authenticated" || status === "loading" ? <Splash /> : <>{children}</>;
  if (status !== "authenticated") return <Splash />;
  return <>{children}</>;
}
