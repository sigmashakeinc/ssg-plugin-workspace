#!/usr/bin/env bun
// Wipes Vite/wrangler output dirs. Same pattern as
// sigmashake-electrobun/scripts/clean.ts — Bun-native so the script runs
// identically across linux/macos/windows hosts.
import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const TARGETS = [
  "public/assets",
  "dist-local",
  "dist-plugin",
  ".wrangler",
  "vscode/webview-dist",
  "vscode/out",
];

const opts = { recursive: true as const, force: true as const };

for (const rel of TARGETS) {
  const abs = join(ROOT, rel);
  if (existsSync(abs)) {
    console.log(`clean: removing ${rel}/`);
    rmSync(abs, opts);
  }
}
