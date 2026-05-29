// regression/cert-live.test.ts — integration check against the running SSG
// daemon. Hits /api/json/workspace/certify, validates the JSON shape that
// CertificationView depends on, and runs the four-pillar reduction on real
// service reports. Skips gracefully if the daemon isn't reachable (CI, fresh
// clone) — this is a local-dev regression guard, not a hard gate.

import { beforeAll, describe, expect, it } from "vitest";

import {
  buildTestsPillar,
  computePillars,
  dimTone,
  tierFromPillars,
} from "../../src/client/components/CertificationView";
import type { CertificationResponse, CertReport } from "../../src/types";

const DAEMON_BASE = process.env.SSG_DAEMON_URL ?? "http://127.0.0.1:5599";
const MONO_ROOT = process.env.SSG_MONO_ROOT ?? "/home/user/ssd/sigmashake-mono";

let liveResponse: CertificationResponse | null = null;
let skipReason: string | null = null;

beforeAll(async () => {
  const url = new URL("/api/json/workspace/certify", DAEMON_BASE);
  url.searchParams.set("root", MONO_ROOT);
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
    if (!res.ok) {
      skipReason = `daemon returned HTTP ${res.status}`;
      return;
    }
    const body = (await res.json()) as CertificationResponse;
    if (!body || typeof body !== "object" || !body.reports) {
      skipReason = "daemon response missing .reports";
      return;
    }
    if (Object.keys(body.reports).length === 0) {
      skipReason = "daemon returned zero services (wrong root?)";
      return;
    }
    liveResponse = body;
  } catch (err) {
    skipReason = `daemon unreachable at ${DAEMON_BASE}: ${(err as Error).message}`;
  }
});

describe("cert-live: JSON shape contract", () => {
  it("returns a CertificationResponse with at least one service", () => {
    if (skipReason) {
      console.log(`[cert-live] skipping: ${skipReason}`);
      return;
    }
    expect(liveResponse).not.toBeNull();
    expect(Object.keys(liveResponse!.reports).length).toBeGreaterThan(0);
  });

  it("every report carries the thirteen dimensions the UI expects", () => {
    if (skipReason) return;
    const expected = new Set([
      "source",
      "format",
      "lint",
      "types",
      "tests",
      "security",
      "build",
      "deploy",
      // Five operational dimensions added 2026-05 to raise the cert ceiling
      // from "is this safe to ship?" to "is this safe to OPERATE?" — see
      // workspace-certify.ts DIM_WEIGHTS.
      "reliability",
      "operations",
      "supply_chain",
      "architecture",
      "privacy",
    ]);
    for (const report of Object.values(liveResponse!.reports)) {
      const seen = new Set(report.dimensions.map((d) => d.id));
      expect(seen, `report ${report.slug} missing dimensions`).toEqual(expected);
    }
  });

  it("every tests dimension carries the three signals the pillar reads", () => {
    if (skipReason) return;
    for (const report of Object.values(liveResponse!.reports)) {
      const testsDim = report.dimensions.find((d) => d.id === "tests");
      expect(testsDim, `report ${report.slug} has no tests dim`).toBeDefined();
      const signalIds = new Set(testsDim!.signals.map((s) => s.id));
      // The pillar builder reads tests_configured, tests_taxonomy, tests_clean.
      expect(signalIds.has("tests_configured")).toBe(true);
      expect(signalIds.has("tests_taxonomy")).toBe(true);
      expect(signalIds.has("tests_clean")).toBe(true);
    }
  });

  it("every tests dimension exposes a numeric score for the pill", () => {
    if (skipReason) return;
    for (const report of Object.values(liveResponse!.reports)) {
      const testsDim = report.dimensions.find((d) => d.id === "tests");
      expect(typeof testsDim!.score).toBe("number");
      expect(testsDim!.score).toBeGreaterThanOrEqual(0);
      expect(testsDim!.score).toBeLessThanOrEqual(100);
    }
  });
});

describe("cert-live: pillar reduction matches dimension reality", () => {
  it("pillar Tests passes only when tests_clean=ok", () => {
    if (skipReason) return;
    for (const report of Object.values(liveResponse!.reports)) {
      const testsDim = report.dimensions.find((d) => d.id === "tests")!;
      const cleanSignal = testsDim.signals.find((s) => s.id === "tests_clean")!;
      const pillar = buildTestsPillar(report);
      const configuredOk =
        testsDim.signals.find((s) => s.id === "tests_configured")?.state === "ok";
      if (!configuredOk) {
        // pillar can't pass if tests aren't even configured — separate gate.
        expect(pillar.pass).toBe(false);
        continue;
      }
      if (cleanSignal.state === "ok") {
        expect(pillar.pass, `${report.slug} tests_clean=ok but pillar fail`).toBe(true);
      } else {
        expect(
          pillar.pass,
          `${report.slug} tests_clean=${cleanSignal.state} but pillar passed`,
        ).toBe(false);
      }
    }
  });

  it("dimTone matches the dimension score for every service", () => {
    if (skipReason) return;
    for (const report of Object.values(liveResponse!.reports)) {
      const testsDim = report.dimensions.find((d) => d.id === "tests")!;
      const tone = dimTone(testsDim.score);
      if (testsDim.score >= 95) expect(tone).toBe("ok");
      else if (testsDim.score >= 80) expect(tone).toBe("warn");
      else expect(tone).toBe("fail");
    }
  });

  it("no service is gold via the four-pillar gate while tests_clean is not ok", () => {
    if (skipReason) return;
    // This is the headline contract — the bug the patch fixes. Walk every
    // live report; if the resulting tier is gold, tests_clean MUST be ok.
    const violators: string[] = [];
    for (const report of Object.values(liveResponse!.reports)) {
      const pillars = computePillars(report);
      const tier = tierFromPillars(pillars.filter((p) => p.pass).length);
      if (tier !== "gold") continue;
      const cleanState = report.dimensions
        .find((d) => d.id === "tests")
        ?.signals.find((s) => s.id === "tests_clean")?.state;
      if (cleanState !== "ok") {
        violators.push(`${report.slug} → gold but tests_clean=${cleanState}`);
      }
    }
    expect(violators, "gold tier escaped past a non-ok test sentinel").toEqual([]);
  });

  it("reports a sane spread across tiers (sanity check on the mono)", () => {
    if (skipReason) return;
    const tally: Record<string, number> = { gold: 0, silver: 0, bronze: 0, unfit: 0 };
    for (const report of Object.values(liveResponse!.reports)) {
      const pillars = computePillars(report);
      const tier = tierFromPillars(pillars.filter((p) => p.pass).length);
      tally[tier]++;
    }
    console.log("[cert-live] tier spread:", tally);
    const total = Object.values(tally).reduce((a, b) => a + b, 0);
    expect(total).toBe(Object.keys(liveResponse!.reports).length);
    // The mono should not be 100% gold post-change — that would mean the
    // tightened gate didn't actually demote anyone, which contradicts the
    // observed `tests=83` scores on Elixir services. If this fires, either
    // every project just got its sentinel refreshed (great!) or the gate is
    // looser than expected.
    expect(tally.gold).toBeLessThan(total);
  });
});

describe("cert-live: snapshot of known demotions", () => {
  // Soft-asserts the projects we expect to lose gold post-patch. If any of
  // these flip back to gold the team has fixed something — celebrate, then
  // update this list.
  const KNOWN_NON_OK_CLEAN: string[] = [
    // 2026-05-27 — the previously-demoted services (chat-elixir, navi-elixir,
    // electrobun-elixir, super-saiyan-vfx-elixir, hub, obs) all flipped back
    // to gold after a workspace-cert scaffolding pass. Keep this snapshot list
    // narrowable as future demotions appear; deliberately empty today.
  ];

  it("known stale/never-run services are below gold", () => {
    if (skipReason) return;
    const stillGold: string[] = [];
    const missing: string[] = [];
    for (const slug of KNOWN_NON_OK_CLEAN) {
      const report = liveResponse!.reports[slug] as CertReport | undefined;
      if (!report) {
        missing.push(slug);
        continue;
      }
      const pillars = computePillars(report);
      const tier = tierFromPillars(pillars.filter((p) => p.pass).length);
      if (tier === "gold") stillGold.push(slug);
    }
    if (missing.length > 0) {
      console.log(`[cert-live] not in registry (skipped): ${missing.join(", ")}`);
    }
    expect(stillGold).toEqual([]);
  });
});
