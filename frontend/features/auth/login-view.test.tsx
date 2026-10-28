import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginView } from "@/features/auth/login-view";
import { ApiError } from "@/lib/api";

const signIn = vi.hoisted(() => vi.fn());
vi.mock("@/components/layout/auth", () => ({ useAuth: () => ({ signIn }) }));

async function submit(email: string, password: string) {
  const user = userEvent.setup();
  render(<LoginView />);
  if (email) await user.type(screen.getByLabelText("Email"), email);
  if (password) await user.type(screen.getByLabelText("Password"), password);
  await user.click(screen.getByRole("button", { name: "Sign in" }));
}

describe("LoginView", () => {
  it("asks for both fields before calling the API", async () => {
    signIn.mockReset();
    await submit("rec@example.com", "");
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your email and password.");
    expect(signIn).not.toHaveBeenCalled();
  });

  it("signs in with a trimmed email", async () => {
    signIn.mockReset().mockResolvedValue({});
    await submit("  rec@example.com ", "secret-password");
    expect(signIn).toHaveBeenCalledWith("rec@example.com", "secret-password");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows the server's message and clears the password on failure", async () => {
    signIn.mockReset().mockRejectedValue(new ApiError("The email or password is incorrect.", 401, "invalid_credentials"));
    await submit("rec@example.com", "wrong");
    expect(await screen.findByRole("alert")).toHaveTextContent("The email or password is incorrect.");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
  });

  it("explains a lockout in minutes", async () => {
    signIn.mockReset().mockRejectedValue(new ApiError("Too many.", 429, "rate_limited", { retry_after: "61" }));
    await submit("rec@example.com", "x");
    expect(await screen.findByRole("alert")).toHaveTextContent("Try again in about 2 minutes.");
  });

  it("falls back to the server message when no wait time is given", async () => {
    signIn.mockReset().mockRejectedValue(new ApiError("Too many sign-in attempts.", 429, "rate_limited"));
    await submit("rec@example.com", "x");
    expect(await screen.findByRole("alert")).toHaveTextContent("Too many sign-in attempts.");
  });
});
