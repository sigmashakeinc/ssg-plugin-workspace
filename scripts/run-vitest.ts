// scripts/run-vitest.ts — invoke vitest under Node, never Bun.
//
// `@cloudflare/vitest-pool-workers` opens a workerd↔pool websocket via the
// `ws` package, and Bun's `ws` shim doesn't implement the `upgrade` and
// `unexpected-response` events the pool relies on (you'll see two
// `[bun] Warning: ws.WebSocket … event is not implemented in bun` lines
// followed by `[vitest-pool]: Timeout starting cloudflare-pool runner.`).
//
// We resolve a real Node binary in this order:
//   1. $SIGMASHAKE_NODE — explicit override.
//   2. `~/.sigmashake/toolchain/node-v*/node[.exe]` — the monorepo's pinned Node.
//   3. The first `node` on PATH.
//
// Any extra argv after `bun run test` is forwarded ("--reporter=verbose" etc).

import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "..");
const VITEST_BIN = join(PROJECT_ROOT, "node_modules", "vitest", "vitest.mjs");

function findToolchainNode(): string | null {
  const dir = join(homedir(), ".sigmashake", "toolchain");
  if (!existsSync(dir)) return null;
  const entries = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith("node-v"))
    .map((e) => e.name)
    .sort()
    .reverse();
  for (const name of entries) {
    const exe = process.platform === "win32" ? "node.exe" : "node";
    const candidate = join(dir, name, exe);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveNode(): string {
  if (process.env.SIGMASHAKE_NODE && existsSync(process.env.SIGMASHAKE_NODE)) {
    return process.env.SIGMASHAKE_NODE;
  }
  const toolchain = findToolchainNode();
  if (toolchain) return toolchain;
  // Fall through to PATH — let the OS resolve.
  return "node";
}

const node = resolveNode();
const argv = process.argv.slice(2);
const forwarded = argv.length > 0 ? argv : ["run"];

const result = spawnSync(node, [VITEST_BIN, ...forwarded], {
  stdio: "inherit",
  cwd: PROJECT_ROOT,
  env: process.env,
});

if (result.error) {
  console.error(`[run-vitest] failed to spawn ${node}:`, result.error.message);
  process.exit(1);
}
process.exit(result.status ?? 1);
