import type { Metadata } from "next";

import { SettingsView } from "@/features/settings/settings-view";

export const metadata: Metadata = { title: "Methodology" };

export default function SettingsPage() {
  return <SettingsView />;
}
