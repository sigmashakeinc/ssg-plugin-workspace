// Unit coverage for the VS Code webview client (src/client/api/vscode.ts).
// The client installs a window.fetch shim that proxies daemon-bound requests
// over postMessage to the extension host. We stub acquireVsCodeApi() and
// drive the message bus by hand to exercise the proxy + capability fences.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface VsCodeApiStub {
  postMessage: ReturnType<typeof vi.fn>;
}

interface WindowShape {
  acquireVsCodeApi?: () => VsCodeApiStub;
  __WORKSPACE_CONFIG__?: unknown;
  fetch: typeof fetch;
  addEventListener: typeof addEventListener;
  removeEventListener: typeof removeEventListener;
  dispatchEvent: typeof dispatchEvent;
  localStorage?: unknown;
  location?: { origin: string; protocol: string; hostname: string; port: string };
}

const realWindow = (globalThis as { window?: unknown }).window;
const realFetch = globalThis.fetch;

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

let postMessage: ReturnType<typeof vi.fn>;
let listeners: Array<(ev: MessageEvent) => void>;
let win: WindowShape;

function emit(data: unknown) {
  const ev = { data } as MessageEvent;
  for (const l of listeners) l(ev);
}

beforeEach(async () => {
  vi.resetModules();
  postMessage = vi.fn();
  listeners = [];
  const webviewLocation = {
    origin: "vscode-webview://abcd-1234",
    protocol: "vscode-webview:",
    hostname: "abcd-1234",
    port: "",
  };
  win = {
    acquireVsCodeApi: () => ({ postMessage }),
    fetch: vi.fn(realFetch),
    addEventListener: ((type: string, fn: (ev: MessageEvent) => void) => {
      if (type === "message") listeners.push(fn);
    }) as typeof addEventListener,
    removeEventListener: ((type: string, fn: (ev: MessageEvent) => void) => {
      if (type === "message") listeners = listeners.filter((l) => l !== fn);
    }) as typeof removeEventListener,
    dispatchEvent: (() => true) as typeof dispatchEvent,
    localStorage: new MemoryStorage(),
    location: webviewLocation,
  };
  (globalThis as { window: WindowShape }).window = win;
  (
    globalThis as unknown as {
      location: { origin: string; protocol: string; hostname: string; port: string };
    }
  ).location = webviewLocation;
});

afterEach(() => {
  if (realWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window: unknown }).window = realWindow;
  }
  globalThis.fetch = realFetch;
});

describe("createVscodeClient", () => {
  it("posts a ready message and resolves a config snapshot", async () => {
    const { createVscodeClient } = await import("../src/client/api/vscode");
    createVscodeClient();
    expect(postMessage).toHaveBeenCalledWith({ kind: "ready" });
    emit({
      kind: "config",
      config: {
        daemonUrl: "http://127.0.0.1:7901",
        daemonToken: "tok",
        monorepoRoot: "/home/user/mono",
      },
    });
    // Allow the config-resolve microtask to flush.
    await Promise.resolve();
    expect(win.__WORKSPACE_CONFIG__).toMatchObject({
      runtime: "vscode",
      port: 7901,
      token: "tok",
      root: "/home/user/mono",
    });
  });

  it("tags the client runtime as vscode", async () => {
    const { createVscodeClient } = await import("../src/client/api/vscode");
    const client = createVscodeClient();
    expect(client.runtime).toBe("vscode");
    expect(client.hasLocalCapabilities).toBe(true);
  });

  it("raises CapabilityError on Inbox methods (cloud-only)", async () => {
    const { createVscodeClient } = await import("../src/client/api/vscode");
    const { CapabilityError } = await import("../src/client/api/client");
    const client = createVscodeClient();
    await expect(client.getInbox()).rejects.toBeInstanceOf(CapabilityError);
    await expect(client.replyTicket("t-1", "hi")).rejects.toBeInstanceOf(CapabilityError);
    await expect(client.closeTicket("t-1")).rejects.toBeInstanceOf(CapabilityError);
    await expect(client.patchTicket("t-1", { status: "closed" })).rejects.toBeInstanceOf(
      CapabilityError,
    );
    await expect(client.patchLead("lead_xyz", { status: "ignored" })).rejects.toBeInstanceOf(
      CapabilityError,
    );
  });

  it("proxies daemon-bound fetch through postMessage and resolves the response", async () => {
    const { createVscodeClient } = await import("../src/client/api/vscode");
    createVscodeClient();
    emit({
      kind: "config",
      config: { daemonUrl: "http://127.0.0.1:7901", daemonToken: "", monorepoRoot: "" },
    });
    // Issue a fetch. The shim awaits configReady before posting, so the
    // postMessage call lands on a microtask after the config event is
    // consumed.
    const fetchPromise = win.fetch("http://127.0.0.1:7901/api/json/workspace/projects");
    // Spin the microtask queue until the fetch postMessage shows up.
    let fetchCall: unknown;
    for (let i = 0; i < 10 && !fetchCall; i++) {
      await Promise.resolve();
      fetchCall = postMessage.mock.calls.find((c) => (c[0] as { kind: string }).kind === "fetch");
    }
    expect(fetchCall, "fetch postMessage not sent").toBeTruthy();
    const id = ((fetchCall as Array<unknown>)[0] as { id: string }).id;
    emit({
      kind: "fetch:result",
      id,
      ok: true,
      status: 200,
      body: JSON.stringify({ root: "/x", projects: [] }),
      headers: { "content-type": "application/json" },
    });
    const res = await fetchPromise;
    expect(res.ok).toBe(true);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ root: "/x", projects: [] });
  });

  it("recognizes webview-origin /api/json/ URLs as daemon-bound and strips origin", async () => {
    // The local client (src/client/api/local.ts) builds URLs from
    // `location.protocol`/`location.hostname` — in a VS Code webview that's
    // `vscode-webview://<id>/api/json/...`. The shim must accept these and
    // forward only the path so the host can prepend the configured daemon
    // URL without having to recognize webview origin schemes.
    const { createVscodeClient } = await import("../src/client/api/vscode");
    createVscodeClient();
    emit({
      kind: "config",
      config: { daemonUrl: "http://127.0.0.1:7901", daemonToken: "", monorepoRoot: "" },
    });
    const fetchPromise = win.fetch(
      "vscode-webview://abcd-1234/api/json/workspace/projects?root=%2Fhome%2Fuser%2Fmono",
    );
    let fetchCall: unknown;
    for (let i = 0; i < 10 && !fetchCall; i++) {
      await Promise.resolve();
      fetchCall = postMessage.mock.calls.find((c) => (c[0] as { kind: string }).kind === "fetch");
    }
    expect(fetchCall, "fetch postMessage not sent").toBeTruthy();
    const msg = (fetchCall as Array<unknown>)[0] as { id: string; url: string };
    expect(msg.url).toBe("/api/json/workspace/projects?root=%2Fhome%2Fuser%2Fmono");
    emit({
      kind: "fetch:result",
      id: msg.id,
      ok: true,
      status: 200,
      body: JSON.stringify({ root: "/home/user/mono", projects: [] }),
      headers: { "content-type": "application/json" },
    });
    const res = await fetchPromise;
    expect(res.ok).toBe(true);
  });

  it("returns a 503 local_only response when no daemonUrl is configured", async () => {
    const { createVscodeClient } = await import("../src/client/api/vscode");
    createVscodeClient();
    emit({
      kind: "config",
      config: { daemonUrl: "", daemonToken: "", monorepoRoot: "" },
    });
    const res = await win.fetch("http://127.0.0.1:7901/api/json/workspace/projects");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("local_only");
  });
});
