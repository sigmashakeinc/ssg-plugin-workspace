// Unit coverage for the TestsPanel matrix builder. The catalog itself is a
// pure constant; what we assert is the heuristic that maps package.json
// scripts onto each test kind plus the health sentinel folding for "unit".

import { describe, expect, it } from "vitest";
import type { HealthSummary, ProjectCard } from "../src/client/api/types";
import {
  buildTestMatrix,
  type KindHistoryMap,
  statusLabel,
  TEST_CATALOG,
} from "../src/client/lib/test-catalog";
import type { TestRunRecord } from "../src/client/lib/test-run-history";

const DAY_MS = 24 * 60 * 60 * 1000;

function card(scripts: string[]): ProjectCard {
  return {
    slug: "sigmashake-demo",
    dir: "sigmashake-demo",
    type: "cf-worker",
    description: "",
    scripts,
    hasWranglerToml: true,
    hasClaudeMd: false,
  };
}

function healthAt(lastTestAt: number, ok: boolean): HealthSummary {
  return {
    slug: "sigmashake-demo",
    gitDirty: false,
    gitAheadOriginMain: 0,
    gitBehindOriginMain: 0,
    deployGateOk: null,
    lastBuildAt: null,
    lastTestAt,
    lastTestOk: ok,
  };
}

describe("TEST_CATALOG shape", () => {
  it("has all four canonical categories", () => {
    expect(TEST_CATALOG.map((c) => c.id).sort()).toEqual([
      "functional",
      "performance",
      "resiliency",
      "security",
    ]);
  });

  it("every kind has at least one scriptCandidate", () => {
    for (const cat of TEST_CATALOG) {
      for (const kind of cat.kinds) {
        expect(kind.scriptCandidates.length).toBeGreaterThan(0);
      }
    }
  });

  it("kind ids are globally unique across categories", () => {
    const ids = TEST_CATALOG.flatMap((c) => c.kinds.map((k) => k.id));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("buildTestMatrix — missing scripts", () => {
  it('reports every kind as "missing" when scripts is empty', () => {
    const m = buildTestMatrix(card([]), null);
    expect(m.totals.missing).toBeGreaterThan(0);
    expect(m.totals.passing).toBe(0);
    expect(m.totals.failing).toBe(0);
    expect(m.totals.unknown).toBe(0);
    expect(m.totals.stale).toBe(0);
    for (const cat of m.categories) {
      for (const r of cat.results) {
        expect(r.status).toBe("missing");
        expect(r.script).toBeNull();
      }
    }
  });
});

describe("buildTestMatrix — configured but no health data", () => {
  it("unit becomes 'unknown' when `test` is present but no health summary exists", () => {
    const m = buildTestMatrix(card(["test"]), null);
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("unknown");
    expect(unit?.script).toBe("test");
  });

  it("non-unit kinds with a matching script also report 'unknown'", () => {
    const m = buildTestMatrix(card(["test:load"]), null);
    const load = m.categories
      .find((c) => c.category === "performance")
      ?.results.find((r) => r.kindId === "load");
    expect(load?.status).toBe("unknown");
    expect(load?.script).toBe("test:load");
  });
});

describe("buildTestMatrix — health folding for the unit kind", () => {
  it('reports "passing" when health.lastTestOk is true and recent', () => {
    const recent = Date.now() - 60 * 1000;
    const m = buildTestMatrix(card(["test"]), healthAt(recent, true));
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("passing");
    expect(unit?.lastRunAt).toBe(recent);
    expect(m.totals.passing).toBe(1);
  });

  it('reports "failing" when lastTestOk is false', () => {
    const recent = Date.now() - 60 * 1000;
    const m = buildTestMatrix(card(["test"]), healthAt(recent, false));
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("failing");
    expect(m.totals.failing).toBe(1);
  });

  it('reports "stale" when lastTestOk=true but >7 days old', () => {
    const old = Date.now() - 8 * DAY_MS;
    const m = buildTestMatrix(card(["test"]), healthAt(old, true));
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("stale");
    expect(m.totals.stale).toBe(1);
  });

  it("does NOT fold health onto other kinds (only `unit` reads the broad sentinel)", () => {
    const recent = Date.now() - 60 * 1000;
    const m = buildTestMatrix(card(["test", "test:load"]), healthAt(recent, true));
    const load = m.categories
      .find((c) => c.category === "performance")
      ?.results.find((r) => r.kindId === "load");
    // Load is configured but health-folding is unit-only — stays unknown.
    expect(load?.status).toBe("unknown");
  });
});

describe("buildTestMatrix — totals", () => {
  it("sums each status bucket across every kind", () => {
    const recent = Date.now() - 60 * 1000;
    const m = buildTestMatrix(card(["test", "test:load"]), healthAt(recent, true));
    const sum =
      m.totals.passing + m.totals.failing + m.totals.stale + m.totals.missing + m.totals.unknown;
    const totalKinds = TEST_CATALOG.reduce((n, c) => n + c.kinds.length, 0);
    expect(sum).toBe(totalKinds);
  });
});

describe("statusLabel", () => {
  it("renders each status to a plain-English label", () => {
    expect(statusLabel("passing")).toBe("Passing");
    expect(statusLabel("failing")).toBe("Failing");
    expect(statusLabel("stale")).toBe("Stale");
    expect(statusLabel("missing")).toBe("Not configured");
    expect(statusLabel("unknown")).toBe("Never run");
  });
});

function runRecord(startedAt: number, exitCode: number): TestRunRecord {
  return {
    startedAt,
    endedAt: startedAt + 1000,
    duration: 1000,
    exitCode,
    command: "bun run demo:test",
    stderrTail: exitCode === 0 ? [] : ["error: it broke"],
  };
}

describe("buildTestMatrix — per-kind local history folding", () => {
  it('non-unit kind with a successful local run shows "passing"', () => {
    const recent = Date.now() - 60 * 1000;
    const history: KindHistoryMap = { load: runRecord(recent, 0) };
    const m = buildTestMatrix(card(["test:load"]), null, history);
    const load = m.categories
      .find((c) => c.category === "performance")
      ?.results.find((r) => r.kindId === "load");
    expect(load?.status).toBe("passing");
    expect(load?.lastRunAt).toBe(recent);
    expect(load?.note).toMatch(/Last `test:load` run passed/);
  });

  it('non-unit kind with a failed local run shows "failing"', () => {
    const recent = Date.now() - 60 * 1000;
    const history: KindHistoryMap = { sast: runRecord(recent, 1) };
    const m = buildTestMatrix(card(["test:sast"]), null, history);
    const sast = m.categories
      .find((c) => c.category === "security")
      ?.results.find((r) => r.kindId === "sast");
    expect(sast?.status).toBe("failing");
    expect(sast?.note).toMatch(/exit 1/);
  });

  it('local run older than 7 days renders as "stale"', () => {
    const old = Date.now() - 8 * DAY_MS;
    const history: KindHistoryMap = { e2e: runRecord(old, 0) };
    const m = buildTestMatrix(card(["test:e2e"]), null, history);
    const e2e = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "e2e");
    expect(e2e?.status).toBe("stale");
    expect(e2e?.lastRunAt).toBe(old);
  });

  it("does NOT grade kinds with no script (still missing) even when history exists", () => {
    const recent = Date.now() - 60 * 1000;
    const history: KindHistoryMap = { load: runRecord(recent, 0) };
    // No `test:load` (or any load script) configured.
    const m = buildTestMatrix(card([]), null, history);
    const load = m.categories
      .find((c) => c.category === "performance")
      ?.results.find((r) => r.kindId === "load");
    expect(load?.status).toBe("missing");
  });

  it("unit kind prefers the more recent of (health sentinel, local history)", () => {
    const old = Date.now() - 2 * DAY_MS;
    const recent = Date.now() - 60 * 1000;
    // Health says the broad sentinel ran 2 days ago (passing), but local
    // history says we just re-ran it 60s ago. Pick local.
    const history: KindHistoryMap = { unit: runRecord(recent, 0) };
    const m = buildTestMatrix(card(["test"]), healthAt(old, true), history);
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("passing");
    expect(unit?.lastRunAt).toBe(recent);
  });

  it("unit kind falls back to health when no local history exists", () => {
    const recent = Date.now() - 60 * 1000;
    const m = buildTestMatrix(card(["test"]), healthAt(recent, false), {});
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("failing");
    expect(unit?.lastRunAt).toBe(recent);
  });

  it("undefined kindHistory leaves all non-unit kinds at unknown (backward compat)", () => {
    const m = buildTestMatrix(card(["test:load", "test:e2e", "test:sast"]), null);
    const counts = m.categories
      .flatMap((c) => c.results)
      .filter((r) => r.status === "unknown" && r.script !== null);
    expect(counts.length).toBe(3);
  });

  it("totals still sum to the full catalog when history is mixed in", () => {
    const recent = Date.now() - 60 * 1000;
    const history: KindHistoryMap = {
      load: runRecord(recent, 0),
      sast: runRecord(recent, 1),
    };
    const m = buildTestMatrix(
      card(["test", "test:load", "test:sast"]),
      healthAt(recent, true),
      history,
    );
    const sum =
      m.totals.passing + m.totals.failing + m.totals.stale + m.totals.missing + m.totals.unknown;
    const totalKinds = TEST_CATALOG.reduce((n, c) => n + c.kinds.length, 0);
    expect(sum).toBe(totalKinds);
    expect(m.totals.passing).toBeGreaterThanOrEqual(2); // unit (health) + load (local)
    expect(m.totals.failing).toBeGreaterThanOrEqual(1); // sast (local)
  });
});

// Per-kind sentinels written by the SSG daemon's /workspace/run handler.
// These are the primary source of truth — the broad sentinel only ever
// covered the `unit` kind, so the per-kind sentinels are what makes the
// rest of the matrix come alive after a `bun run <slug>:<kind>` finishes.

function healthWithKinds(
  byKind: Partial<Record<string, { at: number; ok: boolean | null }>>,
  broad?: { lastTestAt: number; lastTestOk: boolean | null },
): HealthSummary {
  return {
    slug: "sigmashake-demo",
    gitDirty: false,
    gitAheadOriginMain: 0,
    gitBehindOriginMain: 0,
    deployGateOk: null,
    lastBuildAt: null,
    lastTestAt: broad?.lastTestAt ?? null,
    lastTestOk: broad?.lastTestOk ?? null,
    lastTestByKind: byKind,
  };
}

describe("buildTestMatrix — per-kind sentinel folding", () => {
  it("flips a non-unit kind to 'passing' when its per-kind sentinel is recent + ok", () => {
    const recent = Date.now() - 60 * 1000;
    const m = buildTestMatrix(
      card(["test:load"]),
      healthWithKinds({ load: { at: recent, ok: true } }),
    );
    const load = m.categories
      .find((c) => c.category === "performance")
      ?.results.find((r) => r.kindId === "load");
    expect(load?.status).toBe("passing");
    expect(load?.lastRunAt).toBe(recent);
    expect(load?.note).toMatch(/Last `test:load` run passed/);
  });

  it("flips a kind to 'failing' when its per-kind sentinel is ok=false", () => {
    const recent = Date.now() - 60 * 1000;
    const m = buildTestMatrix(
      card(["test:chaos"]),
      healthWithKinds({ chaos: { at: recent, ok: false } }),
    );
    const chaos = m.categories
      .find((c) => c.category === "resiliency")
      ?.results.find((r) => r.kindId === "chaos");
    expect(chaos?.status).toBe("failing");
  });

  it("marks the kind as 'stale' when the per-kind sentinel is older than 7 days", () => {
    const old = Date.now() - 8 * DAY_MS;
    const m = buildTestMatrix(
      card(["test:integration"]),
      healthWithKinds({ integration: { at: old, ok: true } }),
    );
    const integration = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "integration");
    expect(integration?.status).toBe("stale");
  });

  it("per-kind sentinel wins over broad sentinel for the unit kind when newer", () => {
    const olderBroad = Date.now() - 2 * DAY_MS;
    const newerKind = Date.now() - 60 * 1000;
    const m = buildTestMatrix(
      card(["test"]),
      healthWithKinds(
        { unit: { at: newerKind, ok: true } },
        { lastTestAt: olderBroad, lastTestOk: false },
      ),
    );
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("passing");
    expect(unit?.lastRunAt).toBe(newerKind);
  });

  it("per-kind unit sentinel wins over a newer broad sentinel", () => {
    // The broad `.last-test-result` is a whole-suite verdict (fail if ANY kind
    // failed). Once a per-kind `unit` sentinel exists it is authoritative — the
    // broad sentinel must not override it, even when the broad sentinel is
    // newer. Otherwise a failure in some other kind wrongly marks unit failing.
    const newerBroad = Date.now() - 60 * 1000;
    const olderKind = Date.now() - 2 * DAY_MS;
    const m = buildTestMatrix(
      card(["test"]),
      healthWithKinds(
        { unit: { at: olderKind, ok: true } },
        { lastTestAt: newerBroad, lastTestOk: false },
      ),
    );
    const unit = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "unit");
    expect(unit?.status).toBe("passing");
    expect(unit?.lastRunAt).toBe(olderKind);
  });

  it("per-kind sentinel still wins when broad sentinel exists but the kind is non-unit", () => {
    const recent = Date.now() - 60 * 1000;
    const m = buildTestMatrix(
      card(["test", "test:e2e"]),
      healthWithKinds({ e2e: { at: recent, ok: true } }, { lastTestAt: recent, lastTestOk: true }),
    );
    const e2e = m.categories
      .find((c) => c.category === "functional")
      ?.results.find((r) => r.kindId === "e2e");
    expect(e2e?.status).toBe("passing");
  });

  it("unreadable per-kind sentinel (ok=null) renders as 'unknown' with a hint", () => {
    const recent = Date.now() - 60 * 1000;
    const m = buildTestMatrix(
      card(["test:sast"]),
      healthWithKinds({ sast: { at: recent, ok: null } }),
    );
    const sast = m.categories
      .find((c) => c.category === "security")
      ?.results.find((r) => r.kindId === "sast");
    expect(sast?.status).toBe("unknown");
    expect(sast?.note).toMatch(/unreadable/);
  });

  it("per-kind sentinel wins over older local-history record", () => {
    const olderLocal = Date.now() - 2 * DAY_MS;
    const newerKind = Date.now() - 60 * 1000;
    const history: KindHistoryMap = { load: runRecord(olderLocal, 0) };
    const m = buildTestMatrix(
      card(["test:load"]),
      healthWithKinds({ load: { at: newerKind, ok: false } }),
      history,
    );
    const load = m.categories
      .find((c) => c.category === "performance")
      ?.results.find((r) => r.kindId === "load");
    expect(load?.status).toBe("failing");
    expect(load?.lastRunAt).toBe(newerKind);
  });

  it("local history wins when it is newer than the per-kind sentinel", () => {
    const olderKind = Date.now() - 2 * DAY_MS;
    const newerLocal = Date.now() - 60 * 1000;
    const history: KindHistoryMap = { load: runRecord(newerLocal, 0) };
    const m = buildTestMatrix(
      card(["test:load"]),
      healthWithKinds({ load: { at: olderKind, ok: false } }),
      history,
    );
    const load = m.categories
      .find((c) => c.category === "performance")
      ?.results.find((r) => r.kindId === "load");
    expect(load?.status).toBe("passing");
    expect(load?.lastRunAt).toBe(newerLocal);
  });

  it("totals still sum to the full catalog with per-kind sentinels mixed in", () => {
    const recent = Date.now() - 60 * 1000;
    const m = buildTestMatrix(
      card(["test", "test:load", "test:chaos", "test:sast"]),
      healthWithKinds(
        {
          unit: { at: recent, ok: true },
          load: { at: recent, ok: true },
          chaos: { at: recent, ok: false },
          sast: { at: recent - 8 * DAY_MS, ok: true },
        },
        { lastTestAt: recent, lastTestOk: true },
      ),
    );
    const sum =
      m.totals.passing + m.totals.failing + m.totals.stale + m.totals.missing + m.totals.unknown;
    const totalKinds = TEST_CATALOG.reduce((n, c) => n + c.kinds.length, 0);
    expect(sum).toBe(totalKinds);
    expect(m.totals.passing).toBeGreaterThanOrEqual(2); // unit + load
    expect(m.totals.failing).toBeGreaterThanOrEqual(1); // chaos
    expect(m.totals.stale).toBeGreaterThanOrEqual(1); // sast (>7d)
  });
});
