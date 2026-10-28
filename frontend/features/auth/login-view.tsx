"use client";

import { LockKeyhole } from "lucide-react";
import { useState } from "react";

import { useAuth } from "@/components/layout/auth";
import { BrandMark } from "@/components/layout/brand";
import { InlineNotice } from "@/components/shared/states";
import { Button } from "@/components/ui/button";
import { FieldError, Input, Label } from "@/components/ui/primitives";
import { ApiError, errorMessage } from "@/lib/api";

function describe(error: unknown): string {
  if (error instanceof ApiError && error.status === 429) {
    const wait = Number((error.details as { retry_after?: string } | undefined)?.retry_after);
    const minutes = Number.isFinite(wait) && wait > 0 ? Math.ceil(wait / 60) : null;
    return minutes
      ? `Too many sign-in attempts. Try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`
      : error.message;
  }
  return errorMessage(error);
}

export function LoginView() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!email.trim() || !password) {
      setError("Enter your email and password.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signIn(email.trim(), password);
      // The auth gate redirects once the session is established.
    } catch (err) {
      setError(describe(err));
      setPassword("");
      setSubmitting(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-12">
      <div className="w-full max-w-[380px]">
        <div className="mb-8 flex justify-center">
          <BrandMark />
        </div>
        <div className="rounded-xl border border-line bg-surface p-6 shadow-[var(--shadow-card)] sm:p-7">
          <h1 className="type-title">Sign in</h1>
          <p className="mt-1 text-sm leading-6 text-muted">Use the account your administrator created for you.</p>
          <form className="mt-6 space-y-4" onSubmit={submit} noValidate aria-describedby={error ? "login-error" : undefined}>
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                autoComplete="username"
                inputMode="email"
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                aria-invalid={Boolean(error) || undefined}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                aria-invalid={Boolean(error) || undefined}
              />
            </div>
            <FieldError id="login-error">{error}</FieldError>
            <Button type="submit" variant="primary" className="w-full" loading={submitting}>
              {!submitting && <LockKeyhole aria-hidden />}
              {submitting ? "Signing in…" : "Sign in"}
            </Button>
          </form>
        </div>
        <InlineNotice tone="neutral" className="mt-4">
          Resumes contain personal data. Access is limited to signed-in recruiters, and each recruiter sees only the
          screenings they created.
        </InlineNotice>
      </div>
    </div>
  );
}
