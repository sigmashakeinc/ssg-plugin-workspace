// Monorepo-wide SDLC certification dashboard. Evaluates every project across
// four explicit pillars: Configuration, Tests, Deployment Readiness, and
// Compliance. A tier (Unfit / Bronze / Silver / Gold) is awarded based on the
// number of passing pillars (0=Unfit, 1=Bronze, 2-3=Silver, 4=Gold).
//
// Data source: CertReport from the shared WorkspaceCacheProvider or SSE stream.
// The four-pillar model is computed client-side by extracting relevant signals
// from the existing CertDimension set (source, format, lint, types, tests,
// security, build, deploy). No API changes are required.

import { useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type {
  CertDimension,
  CertDimensionId,
  CertificationResponse,
  CertLevel,
  CertReport,
  CertSignal,
  CertSignalState,
} from "../api/types";
import { friendlyError } from "../lib/errors";
import { useWorkspaceCache } from "../lib/workspace-cache";
import { ProgressStrip } from "./ProgressStrip";

interface Props {
  client: WorkspaceApiClient | null;
  root: string;
}

// ── Pillar model ──────────────────────────────────────────────────────────────

export type PillarId = "configuration" | "tests" | "deployment" | "compliance";

export interface PillarCriterion {
  id: string;
  label: string;
  state: CertSignalState;
  note: string;
  fix?: string;
  /** When true this criterion must pass for the pillar to pass. */
  required: boolean;
}

export interface Pillar {
  id: PillarId;
  label: string;
  /** True when every required criterion is ok or warn. */
  pass: boolean;
  criteria: PillarCriterion[];
}

export type CertTier = "gold" | "silver" | "bronze" | "unfit";

export function tierFromPillars(passing: number): CertTier {
  if (passing >= 4) return "gold";
  if (passing >= 2) return "silver";
  if (passing >= 1) return "bronze";
  return "unfit";
}

// ── Signal extraction helpers ─────────────────────────────────────────────────

function findDim(report: CertReport, id: CertDimensionId): CertDimension | undefined {
  return report.dimensions.find((d) => d.id === id);
}

function findSignal(dim: CertDimension | undefined, signalId: string): CertSignal | undefined {
  return dim?.signals.find((s) => s.id === signalId);
}

function signalToCrit(
  signal: CertSignal | undefined,
  fallbackId: string,
  fallbackLabel: string,
  required: boolean,
  fix?: string,
): PillarCriterion {
  if (!signal) {
    return {
      id: fallbackId,
      label: fallbackLabel,
      state: "missing",
      note: "No data from scanner.",
      fix,
      required,
    };
  }
  return {
    id: signal.id,
    label: signal.label,
    state: signal.state,
    note: signal.note,
    fix,
    required,
  };
}

// ── Pillar 1 — Configuration ──────────────────────────────────────────────────
// Subcriteria:
//   - CLAUDE.md present (inferred from formatter/linter being configured)
//   - Typecheck script (types dimension: types_configured)
//   - Test script (tests dimension: tests_configured)
//   - Lockfile sanity: no package-lock.json (security: security_pkg_manager)
//   - wrangler.toml well-formed for CF Workers (deploy: deploy_gate note)
function buildConfigPillar(report: CertReport): Pillar {
  const secDim = findDim(report, "security");
  const typesDim = findDim(report, "types");
  const testsDim = findDim(report, "tests");
  const fmtDim = findDim(report, "format");
  const lintDim = findDim(report, "lint");
  const deployDim = findDim(report, "deploy");

  // CLAUDE.md: inferred from formatter/linter configured state.
  const fmtOk = findSignal(fmtDim, "format_configured")?.state === "ok";
  const lintOk = findSignal(lintDim, "lint_configured")?.state === "ok";
  const claudeMdCriterion: PillarCriterion = {
    id: "config_claude_md",
    label: "CLAUDE.md present",
    state: fmtOk || lintOk ? "ok" : "warn",
    note:
      fmtOk || lintOk
        ? "Project appears onboarded (formatter or linter configured)."
        : "Cannot verify CLAUDE.md from scan data — add CLAUDE.md to document this project for AI agents.",
    fix: "Create CLAUDE.md at the project root with at minimum a ## Commands section.",
    required: false,
  };

  const typesConfigured = signalToCrit(
    findSignal(typesDim, "types_configured"),
    "config_typecheck",
    "Typecheck script",
    true,
    'Add "typecheck": "tsc --noEmit" (or equivalent) to package.json scripts.',
  );

  const testsConfigured = signalToCrit(
    findSignal(testsDim, "tests_configured"),
    "config_test",
    "Test script",
    true,
    'Add "test": "bun test" (or equivalent) to package.json scripts.',
  );

  const lockfileCriterion = signalToCrit(
    findSignal(secDim, "security_pkg_manager"),
    "config_lockfile",
    "Lockfile sanity (no package-lock.json)",
    true,
    "rm package-lock.json && pnpm install",
  );

  const deployGateSignal = findSignal(deployDim, "deploy_gate");
  let wranglerCriterion: PillarCriterion;
  if (deployGateSignal?.note.includes("worker")) {
    wranglerCriterion = {
      id: "config_wrangler",
      label: "wrangler.toml well-formed",
      state: deployGateSignal.state,
      note: deployGateSignal.note,
      fix: "Ensure wrangler.toml has `name`, `main`, and `compatibility_date` fields.",
      required: true,
    };
  } else if (deployGateSignal?.note.includes("not a deployable")) {
    wranglerCriterion = {
      id: "config_wrangler",
      label: "wrangler.toml well-formed",
      state: "ok",
      note: "Not a CF Worker — wrangler.toml not required.",
      required: false,
    };
  } else {
    wranglerCriterion = {
      id: "config_wrangler",
      label: "wrangler.toml well-formed",
      state: "warn",
      note: "Deploy gate not probed — wrangler.toml status unknown.",
      fix: "Ensure wrangler.toml has `name`, `main`, and `compatibility_date` if this is a CF Worker.",
      required: false,
    };
  }

  const criteria = [
    claudeMdCriterion,
    typesConfigured,
    testsConfigured,
    lockfileCriterion,
    wranglerCriterion,
  ];
  const pass = criteria
    .filter((c) => c.required)
    .every((c) => c.state !== "fail" && c.state !== "missing");

  return { id: "configuration", label: "Configuration", pass, criteria };
}

// ── Pillar 2 — Tests ──────────────────────────────────────────────────────────
// Subcriteria:
//   - Tests configured (tests: tests_configured)
//   - Test taxonomy coverage (tests: tests_taxonomy)
//   - Last test run clean (tests: tests_clean)
//   - Typecheck passes (types: types_clean)
export function buildTestsPillar(report: CertReport): Pillar {
  const testsDim = findDim(report, "tests");
  const typesDim = findDim(report, "types");

  const testsConfigured = signalToCrit(
    findSignal(testsDim, "tests_configured"),
    "tests_configured",
    "Tests configured",
    true,
    'Add "test": "bun test" to package.json.',
  );

  const taxonomyCriterion = signalToCrit(
    findSignal(testsDim, "tests_taxonomy"),
    "tests_taxonomy",
    "Test taxonomy coverage",
    false,
    "Add test directories: mkdir -p test/{unit,integration,e2e,regression}",
  );

  const testRunCriterion = signalToCrit(
    findSignal(testsDim, "tests_clean"),
    "tests_clean",
    "Last test run",
    true,
    "bun test && printf 'ok\\n' > .last-test-result",
  );

  const typecheckRunCriterion = signalToCrit(
    findSignal(typesDim, "types_clean"),
    "types_clean",
    "Last typecheck",
    false,
    "bun run typecheck && printf 'ok\\n' > .last-typecheck-result",
  );

  const criteria = [testsConfigured, taxonomyCriterion, testRunCriterion, typecheckRunCriterion];
  // Tests pillar gold gate: `tests_clean` must be fresh-and-passing (`ok`).
  // Why: a stale (`warn`) or never-run (`unknown`) sentinel hides whether the
  // suite is actually green, so letting it through mis-represents the badge.
  // How to apply: every other required criterion uses the loose non-fail/missing
  // rule; only `tests_clean` is forced to strict `ok`.
  const pass = criteria
    .filter((c) => c.required)
    .every((c) => {
      if (c.id === "tests_clean") return c.state === "ok";
      return c.state !== "fail" && c.state !== "missing";
    });

  return { id: "tests", label: "Tests", pass, criteria };
}

// ── Pillar 3 — Deployment Readiness ──────────────────────────────────────────
// Subcriteria:
//   - Deploy gate cleared (deploy: deploy_gate)
//   - Last deploy freshness — warn if >14 days for CF workers (deploy: deploy_recent)
//   - Build artifact fresh <7 days (build: build_fresh)
//   - Git tree clean (source: git_clean)
//   - In sync with origin/main (source: git_sync)
function buildDeploymentPillar(report: CertReport): Pillar {
  const sourceDim = findDim(report, "source");
  const buildDim = findDim(report, "build");
  const deployDim = findDim(report, "deploy");

  const deployGate = signalToCrit(
    findSignal(deployDim, "deploy_gate"),
    "deploy_gate",
    "Deploy gate",
    true,
    "git status && git push origin main",
  );

  const deployRecent = signalToCrit(
    findSignal(deployDim, "deploy_recent"),
    "deploy_recent",
    "Last deploy",
    false,
    "bun run deploy && printf 'ok\\n' > .last-deploy-result",
  );

  const buildFresh = signalToCrit(
    findSignal(buildDim, "build_fresh"),
    "build_fresh",
    "Build artifact fresh",
    false,
    "bun run build",
  );

  const gitClean = signalToCrit(
    findSignal(sourceDim, "git_clean"),
    "git_clean",
    "Working tree clean",
    true,
    "git add -A && git commit -m 'wip'  # or: git stash",
  );

  const gitSync = signalToCrit(
    findSignal(sourceDim, "git_sync"),
    "git_sync",
    "In sync with origin/main",
    true,
    "git pull --ff-only origin main",
  );

  const criteria = [deployGate, deployRecent, buildFresh, gitClean, gitSync];
  const pass = criteria
    .filter((c) => c.required)
    .every((c) => c.state !== "fail" && c.state !== "missing");

  return { id: "deployment", label: "Deployment Readiness", pass, criteria };
}

// ── Pillar 4 — Compliance ─────────────────────────────────────────────────────
// Subcriteria:
//   - Package manager policy: no npm lockfile (security: security_pkg_manager)
//   - .env not committed (security: security_no_env)
//   - Dependency audit clean (security: security_audit)
//   - No hardcoded secrets (security: security_secrets)
//   - Compliance evidence tracked — optional/warn; see note. Not the Gold gate.
//   --- Security framework coverage (primary Gold gate) ---
//   - Security framework manifest (security: security_framework_manifest)
//   - OWASP Top 10 Web coverage (security: security_owasp_web)
//   - OWASP Top 10 LLM coverage (security: security_owasp_llm) — ok/na for non-LLM surfaces
//   - MITRE ATT&CK Enterprise tactic coverage (security: security_mitre_attack)
//   - MITRE D3FEND defensive technique coverage (security: security_mitre_d3fend)
//   - Security framework last-reviewed within 180 days (security: security_framework_review)
function buildCompliancePillar(report: CertReport): Pillar {
  const secDim = findDim(report, "security");

  const pkgManager = signalToCrit(
    findSignal(secDim, "security_pkg_manager"),
    "security_pkg_manager",
    "Package manager policy (no npm lockfile)",
    true,
    "rm package-lock.json && pnpm install",
  );

  const noEnv = signalToCrit(
    findSignal(secDim, "security_no_env"),
    "security_no_env",
    ".env not committed",
    true,
    "echo '.env' >> .gitignore && git rm --cached .env 2>/dev/null; true",
  );

  const audit = signalToCrit(
    findSignal(secDim, "security_audit"),
    "security_audit",
    "Dependency audit clean",
    false,
    "pnpm audit --prod && printf 'ok\\n' > .last-audit-result",
  );

  const secrets = signalToCrit(
    findSignal(secDim, "security_secrets"),
    "security_secrets",
    "No hardcoded secrets",
    true,
    "$EDITOR package.json  # move literal secret into an env var",
  );

  const complianceTracked: PillarCriterion = {
    id: "compliance_tracked",
    label: "Compliance evidence tracked",
    state: "warn",
    note:
      "sigmashake-compliance does not yet expose per-project evidence via the cert API. " +
      "Surfaced as warn (optional) — the security framework-coverage criteria below are the " +
      "primary Gold gate for this pillar.",
    fix: "Configure compliance.sigmashake.com collectors to tag evidence with this project slug.",
    required: false,
  };

  const frameworkManifest = signalToCrit(
    findSignal(secDim, "security_framework_manifest"),
    "security_framework_manifest",
    "Security framework manifest (.security.toml)",
    true,
    "bun run sec:init <slug>",
  );

  const owaspWeb = signalToCrit(
    findSignal(secDim, "security_owasp_web"),
    "security_owasp_web",
    "OWASP Top 10 Web coverage",
    true,
    "Open .security.toml and address OWASP Web gaps — see security.sigmashake.com/api/frameworks/owasp-web-2021",
  );

  const owaspLlm = signalToCrit(
    findSignal(secDim, "security_owasp_llm"),
    "security_owasp_llm",
    "OWASP Top 10 LLM coverage",
    true,
    "Open .security.toml and address OWASP LLM gaps — see security.sigmashake.com/api/frameworks/owasp-llm-2025",
  );

  const mitreAttack = signalToCrit(
    findSignal(secDim, "security_mitre_attack"),
    "security_mitre_attack",
    "MITRE ATT&CK Enterprise tactic coverage",
    true,
  );

  const mitreD3fend = signalToCrit(
    findSignal(secDim, "security_mitre_d3fend"),
    "security_mitre_d3fend",
    "MITRE D3FEND defensive technique coverage",
    true,
  );

  const frameworkReview = signalToCrit(
    findSignal(secDim, "security_framework_review"),
    "security_framework_review",
    "Security framework reviewed within 180 days",
    true,
    "Update [meta].last_review in .security.toml and re-attest",
  );

  const criteria = [
    pkgManager,
    noEnv,
    audit,
    secrets,
    complianceTracked,
    frameworkManifest,
    owaspWeb,
    owaspLlm,
    mitreAttack,
    mitreD3fend,
    frameworkReview,
  ];
  const pass = criteria
    .filter((c) => c.required)
    .every((c) => c.state !== "fail" && c.state !== "missing");

  return { id: "compliance", label: "Compliance", pass, criteria };
}

export function computePillars(report: CertReport): Pillar[] {
  return [
    buildConfigPillar(report),
    buildTestsPillar(report),
    buildDeploymentPillar(report),
    buildCompliancePillar(report),
  ];
}

// ── UI constants ──────────────────────────────────────────────────────────────

const TIER_LABELS: Record<CertTier, string> = {
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
  unfit: "Unfit",
};

const TIER_BLURB: Record<CertTier, string> = {
  gold: "All four pillars pass. Production-certified.",
  silver: "Two or three pillars pass. Close to fully certified.",
  bronze: "One pillar passes. Significant gaps remain.",
  unfit: "No pillar fully passes. Not ready for production.",
};

const SIGNAL_LABEL: Record<CertSignalState, string> = {
  ok: "OK",
  warn: "Warn",
  fail: "Fail",
  missing: "Missing",
  unknown: "Unknown",
};

const PILLAR_SHORT: Record<PillarId, string> = {
  configuration: "Config",
  tests: "Tests",
  deployment: "Deploy",
  compliance: "Compliance",
};

type SortMode = "tier-asc" | "tier-desc" | "slug" | "gaps-desc";

// ── Helpers ───────────────────────────────────────────────────────────────────

function countGaps(pillars: Pillar[]): number {
  let gaps = 0;
  for (const p of pillars) {
    for (const c of p.criteria) {
      if (c.state === "fail" || c.state === "missing") gaps++;
    }
  }
  return gaps;
}

function hasFailingRequired(pillar: Pillar): boolean {
  return pillar.criteria
    .filter((c) => c.required)
    .some((c) => c.state === "fail" || c.state === "missing");
}

function timeAgo(epochMs: number): string {
  const delta = Math.max(0, Date.now() - epochMs);
  if (delta < 60_000) return "just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TierBadge({ tier, large = false }: { tier: CertTier; large?: boolean }) {
  return (
    <span
      className={`cert__tier-badge cert__tier-badge--${tier}${large ? " cert__tier-badge--large" : ""}`}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}

function TierCount({ tier, count }: { tier: CertTier; count: number }) {
  return (
    <span className={`cert__tier-count cert__tier-count--${tier}`}>
      {count} {TIER_LABELS[tier]}
    </span>
  );
}

function PillarDot({ pillar }: { pillar: Pillar }) {
  const dotState = pillar.pass ? "pass" : hasFailingRequired(pillar) ? "fail" : "warn";
  return (
    <span
      className={`cert__pillar-dot cert__pillar-dot--${dotState}`}
      title={`${pillar.label}: ${pillar.pass ? "pass" : "not passing"}`}
    >
      {PILLAR_SHORT[pillar.id][0]}
    </span>
  );
}

function PillarCard({ pillar }: { pillar: Pillar }) {
  const cardState = pillar.pass ? "pass" : hasFailingRequired(pillar) ? "fail" : "warn";
  return (
    <section className={`cert__pillar cert__pillar--${cardState}`}>
      <header className="cert__pillar-header">
        <span className={`cert__pillar-status cert__pillar-status--${cardState}`}>
          {pillar.pass ? "Pass" : "Not passing"}
        </span>
        <h4 className="cert__pillar-title">{pillar.label}</h4>
      </header>
      <ul className="cert__criteria">
        {pillar.criteria.map((c) => (
          <CriterionRow key={c.id} criterion={c} />
        ))}
      </ul>
    </section>
  );
}

function CriterionRow({ criterion }: { criterion: PillarCriterion }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isBad = criterion.state === "fail" || criterion.state === "missing";

  const onCopy = async () => {
    if (!criterion.fix) return;
    try {
      await navigator.clipboard.writeText(criterion.fix);
    } catch {
      /* clipboard unavailable */
    }
    setCopied(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setCopied(false), 1500);
  };

  return (
    <li className={`cert__criterion cert__criterion--${criterion.state}`}>
      <div className="cert__criterion-top">
        <span className={`cert__criterion-state cert__criterion-state--${criterion.state}`}>
          {SIGNAL_LABEL[criterion.state]}
        </span>
        <span className="cert__criterion-label">{criterion.label}</span>
        {criterion.required ? null : <span className="cert__criterion-optional">optional</span>}
      </div>
      <p className="cert__criterion-note">{criterion.note}</p>
      {isBad && criterion.fix ? (
        <div className="cert__criterion-fix">
          <code className="cert__action-cmd">{criterion.fix}</code>
          <button type="button" className="cert__action-copy" onClick={onCopy}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
    </li>
  );
}

export function dimTone(score: number): "ok" | "warn" | "fail" {
  if (score >= 95) return "ok";
  if (score >= 80) return "warn";
  return "fail";
}

function ServiceRow({
  report,
  pillars,
  tier,
  expanded,
  onToggle,
}: {
  report: CertReport;
  pillars: Pillar[];
  tier: CertTier;
  expanded: boolean;
  onToggle: () => void;
}) {
  const passingPillars = pillars.filter((p) => p.pass).length;
  const gaps = countGaps(pillars);
  const testsDim = findDim(report, "tests");
  const testsScore = testsDim?.score ?? null;
  const testsTone = testsScore === null ? "fail" : dimTone(testsScore);

  return (
    <article className={`cert__svc cert__svc--${tier}${expanded ? " cert__svc--expanded" : ""}`}>
      <button type="button" className="cert__svc-row" onClick={onToggle} aria-expanded={expanded}>
        <span className={`cert__svc-stripe cert__svc-stripe--${tier}`} />
        <TierBadge tier={tier} />
        <span className="cert__svc-slug">{report.slug}</span>
        {testsScore !== null ? (
          <span
            className={`cert__svc-dim cert__svc-dim--${testsTone}`}
            title={`Tests dimension score: ${testsScore}/100`}
          >
            Tests {testsScore}/100
          </span>
        ) : null}
        <div className="cert__svc-pillars">
          {pillars.map((p) => (
            <PillarDot key={p.id} pillar={p} />
          ))}
        </div>
        <div className="cert__svc-meta">
          <span className="cert__svc-pillars-count">
            {passingPillars} / {pillars.length} pillars
          </span>
          {gaps > 0 ? (
            <span className="cert__svc-gaps">
              {gaps} gap{gaps === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <span className="cert__svc-chevron" aria-hidden>
          {expanded ? "▼" : "▶"}
        </span>
      </button>

      {expanded ? (
        <div className="cert__svc-detail">
          {pillars.map((pillar) => (
            <PillarCard key={pillar.id} pillar={pillar} />
          ))}
          <p className="cert__svc-scanned">
            Scanned {timeAgo(report.generatedAt)}
            {report.cached ? " (cached)" : ""}
          </p>
        </div>
      ) : null}
    </article>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function CertificationView({ client, root }: Props) {
  const cache = useWorkspaceCache();
  const cert = cache.certification;
  const data = cert.data;

  const [sort, setSort] = useState<SortMode>("tier-asc");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [streamData, setStreamData] = useState<CertificationResponse | null>(null);
  const [progressive, setProgressive] = useState<{
    scanned: number;
    total: number;
    reports: Record<string, CertReport>;
  } | null>(null);
  // Live state for the "Refresh checks" button — drives the sentinel sweep
  // (lint/format/typecheck/audit/build/test + ai-native-latency) so the cert
  // scanner's 7-day fresh window doesn't expire. tailLine shows the most
  // recent line streamed back so the operator can see what's happening in a
  // long sweep without expanding a full log panel.
  const [refreshing, setRefreshing] = useState(false);
  const [refreshTail, setRefreshTail] = useState<string>("");
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // Live SSE subscription (local + plugin runtimes only).
  useEffect(() => {
    if (!client?.hasLocalCapabilities) return;
    const cfg = window.__WORKSPACE_CONFIG__;
    const port = (cfg?.port ?? Number(location.port)) || 0;
    const origin = `${location.protocol}//${location.hostname}${port ? `:${port}` : ""}`;
    const url = new URL(`${origin}/api/json/workspace/certify/stream`);
    if (root) url.searchParams.set("root", root);
    if (cfg?.token) url.searchParams.set("token", cfg.token);

    let es: EventSource | null = null;
    try {
      es = new EventSource(url.toString());
      es.addEventListener("meta", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as {
            total: number;
            slugs: string[];
          };
          setProgressive({ scanned: 0, total: payload.total, reports: {} });
          setStreaming(true);
        } catch {
          // ignore malformed
        }
      });
      es.addEventListener("service", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as {
            slug: string;
            index: number;
            total: number;
            report: CertReport;
          };
          setProgressive((prev) => {
            const base = prev ?? { scanned: 0, total: payload.total, reports: {} };
            return {
              scanned: payload.index,
              total: payload.total,
              reports: { ...base.reports, [payload.slug]: payload.report },
            };
          });
        } catch {
          // ignore malformed
        }
      });
      es.addEventListener("done", () => {
        setProgressive((prev) => (prev ? { ...prev, scanned: prev.total } : prev));
      });
      es.addEventListener("refresh", (e) => {
        try {
          const payload = JSON.parse((e as MessageEvent).data) as CertificationResponse;
          setStreamData(payload);
          setProgressive(null);
        } catch {
          // ignore malformed
        }
      });
      es.onmessage = (e) => {
        try {
          const payload = JSON.parse(e.data) as CertificationResponse;
          setStreamData(payload);
          setProgressive(null);
          setStreaming(true);
        } catch {
          // ignore malformed
        }
      };
      es.onerror = () => {
        setStreaming(false);
      };
    } catch {
      // EventSource unavailable in this runtime.
    }
    return () => {
      if (es) es.close();
    };
  }, [client, root]);

  // Source-of-truth precedence: progressive > streamData > cache.
  const effective: CertificationResponse | null = useMemo(() => {
    if (progressive && Object.keys(progressive.reports).length > 0) {
      const list = Object.values(progressive.reports);
      const rank: Record<CertLevel, number> = { gold: 3, silver: 2, bronze: 1, unfit: 0 };
      let worst: CertLevel = "gold";
      let sum = 0;
      for (const r of list) {
        sum += r.score;
        if (rank[r.level] < rank[worst]) worst = r.level;
      }
      return {
        generatedAt: Date.now(),
        overallScore: list.length === 0 ? 0 : Math.round(sum / list.length),
        overallLevel: worst,
        reports: progressive.reports,
      };
    }
    return streamData ?? data;
  }, [progressive, streamData, data]);

  const scanInProgress = progressive !== null && progressive.scanned < progressive.total;

  // Build the four-pillar overlay for every report, memoised on effective data.
  const reportPillars = useMemo<Record<string, Pillar[]>>(() => {
    if (!effective) return {};
    const out: Record<string, Pillar[]> = {};
    for (const [slug, report] of Object.entries(effective.reports)) {
      out[slug] = computePillars(report);
    }
    return out;
  }, [effective]);

  const reportTiers = useMemo<Record<string, CertTier>>(() => {
    const out: Record<string, CertTier> = {};
    for (const [slug, pillars] of Object.entries(reportPillars)) {
      out[slug] = tierFromPillars(pillars.filter((p) => p.pass).length);
    }
    return out;
  }, [reportPillars]);

  const overallTier = useMemo<CertTier>(() => {
    const order: CertTier[] = ["unfit", "bronze", "silver", "gold"];
    let worst: CertTier = "gold";
    for (const t of Object.values(reportTiers)) {
      if (order.indexOf(t) < order.indexOf(worst)) worst = t;
    }
    return worst;
  }, [reportTiers]);

  const tierCounts = useMemo(() => {
    const counts: Record<CertTier, number> = { gold: 0, silver: 0, bronze: 0, unfit: 0 };
    for (const t of Object.values(reportTiers)) counts[t]++;
    return counts;
  }, [reportTiers]);

  const sorted = useMemo(() => {
    if (!effective) return [];
    const list = Object.values(effective.reports);
    const order: Record<CertTier, number> = { unfit: 0, bronze: 1, silver: 2, gold: 3 };
    if (sort === "tier-asc") {
      return [...list].sort(
        (a, b) => order[reportTiers[a.slug] ?? "unfit"] - order[reportTiers[b.slug] ?? "unfit"],
      );
    }
    if (sort === "tier-desc") {
      return [...list].sort(
        (a, b) => order[reportTiers[b.slug] ?? "unfit"] - order[reportTiers[a.slug] ?? "unfit"],
      );
    }
    if (sort === "gaps-desc") {
      return [...list].sort(
        (a, b) => countGaps(reportPillars[b.slug] ?? []) - countGaps(reportPillars[a.slug] ?? []),
      );
    }
    return [...list].sort((a, b) => a.slug.localeCompare(b.slug));
  }, [effective, sort, reportTiers, reportPillars]);

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (!effective && cert.loading && !cert.error) {
    const expectedRows = progressive?.total ?? 8;
    const determinate = progressive
      ? { progress: progressive.scanned, total: progressive.total }
      : {};
    return (
      <div className="cert">
        <header className="cert__hero cert__hero--skeleton">
          <ProgressStrip
            loading
            label={
              progressive
                ? `Scanning ${progressive.scanned}/${progressive.total} services`
                : "Discovering services in your monorepo"
            }
            {...determinate}
          />
          <div className="cert__hero-score">
            <div className="cert__skeleton-gauge" />
            <div className="cert__hero-text">
              <div className="cert__skeleton-line" style={{ width: 240 }} />
              <div className="cert__skeleton-line" style={{ width: 360 }} />
            </div>
          </div>
        </header>
        <div className="cert__skeleton-grid">
          {Array.from({ length: Math.min(expectedRows, 12) }).map((_, i) => (
            <div key={i} className="cert__skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error state ─────────────────────────────────────────────────────────────
  if (!effective && cert.error) {
    return (
      <div className="cert cert--empty cert--error">
        <h2>Could not build the certification report</h2>
        <p>{friendlyError(cert.error)}</p>
        <button type="button" className="cert__retry" onClick={() => cert.refresh()}>
          Retry scan
        </button>
      </div>
    );
  }

  if (!effective) return null;

  const totalServices = Object.keys(effective.reports).length;

  return (
    <div className="cert">
      {/* ── Hero scorecard ───────────────────────────────────────────────── */}
      <header className="cert__hero">
        <ProgressStrip
          loading={cert.loading || scanInProgress}
          label={
            scanInProgress
              ? `Scanning ${progressive?.scanned}/${progressive?.total} services`
              : cert.loading
                ? "Refreshing in background"
                : streaming
                  ? "Live (SSE)"
                  : `Updated ${timeAgo(effective.generatedAt)}`
          }
          progress={scanInProgress ? progressive?.scanned : undefined}
          total={scanInProgress ? progressive?.total : undefined}
        />
        <div className="cert__hero-score">
          <TierBadge tier={overallTier} large />
          <div className="cert__hero-text">
            <h2 className="cert__hero-title">
              Monorepo certification:{" "}
              <span className={`cert__badge cert__badge--${overallTier}`}>
                {TIER_LABELS[overallTier]}
              </span>
            </h2>
            <p className="cert__hero-blurb">{TIER_BLURB[overallTier]}</p>
            <p className="cert__hero-meta">
              {totalServices}
              {scanInProgress ? ` / ${progressive?.total}` : ""} service
              {totalServices === 1 ? "" : "s"} scanned{" "}
              <TierCount tier="gold" count={tierCounts.gold} />{" "}
              <TierCount tier="silver" count={tierCounts.silver} />{" "}
              <TierCount tier="bronze" count={tierCounts.bronze} />{" "}
              <TierCount tier="unfit" count={tierCounts.unfit} />{" "}
              {streaming ? "live (SSE)" : "polling 30s"}
            </p>
          </div>
        </div>
        <div className="cert__pillar-legend">
          <span className="cert__pillar-legend-label">Four pillars:</span>
          {(["configuration", "tests", "deployment", "compliance"] as PillarId[]).map((pid) => (
            <span key={pid} className="cert__pillar-legend-item">
              {PILLAR_SHORT[pid]}
            </span>
          ))}
        </div>
        <div className="cert__hero-controls">
          <label className="cert__sort">
            Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as SortMode)}>
              <option value="tier-asc">Unfit first</option>
              <option value="tier-desc">Gold first</option>
              <option value="gaps-desc">Most gaps first</option>
              <option value="slug">A to Z</option>
            </select>
          </label>
          <button
            type="button"
            className="cert__refresh"
            onClick={() => cert.refresh()}
            disabled={cert.loading}
            title="Force re-scan now"
          >
            Re-scan
          </button>
          {client?.hasLocalCapabilities ? (
            <button
              type="button"
              className="cert__refresh"
              onClick={async () => {
                if (!client) return;
                setRefreshing(true);
                setRefreshError(null);
                setRefreshTail("starting sentinel sweep…");
                try {
                  // force=true: the operator's explicit click should re-run
                  // even kinds whose sentinel was written <24h ago (the
                  // script's default skip-fresh window).
                  const handle = await client.refreshSentinels({ force: true });
                  for await (const ev of handle.events) {
                    if (ev.line) setRefreshTail(ev.line);
                    if (ev.done) break;
                  }
                  // The cert scanner reads the same sentinels we just
                  // rewrote — re-fetch the report so the operator sees the
                  // new freshness immediately.
                  await cert.refresh();
                  setRefreshTail("");
                } catch (err) {
                  setRefreshError(friendlyError(err));
                } finally {
                  setRefreshing(false);
                }
              }}
              disabled={refreshing || cert.loading}
              title="Re-run every service's lint/format/typecheck/audit/test sentinels (slow — minutes)"
            >
              {refreshing ? "Refreshing checks…" : "Refresh checks"}
            </button>
          ) : null}
        </div>
        {refreshing || refreshTail || refreshError ? (
          <p
            className="cert__hero-meta"
            style={{ marginTop: 8, opacity: 0.75, fontSize: 12 }}
            role="status"
          >
            {refreshError ? `Refresh failed: ${refreshError}` : refreshTail ? refreshTail : null}
          </p>
        ) : null}
      </header>

      {/* ── Service list ─────────────────────────────────────────────────── */}
      <div className="cert__service-list">
        {sorted.map((report) => {
          const pillars = reportPillars[report.slug] ?? [];
          const tier = reportTiers[report.slug] ?? "unfit";
          const isExpanded = expandedSlug === report.slug;
          return (
            <ServiceRow
              key={report.slug}
              report={report}
              pillars={pillars}
              tier={tier}
              expanded={isExpanded}
              onToggle={() => setExpandedSlug(isExpanded ? null : report.slug)}
            />
          );
        })}
      </div>
    </div>
  );
}
