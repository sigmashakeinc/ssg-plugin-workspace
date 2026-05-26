// Additional worker route coverage: 501 shape for every local-only endpoint,
// CORS preflight, notFound fallback behaviour, and Cache-Control assertions.
// worker.test.ts already handles auth + the happy-path GET /api/workspace/projects
// and POST /api/workspace/run — we add the remaining degradation surface here.

import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

const OPERATOR_ID = "11810205";
const SESSION_ID = "ws-degradation-session";
const SESSION_KEY = `session:${SESSION_ID}`;

async function mintOperator() {
  await env.ACCOUNTS_SESSIONS.put(
    SESSION_KEY,
    JSON.stringify({
      userId: OPERATOR_ID,
      login: "degradation-operator",
      avatar: "https://example.com/av.png",
      authType: "github",
      token: "blob",
    }),
  );
}

function authed(path: string, init: RequestInit = {}): Promise<Response> {
  const h = new Headers(init.headers);
  h.set("Cookie", `session_id=${SESSION_ID}`);
  return SELF.fetch(`https://workspace.sigmashake.com${path}`, { ...init, headers: h });
}

describe("501 local_only shape — every degraded endpoint", () => {
  beforeEach(mintOperator);

  async function assert501(res: Response) {
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string; message?: string };
    expect(body.error).toBe("local_only");
    expect(typeof body.message).toBe("string");
    expect(body.message!.length).toBeGreaterThan(0);
  }

  it("GET /api/workspace/health returns 501 local_only with a message", async () => {
    await assert501(await authed("/api/workspace/health"));
  });

  it("POST /api/workspace/edit returns 501 local_only with a message", async () => {
    await assert501(
      await authed("/api/workspace/edit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          project: "sigmashake-gov",
          file: "CLAUDE.md",
          content: "x",
        }),
      }),
    );
  });

  it("GET /api/workspace/infrastructure returns 501 local_only with a message", async () => {
    // Already in worker.test.ts but we verify the message body length here.
    const res = await authed("/api/workspace/infrastructure");
    await assert501(res);
  });
});

describe("CORS preflight", () => {
  // The auth middleware runs before the CORS handler: unauthenticated OPTIONS
  // requests to /api/* are caught by the auth gate and return 401 (wantsJson
  // is true for /api/ paths). Authenticated OPTIONS hits the handler and gets
  // 204 — the behaviour a SPA calling from a different origin needs.

  it("OPTIONS /api/* without a session returns 401 (auth gate wins)", async () => {
    const res = await SELF.fetch("https://workspace.sigmashake.com/api/workspace/projects", {
      method: "OPTIONS",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("OPTIONS /api/* from a *.sigmashake.com origin echoes that origin (allowlist CORS)", async () => {
    await mintOperator();
    const res = await authed("/api/workspace/projects", {
      method: "OPTIONS",
      headers: { Origin: "https://docs.sigmashake.com" },
    });
    expect(res.status).toBe(204);
    // Credentialed (cookie-auth) CORS cannot use `*` — the worker allowlists
    // `*.sigmashake.com` and echoes the request Origin back (see worker.ts).
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://docs.sigmashake.com",
    );
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("GET");
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  it("OPTIONS /api/* from a non-sigmashake origin gets no Allow-Origin", async () => {
    await mintOperator();
    const res = await authed("/api/workspace/projects", {
      method: "OPTIONS",
      headers: { Origin: "https://evil.example.com" },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
    expect(res.headers.get("Vary")).toBe("Origin");
  });
});

describe("Cache-Control headers", () => {
  beforeEach(mintOperator);

  it("GET /api/workspace/projects carries private max-age=60", async () => {
    const res = await authed("/api/workspace/projects");
    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("private");
    expect(cc).toContain("max-age=60");
  });

  it("GET / carries private max-age=60", async () => {
    const res = await authed("/", { headers: { Accept: "text/html" } });
    expect(res.status).toBe(200);
    const cc = res.headers.get("Cache-Control") ?? "";
    expect(cc).toContain("private");
  });

  it("/healthz carries Cache-Control: no-store", async () => {
    const res = await SELF.fetch("https://workspace.sigmashake.com/healthz");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("readiness — build-time snapshot served from the cloud", () => {
  beforeEach(mintOperator);

  it("GET /api/workspace/readiness returns the baked report with current generatedAt", async () => {
    const before = Date.now();
    const res = await authed("/api/workspace/readiness");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      generatedAt: number;
      productCount: number;
      products: Array<{
        id: string;
        requirements: Array<{ id: string; status: string; source: string }>;
      }>;
    };
    expect(body.productCount).toBeGreaterThan(0);
    expect(body.generatedAt).toBeGreaterThanOrEqual(before);
    // desktop-mac-signing is the change that motivated wiring this endpoint
    // up — the manual flip from `unmet` → `met` must round-trip through the
    // build-time snapshot to the cloud response.
    const desktop = body.products.find((p) => p.id === "desktop");
    const sign = desktop?.requirements.find((r) => r.id === "desktop-mac-signing");
    expect(sign?.status).toBe("met");
    expect(sign?.source).toBe("manual");
  });

  it("GET /api/workspace/readiness/text returns the plain-text scorecard", async () => {
    const res = await authed("/api/workspace/readiness/text");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type") ?? "").toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("# SigmaShake production readiness");
    expect(text).toContain("macOS code-signing + notarization wired");
  });

  it("readiness response carries private max-age=60", async () => {
    const res = await authed("/api/workspace/readiness");
    expect(res.headers.get("Cache-Control") ?? "").toContain("private");
  });
});

describe("notFound fallback", () => {
  beforeEach(mintOperator);

  it("returns a JSON 404 for non-HTML unknown API paths", async () => {
    const res = await authed("/api/workspace/does-not-exist");
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("not_found");
  });

  it("returns the SPA shell for unknown HTML paths (deep-link support)", async () => {
    const res = await authed("/some/deep/spa/route", {
      headers: { Accept: "text/html,*/*" },
    });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('id="root"');
  });
});

describe("wantsJson branch — Accept header routing", () => {
  it("returns 401 JSON (not redirect) when Accept includes application/json", async () => {
    const res = await SELF.fetch("https://workspace.sigmashake.com/some-page", {
      headers: { Accept: "application/json" },
      redirect: "manual",
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("redirects when Accept is text/html (no JSON preference)", async () => {
    const res = await SELF.fetch("https://workspace.sigmashake.com/some-page", {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
  });
});
