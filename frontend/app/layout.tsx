import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";

import { AppShell } from "@/components/layout/app-shell";
import { BackendStatusProvider } from "@/components/layout/backend-status";
import { CommandMenuProvider } from "@/components/layout/command-menu";
import { ActiveScreeningProvider } from "@/components/layout/screening-context";
import { THEME_SCRIPT, ThemedToaster } from "@/components/layout/theme";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const displaySerif = Instrument_Serif({ variable: "--font-display-serif", subsets: ["latin"], weight: "400" });

export const metadata: Metadata = {
  title: { default: "TalentLens — AI Recruitment Intelligence", template: "%s · TalentLens" },
  description: "See the evidence. Find the right fit. Turn a job description and a batch of resumes into a shortlist you can explain.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f7f4" },
    { media: "(prefers-color-scheme: dark)", color: "#0f1117" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme is set before paint by THEME_SCRIPT, so the server markup differs on purpose.
    <html lang="en" suppressHydrationWarning className={`${geistSans.variable} ${geistMono.variable} ${displaySerif.variable} antialiased`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <TooltipProvider delayDuration={150}>
          <BackendStatusProvider>
            <ActiveScreeningProvider>
              <CommandMenuProvider>
                <AppShell>{children}</AppShell>
              </CommandMenuProvider>
            </ActiveScreeningProvider>
          </BackendStatusProvider>
        </TooltipProvider>
        <ThemedToaster />
      </body>
    </html>
  );
}
