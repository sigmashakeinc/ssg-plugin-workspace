// Unit tests for the Electrobun client (src/client/api/electrobun.ts).
// The electrobun client RPCs to the Electroview bridge via
// window.__WORKSPACE_VIEW__.rpc.request.*. We stub that object in beforeEach
// and delete window in afterEach so tests are fully isolated.
//
// getSettings / setSettings fall through to settings-store (localStorage) —
// the bun-host RPC isn't wired yet. We cover that branch explicitly.
//
// getFleetStatus calls probeFleetReachability (fetch) and readEnrollmentViaRpc
// (view bridge) in parallel — both are stubbed.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createElectrobunClient, effectiveRoot, pickedRoot } from "../src/client/api/electrobun";
import { DEFAULT_WORKSPACE_SETTINGS } from "../src/client/api/types";

// ── helpers ─────────────────────────────────────────────────────────────────

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
const realFetch = globalThis.fetch;
const mem = new MemoryStorage();

// The stub map — tests replace individual methods with vi.fn().mockResolvedValue
type StubMap = {
  listProjects: ReturnType<typeof vi.fn>;
  getHealth: ReturnType<typeof vi.fn>;
  runScript: ReturnType<typeof vi.fn>;
  cancelRun: ReturnType<typeof vi.fn>;
  readFile: ReturnType<typeof vi.fn>;
  writeFile: ReturnType<typeof vi.fn>;
  getRuntimeConfig: ReturnType<typeof vi.fn>;
  pickDirectory: ReturnType<typeof vi.fn>;
  createProject: ReturnType<typeof vi.fn>;
  listInfrastructure: ReturnType<typeof vi.fn>;
  getDistribution: ReturnType<typeof vi.fn>;
  triggerSync: ReturnType<typeof vi.fn>;
  getContextUsage: ReturnType<typeof vi.fn>;
  getFleetEnrollment: ReturnType<typeof vi.fn>;
};

let stubMap: StubMap;

function makeStubs(): StubMap {
  return {
    listProjects: vi.fn(),
    getHealth: vi.fn(),
    runScript: vi.fn(),
    cancelRun: vi.fn(),
    readFile: vi.fn(),
    writeFile: vi.fn(),
    getRuntimeConfig: vi.fn(),
    pickDirectory: vi.fn(),
    createProject: vi.fn(),
    listInfrastructure: vi.fn(),
    getDistribution: vi.fn(),
    triggerSync: vi.fn(),
    getContextUsage: vi.fn(),
    getFleetEnrollment: vi.fn(),
  };
}

beforeEach(() => {
  stubMap = makeStubs();
  (globalThis as { window: unknown }).window = {
    localStorage: mem,
    __WORKSPACE_VIEW__: { rpc: { request: stubMap } },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
});

afterEach(() => {
  mem.clear();
  vi.restoreAllMocks();
  if (realWindow === undefined) delete (globalThis as { window?: unknown }).window;
  else (globalThis as { window: unknown }).window = realWindow;
  globalThis.fetch = realFetch;
});

function jsonResp(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ── identity ─────────────────────────────────────────────────────────────────

describe("electrobun client — identity properties", () => {
  it("has runtime === 'electrobun'", () => {
    const c = createElectrobunClient();
    expect(c.runtime).toBe("electrobun");
  });

  it("hasLocalCapabilities is true", () => {
    const c = createElectrobunClient();
    expect(c.hasLocalCapabilities).toBe(true);
  });
});

// ── listProjects ──────────────────────────────────────────────────────────────

describe("electrobun client — listProjects", () => {
  it("calls rpc.request.listProjects with root and returns projects", async () => {
    stubMap.listProjects.mockResolvedValue({
      ok: true,
      root: "/home/user/mono",
      projects: [{ slug: "sigmashake-gov" }],
    });
    const c = createElectrobunClient();
    const result = await c.listProjects("/home/user/mono");
    expect(stubMap.listProjects).toHaveBeenCalledWith({ root: "/home/user/mono" });
    expect(result).toEqual({ root: "/home/user/mono", projects: [{ slug: "sigmashake-gov" }] });
  });

  it("throws when rpc returns ok:false", async () => {
    stubMap.listProjects.mockResolvedValue({ ok: false, error: "not found" });
    const c = createElectrobunClient();
    await expect(c.listProjects()).rejects.toThrow("not found");
  });
});

// ── getHealth ─────────────────────────────────────────────────────────────────

describe("electrobun client — getHealth", () => {
  it("calls rpc.request.getHealth and returns the health record", async () => {
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
    stubMap.getHealth.mockResolvedValue({ ok: true, health });
    const c = createElectrobunClient();
    const result = await c.getHealth(["sigmashake-gov"]);
    expect(stubMap.getHealth).toHaveBeenCalledWith({ slugs: ["sigmashake-gov"] });
    expect(result).toEqual(health);
  });

  it("returns empty object when health field is absent", async () => {
    stubMap.getHealth.mockResolvedValue({ ok: true });
    const c = createElectrobunClient();
    const result = await c.getHealth([]);
    expect(result).toEqual({});
  });
});

// ── runScript ─────────────────────────────────────────────────────────────────

describe("electrobun client — runScript", () => {
  it("calls rpc.request.runScript and returns a RunHandle with jobId and cancel()", async () => {
    stubMap.runScript.mockResolvedValue({ ok: true, jobId: "job-abc" });
    stubMap.cancelRun.mockResolvedValue({ ok: true });
    const c = createElectrobunClient();
    const handle = await c.runScript("sigmashake-gov", "test");
    expect(stubMap.runScript).toHaveBeenCalledWith({ project: "sigmashake-gov", script: "test" });
    expect(handle.jobId).toBe("job-abc");
    expect(typeof handle.cancel).toBe("function");
    expect(typeof handle.events[Symbol.asyncIterator]).toBe("function");

    // cancel() must delegate to rpc.request.cancelRun
    await handle.cancel();
    expect(stubMap.cancelRun).toHaveBeenCalledWith({ jobId: "job-abc" });
  });

  // NOTE: Iterating handle.events hangs without a real CustomEvent stream —
  // the iterator waits for "workspace:runOutput" CustomEvents that never fire
  // in a Node.js test environment. We only test jobId + cancel() above.

  it("throws when rpc returns ok:false", async () => {
    stubMap.runScript.mockResolvedValue({ ok: false, error: "script not found" });
    const c = createElectrobunClient();
    await expect(c.runScript("x", "build")).rejects.toThrow("script not found");
  });
});

// ── readFile ──────────────────────────────────────────────────────────────────

describe("electrobun client — readFile", () => {
  it("calls rpc.request.readFile and returns content string", async () => {
    stubMap.readFile.mockResolvedValue({ ok: true, content: "# hello" });
    const c = createElectrobunClient();
    const content = await c.readFile("sigmashake-gov", "CLAUDE.md");
    expect(stubMap.readFile).toHaveBeenCalledWith({ project: "sigmashake-gov", file: "CLAUDE.md" });
    expect(content).toBe("# hello");
  });

  it("returns empty string when content field absent", async () => {
    stubMap.readFile.mockResolvedValue({ ok: true });
    const c = createElectrobunClient();
    expect(await c.readFile("x", "README.md")).toBe("");
  });

  it("throws when rpc returns ok:false", async () => {
    stubMap.readFile.mockResolvedValue({ ok: false, error: "not found" });
    const c = createElectrobunClient();
    await expect(c.readFile("x", "CLAUDE.md")).rejects.toThrow("not found");
  });
});

// ── writeFile ─────────────────────────────────────────────────────────────────

describe("electrobun client — writeFile", () => {
  it("calls rpc.request.writeFile and resolves on ok:true", async () => {
    stubMap.writeFile.mockResolvedValue({ ok: true });
    const c = createElectrobunClient();
    const req = { project: "sigmashake-gov", file: "CLAUDE.md" as const, content: "new content" };
    await expect(c.writeFile(req)).resolves.toBeUndefined();
    expect(stubMap.writeFile).toHaveBeenCalledWith(req);
  });

  it("throws when rpc returns ok:false", async () => {
    stubMap.writeFile.mockResolvedValue({ ok: false, error: "write denied" });
    const c = createElectrobunClient();
    await expect(c.writeFile({ project: "x", file: "CLAUDE.md", content: "y" })).rejects.toThrow(
      "write denied",
    );
  });
});

// ── pickDirectory ─────────────────────────────────────────────────────────────

describe("electrobun client — pickDirectory", () => {
  it("returns the path on ok:true + path present", async () => {
    stubMap.pickDirectory.mockResolvedValue({ ok: true, path: "/home/user/mono" });
    const c = createElectrobunClient();
    const path = await c.pickDirectory("/home/user");
    expect(stubMap.pickDirectory).toHaveBeenCalledWith({
      startDir: "/home/user",
      title: "Choose your monorepo folder",
    });
    expect(path).toBe("/home/user/mono");
  });

  it("returns null when user cancels (ok:false)", async () => {
    stubMap.pickDirectory.mockResolvedValue({ ok: false, reason: "cancelled" });
    const c = createElectrobunClient();
    const path = await c.pickDirectory();
    expect(path).toBeNull();
  });
});

// ── createProject ─────────────────────────────────────────────────────────────

describe("electrobun client — createProject", () => {
  it("returns the new ProjectCard on success", async () => {
    const project = {
      slug: "new-proj",
      name: "New Project",
      type: "bun",
      description: "d",
      root: "/home/user/mono",
    };
    stubMap.createProject.mockResolvedValue({ ok: true, project });
    const c = createElectrobunClient();
    const req = { slug: "new-proj", type: "bun" as const, description: "d" };
    const result = await c.createProject(req);
    expect(stubMap.createProject).toHaveBeenCalledWith(req);
    expect(result).toEqual(project);
  });

  it("throws with error field when rpc returns ok:false", async () => {
    stubMap.createProject.mockResolvedValue({ ok: false, error: "slug taken" });
    const c = createElectrobunClient();
    await expect(c.createProject({ slug: "x", type: "bun", description: "d" })).rejects.toThrow(
      "slug taken",
    );
  });
});

// ── listInfrastructure ────────────────────────────────────────────────────────

describe("electrobun client — listInfrastructure", () => {
  it("returns the graph on success", async () => {
    const graph = { nodes: [], edges: [] };
    stubMap.listInfrastructure.mockResolvedValue({ ok: true, graph });
    const c = createElectrobunClient();
    const result = await c.listInfrastructure("/home/user/mono");
    expect(stubMap.listInfrastructure).toHaveBeenCalledWith({ root: "/home/user/mono" });
    expect(result).toEqual(graph);
  });

  it("throws when rpc returns ok:false", async () => {
    stubMap.listInfrastructure.mockResolvedValue({ ok: false, error: "infra error" });
    const c = createElectrobunClient();
    await expect(c.listInfrastructure()).rejects.toThrow("infra error");
  });
});

// ── getDistribution ───────────────────────────────────────────────────────────

describe("electrobun client — getDistribution", () => {
  it("returns distribution data on success", async () => {
    const distribution = { version: "0.1.0", packages: [] };
    stubMap.getDistribution.mockResolvedValue({ ok: true, distribution });
    const c = createElectrobunClient();
    const result = await c.getDistribution();
    expect(stubMap.getDistribution).toHaveBeenCalledWith({ root: undefined });
    expect(result).toEqual(distribution);
  });

  it("throws when rpc returns ok:false", async () => {
    stubMap.getDistribution.mockResolvedValue({ ok: false, error: "dist error" });
    const c = createElectrobunClient();
    await expect(c.getDistribution()).rejects.toThrow("dist error");
  });
});

// ── triggerSync ───────────────────────────────────────────────────────────────

describe("electrobun client — triggerSync", () => {
  it("returns jobId + version on success", async () => {
    stubMap.triggerSync.mockResolvedValue({ ok: true, jobId: "sync-1", version: "0.2.0" });
    const c = createElectrobunClient();
    const result = await c.triggerSync();
    expect(stubMap.triggerSync).toHaveBeenCalledWith({});
    expect(result).toEqual({ jobId: "sync-1", version: "0.2.0" });
  });

  it("throws when rpc returns ok:false", async () => {
    stubMap.triggerSync.mockResolvedValue({ ok: false, error: "sync error" });
    const c = createElectrobunClient();
    await expect(c.triggerSync()).rejects.toThrow("sync error");
  });
});

// ── getSession ────────────────────────────────────────────────────────────────

describe("electrobun client — getSession", () => {
  it("returns local operator stub without RPC", async () => {
    const c = createElectrobunClient();
    const s = await c.getSession();
    expect(s).not.toBeNull();
    expect(s!.userId).toBe("local");
    expect(s!.login).toBe("local operator");
    expect(s!.authType).toBe("dashboard-token");
  });
});

// ── getSettings / setSettings ─────────────────────────────────────────────────

describe("electrobun client — getSettings / setSettings (localStorage-backed)", () => {
  // The electrobun client falls through to settings-store (localStorage)
  // because the bun-host RPC isn't wired yet.
  it("getSettings returns defaults when localStorage is empty", async () => {
    const c = createElectrobunClient();
    const s = await c.getSettings();
    expect(s).toEqual(DEFAULT_WORKSPACE_SETTINGS);
  });

  it("setSettings persists patch and returns merged settings", async () => {
    const c = createElectrobunClient();
    const s = await c.setSettings({ mode: "services", onboarded: true });
    expect(s.mode).toBe("services");
    expect(s.onboarded).toBe(true);
    // Round-trip: getSettings should reflect the saved patch
    const again = await c.getSettings();
    expect(again.mode).toBe("services");
  });

  it("setSettings does NOT call view RPC (bridge not wired yet)", async () => {
    const rpcSpy = vi.fn();
    // Inject a hypothetical getSettings on the bridge — it must NOT be called
    (stubMap as unknown as Record<string, unknown>).getSettings = rpcSpy;
    const c = createElectrobunClient();
    await c.setSettings({ onboarded: true });
    expect(rpcSpy).not.toHaveBeenCalled();
  });
});

// ── getContextUsage ───────────────────────────────────────────────────────────

describe("electrobun client — getContextUsage", () => {
  it("returns usage on success", async () => {
    const usage = {
      project: "sigmashake-gov",
      tokensUsed: 1024,
      tokensLimit: 200000,
      updatedAt: 1234,
    };
    stubMap.getContextUsage.mockResolvedValue({ ok: true, usage });
    const c = createElectrobunClient();
    const result = await c.getContextUsage("sigmashake-gov");
    expect(stubMap.getContextUsage).toHaveBeenCalledWith({ project: "sigmashake-gov" });
    expect(result).toEqual(usage);
  });

  it("throws when rpc returns ok:false", async () => {
    stubMap.getContextUsage.mockResolvedValue({ ok: false, error: "context error" });
    const c = createElectrobunClient();
    await expect(c.getContextUsage("x")).rejects.toThrow("context error");
  });
});

// ── getFleetStatus ────────────────────────────────────────────────────────────

describe("electrobun client — getFleetStatus", () => {
  it("returns enrollment from RPC and reachability from fetch probe", async () => {
    // fleet health probe (fetch) returns ok
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      const u = String(url);
      if (u.includes("fleet.sigmashake.com/api/health")) {
        return jsonResp({ ok: true });
      }
      return new Response("not found", { status: 404 });
    }) as typeof fetch;

    const enrollment = { agentId: "agt-1", orgSlug: "acme", status: "active" };
    stubMap.getFleetEnrollment.mockResolvedValue({ ok: true, enrollment });

    const c = createElectrobunClient();
    const status = await c.getFleetStatus();
    expect(status.reachability).toBe("ok");
    expect(status.enrollment).toEqual(enrollment);
    expect(status.signInUrl).toBe("https://fleet.sigmashake.com");
  });

  it("returns enrollment=null when RPC fails (not yet wired)", async () => {
    globalThis.fetch = (async () => jsonResp({ ok: true })) as typeof fetch;
    // Simulate RPC bridge timing out (getFleetEnrollment rejects)
    stubMap.getFleetEnrollment.mockRejectedValue(new Error("timeout"));
    const c = createElectrobunClient();
    const status = await c.getFleetStatus();
    // readEnrollmentViaRpc catches errors and returns null
    expect(status.enrollment).toBeNull();
    expect(status.reachability).toBe("ok");
  });

  it("reports reachability=unreachable when fleet probe fails", async () => {
    globalThis.fetch = (async () => {
      throw new TypeError("network error");
    }) as typeof fetch;
    stubMap.getFleetEnrollment.mockResolvedValue({ ok: false });
    const c = createElectrobunClient();
    const status = await c.getFleetStatus();
    expect(status.reachability).toBe("unreachable");
  });
});

// ── getFleetOverview ──────────────────────────────────────────────────────────

describe("electrobun client — getFleetOverview", () => {
  it("returns authed:false overview when whoami returns 401", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;
    const c = createElectrobunClient();
    const overview = await c.getFleetOverview("acme");
    expect(overview.authed).toBe(false);
    expect(overview.enrollment).toBeUndefined();
  });

  it("returns error overview for invalid slug", async () => {
    const c = createElectrobunClient();
    const overview = await c.getFleetOverview("!invalid!");
    expect(overview.error).toMatch(/invalid/i);
    expect(overview.authed).toBe(false);
  });
});

// ── workspace root resolution (the "project directory is not selectable" fix) ──

describe("electrobun client — pickedRoot / effectiveRoot", () => {
  const ROOT_LS_KEY = "ssg:workspace:root";

  it("pickedRoot returns '' when nothing is stored", () => {
    expect(pickedRoot()).toBe("");
  });

  it("pickedRoot returns the stored root, trimmed", () => {
    mem.setItem(ROOT_LS_KEY, "  C:\\Users\\user\\code  ");
    expect(pickedRoot()).toBe("C:\\Users\\user\\code");
  });

  it("pickedRoot treats a whitespace-only value as unset", () => {
    mem.setItem(ROOT_LS_KEY, "   ");
    expect(pickedRoot()).toBe("");
  });

  it("effectiveRoot prefers the picked root over the runtime default", () => {
    mem.setItem(ROOT_LS_KEY, "C:\\Users\\user\\monorepo");
    expect(effectiveRoot("C:\\Users\\user")).toBe("C:\\Users\\user\\monorepo");
  });

  it("effectiveRoot falls back to the runtime default when nothing is picked", () => {
    expect(effectiveRoot("C:\\Users\\user")).toBe("C:\\Users\\user");
  });

  it("effectiveRoot returns '' when neither is available", () => {
    expect(effectiveRoot(null)).toBe("");
    expect(effectiveRoot(undefined)).toBe("");
  });
});

describe("electrobun client — picked root flows into the check endpoints", () => {
  const ROOT_LS_KEY = "ssg:workspace:root";

  // Capture the URL each method fetches so we can assert the ?root= it scans.
  function captureFetchUrls(): string[] {
    const urls: string[] = [];
    globalThis.fetch = (async (url: RequestInfo | URL) => {
      urls.push(String(url));
      return jsonResp({});
    }) as typeof fetch;
    return urls;
  }

  it("getCertification scans the operator's picked root, not the daemon default", async () => {
    // daemon default would be homedir(); the picked root must win.
    stubMap.getRuntimeConfig.mockResolvedValue({ port: 5599, token: "tok", root: "/home/user" });
    mem.setItem(ROOT_LS_KEY, "/home/user/Documents/GitHub/sigmashake-mono");
    const urls = captureFetchUrls();
    const c = createElectrobunClient();
    await c.getCertification();
    const u = new URL(urls[0]);
    expect(u.pathname).toBe("/api/json/workspace/certify");
    expect(u.searchParams.get("root")).toBe("/home/user/Documents/GitHub/sigmashake-mono");
  });

  it("getReadiness falls back to the daemon default when nothing is picked", async () => {
    stubMap.getRuntimeConfig.mockResolvedValue({ port: 5599, token: "tok", root: "/home/user" });
    const urls = captureFetchUrls();
    const c = createElectrobunClient();
    await c.getReadiness();
    const u = new URL(urls[0]);
    expect(u.pathname).toBe("/api/json/workspace/readiness");
    expect(u.searchParams.get("root")).toBe("/home/user");
  });

  it("getAiNative sends the picked root", async () => {
    stubMap.getRuntimeConfig.mockResolvedValue({ port: 5599, token: "tok", root: "/home/user" });
    mem.setItem(ROOT_LS_KEY, "/home/user/code/mono");
    const urls = captureFetchUrls();
    const c = createElectrobunClient();
    await c.getAiNative();
    const u = new URL(urls[0]);
    expect(u.searchParams.get("root")).toBe("/home/user/code/mono");
  });
});
