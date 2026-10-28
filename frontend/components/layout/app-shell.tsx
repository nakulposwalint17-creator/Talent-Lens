"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { BookOpenText, History, LayoutGrid, LogOut, Menu, ScanSearch, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { LOGIN_PATH, useAuth } from "@/components/layout/auth";
import { useBackendStatus } from "@/components/layout/backend-status";
import { BrandMark } from "@/components/layout/brand";
import { useCommandMenu } from "@/components/layout/command-menu";
import { useActiveScreening } from "@/components/layout/screening-context";
import { ThemeSwitch } from "@/components/layout/theme";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

const NAV = [
  { href: "/", label: "Overview", icon: LayoutGrid, match: (p: string) => p === "/" },
  { href: "/screenings/new", label: "Screen candidates", icon: ScanSearch, match: (p: string) => p === "/screenings/new" },
  { href: "/history", label: "Screening history", icon: History, match: (p: string) => p.startsWith("/history") },
  { href: "/settings", label: "Methodology", icon: BookOpenText, match: (p: string) => p.startsWith("/settings") },
];

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Main" className="flex flex-col gap-px">
      {NAV.map(({ href, label, icon: Icon, match }) => {
        const active = match(pathname);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNavigate}
            aria-current={active ? "page" : undefined}
            className={cn(
              "group relative flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[13.5px] font-medium text-ink-soft transition-colors duration-150 hover:bg-surface-muted hover:text-ink",
              "before:absolute before:inset-y-2 before:-left-3 before:w-[3px] before:rounded-r-full before:bg-accent before:transition-transform before:duration-200 before:ease-[var(--ease-out)]",
              active ? "bg-surface text-ink shadow-[var(--shadow-card)] ring-1 ring-line before:scale-y-100" : "before:scale-y-0",
            )}
          >
            <Icon className={cn("size-4 text-subtle transition-colors group-hover:text-muted", active && "text-accent group-hover:text-accent")} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

function CurrentScreening({ onNavigate }: { onNavigate?: () => void }) {
  const { active } = useActiveScreening();
  const pathname = usePathname();
  if (!active) return null;
  const here = pathname === `/screenings/${active.id}`;
  return (
    <div className="mt-6">
      <p className="type-eyebrow px-2.5 text-[10.5px]">{here ? "Current screening" : "Recently opened"}</p>
      <Link
        href={`/screenings/${active.id}`}
        onClick={onNavigate}
        aria-current={here ? "page" : undefined}
        className={cn(
          "mt-2 block rounded-md px-2.5 py-2 transition-colors hover:bg-surface-muted",
          here && "bg-surface shadow-[var(--shadow-card)] ring-1 ring-line",
        )}
      >
        <span className="block truncate text-[13px] font-medium text-ink">{active.title}</span>
        <span className="tabular mt-0.5 block text-xs text-muted">
          {active.ranked} ranked · {active.total} resume{active.total === 1 ? "" : "s"}
        </span>
      </Link>
    </div>
  );
}

function Account() {
  const { user, signOut } = useAuth();
  const router = useRouter();
  if (!user) return null;
  return (
    <div className="mb-2 flex items-center gap-2 rounded-md px-2.5 py-1.5" data-testid="account">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{user.display_name || user.email}</span>
        <span className="block truncate text-xs text-muted">
          {user.role === "admin" ? "Administrator" : "Recruiter"}
          {user.display_name ? ` · ${user.email}` : ""}
        </span>
      </span>
      <Tooltip side="right" content="Sign out">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Sign out"
          onClick={async () => {
            await signOut();
            router.replace(LOGIN_PATH);
          }}
        >
          <LogOut />
        </Button>
      </Tooltip>
    </div>
  );
}

function SidebarFooter() {
  const { health, status, recheck } = useBackendStatus();
  const live = health?.provider.mode === "live";
  return (
    <div className="space-y-1.5 border-t border-line pt-3">
      <Account />
      <ThemeSwitch className="mb-2" />
      <Tooltip
        side="right"
        content={
          status === "offline"
            ? "The backend is not reachable."
            : live
              ? `Live AI evaluation via the Anthropic API (${health?.provider.model}).`
              : "Rule-based demo evaluation. No AI model is called; results come from transparent rules over the real resume text."
        }
      >
        <div tabIndex={0} className="flex items-center gap-2 rounded-md px-2.5 py-1.5" data-testid="mode-label">
          <span
            className={cn(
              "rounded px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.08em]",
              status === "offline"
                ? "bg-surface-sunken text-muted"
                : live
                  ? "bg-accent-soft text-accent-strong"
                  : "bg-warning-soft text-warning-ink",
            )}
          >
            {status === "offline" ? "Offline" : live ? "Live AI mode" : "Demo mode"}
          </span>
          <span className="truncate text-xs text-muted">{live ? health?.provider.model : status === "offline" ? "" : "Rule-based"}</span>
        </div>
      </Tooltip>
      <button
        type="button"
        onClick={recheck}
        className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-xs text-muted transition-colors hover:bg-surface-muted"
        title={status === "offline" ? "Retry connection" : undefined}
      >
        <span
          aria-hidden
          className={cn(
            "size-1.5 rounded-full",
            status === "online" ? "bg-success" : status === "offline" ? "bg-danger" : "bg-subtle",
          )}
        />
        {status === "online" ? `API connected · v${health?.version}` : status === "offline" ? "API unreachable — retry" : "Checking API…"}
      </button>
    </div>
  );
}

function SearchButton({ onNavigate }: { onNavigate?: () => void }) {
  const { open } = useCommandMenu();
  return (
    <button
      type="button"
      onClick={() => {
        onNavigate?.();
        open();
      }}
      className="mb-4 flex h-9 w-full items-center gap-2.5 rounded-md border border-line bg-surface px-2.5 text-[13px] text-muted shadow-[var(--shadow-card)] transition-[border-color,color] duration-150 hover:border-line-strong hover:text-ink"
    >
      <Search className="size-4 text-subtle" aria-hidden />
      <span className="flex-1 text-left">Search…</span>
      <kbd className="rounded border border-line bg-surface-muted px-1.5 font-sans text-[10.5px] font-medium text-muted">⌘K</kbd>
    </button>
  );
}

function SidebarContent({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <SearchButton onNavigate={onNavigate} />
      <NavLinks onNavigate={onNavigate} />
      <CurrentScreening onNavigate={onNavigate} />
      <div className="mt-auto">
        <SidebarFooter />
      </div>
    </>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  // The sign-in page is shown without navigation.
  if (pathname === LOGIN_PATH) return <main id="main">{children}</main>;
  return (
    <div className="relative min-h-dvh lg:pl-[232px]">
      <div aria-hidden className="ambient pointer-events-none absolute inset-x-0 top-0 h-[560px] lg:left-[232px]" />
      <a
        href="#main"
        className="sr-only z-[var(--z-toast)] rounded-md bg-surface px-3 py-2 text-sm font-medium focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
      >
        Skip to content
      </a>
      <aside className="fixed inset-y-0 left-0 z-[var(--z-nav)] hidden w-[232px] flex-col border-r border-line bg-sidebar px-3 pb-3 pt-5 lg:flex">
        <Link href="/" className="mb-7 rounded-md px-2" aria-label="TalentLens overview">
          <BrandMark />
        </Link>
        <SidebarContent />
      </aside>

      <header className="sticky top-0 z-[var(--z-nav)] flex h-14 items-center justify-between border-b border-line bg-glass px-4 backdrop-blur-md lg:hidden">
        <Link href="/" aria-label="TalentLens overview">
          <BrandMark compact />
        </Link>
        <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
          <DialogPrimitive.Trigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <Menu />
            </Button>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-[var(--z-overlay)] bg-scrim data-[state=open]:animate-fade-in" />
            <DialogPrimitive.Content className="fixed inset-y-0 left-0 z-[var(--z-overlay)] flex w-[272px] max-w-[85vw] flex-col bg-sidebar px-3 pb-3 pt-4 shadow-[var(--shadow-overlay)] data-[state=open]:animate-slide-in-left focus:outline-none">
              <DialogPrimitive.Title className="sr-only">Navigation</DialogPrimitive.Title>
              <DialogPrimitive.Description className="sr-only">Main navigation</DialogPrimitive.Description>
              <div className="mb-6 flex items-center justify-between px-2">
                <BrandMark />
                <DialogPrimitive.Close asChild>
                  <Button variant="ghost" size="icon-sm" aria-label="Close navigation">
                    <X />
                  </Button>
                </DialogPrimitive.Close>
              </div>
              <SidebarContent onNavigate={() => setOpen(false)} />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </header>

      <main id="main" className="relative mx-auto w-full max-w-[var(--container)] px-4 pb-20 pt-6 sm:px-6 lg:px-10 lg:pt-10">
        {children}
      </main>
    </div>
  );
}
