#!/usr/bin/env bun
// Parses ../CLAUDE.md's <structure> block and emits
// src/registry.generated.ts — a typed PROJECTS_REGISTRY array consumed by the
// cloud Worker. The cloud has no filesystem so the registry is baked in at
// build time. The local + plugin runtimes ignore this file and call the
// SSG daemon's /api/json/workspace/projects endpoint instead.
//
// Run automatically by the `prebuild` / `predeploy` hooks in package.json.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { ProjectCard, ProjectType, TestKindId } from "./types";

// ── Filesystem test-kind detection (Option C, build-time) ────────────────────
// Mirrors the logic in sigmashake-gov/src/server/handlers/lib/detect-test-kinds.ts
// so the cloud baked registry also has testKinds populated.

const KIND_DIRS: Record<TestKindId, string[]> = {
  unit: ["unit"],
  integration: ["integration"],
  component: ["component"],
  e2e: ["e2e"],
  regression: ["regression"],
  api: ["api"],
  load: ["load", "bench"],
  stress: ["stress"],
  spike: ["spike"],
  soak: ["soak"],
  scalability: ["scalability", "scale"],
  chaos: ["chaos"],
  failover: ["failover", "ha"],
  dr: ["dr", "disaster-recovery"],
  configuration: ["configuration", "config"],
  sast: ["sast", "security/static"],
  dast: ["dast", "security/dynamic"],
  pen: ["pen", "pentest"],
  dependencies: ["dependencies", "audit"],
};

const KIND_SUFFIX: Record<TestKindId, string> = {
  unit: "unit",
  integration: "integration",
  component: "component",
  e2e: "e2e",
  regression: "regression",
  api: "api",
  load: "load",
  stress: "stress",
  spike: "spike",
  soak: "soak",
  scalability: "scalability",
  chaos: "chaos",
  failover: "failover",
  dr: "dr",
  configuration: "configuration",
  sast: "sast",
  dast: "dast",
  pen: "pen",
  dependencies: "dependencies",
};

const SKIP_DIRS = new Set(["node_modules", "_build", "target", ".git", "deps", "priv"]);
const TEST_ROOTS = ["test", "tests", "__tests__"];
const TEST_FILE_RE = /\.(test|spec)\.(ts|tsx|js|mjs|cjs)$|_test\.exs$/;

function listFilesSync(dir: string, maxDepth: number): string[] {
  if (maxDepth < 0) return [];
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (isDir) results.push(...listFilesSync(full, maxDepth - 1));
    else results.push(full);
  }
  return results;
}

function dirHasTestFilesSync(dir: string): boolean {
  return listFilesSync(dir, 1).some((f) => TEST_FILE_RE.test(f));
}

export function detectTestKindsForDir(projectDir: string): Partial<Record<TestKindId, boolean>> {
  const result: Partial<Record<TestKindId, boolean>> = {};
  const allTestFiles: string[] = [];
  for (const root of TEST_ROOTS) {
    const rootDir = join(projectDir, root);
    if (!existsSync(rootDir)) continue;
    try {
      if (!statSync(rootDir).isDirectory()) continue;
    } catch {
      continue;
    }
    allTestFiles.push(...listFilesSync(rootDir, 3));
  }
  // top-level e2e/
  const topE2e = join(projectDir, "e2e");
  if (existsSync(topE2e)) {
    try {
      if (statSync(topE2e).isDirectory()) allTestFiles.push(...listFilesSync(topE2e, 3));
    } catch {
      /* ignore */
    }
  }
  if (!allTestFiles.some((f) => TEST_FILE_RE.test(f))) return result;

  // Top-level dirs that are accepted per spec in addition to the test roots.
  // e2e: top-level e2e/ is explicitly allowed.
  const TOP_LEVEL_DIRS: Partial<Record<TestKindId, string[]>> = {
    e2e: ["e2e"],
  };

  let anyKindMatched = false;
  for (const id of Object.keys(KIND_DIRS) as TestKindId[]) {
    const dirs = KIND_DIRS[id];
    const suffix = KIND_SUFFIX[id];
    // Dir match — check inside test roots
    let dirMatch = false;
    for (const root of TEST_ROOTS) {
      for (const dirName of dirs) {
        const candidate = join(projectDir, root, dirName);
        if (existsSync(candidate)) {
          try {
            if (statSync(candidate).isDirectory() && dirHasTestFilesSync(candidate))
              dirMatch = true;
          } catch {
            /* ignore */
          }
        }
        if (dirMatch) break;
      }
      if (dirMatch) break;
    }
    // Dir match — also check top-level dirs for kinds that allow it (e.g. e2e)
    if (!dirMatch) {
      const topDirs = TOP_LEVEL_DIRS[id] ?? [];
      for (const dirName of topDirs) {
        const candidate = join(projectDir, dirName);
        if (existsSync(candidate)) {
          try {
            if (statSync(candidate).isDirectory() && dirHasTestFilesSync(candidate))
              dirMatch = true;
          } catch {
            /* ignore */
          }
        }
        if (dirMatch) break;
      }
    }
    if (dirMatch) {
      result[id] = true;
      anyKindMatched = true;
      continue;
    }
    // Suffix match
    const suffixRe = new RegExp(`\\.${suffix}\\.(test|spec)\\.(ts|tsx|js|mjs|cjs)$`);
    const elixirRe = new RegExp(`_${suffix}_test\\.exs$`);
    if (allTestFiles.some((f) => suffixRe.test(f) || elixirRe.test(f))) {
      result[id] = true;
      anyKindMatched = true;
    }
  }
  if (!anyKindMatched) result.unit = true;
  return result;
}

export function classify(slug: string, body: string): ProjectType {
  // Heuristic — same precedence the SSG daemon uses for live discovery, but
  // applied to the wording in CLAUDE.md rather than filesystem probes.
  if (/Cloudflare Worker|Cloudflare Workers|workers? for platforms?|cf worker/i.test(body))
    return "cf-worker";
  if (/Elixir|Phoenix|Mix release|BEAM/.test(body)) return "elixir";
  if (/Rust|Tauri|Cargo|wgpu|winit|native/i.test(body)) return "native";
  if (/Bun|npm package|TypeScript|node|pure JS/i.test(body)) return "bun";
  // Slug-based fallback for entries CLAUDE.md describes in oblique terms
  if (slug.endsWith("-elixir")) return "elixir";
  if (slug === "sigmashake-bop") return "bun";
  return "unknown";
}

export function parseStructureBlock(md: string): ProjectCard[] {
  const m = md.match(/<structure>([\s\S]*?)<\/structure>/);
  if (!m) {
    // The monorepo root CLAUDE.md (the "Agent Guide" format) carries Guardrails
    // and ops sections but no <structure> project list. A missing block is not
    // fatal — the cloud registry is a convenience surface, not a build input the
    // plugin or vscode bundles depend on. Warn and yield an empty registry so
    // the build doesn't hard-crash on it; the committed registry.generated.ts is
    // already empty, so this is behavior-preserving.
    console.warn("registry: CLAUDE.md has no <structure> block — emitting empty registry");
    return [];
  }
  const block = m[1]!;
  const lines = block.split("\n");
  const projects: ProjectCard[] = [];

  // Top-level bullets look like:
  //   - `sigmashake-foo/` — One-line description.
  // Continuation lines (sub-bullets) belong to the previous project.
  let current: ProjectCard | null = null;
  for (const raw of lines) {
    const top = raw.match(/^- `(sigmashake-[a-z0-9-]+)\/?` — (.+)$/);
    if (top) {
      const slug = top[1]!;
      const description = top[2]!.trim();
      current = {
        slug,
        dir: slug,
        type: classify(slug, description),
        description,
        scripts: [],
        hasWranglerToml: /Cloudflare Worker|Workers for Platforms/i.test(description),
        hasClaudeMd: false,
      };
      projects.push(current);
      continue;
    }
    if (current && /^\s+-\s/.test(raw)) {
      // Sub-bullet — typically a pointer to the project's own CLAUDE.md or README.
      if (/CLAUDE\.md/.test(raw)) current.hasClaudeMd = true;
      // Re-run classification against the longer body so cf-worker keywords on
      // sub-bullets can promote a project whose top line was generic.
      const combined = `${current.description} ${raw}`;
      const promoted = classify(current.slug, combined);
      if (current.type === "unknown" || current.type === "bun") {
        current.type = promoted;
      }
    } else {
      current = null;
    }
  }

  projects.sort((a, b) => a.slug.localeCompare(b.slug));
  return projects;
}

/**
 * Splits parsed <structure> entries by whether their directory exists on disk.
 * CLAUDE.md's <structure> block is hand-maintained, so a service directory can
 * be deleted while its bullet lingers. The cloud Worker ships this registry
 * baked in and has no filesystem to self-correct against — a ghost bullet would
 * be served as a live project forever. `main()` drops the `missing` set so the
 * generated registry can never carry a service the monorepo no longer contains.
 */
export function partitionByDirExistence(
  projects: ProjectCard[],
  monoRoot: string,
): { present: ProjectCard[]; missing: ProjectCard[] } {
  const present: ProjectCard[] = [];
  const missing: ProjectCard[] = [];
  for (const project of projects) {
    if (existsSync(join(monoRoot, project.slug))) present.push(project);
    else missing.push(project);
  }
  return { present, missing };
}

/**
 * Build-time augmentation: ground hasClaudeMd / hasWranglerToml against the
 * filesystem instead of relying on sub-bullets in the structure block. The
 * sub-bullet heuristic catches the legacy hand-curated entries, but the
 * regenerated <structure> block in this monorepo carries only top-level
 * bullets — leaving these booleans stuck at the parser's initial defaults.
 * Probing the filesystem is correct at build time (we have it) and irrelevant
 * at cloud runtime (the result is baked in).
 */
export function augmentFromFilesystem(projects: ProjectCard[], monoRoot: string): void {
  for (const project of projects) {
    const claudeMd = join(monoRoot, project.slug, "CLAUDE.md");
    if (existsSync(claudeMd)) project.hasClaudeMd = true;
    const wrangler = join(monoRoot, project.slug, "wrangler.toml");
    const wranglerJsonc = join(monoRoot, project.slug, "wrangler.jsonc");
    if (existsSync(wrangler) || existsSync(wranglerJsonc)) {
      project.hasWranglerToml = true;
    }
  }
}

function main() {
  const ROOT = resolve(import.meta.dir, "..");
  const MONO_ROOT = resolve(ROOT, "..");
  const CLAUDE_MD = join(ROOT, "..", "CLAUDE.md");
  const OUT = join(ROOT, "src", "registry.generated.ts");
  const md = readFileSync(CLAUDE_MD, "utf8");

  // Stale-entry guard — drop any <structure> bullet whose directory is gone
  // from disk before it can reach registry.generated.ts. Without this, removing
  // a service but forgetting to delete its CLAUDE.md bullet leaves a ghost card
  // in the cloud registry that the Worker has no way to detect or correct.
  const { present: projects, missing } = partitionByDirExistence(
    parseStructureBlock(md),
    MONO_ROOT,
  );
  if (missing.length > 0) {
    console.warn(
      `registry: dropped ${missing.length} stale <structure> ` +
        `entr${missing.length === 1 ? "y" : "ies"} — directory removed but ` +
        `CLAUDE.md bullet remains: ${missing.map((p) => p.slug).join(", ")}`,
    );
  }

  // Build-time augmentation — hasClaudeMd / hasWranglerToml from filesystem.
  augmentFromFilesystem(projects, MONO_ROOT);

  // Option C (build-time): scan each project directory for test files and
  // populate testKinds so the cloud baked registry carries filesystem detections.
  for (const project of projects) {
    const projectDir = join(MONO_ROOT, project.slug);
    if (existsSync(projectDir)) {
      try {
        const testKinds = detectTestKindsForDir(projectDir);
        if (Object.keys(testKinds).length > 0) {
          project.testKinds = testKinds;
        }
      } catch {
        // Non-fatal — skip testKinds for this project.
      }
    }
  }

  const banner =
    "// AUTO-GENERATED by src/build-registry.ts — do not edit.\n" +
    "// Re-run `bun run src/build-registry.ts` or `bun run prebuild`.\n\n";
  const body =
    "import type {ProjectCard} from './types';\n\n" +
    "export const PROJECTS_REGISTRY: ProjectCard[] = " +
    JSON.stringify(projects, null, 2) +
    ";\n";
  writeFileSync(OUT, banner + body);
  console.log(`registry: wrote ${projects.length} projects → src/registry.generated.ts`);
}

// Run only when invoked directly (e.g. `bun run src/build-registry.ts`). When
// the file is imported by the test suite, skip the filesystem side-effects.
if (import.meta.main) {
  main();
}
