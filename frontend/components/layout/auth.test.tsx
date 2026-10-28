import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthGate, AuthProvider, useAuth } from "@/components/layout/auth";
import { ApiError, api } from "@/lib/api";
import { clearToken, getToken, setToken } from "@/lib/auth";
import type { User } from "@/types/api";

const navigation = vi.hoisted(() => ({ pathname: "/", replace: vi.fn() }));
vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace, push: vi.fn() }),
}));

const USER: User = {
  id: "u1",
  email: "rec@example.com",
  display_name: null,
  role: "recruiter",
  is_active: true,
  created_at: "2026-10-01T00:00:00Z",
  last_login_at: null,
};

function Probe() {
  const { status, user } = useAuth();
  return <p data-testid="probe">{`${status}:${user?.email ?? "-"}`}</p>;
}

function renderApp(path = "/") {
  navigation.pathname = path.split("?")[0];
  window.history.replaceState(null, "", path);
  return render(
    <AuthProvider>
      <Probe />
      <AuthGate>
        <p>protected content</p>
      </AuthGate>
    </AuthProvider>,
  );
}

beforeEach(() => navigation.replace.mockReset());
afterEach(() => clearToken());

describe("AuthGate", () => {
  it("sends anonymous visitors to sign in, remembering where they were going", async () => {
    renderApp("/screenings/abc?tab=upload");
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login?next=%2Fscreenings%2Fabc%3Ftab%3Dupload"));
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });

  it("uses a plain /login redirect from the home page", async () => {
    renderApp("/");
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login"));
  });

  it("renders the app once the stored token is verified", async () => {
    setToken("good");
    const me = vi.spyOn(api, "me").mockResolvedValue(USER);
    renderApp("/history");
    expect(await screen.findByText("protected content")).toBeInTheDocument();
    expect(screen.getByTestId("probe")).toHaveTextContent("authenticated:rec@example.com");
    expect(me).toHaveBeenCalledOnce();
    expect(navigation.replace).not.toHaveBeenCalled();
  });

  it("treats a rejected token as signed out", async () => {
    setToken("revoked");
    vi.spyOn(api, "me").mockImplementation(async () => {
      clearToken(); // what the API client does on a 401
      throw new ApiError("Sign in to continue.", 401, "not_authenticated");
    });
    renderApp("/history");
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/login?next=%2Fhistory"));
  });

  it("offers a retry when the backend is unreachable, keeping the token", async () => {
    setToken("good");
    const me = vi
      .spyOn(api, "me")
      .mockRejectedValueOnce(new ApiError("Can't reach the TalentLens API.", 0, "network_error"))
      .mockResolvedValueOnce(USER);
    renderApp("/history");
    expect(await screen.findByText("Can't reach TalentLens")).toBeInTheDocument();
    expect(getToken()).toBe("good");
    await act(async () => screen.getByRole("button", { name: /Try again/ }).click());
    expect(await screen.findByText("protected content")).toBeInTheDocument();
    expect(me).toHaveBeenCalledTimes(2);
  });

  it("shows the sign-in page to anonymous visitors and redirects after sign-in", async () => {
    vi.spyOn(api, "login").mockResolvedValue({ token: "new", token_type: "bearer", expires_at: "", user: USER });
    window.history.replaceState(null, "", "/login?next=%2Fhistory");
    navigation.pathname = "/login";
    function SignInButton() {
      const { signIn } = useAuth();
      return <button onClick={() => void signIn("rec@example.com", "pw")}>sign in</button>;
    }
    render(
      <AuthProvider>
        <SignInButton />
        <AuthGate>
          <p>login form</p>
        </AuthGate>
      </AuthProvider>,
    );
    expect(await screen.findByText("login form")).toBeInTheDocument();
    await act(async () => screen.getByRole("button", { name: "sign in" }).click());
    await waitFor(() => expect(getToken()).toBe("new"));
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/history"));
  });

  it("ignores unsafe redirect targets after sign-in", async () => {
    setToken("good");
    vi.spyOn(api, "me").mockResolvedValue(USER);
    window.history.replaceState(null, "", "/login?next=%2F%2Fevil.example");
    navigation.pathname = "/login";
    render(
      <AuthProvider>
        <AuthGate>
          <p>login form</p>
        </AuthGate>
      </AuthProvider>,
    );
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/"));
  });

  it("signs out even if the server call fails", async () => {
    setToken("good");
    vi.spyOn(api, "me").mockResolvedValue(USER);
    vi.spyOn(api, "logout").mockRejectedValue(new ApiError("offline", 0, "network_error"));
    function SignOutButton() {
      const { signOut } = useAuth();
      return <button onClick={() => void signOut()}>sign out</button>;
    }
    navigation.pathname = "/history";
    render(
      <AuthProvider>
        <SignOutButton />
        <AuthGate>
          <p>protected content</p>
        </AuthGate>
      </AuthProvider>,
    );
    await screen.findByText("protected content");
    await act(async () => screen.getByRole("button", { name: "sign out" }).click());
    await waitFor(() => expect(getToken()).toBeNull());
    expect(screen.queryByText("protected content")).not.toBeInTheDocument();
  });
});
