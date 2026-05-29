# sigmashake-workspace

Monorepo workspace UI at `workspace.sigmashake.com` — a React/Vite SPA that ships
three ways (cloud Worker, SSG plugin, VS Code extension) for visual project
browsing, script running, health inspection, and inline editing. SigmaShake
Desktop renders Workspace through the plugin path, not as a separate bundled
view.

## What it does

Provides a visual interface for the sigmashake-mono monorepo: project card browser,
per-project health indicators (git status, deploy gate, build/test mtime), a script
runner with live SSE output streaming, and a path-guarded inline editor. The cloud
deployment at `workspace.sigmashake.com` is browse-only (Run/Inspect/Edit require a
local or Desktop runtime). The local and plugin runtimes connect to the SSG
daemon's `/api/json/workspace/*` endpoints for full capabilities. The runtime is
detected at module load via a Vite `define` constant.

## Quick start

```sh
cd sigmashake-workspace
bun install

bun run dev              # wrangler dev — cloud Worker on localhost:8787
bun run build:client     # Vite build → public/ (cloud deployment assets)
bun run build:plugin     # single-file bundle → dist-plugin/ (SSG daemon plugin shell at /plugins/workspace/)
bun run build:vscode     # webview single-file bundle → vscode/webview-dist/
bun run package:vscode   # produce vscode/*.vsix for sideloading + GitHub Releases
```

To deploy (commit + push first):

```sh
bun run deploy
```

## Architecture

Cloudflare Worker (TypeScript, Hono) + React 19 / Vite 8 SPA (CodeMirror 6 for
inline editing). Three Vite configs target three deployment modes (cloud, SSG
plugin, VS Code webview). The build registry (`src/build-registry.ts`) generates
a static project list from the monorepo `CLAUDE.md` `<structure>` block at build
time, since the cloud Worker has no filesystem access. Auth is validated against
the shared accounts session KV namespace; access is limited to allowed GitHub
user IDs.

## Links

- Production URL: https://workspace.sigmashake.com
- Internal docs: ./CLAUDE.md (agent guide), ../CLAUDE.md (monorepo overview)
