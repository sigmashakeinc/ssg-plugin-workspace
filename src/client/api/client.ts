// API client abstraction. Three concrete implementations exist; one is
// selected at module load time based on the WORKSPACE_RUNTIME compile-time
// constant injected by Vite's `define`. The window.__WORKSPACE_CONFIG__
// override lets the SSG daemon swap a build-time "local" client to "local"
// at serve time with the right port + token.

import type {
  AiNativeResponse,
  AttentionDetails,
  CertificationResponse,
  ContextUsage,
  CreateProjectRequest,
  DistributionData,
  DistributionDrift,
  DistributionSyncResult,
  EditRequest,
  FleetOverview,
  FleetStatus,
  HealthSummary,
  InboxSnapshot,
  InfraGraph,
  ObservBoard,
  PlatformParityAttestRequest,
  PlatformParityResponse,
  PlatformParityRunRequest,
  ProjectCard,
  ProjectsResponse,
  ReadinessResponse,
  SessionInfo,
  TestReportBundle,
  WorkspaceSettings,
} from "./types";

export type Runtime = "cloud" | "local" | "vscode" | "plugin";

export interface RunHandle {
  jobId: string;
  /** Async iterator over log lines until done. */
  events: AsyncIterable<{ line: string; done: boolean; exitCode?: number }>;
  cancel(): Promise<void>;
}

export interface WorkspaceApiClient {
  runtime: Runtime;
  /** True if this runtime can Run/Inspect/Edit (i.e. has filesystem access). */
  hasLocalCapabilities: boolean;
  listProjects(root?: string): Promise<ProjectsResponse>;
  getHealth(slugs: string[]): Promise<Record<string, HealthSummary>>;
  /**
   * Deep-dive evidence for one project: why each attention bucket fired,
   * what to do about it, and whether an AI agent is already on it. The UI
   * loads this lazily when the operator expands an attention card so the
   * /workspace/health endpoint stays cheap.
   *
   * Cloud raises CapabilityError — a Worker can't probe the operator's
   * filesystem. Local hit the SSG daemon's
   * `/api/json/workspace/attention-details` endpoint.
   */
  getAttentionDetails(slug: string): Promise<AttentionDetails>;
  /**
   * Record an AI dispatch intent for `slug` of the given `kind`. The daemon
   * appends a line to `~/.sigmashake/workspace-assignments.jsonl` and the
   * next `getAttentionDetails(slug)` will surface it under `ai.lastAssignment`.
   *
   * No agent is actually spawned — there's no autonomous Claude runtime yet.
   * The button exists so (a) operators can pre-stage work for a future
   * runtime, and (b) the UI has a concrete action to offer instead of just
   * explaining why AI isn't on it.
   *
   * Cloud raises CapabilityError. Local hit the SSG daemon.
   */
  assignAi(
    slug: string,
    kind: "fix-tests" | "fix-deploy" | "fix-build" | "push" | "investigate",
    reason?: string,
  ): Promise<void>;
  runScript(project: string, script: string): Promise<RunHandle>;
  readFile(project: string, file: EditRequest["file"]): Promise<string>;
  writeFile(req: EditRequest): Promise<void>;
  /**
   * Open the OS native folder picker. Currently unavailable in every runtime
   * (cloud, local, vscode, plugin all run inside a webview without access to
   * a native dialog API). The user types the path manually instead. Kept on
   * the interface for the future plugin-host RPC bridge.
   */
  pickDirectory?(startDir?: string): Promise<string | null>;
  /**
   * Create a new project under the workspace root. Returns the new
   * ProjectCard so the UI can refresh + select it. Local-only — the
   * cloud client raises CapabilityError because a Worker can't write
   * to the user's filesystem.
   */
  createProject(req: CreateProjectRequest): Promise<ProjectCard>;
  /**
   * Return the deduped infrastructure graph for the workspace. Cloud
   * returns a build-time static snapshot of the public monorepo; local
   * scans the user's wrangler.toml files live.
   */
  listInfrastructure(root?: string): Promise<InfraGraph>;
  /**
   * Read-only cross-channel release status for the SigmaShake distribution
   * — SSG CLI + SSG Desktop across the build pipeline, npm, the download
   * CDN, and the public download page. Local read it live from
   * the SSG daemon; the cloud client raises CapabilityError.
   */
  getDistribution(root?: string): Promise<DistributionData>;
  /**
   * Live cross-channel parity probe for SigmaShake Desktop. Polls the R2 CDN
   * (update.json + blob HEAD per lane) and the latest GitHub release to
   * detect lanes that are STALE / BROKEN / MISSING. Returns the same data
   * shape regardless of runtime; the cloud Worker is the canonical source
   * because the CDN + GitHub API block cross-origin browser fetches. Local
   * + plugin + vscode runtimes proxy to the cloud endpoint.
   */
  getDistributionDrift(): Promise<DistributionDrift>;
  /**
   * Kick off a coordinated multi-platform release through the orchestrator.
   * Mutating — local only; the cloud client raises
   * CapabilityError. Throws if a release is already in progress.
   */
  triggerSync(): Promise<DistributionSyncResult>;
  /**
   * Identity of the currently signed-in viewer. The cloud runtime hits
   * /api/session/me on accounts.sigmashake.com — if the cookie isn't valid
   * the auth gate has already redirected away, so a successful App load
   * implies this returns a session. Local runtimes are gated
   * by the SSG dashboard token instead and return a stub identifying the
   * local operator.
   */
  getSession(): Promise<SessionInfo | null>;
  /**
   * Read the operator's WorkspaceSettings (mode picker + onboarding state).
   * Cloud: backed by localStorage. Local: read from the SSG
   * daemon's `~/.sigmashake/workspace.json` so the choice survives a
   * browser cache wipe, with a localStorage fallback if the daemon route
   * 404s on an older SigmaShake. Never throws — returns DEFAULT_WORKSPACE_SETTINGS
   * on any failure so the SPA can still boot.
   */
  getSettings(): Promise<WorkspaceSettings>;
  /**
   * Persist a partial settings update. Merges over the current settings,
   * bumps `updatedAt`, and writes back through the same channel
   * getSettings() reads from. Returns the new full snapshot.
   */
  setSettings(patch: Partial<WorkspaceSettings>): Promise<WorkspaceSettings>;
  /**
   * Per-project breakdown of agent-instruction context — every CLAUDE.md,
   * AGENTS.md, .cursorrules, skill, memory page, and governance rule that
   * the AI agent has to ingest while working in this subproject. Bytes +
   * estimated tokens for each entry. Local read the live tree;
   * the cloud client raises CapabilityError (no filesystem access).
   */
  getContextUsage(project: string): Promise<ContextUsage>;
  /**
   * Read-only Fleet control-plane status. Phase 1 probes the public
   * `/api/health` endpoint and (in local runtimes) surfaces
   * this-machine agent enrollment from the SSG daemon. The cloud runtime
   * returns enrollment=null because the browser can't see local agent state.
   * Never throws — falls back to reachability="unknown" so the panel can
   * still render a sign-in CTA.
   */
  getFleetStatus(): Promise<FleetStatus>;
  /**
   * Authed Fleet overview for the operator's tenant subdomain. Fetches
   * `<slug>.fleet.sigmashake.com/api/v1/...` with credentials so the SSO
   * cookie attaches; returns `{authed: false}` on 401 / 403 so the panel
   * can swap in a sign-in CTA. Never throws.
   */
  getFleetOverview(slug: string): Promise<FleetOverview>;
  /**
   * One-click "Connect this machine" — uses the user's SSO session at
   * <slug>.fleet.sigmashake.com to mint a 5-minute enrollment grant, hands
   * it to the local SSG daemon, and the daemon writes the resulting agent
   * JWT to disk. Returns the refreshed FleetStatus so the panel can flip
   * straight to "Connected". Local only — cloud + vscode raise
   * CapabilityError because there's no daemon to receive the JWT.
   */
  autoEnrollFleet(slug: string, label?: string): Promise<FleetStatus>;
  /**
   * Cross-service SDLC certification report. Local hit the SSG
   * daemon's `/api/json/workspace/certify` endpoint, which runs the
   * filesystem-only scanner against every project. The cloud client raises
   * CapabilityError — a Worker can't read the operator's tree.
   */
  getCertification(slugs?: string[]): Promise<CertificationResponse>;
  /**
   * Per-service AI-native readiness — five capability signals (agent docs,
   * CLI, MCP server, JSON API, agent integration) plus a latency gauge that
   * measures loopback round-trips where the service declares a port, and
   * classifies by architecture otherwise. Local hit the SSG
   * daemon's `/api/json/workspace/ai-native` endpoint, which scans the
   * filesystem and probes localhost. The cloud client raises CapabilityError
   * — a Worker can't read the operator's tree or probe their loopback.
   */
  getAiNative(slugs?: string[]): Promise<AiNativeResponse>;
  /**
   * Live production-readiness evaluation. Reads the manifest
   * `.sigmashake/production-readiness.json` and resolves each requirement
   * against the SDLC cert scanner + the filesystem, so an operator can see
   * whether Fleet / SSG / SigmaShake Desktop are production-ready at any
   * time. Local hit the SSG daemon's
   * `/api/json/workspace/readiness` endpoint; the cloud client raises
   * CapabilityError — a Worker can't read the operator's tree.
   */
  getReadiness(): Promise<ReadinessResponse>;
  /**
   * Structured per-kind test reports for one project — the drill-down behind
   * the Tests panel's pass/fail matrix. Each report carries the test count,
   * per-test (or per-file) results, durations, the runner, and an output
   * tail, parsed by the SSG daemon from the last `/workspace/run` of that
   * kind's script and persisted as `.last-test-report-<kind>.json`.
   *
   * Local + vscode read it from the daemon. The cloud client
   * raises CapabilityError — a Worker has no filesystem to read reports from.
   */
  getTestReport(slug: string): Promise<TestReportBundle>;
  /**
   * Unified Inbox snapshot — open support tickets + new sales leads in one
   * call. Cloud only: the workspace worker holds the support agent bearer +
   * the sales service binding, so the browser never touches either directly.
   * Local runtimes raise CapabilityError; the panel shows a
   * "Open in cloud" fallback so operators can still reach it from desktop.
   */
  getInbox(): Promise<InboxSnapshot>;
  /** Post a reply on a support ticket. `visibility` defaults to "public". */
  replyTicket(ticketId: string, body: string, visibility?: "public" | "internal"): Promise<void>;
  /** Close a support ticket with an optional resolution note. */
  closeTicket(ticketId: string, resolutionNote?: string): Promise<void>;
  /** Patch a support ticket — status change, tags edit. */
  patchTicket(ticketId: string, patch: { status?: string; tags?: string[] }): Promise<void>;
  /** Patch a sales lead — status change with optional internal note. */
  patchLead(leadId: string, patch: { status: string; notes?: string }): Promise<void>;
  /**
   * Consolidated service-health board from sigmashake-observ — every monitored
   * platform service's current status, its recent-checks ring, and the
   * incident log. Cloud only: the workspace Worker holds the OBSERV service
   * binding, so the browser never reaches sigmashake-observ directly. Local +
   * vscode runtimes raise CapabilityError; the panel shows an "open in cloud"
   * fallback.
   */
  getObservability(): Promise<ObservBoard>;
  /**
   * Cross-OS desktop feature-parity matrix. Local + vscode
   * runtimes hit the SSG daemon, which resolves the catalog against this
   * host (auto-probes where it can) and merges in persisted results from
   * sibling OS hosts via `~/.sigmashake/platform-parity.json`. The cloud
   * runtime returns the static catalog baked into the worker so the UI can
   * at least render the checklist; every cell carries status="unknown" with
   * evidence pointing at SigmaShake Desktop.
   */
  getPlatformParity(): Promise<PlatformParityResponse>;
  /**
   * Kick off the auto-probe suite on this host. Each auto check writes its
   * result into the persistence file under the OS column of the host that
   * ran it. Returns the refreshed snapshot. Local + vscode
   * only — the cloud runtime raises CapabilityError.
   */
  runPlatformParity(req?: PlatformParityRunRequest): Promise<PlatformParityResponse>;
  /**
   * Record a manual attestation for one (feature × OS) cell. Used when the
   * operator has just verified a check that doesn't have an auto-probe (or
   * to override an auto verdict with field evidence). Local +
   * vscode only — the cloud runtime raises CapabilityError.
   */
  attestPlatformParity(req: PlatformParityAttestRequest): Promise<PlatformParityResponse>;
  /**
   * Re-run the workspace sentinel refresher (lint/format/typecheck/audit/build
   * /test + ai-native-latency) so the SDLC cert scanner stops grading every
   * service as stale. Drives `shared/agent-config/scripts/refresh-workspace-
   * sentinels.ts` via the daemon's `/api/json/workspace/refresh-sentinels`
   * endpoint and returns a RunHandle whose async iterator yields the script's
   * progress lines until done. The button in CertificationView calls this then
   * re-fetches the cert report.
   *
   * Local + vscode hit the daemon; cloud raises CapabilityError
   * (the script can't run inside a Worker).
   */
  refreshSentinels(opts?: RefreshSentinelsOptions): Promise<RunHandle>;
}

export interface RefreshSentinelsOptions {
  /** Restrict the sweep to one service. Default: every sigmashake-* dir. */
  project?: string;
  /** Restrict to a subset of kinds. Default: all six. */
  kinds?: Array<"format" | "lint" | "typecheck" | "audit" | "build" | "test">;
  /** Re-run kinds whose sentinel was rewritten <24h ago. Default: false. */
  force?: boolean;
  /** Skip the root-level ai-native-latency refresh at the end. */
  skipAiNative?: boolean;
}

export class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilityError";
  }
}

let cached: WorkspaceApiClient | null = null;

export async function getClient(): Promise<WorkspaceApiClient> {
  if (cached) return cached;
  const runtime =
    (typeof window !== "undefined" && window.__WORKSPACE_CONFIG__?.runtime) ||
    (typeof WORKSPACE_RUNTIME !== "undefined" ? WORKSPACE_RUNTIME : "cloud");
  switch (runtime) {
    case "cloud": {
      const { createCloudClient } = await import("./cloud");
      cached = createCloudClient();
      break;
    }
    case "local":
    case "plugin": {
      const { createLocalClient } = await import("./local");
      cached = createLocalClient();
      break;
    }
    case "vscode": {
      const { createVscodeClient } = await import("./vscode");
      cached = createVscodeClient();
      break;
    }
  }
  return cached!;
}

export function detectRuntime(): Runtime {
  if (typeof window !== "undefined" && window.__WORKSPACE_CONFIG__?.runtime) {
    return window.__WORKSPACE_CONFIG__.runtime;
  }
  return typeof WORKSPACE_RUNTIME !== "undefined" ? WORKSPACE_RUNTIME : "cloud";
}
