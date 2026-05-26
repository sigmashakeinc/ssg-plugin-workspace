# SigmaShake Workspace

A visual monorepo browser for VS Code. Same React UI as the cloud surface at
[workspace.sigmashake.com](https://workspace.sigmashake.com), embedded directly
in the editor.

- **Browse** project cards from any `sigmashake-mono`-shaped monorepo.
- **Run** package.json scripts (lint, test, deploy) with live SSE log streaming.
- **Inspect** per-project health (git status, deploy gate, build/test mtime).
- **Edit** CLAUDE.md / wrangler.toml / package.json inline with CodeMirror.
- **Inbox** open support tickets + sales leads (cloud-only — opens in browser).

## Requirements

Run/Inspect/Edit need a local SigmaShake (ssg) daemon. Install via:

```
brew install sigmashake/tap/ssg
# or
curl -fsSL https://download.sigmashake.com/cli/install.sh | sh
```

Then start the daemon:

```
ssg serve
```

The extension defaults to `http://127.0.0.1:7901`. Configure the URL,
auth token, and monorepo root under **Settings → Extensions → SigmaShake
Workspace**. Without a reachable daemon, the panel falls back to Browse-only
("Open in SigmaShake Desktop" interstitials over Run/Inspect/Edit).

## Usage

`Cmd+Shift+P` → **SigmaShake: Open Workspace**.

## Links

- Source: https://github.com/sigmashake/sigmashake-mono/tree/main/sigmashake-workspace
- Cloud surface: https://workspace.sigmashake.com
- Docs: https://docs.sigmashake.com
