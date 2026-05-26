// Electrobun runtime — the React app runs inside a sigmashake-electrobun
// BrowserWindow and reaches the bun main process over Electroview RPC.
//
// The view shell (sigmashake-electrobun/src/views/workspace/index.ts) sets
// up the RPC bridge and stashes it on window.__WORKSPACE_VIEW__. We grab
// that handle here lazily — it may not be present on the very first tick
// because index.ts and app.js are loaded as parallel module scripts.

import {
  emptyEnrollmentStatus,
  fetchFleetOverview,
  mintEnrollmentGrant,
  probeFleetReachability,
} from "../lib/fleet-probe";
import { CapabilityError, type RunHandle, type WorkspaceApiClient } from "./client";
import { mergeSettings, readLocalSettings, writeLocalSettings } from "./settings-store";
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

// Mirrors App.tsx + local.ts: the active monorepo root the operator picked (or
// typed) in the topbar, persisted to localStorage. Historically the electrobun
// client read the root *only* from getRuntimeConfig() — i.e. the daemon's
// SSG_WORKSPACE_ROOT, which the desktop never sets — so the SDLC-cert /
// AI-native / readiness checks always scanned the daemon's app-bundle cwd and
// never followed the folder the user selected. That made the project directory
// effectively "not selectable" for the checks. Reading the picked root here
// brings electrobun to parity with the local-web client (which already does
// this in its config() helper).
const ROOT_LS_KEY = "ssg:workspace:root";

export function pickedRoot(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.localStorage?.getItem(ROOT_LS_KEY)?.trim() ?? "";
  } catch {
    // localStorage may be unavailable (private mode, sandboxed view, etc.).
    return "";
  }
}

/**
 * The root to scan for a daemon request: the operator's picked/typed root when
 * set, otherwise the runtime default from getRuntimeConfig() (which the bun
 * side resolves to homedir() unless SSG_WORKSPACE_ROOT is set).
 */
export function effectiveRoot(cfgRoot: string | null | undefined): string {
  return pickedRoot() || (cfgRoot ?? "");
}

interface ElectrobunView {
  rpc: {
    request: {
      listProjects(args: { root?: string }): Promise<{
        ok: boolean;
        root?: string;
        projects?: ProjectsResponse["projects"];
        error?: string;
      }>;
      getHealth(args: { slugs: string[] }): Promise<{
        ok: boolean;
        health?: Record<string, HealthSummary>;
        error?: string;
      }>;
      runScript(args: { project: string; script: string }): Promise<{
        ok: boolean;
        jobId?: string;
        error?: string;
      }>;
      cancelRun(args: { jobId: string }): Promise<{ ok: boolean }>;
      readFile(args: {
        project: string;
        file: EditRequest["file"];
      }): Promise<{ ok: boolean; content?: string; error?: string }>;
      writeFile(args: EditRequest): Promise<{ ok: boolean; error?: string }>;
      getRuntimeConfig(args: {}): Promise<{
        port: number | null;
        token: string | null;
        root: string | null;
      }>;
      pickDirectory(args: { startDir?: string; title?: string }): Promise<{
        ok: boolean;
        path?: string;
        reason?: string;
      }>;
      createProject(args: CreateProjectRequest): Promise<{
        ok: boolean;
        project?: ProjectCard;
        error?: string;
      }>;
      listInfrastructure(args: { root?: string }): Promise<{
        ok: boolean;
        graph?: InfraGraph;
        error?: string;
      }>;
      getDistribution(args: { root?: string }): Promise<{
        ok: boolean;
        distribution?: DistributionData;
        error?: string;
      }>;
      triggerSync(args: Record<string, never>): Promise<{
        ok: boolean;
        jobId?: string;
        version?: string;
        error?: string;
      }>;
      getContextUsage(args: { project: string; root?: string }): Promise<{
        ok: boolean;
        usage?: ContextUsage;
        error?: string;
      }>;
      getFleetEnrollment(args: Record<string, never>): Promise<{
        ok: boolean;
        enrollment?: FleetEnrollment | null;
        error?: string;
      }>;
    };
  };
}

async function getView(timeoutMs = 5_000): Promise<ElectrobunView> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = (window as unknown as { __WORKSPACE_VIEW__?: ElectrobunView }).__WORKSPACE_VIEW__;
    if (v) return v;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("Electroview bridge not available");
}

function unwrap<T>(res: { ok: boolean; error?: string } & T): T {
  if (!res.ok) {
    throw new Error(res.error ?? "rpc failed");
  }
  return res;
}

export function createElectrobunClient(): WorkspaceApiClient {
  return {
    runtime: "electrobun",
    hasLocalCapabilities: true,
    async listProjects(root?: string): Promise<ProjectsResponse> {
      const view = await getView();
      const res = await view.rpc.request.listProjects({ root });
      unwrap(res);
      return { root: res.root ?? "", projects: res.projects ?? [] };
    },
    async getHealth(slugs: string[]) {
      const view = await getView();
      const res = await view.rpc.request.getHealth({ slugs });
      unwrap(res);
      return res.health ?? {};
    },
    async getAttentionDetails(slug: string): Promise<AttentionDetails> {
      // Round-trip via HTTP rather than wiring a new RPC method — same
      // pattern as getCertification() below. The daemon endpoint is the
      // single source of truth and the request adds <2 ms from inside the
      // BrowserWindow.
      const view = await getView();
      const cfg = await view.rpc.request.getRuntimeConfig({});
      if (!cfg.port) {
        throw new Error("SSG daemon port unavailable from electrobun runtime");
      }
      const origin = `http://127.0.0.1:${cfg.port}`;
      const url = new URL(`${origin}/api/json/workspace/attention-details`);
      url.searchParams.set("slug", slug);
      const scanRoot = effectiveRoot(cfg.root);
      if (scanRoot) url.searchParams.set("root", scanRoot);
      const init: RequestInit = {};
      if (cfg.token) init.headers = { "X-SigmaShake-Token": cfg.token };
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`attention-details: ${res.status}`);
      return (await res.json()) as AttentionDetails;
    },
    async assignAi(
      slug: string,
      kind: "fix-tests" | "fix-deploy" | "fix-build" | "push" | "investigate",
      reason?: string,
    ): Promise<void> {
      const view = await getView();
      const cfg = await view.rpc.request.getRuntimeConfig({});
      if (!cfg.port) {
        throw new Error("SSG daemon port unavailable from electrobun runtime");
      }
      const origin = `http://127.0.0.1:${cfg.port}`;
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (cfg.token) headers["X-SigmaShake-Token"] = cfg.token;
      const res = await fetch(`${origin}/api/json/workspace/ai-assign`, {
        method: "POST",
        headers,
        body: JSON.stringify({ slug, kind, reason }),
      });
      if (!res.ok) throw new Error(`ai-assign: ${res.status}`);
    },
    async runScript(project: string, script: string): Promise<RunHandle> {
      const view = await getView();
      const res = await view.rpc.request.runScript({ project, script });
      unwrap(res);
      const jobId = res.jobId!;
      // The bun side pushes runOutput messages; the view shell re-emits them
      // as a CustomEvent so we can subscribe with a normal event listener.
      const queue: Array<{
        line: string;
        done: boolean;
        exitCode?: number;
      }> = [];
      const resolvers: Array<
        (
          v: IteratorResult<{
            line: string;
            done: boolean;
            exitCode?: number;
          }>,
        ) => void
      > = [];
      function flush() {
        while (queue.length && resolvers.length) {
          const ev = queue.shift()!;
          const r = resolvers.shift()!;
          r({ value: ev, done: false });
          if (ev.done) {
            window.removeEventListener("workspace:runOutput", listener);
            // Drain remaining resolvers with done=true.
            while (resolvers.length) {
              const stragger = resolvers.shift()!;
              stragger({
                value: undefined as unknown as { line: string; done: boolean },
                done: true,
              });
            }
          }
        }
      }
      const listener = (e: Event) => {
        const detail = (e as CustomEvent).detail as {
          jobId: string;
          line: string;
          done: boolean;
          exitCode?: number;
        };
        if (detail.jobId !== jobId) return;
        queue.push(detail);
        flush();
      };
      window.addEventListener("workspace:runOutput", listener as EventListener);
      const events: AsyncIterable<{
        line: string;
        done: boolean;
        exitCode?: number;
      }> = {
        [Symbol.asyncIterator]() {
          return {
            next() {
              return new Promise<
                IteratorResult<{
                  line: string;
                  done: boolean;
                  exitCode?: number;
                }>
              >((resolve) => {
                resolvers.push(resolve);
                flush();
              });
            },
            async return() {
              window.removeEventListener("workspace:runOutput", listener as EventListener);
              return { value: undefined, done: true };
            },
          };
        },
      };
      return {
        jobId,
        events,
        async cancel() {
          await view.rpc.request.cancelRun({ jobId });
        },
      };
    },
    async readFile(project: string, file: EditRequest["file"]): Promise<string> {
      const view = await getView();
      const res = await view.rpc.request.readFile({ project, file });
      unwrap(res);
      return res.content ?? "";
    },
    async writeFile(req: EditRequest): Promise<void> {
      const view = await getView();
      const res = await view.rpc.request.writeFile(req);
      unwrap(res);
    },
    async pickDirectory(startDir?: string): Promise<string | null> {
      const view = await getView();
      const res = await view.rpc.request.pickDirectory({
        startDir,
        title: "Choose your monorepo folder",
      });
      if (res.ok && res.path) return res.path;
      return null;
    },
    async createProject(req: CreateProjectRequest): Promise<ProjectCard> {
      const view = await getView();
      const res = await view.rpc.request.createProject(req);
      if (!res.ok || !res.project) {
        throw new Error(res.error ?? "create failed");
      }
      return res.project;
    },
    async listInfrastructure(root?: string): Promise<InfraGraph> {
      const view = await getView();
      const res = await view.rpc.request.listInfrastructure({ root });
      if (!res.ok || !res.graph) {
        throw new Error(res.error ?? "infrastructure failed");
      }
      return res.graph;
    },
    async getDistribution(root?: string): Promise<DistributionData> {
      const view = await getView();
      const res = await view.rpc.request.getDistribution({ root });
      if (!res.ok || !res.distribution) {
        throw new Error(res.error ?? "distribution failed");
      }
      return res.distribution;
    },
    async triggerSync(): Promise<DistributionSyncResult> {
      const view = await getView();
      const res = await view.rpc.request.triggerSync({});
      if (!res.ok || !res.jobId) {
        throw new Error(res.error ?? "sync failed");
      }
      return { jobId: res.jobId, version: res.version ?? "" };
    },
    async getSession() {
      // Electrobun runs the dashboard locally on behalf of the operator —
      // there's no accounts.sigmashake.com cookie involved. Surface a stable
      // stub so the TopBar can show the active operator.
      return {
        userId: "local",
        login: "local operator",
        authType: "dashboard-token",
      };
    },
    async getSettings(): Promise<WorkspaceSettings> {
      // Electrobun-side settings RPC isn't wired yet — fall through to
      // localStorage. When the bun-host RPC ships, swap this for a
      // view.rpc.request.getSettings({}) round-trip so settings land in
      // ~/.sigmashake/workspace.json the same way the daemon path does.
      return readLocalSettings();
    },
    async setSettings(patch: Partial<WorkspaceSettings>): Promise<WorkspaceSettings> {
      const next = mergeSettings(readLocalSettings(), patch);
      writeLocalSettings(next);
      return next;
    },
    async getContextUsage(project: string): Promise<ContextUsage> {
      const view = await getView();
      const res = await view.rpc.request.getContextUsage({ project });
      if (!res.ok || !res.usage) {
        throw new Error(res.error ?? "context failed");
      }
      return res.usage;
    },
    async getFleetStatus(): Promise<FleetStatus> {
      const base = emptyEnrollmentStatus();
      const [reachability, enrollment] = await Promise.all([
        probeFleetReachability(),
        readEnrollmentViaRpc(),
      ]);
      return { ...base, reachability, enrollment };
    },
    async getFleetOverview(slug: string): Promise<FleetOverview> {
      return fetchFleetOverview(slug);
    },
    async autoEnrollFleet(slug: string, label?: string): Promise<FleetStatus> {
      const grant = await mintEnrollmentGrant(slug);
      const view = await getView();
      const cfg = await view.rpc.request.getRuntimeConfig({});
      if (!cfg.port) {
        throw new Error("SSG daemon port unavailable from electrobun runtime");
      }
      const origin = `http://127.0.0.1:${cfg.port}`;
      const init: RequestInit = {
        method: "POST",
        headers: cfg.token
          ? { "Content-Type": "application/json", "X-SigmaShake-Token": cfg.token }
          : { "Content-Type": "application/json" },
        body: JSON.stringify({
          fleetUrl: `https://${slug}.fleet.sigmashake.com`,
          enrollmentBearer: grant.enrollmentBearer,
          ...(label ? { label } : {}),
        }),
      };
      const res = await fetch(`${origin}/api/json/workspace/fleet/auto-enroll`, init);
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `auto-enroll: ${res.status}`);
      }
      const body = (await res.json()) as { enrollment?: FleetEnrollment };
      const base = emptyEnrollmentStatus();
      const reachability = await probeFleetReachability();
      return { ...base, reachability, enrollment: body.enrollment ?? null };
    },
    async getCertification(slugs?: string[]): Promise<CertificationResponse> {
      // Electrobun shares the SSG daemon port + token with the local-web
      // flow. Round-trip via HTTP rather than adding a new RPC method — the
      // daemon endpoint is the single source of truth and the request adds
      // <2 ms of overhead from inside the BrowserWindow.
      const view = await getView();
      const cfg = await view.rpc.request.getRuntimeConfig({});
      if (!cfg.port) {
        throw new Error("SSG daemon port unavailable from electrobun runtime");
      }
      const origin = `http://127.0.0.1:${cfg.port}`;
      const url = new URL(`${origin}/api/json/workspace/certify`);
      const scanRoot = effectiveRoot(cfg.root);
      if (scanRoot) url.searchParams.set("root", scanRoot);
      if (slugs && slugs.length > 0) {
        url.searchParams.set("projects", slugs.join(","));
      }
      const init: RequestInit = {};
      if (cfg.token) init.headers = { "X-SigmaShake-Token": cfg.token };
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`certify: ${res.status}`);
      return res.json();
    },
    async getAiNative(slugs?: string[]): Promise<AiNativeResponse> {
      // Same HTTP round-trip as getCertification() — the daemon endpoint owns
      // the filesystem scan + loopback latency probes; we just relay.
      const view = await getView();
      const cfg = await view.rpc.request.getRuntimeConfig({});
      if (!cfg.port) {
        throw new Error("SSG daemon port unavailable from electrobun runtime");
      }
      const origin = `http://127.0.0.1:${cfg.port}`;
      const url = new URL(`${origin}/api/json/workspace/ai-native`);
      const scanRoot = effectiveRoot(cfg.root);
      if (scanRoot) url.searchParams.set("root", scanRoot);
      if (slugs && slugs.length > 0) {
        url.searchParams.set("projects", slugs.join(","));
      }
      const init: RequestInit = {};
      if (cfg.token) init.headers = { "X-SigmaShake-Token": cfg.token };
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`ai-native: ${res.status}`);
      return res.json();
    },
    async getReadiness(): Promise<ReadinessResponse> {
      // Same HTTP round-trip as getCertification() — the daemon endpoint owns
      // the manifest read + cert scan; we just relay from inside the window.
      const view = await getView();
      const cfg = await view.rpc.request.getRuntimeConfig({});
      if (!cfg.port) {
        throw new Error("SSG daemon port unavailable from electrobun runtime");
      }
      const origin = `http://127.0.0.1:${cfg.port}`;
      const url = new URL(`${origin}/api/json/workspace/readiness`);
      const scanRoot = effectiveRoot(cfg.root);
      if (scanRoot) url.searchParams.set("root", scanRoot);
      const init: RequestInit = {};
      if (cfg.token) init.headers = { "X-SigmaShake-Token": cfg.token };
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`readiness: ${res.status}`);
      return res.json();
    },
    async getTestReport(slug: string): Promise<TestReportBundle> {
      // Same HTTP round-trip as getCertification() — the daemon endpoint owns
      // the `.last-test-report-<kind>.json` files; we just relay.
      const view = await getView();
      const cfg = await view.rpc.request.getRuntimeConfig({});
      if (!cfg.port) {
        throw new Error("SSG daemon port unavailable from electrobun runtime");
      }
      const origin = `http://127.0.0.1:${cfg.port}`;
      const url = new URL(`${origin}/api/json/workspace/test-report`);
      url.searchParams.set("project", slug);
      const scanRoot = effectiveRoot(cfg.root);
      if (scanRoot) url.searchParams.set("root", scanRoot);
      const init: RequestInit = {};
      if (cfg.token) init.headers = { "X-SigmaShake-Token": cfg.token };
      const res = await fetch(url, init);
      if (!res.ok) throw new Error(`test-report: ${res.status}`);
      return res.json();
    },
    async getInbox(): Promise<InboxSnapshot> {
      // The Inbox aggregator holds the support agent bearer + the sales
      // service binding — both are workspace-Worker-side secrets. The
      // electrobun host has no copy, so we surface the CloudGate path
      // instead. The InboxView component opens workspace.sigmashake.com in
      // the system browser when this fires.
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
      // electrobun host has no copy — surface the CloudGate path instead.
      throw new CapabilityError(observabilityCloudOnlyMessage());
    },
    async getPlatformParity(): Promise<PlatformParityResponse> {
      // Same HTTP relay as the other root-scoped checks — daemon owns the
      // probes and the persistence file.
      const view = await getView();
      const cfg = await view.rpc.request.getRuntimeConfig({});
      if (!cfg.port) {
        throw new Error("SSG daemon port unavailable from electrobun runtime");
      }
      const origin = `http://127.0.0.1:${cfg.port}`;
      const init: RequestInit = {};
      if (cfg.token) init.headers = { "X-SigmaShake-Token": cfg.token };
      const res = await fetch(`${origin}/api/json/workspace/platform-parity`, init);
      if (!res.ok) throw new Error(`platform-parity: ${res.status}`);
      return res.json();
    },
    async runPlatformParity(req?: PlatformParityRunRequest): Promise<PlatformParityResponse> {
      const view = await getView();
      const cfg = await view.rpc.request.getRuntimeConfig({});
      if (!cfg.port) {
        throw new Error("SSG daemon port unavailable from electrobun runtime");
      }
      const origin = `http://127.0.0.1:${cfg.port}`;
      const init: RequestInit = {
        method: "POST",
        headers: cfg.token
          ? { "Content-Type": "application/json", "X-SigmaShake-Token": cfg.token }
          : { "Content-Type": "application/json" },
        body: JSON.stringify(req ?? {}),
      };
      const res = await fetch(`${origin}/api/json/workspace/platform-parity/run`, init);
      if (!res.ok) throw new Error(`platform-parity/run: ${res.status}`);
      const body = (await res.json()) as { snapshot: PlatformParityResponse };
      return body.snapshot;
    },
    async attestPlatformParity(
      req: PlatformParityAttestRequest,
    ): Promise<PlatformParityResponse> {
      const view = await getView();
      const cfg = await view.rpc.request.getRuntimeConfig({});
      if (!cfg.port) {
        throw new Error("SSG daemon port unavailable from electrobun runtime");
      }
      const origin = `http://127.0.0.1:${cfg.port}`;
      const init: RequestInit = {
        method: "POST",
        headers: cfg.token
          ? { "Content-Type": "application/json", "X-SigmaShake-Token": cfg.token }
          : { "Content-Type": "application/json" },
        body: JSON.stringify(req),
      };
      const res = await fetch(`${origin}/api/json/workspace/platform-parity/attest`, init);
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(errBody.error ?? `platform-parity/attest: ${res.status}`);
      }
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

// Electrobun-side enrollment lookup. Falls back to null when the RPC hasn't
// been wired in the host process yet — the panel still renders, just without
// the local-agent block.
async function readEnrollmentViaRpc(): Promise<FleetEnrollment | null> {
  try {
    const view = await getView(500);
    const res = await view.rpc.request.getFleetEnrollment({});
    if (!res.ok) return null;
    return res.enrollment ?? null;
  } catch {
    return null;
  }
}
