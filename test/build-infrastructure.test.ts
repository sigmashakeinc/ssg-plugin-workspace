// Unit tests for the three exported helpers in src/build-infrastructure.ts.
// Runs in vitest's node env (the module uses node:fs / node:path).

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  descriptionFor,
  findWranglerConfig,
  listProjects,
  MONO_ROOT,
} from "../src/build-infrastructure";
import { WRANGLER_FILENAMES } from "../src/lib/wrangler-parser";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmp(): string {
  return mkdtempSync(join(tmpdir(), "build-infra-test-"));
}

function touch(dir: string, filename: string, content = ""): void {
  writeFileSync(join(dir, filename), content);
}

// ---------------------------------------------------------------------------
// 1. findWranglerConfig
// ---------------------------------------------------------------------------

describe("findWranglerConfig", () => {
  it("finds wrangler.toml", () => {
    const dir = makeTmp();
    touch(dir, "wrangler.toml", 'name = "test"');
    const result = findWranglerConfig(dir);
    expect(result).toBe(join(dir, "wrangler.toml"));
    rmSync(dir, { recursive: true });
  });

  it("finds wrangler.jsonc", () => {
    const dir = makeTmp();
    touch(dir, "wrangler.jsonc", '{"name":"test"}');
    const result = findWranglerConfig(dir);
    expect(result).toBe(join(dir, "wrangler.jsonc"));
    rmSync(dir, { recursive: true });
  });

  it("finds wrangler.json", () => {
    const dir = makeTmp();
    touch(dir, "wrangler.json", '{"name":"test"}');
    const result = findWranglerConfig(dir);
    expect(result).toBe(join(dir, "wrangler.json"));
    rmSync(dir, { recursive: true });
  });

  it("returns null when no config exists", () => {
    const dir = makeTmp();
    expect(findWranglerConfig(dir)).toBeNull();
    rmSync(dir, { recursive: true });
  });

  it("prefers earlier entries in WRANGLER_FILENAMES order when multiple exist", () => {
    const dir = makeTmp();
    // Create all three — winner must be first in WRANGLER_FILENAMES.
    for (const f of WRANGLER_FILENAMES) {
      touch(dir, f, "{}");
    }
    const result = findWranglerConfig(dir);
    expect(result).toBe(join(dir, WRANGLER_FILENAMES[0]));
    rmSync(dir, { recursive: true });
  });
});

// ---------------------------------------------------------------------------
// 2. listProjects — real monorepo scan
// ---------------------------------------------------------------------------

describe("listProjects", () => {
  it("includes known worker projects", () => {
    const projects = listProjects(MONO_ROOT);
    expect(projects).toContain("sigmashake-web");
    expect(projects).toContain("sigmashake-hub");
    expect(projects).toContain("sigmashake-workspace");
  });

  it("excludes node_modules, .git, .claude, and shared", () => {
    const projects = listProjects(MONO_ROOT);
    expect(projects).not.toContain("node_modules");
    expect(projects).not.toContain(".git");
    expect(projects).not.toContain(".claude");
    expect(projects).not.toContain("shared");
  });

  it("returns a sorted array", () => {
    const projects = listProjects(MONO_ROOT);
    const sorted = [...projects].sort();
    expect(projects).toEqual(sorted);
  });
});

// ---------------------------------------------------------------------------
// 3. descriptionFor
// ---------------------------------------------------------------------------

describe("descriptionFor", () => {
  it("returns a non-empty string for sigmashake-web", () => {
    const desc = descriptionFor("sigmashake-web");
    expect(typeof desc).toBe("string");
    expect(desc.length).toBeGreaterThan(0);
  });

  it("returns empty string for unknown slugs", () => {
    expect(descriptionFor("does-not-exist-xyz")).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 4. main() — output file shape
// ---------------------------------------------------------------------------

const OUT_PATH = join(
  new URL("..", import.meta.url).pathname,
  "src",
  "infrastructure.generated.ts",
);

let originalContent: string | null = null;

beforeAll(() => {
  if (existsSync(OUT_PATH)) {
    originalContent = readFileSync(OUT_PATH, "utf8");
  }
});

afterAll(() => {
  if (originalContent !== null) {
    writeFileSync(OUT_PATH, originalContent, "utf8");
  } else if (existsSync(OUT_PATH)) {
    rmSync(OUT_PATH);
  }
});

describe("main() output file", () => {
  it("writes infrastructure.generated.ts with correct shape", () => {
    const result = spawnSync("bun", ["src/build-infrastructure.ts"], {
      cwd: new URL("..", import.meta.url).pathname,
      encoding: "utf8",
      timeout: 30000,
    });
    expect(result.status).toBe(0);

    expect(existsSync(OUT_PATH)).toBe(true);
    const content = readFileSync(OUT_PATH, "utf8");

    // Banner lines
    expect(content).toContain("// AUTO-GENERATED by src/build-infrastructure.ts");
    // Export declaration
    expect(content).toContain("export const INFRASTRUCTURE_GRAPH: InfraGraph = ");

    // Extract and parse the JSON payload
    const marker = "export const INFRASTRUCTURE_GRAPH: InfraGraph = ";
    const markerIdx = content.indexOf(marker);
    expect(markerIdx).toBeGreaterThan(-1);

    const jsonStr = content
      .slice(markerIdx + marker.length)
      .replace(/;\s*$/, "")
      .trim();
    let graph!: { nodes: unknown[]; edges: unknown[] };
    expect(() => {
      graph = JSON.parse(jsonStr) as { nodes: unknown[]; edges: unknown[] };
    }).not.toThrow();
    expect(Array.isArray(graph.nodes)).toBe(true);
    expect(Array.isArray(graph.edges)).toBe(true);
  });
});
