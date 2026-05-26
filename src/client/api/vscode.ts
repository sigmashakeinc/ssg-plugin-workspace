// VS Code webview runtime — the React app runs inside a vscode.WebviewPanel
// and reaches the user's SSG daemon through the extension host. The host
// (vscode/src/extension.ts) is responsible for the actual network fetch; we
// shim window.fetch onto a postMessage RPC so the local client's HTTP code
// stays untouched.
//
// Why a fetch shim instead of a fresh client implementation:
//   - The workspace UI already has a working local-daemon client; the only
//     difference under VS Code is who carries the bytes over the wire. Hooking
//     fetch keeps that surface unchanged.
//   - The webview CSP sets `connect-src 'none'` so direct fetches to the
//     daemon would be blocked by the browser layer anyway. Routing through
//     postMessage is the only path that can reach localhost without loosening
//     the CSP (and without exposing localhost to arbitrary script in the
//     webview).
//
// Known limitation: SSE / streaming responses (e.g. /api/json/workspace/run/
// :jobId/stream) are buffered to a single message by the host and arrive as
// one Response with a string body. The streamRun() reader in local.ts will
// emit every line at once when the script finishes, not as it runs. Chunked
// postMessage streaming is intentionally out of scope for v0.1.

import { CapabilityError, type WorkspaceApiClient } from "./client";
import { createLocalClient } from "./local";

interface VsCodeApi {
  postMessage(msg: unknown): void;
}

interface VsCodeConfig {
  daemonUrl: string;
  daemonToken: string;
  monorepoRoot: string;
}

interface FetchResultMessage {
  kind: "fetch:result";
  id: string;
  ok: boolean;
  status: number;
  body: string;
  headers: Record<string, string>;
}

interface ConfigMessage {
  kind: "config";
  config: VsCodeConfig;
}

declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

let installed = false;
let vscodeApi: VsCodeApi | null = null;
const pending = new Map<string, (msg: FetchResultMessage) => void>();
let configReady: Promise<VsCodeConfig> | null = null;
let resolveConfig: ((cfg: VsCodeConfig) => void) | null = null;

function installShim(): void {
  if (installed) return;
  installed = true;

  if (typeof window === "undefined" || typeof window.acquireVsCodeApi !== "function") {
    // Not running inside a VS Code webview — leave fetch alone. The
    // electrobun + cloud + local runtimes will pick a different client.
    return;
  }

  vscodeApi = window.acquireVsCodeApi();
  configReady = new Promise<VsCodeConfig>((resolve) => {
    resolveConfig = resolve;
  });

  window.addEventListener("message", (ev: MessageEvent) => {
    const data = ev.data as ConfigMessage | FetchResultMessage | undefined;
    if (!data || typeof data !== "object") return;
    if (data.kind === "config") {
      const cfg = data.config ?? { daemonUrl: "", daemonToken: "", monorepoRoot: "" };
      window.__WORKSPACE_CONFIG__ = {
        runtime: "vscode",
        port: extractPort(cfg.daemonUrl),
        token: cfg.daemonToken,
        root: cfg.monorepoRoot || undefined,
      };
      resolveConfig?.(cfg);
      return;
    }
    if (data.kind === "fetch:result") {
      const cb = pending.get(data.id);
      if (cb) {
        pending.delete(data.id);
        cb(data);
      }
      return;
    }
  });

  const realFetch = window.fetch.bind(window);
  window.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const rawUrl = typeof input === "string" ? input : input.toString();
    const cfg = await configReady;
    if (!cfg?.daemonUrl) {
      // No daemon configured — surface the same 501 "local_only" shape the
      // cloud worker emits so the CloudGate fallbacks render cleanly.
      return new Response(
        JSON.stringify({
          error: "local_only",
          message:
            "Set sigmashake.workspace.daemonUrl in VS Code settings to connect to a local SSG daemon. Without it, Run/Inspect/Edit are unavailable.",
        }),
        { status: 503, headers: { "content-type": "application/json" } },
      );
    }
    if (!isLocalDaemonUrl(rawUrl, cfg.daemonUrl)) {
      // Foreign-origin fetches still work the normal way — the webview's CSP
      // will gate them. We only proxy daemon-bound traffic.
      return realFetch(input, init);
    }
    return proxyFetch(rawUrl, init);
  }) as typeof window.fetch;

  vscodeApi.postMessage({ kind: "ready" });
}

function extractPort(url: string): number | undefined {
  try {
    return Number(new URL(url).port) || undefined;
  } catch {
    return undefined;
  }
}

function isLocalDaemonUrl(rawUrl: string, daemonUrl: string): boolean {
  if (rawUrl.startsWith("/")) return true;
  try {
    const parsed = new URL(rawUrl);
    // Direct match against the configured daemon — the common case in tests
    // and any caller that builds URLs from `cfg.daemonUrl`.
    if (parsed.origin === new URL(daemonUrl).origin) return true;
    // The local client (src/client/api/local.ts) builds URLs from
    // `location.protocol`/`location.hostname` — in a VS Code webview that
    // becomes `vscode-webview://<id>/api/json/...`. The WHATWG URL parser
    // reports an opaque origin ("null") for non-special schemes, so we
    // can't compare against window.location.origin reliably. Recognize
    // the daemon-bound pattern by path instead: any /api/json/* or
    // /api/v1/* request inside the webview can only come from the local
    // client (no other API client runs in the vscode runtime), so route
    // it through the proxy.
    if (parsed.pathname.startsWith("/api/json/") || parsed.pathname.startsWith("/api/v1/")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

let counter = 0;
function nextId(): string {
  counter += 1;
  return `f${counter}`;
}

// Normalize a daemon-bound URL down to a path the extension host can prepend
// to the configured daemon URL. The local client builds absolute URLs from
// `location.*`, so the proxied URL often carries the webview's own origin
// (e.g. `vscode-webview://<id>/api/json/workspace/projects`). Stripping that
// down to `/api/json/workspace/projects?root=…` lets the host resolve the
// target without having to recognize every webview origin form.
function pathForProxy(rawUrl: string): string {
  if (rawUrl.startsWith("/")) return rawUrl;
  try {
    const u = new URL(rawUrl);
    return `${u.pathname}${u.search}`;
  } catch {
    return rawUrl;
  }
}

async function proxyFetch(url: string, init?: RequestInit): Promise<Response> {
  if (!vscodeApi) throw new Error("vscode api not available");
  const id = nextId();
  const result = new Promise<FetchResultMessage>((resolve) => {
    pending.set(id, resolve);
  });
  const headersObj: Record<string, string> = {};
  if (init?.headers) {
    const headers = new Headers(init.headers);
    headers.forEach((value, key) => {
      headersObj[key] = value;
    });
  }
  vscodeApi.postMessage({
    kind: "fetch",
    id,
    url: pathForProxy(url),
    init: {
      method: init?.method,
      headers: headersObj,
      body: typeof init?.body === "string" ? init.body : undefined,
    },
  });
  const res = await result;
  return new Response(res.body, {
    status: res.status || 0,
    headers: res.headers,
  });
}

export function createVscodeClient(): WorkspaceApiClient {
  installShim();
  // Reuse the local client — its fetches are routed through the shim above to
  // the user-configured daemon. Tag the runtime as "vscode" so the UI can
  // surface the right empty states (e.g. the Inbox cloud-only banner still
  // points at workspace.sigmashake.com, since the bearer secrets only live on
  // the cloud Worker).
  const base = createLocalClient();
  return {
    ...base,
    runtime: "vscode",
    async getInbox() {
      throw new CapabilityError(
        "The unified Inbox lives on workspace.sigmashake.com — the support API bearer and the sales service binding only exist on the Cloudflare Worker. Open https://workspace.sigmashake.com/ to view tickets and leads.",
      );
    },
    async replyTicket() {
      throw new CapabilityError("Reply requires the cloud Inbox. Open workspace.sigmashake.com.");
    },
    async closeTicket() {
      throw new CapabilityError("Close requires the cloud Inbox. Open workspace.sigmashake.com.");
    },
    async patchTicket() {
      throw new CapabilityError("Patch requires the cloud Inbox. Open workspace.sigmashake.com.");
    },
    async patchLead() {
      throw new CapabilityError(
        "Lead patch requires the cloud Inbox. Open workspace.sigmashake.com.",
      );
    },
    async autoEnrollFleet() {
      throw new CapabilityError(
        "One-click Fleet enrollment relies on the browser SSO cookie on *.fleet.sigmashake.com, which the VS Code webview can't see. Open Workspace in SigmaShake Desktop or on workspace.sigmashake.com to connect this machine.",
      );
    },
  };
}
