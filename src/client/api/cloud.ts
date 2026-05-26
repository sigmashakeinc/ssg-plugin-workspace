// Cloud runtime — talks to the same-origin Cloudflare Worker. The Worker
// implements GET /api/workspace/projects + /api/workspace/infrastructure
// from build-time static data. Run/Health/Edit/Create return 501, which the
// React app turns into a CloudGate interstitial.

import {
  emptyEnrollmentStatus,
  fetchFleetOverview,
  probeFleetReachability,
} from "../lib/fleet-probe";
import { CapabilityError, type WorkspaceApiClient } from "./client";
import { mergeSettings, readLocalSettings, writeLocalSettings } from "./settings-store";
import type {
  AiNativeResponse,
  CertificationResponse,
  ContextUsage,
  FleetOverview,
  FleetStatus,
  InboxSnapshot,
  InfraGraph,
  ObservBoard,
  PlatformParityResponse,
  ReadinessResponse,
  SessionInfo,
  TestReportBundle,
  WorkspaceSettings,
} from "./types";

export function createCloudClient(): WorkspaceApiClient {
  return {
    runtime: "cloud",
    hasLocalCapabilities: false,
    async listProjects() {
      const res = await fetch("/api/workspace/projects");
      if (!res.ok) throw new Error(`projects: ${res.status}`);
      return res.json();
    },
    async getHealth() {
      throw new CapabilityError(
        "Health checks require a local SSG daemon. Open this page in SigmaShake Desktop.",
      );
    },
    async getAttentionDetails() {
      throw new CapabilityError(
        "Attention details require a local SSG daemon (we need to probe your files). Open this page in SigmaShake Desktop.",
      );
    },
    async assignAi() {
      throw new CapabilityError(
        "Recording an AI dispatch intent requires a local SSG daemon — the assignment log lives on the operator's machine. Open this page in SigmaShake Desktop.",
      );
    },
    async runScript() {
      throw new CapabilityError("Running scripts requires a local SSG daemon.");
    },
    async readFile() {
      throw new CapabilityError("Reading project files requires a local SSG daemon.");
    },
    async writeFile() {
      throw new CapabilityError("Editing project files requires a local SSG daemon.");
    },
    async createProject() {
      throw new CapabilityError(
        "Creating a new app requires a local SSG daemon. Install SigmaShake Desktop or open this page from a machine running `ssg serve`.",
      );
    },
    async listInfrastructure(): Promise<InfraGraph> {
      // The infrastructure graph names every internal worker, D1/KV/R2 id,
      // queue, Durable Object, dispatch namespace, and cron in the monorepo
      // — it's a reconnaissance map. The cloud surface has no SSO gate, so
      // we never expose it from the public Worker; the local + electrobun
      // runtimes scan wrangler.toml live and return the real graph instead.
      throw new CapabilityError(
        "The service map needs SigmaShake running on your computer so it can read your project configs. Open Workspace in the SigmaShake desktop app.",
      );
    },
    async getDistribution() {
      throw new CapabilityError(
        "Distribution status needs SigmaShake running on your computer. Open Workspace in the SigmaShake desktop app, or from SigmaShake on the machine that builds your releases.",
      );
    },
    async triggerSync() {
      throw new CapabilityError(
        "Triggering a release needs SigmaShake running on your computer. Open Workspace in the SigmaShake desktop app.",
      );
    },
    async getSession(): Promise<SessionInfo | null> {
      const res = await fetch("/api/session/me", { credentials: "same-origin" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`session: ${res.status}`);
      return res.json();
    },
    async getSettings(): Promise<WorkspaceSettings> {
      // Cloud has no per-user server-side store yet — KV/DO sync is a v2
      // follow-up. localStorage gives the operator a stable per-browser
      // choice today and the Worker keeps zero state.
      return readLocalSettings();
    },
    async setSettings(patch: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
      const next = mergeSettings(readLocalSettings(), patch);
      writeLocalSettings(next);
      return next;
    },
    async getContextUsage(): Promise<ContextUsage> {
      // Context usage walks the user's filesystem (CLAUDE.md, ~/.claude/skills,
      // memory pages). A public Worker has none of that — the cloud surface
      // surfaces the CloudGate interstitial instead.
      throw new CapabilityError(
        "Context usage needs SigmaShake running on your computer so it can read your project files. Open Workspace in the SigmaShake desktop app.",
      );
    },
    async getFleetStatus(): Promise<FleetStatus> {
      const base = emptyEnrollmentStatus();
      return { ...base, reachability: await probeFleetReachability() };
    },
    async getFleetOverview(slug: string): Promise<FleetOverview> {
      return fetchFleetOverview(slug);
    },
    async autoEnrollFleet(): Promise<FleetStatus> {
      throw new CapabilityError(
        "Connecting this machine to Fleet needs SigmaShake running on your computer so it can store the agent JWT. Open Workspace in the SigmaShake desktop app.",
      );
    },
    async getCertification(): Promise<CertificationResponse> {
      throw new CapabilityError(
        "SDLC certification needs SigmaShake running on your computer so it can scan project sentinels. Open Workspace in the SigmaShake desktop app.",
      );
    },
    async getAiNative(): Promise<AiNativeResponse> {
      // The AI-native scan reads each project's tree and probes the operator's
      // loopback ports for live latency — a public Worker can do neither.
      throw new CapabilityError(
        "The AI Native check needs SigmaShake running on your computer so it can scan project files and measure local response times. Open Workspace in the SigmaShake desktop app.",
      );
    },
    async getReadiness(): Promise<ReadinessResponse> {
      // The cloud Worker ships a build-time snapshot of
      // .sigmashake/production-readiness.json (manual + path-exists checks
      // evaluated at build time; cert-signal checks resolve to "unknown"
      // because the cert scanner needs the operator's tree). The local +
      // electrobun + vscode runtimes still get live cert-signal evaluation
      // from the SSG daemon.
      const res = await fetch("/api/workspace/readiness", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`readiness: ${res.status}`);
      return res.json();
    },
    async getTestReport(): Promise<TestReportBundle> {
      // Test reports are `.last-test-report-<kind>.json` files the daemon
      // writes after each /workspace/run — a public Worker has no filesystem.
      throw new CapabilityError(
        "Test reports need SigmaShake running on your computer so it can read each project's recorded test runs. Open Workspace in the SigmaShake desktop app.",
      );
    },
    async getInbox(): Promise<InboxSnapshot> {
      const res = await fetch("/api/workspace/inbox", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`inbox: ${res.status}`);
      return res.json();
    },
    async replyTicket(ticketId, body, visibility = "public") {
      await postJsonOrThrow(
        `/api/workspace/inbox/tickets/${encodeURIComponent(ticketId)}/messages`,
        {
          body_md: body,
          visibility,
        },
      );
    },
    async closeTicket(ticketId, resolutionNote) {
      await postJsonOrThrow(`/api/workspace/inbox/tickets/${encodeURIComponent(ticketId)}/close`, {
        resolution_note: resolutionNote,
      });
    },
    async patchTicket(ticketId, patch) {
      await patchJsonOrThrow(`/api/workspace/inbox/tickets/${encodeURIComponent(ticketId)}`, patch);
    },
    async patchLead(leadId, patch) {
      await patchJsonOrThrow(`/api/workspace/inbox/leads/${encodeURIComponent(leadId)}`, patch);
    },
    async getObservability(): Promise<ObservBoard> {
      const res = await fetch("/api/workspace/observability", { credentials: "same-origin" });
      if (!res.ok) throw new Error(`observability: ${res.status}`);
      return res.json();
    },
    async getPlatformParity(): Promise<PlatformParityResponse> {
      // The cloud surface ships a build-time catalog so the matrix can render
      // even without a daemon. Each cell carries status="unknown" with
      // evidence pointing at SigmaShake Desktop — auto-probes need the
      // operator's machine, manual attestations need the desktop UI's
      // recording form.
      const res = await fetch("/api/workspace/platform-parity", {
        credentials: "same-origin",
      });
      if (!res.ok) throw new Error(`platform-parity: ${res.status}`);
      return res.json();
    },
    async runPlatformParity(): Promise<PlatformParityResponse> {
      throw new CapabilityError(
        "Running platform-parity probes needs SigmaShake running on your computer — the auto-checks read this machine's filesystem and OS state. Open Workspace in the SigmaShake desktop app.",
      );
    },
    async attestPlatformParity(): Promise<PlatformParityResponse> {
      throw new CapabilityError(
        "Recording a platform-parity attestation needs SigmaShake running on your computer — the verdict is written to ~/.sigmashake/platform-parity.json. Open Workspace in the SigmaShake desktop app.",
      );
    },
  };
}

async function postJsonOrThrow(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`${path}: ${res.status} ${detail}`);
  }
}

async function patchJsonOrThrow(path: string, body: unknown): Promise<void> {
  const res = await fetch(path, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = await readErrorDetail(res);
    throw new Error(`${path}: ${res.status} ${detail}`);
  }
}

async function readErrorDetail(res: Response): Promise<string> {
  try {
    const j = (await res.json()) as { message?: string; error?: string };
    return j.message ?? j.error ?? "";
  } catch {
    return "";
  }
}
