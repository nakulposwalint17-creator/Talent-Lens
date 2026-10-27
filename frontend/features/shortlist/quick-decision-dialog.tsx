"use client";

import { DialogContent, Dialog } from "@/components/ui/overlays";
import { CandidateActionsContext } from "@/features/candidate/context";
import { DecisionForm } from "@/features/candidate/decision-form";
import { candidateLabel } from "@/lib/format";
import type { CandidateSummary } from "@/types/api";

/** Record a decision without opening the full evidence drawer. Same rules and API as the drawer. */
export function QuickDecisionDialog({
  candidate,
  onClose,
  onRecorded,
  onOpenEvidence,
}: {
  candidate: CandidateSummary | null;
  onClose: () => void;
  onRecorded: () => Promise<unknown>;
  onOpenEvidence: (id: string) => void;
}) {
  return (
    <Dialog open={!!candidate} onOpenChange={(open) => !open && onClose()}>
      {candidate && (
        <DialogContent
          title={`Decision for ${candidateLabel(candidate)}`}
          description="Recorded separately from the original assessment, which is never changed."
          className="max-w-xl"
        >
          <CandidateActionsContext.Provider value={{ refresh: onRecorded, openCandidate: onOpenEvidence }}>
            <div className="px-5 py-5">
              <DecisionForm candidate={candidate} onRecorded={onClose} />
              <button
                type="button"
                className="mt-1 text-[13px] font-medium text-accent hover:underline"
                onClick={() => {
                  onClose();
                  onOpenEvidence(candidate.id);
                }}
              >
                Review the evidence first
              </button>
            </div>
          </CandidateActionsContext.Provider>
        </DialogContent>
      )}
    </Dialog>
  );
}
