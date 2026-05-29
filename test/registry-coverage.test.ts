// Coverage guard: the generated project registry derives from the root
// CLAUDE.md <structure> block, which is hand-maintained. build-registry only
// *drops* bullets whose directory is gone (partitionByDirExistence) — it has
// no guard for the inverse: a service directory added to disk but never given
// a <structure> bullet is silently absent from the registry (and therefore
// from the cloud Distribution/Readiness surfaces). This test asserts the two
// stay in lockstep in both directions against the real monorepo tree.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { parseStructureBlock, partitionByDirExistence } from "../src/build-registry";

const HERE = dirname(fileURLToPath(import.meta.url)); // .../sigmashake-workspace/test
const MONO_ROOT = resolve(HERE, "..", "..");
const CLAUDE_MD = join(MONO_ROOT, "CLAUDE.md");

function onDiskServiceSlugs(root: string): string[] {
  return readdirSync(root)
    .filter((name) => name.startsWith("sigmashake-"))
    .filter((name) => {
      try {
        return statSync(join(root, name)).isDirectory();
      } catch {
        return false;
      }
    })
    .sort();
}

describe("registry coverage guard (real monorepo)", () => {
  // Only meaningful inside the monorepo checkout. If the root CLAUDE.md isn't
  // here, fail loudly — the guard can't see its source of truth.
  it("locates the monorepo root CLAUDE.md", () => {
    expect(existsSync(CLAUDE_MD)).toBe(true);
    expect(existsSync(join(MONO_ROOT, "sigmashake-gov"))).toBe(true);
  });

  it("every on-disk sigmashake-* service has a <structure> bullet", () => {
    const md = readFileSync(CLAUDE_MD, "utf8");
    const parsed = parseStructureBlock(md);
    // Precondition: the block parsed into real entries (not the empty-block
    // fallback). A zero-length parse means the <structure> block is missing or
    // malformed — itself a coverage failure worth surfacing.
    expect(parsed.length).toBeGreaterThan(0);

    const structureSlugs = new Set(parsed.map((p) => p.slug));
    const onDisk = onDiskServiceSlugs(MONO_ROOT);
    expect(onDisk.length).toBeGreaterThan(0);

    const unlisted = onDisk.filter((slug) => !structureSlugs.has(slug));
    expect(
      unlisted,
      `On-disk services missing from the root CLAUDE.md <structure> block: ${unlisted.join(", ")}. ` +
        `Add a "- \`<slug>/\` — <one-line>" bullet so they appear in the workspace registry.`,
    ).toEqual([]);
  });

  it("no <structure> bullet points at a directory that no longer exists", () => {
    const md = readFileSync(CLAUDE_MD, "utf8");
    const { missing } = partitionByDirExistence(parseStructureBlock(md), MONO_ROOT);
    const ghosts = missing.map((p) => p.slug);
    expect(
      ghosts,
      `Stale <structure> bullets (directory removed but bullet remains): ${ghosts.join(", ")}. ` +
        `Remove the bullet or restore the directory.`,
    ).toEqual([]);
  });
});
