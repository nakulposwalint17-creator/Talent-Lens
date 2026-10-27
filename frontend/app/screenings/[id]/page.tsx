import type { Metadata } from "next";
import { Suspense } from "react";

import { Skeleton } from "@/components/ui/primitives";
import { WorkspaceView } from "@/features/workspace/workspace-view";

export const metadata: Metadata = { title: "Screening" };

export default function ScreeningPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 rounded-xl" />}>
      <WorkspaceView />
    </Suspense>
  );
}
