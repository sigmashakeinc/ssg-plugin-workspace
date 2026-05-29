// SigmaShake Workspace — VS Code extension host.
//
// Registers a single command that opens a webview panel hosting the
// workspace React bundle (built into webview-dist/ by `bun run build:vscode`).
// The bundle is the same React app that ships to cloud / local-web / plugin,
// with WORKSPACE_RUNTIME = "vscode" — its client (src/client/api/vscode.ts)
// sends fetch requests over postMessage; this host proxies them to the
// user-configured SSG daemon URL.
//
// We deliberately keep the proxy surface minimal: the webview cannot reach
// arbitrary URLs through the host. Only requests whose URL starts with the
// configured daemon base (or the configured fleet origin for cross-origin
// Fleet probes) are honored.

import * as fs from "node:fs";
import * as path from "node:path";
import * as vscode from "vscode";

type WebviewMessage =
  | { kind: "ready" }
  | { kind: "fetch"; id: string; url: string; init?: SerializableInit }
  | { kind: "openExternal"; url: string };

interface SerializableInit {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

interface DaemonConfig {
  daemonUrl: string;
  daemonToken: string;
  monorepoRoot: string;
}

const VIEW_TYPE = "sigmashake.workspace";

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(
    vscode.commands.registerCommand("sigmashake.workspace.open", () => {
      openWorkspacePanel(context);
    }),
  );
}

export function deactivate(): void {
  // Webview panels created with retainContextWhenHidden are disposed by VS Code
  // when the user closes them. No global state to clean up here.
}

let activePanel: vscode.WebviewPanel | null = null;

function openWorkspacePanel(context: vscode.ExtensionContext): void {
  if (activePanel) {
    activePanel.reveal(vscode.ViewColumn.Active);
    return;
  }

  const panel = vscode.window.createWebviewPanel(
    VIEW_TYPE,
    "SigmaShake Workspace",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, "webview-dist")],
    },
  );
  activePanel = panel;

  panel.onDidDispose(() => {
    activePanel = null;
  });

  panel.webview.html = renderHtml(panel.webview, context.extensionUri);

  panel.webview.onDidReceiveMessage((raw: unknown) => {
    handleMessage(panel, raw as WebviewMessage);
  });
}

function renderHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const distDir = vscode.Uri.joinPath(extensionUri, "webview-dist");
  const htmlPath = path.join(distDir.fsPath, "index.html");
  if (!fs.existsSync(htmlPath)) {
    return fallbackHtml(
      "Workspace bundle is missing — rebuild with <code>bun run build:vscode</code> from sigmashake-workspace.",
    );
  }

  const cspSource = webview.cspSource;
  const nonce = makeNonce();
  const appJs = webview.asWebviewUri(vscode.Uri.joinPath(distDir, "app.js")).toString();
  const appCss = webview.asWebviewUri(vscode.Uri.joinPath(distDir, "app.css")).toString();

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy"
          content="default-src 'none';
                   img-src ${cspSource} https: data:;
                   style-src ${cspSource} 'unsafe-inline';
                   font-src ${cspSource} data:;
                   script-src 'nonce-${nonce}';
                   connect-src 'none';" />
    <title>SigmaShake Workspace</title>
    <link rel="stylesheet" href="${appCss}" />
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${appJs}"></script>
  </body>
</html>`;
}

function fallbackHtml(message: string): string {
  return `<!doctype html><html><body style="font-family:system-ui;padding:24px;color:#ddd;background:#1e1e1e">
<h2>SigmaShake Workspace</h2><p>${message}</p>
</body></html>`;
}

function handleMessage(panel: vscode.WebviewPanel, msg: WebviewMessage): void {
  if (!msg || typeof msg !== "object") return;
  switch (msg.kind) {
    case "ready":
      panel.webview.postMessage({ kind: "config", config: snapshotConfig() });
      return;
    case "fetch":
      void proxyFetch(panel, msg);
      return;
    case "openExternal":
      if (typeof msg.url === "string") {
        void vscode.env.openExternal(vscode.Uri.parse(msg.url));
      }
      return;
  }
}

function snapshotConfig(): DaemonConfig {
  const settings = vscode.workspace.getConfiguration("sigmashake.workspace");
  const rawUrl = String(settings.get("daemonUrl") ?? "").replace(/\/+$/, "");
  return {
    daemonUrl: sanitizeDaemonUrl(rawUrl),
    daemonToken: String(settings.get("daemonToken") ?? ""),
    monorepoRoot: String(settings.get("monorepoRoot") ?? ""),
  };
}

// Strip configured daemon URLs that don't look safe: must be http or https,
// must have a host, and must be either a loopback address or an explicit
// allowlisted https hostname. This prevents a typo'd or attacker-supplied
// VS Code setting (e.g. via a malicious workspace `.vscode/settings.json`)
// from turning the extension into an SSRF tool that proxies the user's daemon
// token to a third-party host.
function sanitizeDaemonUrl(raw: string): string {
  if (!raw) return "";
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    void vscode.window.showWarningMessage(
      "sigmashake.workspace.daemonUrl is not a valid URL — daemon disabled until corrected.",
    );
    return "";
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    void vscode.window.showWarningMessage(
      `sigmashake.workspace.daemonUrl scheme must be http or https (got '${parsed.protocol}').`,
    );
    return "";
  }
  const host = parsed.hostname.toLowerCase();
  const isLoopback =
    host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  const isSigmashake = host === "sigmashake.com" || host.endsWith(".sigmashake.com");
  if (!isLoopback && !isSigmashake) {
    void vscode.window.showWarningMessage(
      `sigmashake.workspace.daemonUrl host '${host}' is not a loopback address or sigmashake.com subdomain — daemon disabled.`,
    );
    return "";
  }
  if (parsed.protocol === "http:" && !isLoopback) {
    void vscode.window.showWarningMessage(
      "sigmashake.workspace.daemonUrl must use https for non-loopback hosts.",
    );
    return "";
  }
  return parsed.origin + parsed.pathname.replace(/\/+$/, "");
}

async function proxyFetch(
  panel: vscode.WebviewPanel,
  msg: Extract<WebviewMessage, { kind: "fetch" }>,
): Promise<void> {
  const cfg = snapshotConfig();
  const target = resolveTarget(msg.url, cfg);
  if (!target) {
    panel.webview.postMessage({
      kind: "fetch:result",
      id: msg.id,
      ok: false,
      status: 0,
      body: JSON.stringify({
        error: "blocked",
        message:
          "The webview tried to reach a host the extension isn't configured to proxy. Set sigmashake.workspace.daemonUrl in settings.",
      }),
      headers: { "content-type": "application/json" },
    });
    return;
  }
  const init = msg.init ?? {};
  const headers = new Headers(init.headers ?? {});
  if (cfg.daemonToken && !headers.has("X-SigmaShake-Token")) {
    headers.set("X-SigmaShake-Token", cfg.daemonToken);
  }
  try {
    const res = await fetch(target, {
      method: init.method ?? "GET",
      headers,
      body: init.body,
    });
    const body = await res.text();
    const responseHeaders: Record<string, string> = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key] = value;
    });
    panel.webview.postMessage({
      kind: "fetch:result",
      id: msg.id,
      ok: res.ok,
      status: res.status,
      body,
      headers: responseHeaders,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    panel.webview.postMessage({
      kind: "fetch:result",
      id: msg.id,
      ok: false,
      status: 0,
      body: JSON.stringify({ error: "unreachable", message }),
      headers: { "content-type": "application/json" },
    });
  }
}

// Only allow the webview to proxy to the daemon base URL. Webview-issued
// requests come through as relative paths or with the daemon origin already
// applied; either way the resolved target must start with the configured
// daemon base. Anything else is rejected so a compromised bundle can't pivot
// the extension into an SSRF tool.
function resolveTarget(rawUrl: string, cfg: DaemonConfig): string | null {
  if (!cfg.daemonUrl) return null;
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;
  try {
    if (rawUrl.startsWith("/")) {
      return `${cfg.daemonUrl}${rawUrl}`;
    }
    const parsed = new URL(rawUrl);
    const base = new URL(cfg.daemonUrl);
    if (parsed.origin !== base.origin) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function makeNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let out = "";
  for (let i = 0; i < 32; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}
