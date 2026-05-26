// Tests for Option B (broadened scriptCandidates) and Option C (testKinds
// filesystem-detected resolution path) in the test-catalog builder.
//
// DO NOT modify — added by the options-b-c implementation agent.

import { describe, expect, it } from "vitest";
import type { ProjectCard } from "../src/client/api/types";
import { buildTestMatrix, TEST_CATALOG } from "../src/client/lib/test-catalog";

function card(scripts: string[], testKinds?: ProjectCard["testKinds"]): ProjectCard {
  return {
    slug: "sigmashake-demo",
    dir: "sigmashake-demo",
    type: "cf-worker",
    description: "",
    scripts,
    hasWranglerToml: true,
    hasClaudeMd: false,
    testKinds,
  };
}

// ── Option B: broadened scriptCandidates ─────────────────────────────────────

describe("Option B — new scriptCandidates match expected kinds", () => {
  const cases: Array<{ script: string; category: string; kindId: string }> = [
    // unit
    { script: "vitest", category: "functional", kindId: "unit" },
    { script: "bun:test", category: "functional", kindId: "unit" },
    // integration
    { script: "test:cf", category: "functional", kindId: "integration" },
    { script: "test:miniflare", category: "functional", kindId: "integration" },
    { script: "integration", category: "functional", kindId: "integration" },
    { script: "test:db", category: "functional", kindId: "integration" },
    // component
    { script: "test:smoke", category: "functional", kindId: "component" },
    { script: "smoke", category: "functional", kindId: "component" },
    { script: "test:component-tests", category: "functional", kindId: "component" },
    // e2e
    { script: "test:playwright", category: "functional", kindId: "e2e" },
    { script: "playwright", category: "functional", kindId: "e2e" },
    { script: "cypress", category: "functional", kindId: "e2e" },
    { script: "test:cypress", category: "functional", kindId: "e2e" },
    { script: "test:e2e-suite", category: "functional", kindId: "e2e" },
    // regression
    { script: "regression", category: "functional", kindId: "regression" },
    { script: "test:regression-suite", category: "functional", kindId: "regression" },
    // api
    { script: "test:openapi", category: "functional", kindId: "api" },
    { script: "test:routes", category: "functional", kindId: "api" },
    { script: "test:handlers", category: "functional", kindId: "api" },
    { script: "contract", category: "functional", kindId: "api" },
    { script: "test:rest", category: "functional", kindId: "api" },
    // load
    { script: "bench", category: "performance", kindId: "load" },
    { script: "benchmark", category: "performance", kindId: "load" },
    { script: "test:bench", category: "performance", kindId: "load" },
    // stress
    { script: "bench:stress", category: "performance", kindId: "stress" },
    // spike
    { script: "bench:spike", category: "performance", kindId: "spike" },
    { script: "chaos:spike", category: "performance", kindId: "spike" },
    // soak
    { script: "bench:soak", category: "performance", kindId: "soak" },
    { script: "endurance", category: "performance", kindId: "soak" },
    // scalability
    { script: "bench:scale", category: "performance", kindId: "scalability" },
    { script: "test:elastic", category: "performance", kindId: "scalability" },
    // chaos
    { script: "test:chaos-monkey", category: "resiliency", kindId: "chaos" },
    { script: "failover:chaos", category: "resiliency", kindId: "chaos" },
    // failover
    { script: "test:ha", category: "resiliency", kindId: "failover" },
    { script: "ha", category: "resiliency", kindId: "failover" },
    // dr
    { script: "test:backup", category: "resiliency", kindId: "dr" },
    { script: "backup:verify", category: "resiliency", kindId: "dr" },
    // configuration
    { script: "test:env", category: "resiliency", kindId: "configuration" },
    { script: "test:wrangler", category: "resiliency", kindId: "configuration" },
    { script: "test:mix-config", category: "resiliency", kindId: "configuration" },
    // sast
    { script: "lint:security", category: "security", kindId: "sast" },
    { script: "audit:sast", category: "security", kindId: "sast" },
    // dast
    { script: "audit:dast", category: "security", kindId: "dast" },
    { script: "test:probe", category: "security", kindId: "dast" },
    // pen
    { script: "audit:pen", category: "security", kindId: "pen" },
    // dependencies
    { script: "audit:cve", category: "security", kindId: "dependencies" },
    { script: "npm:audit", category: "security", kindId: "dependencies" },
    { script: "yarn:audit", category: "security", kindId: "dependencies" },
    { script: "bun:audit", category: "security", kindId: "dependencies" },
  ];

  for (const { script, category, kindId } of cases) {
    it(`script "${script}" → ${category}/${kindId} = unknown (configured)`, () => {
      const m = buildTestMatrix(card([script]), null);
      const cat = m.categories.find((c) => c.category === category);
      const result = cat?.results.find((r) => r.kindId === kindId);
      expect(result?.status).not.toBe("missing");
      expect(result?.script).toBe(script);
    });
  }
});

describe("Option B — no false positives: bare 'lint' does NOT trigger sast", () => {
  it('bare "lint" script does not configure sast', () => {
    const m = buildTestMatrix(card(["lint"]), null);
    const sast = m.categories
      .find((c) => c.category === "security")
      ?.results.find((r) => r.kindId === "sast");
    expect(sast?.status).toBe("missing");
  });
});

// ── Option C: testKinds filesystem-detected resolution ───────────────────────

describe("Option C — testKinds detected kinds render as 'unknown' when no script", () => {
  it("unit detected via testKinds with no scripts → status unknown", () => {
    const m = buildTestMatrix(card([], { unit: true }), null);
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("unknown");
    expect(unit?.script).toBeNull();
    expect(unit?.note).toMatch(/Detected by file pattern/);
  });

  it("e2e detected via testKinds with no scripts → status unknown", () => {
    const m = buildTestMatrix(card([], { e2e: true }), null);
    const e2e = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "e2e");
    expect(e2e?.status).toBe("unknown");
    expect(e2e?.note).toMatch(/wire a `test:e2e` script/);
  });

  it("sast detected via testKinds with no scripts → status unknown", () => {
    const m = buildTestMatrix(card([], { sast: true }), null);
    const sast = m.categories
      .find((c) => c.category === "security")
      ?.results.find((r) => r.kindId === "sast");
    expect(sast?.status).toBe("unknown");
    expect(sast?.note).toMatch(/Detected by file pattern/);
  });

  it("testKinds detection is still missing when kind not present in map", () => {
    // testKinds has unit=true but load is absent → load still missing
    const m = buildTestMatrix(card([], { unit: true }), null);
    const load = m.categories
      .find((c) => c.category === "performance")
      ?.results.find((r) => r.kindId === "load");
    expect(load?.status).toBe("missing");
  });

  it("script match takes precedence over testKinds — keeps original note format", () => {
    // If there's both a script and testKinds, script wins (note is about the script)
    const m = buildTestMatrix(card(["test:unit"], { unit: true }), null);
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.script).toBe("test:unit");
    expect(unit?.note).not.toMatch(/Detected by file pattern/);
  });

  it("multiple testKinds detected — each renders as unknown", () => {
    const m = buildTestMatrix(card([], { unit: true, integration: true, sast: true }), null);
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    const int = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "integration");
    const sast = m.categories
      .find((c) => c.category === "security")
      ?.results.find((r) => r.kindId === "sast");
    expect(unit?.status).toBe("unknown");
    expect(int?.status).toBe("unknown");
    expect(sast?.status).toBe("unknown");
    // totals should include them in unknown bucket
    expect(m.totals.unknown).toBeGreaterThanOrEqual(3);
  });

  it("no testKinds field → same behaviour as before (missing for no-script kinds)", () => {
    const m = buildTestMatrix(card([]), null);
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("missing");
  });

  it("empty testKinds object → no change (missing for no-script kinds)", () => {
    const m = buildTestMatrix(card([], {}), null);
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("missing");
  });
});

describe("Option C — totals still sum to 19 when testKinds in use", () => {
  it("total always equals 19 regardless of testKinds content", () => {
    const m = buildTestMatrix(card([], { unit: true, e2e: true }), null);
    const sum =
      m.totals.passing + m.totals.failing + m.totals.stale + m.totals.missing + m.totals.unknown;
    const totalKinds = TEST_CATALOG.reduce((n, c) => n + c.kinds.length, 0);
    expect(sum).toBe(totalKinds);
  });
});
