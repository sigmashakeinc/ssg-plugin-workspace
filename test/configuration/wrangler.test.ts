// configuration/wrangler.test.ts — validate wrangler.toml configuration
// for sigmashake-workspace. Runs in node environment.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(import.meta.dirname, "..", "..");
const wrangler = readFileSync(join(root, "wrangler.toml"), "utf8");
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

describe("compatibility", () => {
  it("compat_date is after 2024-01-01", () => {
    const m = wrangler.match(/compatibility_date\s*=\s*"(\d{4}-\d{2}-\d{2})"/);
    expect(m).not.toBeNull();
    expect(new Date(m![1]) > new Date("2024-01-01")).toBe(true);
  });

  it("nodejs_compat flag present", () => {
    expect(wrangler).toContain("nodejs_compat");
  });
});

describe("assets binding", () => {
  it("assets directory is public", () => {
    expect(wrangler).toContain('directory = "public"');
  });

  it("run_worker_first is true (auth gate)", () => {
    expect(wrangler).toContain("run_worker_first = true");
  });
});

describe("secrets and security", () => {
  it("no hardcoded secret values in wrangler.toml", () => {
    // wrangler.toml must not contain raw secret patterns like tokens or API keys
    expect(wrangler).not.toMatch(/secret\s*=\s*"[A-Za-z0-9+/]{20,}"/);
  });

  it("ALLOWED_GITHUB_USER_IDS is a numeric var (operator id, not a secret)", () => {
    expect(wrangler).toContain("ALLOWED_GITHUB_USER_IDS");
    const m = wrangler.match(/ALLOWED_GITHUB_USER_IDS\s*=\s*"(\d+)"/);
    expect(m).not.toBeNull();
    expect(parseInt(m![1], 10)).toBeGreaterThan(0);
  });
});

describe("package.json scripts", () => {
  it("test script exists", () => {
    expect(pkg.scripts.test).toBeDefined();
  });

  it("typecheck script exists", () => {
    expect(pkg.scripts.typecheck).toBeDefined();
  });

  it("deploy script is guarded", () => {
    expect(pkg.scripts.deploy).toContain("deploy-guarded.sh");
  });

  it("prebuild regenerates registry", () => {
    // `prebuild` delegates to the `generate` script, which runs build-registry.ts.
    expect(pkg.scripts.prebuild).toBeDefined();
    const chain = `${pkg.scripts.prebuild} ${pkg.scripts.generate ?? ""}`;
    expect(chain).toContain("build-registry.ts");
  });
});
