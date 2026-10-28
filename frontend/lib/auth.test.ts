import { afterEach, describe, expect, it, vi } from "vitest";

import { clearToken, getToken, safeNextPath, setToken, subscribeToken } from "@/lib/auth";

afterEach(() => clearToken());

describe("token store", () => {
  it("persists the token in sessionStorage and clears it", () => {
    setToken("abc");
    expect(getToken()).toBe("abc");
    expect(window.sessionStorage.getItem("talentlens.session")).toBe("abc");
    clearToken();
    expect(getToken()).toBeNull();
    expect(window.sessionStorage.getItem("talentlens.session")).toBeNull();
  });

  it("notifies subscribers until they unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeToken(listener);
    setToken("one");
    clearToken();
    unsubscribe();
    setToken("two");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("keeps working in memory when storage is blocked", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    setToken("memory-only");
    expect(getToken()).toBe("memory-only");
  });

  it("restores a token saved by an earlier page load", async () => {
    window.sessionStorage.setItem("talentlens.session", "from-before");
    vi.resetModules();
    const fresh = await import("@/lib/auth");
    expect(fresh.getToken()).toBe("from-before");
  });

  it("treats unreadable storage as signed out", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.resetModules();
    const fresh = await import("@/lib/auth");
    expect(fresh.getToken()).toBeNull();
  });
});

describe("safeNextPath", () => {
  it.each([
    ["/screenings/abc?tab=upload", "/screenings/abc?tab=upload"],
    ["/history", "/history"],
    [null, "/"],
    [undefined, "/"],
    ["", "/"],
    ["https://evil.example", "/"],
    ["//evil.example/path", "/"],
    ["/\\evil.example", "/"],
    ["/login?next=/history", "/"],
    ["javascript:alert(1)", "/"],
  ])("%s → %s", (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });
});
