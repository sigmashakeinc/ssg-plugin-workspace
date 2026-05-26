// Local runtime — talks to the SSG daemon's /api/json/workspace/* endpoints.
// The daemon injects window.__WORKSPACE_CONFIG__ with the port + token before
// the bundle runs, so we read those at module load.

import {
  emptyEnrollmentStatus,
  fetchFleetOverview,
  mintEnrollmentGrant,
  probeFleetReachability,
} from "../lib/fleet-probe";
import { CapabilityError, type RunHandle, type WorkspaceApiClient } from "./client";
import {
  mergeSettings,
  normalizeSettings,
  readLocalSettings,
  writeLocalSettings,
} from "./settings-store";
import type {
  AiNativeResponse,
  AttentionDetails,
  CertificationResponse,
  ContextUsage,
  CreateProjectRequest,
  DistributionData,
  DistributionSyncResult,
  EditRequest,
  FleetEnrollment,
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
  TestReportBundle,
  WorkspaceSettings,
} from "./types";

// localStorage key mirrored from App.tsx — the active monorepo root the user
// picked in the topbar. Reading it here means per-project endpoints (health,
// edit, run) target the same directory as the project grid, without having to
// thread the root through every component.
const ROOT_LS_KEY = "ssg:workspace:root";

function config() {
  const cfg = typeof window !== "undefined" ? window.__WORKSPACE_CONFIG__ : null;
  const port = cfg?.port ?? (Number(location.port) || 0);
  const token = cfg?.token ?? "";
  const origin = `${location.protocol}//${location.hostname}${port ? `:${port}` : ""}`;
  let root = cfg?.root;
  if (typeof window !== "undefined") {
    try {
      const stored = window.localStorage?.getItem(ROOT_LS_KEY);
      if (stored?.trim()) root = stored.trim();
    } catch {
      // localStorage may be unavailable (private mode, etc.) — fall back to cfg
    }
  }
  return { origin, token, root };
}

// Builds a URL with a `root` query param when one is configured. Per-project
// endpoints (health, edit, run, etc.) all support the same param.
function urlWithRoot(origin: string, path: string, extra: Record<string, string> = {}): URL {
  const { root } = config();
  const url = new URL(`${origin}${path}`);
  if (root) url.searchParams.set("root", root);
  for (const [k, v] of Object.entries(extra)) url.searchParams.set(k, v);
  return url;
}

function headers(extra: Record<string, string> = {}): HeadersInit {
  const { token } = config();
  return {
    "Content-Type": "application/json",
    ...(token ? { "X-SigmaShake-Token": token } : {}),
    ...extra,
  };
}

// A SigmaShake daemon that predates a given /api/json route doesn't 404 it —
// the request falls through to the workspace SPA catch-all and comes back as
// index.html with a 200. Without this guard, callers run res.json() on
// "<!DOCTYPE html>" and surface a cryptic "JSON.parse: unexpected character"
// error. Treat a non-JSON body on a JSON endpoint as "restart SigmaShake".
function assertJsonResponse(res: Response, label: string): void {
  const ctype = res.headers.get("content-type") ?? "";
  if (!ctype.includes("application/json")) {
    throw new Error(
      `${label} needs a newer version of SigmaShake than the one running ` +
        `on this machine — restart SigmaShake to pick up the update.`,
    );
  }
}

export function createLocalClient(): WorkspaceApiClient {
  return {
    runtime: "local",
    hasLocalCapabilities: true,
    async listProjects(root?: string): Promise<ProjectsResponse> {
      const { origin, root: defaultRoot } = config();
      const r = root ?? defaultRoot;
      const url = new URL(`${origin}/api/json/workspace/projects`);
      if (r) url.searchParams.set("root", r);
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`projects: ${res.status}`);
      return res.json();
    },
    async getHealth(slugs: string[]): Promise<Record<string, HealthSummary>> {
      const { origin } = config();
      const url = urlWithRoot(origin, "/api/json/workspace/health", {
        projects: slugs.join(","),
      });
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`health: ${res.status}`);
      const body = (await res.json()) as { health: Record<string, HealthSummary> };
      return body.health;
    },
    async getAttentionDetails(slug: string): Promise<AttentionDetails> {
      const { origin } = config();
      const url = urlWithRoot(origin, "/api/json/workspace/attention-details", {
        slug,
      });
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`attention-details: ${res.status}`);
      return (await res.json()) as AttentionDetails;
    },
    async assignAi(
      slug: string,
      kind: "fix-tests" | "fix-deploy" | "fix-build" | "push" | "investigate",
      reason?: string,
    ): Promise<void> {
      const { origin } = config();
      const url = urlWithRoot(origin, "/api/json/workspace/ai-assign");
      const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ slug, kind, reason }),
      });
      if (!res.ok) throw new Error(`ai-assign: ${res.status}`);
    },
    async runScript(project: string, script: string): Promise<RunHandle> {
      const { origin } = config();
      const url = urlWithRoot(origin, "/api/json/workspace/run");
      const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({ project, script }),
      });
      if (!res.ok) throw new Error(`run: ${res.status}`);
      const { jobId } = (await res.json()) as { jobId: string };
      return {
        jobId,
        events: streamRun(origin, jobId),
        async cancel() {
          await fetch(`${origin}/api/json/workspace/run/${jobId}/cancel`, {
            method: "POST",
            headers: headers(),
          });
        },
      };
    },
    async readFile(project: string, file: EditRequest["file"]): Promise<string> {
      const { origin } = config();
      const url = urlWithRoot(origin, "/api/json/workspace/edit", {
        project,
        file,
      });
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`read: ${res.status}`);
      const body = (await res.json()) as { content: string };
      return body.content;
    },
    async writeFile(req: EditRequest): Promise<void> {
      const { origin } = config();
      const url = urlWithRoot(origin, "/api/json/workspace/edit");
      const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(req),
      });
      if (!res.ok) throw new Error(`write: ${res.status}`);
    },
    async createProject(req: CreateProjectRequest): Promise<ProjectCard> {
      const { origin, root } = config();
      const url = new URL(`${origin}/api/json/workspace/create`);
      if (root) url.searchParams.set("root", root);
      const res = await fetch(url, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(req),
      });
      const body = (await res.json().catch(() => ({}))) as {
        project?: ProjectCard;
        error?: string;
      };
      if (!res.ok || !body.project) {
        throw new Error(body.error ?? `create: ${res.status}`);
      }
      return body.project;
    },
    async listInfrastructure(root?: string): Promise<InfraGraph> {
      const { origin, root: defaultRoot } = config();
      const r = root ?? defaultRoot;
      const url = new URL(`${origin}/api/json/workspace/infrastructure`);
      if (r) url.searchParams.set("root", r);
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`infrastructure: ${res.status}`);
      return res.json();
    },
    async getDistribution(root?: string): Promise<DistributionData> {
      const { origin, root: defaultRoot } = config();
      const r = root ?? defaultRoot;
      const url = new URL(`${origin}/api/json/workspace/distribution`);
      if (r) url.searchParams.set("root", r);
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`distribution: ${res.status}`);
      assertJsonResponse(res, "The Distribution view");
      return res.json();
    },
    async triggerSync(): Promise<DistributionSyncResult> {
      const { origin } = config();
      const res = await fetch(`${origin}/api/json/workspace/distribution/sync`, {
        method: "POST",
        headers: headers(),
      });
      assertJsonResponse(res, "Triggering a release");
      const body = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        version?: string;
        error?: string;
      };
      if (!res.ok || !body.jobId) {
        throw new Error(body.error ?? `sync: ${res.status}`);
      }
      return { jobId: body.jobId, version: body.version ?? "" };
    },
    async getSession() {
      // Local runtime is gated by the SSG dashboard token (X-SigmaShake-Token),
      // not by accounts.sigmashake.com. Surface a stable "local operator"
      // stub so the TopBar can show *something*; the cloud client is the
      // only one that round-trips to /api/session/me.
      return {
        userId: "local",
        login: "local operator",
        authType: "dashboard-token",
      };
    },
    async getSettings(): Promise<WorkspaceSettings> {
      const { origin } = config();
      const fallback = readLocalSettings();
      try {
        const res = await fetch(`${origin}/api/json/workspace/settings`, {
          headers: headers(),
        });
        if (!res.ok) return fallback;
        assertJsonResponse(res, "Workspace settings");
        const body = (await res.json()) as { settings?: unknown };
        const next = normalizeSettings(body.settings);
        writeLocalSettings(next);
        return next;
      } catch {
        return fallback;
      }
    },
    async getContextUsage(project: string): Promise<ContextUsage> {
      const { origin } = config();
      const url = urlWithRoot(origin, "/api/json/workspace/context", { project });
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`context: ${res.status}`);
      assertJsonResponse(res, "The Context view");
      const body = (await res.json()) as { usage?: ContextUsage; error?: string };
      if (!body.usage) {
        throw new Error(body.error ?? "context: missing usage");
      }
      return body.usage;
    },
    async getFleetStatus(): Promise<FleetStatus> {
      const { origin } = config();
      const base = emptyEnrollmentStatus();
      const [reachability, enrollment] = await Promise.all([
        probeFleetReachability(),
        readLocalEnrollment(origin),
      ]);
      return { ...base, reachability, enrollment };
    },
    async getFleetOverview(slug: string): Promise<FleetOverview> {
      return fetchFleetOverview(slug);
    },
    async autoEnrollFleet(slug: string, label?: string): Promise<FleetStatus> {
      const grant = await mintEnrollmentGrant(slug);
      const { origin } = config();
      const res = await fetch(`${origin}/api/json/workspace/fleet/auto-enroll`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          fleetUrl: `https://${slug}.fleet.sigmashake.com`,
          enrollmentBearer: grant.enrollmentBearer,
          ...(label ? { label } : {}),
        }),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `auto-enroll: ${res.status}`);
      }
      assertJsonResponse(res, "Fleet auto-enroll");
      const body = (await res.json()) as { enrollment?: FleetEnrollment };
      const base = emptyEnrollmentStatus();
      const reachability = await probeFleetReachability();
      return { ...base, reachability, enrollment: body.enrollment ?? null };
    },
    async setSettings(patch: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
      const merged = mergeSettings(readLocalSettings(), patch);
      writeLocalSettings(merged);
      const { origin } = config();
      // localStorage already has the merged value, so the network round-trip
      // is best-effort. Cap it at 3s so a wedged daemon never strands the
      // Saving… spinner on the welcome modal.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 3000);
      try {
        const res = await fetch(`${origin}/api/json/workspace/settings`, {
          method: "PUT",
          headers: headers(),
          body: JSON.stringify(merged),
          signal: ctrl.signal,
        });
        if (res.ok) {
          assertJsonResponse(res, "Workspace settings");
          const body = (await res.json()) as { settings?: unknown };
          const echoed = normalizeSettings(body.settings);
          writeLocalSettings(echoed);
          return echoed;
        }
      } catch {
        // Daemon predates the route, didn't answer in 3s, or aborted —
        // localStorage covers us either way.
      } finally {
        clearTimeout(timer);
      }
      return merged;
    },
    async getCertification(slugs?: string[]): Promise<CertificationResponse> {
      const { origin } = config();
      const extra: Record<string, string> = {};
      if (slugs && slugs.length > 0) extra.projects = slugs.join(",");
      const url = urlWithRoot(origin, "/api/json/workspace/certify", extra);
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`certify: ${res.status}`);
      assertJsonResponse(res, "SDLC certification");
      return res.json();
    },
    async getAiNative(slugs?: string[]): Promise<AiNativeResponse> {
      const { origin } = config();
      const extra: Record<string, string> = {};
      if (slugs && slugs.length > 0) extra.projects = slugs.join(",");
      const url = urlWithRoot(origin, "/api/json/workspace/ai-native", extra);
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`ai-native: ${res.status}`);
      assertJsonResponse(res, "The AI Native view");
      return res.json();
    },
    async getReadiness(): Promise<ReadinessResponse> {
      const { origin } = config();
      const url = urlWithRoot(origin, "/api/json/workspace/readiness");
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`readiness: ${res.status}`);
      assertJsonResponse(res, "The Production Readiness view");
      return res.json();
    },
    async getTestReport(slug: string): Promise<TestReportBundle> {
      const { origin } = config();
      const url = urlWithRoot(origin, "/api/json/workspace/test-report", {
        project: slug,
      });
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`test-report: ${res.status}`);
      assertJsonResponse(res, "Test reports");
      return res.json();
    },
    async getInbox(): Promise<InboxSnapshot> {
      // The Inbox aggregator holds the support agent bearer + the sales
      // service binding — both are workspace-Worker-side secrets. The local
      // SSG daemon has no copy, so we surface the CloudGate path instead.
      throw new CapabilityError(inboxCloudOnlyMessage());
    },
    async replyTicket() {
      throw new CapabilityError(inboxCloudOnlyMessage());
    },
    async closeTicket() {
      throw new CapabilityError(inboxCloudOnlyMessage());
    },
    async patchTicket() {
      throw new CapabilityError(inboxCloudOnlyMessage());
    },
    async patchLead() {
      throw new CapabilityError(inboxCloudOnlyMessage());
    },
    async getObservability(): Promise<ObservBoard> {
      // The Observability board reads sigmashake-observ through the OBSERV
      // service binding, which only the workspace Cloudflare Worker holds. The
      // local SSG daemon has no copy, so surface the CloudGate path.
      throw new CapabilityError(observabilityCloudOnlyMessage());
    },
    async getPlatformParity(): Promise<PlatformParityResponse> {
      const { origin } = config();
      const url = new URL(`${origin}/api/json/workspace/platform-parity`);
      const res = await fetch(url, { headers: headers() });
      if (!res.ok) throw new Error(`platform-parity: ${res.status}`);
      assertJsonResponse(res, "Platform parity");
      return res.json();
    },
    async runPlatformParity(req?: PlatformParityRunRequest): Promise<PlatformParityResponse> {
      const { origin } = config();
      const res = await fetch(`${origin}/api/json/workspace/platform-parity/run`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(req ?? {}),
      });
      if (!res.ok) throw new Error(`platform-parity/run: ${res.status}`);
      assertJsonResponse(res, "Platform parity");
      const body = (await res.json()) as { snapshot: PlatformParityResponse };
      return body.snapshot;
    },
    async attestPlatformParity(
      req: PlatformParityAttestRequest,
    ): Promise<PlatformParityResponse> {
      const { origin } = config();
      const res = await fetch(`${origin}/api/json/workspace/platform-parity/attest`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(req),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `platform-parity/attest: ${res.status}`);
      }
      assertJsonResponse(res, "Platform parity");
      const body = (await res.json()) as { snapshot: PlatformParityResponse };
      return body.snapshot;
    },
  };
}

function inboxCloudOnlyMessage(): string {
  return "The unified Inbox lives on workspace.sigmashake.com — it needs the support API bearer and the sales service binding that only the Cloudflare Worker holds. Open https://workspace.sigmashake.com/ to view tickets and leads.";
}

function observabilityCloudOnlyMessage(): string {
  return "The Observability board lives on workspace.sigmashake.com — it reads sigmashake-observ through the OBSERV service binding that only the Cloudflare Worker holds. Open https://workspace.sigmashake.com/ to see platform service health.";
}

// Probe the SSG daemon for this-machine Fleet agent enrollment. Returns null
// when the daemon predates the route (older SigmaShake) — the panel falls
// back to "not enrolled here" without raising an error.
async function readLocalEnrollment(origin: string): Promise<FleetEnrollment | null> {
  try {
    const res = await fetch(`${origin}/api/json/workspace/fleet/status`, {
      headers: headers(),
    });
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("application/json")) return null;
    const body = (await res.json()) as { enrollment?: FleetEnrollment };
    return body.enrollment ?? null;
  } catch {
    return null;
  }
}

async function* streamRun(origin: string, jobId: string) {
  const res = await fetch(`${origin}/api/json/workspace/run/${jobId}/stream`, {
    headers: headers({ Accept: "text/event-stream" }),
  });
  if (!res.body) throw new Error("stream: no body");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      yield { line: "", done: true };
      return;
    }
    buffer += dec.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const ev of events) {
      const dataLine = ev.split("\n").find((l) => l.startsWith("data:"));
      if (!dataLine) continue;
      try {
        const payload = JSON.parse(dataLine.slice(5).trim()) as {
          line: string;
          done: boolean;
          exitCode?: number;
        };
        yield payload;
        if (payload.done) return;
      } catch {
        // ignore malformed events
      }
    }
  }
}
