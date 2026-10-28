import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { API_BASE_URL, ApiError, api, downloadExport, errorMessage, filenameFromDisposition, uploadResume } from "@/lib/api";
import { clearToken, getToken, setToken } from "@/lib/auth";

const fetchMock = vi.fn<typeof fetch>();

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function sentHeaders(call = 0): Record<string, string> {
  return (fetchMock.mock.calls[call][1]?.headers ?? {}) as Record<string, string>;
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearToken();
});

describe("request authentication", () => {
  it("sends the bearer token when signed in", async () => {
    setToken("tok-123");
    fetchMock.mockResolvedValue(jsonResponse(200, []));
    await api.listSessions();
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/sessions`);
    expect(sentHeaders().Authorization).toBe("Bearer tok-123");
    expect(fetchMock.mock.calls[0][1]?.cache).toBe("no-store");
  });

  it("sends no Authorization header when signed out", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { status: "ok" }));
    await api.health();
    expect(sentHeaders().Authorization).toBeUndefined();
  });

  it("signs out when the server rejects the token", async () => {
    setToken("expired");
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { code: "not_authenticated", message: "Sign in to continue." } }));
    await expect(api.listSessions()).rejects.toMatchObject({ status: 401, code: "not_authenticated" });
    expect(getToken()).toBeNull();
  });

  it("does not clear an existing session when a sign-in attempt fails", async () => {
    setToken("still-valid");
    fetchMock.mockResolvedValue(jsonResponse(401, { error: { code: "invalid_credentials", message: "Nope." } }));
    await expect(api.login("a@example.com", "bad")).rejects.toBeInstanceOf(ApiError);
    expect(getToken()).toBe("still-valid");
  });

  it("posts credentials as JSON", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { token: "t", user: { email: "a@example.com" } }));
    await api.login("a@example.com", "pw");
    const [, init] = fetchMock.mock.calls[0];
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ email: "a@example.com", password: "pw" });
    expect(sentHeaders()["Content-Type"]).toBe("application/json");
  });
});

describe("responses and errors", () => {
  it("parses the API error envelope", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(429, { error: { code: "rate_limited", message: "Slow down.", details: { retry_after: "30" } } }),
    );
    const error = await api.dashboard().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 429, code: "rate_limited", message: "Slow down.", details: { retry_after: "30" } });
  });

  it("falls back to a generic message for non-JSON errors", async () => {
    fetchMock.mockResolvedValue(new Response("<html>bad gateway</html>", { status: 502 }));
    await expect(api.config()).rejects.toMatchObject({ status: 502, code: "http_error", message: "Request failed (502)." });
  });

  it("reports network failures as status 0", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    const error = (await api.health().catch((e: unknown) => e)) as ApiError;
    expect(error.isNetworkError).toBe(true);
    expect(error.message).toMatch(/Can't reach the TalentLens API/);
  });

  it("returns undefined for 204 responses", async () => {
    setToken("tok");
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.logout()).resolves.toBeUndefined();
    await expect(api.deleteSession("abc")).resolves.toBeUndefined();
  });

  it("encodes path parameters", async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, {}));
    await api.getCandidate("a/b?c");
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/candidates/a%2Fb%3Fc`);
  });

  it("errorMessage handles every kind of thrown value", () => {
    expect(errorMessage(new ApiError("api", 400, "x"))).toBe("api");
    expect(errorMessage(new Error("plain"))).toBe("plain");
    expect(errorMessage("weird")).toBe("Something went wrong.");
  });
});

describe("CSV export", () => {
  it.each([
    ['attachment; filename="talentlens-dev-20261028.csv"', "talentlens-dev-20261028.csv"],
    ["attachment; filename=plain.csv", "plain.csv"],
    ['attachment; filename="../../etc/passwd"', "..-..-etc-passwd"],
    [null, "fallback.csv"],
    ["inline", "fallback.csv"],
  ])("filename from %s", (header, expected) => {
    expect(filenameFromDisposition(header, "fallback.csv")).toBe(expected);
  });

  it("downloads with the bearer token and the server's filename", async () => {
    setToken("tok");
    fetchMock.mockResolvedValue(
      new Response("a,b\n", { status: 200, headers: { "Content-Disposition": 'attachment; filename="report.csv"' } }),
    );
    const createObjectURL = vi.fn(() => "blob:fake");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
    vi.useFakeTimers();

    await expect(downloadExport("s1", "ranked")).resolves.toBe("report.csv");
    expect(fetchMock.mock.calls[0][0]).toBe(`${API_BASE_URL}/api/sessions/s1/export.csv?filter=ranked`);
    expect(sentHeaders().Authorization).toBe("Bearer tok");
    expect(click).toHaveBeenCalledOnce();
    vi.runAllTimers();
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:fake");
    vi.useRealTimers();
  });

  it("surfaces export errors", async () => {
    fetchMock.mockResolvedValue(jsonResponse(404, { error: { code: "not_found", message: "Screening session not found." } }));
    await expect(downloadExport("missing")).rejects.toMatchObject({ status: 404 });
  });
});

class FakeXhr {
  static last: FakeXhr;
  headers: Record<string, string> = {};
  upload: { onprogress?: (e: { lengthComputable: boolean; loaded: number; total: number }) => void } = {};
  status = 0;
  response: unknown = null;
  responseType = "";
  url = "";
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  sent?: FormData;
  constructor() {
    FakeXhr.last = this;
  }
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  send(body: FormData) {
    this.sent = body;
  }
  abort() {
    this.onabort?.();
  }
}

describe("uploadResume", () => {
  beforeEach(() => vi.stubGlobal("XMLHttpRequest", FakeXhr));

  it("uploads with the bearer token and reports progress", async () => {
    setToken("tok");
    const progress = vi.fn();
    const promise = uploadResume("s1", new File(["x"], "cv.pdf"), progress);
    const xhr = FakeXhr.last;
    expect(xhr.url).toBe(`${API_BASE_URL}/api/sessions/s1/resumes`);
    expect(xhr.headers.Authorization).toBe("Bearer tok");
    expect(xhr.sent?.get("files")).toBeInstanceOf(File);
    xhr.upload.onprogress?.({ lengthComputable: true, loaded: 50, total: 100 });
    xhr.status = 201;
    xhr.response = { results: [], accepted: 1, failed: 0 };
    xhr.onload?.();
    await expect(promise).resolves.toMatchObject({ accepted: 1 });
    expect(progress).toHaveBeenNthCalledWith(1, 0.5);
    expect(progress).toHaveBeenLastCalledWith(1);
  });

  it("signs out when an upload is rejected as unauthenticated", async () => {
    setToken("expired");
    const promise = uploadResume("s1", new File(["x"], "cv.pdf"), () => undefined);
    const xhr = FakeXhr.last;
    xhr.status = 401;
    xhr.response = { error: { code: "not_authenticated", message: "Sign in to continue." } };
    xhr.onload?.();
    await expect(promise).rejects.toMatchObject({ status: 401, message: "Sign in to continue." });
    expect(getToken()).toBeNull();
  });

  it("reports network errors and cancellation", async () => {
    const failed = uploadResume("s1", new File(["x"], "cv.pdf"), () => undefined);
    FakeXhr.last.onerror?.();
    await expect(failed).rejects.toMatchObject({ code: "network_error" });

    const controller = new AbortController();
    const cancelled = uploadResume("s1", new File(["x"], "cv.pdf"), () => undefined, controller.signal);
    controller.abort();
    await expect(cancelled).rejects.toMatchObject({ code: "aborted" });
  });
});
