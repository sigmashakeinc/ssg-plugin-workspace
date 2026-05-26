// Tests for the build-registry filesystem scanner that populates testKinds
// on each ProjectCard (Option C, build-time path).
//
// DO NOT modify — added by the options-b-c implementation agent.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectTestKindsForDir } from "../src/build-registry";

let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "registry-test-kinds-"));
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function mkfile(path: string): void {
  const parts = path.split("/");
  let cur = tmpDir;
  for (const part of parts.slice(0, -1)) {
    cur = join(cur, part);
    mkdirSync(cur, { recursive: true });
  }
  writeFileSync(join(tmpDir, path), "// test placeholder");
}

describe("detectTestKindsForDir — no test files", () => {
  it("returns empty map when no test directory exists", () => {
    const result = detectTestKindsForDir(tmpDir);
    expect(result).toEqual({});
  });

  it("returns empty map when test/ is empty", () => {
    mkdirSync(join(tmpDir, "test"));
    const result = detectTestKindsForDir(tmpDir);
    expect(result).toEqual({});
  });

  it("returns empty map when test/ only has non-test files", () => {
    mkfile("test/helpers.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result).toEqual({});
  });
});

describe("detectTestKindsForDir — flat layout fallback → unit=true", () => {
  it("flat test/ with .test.ts files → unit=true", () => {
    mkfile("test/foo.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.unit).toBe(true);
  });

  it("flat __tests__/ with .spec.js files → unit=true", () => {
    mkfile("__tests__/bar.spec.js");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.unit).toBe(true);
  });

  it("flat test/ with Elixir _test.exs → unit=true", () => {
    mkfile("test/my_module_test.exs");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.unit).toBe(true);
  });
});

describe("detectTestKindsForDir — directory-name detection", () => {
  it("test/unit/ dir with test file → unit=true", () => {
    mkfile("test/unit/foo.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.unit).toBe(true);
  });

  it("test/integration/ dir → integration=true", () => {
    mkfile("test/integration/db.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.integration).toBe(true);
  });

  it("test/e2e/ dir → e2e=true", () => {
    mkfile("test/e2e/journey.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.e2e).toBe(true);
  });

  it("top-level e2e/ dir → e2e=true", () => {
    mkfile("e2e/smoke.spec.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.e2e).toBe(true);
  });

  it("test/api/ dir → api=true", () => {
    mkfile("test/api/routes.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.api).toBe(true);
  });

  it("test/bench/ dir (load alias) → load=true", () => {
    mkfile("test/bench/throughput.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.load).toBe(true);
  });

  it("test/ha/ dir (failover alias) → failover=true", () => {
    mkfile("test/ha/replica.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.failover).toBe(true);
  });

  it("test/audit/ dir (dependencies alias) → dependencies=true", () => {
    mkfile("test/audit/cve.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.dependencies).toBe(true);
  });

  it("test/config/ dir (configuration alias) → configuration=true", () => {
    mkfile("test/config/env.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.configuration).toBe(true);
  });

  it("test/scale/ dir (scalability alias) → scalability=true", () => {
    mkfile("test/scale/elastic.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.scalability).toBe(true);
  });

  it("test/disaster-recovery/ dir → dr=true", () => {
    mkfile("test/disaster-recovery/restore.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.dr).toBe(true);
  });

  it("multiple kind dirs → multiple kinds detected", () => {
    mkfile("test/unit/foo.test.ts");
    mkfile("test/integration/bar.test.ts");
    mkfile("test/e2e/baz.spec.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.unit).toBe(true);
    expect(result.integration).toBe(true);
    expect(result.e2e).toBe(true);
  });

  it("kind dir exists but is empty → no match for that kind", () => {
    // unit dir exists but has no test files — should not be detected
    mkdirSync(join(tmpDir, "test", "unit"), { recursive: true });
    // but flat test files do exist for the flat fallback
    mkfile("test/flat.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    // flat fallback kicks in since no kind-specific match was found in dirs
    // (unit dir is empty), but the flat file triggers unit via fallback
    expect(result.unit).toBe(true);
  });
});

describe("detectTestKindsForDir — suffix-based detection", () => {
  it("foo.unit.test.ts → unit=true", () => {
    mkfile("test/foo.unit.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.unit).toBe(true);
  });

  it("bar.integration.spec.js → integration=true", () => {
    mkfile("test/bar.integration.spec.js");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.integration).toBe(true);
  });

  it("foo.e2e.spec.tsx → e2e=true", () => {
    mkfile("test/foo.e2e.spec.tsx");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.e2e).toBe(true);
  });

  it("foo.sast.test.ts → sast=true", () => {
    mkfile("test/foo.sast.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.sast).toBe(true);
  });

  it("foo.dast.test.ts → dast=true", () => {
    mkfile("test/foo.dast.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.dast).toBe(true);
  });

  it("Elixir: my_unit_test.exs → unit=true", () => {
    mkfile("test/my_unit_test.exs");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.unit).toBe(true);
  });

  it("Elixir: auth_integration_test.exs → integration=true", () => {
    mkfile("test/auth_integration_test.exs");
    const result = detectTestKindsForDir(tmpDir);
    expect(result.integration).toBe(true);
  });
});

describe("detectTestKindsForDir — skips excluded directories", () => {
  it("node_modules test files are ignored", () => {
    mkfile("test/node_modules/evil.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result).toEqual({});
  });

  it("_build directory is ignored", () => {
    mkfile("test/_build/foo.test.ts");
    const result = detectTestKindsForDir(tmpDir);
    expect(result).toEqual({});
  });
});

describe("detectTestKindsForDir — error resilience", () => {
  it("returns empty map for a non-existent project dir", () => {
    const result = detectTestKindsForDir("/this/does/not/exist/at/all");
    expect(result).toEqual({});
  });
});
