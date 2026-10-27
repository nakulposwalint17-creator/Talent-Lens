"use client";

import { createContext, useContext } from "react";

import { useApi } from "@/hooks/use-api";
import { api } from "@/lib/api";
import type { HealthResponse } from "@/types/api";

interface BackendStatus {
  health: HealthResponse | undefined;
  status: "checking" | "online" | "offline";
  recheck: () => void;
}

const BackendStatusContext = createContext<BackendStatus>({
  health: undefined,
  status: "checking",
  recheck: () => undefined,
});

export function BackendStatusProvider({ children }: { children: React.ReactNode }) {
  const { data, error, refresh } = useApi("health", api.health, (result) => (result ? 30_000 : 8_000));
  const status: BackendStatus["status"] = data && !error ? "online" : error ? "offline" : "checking";
  return (
    <BackendStatusContext.Provider value={{ health: data, status, recheck: () => void refresh() }}>
      {children}
    </BackendStatusContext.Provider>
  );
}

export function useBackendStatus() {
  return useContext(BackendStatusContext);
}
