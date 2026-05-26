// Unit tests for the local client (src/client/api/local.ts).
// The local client talks to the SSG daemon over HTTP. We stub global fetch
// per-test so no real daemon is required. Focus areas:
//   - identity properties (runtime, hasLocalCapabilities)
//   - assertJsonResponse guard (non-JSON content-type → intelligible error)
//   - listProjects, getHealth, readFile, writeFile happy and error paths
//   - getSession returns the local stub
//   - getSettings falls back to defaults when the daemon 404s

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createLocalClient } from "../src/client/api/local";
import { DEFAULT_WORKSPACE_SETTINGS } from "../src/client/api/types";

// ── window + location stub (needed by the local client's config() helper) ────
// local.ts reads `location.protocol`, `location.hostname`, and `location.port`
// directly (not via window.location) so we must stub the global too.

class MemoryStorage {
  private store = new Map<string, string>();
  getItem(k: string) {
    return this.store.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.store.set(k, v);
  }
  removeItem(k: string) {
    this.store.delete(k);
  }
  clear() {
    this.store.clear();
  }
}

const realWindow = (globalThis as { window?: unknown }).window;
const realLocation = (globalThis as { location?: unknown }).location;
const mem = new MemoryStorage();

const FAKE_LOCATION = {
  protocol: "http:",
  hostname: "localhost",
  port: "7904",
  href: "http://localhost:7904/",
  origin: "http://localhost:7904",
};

beforeEach(() => {
  (globalThis as { window: unknown }).window = {
    localStorage: mem,
    __WORKSPACE_CONFIG__: { port: 7904, token: "test-tok", runtime: "local" },
  };
  // local.ts references bare `location` (not window.location), so we need to
  // set the global directly.
  (globalThis as { location: unknown }).location = FAKE_LOCATION;
});

afterEach(() => {
  mem.clear();
  if (realWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = realWindow;
  if (realLocation === undefined) delete (globalThis as { location?: unknown }).location;
  else (globalThis as { location: unknown }).location = realLocation;
  globalThis.fetch = realFetch;
});

const realFetch = globalThis.fetch;

function stubFetch(impl: typeof fetch) {
  globalThis.fetch = impl as typeof fetch;
}

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function htmlResp(status = 200): Response {
  return new Response("<!DOCTYPE html><html><body>index</body></html>", {
    status,
    headers: { "content-type": "text/html" },
  });
}

// ── identity ───────────────────────────────────────────────────────────────

describe("local client — identity properties", () => {
  it("has runtime === 'local'", () => {
    const c = createLocalClient();
    expect(c.runtime).toBe("local");
  });

  it("hasLocalCapabilities is true", () => {
    const c = createLocalClient();
    expect(c.hasLocalCapabilities).toBe(true);
  });
});

// ── getSession ─────────────────────────────────────────────────────────────

describe("local client — getSession", () => {
  it("returns a local operator stub without hitting the network", async () => {
    const c = createLocalClient();
    const s = await c.getSession();
    expect(s).not.toBeNull();
    expect(s!.userId).toBe("local");
    expect(s!.login).toBe("local operator");
    expect(s!.authType).toBe("dashboard-token");
  });
});

// ── listProjects ───────────────────────────────────────────────────────────

describe("local client — listProjects", () => {
  it("returns parsed projects on 200", async () => {
    const payload = { root: "/home/user/mono", projects: [{ slug: "sigmashake-gov" }] };
    stubFetch(async () => jsonResp(payload));
    const c = createLocalClient();
    const result = await c.listProjects();
    expect(result).toEqual(payload);
  });

  it("throws on non-200 response", async () => {
    stubFetch(async () => new Response("nope", { status: 503 }));
    const c = createLocalClient();
    await expect(c.listProjects()).rejects.toThrow(/503/);
  });
});

// ── getHealth ──────────────────────────────────────────────────────────────

describe("local client — getHealth", () => {
  it("unwraps the {health: {...}} envelope", async () => {
    const health = {
      "sigmashake-gov": {
        slug: "sigmashake-gov",
        gitDirty: false,
        gitAheadOriginMain: 0,
        gitBehindOriginMain: 0,
        deployGateOk: null,
        lastBuildAt: null,
        lastTestAt: null,
        lastTestOk: null,
      },
    };
    stubFetch(async () => jsonResp({ health }));
    const c = createLocalClient();
    const result = await c.getHealth(["sigmashake-gov"]);
    expect(result).toEqual(health);
  });

  it("throws on non-200 response", async () => {
    stubFetch(async () => new Response("gone", { status: 404 }));
    const c = createLocalClient();
    await expect(c.getHealth(["x"])).rejects.toThrow(/404/);
  });
});

// ── readFile ───────────────────────────────────────────────────────────────

describe("local client — readFile", () => {
  it("returns the content string from {content} envelope", async () => {
    stubFetch(async () => jsonResp({ content: "# CLAUDE.md contents" }));
    const c = createLocalClient();
    const content = await c.readFile("sigmashake-gov", "CLAUDE.md");
    expect(content).toBe("# CLAUDE.md contents");
  });

  it("throws on non-200", async () => {
    stubFetch(async () => new Response("denied", { status: 403 }));
    const c = createLocalClient();
    await expect(c.readFile("x", "CLAUDE.md")).rejects.toThrow(/403/);
  });
});

// ── writeFile ──────────────────────────────────────────────────────────────

describe("local client — writeFile", () => {
  it("resolves without error on 200", async () => {
    stubFetch(async () => jsonResp({ ok: true }));
    const c = createLocalClient();
    await expect(
      c.writeFile({ project: "sigmashake-gov", file: "CLAUDE.md", content: "x" }),
    ).resolves.toBeUndefined();
  });

  it("throws on non-200", async () => {
    stubFetch(async () => new Response("forbidden", { status: 403 }));
    const c = createLocalClient();
    await expect(c.writeFile({ project: "x", file: "CLAUDE.md", content: "y" })).rejects.toThrow(
      /403/,
    );
  });
});

// ── getSettings / assertJsonResponse guard ─────────────────────────────────

describe("local client — getSettings stale-daemon guard", () => {
  it("falls back to localStorage defaults when the daemon returns HTML (older SigmaShake)", async () => {
    // The daemon returns an HTML page (catch-all 200) instead of JSON — the
    // assertJsonResponse guard inside getDistribution detects this. getSettings
    // catches the thrown error and returns the localStorage fallback.
    stubFetch(async () => htmlResp(200));
    const c = createLocalClient();
    const s = await c.getSettings();
    // Should not throw — returns defaults
    expect(s).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("falls back to defaults when the daemon 404s", async () => {
    stubFetch(async () => new Response("not found", { status: 404 }));
    const c = createLocalClient();
    const s = await c.getSettings();
    expect(s).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("returns daemon settings on 200 JSON", async () => {
    const daemonSettings = {
      settings: { settingsVersion: 1, mode: "hybrid", onboarded: true, updatedAt: 999 },
    };
    stubFetch(async () => jsonResp(daemonSettings));
    const c = createLocalClient();
    const s = await c.getSettings();
    expect(s.mode).toBe("hybrid");
    expect(s.onboarded).toBe(true);
  });
});

// ── getFleetStatus ─────────────────────────────────────────────────────────

describe("local client — getFleetStatus", () => {
  it("returns enrollment=null and reachability when daemon enrollment endpoint 404s", async () => {
    // Two parallel fetches: fleet.sigmashake.com probe + daemon enrollment.
    // Stub both to 404 to exercise the null-enrollment path.
    stubFetch(async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("fleet.sigmashake.com/api/health")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("not found", { status: 404 });
    });
    const c = createLocalClient();
    const status = await c.getFleetStatus();
    expect(status.enrollment).toBeNull();
    expect(status.reachability).toBe("ok");
  });
});
