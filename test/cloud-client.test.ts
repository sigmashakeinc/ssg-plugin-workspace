// Unit tests for the cloud API client (src/client/api/cloud.ts).
// The cloud client is the one served at workspace.sigmashake.com — Browse-only.
// We stub global fetch per-test to avoid real network calls; each local-only
// method is expected to throw a CapabilityError.

import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityError } from "../src/client/api/client";
import { createCloudClient } from "../src/client/api/cloud";
import { DEFAULT_WORKSPACE_SETTINGS } from "../src/client/api/types";

// ── localStorage stub ──────────────────────────────────────────────────────

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
const mem = new MemoryStorage();

function installWindow() {
  (globalThis as { window: unknown }).window = { localStorage: mem };
}
function removeWindow() {
  if (realWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = realWindow;
}

// ── fetch stub ─────────────────────────────────────────────────────────────

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
  mem.clear();
  removeWindow();
});

function stubFetch(impl: typeof fetch) {
  globalThis.fetch = impl as typeof fetch;
}

// ── fixtures ───────────────────────────────────────────────────────────────

describe("cloud client — identity properties", () => {
  it("has runtime === 'cloud'", () => {
    installWindow();
    const c = createCloudClient();
    expect(c.runtime).toBe("cloud");
  });

  it("hasLocalCapabilities is false", () => {
    installWindow();
    const c = createCloudClient();
    expect(c.hasLocalCapabilities).toBe(false);
  });
});

describe("cloud client — local-only methods throw CapabilityError", () => {
  const LOCAL_ONLY: Array<{
    method: string;
    call: (c: ReturnType<typeof createCloudClient>) => Promise<unknown>;
  }> = [
    { method: "getHealth", call: (c) => c.getHealth([]) },
    { method: "runScript", call: (c) => c.runScript("proj", "test") },
    { method: "readFile", call: (c) => c.readFile("proj", "CLAUDE.md") },
    {
      method: "writeFile",
      call: (c) => c.writeFile({ project: "p", file: "CLAUDE.md", content: "" }),
    },
    {
      method: "createProject",
      call: (c) => c.createProject({ slug: "x", type: "bun", description: "d" }),
    },
    { method: "listInfrastructure", call: (c) => c.listInfrastructure() },
    { method: "getDistribution", call: (c) => c.getDistribution() },
    { method: "triggerSync", call: (c) => c.triggerSync() },
    { method: "getContextUsage", call: (c) => c.getContextUsage("proj") },
  ];

  for (const { method, call } of LOCAL_ONLY) {
    it(`${method}() throws CapabilityError`, async () => {
      installWindow();
      const c = createCloudClient();
      await expect(call(c)).rejects.toBeInstanceOf(CapabilityError);
    });
  }
});

describe("cloud client — listProjects", () => {
  it("GETs /api/workspace/projects and returns the parsed body", async () => {
    installWindow();
    const payload = { root: "/registry", projects: [{ slug: "sigmashake-gov" }] };
    stubFetch(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const c = createCloudClient();
    const result = await c.listProjects();
    expect(result).toEqual(payload);
  });

  it("throws when the response is not ok", async () => {
    installWindow();
    stubFetch(async () => new Response("bad", { status: 503 }));
    const c = createCloudClient();
    await expect(c.listProjects()).rejects.toThrow(/503/);
  });
});

describe("cloud client — getSession", () => {
  it("returns null when the session endpoint returns 401", async () => {
    installWindow();
    stubFetch(async () => new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));
    const c = createCloudClient();
    expect(await c.getSession()).toBeNull();
  });

  it("returns the session payload when the endpoint returns 200", async () => {
    installWindow();
    const session = { userId: "11810205", login: "operator", authType: "github" };
    stubFetch(
      async () =>
        new Response(JSON.stringify(session), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const c = createCloudClient();
    expect(await c.getSession()).toEqual(session);
  });

  it("throws on non-401 error responses", async () => {
    installWindow();
    stubFetch(async () => new Response("crash", { status: 500 }));
    const c = createCloudClient();
    await expect(c.getSession()).rejects.toThrow(/500/);
  });
});

describe("cloud client — getSettings / setSettings (localStorage-backed)", () => {
  it("getSettings returns defaults when localStorage is empty", async () => {
    installWindow();
    const c = createCloudClient();
    const s = await c.getSettings();
    expect(s).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("setSettings persists and returns the merged settings", async () => {
    installWindow();
    const c = createCloudClient();
    const s = await c.setSettings({ mode: "services", onboarded: true });
    expect(s.mode).toBe("services");
    expect(s.onboarded).toBe(true);
    // Confirm it round-trips
    const again = await c.getSettings();
    expect(again.mode).toBe("services");
  });

  it("setSettings rejects an invalid mode and falls back to schema default", async () => {
    installWindow();
    const c = createCloudClient();
    const s = await c.setSettings({ mode: "bogus" as "stack" });
    // normalize clamped it — must be one of the valid modes
    expect(["stack", "services", "hybrid"]).toContain(s.mode);
  });
});

describe("cloud client — getFleetStatus", () => {
  it("returns an enrollment=null status with the probed reachability", async () => {
    installWindow();
    stubFetch(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const c = createCloudClient();
    const status = await c.getFleetStatus();
    expect(status.enrollment).toBeNull();
    expect(status.reachability).toBe("ok");
    expect(status.signInUrl).toBe("https://fleet.sigmashake.com");
    expect(() => new Date(status.checkedAt).toISOString()).not.toThrow();
  });

  it("reports reachability=unreachable when the probe fails", async () => {
    installWindow();
    stubFetch(async () => {
      throw new TypeError("network error");
    });
    const c = createCloudClient();
    const status = await c.getFleetStatus();
    expect(status.reachability).toBe("unreachable");
    expect(status.enrollment).toBeNull();
  });
});
