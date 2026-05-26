// regression/registry-shape.test.ts — golden snapshot of wrangler.toml shape
// and build-registry.ts public contract for sigmashake-workspace.
// Runs in node environment; uses readFileSync (workerd has no host FS access).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const wrangler = readFileSync(join(root, "wrangler.toml"), "utf8");
const buildRegistry = readFileSync(join(root, "src", "build-registry.ts"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("wrangler.toml shape", () => {
  it("worker name is stable", () => {
    expect(wrangler).toContain('name = "sigmashake-workspace"');
  });

  it("main entrypoint is src/worker.ts", () => {
    expect(wrangler).toContain('main = "src/worker.ts"');
  });

  it("WORKSPACE_ENV=production var declared", () => {
    expect(wrangler).toContain('WORKSPACE_ENV = "production"');
  });

  it("run_worker_first=true for auth middleware", () => {
    expect(wrangler).toContain("run_worker_first = true");
  });

  it("ALLOWED_GITHUB_USER_IDS declared", () => {
    expect(wrangler).toContain("ALLOWED_GITHUB_USER_IDS");
  });

  it("ASSETS binding declared", () => {
    expect(wrangler).toContain('binding = "ASSETS"');
  });

  it("ACCOUNTS_SESSIONS KV declared", () => {
    expect(wrangler).toContain('binding = "ACCOUNTS_SESSIONS"');
  });

  it("custom_domain route for workspace.sigmashake.com", () => {
    expect(wrangler).toContain('pattern = "workspace.sigmashake.com"');
    expect(wrangler).toContain("custom_domain = true");
  });
});

describe("build-registry.ts contract", () => {
  it("TestKindId regression and configuration are tracked", () => {
    expect(buildRegistry).toContain("regression:");
    expect(buildRegistry).toContain("configuration:");
  });

  it("imports TestKindId from types", () => {
    expect(buildRegistry).toContain("TestKindId");
    expect(buildRegistry).toContain("./types");
  });

  it("KIND_DIRS covers all expected test categories", () => {
    const kinds = [
      "unit",
      "integration",
      "component",
      "e2e",
      "regression",
      "api",
      "load",
      "stress",
      "spike",
      "soak",
      "scalability",
      "chaos",
      "failover",
      "dr",
      "configuration",
      "sast",
      "dast",
      "pen",
      "dependencies",
    ];
    for (const kind of kinds) {
      expect(buildRegistry).toContain(`${kind}:`);
    }
  });
});

describe("package.json contract", () => {
  it("package name is stable", () => {
    expect(pkg.name).toMatchInlineSnapshot(`"sigmashake-workspace"`);
  });

  it("test:regression and test:configuration scripts wired", () => {
    expect(pkg.scripts["test:regression"]).toContain("regression");
    expect(pkg.scripts["test:configuration"]).toContain("configuration");
  });

  it("worker.ts is main entry in wrangler (not package.json main)", () => {
    // workspace is a CF Worker; no package.json "main" field needed
    expect(pkg.main).toBeUndefined();
  });
});
