// Shared Fleet control-plane probes. Every runtime uses this module to
// fill the `reachability` and `signInUrl` fields of FleetStatus and to fetch
// the authed overview when the operator has connected an org. The enrollment
// field is filled in by the daemon (local + plugin) and left null in cloud.
//
// Authed fetches go directly to `<slug>.fleet.sigmashake.com` with
// `credentials: "include"`. The Fleet CORS allowlist + Access-Control-Allow-
// Credentials header gates which origins receive responses (see
// sigmashake-fleet/src/dispatcher.ts).

import type {
  FleetAgentStatus,
  FleetAgentSummary,
  FleetAuditEvent,
  FleetOverview,
  FleetPolicyStatus,
  FleetPolicySummary,
  FleetReachability,
  FleetSessionInfo,
  FleetSessionVia,
  FleetStatus,
} from "../api/types";

const FLEET_BASE = "https://fleet.sigmashake.com";
const HEALTH_TIMEOUT_MS = 4_000;
const FETCH_TIMEOUT_MS = 8_000;
const AUDIT_RECENT_LIMIT = 10;
const FLEET_SLUG_RE = /^[a-z0-9-]{2,40}$/;

export async function probeFleetReachability(): Promise<FleetReachability> {
  try {
    const ctl = new AbortController();
    const id = setTimeout(() => ctl.abort(), HEALTH_TIMEOUT_MS);
    const res = await fetch(`${FLEET_BASE}/api/health`, {
      method: "GET",
      signal: ctl.signal,
      credentials: "omit",
    });
    clearTimeout(id);
    if (!res.ok) return "unreachable";
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    return body?.ok === true ? "ok" : "unreachable";
  } catch {
    return "unreachable";
  }
}

export function fleetSignInUrl(): string {
  // The Fleet root resolves the operator's org slug from the SSO cookie and
  // redirects to `<slug>.fleet.sigmashake.com/agents`. If no session, the
  // page surfaces the SSO entry point. Same URL works whether or not the
  // user is signed in.
  return FLEET_BASE;
}

export function emptyEnrollmentStatus(): FleetStatus {
  return {
    reachability: "unknown",
    checkedAt: new Date().toISOString(),
    enrollment: null,
    signInUrl: fleetSignInUrl(),
  };
}

// ── Tenant-scoped overview ────────────────────────────────────────────────────

function tenantBase(slug: string): string {
  return `https://${slug}.fleet.sigmashake.com`;
}

function emptyCounts(): FleetOverview["counts"] {
  return {
    agentsTotal: 0,
    agentsActive: 0,
    policiesPending: 0,
    policiesApproved: 0,
    auditLast24h: 0,
  };
}

export function emptyOverview(): FleetOverview {
  return {
    authed: false,
    error: null,
    session: null,
    agents: [],
    policies: [],
    audit: [],
    counts: emptyCounts(),
  };
}

export function isValidFleetSlug(slug: string): boolean {
  return FLEET_SLUG_RE.test(slug);
}

async function fetchJson(
  url: string,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; body: unknown }> {
  const res = await fetch(url, {
    method: "GET",
    credentials: "include",
    signal,
    headers: { Accept: "application/json" },
  });
  const ctype = res.headers.get("content-type") ?? "";
  const body = ctype.includes("application/json") ? await res.json().catch(() => null) : null;
  return { ok: res.ok, status: res.status, body };
}

function asString(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function normalizeAgentStatus(v: unknown): FleetAgentStatus {
  return v === "active" || v === "idle" || v === "revoked" || v === "expired" ? v : "unknown";
}

function normalizePolicyStatus(v: unknown): FleetPolicyStatus {
  return v === "draft" || v === "pending_review" || v === "approved" || v === "archived"
    ? v
    : "unknown";
}

function normalizeSessionVia(v: unknown): FleetSessionVia {
  return v === "oidc" || v === "saml" || v === "device" || v === "admin" ? v : "unknown";
}

function summarizeAuditPayload(eventType: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return eventType;
  const p = payload as Record<string, unknown>;
  const candidates = [
    p.message,
    p.summary,
    p.description,
    p.reason,
    p.target_id,
    p.agent_id,
    p.rule_id,
  ].find((v) => typeof v === "string" && v.length > 0);
  if (typeof candidates === "string") {
    return candidates.slice(0, 140);
  }
  return eventType;
}

/**
 * Fetch the full Fleet overview for the given tenant slug. Returns
 * `{authed: false}` on 401 so the panel can render the sign-in CTA instead
 * of error noise; throws only when the slug fails the format check.
 */

/**
 * Mint a single-use enrollment bearer from the user's SSO session on
 * <slug>.fleet.sigmashake.com. The browser must have a valid ssg_fleet_session
 * cookie on that origin (set after SSO sign-in); credentials: include attaches
 * it. The bearer expires after 5 minutes and is consumed on first use by the
 * Fleet self-enroll endpoint. Throws on non-200 so the caller can surface a
 * meaningful error to the operator.
 */
export async function mintEnrollmentGrant(slug: string): Promise<{
  enrollmentBearer: string;
  orgId: string;
  orgSlug: string | null;
}> {
  if (!isValidFleetSlug(slug)) {
    throw new Error("Invalid Fleet org slug");
  }
  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(`${tenantBase(slug)}/api/v1/auth/enrollment-grant`, {
      method: "POST",
      credentials: "include",
      signal: ctl.signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: "{}",
    });
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        "Sign in to Fleet at " +
          tenantBase(slug) +
          " before connecting this machine — no active SSO session.",
      );
    }
    if (!res.ok) {
      const errBody = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const msg = typeof errBody?.error === "string" ? errBody.error : `HTTP ${res.status}`;
      throw new Error(`Fleet enrollment-grant failed: ${msg}`);
    }
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const bearer = typeof body?.enrollment_bearer === "string" ? body.enrollment_bearer : "";
    const orgId = typeof body?.org_id === "string" ? body.org_id : "";
    if (!bearer || !orgId) {
      throw new Error("Fleet enrollment-grant returned an unexpected payload");
    }
    return {
      enrollmentBearer: bearer,
      orgId,
      orgSlug: typeof body?.org_slug === "string" ? body.org_slug : null,
    };
  } finally {
    clearTimeout(id);
  }
}

export async function fetchFleetOverview(slug: string): Promise<FleetOverview> {
  if (!isValidFleetSlug(slug)) {
    return { ...emptyOverview(), error: "Invalid org slug" };
  }

  const ctl = new AbortController();
  const id = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    // 1. Confirm session + resolve org id.
    const whoamiRes = await fetchJson(`${tenantBase(slug)}/api/v1/session/whoami`, ctl.signal);
    if (whoamiRes.status === 401 || whoamiRes.status === 403) {
      return { ...emptyOverview(), authed: false };
    }
    if (!whoamiRes.ok || !whoamiRes.body || typeof whoamiRes.body !== "object") {
      return {
        ...emptyOverview(),
        error: `whoami: ${whoamiRes.status}`,
      };
    }
    const me = whoamiRes.body as Record<string, unknown>;
    const session: FleetSessionInfo = {
      userId: asString(me.userId) ?? "",
      orgId: asString(me.orgId),
      orgSlug: asString(me.orgSlug) ?? slug,
      role: asString(me.role),
      via: normalizeSessionVia(me.via),
    };
    if (!session.orgId) {
      return {
        ...emptyOverview(),
        authed: true,
        session,
        error: "Session has no org bound — visit Fleet to pick an org.",
      };
    }

    // 2. Fan out agents + policies + audit in parallel; the panel only blocks
    // on whoami so each list can fail independently without breaking the rest.
    const tenant = tenantBase(slug);
    const orgPath = `/api/v1/orgs/${encodeURIComponent(session.orgId)}`;
    const [agentsRes, policiesRes, auditRes] = await Promise.all([
      fetchJson(`${tenant}${orgPath}/agents?limit=50`, ctl.signal),
      fetchJson(`${tenant}${orgPath}/policies?limit=50`, ctl.signal),
      fetchJson(`${tenant}${orgPath}/audit?limit=${AUDIT_RECENT_LIMIT}`, ctl.signal),
    ]);

    const agents = parseAgents(agentsRes.body);
    const policies = parsePolicies(policiesRes.body);
    const audit = parseAuditEvents(auditRes.body);

    const dayAgo = Date.now() - 24 * 60 * 60 * 1_000;
    const counts: FleetOverview["counts"] = {
      agentsTotal: agents.length,
      agentsActive: agents.filter((a) => a.status === "active").length,
      policiesPending: policies.filter((p) => p.status === "pending_review").length,
      policiesApproved: policies.filter((p) => p.status === "approved").length,
      auditLast24h: audit.filter((e) => e.createdAt >= dayAgo).length,
    };

    return {
      authed: true,
      error: null,
      session,
      agents,
      policies,
      audit,
      counts,
    };
  } catch (err) {
    if ((err as Error)?.name === "AbortError") {
      return { ...emptyOverview(), error: "Fleet request timed out" };
    }
    return {
      ...emptyOverview(),
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(id);
  }
}

function parseAgents(body: unknown): FleetAgentSummary[] {
  if (!body || typeof body !== "object") return [];
  const list = (body as Record<string, unknown>).agents;
  if (!Array.isArray(list)) return [];
  const out: FleetAgentSummary[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = asString(r.id);
    if (!id) continue;
    out.push({
      id,
      label: asString(r.label),
      agentVersion: asString(r.agent_version),
      policyVersion: asString(r.policy_version),
      status: normalizeAgentStatus(r.status),
      lastHeartbeatAt: asNumber(r.last_heartbeat_at),
      lastEvalAt: asNumber(r.last_eval_at),
      createdAt: asNumber(r.created_at) ?? 0,
    });
  }
  return out;
}

function parsePolicies(body: unknown): FleetPolicySummary[] {
  if (!body || typeof body !== "object") return [];
  const list = (body as Record<string, unknown>).policies;
  if (!Array.isArray(list)) return [];
  const out: FleetPolicySummary[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = asString(r.id);
    const name = asString(r.name);
    if (!id || !name) continue;
    out.push({
      id,
      name,
      status: normalizePolicyStatus(r.status),
      priorityLayer: asNumber(r.priority_layer) ?? 0,
      version: asNumber(r.version) ?? 0,
      createdBy: asString(r.created_by) ?? "",
      approvedBy: asString(r.approved_by),
      updatedAt: asNumber(r.updated_at) ?? asNumber(r.created_at) ?? 0,
    });
  }
  return out;
}

function parseAuditEvents(body: unknown): FleetAuditEvent[] {
  if (!body || typeof body !== "object") return [];
  const list = (body as Record<string, unknown>).events;
  if (!Array.isArray(list)) return [];
  const out: FleetAuditEvent[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const id = asString(r.id);
    const eventType = asString(r.event_type);
    if (!id || !eventType) continue;
    // Payload is JSON-serialized text in some configs and a real object in
    // others — accept both before summarizing.
    let payload: unknown = r.payload;
    if (typeof payload === "string") {
      try {
        payload = JSON.parse(payload);
      } catch {
        // leave as string — summarizeAuditPayload returns the eventType
      }
    }
    out.push({
      id,
      eventType,
      agentId: asString(r.agent_id),
      createdAt: asNumber(r.created_at) ?? 0,
      summary: summarizeAuditPayload(eventType, payload),
    });
  }
  return out;
}
