// Unit tests for the four-pillar certification gate in CertificationView.
// Verifies the tightened Tests pillar rule (tests_clean must be `ok` to pass,
// not just non-fail/missing) and the dimension-score → tone mapping that
// drives the new Tests N/100 pill in ServiceRow.

import { describe, expect, it } from "vitest";

import {
  buildTestsPillar,
  computePillars,
  dimTone,
  tierFromPillars,
} from "../src/client/components/CertificationView";
import type {
  CertDimension,
  CertDimensionId,
  CertReport,
  CertSignal,
  CertSignalState,
} from "../src/types";

// ── Fixture helpers ──────────────────────────────────────────────────────────

function signal(id: string, state: CertSignalState, label = id, note = ""): CertSignal {
  return { id, label, state, note };
}

function dim(id: CertDimensionId, score: number, signals: CertSignal[]): CertDimension {
  return { id, label: id, score, signals };
}

interface TestsOverride {
  configured?: CertSignalState;
  taxonomy?: CertSignalState;
  clean?: CertSignalState;
}

interface ReportOverride {
  slug?: string;
  tests?: TestsOverride;
  typesClean?: CertSignalState;
  testsScore?: number;
  /** Replace specific dimensions wholesale (overrides every other knob). */
  dimensions?: CertDimension[];
}

function makeReport(over: ReportOverride = {}): CertReport {
  const tests = over.tests ?? {};
  const dimensions: CertDimension[] = over.dimensions ?? [
    dim("source", 100, [
      signal("git_clean", "ok"),
      signal("git_sync", "ok"),
    ]),
    dim("format", 100, [
      signal("format_configured", "ok"),
      signal("format_clean", "ok"),
    ]),
    dim("lint", 100, [
      signal("lint_configured", "ok"),
      signal("lint_clean", "ok"),
    ]),
    dim("types", 100, [
      signal("types_configured", "ok"),
      signal("types_clean", over.typesClean ?? "ok"),
    ]),
    dim("tests", over.testsScore ?? 100, [
      signal("tests_configured", tests.configured ?? "ok"),
      signal("tests_taxonomy", tests.taxonomy ?? "ok"),
      signal("tests_clean", tests.clean ?? "ok"),
    ]),
    dim("security", 100, [
      signal("security_pkg_manager", "ok"),
      signal("security_no_env", "ok"),
      signal("security_audit", "ok"),
      signal("security_secrets", "ok"),
      signal("security_framework_manifest", "ok"),
      signal("security_owasp_web", "ok"),
      signal("security_owasp_llm", "ok"),
      signal("security_mitre_attack", "ok"),
      signal("security_mitre_d3fend", "ok"),
      signal("security_framework_review", "ok"),
    ]),
    dim("build", 100, [
      signal("build_configured", "ok"),
      signal("build_fresh", "ok"),
    ]),
    dim("deploy", 100, [
      signal("deploy_gate", "ok", "Deploy gate", "worker — gate cleared"),
      signal("deploy_recent", "ok"),
    ]),
  ];
  return {
    slug: over.slug ?? "fixture",
    generatedAt: Date.now(),
    score: 100,
    level: "gold",
    dimensions,
    cached: false,
  };
}

// ── Tests pillar gate (the change under test) ─────────────────────────────────

describe("buildTestsPillar — tightened tests_clean gate", () => {
  it("passes when tests_clean is ok", () => {
    const pillar = buildTestsPillar(makeReport({ tests: { clean: "ok" } }));
    expect(pillar.pass).toBe(true);
  });

  it("FAILS when tests_clean is unknown (never run)", () => {
    // Regression guard: pre-change, unknown was forgiven because the gate only
    // blocked fail/missing. Elixir projects without a `.last-test-result`
    // sentinel slipped through with a gold badge.
    const pillar = buildTestsPillar(makeReport({ tests: { clean: "unknown" } }));
    expect(pillar.pass).toBe(false);
  });

  it("FAILS when tests_clean is warn (stale >7d)", () => {
    // A passing-but-stale sentinel isn't "fully green" — the suite may have
    // rotted in the intervening week.
    const pillar = buildTestsPillar(makeReport({ tests: { clean: "warn" } }));
    expect(pillar.pass).toBe(false);
  });

  it("fails when tests_clean is fail", () => {
    const pillar = buildTestsPillar(makeReport({ tests: { clean: "fail" } }));
    expect(pillar.pass).toBe(false);
  });

  it("fails when tests_clean is missing", () => {
    const pillar = buildTestsPillar(makeReport({ tests: { clean: "missing" } }));
    expect(pillar.pass).toBe(false);
  });

  it("still gates on the configured signal (required)", () => {
    const pillar = buildTestsPillar(
      makeReport({ tests: { clean: "ok", configured: "missing" } }),
    );
    expect(pillar.pass).toBe(false);
  });

  it("forgives the optional taxonomy signal when only it is degraded", () => {
    // taxonomy is `required: false` in the pillar builder, so a warn/fail
    // there shouldn't sink the pillar provided the required pieces are ok.
    const pillar = buildTestsPillar(
      makeReport({ tests: { clean: "ok", taxonomy: "warn" } }),
    );
    expect(pillar.pass).toBe(true);
  });

  it("still includes all four criteria in the breakdown", () => {
    const pillar = buildTestsPillar(makeReport());
    const ids = pillar.criteria.map((c) => c.id).sort();
    expect(ids).toEqual(
      ["tests_clean", "tests_configured", "tests_taxonomy", "types_clean"].sort(),
    );
  });
});

// ── tierFromPillars ──────────────────────────────────────────────────────────

describe("tierFromPillars", () => {
  it("4 pillars = gold", () => {
    expect(tierFromPillars(4)).toBe("gold");
  });

  it("3 pillars = silver (gold demoted)", () => {
    expect(tierFromPillars(3)).toBe("silver");
  });

  it("2 pillars = silver", () => {
    expect(tierFromPillars(2)).toBe("silver");
  });

  it("1 pillar = bronze", () => {
    expect(tierFromPillars(1)).toBe("bronze");
  });

  it("0 pillars = unfit", () => {
    expect(tierFromPillars(0)).toBe("unfit");
  });
});

// ── dimTone (new — drives the Tests N/100 pill color) ────────────────────────

describe("dimTone — Tests dimension pill color thresholds", () => {
  it("100 → ok (green)", () => {
    expect(dimTone(100)).toBe("ok");
  });

  it("95 → ok (boundary)", () => {
    expect(dimTone(95)).toBe("ok");
  });

  it("94 → warn (amber, just below ok)", () => {
    expect(dimTone(94)).toBe("warn");
  });

  it("83 → warn (typical unknown-sentinel score)", () => {
    // (100 + 100 + 50) / 3 ≈ 83 — the score Elixir projects land on when
    // tests_clean is unknown. We expect amber, not green.
    expect(dimTone(83)).toBe("warn");
  });

  it("80 → warn (boundary)", () => {
    expect(dimTone(80)).toBe("warn");
  });

  it("79 → fail (red, just below warn)", () => {
    expect(dimTone(79)).toBe("fail");
  });

  it("67 → fail (typical tests_clean=fail score)", () => {
    // (100 + 100 + 0) / 3 ≈ 67 — what sigmashake-hub / sigmashake-obs land on
    // after a failed test run.
    expect(dimTone(67)).toBe("fail");
  });

  it("0 → fail", () => {
    expect(dimTone(0)).toBe("fail");
  });
});

// ── End-to-end pillar composition (verifies the demotion path) ────────────────

describe("computePillars + tierFromPillars — end-to-end demotion", () => {
  it("all-ok report → 4 pillars pass → gold", () => {
    const pillars = computePillars(makeReport());
    const passing = pillars.filter((p) => p.pass).length;
    expect(passing).toBe(4);
    expect(tierFromPillars(passing)).toBe("gold");
  });

  it("tests_clean=unknown alone drops gold → silver", () => {
    // The headline scenario: every other dimension is perfect, but the test
    // sentinel is unknown. Pre-change this was gold; post-change it must be
    // silver (3 pillars passing).
    const pillars = computePillars(
      makeReport({ tests: { clean: "unknown" }, testsScore: 83 }),
    );
    const passing = pillars.filter((p) => p.pass).length;
    expect(passing).toBe(3);
    expect(tierFromPillars(passing)).toBe("silver");
  });

  it("tests_clean=fail also lands at silver (3 pillars)", () => {
    const pillars = computePillars(
      makeReport({ tests: { clean: "fail" }, testsScore: 67 }),
    );
    expect(tierFromPillars(pillars.filter((p) => p.pass).length)).toBe("silver");
  });
});
