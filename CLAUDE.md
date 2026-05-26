# sigmashake-workspace — Agent Guide

Monorepo workspace UI. The same React/Vite codebase ships four ways:

1. **Cloud** — `workspace.sigmashake.com` (this Cloudflare Worker, Browse-only).
2. **Plugin** — Workspace packaged as an installable SSG plugin, mounted by the SSG daemon's plugin shell at `/plugins/workspace/`. This is the **canonical local surface** — there is no separate "/workspace" route anymore; workspace shares the plugin lifecycle (install / enable / disable / hot-swap) with every other SigmaShake plugin. `build:plugin` (→ `scripts/build-plugin.ts`) emits a single-file bundle to `dist-plugin/` and post-processes `index.html` to inject a bootstrap script that translates `window.__SSG_PLUGIN_CONFIG__` into `window.__WORKSPACE_CONFIG__`.
3. **Desktop** — bundled inside `sigmashake-electrobun` as a dedicated view.
4. **VS Code extension** — single `.vsix` artifact distributed two ways:
   a. **VS Code Marketplace** as publisher `sigmashake`, extension id `sigmashake.workspace` (primary, auto-updates via the editor).
   b. **GitHub Releases** asset on tag `workspace-vN.N.N` (secondary, for air-gapped installs via `code --install-extension <url>` or for users who avoid the Marketplace).

   Source lives in `vscode/`. The extension host loads the React bundle into a `vscode.WebviewPanel`, forwards `window.__WORKSPACE_CONFIG__` (port, token, root) via `webview.postMessage`, and proxies `fetch()` calls from the webview to the user-configured SSG daemon URL (default `http://127.0.0.1:7901`). Same CloudGate degradation as the cloud worker when the daemon is unreachable.

The runtime is picked at module load:
- Vite's `define` injects `WORKSPACE_RUNTIME = "cloud" | "local" | "electrobun" | "vscode" | "plugin"` per config. The `local` runtime is the in-app client implementation; the plugin shell sets it as `runtime: "local"` after synthesizing `__WORKSPACE_CONFIG__` from `__SSG_PLUGIN_CONFIG__`, so the plugin and local paths share the same fetch code.
- The electrobun + vscode + plugin runtimes all read `window.__WORKSPACE_CONFIG__` (port, token, root) so the SSG daemon can override port at serve time. The vscode runtime receives the config via `acquireVsCodeApi()` + `window.addEventListener('message')` from the extension host before first render; the plugin runtime gets `__WORKSPACE_CONFIG__` synthesized from `__SSG_PLUGIN_CONFIG__` by the `build-plugin.ts` bootstrap.

## Quick map

| Topic | File |
|---|---|
| Worker entry (Hono) | `src/worker.ts` |
| Shared types | `src/types.ts` |
| Build-time registry generator | `src/build-registry.ts` |
| Build-time infrastructure generator | `src/build-infrastructure.ts` |
| Build-time readiness generator | `src/build-readiness.ts` |
| Generated registry (do not edit) | `src/registry.generated.ts` |
| Generated infrastructure (do not edit) | `src/infrastructure.generated.ts` |
| Generated readiness snapshot (do not edit) | `src/readiness.generated.ts` |
| Cloud Vite build | `vite.config.ts` |
| Electrobun Vite build (single-file bundle, into `binaries/workspace/`) | `vite.electrobun.config.ts` |
| VS Code webview Vite build (single-file bundle, into `vscode/webview-dist/`) | `vite.vscode.config.ts` |
| Plugin Vite build (single-file bundle, into `dist-plugin/`) | `vite.plugin.config.ts` |
| Plugin build post-processor | `scripts/build-plugin.ts` |
| VS Code extension host entry | `vscode/src/extension.ts` |
| VS Code webview HTML shell | `vscode/src/webview.html` |
| VS Code extension manifest | `vscode/package.json` |
| API client factory | `src/client/api/client.ts` |
| Cloud client | `src/client/api/cloud.ts` |
| Local client (SSG daemon) | `src/client/api/local.ts` |
| Electrobun client | `src/client/api/electrobun.ts` |
| VS Code client | `src/client/api/vscode.ts` |
| React entry | `src/client/main.tsx` |
| Top-level layout | `src/client/App.tsx` |
| Agent CLI | `tools/workspace-cli.ts` |
| MCP server | `tools/workspace-mcp.ts` |

## Commands

| Command | Purpose |
|---|---|
| `bun run dev` | `wrangler dev` — local cloud Worker on `localhost:8787` |
| `bun run build:client` | Cloud Vite build → `public/` (Worker assets binding) |
| `bun run build:electrobun` | Single-file bundle → `../sigmashake-electrobun/binaries/workspace/` |
| `bun run build:vscode` | Webview single-file bundle → `vscode/webview-dist/` |
| `bun run build:plugin` | Single-file bundle → `dist-plugin/`, mounted at `/plugins/workspace/` by the SSG daemon plugin shell. **This is the canonical local build** — there is no separate `dist-local/` anymore. |
| `bun run build` | All four channel builds in sequence (client + electrobun + vscode + plugin) |
| `bun run package:vscode` | `bun run build:vscode && cd vscode && pnpm dlx @vscode/vsce package` → `vscode/sigmashake-workspace-<version>.vsix` |
| `bun run publish:vscode` | Guarded: requires `VSCE_PAT` + clean origin/main; runs `pnpm dlx @vscode/vsce publish` for the `sigmashake` publisher, then `gh release create workspace-v<version> vscode/*.vsix --notes-from-tag` to mirror the same `.vsix` to GitHub Releases |
| `bun run deploy` | Guarded `wrangler deploy` to `workspace.sigmashake.com` |
| `bun run typecheck` | Worker + client tsconfigs |
| `bun run test` | Vitest with `cloudflareTest` pool |
| `bun run clean` | Wipe Vite/wrangler output dirs (Bun script, not literal `rm`) |

`prebuild` and `predeploy` hooks regenerate `src/registry.generated.ts` from `../CLAUDE.md`'s `<structure>` block, `src/infrastructure.generated.ts` from wrangler configs, and `src/readiness.generated.ts` from `.sigmashake/production-readiness.json`. The cloud worker has no filesystem access, so all three ship baked into the build.

## Agent CLI & MCP server

Two zero-dependency Bun tools in `tools/` give agents a headless surface over
the workspace API (the SSG daemon's `/api/json/workspace/*` routes):

- `tools/workspace-cli.ts` — exposed as the `sigmashake-workspace` bin in
  `package.json`. Subcommands: `projects`, `health`, `context`, `ai-native`.
- `tools/workspace-mcp.ts` — a hand-rolled stdio MCP server (Model Context
  Protocol, JSON-RPC 2.0 over stdio) with read-only tools `list_projects`,
  `workspace_health`, and `ai_native_report`. Register it:

      { "mcpServers": { "sigmashake-workspace":
          { "command": "bun", "args": ["tools/workspace-mcp.ts"] } } }

Both read `WORKSPACE_BASE_URL` (default `http://127.0.0.1:7901`) and the
optional `WORKSPACE_TOKEN` (sent as the `X-SigmaShake-Token` header).

## Cloud degradation rule

The cloud worker is **operator-only** — every request passes through a `requireOperator` middleware (`src/worker.ts`) that validates the `session_id` cookie minted by `accounts.sigmashake.com` against an operator allowlist. Unauthenticated requests get `302` → `accounts.sigmashake.com/auth/login` (HTML) or `401 {"error":"unauthorized"}` (API). The rules below apply once authenticated.

A Cloudflare Worker cannot spawn processes or write a user's filesystem, so:
- `GET /api/workspace/projects` returns the static registry.
- `GET /api/workspace/readiness` (+ `/text`) returns a build-time snapshot of `.sigmashake/production-readiness.json`: manual + path-exists checks resolve at build time (durable for the bundle's lifetime), cert-signal checks ship as `unknown` with evidence pointing at SigmaShake Desktop for live data. `generatedAt` is rewritten per-request. Same `ReadinessResponse` shape as the SSG daemon's live endpoint, so the SPA renders identically against either runtime.
- `GET /api/workspace/health`, `POST /api/workspace/run`, `POST /api/workspace/edit` all return `501 local_only` with a message pointing at SigmaShake Desktop.
- The React app surfaces a `CloudGate` interstitial for Run/Inspect/Edit when `client.hasLocalCapabilities === false`.

The **Inbox** view inverts this rule — it is cloud-only because the bearer
tokens + service bindings live on the Worker. Local + electrobun runtimes
render an "Open in cloud" CTA from `InboxView.tsx` instead.

## Inbox view (support tickets + sales leads)

`GET /api/workspace/inbox` returns a unified snapshot of open support
tickets and recent sales leads — see `src/types.ts → InboxSnapshot`. Same
zone (`sigmashake.com`) HTTPS fetches get silently dropped (see
sigmashake-support's HUB binding gotcha), so this surface goes through
**service bindings only**:

| Binding | Target | Used for |
|---|---|---|
| `SUPPORT` | sigmashake-support | `GET /agent/tickets`, `POST /agent/tickets/:id/messages`, `POST /agent/tickets/:id/close`, `PATCH /agent/tickets/:id` |
| `SALES` | sigmashake-sales | `GET /agent/leads`, `PATCH /agent/leads/:id` |

Both targets require bearer auth (`SUPPORT_AGENT_TOKEN`, `SALES_AGENT_TOKEN`
secrets on this Worker). Provision:

```bash
# support — supplies inline reply/close/triage
cd ../sigmashake-support
bun scripts/seed-agent.ts --name workspace-inbox --scopes read,respond,resolve
# paste the printed token, then:
cd ../sigmashake-workspace
wrangler secret put SUPPORT_AGENT_TOKEN

# sales — shared secret, push the same value to both workers
token=$(openssl rand -hex 32)
echo "$token" | wrangler secret put SALES_AGENT_TOKEN
cd ../sigmashake-sales
echo "$token" | wrangler secret put SALES_AGENT_TOKEN
```

Mutation routes (`POST/PATCH /api/workspace/inbox/...`) safelist the request
body so a compromised SPA can't smuggle unexpected fields upstream. Each
proxy passes the upstream response through verbatim, including the status
code, so HTTP error semantics survive the round-trip.

## SSG daemon endpoints (consumed by the local + electrobun + plugin clients)

Registered in `sigmashake-gov/src/commands/serve.ts`. All routes are token-gated
by the daemon's `Router.handle()`; non-GET requests also require the dashboard
`X-SigmaShake-Token` header.

| Method | Path | Notes |
|---|---|---|
| `GET` | `/api/json/workspace/projects?root=<abs path>` | Returns `{root, projects: ProjectCard[]}` |
| `GET` | `/api/json/workspace/health?projects=<csv>` | Per-slug git status, deploy gate, build/test mtime |
| `GET` | `/api/json/workspace/attention-details?project=<>` | Per-project deep-dive; loaded only when an attention card is expanded (keeps `/health` cheap) |
| `POST` | `/api/json/workspace/ai-assign` | Records an AI dispatch intent → `~/.sigmashake/workspace-assignments.jsonl`. Does NOT spawn an agent |
| `POST` | `/api/json/workspace/run` | Body `{project, script}` — spawns `bun run <proj>:<script>`. Returns `{jobId}` |
| `GET` | `/api/json/workspace/run/:jobId/stream` | SSE — `data: {line, done, exitCode?}` |
| `POST` | `/api/json/workspace/run/:jobId/cancel` | SIGTERM the job |
| `GET` | `/api/json/workspace/test-report?project=<>` | Per-project `{reports, history}`. `reports`: structured per-kind reports (counts, per-test results + per-test failure reasons, durations, runner) from `.last-test-report-<kind>.json` — the latest run only. `history`: per-kind run-history trails from `.test-history-<kind>.jsonl` — one compact summary per run. Backs the Tests panel drill-down + the GitHub-style trend grid |
| `GET` | `/api/json/workspace/edit?project=<>&file=<>` | Returns `{content}` |
| `POST` | `/api/json/workspace/edit` | Body `{project, file, content}` — path-traversal guarded, 3-file whitelist |
| `POST` | `/api/json/workspace/create` | Scaffold/register a new monorepo project |
| `GET` | `/api/json/workspace/infrastructure` | Infrastructure registry snapshot (backs `infrastructure.generated.ts`) |
| `GET` | `/api/json/workspace/context` | Aggregated workspace context bundle for the UI shell |
| `GET` | `/api/json/workspace/distribution` | Distribution / release-channel state |
| `POST` | `/api/json/workspace/distribution/sync` | Trigger a distribution sync |
| `GET` | `/api/json/workspace/settings` | Read workspace settings |
| `PUT` | `/api/json/workspace/settings` | Write workspace settings |
| `GET` | `/api/json/workspace/fleet/status` | Fleet enrollment status (`src/shared/fleet-status.ts`) |
| `POST` | `/api/json/workspace/fleet/auto-enroll` | Auto-enroll this host into fleet |
| `GET` | `/api/json/workspace/certify` | SDLC certification result (JSON) |
| `GET` | `/api/json/workspace/certify/text` | SDLC certification result (plain text) |
| `GET` | `/api/json/workspace/certify/stream` | SSE — streaming certification run |
| `GET` | `/api/json/workspace/ai-native` | Per-service AI-native readiness + latency gauge (JSON) |
| `GET` | `/api/json/workspace/ai-native/text` | Same scorecard as a plain-text scorecard for agents to curl |

## AI Native view (agent-readiness + latency gauge)

`GET /api/json/workspace/ai-native` returns an `AiNativeResponse` — see
`src/types.ts → AiNativeReport`. The handler
(`sigmashake-gov/src/server/handlers/workspace-ai-native.ts`) gauges every
service on two orthogonal axes:

1. **AI-native capability** — five **artifact-verified** signals fold into a
   0-100 score and a tier (AI-Native / Capable / Partial / Opaque): agent docs
   (CLAUDE.md/AGENTS.md), a CLI (a `bin` target that exists, a `tools/*-cli.ts`,
   or an Elixir `bin/`), an MCP server (`src/mcp.ts` or `tools/*-mcp.ts`), a
   JSON API, and agent integration (skills / tools / `.rules`). Each signal is
   decided by a file on disk, not by prose in the docs — wording cannot move a
   signal. The `json-api` signal is architecture-aware: `na` (not applicable,
   excluded from the score) for a service that does not serve HTTP — a CLI
   tool's machine surface is its CLI + MCP server.
2. **Latency gauge** — every service carries a real measured latency.
   Measurement is done out-of-band by `sigmashake-gov/tools/ai-native-latency.ts`
   (`bun run ai-native:latency`), which loopback-probes a running local daemon
   or cold-spawns the service's MCP server / CLI, and writes
   `<root>/.ai-native-latency.json`; this handler reads that sentinel. `verdict`
   reports `meets` / `acceptable` / `slow` / `unmeasured`.

Cloud raises `local_only` (501) — the scan reads the operator's tree, which a
Worker cannot do. Local + electrobun + vscode runtimes hit the daemon. The
React surface is `AiNativeView.tsx`, rail entry "AI Native"; data flows
through the shared `WorkspaceCache` `aiNative` slice.

## Package manager policy (monorepo-wide — applies to Workspace UI too)

**npm is banned. `pnpm` is the required package manager for any npm-style operation across sigmashake-mono.** Bun stays the primary JS runtime + script runner (it is also a runtime, not just a package manager) — anywhere a script currently uses `bun run`, `bun src/foo.ts`, etc., keep it.

When something needs the npm CLI (`install -g`, `audit`, `publish`, `whoami`), use `pnpm` instead:

| Old | New |
|---|---|
| `npm install -g <pkg>` | `pnpm add -g <pkg>` |
| `npm i <pkg>` | `pnpm add <pkg>` |
| `npm install` | `pnpm install` |
| `npm run <script>` | `pnpm run <script>` (or `bun run`) |
| `npm audit` | `pnpm audit` |
| `npm publish` | `pnpm publish --no-git-checks` |
| `npm view`/`whoami`/`adduser` | `pnpm view` / `pnpm whoami` / `pnpm login` |

### Workspace UI specifics

- The `POST /api/json/workspace/run` endpoint spawns `bun run <proj>:<script>` against the monorepo's root `package.json`. **No change required** — those scripts continue to be `bun run`, and the Bun runtime stays in use. The pnpm rule applies to *npm CLI invocations*, not to Bun-as-a-runner.
- Health / detection: if a future detector inspects lockfiles, treat `bun.lock`, `bun.lockb`, and `pnpm-lock.yaml` as accepted package-manager fingerprints. `package-lock.json` (npm) is a regression — flag it.
- New project cards added to the monorepo registry must NOT shell out to `npm`. Use `bun` or `pnpm` exclusively. Surface a build-time warning if a sibling project ships a `package-lock.json`.

Enforcement: governance rule `prefer-bun-run-over-npm-run` (in `.gemini/policies/ssg-governance.toml`) catches `^npm run` at policy time. CI / agents should reject diffs that reintroduce `npm` commands.
