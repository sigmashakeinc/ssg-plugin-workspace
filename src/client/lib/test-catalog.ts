// Canonical test taxonomy rendered by TestsPanel. The catalog is intentionally
// project-agnostic — every sigmashake-* service is measured against the same
// 4-category, 19-kind matrix so operators can see at a glance which test
// classes have coverage and which are still gaps.
//
// `scriptCandidates` is the heuristic that maps a kind onto the project's
// package.json scripts. The first candidate that exists in `ProjectCard.scripts`
// wins; if none match, the kind is reported as `missing` (i.e. not configured).

import type {
  HealthSummary,
  ProjectCard,
  TestCategoryId,
  TestCategoryResult,
  TestKindId,
  TestKindResult,
  TestMatrix,
  TestStatus,
} from "../api/types";
import type { TestRunRecord } from "./test-run-history";

/** Per-kind last-run snapshot keyed by `TestKindDef.id`. */
export type KindHistoryMap = Partial<Record<string, TestRunRecord>>;

export interface TestKindDef {
  id: string;
  label: string;
  /** One-sentence plain-English explanation. */
  description: string;
  /** package.json scripts that, if present, are taken to back this kind. */
  scriptCandidates: string[];
}

export interface TestCategoryDef {
  id: TestCategoryId;
  label: string;
  /** Short blurb shown under the category heading. */
  description: string;
  /** Lucide-ish single-glyph emoji for the section header. */
  icon: string;
  kinds: TestKindDef[];
}

export const TEST_CATALOG: TestCategoryDef[] = [
  {
    id: "functional",
    label: "Functional",
    description: "Does the service do what the business logic says it should do?",
    icon: "⚙️",
    kinds: [
      {
        id: "unit",
        label: "Unit tests",
        description: "Individual functions, methods, or classes verified in isolation.",
        scriptCandidates: ["test:unit", "test", "vitest", "bun:test"],
      },
      {
        id: "integration",
        label: "Integration tests",
        description:
          "Multiple modules — plus the database and any external APIs — exercised together.",
        scriptCandidates: [
          "test:integration",
          "test:int",
          "test:cf",
          "test:miniflare",
          "integration",
          "test:db",
        ],
      },
      {
        id: "component",
        label: "Component tests",
        description: "A single microservice or self-contained subsystem boot-to-handler.",
        scriptCandidates: [
          "test:component",
          "test:components",
          "test:smoke",
          "smoke",
          "test:component-tests",
        ],
      },
      {
        id: "e2e",
        label: "End-to-end tests",
        description: "Real user journeys driven across the entire system stack.",
        scriptCandidates: [
          "test:e2e",
          "e2e",
          "test:playwright",
          "playwright",
          "cypress",
          "test:cypress",
          "test:e2e-suite",
        ],
      },
      {
        id: "regression",
        label: "Regression tests",
        description: "Re-runs of existing suites so new commits can't quietly break old features.",
        scriptCandidates: [
          "test:regression",
          "test:regress",
          "regression",
          "test:regression-suite",
        ],
      },
      {
        id: "api",
        label: "API tests",
        description:
          "Endpoint inputs, outputs, status codes, and JSON schemas validated against the contract.",
        scriptCandidates: [
          "test:api",
          "test:contract",
          "test:openapi",
          "test:routes",
          "test:handlers",
          "contract",
          "test:rest",
        ],
      },
    ],
  },
  {
    id: "performance",
    label: "Performance & scalability",
    description: "Does the service stay fast and stable as traffic grows?",
    icon: "📈",
    kinds: [
      {
        id: "load",
        label: "Load tests",
        description: "Behavior under expected normal and peak user traffic.",
        scriptCandidates: ["test:load", "bench:load", "load", "bench", "benchmark", "test:bench"],
      },
      {
        id: "stress",
        label: "Stress tests",
        description: "Push the system past its limits to find the breaking point.",
        scriptCandidates: ["test:stress", "stress", "bench:stress"],
      },
      {
        id: "spike",
        label: "Spike tests",
        description: "Sudden, massive traffic surges — sustained or not.",
        scriptCandidates: ["test:spike", "spike", "bench:spike", "chaos:spike"],
      },
      {
        id: "soak",
        label: "Soak tests",
        description: "Steady load for hours or days, looking for memory leaks and resource drift.",
        scriptCandidates: ["test:soak", "soak", "test:endurance", "bench:soak", "endurance"],
      },
      {
        id: "scalability",
        label: "Scalability tests",
        description: "Measures auto-scaling — does adding capacity actually serve more traffic?",
        scriptCandidates: ["test:scale", "test:scalability", "bench:scale", "test:elastic"],
      },
    ],
  },
  {
    id: "resiliency",
    label: "Resiliency & infrastructure",
    description: "Does the service survive hardware, network, and cloud failures?",
    icon: "🛡️",
    kinds: [
      {
        id: "chaos",
        label: "Chaos engineering",
        description: "Deliberately kill processes or drop packets to test self-healing.",
        scriptCandidates: ["test:chaos", "chaos", "test:chaos-monkey", "failover:chaos"],
      },
      {
        id: "failover",
        label: "Failover tests",
        description: "Verify backup systems seamlessly take over when the primary crashes.",
        scriptCandidates: ["test:failover", "failover", "test:ha", "ha"],
      },
      {
        id: "dr",
        label: "Disaster recovery",
        description: "How fast can the entire system come back from a total blackout?",
        scriptCandidates: [
          "test:dr",
          "test:disaster-recovery",
          "dr",
          "test:backup",
          "backup:verify",
        ],
      },
      {
        id: "configuration",
        label: "Configuration tests",
        description: "Validates env vars and deployment scripts across every environment.",
        scriptCandidates: [
          "test:config",
          "test:configuration",
          "test:env",
          "test:wrangler",
          "test:mix-config",
        ],
      },
    ],
  },
  {
    id: "security",
    label: "Security & compliance",
    description: "Does the service protect user data and resist malicious attacks?",
    icon: "🔒",
    kinds: [
      {
        id: "sast",
        label: "SAST (static analysis)",
        description: "Scans uncompiled source for known security weaknesses without running it.",
        scriptCandidates: [
          "test:sast",
          "lint:sec",
          "security:static",
          "lint:security",
          "audit:sast",
        ],
      },
      {
        id: "dast",
        label: "DAST (dynamic analysis)",
        description: "Probes the running service for exploitable flaws — XSS, SQLi, etc.",
        scriptCandidates: ["test:dast", "security:dynamic", "audit:dast", "test:probe"],
      },
      {
        id: "pen",
        label: "Penetration testing",
        description: "Emulates human attackers attempting to breach the system.",
        scriptCandidates: ["test:pen", "test:pentest", "audit:pen"],
      },
      {
        id: "dependencies",
        label: "Dependency scanning",
        description: "Audits third-party libraries against the published CVE database.",
        scriptCandidates: [
          "test:audit",
          "audit",
          "audit:deps",
          "audit:cve",
          "npm:audit",
          "yarn:audit",
          "bun:audit",
        ],
      },
    ],
  },
];

const STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

// Compute the per-project matrix client-side. We use:
//   - `card.scripts` to detect which kinds are configured (script-name heuristic)
//   - the broad `test` sentinel from HealthSummary to colour the canonical
//     `unit` kind — that's the only kind the SSG daemon currently records
//   - per-kind localStorage run history (TestsPanel writes this after every
//     Run click) so every kind shows real pass/fail data once it's been run
//   - everything else falls to "unknown" when configured, "missing" otherwise
//
// Future: when the daemon grows per-kind sentinels (e.g. .last-test-result-load)
// this function can fold them in without touching the UI.
export function buildTestMatrix(
  card: ProjectCard,
  health: HealthSummary | null,
  kindHistory?: KindHistoryMap,
): TestMatrix {
  const scripts = new Set(card.scripts);
  const now = Date.now();
  const testKinds = card.testKinds;
  const categories: TestCategoryResult[] = TEST_CATALOG.map((cat) => ({
    category: cat.id,
    results: cat.kinds.map((kind) =>
      resolveKind(kind, scripts, health, cat.id, now, testKinds, kindHistory?.[kind.id]),
    ),
  }));
  const totals = tallyTotals(categories);
  return { slug: card.slug, generatedAt: now, categories, totals };
}

function resolveKind(
  kind: TestKindDef,
  scripts: Set<string>,
  health: HealthSummary | null,
  category: TestCategoryId,
  now: number,
  testKinds?: Partial<Record<string, boolean>>,
  lastRun?: TestRunRecord,
): TestKindResult {
  const script = kind.scriptCandidates.find((s) => scripts.has(s)) ?? null;
  if (!script) {
    // Option C: fall back to filesystem-detected kinds when no script matched.
    if (testKinds?.[kind.id] === true) {
      return {
        kindId: kind.id,
        status: "unknown",
        lastRunAt: null,
        script: null,
        note: `Detected by file pattern — wire a \`test:${kind.id}\` script to enable Run.`,
      };
    }
    return {
      kindId: kind.id,
      status: "missing",
      lastRunAt: null,
      script: null,
      note: `No \`${kind.scriptCandidates[0]}\` script in package.json — this test class isn't configured yet.`,
    };
  }
  // Per-kind sentinel from the SSG daemon — written after every
  // /workspace/run job whose script maps to this kind. Wins over the broad
  // sentinel + local history when present and at least as recent.
  // (kind.id is `string` in TestKindDef but every catalog entry's id is a
  // TestKindId; index via the narrower type so the Partial<Record<>> stays
  // typed without TS7053.)
  const kindSentinel = health?.lastTestByKind?.[kind.id as TestKindId] ?? null;
  // Legacy broad sentinel — historically only tracked the canonical `unit`
  // kind via `test` or `test:unit`. Kept as a fallback for projects whose
  // SSG daemon predates per-kind sentinels.
  const tracksBroadHealth =
    category === "functional" &&
    kind.id === "unit" &&
    (script === "test" || script === "test:unit");
  const broadHealthTs = tracksBroadHealth && health?.lastTestAt != null ? health.lastTestAt : null;
  const localTs = lastRun?.startedAt ?? null;
  const kindTs = kindSentinel?.at ?? null;
  // Pick the freshest signal we have. Per-kind sentinels are preferred when
  // tied with the broad sentinel — they were written by the same daemon for
  // this exact kind.
  const candidates: Array<{
    ts: number;
    source: "kind" | "broad" | "local";
  }> = [];
  if (kindTs != null) candidates.push({ ts: kindTs, source: "kind" });
  // The broad `.last-test-result` is a whole-suite verdict (fail if ANY kind
  // failed), and it is written last — so it is always the "freshest" signal.
  // Once a per-kind `unit` sentinel exists it is strictly more accurate; the
  // broad sentinel must not override it, or a failure in some *other* kind
  // would wrongly colour `unit` as failing too.
  if (broadHealthTs != null && kindSentinel == null)
    candidates.push({ ts: broadHealthTs, source: "broad" });
  if (localTs != null) candidates.push({ ts: localTs, source: "local" });
  candidates.sort((a, b) => {
    if (b.ts !== a.ts) return b.ts - a.ts;
    // Tie-break: kind > broad > local
    const rank = (s: "kind" | "broad" | "local") => (s === "kind" ? 0 : s === "broad" ? 1 : 2);
    return rank(a.source) - rank(b.source);
  });
  const winner = candidates[0];
  if (winner?.source === "kind" && kindSentinel) {
    return resolveFromKindSentinel(kind.id, script, kindSentinel, now);
  }
  if (winner?.source === "local" && lastRun) {
    return resolveFromLocal(kind.id, script, lastRun, now);
  }
  if (winner?.source === "broad" && health) {
    return resolveFromHealth(kind.id, script, health, winner.ts, now);
  }
  return {
    kindId: kind.id,
    status: "unknown",
    lastRunAt: null,
    script,
    note: `Configured (\`${script}\`) but no recorded run yet — hit Run to record a result.`,
  };
}

function resolveFromKindSentinel(
  kindId: string,
  script: string,
  sentinel: { at: number; ok: boolean | null },
  now: number,
): TestKindResult {
  const ts = sentinel.at;
  if (sentinel.ok === false) {
    return {
      kindId,
      status: "failing",
      lastRunAt: ts,
      script,
      note: `Last \`${script}\` run failed.`,
    };
  }
  if (sentinel.ok === true && now - ts <= STALE_AFTER_MS) {
    return {
      kindId,
      status: "passing",
      lastRunAt: ts,
      script,
      note: `Last \`${script}\` run passed.`,
    };
  }
  if (sentinel.ok === true) {
    return {
      kindId,
      status: "stale",
      lastRunAt: ts,
      script,
      note: `Last \`${script}\` run is older than a week — re-run to refresh.`,
    };
  }
  // ok === null (unreadable sentinel) — treat as unknown.
  return {
    kindId,
    status: "unknown",
    lastRunAt: ts,
    script,
    note: `Sentinel for \`${script}\` is unreadable — re-run to refresh.`,
  };
}

function resolveFromHealth(
  kindId: string,
  script: string,
  health: HealthSummary,
  ts: number,
  now: number,
): TestKindResult {
  if (health.lastTestOk === false) {
    return {
      kindId,
      status: "failing",
      lastRunAt: ts,
      script,
      note: `Last \`${script}\` run failed.`,
    };
  }
  if (health.lastTestOk === true && now - ts <= STALE_AFTER_MS) {
    return {
      kindId,
      status: "passing",
      lastRunAt: ts,
      script,
      note: `Last \`${script}\` run passed.`,
    };
  }
  return {
    kindId,
    status: "stale",
    lastRunAt: ts,
    script,
    note: `Last \`${script}\` run is older than a week — re-run to refresh.`,
  };
}

function resolveFromLocal(
  kindId: string,
  script: string,
  lastRun: TestRunRecord,
  now: number,
): TestKindResult {
  const ts = lastRun.startedAt;
  if (lastRun.exitCode !== 0) {
    return {
      kindId,
      status: "failing",
      lastRunAt: ts,
      script,
      note: `Last \`${script}\` run failed (exit ${lastRun.exitCode}).`,
    };
  }
  if (now - ts <= STALE_AFTER_MS) {
    return {
      kindId,
      status: "passing",
      lastRunAt: ts,
      script,
      note: `Last \`${script}\` run passed.`,
    };
  }
  return {
    kindId,
    status: "stale",
    lastRunAt: ts,
    script,
    note: `Last \`${script}\` run is older than a week — re-run to refresh.`,
  };
}

function tallyTotals(categories: TestCategoryResult[]): TestMatrix["totals"] {
  const totals: TestMatrix["totals"] = {
    passing: 0,
    failing: 0,
    stale: 0,
    missing: 0,
    unknown: 0,
  };
  for (const cat of categories) {
    for (const r of cat.results) {
      totals[r.status] += 1;
    }
  }
  return totals;
}

export function statusLabel(status: TestStatus): string {
  switch (status) {
    case "passing":
      return "Passing";
    case "failing":
      return "Failing";
    case "stale":
      return "Stale";
    case "missing":
      return "Not configured";
    case "unknown":
      return "Never run";
  }
}
