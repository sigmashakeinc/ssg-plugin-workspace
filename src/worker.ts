// sigmashake-workspace — Cloudflare Worker at workspace.sigmashake.com.
//
// Serves the React/Vite SPA from the [assets] binding and exposes a tiny
// JSON API that returns the build-time project registry. Cloud is gated:
// every request runs through `requireOperator` first, which validates the
// `session_id` cookie minted by accounts.sigmashake.com against the shared
// SESSIONS KV (same gate sigmashake-support and sigmashake-calendar use).
//
// `run_worker_first = true` on the [assets] binding (see wrangler.toml) makes
// sure the auth middleware sees every request — without it the static SPA
// bundle would bypass the worker and leak to anyone who knows the URL.

import { Hono } from "hono";
import { getCookie } from "hono/cookie";

import { PLATFORM_PARITY_CATALOG } from "./platform-parity-catalog";
import { READINESS_REPORT } from "./readiness.generated";
import { PROJECTS_REGISTRY } from "./registry.generated";
import type {
  InboxLead,
  InboxSnapshot,
  InboxSourceStatus,
  InboxTicket,
  LeadClassification,
  LeadStatus,
  PlatformParityFeature,
  PlatformParityResponse,
  ProjectsResponse,
  SessionInfo,
  TicketSeverity,
  TicketStatus,
} from "./types";
import type { WorkerEnv } from "./worker-env";

type AppEnv = {
  Bindings: WorkerEnv;
  Variables: { session: SessionInfo };
};

const SHARED_SESSION_PREFIX = "session:";
const COOKIE_NAME = "session_id";
const ACCOUNTS_LOGIN = "https://accounts.sigmashake.com/auth/login";
const WORKSPACE_ORIGIN = "https://workspace.sigmashake.com";

interface SharedSession {
  userId: string | number;
  login: string;
  avatar?: string;
  authType?: string;
}

const app = new Hono<AppEnv>();

app.onError((err, c) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[workspace] ${c.req.method} ${c.req.path} — ${message}`);
  return c.json({ error: "internal", message }, 500);
});

function isOperator(env: WorkerEnv, userId: string): boolean {
  // Comma-separated allowlist so we can add additional operators without
  // redeploying code. Trim each entry, ignore blanks.
  const raw = env.ALLOWED_GITHUB_USER_IDS ?? "";
  for (const candidate of raw.split(",")) {
    const trimmed = candidate.trim();
    if (trimmed && trimmed === userId) return true;
  }
  return false;
}

async function lookupOperatorSession(
  env: WorkerEnv,
  sessionId: string,
): Promise<SessionInfo | null> {
  const session = await env.ACCOUNTS_SESSIONS.get<SharedSession>(
    SHARED_SESSION_PREFIX + sessionId,
    "json",
  ).catch(() => null);
  if (!session) return null;
  const userId = String(session.userId);
  if (!isOperator(env, userId)) return null;
  return {
    userId,
    login: session.login,
    avatar: session.avatar,
    authType: session.authType,
  };
}

function wantsJson(c: {
  req: { path: string; header: (name: string) => string | undefined };
}): boolean {
  if (c.req.path.startsWith("/api/")) return true;
  const accept = c.req.header("Accept") ?? "";
  return accept.includes("application/json") && !accept.includes("text/html");
}

function loginRedirect(requestUrl: string): Response {
  // Build the absolute return-to so the user lands back where they started
  // after signing in. accounts.sigmashake.com validates the URL is under
  // *.sigmashake.com before honoring it (isSafeReturnUrl).
  const url = new URL(requestUrl);
  const returnTo = `${WORKSPACE_ORIGIN}${url.pathname}${url.search}` || WORKSPACE_ORIGIN;
  const next = encodeURIComponent(returnTo);
  return Response.redirect(`${ACCOUNTS_LOGIN}?next=${next}`, 302);
}

// Anything inside this allowlist bypasses the auth gate. Keep it minimal —
// only health probes that need to work without a cookie. Even the SPA bundle
// requires auth so an unauthenticated visitor never sees app.js / app.css.
const PUBLIC_PATHS = new Set<string>(["/healthz"]);

app.use("*", async (c, next) => {
  if (PUBLIC_PATHS.has(c.req.path)) {
    return next();
  }

  const sessionId = getCookie(c, COOKIE_NAME);
  const session = sessionId ? await lookupOperatorSession(c.env, sessionId) : null;

  if (session) {
    c.set("session", session);
    return next();
  }

  if (wantsJson(c)) {
    return c.json(
      {
        error: "unauthorized",
        message:
          "Sign in at accounts.sigmashake.com — workspace is restricted to platform operators.",
      },
      401,
    );
  }
  return loginRedirect(c.req.url);
});

app.get("/healthz", (c) => c.text("ok", 200, { "Cache-Control": "no-store" }));

app.get("/api/session/me", (c) => {
  return c.json(c.get("session"), 200, { "Cache-Control": "no-store" });
});

// CORS preflight — same-origin from the SPA, but a few in-monorepo callers
// (the desktop view, the docs site, marketing pages) deep-link to
// workspace.sigmashake.com so we allow `*.sigmashake.com` and only
// `*.sigmashake.com`. Echoing back the Origin header + a `Vary: Origin`
// response keeps the cache key safe.
const SIGMASHAKE_ORIGIN_RE = /^https?:\/\/([a-z0-9-]+\.)?sigmashake\.com(:\d+)?$/i;

function workspaceCorsHeaders(req: Request): HeadersInit {
  const origin = req.headers.get("Origin") ?? "";
  if (!SIGMASHAKE_ORIGIN_RE.test(origin)) {
    return { Vary: "Origin" };
  }
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    Vary: "Origin",
  };
}

app.options("/api/*", (c) => {
  return new Response(null, {
    status: 204,
    headers: workspaceCorsHeaders(c.req.raw),
  });
});

app.get("/api/workspace/projects", (c) => {
  const payload: ProjectsResponse = {
    root: "/registry",
    projects: PROJECTS_REGISTRY,
  };
  return c.json(payload, 200, {
    "Cache-Control": "private, max-age=60",
  });
});

app.get("/api/workspace/infrastructure", (c) => {
  // The infrastructure graph names every internal worker + binding id; the
  // cloud surface deliberately doesn't serve it even to authenticated
  // operators. Local + electrobun runtimes scan wrangler.toml live through
  // the SSG daemon and never hit this endpoint.
  return c.json(
    {
      error: "local_only",
      message:
        "The service map needs SigmaShake running on your computer so it can read your project configs. Open Workspace in the SigmaShake desktop app.",
    },
    501,
  );
});

app.get("/api/workspace/health", (c) => {
  // Cloud has no view into local state — return 501 with a hint so the SPA
  // can surface the CloudGate interstitial without a network round-trip.
  return c.json(
    {
      error: "local_only",
      message:
        "Health requires a running SSG daemon. Open http://127.0.0.1:<port>/workspace in SigmaShake Desktop.",
    },
    501,
  );
});

app.post("/api/workspace/run", (c) => {
  return c.json(
    {
      error: "local_only",
      message: "Running scripts requires a local daemon. Open the page in SigmaShake Desktop.",
    },
    501,
  );
});

app.post("/api/workspace/edit", (c) => {
  return c.json(
    {
      error: "local_only",
      message:
        "Editing project files requires a local daemon. Open the page in SigmaShake Desktop.",
    },
    501,
  );
});

app.get("/api/workspace/certify", (c) => {
  return c.json(
    {
      error: "local_only",
      message:
        "SDLC certification scans the operator's filesystem and only runs on the local daemon. Open Workspace in SigmaShake Desktop.",
    },
    501,
  );
});

app.get("/api/workspace/ai-native", (c) => {
  // The AI-native check scans each project's tree for agent-facing surfaces
  // and times loopback round-trips for the latency gauge — both need the
  // operator's machine. A public Worker can do neither.
  return c.json(
    {
      error: "local_only",
      message:
        "The AI Native check scans the operator's filesystem and probes localhost for response times — it only runs on the local daemon. Open Workspace in SigmaShake Desktop.",
    },
    501,
  );
});

app.get("/api/workspace/platform-parity", (c) => {
  // Cloud surface ships the static catalog so the matrix can render even
  // without a daemon. Every cell is `unknown` with evidence pointing at
  // SigmaShake Desktop — auto-probes can only run on the operator's machine
  // and manual attestations need the desktop UI's recording form.
  return c.json(buildCloudPlatformParitySnapshot(), 200, {
    "Cache-Control": "private, max-age=60",
  });
});

app.get("/api/workspace/readiness", (c) => {
  // Production readiness is mostly manual-status + path-exists checks the cloud
  // CAN answer from a build-time snapshot. cert-signal checks need the operator's
  // tree — they ship as "unknown" with evidence pointing at SigmaShake Desktop
  // for live data. `generatedAt` is overwritten so the response carries the
  // current request time, not the build time.
  return c.json(
    { ...READINESS_REPORT, generatedAt: Date.now() },
    200,
    { "Cache-Control": "private, max-age=60" },
  );
});

app.get("/api/workspace/readiness/text", (c) => {
  return c.text(renderReadinessText({ ...READINESS_REPORT, generatedAt: Date.now() }), 200, {
    "Cache-Control": "private, max-age=60",
  });
});

app.get("/api/workspace/test-report", (c) => {
  // Test reports are `.last-test-report-<kind>.json` files the SSG daemon
  // writes next to each project after a /workspace/run — a public Worker
  // has no filesystem to read them from.
  return c.json(
    {
      error: "local_only",
      message:
        "Test reports are recorded on the operator's machine by the local daemon. Open Workspace in SigmaShake Desktop.",
    },
    501,
  );
});

// ── Inbox: unified support tickets + sales leads ─────────────────────────────
// Proxies to sigmashake-support and sigmashake-sales over service bindings.
// Same-zone HTTPS fetches inside sigmashake.com are silently dropped (see
// support's HUB binding gotcha) so we deliberately don't use public URLs here.
//
// Returns one merged snapshot: per-source state, items, and counts. A failure
// on one source doesn't tank the whole panel — the failing source reports
// `unauthorized` / `unreachable` and the UI degrades gracefully.

app.get("/api/workspace/inbox", async (c) => {
  const snapshot = await buildInboxSnapshot(c.env);
  return c.json(snapshot, 200, { "Cache-Control": "no-store" });
});

// ── Observability: consolidated service-health board ─────────────────────────
// Proxies to sigmashake-observ over the OBSERV service binding. Cloud-only,
// like the Inbox: the binding lives on this Worker, so local + electrobun +
// vscode runtimes render an "open in cloud" CTA instead of fetching. The
// upstream response passes through verbatim — status code and JSON body.
app.get("/api/workspace/observability", async (c) => {
  if (!c.env.OBSERV || typeof c.env.OBSERV.fetch !== "function") {
    return c.json(
      {
        error: "unconfigured",
        message:
          "The OBSERV service binding is not set on this Worker. Add a [[services]] " +
          "block for sigmashake-observ to wrangler.toml and redeploy.",
      },
      503,
    );
  }
  const res = await c.env.OBSERV.fetch("https://observ.internal/api/services");
  return passThrough(res);
});

// ── Inbox mutation proxies ───────────────────────────────────────────────────
// All four routes mirror the upstream worker's surface 1:1. The workspace
// Worker only adds: (a) operator-session auth (already enforced by the global
// middleware), (b) attaches the agent bearer, and (c) safelists the request
// body so a compromised SPA can't smuggle unexpected fields upstream.

const TICKET_ID_RE = /^[A-Za-z0-9_-]{4,64}$/;
const LEAD_ID_RE = /^lead_[A-Za-z0-9]{4,32}$/;

interface TicketPatchBody {
  status?: string;
  tags?: string[];
}

interface TicketMessageBody {
  body_md?: string;
  visibility?: "public" | "internal";
}

interface TicketCloseBody {
  resolution_note?: string;
}

interface LeadPatchBody {
  status?: string;
  notes?: string;
}

app.post("/api/workspace/inbox/tickets/:id/messages", async (c) => {
  const id = c.req.param("id");
  if (!TICKET_ID_RE.test(id)) return c.json({ error: "bad_request" }, 400);
  if (!c.env.SUPPORT_AGENT_TOKEN) {
    return c.json({ error: "unconfigured", message: "SUPPORT_AGENT_TOKEN not set" }, 503);
  }
  const raw = (await c.req.json().catch(() => null)) as TicketMessageBody | null;
  if (!raw || typeof raw.body_md !== "string" || raw.body_md.trim().length === 0) {
    return c.json({ error: "bad_request", message: "body_md required" }, 400);
  }
  const visibility = raw.visibility === "internal" ? "internal" : "public";
  const res = await c.env.SUPPORT.fetch(`https://internal/agent/tickets/${id}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.SUPPORT_AGENT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body_md: raw.body_md, visibility }),
  });
  return passThrough(res);
});

app.post("/api/workspace/inbox/tickets/:id/close", async (c) => {
  const id = c.req.param("id");
  if (!TICKET_ID_RE.test(id)) return c.json({ error: "bad_request" }, 400);
  if (!c.env.SUPPORT_AGENT_TOKEN) {
    return c.json({ error: "unconfigured", message: "SUPPORT_AGENT_TOKEN not set" }, 503);
  }
  const raw = (await c.req.json().catch(() => null)) as TicketCloseBody | null;
  const note = raw && typeof raw.resolution_note === "string" ? raw.resolution_note : undefined;
  const res = await c.env.SUPPORT.fetch(`https://internal/agent/tickets/${id}/close`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${c.env.SUPPORT_AGENT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(note ? { resolution_note: note } : {}),
  });
  return passThrough(res);
});

app.patch("/api/workspace/inbox/tickets/:id", async (c) => {
  const id = c.req.param("id");
  if (!TICKET_ID_RE.test(id)) return c.json({ error: "bad_request" }, 400);
  if (!c.env.SUPPORT_AGENT_TOKEN) {
    return c.json({ error: "unconfigured", message: "SUPPORT_AGENT_TOKEN not set" }, 503);
  }
  const raw = (await c.req.json().catch(() => null)) as TicketPatchBody | null;
  if (!raw) return c.json({ error: "bad_request" }, 400);
  const payload: TicketPatchBody = {};
  if (typeof raw.status === "string") payload.status = raw.status;
  if (Array.isArray(raw.tags) && raw.tags.every((t) => typeof t === "string")) {
    payload.tags = raw.tags;
  }
  if (Object.keys(payload).length === 0) {
    return c.json({ error: "bad_request", message: "status or tags required" }, 400);
  }
  const res = await c.env.SUPPORT.fetch(`https://internal/agent/tickets/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${c.env.SUPPORT_AGENT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return passThrough(res);
});

app.patch("/api/workspace/inbox/leads/:id", async (c) => {
  const id = c.req.param("id");
  if (!LEAD_ID_RE.test(id)) return c.json({ error: "bad_request" }, 400);
  if (!c.env.SALES_AGENT_TOKEN) {
    return c.json({ error: "unconfigured", message: "SALES_AGENT_TOKEN not set" }, 503);
  }
  const raw = (await c.req.json().catch(() => null)) as LeadPatchBody | null;
  if (!raw || typeof raw.status !== "string") {
    return c.json({ error: "bad_request", message: "status required" }, 400);
  }
  const payload: LeadPatchBody = { status: raw.status };
  if (typeof raw.notes === "string") payload.notes = raw.notes;
  const res = await c.env.SALES.fetch(`https://internal/agent/leads/${id}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${c.env.SALES_AGENT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  return passThrough(res);
});

/** Forward an upstream Response back to the SPA — pinning JSON content-type
 *  and stripping cache headers so a stale 200 never sticks in the browser. */
async function passThrough(res: Response): Promise<Response> {
  const body = await res.text();
  return new Response(body, {
    status: res.status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function buildInboxSnapshot(env: WorkerEnv): Promise<InboxSnapshot> {
  const [ticketsResult, leadsResult] = await Promise.all([
    fetchSupportTickets(env),
    fetchSalesLeads(env),
  ]);

  const tickets = ticketsResult.tickets;
  const leads = leadsResult.leads;

  const ticketsOpen = tickets.filter(
    (t) => t.status === "open" || t.status === "in_progress" || t.status === "waiting",
  ).length;
  const ticketsCritical = tickets.filter(
    (t) => (t.severity === "p0" || t.severity === "p1") && t.status !== "closed",
  ).length;
  const leadsNew = leads.filter((l) => l.status === "new").length;

  return {
    generatedAt: new Date().toISOString(),
    tickets,
    leads,
    sources: {
      support: ticketsResult.status,
      sales: leadsResult.status,
    },
    counts: { ticketsOpen, ticketsCritical, leadsNew },
  };
}

interface SupportFetchResult {
  status: InboxSourceStatus;
  tickets: InboxTicket[];
}

async function fetchSupportTickets(env: WorkerEnv): Promise<SupportFetchResult> {
  if (!env.SUPPORT_AGENT_TOKEN) {
    return {
      status: {
        state: "unconfigured",
        message:
          "Set SUPPORT_AGENT_TOKEN — run `bun scripts/seed-agent.ts --name workspace-inbox --scopes read` in sigmashake-support, then `wrangler secret put SUPPORT_AGENT_TOKEN`.",
      },
      tickets: [],
    };
  }
  // List non-closed tickets across every org, newest first. The agent token
  // provisioned for workspace-inbox should have `allowed_org_ids = NULL` so
  // it sees prospect tickets (org_id = NULL) too.
  const url = "https://internal/agent/tickets?status=open&limit=50";
  try {
    const res = await env.SUPPORT.fetch(url, {
      headers: { Authorization: `Bearer ${env.SUPPORT_AGENT_TOKEN}` },
    });
    if (res.status === 401 || res.status === 403) {
      return {
        status: {
          state: "unauthorized",
          message: `Support /agent/tickets returned ${res.status}. Token may be revoked or missing the 'read' scope.`,
        },
        tickets: [],
      };
    }
    if (!res.ok) {
      return {
        status: {
          state: "unreachable",
          message: `Support /agent/tickets returned HTTP ${res.status}.`,
        },
        tickets: [],
      };
    }
    const body = (await res.json()) as { tickets: SupportTicketWireFormat[] };
    const tickets = (body.tickets ?? []).map(normaliseTicket);
    return { status: { state: "ok", message: null }, tickets };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: { state: "unreachable", message: `Service binding error: ${message}` },
      tickets: [],
    };
  }
}

interface SalesFetchResult {
  status: InboxSourceStatus;
  leads: InboxLead[];
}

async function fetchSalesLeads(env: WorkerEnv): Promise<SalesFetchResult> {
  if (!env.SALES_AGENT_TOKEN) {
    return {
      status: {
        state: "unconfigured",
        message:
          "Set SALES_AGENT_TOKEN — generate with `openssl rand -hex 32`, push to BOTH sigmashake-workspace and sigmashake-sales as `SALES_AGENT_TOKEN` via `wrangler secret put`.",
      },
      leads: [],
    };
  }
  const url = "https://internal/agent/leads?limit=50";
  try {
    const res = await env.SALES.fetch(url, {
      headers: { Authorization: `Bearer ${env.SALES_AGENT_TOKEN}` },
    });
    if (res.status === 401 || res.status === 403) {
      return {
        status: {
          state: "unauthorized",
          message: `Sales /agent/leads returned ${res.status}. SALES_AGENT_TOKEN mismatch — push the same value on both workers.`,
        },
        leads: [],
      };
    }
    if (!res.ok) {
      return {
        status: {
          state: "unreachable",
          message: `Sales /agent/leads returned HTTP ${res.status}.`,
        },
        leads: [],
      };
    }
    const body = (await res.json()) as { leads: SalesLeadWireFormat[] };
    const leads = (body.leads ?? []).map(normaliseLead);
    return { status: { state: "ok", message: null }, leads };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      status: { state: "unreachable", message: `Service binding error: ${message}` },
      leads: [],
    };
  }
}

// Wire-format shapes mirror what each upstream worker actually returns.
// Kept local to the worker so the client doesn't depend on raw upstream
// fields — `normalise*` flattens them into the public InboxTicket / InboxLead
// shapes that the React app consumes.

interface SupportTicketWireFormat {
  id: string;
  org_id: string | null;
  subject: string;
  contact_email: string;
  category: string | null;
  severity: string;
  status: string;
  source: string;
  sla_deadline: number | null;
  created_at: number;
  updated_at: number;
  closed_at: number | null;
  tags: string[];
  ai_summary: string | null;
  ai_confidence: number | null;
}

function normaliseTicket(t: SupportTicketWireFormat): InboxTicket {
  return {
    id: t.id,
    subject: t.subject,
    contactEmail: t.contact_email,
    orgId: t.org_id,
    category: t.category,
    severity: (isTicketSeverity(t.severity) ? t.severity : "p3") as TicketSeverity,
    status: (isTicketStatus(t.status) ? t.status : "open") as TicketStatus,
    source: t.source,
    slaDeadline: t.sla_deadline,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    closedAt: t.closed_at,
    tags: Array.isArray(t.tags) ? t.tags : [],
    aiSummary: t.ai_summary,
    aiConfidence: t.ai_confidence,
  };
}

function isTicketSeverity(s: string): s is TicketSeverity {
  return s === "p0" || s === "p1" || s === "p2" || s === "p3";
}

function isTicketStatus(s: string): s is TicketStatus {
  return (
    s === "open" || s === "in_progress" || s === "waiting" || s === "resolved" || s === "closed"
  );
}

interface SalesLeadWireFormat {
  id: string;
  createdAt: number;
  fromEmail: string;
  fromName: string | null;
  subject: string | null;
  body: string;
  classification: string | null;
  confidence: number | null;
  aiSummary: string | null;
  status: string;
}

const LEAD_PREVIEW_CHARS = 280;

function normaliseLead(l: SalesLeadWireFormat): InboxLead {
  const body = typeof l.body === "string" ? l.body : "";
  const preview = body.length > LEAD_PREVIEW_CHARS ? `${body.slice(0, LEAD_PREVIEW_CHARS)}…` : body;
  return {
    id: l.id,
    createdAt: l.createdAt,
    fromEmail: l.fromEmail,
    fromName: l.fromName,
    subject: l.subject,
    bodyPreview: preview,
    classification: isLeadClassification(l.classification) ? l.classification : null,
    confidence: l.confidence,
    aiSummary: l.aiSummary,
    status: isLeadStatus(l.status) ? l.status : "new",
  };
}

function isLeadClassification(c: string | null): c is LeadClassification {
  return (
    c === "cold_pitch" ||
    c === "legitimate_inquiry" ||
    c === "partnership" ||
    c === "media" ||
    c === "unclear"
  );
}

function isLeadStatus(s: string): s is LeadStatus {
  return (
    s === "new" ||
    s === "replied" ||
    s === "ignored" ||
    s === "escalated" ||
    s === "meeting_booked" ||
    s === "closed"
  );
}

// Plain-text scorecard for the readiness endpoint — keeps the same shape as
// sigmashake-gov's workspace-readiness.ts so agents can `curl /text` and parse
// it the same way against either the cloud or local daemon.
const READINESS_STATUS_SIGIL: Record<string, string> = {
  met: "MET    ",
  partial: "PARTIAL",
  unmet: "UNMET  ",
  unknown: "UNKNOWN",
};

function renderReadinessText(
  resp: import("./types").ReadinessResponse,
): string {
  const lines: string[] = [];
  lines.push("# SigmaShake production readiness");
  if (resp.manifestError) {
    lines.push(`# error: ${resp.manifestError}`);
    return `${lines.join("\n")}\n`;
  }
  const verdict = resp.ready
    ? "PRODUCTION READY"
    : `NOT READY — ${resp.totalBlockers} blocking gap(s)`;
  lines.push(
    `# overall: ${verdict}  (${resp.readyProductCount}/${resp.productCount} products ready)`,
  );
  lines.push(`# generated: ${new Date(resp.generatedAt).toISOString()}`);
  lines.push("");
  for (const p of resp.products) {
    const tag = p.ready ? "READY" : `BLOCKED (${p.blockerCount})`;
    lines.push(`## ${p.name} — ${tag}`);
    for (const r of p.requirements) {
      const flag = r.blocking ? "*" : " ";
      lines.push(
        `  ${READINESS_STATUS_SIGIL[r.status] ?? "       "} ${flag} ${r.title} — ${r.evidence}`,
      );
      if (r.status !== "met" && r.remediation) {
        lines.push(`            fix: ${r.remediation}`);
      }
    }
    lines.push("");
  }
  lines.push("# (* = blocking — must be MET for the product to be ready)");
  return `${lines.join("\n")}\n`;
}

// Platform parity — cloud builds a static snapshot from the shipped catalog.
// Every cell ships as `unknown` (the cloud can't probe the operator's machine
// and can't read their ~/.sigmashake/platform-parity.json), but the matrix
// still renders so visitors can see which features are tracked. SigmaShake
// Desktop's local daemon replaces this snapshot with the real per-OS results
// when the user opens the same view there.
function buildCloudPlatformParitySnapshot(): PlatformParityResponse {
  const generatedAt = Date.now();
  const features: PlatformParityFeature[] = PLATFORM_PARITY_CATALOG.map((entry) => {
    const cell = (os: "linux" | "darwin" | "win32") => {
      if (entry.expectedFor !== "all" && entry.expectedFor !== os) {
        return {
          status: "not-applicable" as const,
          attestation: "auto" as const,
          lastCheckedAt: generatedAt,
          durationMs: null,
          evidence: `feature is scoped to ${entry.expectedFor}`,
          error: null,
          hostId: "cloud",
          hostLabel: "workspace.sigmashake.com",
        };
      }
      return null;
    };
    return {
      id: entry.id,
      label: entry.label,
      category: entry.category,
      description: entry.description,
      severity: entry.severity,
      expectedFor: entry.expectedFor,
      verification: entry.verification,
      verificationKind: entry.verificationKind,
      results: {
        linux: cell("linux"),
        darwin: cell("darwin"),
        win32: cell("win32"),
      },
    };
  });

  // Summary counts mirror the daemon's logic — `not-applicable` cells are
  // excluded from the parity-score denominator, everything else counts as
  // `unknown` (worst case) on the cloud surface.
  let pass = 0;
  let fail = 0;
  let partial = 0;
  let unknown = 0;
  let skipped = 0;
  let notApplicable = 0;
  let scoreDen = 0;
  let blockingGaps = 0;
  for (const f of features) {
    let blockingClean = true;
    for (const cell of [f.results.linux, f.results.darwin, f.results.win32]) {
      const status = cell?.status ?? "unknown";
      if (status === "pass") pass += 1;
      else if (status === "fail") fail += 1;
      else if (status === "partial") partial += 1;
      else if (status === "skipped") skipped += 1;
      else if (status === "not-applicable") notApplicable += 1;
      else unknown += 1;
      if (status === "not-applicable") continue;
      const weight = f.severity === "blocking" ? 2 : 1;
      scoreDen += weight;
      if (status !== "pass") blockingClean = false;
    }
    if (f.severity === "blocking" && !blockingClean) blockingGaps += 1;
  }
  // 0 / scoreDen = 0; the cloud snapshot intentionally reads as "no parity
  // confirmed" so operators are nudged toward SigmaShake Desktop for live data.
  const parityScore = 0;

  return {
    generatedAt,
    currentHostOs: "unknown",
    currentHostId: "cloud",
    currentHostLabel: "workspace.sigmashake.com",
    features,
    summary: {
      total: features.length,
      pass,
      fail,
      partial,
      unknown,
      skipped,
      notApplicable,
      parityScore,
      blockingGaps,
    },
    hostsSeen: [],
    storeError:
      "cloud surface — live per-OS results need SigmaShake Desktop on the operator's machine",
  };
}

// SPA shell — strip-index-html.ts removes Vite's default index.html so this
// handler renders the root HTML directly. Static /assets/* are served by the
// [assets] binding, but only after the auth gate above has passed.
const SHELL_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>SigmaShake Workspace</title>
    <link rel="stylesheet" href="/assets/app.css" />
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/assets/app.js"></script>
  </body>
</html>`;

app.get("/", (c) => c.html(SHELL_HTML, 200, { "Cache-Control": "private, max-age=60" }));

// run_worker_first = true means we must forward every unmatched path to the
// ASSETS binding ourselves. For real static files (/assets/app.js, etc.) the
// binding returns the file. For deep-linked SPA routes (/distribution, etc.)
// it returns 404, and we re-render the shell so React Router can take over.
app.notFound(async (c) => {
  const assetResponse = await c.env.ASSETS.fetch(c.req.raw);
  if (assetResponse.status !== 404) {
    return assetResponse;
  }
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("text/html")) {
    return c.html(SHELL_HTML, 200, { "Cache-Control": "private, max-age=60" });
  }
  return c.json({ error: "not_found" }, 404);
});

export default app;
