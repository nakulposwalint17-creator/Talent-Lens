import type { Metadata } from "next";

import { JobSetupView } from "@/features/job-setup/job-setup-view";

export const metadata: Metadata = { title: "New screening" };

export default function NewScreeningPage() {
  return <JobSetupView />;
}
