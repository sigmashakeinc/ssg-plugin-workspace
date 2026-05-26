// Shared types for the sigmashake-workspace surface. Used by:
//   - src/worker.ts (Cloudflare Worker, cloud Browse path)
//   - src/registry.generated.ts (synthesised from ../CLAUDE.md at build time)
//   - src/client/api/types.ts re-exports these for the React app
//   - sigmashake-gov/src/server/handlers/workspace-*.ts mirrors this shape

export type ProjectType = "cf-worker" | "bun" | "elixir" | "native" | "unknown";

/** Stable ids for the 19 canonical test kinds. */
export type TestKindId =
  // functional
  | "unit"
  | "integration"
  | "component"
  | "e2e"
  | "regression"
  | "api"
  // performance
  | "load"
  | "stress"
  | "spike"
  | "soak"
  | "scalability"
  // resiliency
  | "chaos"
  | "failover"
  | "dr"
  | "configuration"
  // security
  | "sast"
  | "dast"
  | "pen"
  | "dependencies";

export interface ProjectCard {
  slug: string;
  dir: string;
  type: ProjectType;
  description: string;
  scripts: string[];
  hasWranglerToml: boolean;
  hasClaudeMd: boolean;
  /**
   * Filesystem-detected test kinds. Populated by the SSG daemon
   * (workspace-projects.ts) and baked into the cloud registry by
   * build-registry.ts. A kind present here with value `true` means test files
   * were found matching that kind's dir/suffix patterns — even if no
   * package.json script exists yet.
   */
  testKinds?: Partial<Record<TestKindId, boolean>>;
}

export interface HealthSummary {
  slug: string;
  gitDirty: boolean;
  gitAheadOriginMain: number;
  gitBehindOriginMain: number;
  deployGateOk: boolean | null;
  lastBuildAt: number | null;
  lastTestAt: number | null;
  lastTestOk: boolean | null;
  /**
   * Per-kind test sentinels mirrored from the SSG daemon's
   * `.last-test-result-<kindId>` files. Populated whenever a
   * `/api/json/workspace/run` job whose script maps to a canonical
   * TestKindId finishes. Absent kinds fall back to "Never run" in the UI.
   *
   * The cloud Worker has no filesystem, so this field is always
   * undefined on the cloud surface — local + electrobun + vscode runtimes
   * are the only ones that populate it.
   */
  lastTestByKind?: Partial<
    Record<TestKindId, {at: number; ok: boolean | null}>
  >;
}

export interface RunEvent {
  jobId: string;
  line?: string;
  stream?: "stdout" | "stderr";
  done: boolean;
  exitCode?: number;
}

export interface EditRequest {
  project: string;
  file: "CLAUDE.md" | "wrangler.toml" | "package.json";
  content: string;
}

export interface CreateProjectRequest {
  /** Display name. Becomes package.json `name`. Lowercase + kebab-case. */
  slug: string;
  type: Exclude<ProjectType, "unknown">;
  /** One-line description for package.json + the project card. */
  description: string;
  /** Longer prose for CLAUDE.md (optional). */
  about?: string;
}

export interface ProjectsResponse {
  root: string;
  projects: ProjectCard[];
}

// ── Infrastructure graph ─────────────────────────────────────────────────────
// A node-link representation of every sigmashake-* Cloudflare Worker plus the
// resources it touches (D1 / KV / R2 / queues / DOs / services / secrets / domains).
// Shared resources are deduped so a single bucket / database / queue appears once.

export type InfraNodeKind =
  | "worker"
  | "domain"
  | "d1"
  | "kv"
  | "r2"
  | "queue"
  | "durable_object"
  | "service"
  | "secret"
  | "dispatch_namespace"
  | "analytics"
  | "cron"
  | "assets";

export interface InfraNode {
  /** Stable, unique node id (e.g. `worker:sigmashake-fleet`, `d1:sigmashake-hub-db`). */
  id: string;
  kind: InfraNodeKind;
  /** Plain-English label shown on the node. */
  label: string;
  /** Optional one-line explanation rendered in tooltips. */
  hint?: string;
  /** Resource-specific metadata (database_id, bucket_name, etc.). */
  meta?: Record<string, string>;
  /** For worker nodes: the project slug. */
  slug?: string;
}

export type InfraEdgeKind =
  | "route"
  | "binding"
  | "service"
  | "tail"
  | "queue_produces"
  | "queue_consumes"
  | "cron"
  | "owns";

export interface InfraEdge {
  /** Source node id. */
  from: string;
  /** Target node id. */
  to: string;
  kind: InfraEdgeKind;
  /** Binding name (e.g. `DB`, `EMAILER`) — shown on hover. */
  label?: string;
}

export interface InfraGraph {
  nodes: InfraNode[];
  edges: InfraEdge[];
  /** Epoch ms the graph was generated. */
  generatedAt: number;
  /** Absolute workspace root that was scanned (or "/registry" for cloud). */
  root: string;
}

// ── Distribution graph ───────────────────────────────────────────────────────
// Cross-channel release status for the SigmaShake distribution: the SSG CLI
// and SSG Desktop as they flow from monorepo source → per-platform build
// pipeline (sigmashake-orch) → publish channels (npm + download CDN) → the
// public download page. Produced by the SSG daemon's
// workspace-distribution.ts handler; consumed by DistributionView.

export type DistNodeState = "ok" | "warn" | "fail" | "pending" | "unknown";

export interface DistNode {
  /** Stable id, e.g. `publish:npm`. */
  id: string;
  label: string;
  /** Version string or short status shown under the label. */
  sublabel?: string;
  state: DistNodeState;
  /** One-line, plain-language explanation. */
  detail: string;
  /** Layout column: 0 source · 1 build · 2 publish · 3 surface. */
  column: number;
  url?: string;
  updatedAt?: string;
}

export interface DistEdge {
  from: string;
  to: string;
  state: DistNodeState;
}

// ── Distribution inventory matrix ────────────────────────────────────────────
// The consolidated "single view" half of the Distribution panel: every
// shippable SigmaShake artifact as one row per (product, version, operating
// system) — the channels + region reach it ships through, file size, build
// time, when it was last built + distributed, and how many versions exist.
// Produced by the SSG daemon's workspace-distribution-inventory.ts — keep this
// mirror in lockstep with that module's exported shapes.

export type DistProductId =
  | "ssg-cli"
  | "ssg-desktop"
  | "vscode-ext"
  | "plugins"
  | "rulesets";

export type DistArtifactStatus =
  | "live"
  | "building"
  | "stale"
  | "pending"
  | "missing"
  | "unknown";

export interface DistChannelRef {
  /** Stable id — `npm`, `r2-cdn`, `vscode-marketplace`, … */
  id: string;
  label: string;
  /** Region / edge footprint shown in the Distribution view's Regions column. */
  reach: string;
  url?: string;
}

export interface DistArtifactRow {
  /** Stable row id — `${product}@${version}:${os}`. */
  id: string;
  product: DistProductId;
  productLabel: string;
  /** Display name for plugin / rule-set rows; absent for first-party rows. */
  name?: string;
  version: string;
  /** Platform key — `linux-x64`, `darwin-arm64`, `win-x64`, `all`, … */
  os: string;
  osLabel: string;
  channels: DistChannelRef[];
  /** Deduped region / edge reach across this row's channels. */
  regions: string[];
  fileSizeBytes: number | null;
  sha256: string | null;
  /** Wall-clock build duration in ms. */
  buildDurationMs: number | null;
  /** ISO — when the artifact was built. */
  builtAt: string | null;
  /** ISO — when it was last pushed to a distribution channel. */
  distributedAt: string | null;
  /** Which machine produced it. */
  buildHost: string | null;
  status: DistArtifactStatus;
  /** Plain-language one-liner — where the numbers came from / what's missing. */
  note: string;
}

export interface DistProductRollup {
  product: DistProductId;
  label: string;
  currentVersion: string | null;
  /** How many versions exist for this product. Null when uncountable. */
  versionCount: number | null;
  /** Distinct operating systems carried by the current build. */
  platformCount: number;
  /** Independent distribution channels — the high-availability factor. */
  channelCount: number;
  totalSizeBytes: number | null;
  lastBuiltAt: string | null;
  lastDistributedAt: string | null;
  /** Build time of the slowest platform leg — the effective release time. */
  lastBuildDurationMs: number | null;
}

export interface DistInventory {
  products: DistProductRollup[];
  rows: DistArtifactRow[];
  /** Every channel referenced — drives the Regions-column legend. */
  channels: DistChannelRef[];
  /** Plain-language data-source gaps. */
  notes: string[];
}

export interface DistributionData {
  /** ISO timestamp the snapshot was taken. */
  generatedAt: string;
  /** True when no channel has drifted out of sync. */
  inSync: boolean;
  /** Headline verdict. */
  summary: string;
  /** Plain-language drift notes, one per problem. */
  warnings: string[];
  nodes: DistNode[];
  edges: DistEdge[];
  /** Which upstream data sources answered. */
  sources: { orchestrator: boolean; npm: boolean; downloads: boolean };
  /** True while a multi-platform release build is mid-flight. */
  releaseInProgress: boolean;
  /**
   * The inventory matrix — every shippable artifact as one row per
   * (product, version, OS). Optional: an older SSG daemon's response predates
   * the matrix; the current daemon always populates it.
   */
  inventory?: DistInventory;
}

export interface DistributionSyncResult {
  /** Orchestrator job id for the release that was kicked off. */
  jobId: string;
  /** Version being built + released across all platforms. */
  version: string;
}

// NOTE: `WorkerEnv` lives in `worker-env.ts` because it references
// Cloudflare-only types (`KVNamespace`, `Fetcher`) that aren't on the client
// tsconfig's lib path. Keeping the worker-only shapes out of this file lets
// the React app re-export from `types.ts` without dragging in workers-types.

/** Public shape of the logged-in operator surfaced via /api/session/me. */
export interface SessionInfo {
  userId: string;
  login: string;
  avatar?: string;
  authType?: string;
}

// ── Workspace mode + settings ────────────────────────────────────────────────
// The workspace surfaces two product modes (plus a hybrid showing both):
//
//   - "stack"    Monorepo manager: project cards from a sigmashake-shaped tree,
//                Run/Inspect/Edit scripts, infra graph, distribution view.
//   - "services" Connected-services console: third-party + sigmashake-hosted
//                accounts (Slack, Stripe, GH, etc.) with per-connector actions
//                instead of `bun run <script>`.
//   - "hybrid"   Both surfaces visible — Stack rail on the left, Services rail
//                below it. Costs nothing extra once both registries coexist.
//
// The choice is per-operator and persists via the SSG daemon (local +
// electrobun) or localStorage (cloud). Settings are bumped lazily — the
// settingsVersion field lets us migrate older payloads forward without
// dropping unknown future keys.
export type WorkspaceMode = "stack" | "services" | "hybrid";

export interface WorkspaceSettings {
  /** Schema version for forward-compat migrations. Bump on breaking change. */
  settingsVersion: 1;
  /** Active product mode — drives which rails / empty states render. */
  mode: WorkspaceMode;
  /**
   * True once the operator has dismissed the first-run mode picker. New
   * installs land on the picker instead of defaulting silently to "stack".
   */
  onboarded: boolean;
  /**
   * Tenant subdomain for sigmashake-fleet — used by the Fleet panel to know
   * which `<slug>.fleet.sigmashake.com` host to call. Empty string means the
   * operator hasn't connected an org yet; the panel renders the connect-org
   * flow instead.
   */
  fleetOrgSlug: string;
  /** Epoch ms the settings were last written. Diagnostic only. */
  updatedAt: number;
}

export const DEFAULT_WORKSPACE_SETTINGS: WorkspaceSettings = {
  settingsVersion: 1,
  mode: "stack",
  onboarded: false,
  fleetOrgSlug: "",
  updatedAt: 0,
};

// ── Test matrix ──────────────────────────────────────────────────────────────
// The Tests tab in ProjectDetail walks the canonical test taxonomy (functional,
// performance, resiliency, security) and reports which kinds are configured /
// last-run / currently passing for a given project. The catalog itself is a
// static client-side constant — this file only exports the *result* shapes so
// callers in the worker + SSG daemon can speak the same language.

export type TestCategoryId = "functional" | "performance" | "resiliency" | "security";

export type TestStatus =
  | "passing" // ran recently, all green
  | "failing" // ran recently, at least one failure
  | "stale" // configured + ran once but data is older than 7 days
  | "missing" // not configured (no matching package.json script)
  | "unknown"; // configured but never run

export interface TestKindResult {
  /** Stable id, e.g. `unit`, `load`, `sast`. */
  kindId: string;
  status: TestStatus;
  /** Epoch ms — null when never run. */
  lastRunAt: number | null;
  /** The package.json script that backs this kind, when one was found. */
  script: string | null;
  /** Plain-English explanation shown beneath the status pill. */
  note: string;
}

export interface TestCategoryResult {
  category: TestCategoryId;
  results: TestKindResult[];
}

export interface TestMatrix {
  slug: string;
  /** Epoch ms the matrix was computed. */
  generatedAt: number;
  categories: TestCategoryResult[];
  /** Quick rollup so the header can read "12 / 19 passing · 5 missing". */
  totals: {
    passing: number;
    failing: number;
    stale: number;
    missing: number;
    unknown: number;
  };
}

// ── Test run reports (drill-down) ────────────────────────────────────────────
// The matrix above answers "is this kind green?". A TestRunReport answers the
// follow-up: how many tests ran, what was tested, which ones failed, how long
// it took, and with which runner. The SSG daemon parses every `/workspace/run`
// job's output into one of these and persists it as `.last-test-report-<kind>
// .json`; the Tests panel loads them through GET /api/json/workspace/test-report
// when an operator expands a kind. Mirror of
// sigmashake-gov/src/server/handlers/lib/test-output-parser.ts.

/** Test runner the daemon recognised from a job's output. */
export type TestRunner = "bun" | "vitest" | "playwright" | "unknown";

/** Outcome of a single test case (or test file, for the vitest reporter). */
export type TestCaseStatus = "passed" | "failed" | "skipped" | "todo";

/** Whether `cases[]` is one entry per test or per test file. */
export type TestCaseGranularity = "test" | "file";

export interface TestCaseResult {
  /** Test title (or file path, when granularity is `file`). */
  name: string;
  status: TestCaseStatus;
  /** Per-case wall-clock in ms — null when the runner didn't print it. */
  durationMs: number | null;
  /** Source file the case belongs to, when the runner names it. */
  file: string | null;
  /** For `file`-granularity rows: how many tests that file contains. */
  subCount?: number;
  /**
   * For a failed case: the runner's inline failure detail (assertion diff,
   * error, stack) — the "reason why" behind the red dot. Omitted for passing
   * / skipped cases and when the runner batched its failures elsewhere.
   */
  failureMessage?: string;
}

export interface TestRunSummary {
  /** Authoritative total the runner reported (falls back to cases.length). */
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  /** Whole-suite wall-clock in ms — null when the runner didn't print it. */
  durationMs: number | null;
  /** Distinct source files exercised — null when not derivable. */
  fileCount: number | null;
}

export interface TestRunReport {
  slug: string;
  /** Canonical kind this report covers. */
  kind: TestKindId;
  /** package.json script that produced it. */
  script: string;
  /**
   * True when produced by the broad `test` script and credited to a kind
   * other than the suite's own — the numbers cover the whole suite, not just
   * this kind's slice.
   */
  broad: boolean;
  /** Epoch ms the run finished. */
  generatedAt: number;
  exitCode: number;
  /** `exitCode === 0`. */
  ok: boolean;
  runner: TestRunner;
  caseGranularity: TestCaseGranularity;
  summary: TestRunSummary;
  cases: TestCaseResult[];
  /** True when `cases` was capped and is not the complete list. */
  casesTruncated: boolean;
  /** Last lines of raw output — the evidence tail. */
  outputTail: string[];
}

// ── Test run history (trend grid) ────────────────────────────────────────────
// A TestRunReport is the *latest* run only — `.last-test-report-<kind>.json`
// is overwritten every run. To draw a GitHub-style trend grid the UI needs
// the runs before it too: the daemon appends one TestHistoryEntry per run to
// `.test-history-<kind>.jsonl`. This is a summary-only slice (no per-test
// `cases[]`) so many runs stay cheap to keep. Mirror of
// sigmashake-gov/src/server/handlers/lib/test-history.ts.

export interface TestHistoryEntry {
  /** Epoch ms the run finished. */
  at: number;
  /** `exitCode === 0`. */
  ok: boolean;
  exitCode: number;
  /** package.json script that produced this run. */
  script: string;
  /** True when credited from the broad `test` script, not this kind's slice. */
  broad: boolean;
  runner: TestRunner;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  todo: number;
  /** Whole-suite wall-clock in ms — null when the runner didn't print it. */
  durationMs: number | null;
}

export interface TestReportBundle {
  slug: string;
  /** Epoch ms the bundle was assembled. */
  generatedAt: number;
  /** One report per kind that has a `.last-test-report-<kind>.json` on disk. */
  reports: Partial<Record<TestKindId, TestRunReport>>;
  /**
   * Run-history trail per kind, oldest entry first — every recorded run, not
   * just the latest. Backs the Tests panel's trend grid. A kind is absent
   * when it has no `.test-history-<kind>.jsonl` log yet.
   */
  history: Partial<Record<TestKindId, TestHistoryEntry[]>>;
}

// ── Context usage ────────────────────────────────────────────────────────────
// Per-project breakdown of the agent-instruction surface that an AI coding
// agent has to ingest *every turn* — CLAUDE.md/AGENTS.md/GEMINI.md/.cursorrules,
// installed skills, auto-memory pages, and ssg .rules. Token counts are
// estimated (~chars/4) because Claude's tokenizer isn't free to run here;
// the SSG daemon supplies bytes + lines + estimatedTokens for each entry.

/** Where this file sits in the agent's load order. */
export type ContextScope =
  /** Inside the project directory — only loaded when working in this subproject. */
  | "project"
  /** At the monorepo root — loaded for every subproject. */
  | "shared"
  /** In the user's `~/.claude/` — applies to every project on this machine. */
  | "global";

/** What kind of agent surface this entry represents. */
export type ContextKind =
  | "claude-md"
  | "agents-md"
  | "gemini-md"
  | "cursor-rules"
  | "copilot-instructions"
  | "skill"
  | "memory-index"
  | "memory-page"
  | "governance-rule"
  | "other";

/** When the agent actually reads this file. */
export type ContextLoadMode =
  /** Loaded into every agent turn — counts against the running token budget. */
  | "always"
  /** Loaded only when the agent invokes/reads it — opportunistic cost. */
  | "on-demand";

export interface ContextEntry {
  /** Absolute path on disk (used for "open in editor" links). */
  path: string;
  /** Display label — usually the basename or `<dir>/<basename>`. */
  label: string;
  scope: ContextScope;
  kind: ContextKind;
  loadMode: ContextLoadMode;
  /** File size in bytes (sum across descendants for directory entries). */
  bytes: number;
  /** Newline count (sum across descendants for directory entries). */
  lines: number;
  /** Rough token estimate. Uses chars/4 — within ~10% of Anthropic's tokenizer. */
  estimatedTokens: number;
  /** Plain-English one-liner shown beneath the size — what this file does. */
  hint: string;
}

export interface ContextGroup {
  /** Stable id (e.g. `project`, `shared`, `skills`, `memory`). */
  id: string;
  /** Group header label. */
  label: string;
  /** Short description shown beneath the header. */
  description: string;
  entries: ContextEntry[];
  /** Sum of `estimatedTokens` across entries — for the group rollup. */
  totalEstimatedTokens: number;
  /** Sum of `bytes` across entries. */
  totalBytes: number;
}

export interface ContextUsage {
  slug: string;
  /** Epoch ms the snapshot was taken. */
  generatedAt: number;
  groups: ContextGroup[];
  /** Tokens loaded on every agent turn (`loadMode === "always"`). */
  alwaysOnTokens: number;
  /** Tokens loaded only when the agent invokes the file. */
  onDemandTokens: number;
  /** Total of always-on + on-demand. */
  totalEstimatedTokens: number;
  /** Sum of bytes across every entry. */
  totalBytes: number;
}

// ── SDLC certification ───────────────────────────────────────────────────────
// Mirrors the shapes returned by /api/json/workspace/certify in the SSG daemon.
// The server file owns the authoritative copy (sigmashake-gov/src/server/
// handlers/workspace-certify.ts) — keep both sides aligned when fields change.

export type CertDimensionId =
  | "source"
  | "format"
  | "lint"
  | "types"
  | "tests"
  | "security"
  | "build"
  | "deploy";

export type CertLevel = "gold" | "silver" | "bronze" | "unfit";
export type CertSignalState = "ok" | "warn" | "fail" | "missing" | "unknown";

export interface CertSignal {
  id: string;
  label: string;
  state: CertSignalState;
  note: string;
}

export interface CertDimension {
  id: CertDimensionId;
  label: string;
  score: number;
  signals: CertSignal[];
}

export interface CertReport {
  slug: string;
  generatedAt: number;
  score: number;
  level: CertLevel;
  dimensions: CertDimension[];
  cached: boolean;
}

export interface CertificationResponse {
  generatedAt: number;
  overallScore: number;
  overallLevel: CertLevel;
  reports: Record<string, CertReport>;
}

// ── Attention details ────────────────────────────────────────────────────────
// Deep-dive payload backing the workspace UI's expandable attention cards.
// Loaded lazily from `/api/json/workspace/attention-details?slug=<slug>` when
// the operator clicks a row in the Attention tab — the overview's `/health`
// endpoint stays cheap. Each block reports applicability + ok + the *evidence*
// (file lists, commit subjects, sentinel content) and a copy-pasteable
// suggested-fix command. The `ai` block answers "why isn't AI working on this?"
// using whatever the daemon currently has (active /workspace/run jobs, the
// most recent assignment-log entry, and a plain-English explanation of the
// posture).
//
// Server: sigmashake-gov/src/server/handlers/workspace-attention-details.ts

export interface AttentionCommitInfo {
  /** Short SHA (first 12 chars). */
  sha: string;
  subject: string;
  author: string;
  /** ISO-8601 timestamp from `git log --format=%aI`. */
  isoDate: string;
}

export interface AttentionDeployDetail {
  /** True when the project is a Cloudflare Worker (wrangler.toml present). */
  applicable: boolean;
  /** Result of the deploy-gate dry-run. Null when not applicable. */
  ok: boolean | null;
  /** Plain-English explanation of why the gate cleared or refused. */
  reason: string;
  /** Files in this project that differ from origin/main (up to 20). */
  changedFiles: string[];
  /** Untracked-but-not-ignored files (up to 20). */
  untrackedFiles: string[];
  /** Commits ahead of origin/main (up to 10). */
  unpushedCommits: AttentionCommitInfo[];
  /** Copy-pasteable shell command the operator can run. */
  suggestedFix: string;
}

export interface AttentionTestsDetail {
  /** True when the project declares a test (or test:*) script. */
  applicable: boolean;
  /** Last test result. Null when the sentinel is missing or unreadable. */
  ok: boolean | null;
  lastRunAt: number | null;
  /** Raw content of `.last-test-result` (truncated to 4 KB). */
  sentinelValue: string | null;
  /** test / test:* scripts found in package.json. */
  scripts: string[];
  /** Plain-English why-it's-here. */
  reason: string;
  suggestedFix: string;
}

export interface AttentionBuildDetail {
  applicable: boolean;
  lastBuildAt: number | null;
  /** Build age in days (floor). Null when never built or not applicable. */
  ageDays: number | null;
  scripts: string[];
  reason: string;
  suggestedFix: string;
}

export interface AttentionGitDetail {
  dirty: boolean;
  aheadOriginMain: number;
  behindOriginMain: number;
  /** Up to 20 entries from `git status --porcelain`. */
  dirtyFiles: string[];
  /** Up to 10 commits ahead of origin/main. */
  unpushedCommits: AttentionCommitInfo[];
  suggestedFix: string;
}

export interface AttentionActiveJob {
  jobId: string;
  script: string;
  startedAt: number;
  done: boolean;
  exitCode: number | null;
}

export interface AttentionAssignmentRecord {
  ts: number;
  slug: string;
  kind: string;
  reason: string;
  jobId?: string;
}

export interface AttentionAiDetail {
  /**
   * True once the daemon has an autonomous agent-dispatch runtime. Currently
   * always `false` — the workspace can spawn `bun run` jobs, but does not
   * itself invoke Claude Code. The UI uses this to choose between a
   * "Dispatch" CTA (when runtime arrives) and a "Run manually" explainer.
   */
  runtimeConfigured: boolean;
  /** Active /workspace/run jobs for this slug — fix-tests, deploy, build, etc. */
  activeJobs: AttentionActiveJob[];
  /** Most recent agent assignment recorded for this slug, or null. */
  lastAssignment: AttentionAssignmentRecord | null;
  /** Plain-English answer to "why isn't AI working on this?". */
  explanation: string;
  /** Terminal commands the operator can run to dispatch an agent themselves. */
  manualDispatch: string[];
}

export interface AttentionDetails {
  slug: string;
  /** Epoch ms the snapshot was taken. */
  generatedAt: number;
  deploy: AttentionDeployDetail;
  tests: AttentionTestsDetail;
  build: AttentionBuildDetail;
  git: AttentionGitDetail;
  ai: AttentionAiDetail;
}

// ── Fleet status ─────────────────────────────────────────────────────────────
// Read-only Fleet (sigmashake-fleet) status surfaced in the Workspace panel.
// Phase 1 is a thin probe — public health endpoint + this-machine enrollment
// (when the SSG daemon exposes it). The browser session lives in the SSO
// cookie on the .fleet subdomain; we don't try to read it cross-origin.

export type FleetReachability = "ok" | "unreachable" | "unknown";

export interface FleetEnrollment {
  /** True when this machine has an agent record at the Fleet control plane. */
  enrolled: boolean;
  /** Fleet-assigned agent id (e.g. `agent-9`). Null when not enrolled. */
  agentId: string | null;
  /** Org id the agent belongs to. */
  orgId: string | null;
  /** True when the agent JWT has expired and the machine needs re-enrollment. */
  jwtExpired: boolean;
  /** Bundle version pinned on this machine, or null when none has been pulled. */
  bundleVersion: string | null;
  /** Human-readable bundle state — "active" / "no bundle" / "stale" etc. */
  bundleState: string;
}

export interface FleetStatus {
  /** Whether the public Fleet control-plane health probe responded ok. */
  reachability: FleetReachability;
  /** ISO timestamp of the probe. */
  checkedAt: string;
  /** This-machine agent enrollment — null when the runtime can't see it. */
  enrollment: FleetEnrollment | null;
  /** URL the operator should open to sign in with SSO + manage Fleet. */
  signInUrl: string;
}

// ── Fleet authed surface (Phase 3) ───────────────────────────────────────────
// Cross-origin reads from the Workspace browser to the operator's tenant
// subdomain. All fetches go out with credentials: "include" so the
// ssg_fleet_session cookie attaches; the Fleet CORS allowlist gates which
// origins receive responses.

export type FleetSessionVia = "oidc" | "saml" | "device" | "admin" | "unknown";

export interface FleetSessionInfo {
  /** Subject identifier (usually the operator's email). */
  userId: string;
  /** Organization id resolved from the session. */
  orgId: string | null;
  /** Tenant subdomain slug — `<slug>.fleet.sigmashake.com`. */
  orgSlug: string | null;
  /** Role within the org (member / org_admin / auditor / policy_author). */
  role: string | null;
  /** Authentication path that issued this session. */
  via: FleetSessionVia;
}

export type FleetAgentStatus = "active" | "idle" | "revoked" | "expired" | "unknown";

export interface FleetAgentSummary {
  id: string;
  label: string | null;
  agentVersion: string | null;
  policyVersion: string | null;
  status: FleetAgentStatus;
  lastHeartbeatAt: number | null;
  lastEvalAt: number | null;
  createdAt: number;
}

export type FleetPolicyStatus = "draft" | "pending_review" | "approved" | "archived" | "unknown";

export interface FleetPolicySummary {
  id: string;
  name: string;
  status: FleetPolicyStatus;
  priorityLayer: number;
  version: number;
  createdBy: string;
  approvedBy: string | null;
  updatedAt: number;
}

export interface FleetAuditEvent {
  id: string;
  eventType: string;
  agentId: string | null;
  createdAt: number;
  /** Compact preview drawn from the event payload. */
  summary: string;
}

export interface FleetOverview {
  /** True when the whoami probe succeeded and the slug resolved. */
  authed: boolean;
  /** Last error encountered fetching authed data — null on success. */
  error: string | null;
  session: FleetSessionInfo | null;
  agents: FleetAgentSummary[];
  policies: FleetPolicySummary[];
  audit: FleetAuditEvent[];
  /** Rollup counts so the panel can render without re-counting client-side. */
  counts: {
    agentsTotal: number;
    agentsActive: number;
    policiesPending: number;
    policiesApproved: number;
    auditLast24h: number;
  };
}

// ── Inbox (support tickets + sales leads) ────────────────────────────────────
// Unified "what needs attention" surface. The cloud worker proxies to
// sigmashake-support's /agent/tickets and sigmashake-sales's /leads. Both
// sources are read-only here — click-through to support.sigmashake.com (or
// the inline detail panel) handles reply/close.

export type TicketSeverity = "p0" | "p1" | "p2" | "p3";
export type TicketStatus = "open" | "in_progress" | "waiting" | "resolved" | "closed";

export interface InboxTicket {
  id: string;
  subject: string;
  contactEmail: string;
  orgId: string | null;
  category: string | null;
  severity: TicketSeverity;
  status: TicketStatus;
  source: string;
  slaDeadline: number | null;
  createdAt: number;
  updatedAt: number;
  closedAt: number | null;
  tags: string[];
  /** Optional AI-suggested summary from auto-triage. Null until triaged. */
  aiSummary: string | null;
  /** Confidence in the AI suggestion, 0–1. Null when no AI triage. */
  aiConfidence: number | null;
}

export type LeadClassification =
  | "cold_pitch"
  | "legitimate_inquiry"
  | "partnership"
  | "media"
  | "unclear";

export type LeadStatus = "new" | "replied" | "ignored" | "escalated" | "meeting_booked" | "closed";

export interface InboxLead {
  id: string;
  createdAt: number;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  /** Truncated body — full body is one click away in the detail panel. */
  bodyPreview: string;
  classification: LeadClassification | null;
  confidence: number | null;
  aiSummary: string | null;
  status: LeadStatus;
}

export type InboxSourceState = "ok" | "unauthorized" | "unreachable" | "unconfigured";

export interface InboxSourceStatus {
  state: InboxSourceState;
  /** Plain-English explanation when state !== "ok". Null on success. */
  message: string | null;
}

export interface InboxSnapshot {
  /** ISO timestamp the snapshot was taken. */
  generatedAt: string;
  tickets: InboxTicket[];
  leads: InboxLead[];
  /** Per-source connection state — surfaces "token not provisioned" without
   *  failing the whole panel. */
  sources: {
    support: InboxSourceStatus;
    sales: InboxSourceStatus;
  };
  /** Counts for the rail badge + header rollup. */
  counts: {
    /** Open tickets (status === "open" || "in_progress" || "waiting"). */
    ticketsOpen: number;
    /** Tickets at P0/P1 in any non-closed status. */
    ticketsCritical: number;
    /** Leads with status === "new". */
    leadsNew: number;
  };
}

// ── Observability ────────────────────────────────────────────────────────────
// Consolidated service-health board, proxied from sigmashake-observ via the
// workspace Worker's OBSERV service binding (GET /api/workspace/observability).
// Mirrors the wire shape sigmashake-observ emits — keep both sides aligned.
// sigmashake-observ is a synthetic uptime monitor by design: it keeps state,
// not history — one current status per service plus a fixed recent-checks ring
// and a capped incident log. There is no time-series data to surface here.

export type ObservStatus = "up" | "degraded" | "down" | "unknown";
export type ObservScope = "cloud" | "local";
export type ObservIncidentKind = "down" | "degraded" | "recovered";

/** One slot in a service's recent-checks ring. */
export interface ObservRecentCheck {
  /** Epoch ms of the probe. */
  at: number;
  /** True when the probe verdict was `up`. */
  ok: boolean;
}

/** A status transition — appended to the board's incident log only on change. */
export interface ObservIncident {
  slug: string;
  name: string;
  kind: ObservIncidentKind;
  /** Epoch ms the transition was observed. */
  at: number;
  /** Status the service held before this transition. */
  fromStatus: ObservStatus;
  /** HTTP code from the triggering probe, when there was a response. */
  httpCode: number | null;
  /** Short human-readable note. */
  detail: string;
}

/** Per-service health as folded into the board by the monitor cron. */
export interface ObservService {
  slug: string;
  name: string;
  blurb: string;
  scope: ObservScope;
  /** True when a service binding is configured and the service is probed. */
  monitored: boolean;
  status: ObservStatus;
  /** Epoch ms the current `status` began. */
  since: number;
  /** Epoch ms of the most recent probe. */
  lastCheckAt: number;
  lastLatencyMs: number | null;
  lastHttpCode: number | null;
  /** Short error string on a failed probe; null when healthy. */
  lastError: string | null;
  /** Consecutive non-`up` probes. */
  consecutiveFailures: number;
  /** Fraction of `up` probes across the recent-checks ring (0..1), or null. */
  uptimeRecent: number | null;
  /** Fixed-size ring of recent probe outcomes, oldest first. */
  recentChecks: ObservRecentCheck[];
  /** True between a fired down-alert and its recovery alert. */
  alerted: boolean;
}

/** The whole observability board returned by GET /api/workspace/observability. */
export interface ObservBoard {
  /** Epoch ms the board was last written by the monitor cron. 0 = never run. */
  generatedAt: number;
  services: ObservService[];
  /** Status-transition log, newest first. */
  incidents: ObservIncident[];
}

// ── AI-native readiness + latency gauge ──────────────────────────────────────
// Mirrors the shapes returned by /api/json/workspace/ai-native in the SSG
// daemon (sigmashake-gov/src/server/handlers/workspace-ai-native.ts) — keep
// both sides aligned when fields change.
//
// Two orthogonal axes per service:
//   1. AI-native capability — can an agent discover, drive, and reason about
//      the service without a human? Five filesystem-only signals: agent docs,
//      a CLI, an MCP server, a JSON API, and agent integration.
//   2. Latency gauge — how fast does "doing anything" come back? Measured on
//      loopback where the service declares a port and is running, classified
//      by architecture otherwise. The standing goal is a sub-millisecond
//      response; the gauge stays honest about when that floor is unreachable
//      (an edge Worker can't beat a network round-trip).

/** native ≥80 · capable ≥58 · partial ≥32 · opaque <32 (weighted score). */
export type AiNativeTier = "native" | "capable" | "partial" | "opaque";

/** `na` — the signal does not apply to this service's architecture. */
export type AiNativeSignalState = "ok" | "warn" | "missing" | "na";

/** Latency floor classes, fastest (in-process) → slowest. */
export type AiLatencyTier =
  | "nanosecond"
  | "microsecond"
  | "submillisecond"
  | "millisecond"
  | "edge"
  | "second"
  | "unknown";

/** Verdict of the measured / expected latency against the sub-ms goal. */
export type AiLatencyVerdict = "meets" | "acceptable" | "slow" | "unmeasured";

/** How the latency number was obtained. */
export type AiLatencyMeasurement =
  | "loopback"
  | "mcp-coldstart"
  | "cli-coldstart"
  | "none";

export interface AiNativeSignal {
  /** Stable id — agent-docs · cli · mcp · json-api · integration. */
  id: "agent-docs" | "cli" | "mcp" | "json-api" | "integration";
  label: string;
  state: AiNativeSignalState;
  /** Plain-English what was / wasn't found. */
  note: string;
  /** How an agent would actually use this capability, when present. */
  evidence: string[];
}

export interface AiLatencyGauge {
  /** Realistic latency floor for this service's architecture. */
  tier: AiLatencyTier;
  /** Measured min round-trip in ms (sub-ms precision); null when not probed. */
  observedMs: number | null;
  /** Successful probe samples behind observedMs. */
  samples: number;
  /** The sub-millisecond goal, as a tier. Always "submillisecond". */
  targetTier: AiLatencyTier;
  verdict: AiLatencyVerdict;
  /** How observedMs was obtained — loopback probe vs cold control-surface spawn. */
  measurement: AiLatencyMeasurement;
  /** Plain-English: what was measured, or why this tier. */
  note: string;
  /** Loopback port that was probed, when any. */
  probedPort: number | null;
}

export interface AiNativeReport {
  slug: string;
  /** Epoch ms the report was computed. */
  generatedAt: number;
  /** 0-100 weighted capability score. */
  score: number;
  tier: AiNativeTier;
  /** Architecture class label driving the latency floor. */
  architecture: string;
  signals: AiNativeSignal[];
  latency: AiLatencyGauge;
  /** Single highest-impact next step toward full AI-nativeness. */
  recommendation: string;
  cached: boolean;
}

export interface AiNativeResponse {
  generatedAt: number;
  overallScore: number;
  overallTier: AiNativeTier;
  /** Services whose latency verdict is "meets" (sub-millisecond goal). */
  submillisecondCount: number;
  /** Services where a live latency probe succeeded. */
  probedCount: number;
  reports: Record<string, AiNativeReport>;
}

// ── Production readiness ─────────────────────────────────────────────────────
// Mirrors the shapes returned by /api/json/workspace/readiness in the SSG
// daemon (sigmashake-gov/src/server/handlers/workspace-readiness.ts) — keep
// both sides aligned when fields change.
//
// A live evaluation of the production-readiness manifest
// (`.sigmashake/production-readiness.json`). Each tracked product carries a
// set of requirements; auto checks (cert-signal, path-exists) resolve live
// against the SDLC certification scanner + the filesystem, manual checks read
// their status straight from the manifest. A product is production-ready when
// every *blocking* requirement resolves to "met" — so an operator can answer
// "are we production ready?" at a glance, at any time.

/** Resolved status of a single readiness requirement. */
export type ReadinessStatus = "met" | "unmet" | "partial" | "unknown";

/** Which slice of production readiness a requirement belongs to. */
export type ReadinessCategory =
  | "quality"
  | "security"
  | "reliability"
  | "release"
  | "compliance"
  | "docs";

/** How a requirement's status was determined. */
export type ReadinessSource = "auto" | "manual";

export interface ReadinessRequirement {
  id: string;
  title: string;
  detail: string;
  category: ReadinessCategory;
  /** When true, this requirement must be "met" for its product to be ready. */
  blocking: boolean;
  status: ReadinessStatus;
  source: ReadinessSource;
  /** Plain-English explanation of why the status is what it is. */
  evidence: string;
  /** Copy-pasteable next step — present when status !== "met". */
  remediation?: string;
  /** ISO date a manual requirement's status was last set. Auto checks omit it. */
  updatedAt?: string;
}

export interface ReadinessTotals {
  met: number;
  unmet: number;
  partial: number;
  unknown: number;
  total: number;
}

export interface ReadinessProduct {
  id: string;
  name: string;
  blurb: string;
  /** Monorepo project slugs this product is built from. */
  projects: string[];
  /** True when every blocking requirement resolved to "met". */
  ready: boolean;
  /** Count of blocking requirements not yet "met" — the size of the gap. */
  blockerCount: number;
  totals: ReadinessTotals;
  requirements: ReadinessRequirement[];
}

export interface ReadinessResponse {
  /** Epoch ms the evaluation was computed. */
  generatedAt: number;
  /** True when every tracked product is production-ready. */
  ready: boolean;
  /** How many products are ready, out of `productCount`. */
  readyProductCount: number;
  productCount: number;
  /** Total blocking requirements not yet met, across all products. */
  totalBlockers: number;
  products: ReadinessProduct[];
  /**
   * Set when the manifest is missing or unparseable — `products` is then
   * empty. Null on a clean evaluation.
   */
  manifestError: string | null;
}

// ── Platform parity (Linux / macOS / Windows desktop checklist) ──────────────
// Cross-OS consistency matrix for the SigmaShake Desktop (Electrobun) build.
// Every feature that has to behave the same way on Linux + macOS + Windows is
// listed in a static catalog (PLATFORM_PARITY_CATALOG); the SSG daemon resolves
// each catalog entry against this host (auto-probes where possible, otherwise
// keeps the last recorded result for the OS the daemon is running on) and
// merges in any persisted results from sibling OS hosts.
//
// The result is a feature × OS matrix the UI renders as a checklist with
// per-cell status, last-checked timestamp, evidence, and verification recipe.

export type PlatformOs = "linux" | "darwin" | "win32";

export type PlatformParityStatus =
  | "pass" // verified working on this OS within the recorded window
  | "fail" // verified broken (or the probe failed outright)
  | "partial" // works with caveats — see evidence
  | "skipped" // operator explicitly waived this check on this OS
  | "unknown" // never run / no evidence yet
  | "not-applicable"; // not expected on this OS (e.g. mac entitlements on linux)

export type PlatformParityCategory =
  | "integration" // taskbar/dock/tray, deep links, file association, auto-launch
  | "files" // HOME/AppData/Library, native picker, watchers, symlinks
  | "ui" // window controls, theme, fonts, keyboard, multi-monitor
  | "runtime" // SSG-inside-the-window features (graph, audit, voice)
  | "ipc" // Electrobun bridge / preload / protocol handler
  | "data" // sqlite, license JWT, audit log rotation, keys perms
  | "security" // signing, notarization, sandbox, SmartScreen
  | "notifications" // toast, badge, click-to-focus, DND
  | "distribution"; // installer, update channel, delta patch

export type PlatformParitySeverity = "blocking" | "recommended";
export type PlatformParityAttestation = "auto" | "manual";

/** Constrains which OS the feature is expected to deliver on. */
export type PlatformParityExpectedFor = "all" | PlatformOs;

/** Per-feature, per-OS check result. */
export interface PlatformParityResult {
  status: PlatformParityStatus;
  /** Where the verdict came from: an automated probe, or an operator attestation. */
  attestation: PlatformParityAttestation;
  /** Epoch ms — when this verdict was recorded. */
  lastCheckedAt: number;
  /** Wall-clock duration of the probe in ms; null for manual attestations. */
  durationMs: number | null;
  /** One-line, plain-language summary of what was observed. */
  evidence: string;
  /** Error / failure detail, when status is fail/unknown. Null on success. */
  error: string | null;
  /** Short hash of the recording host — distinguishes sibling machines. */
  hostId: string;
  /** Human-friendly host label, e.g. `pop os 22.04 (super)`. */
  hostLabel: string;
}

/** One entry in the platform-parity catalog. */
export interface PlatformParityFeature {
  /** Stable kebab-case id — never change after release. */
  id: string;
  label: string;
  category: PlatformParityCategory;
  /** What the feature does, in plain English. */
  description: string;
  severity: PlatformParitySeverity;
  /**
   * Which OS the feature must work on. `all` is the default; OS-specific
   * features (e.g. macOS entitlements) constrain to that one OS, and the
   * other columns auto-resolve to `not-applicable`.
   */
  expectedFor: PlatformParityExpectedFor;
  /**
   * How to verify the feature on each OS — concise recipe the operator can
   * follow when recording a manual attestation, or what the auto-probe
   * actually checks for if `verificationKind === "auto"`.
   */
  verification: {
    linux: string;
    darwin: string;
    win32: string;
  };
  /**
   * `auto` means the SSG daemon's parity probe can verify this without
   * human input on the host where it runs. `manual` requires an operator
   * to recheck and record.
   */
  verificationKind: PlatformParityAttestation;
  /** Per-OS results, keyed by OS. Missing entries are treated as `unknown`. */
  results: {
    linux: PlatformParityResult | null;
    darwin: PlatformParityResult | null;
    win32: PlatformParityResult | null;
  };
}

export interface PlatformParityHostSeen {
  os: PlatformOs;
  hostId: string;
  hostLabel: string;
  lastCheckedAt: number;
}

export interface PlatformParitySummary {
  total: number;
  pass: number;
  fail: number;
  partial: number;
  unknown: number;
  skipped: number;
  notApplicable: number;
  /**
   * Overall parity score, 0–100. Blocking-feature passes weigh 2×; recommended
   * features weigh 1×. `not-applicable` cells are excluded from the denominator.
   * `unknown` cells count against the score so an unrun matrix never reads as
   * "everything's fine".
   */
  parityScore: number;
  /** Count of blocking features that have at least one OS row not in `pass`. */
  blockingGaps: number;
}

export interface PlatformParityResponse {
  /** Epoch ms — when this snapshot was assembled. */
  generatedAt: number;
  /** OS of the host that answered this request. */
  currentHostOs: PlatformOs | "unknown";
  currentHostId: string;
  currentHostLabel: string;
  features: PlatformParityFeature[];
  summary: PlatformParitySummary;
  /** Every OS host that has ever recorded a result, freshest first. */
  hostsSeen: PlatformParityHostSeen[];
  /**
   * Set when the persistence file was missing or unreadable. Snapshot still
   * renders (the catalog ships baked in) but results are all `unknown`.
   */
  storeError: string | null;
}

/** POST /api/json/workspace/platform-parity/run body. */
export interface PlatformParityRunRequest {
  /** Optional subset of feature ids to recheck. Empty/missing → run all auto checks. */
  featureIds?: string[];
}

/** POST /api/json/workspace/platform-parity/attest body. */
export interface PlatformParityAttestRequest {
  featureId: string;
  /** Which OS column this attestation applies to. */
  os: PlatformOs;
  status: PlatformParityStatus;
  /** Free-form one-liner — what the operator observed. */
  evidence: string;
}
