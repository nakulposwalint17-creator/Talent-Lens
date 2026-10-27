"use client";

import { createContext, useContext } from "react";

interface CandidateActions {
  /** Refresh the open candidate and the surrounding workspace. */
  refresh: () => Promise<unknown>;
  openCandidate: (id: string) => void;
}

export const CandidateActionsContext = createContext<CandidateActions>({
  refresh: async () => undefined,
  openCandidate: () => undefined,
});

export function useCandidateActions() {
  return useContext(CandidateActionsContext);
}
