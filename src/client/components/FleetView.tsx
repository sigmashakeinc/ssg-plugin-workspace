// Monorepo-wide "Fleet" panel. Read-only Phase 3 surface for the
// sigmashake-fleet control plane:
//   - Public /api/health probe → reachability pill
//   - This-machine agent enrollment (local + electrobun runtimes only)
//   - Authed Fleet overview when the operator has connected their tenant
//     subdomain: live agent count, policies pending review, recent audit
//   - Sign-in / connect CTA when not yet configured or session expired
//
// Auth-gated admin actions (approve policy, revoke agent, etc.) still live
// on fleet.sigmashake.com itself — the panel deep-links into them rather
// than re-implementing mutating UX inside Workspace.

import { useCallback, useEffect, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type {
  FleetAgentSummary,
  FleetAuditEvent,
  FleetOverview,
  FleetPolicySummary,
  FleetStatus,
} from "../api/types";
import { withTimeout } from "../lib/with-timeout";
import { useWorkspaceCache } from "../lib/workspace-cache";
import { ProgressStrip } from "./ProgressStrip";

const REFRESH_MS = 30_000;
const FLEET_SLUG_RE = /^[a-z0-9-]{2,40}$/;

interface Props {
  client: WorkspaceApiClient | null;
  orgSlug: string;
  onSlugChange: (slug: string) => void;
}

export function FleetView({ client, orgSlug, onSlugChange }: Props) {
  // Hydrate the reachability status from the shared cache so re-entering this
  // view doesn't replay the "Checking the Fleet control plane…" spinner.
  const cache = useWorkspaceCache();
  const [status, setStatus] = useState<FleetStatus | null>(cache.fleet.data);
  const [overview, setOverview] = useState<FleetOverview | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!client) return;
    setRefreshing(true);
    try {
      const [nextStatus, nextOverview] = await Promise.all([
        withTimeout(client.getFleetStatus(), "Fleet status check"),
        orgSlug
          ? withTimeout(client.getFleetOverview(orgSlug), "Fleet overview")
          : Promise.resolve(null),
      ]);
      setStatus(nextStatus);
      setOverview(nextOverview);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefreshing(false);
    }
  }, [client, orgSlug]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  if (!status) {
    return (
      <div className="panel">
        <h3 className="panel__h3">Fleet</h3>
        <ProgressStrip
          loading={!loadError}
          label={
            loadError
              ? "Couldn’t reach the Fleet control plane"
              : "Checking the Fleet control plane…"
          }
        />
        <div className="fleet__skeleton-grid">
          <div className="fleet__skeleton-card" />
          <div className="fleet__skeleton-card" />
          <div className="fleet__skeleton-card" />
        </div>
        {loadError ? (
          <div className="state-card state-card--error" style={{ marginTop: 16 }}>
            <p className="state-card__body">{loadError}</p>
            <button
              type="button"
              className="pill-btn pill-btn--primary"
              onClick={load}
              disabled={refreshing}
            >
              Retry
            </button>
          </div>
        ) : null}
      </div>
    );
  }

  const dashboardBase = orgSlug ? `https://${orgSlug}.fleet.sigmashake.com` : status.signInUrl;

  return (
    <div className="panel fleet">
      <ProgressStrip loading={refreshing} label={refreshing ? "Probing Fleet control plane" : ""} />
      <header className="fleet__header">
        <div>
          <h3 className="panel__h3">Fleet</h3>
          <p className="panel__muted">
            Manage SigmaShake agents across your team. The dashboard lives at fleet.sigmashake.com —
            this panel surfaces the bits you need from Workspace.
          </p>
        </div>
        <button
          type="button"
          className="fleet__refresh"
          onClick={load}
          disabled={refreshing}
          title="Re-probe the Fleet control plane"
        >
          {refreshing ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {status.enrollment?.enrolled && !status.enrollment.jwtExpired ? (
        <ConnectedBanner status={status} />
      ) : null}

      <section className="fleet__grid">
        <ReachabilityCard status={status} />
        <EnrollmentCard
          status={status}
          client={client}
          orgSlug={orgSlug}
          overview={overview}
          onEnrolled={setStatus}
        />
        <OverviewCard orgSlug={orgSlug} overview={overview} dashboardBase={dashboardBase} />
      </section>

      <ConnectOrgCard orgSlug={orgSlug} overview={overview} onSlugChange={onSlugChange} />

      {overview?.authed && overview.session ? (
        <>
          <PoliciesSection overview={overview} dashboardBase={dashboardBase} />
          <AgentsSection overview={overview} dashboardBase={dashboardBase} />
          <AuditSection overview={overview} dashboardBase={dashboardBase} />
        </>
      ) : null}

      <section className="fleet__links">
        <h4 className="fleet__h4">Open in Fleet Dashboard</h4>
        <ul className="fleet__link-list">
          <FleetLink
            href={dashboardBase}
            label="Overview"
            hint="Org redirect — picks your tenant from the SSO cookie."
          />
          <FleetLink
            href={`${dashboardBase}/agents`}
            label="Agents"
            hint="Live agent roster + heartbeat status."
          />
          <FleetLink
            href={`${dashboardBase}/policies`}
            label="Policies"
            hint="Authored rules, pending approval, archive."
          />
          <FleetLink
            href={`${dashboardBase}/audit`}
            label="Audit log"
            hint="Merkle-anchored audit trail."
          />
          <FleetLink
            href={`${dashboardBase}/observability`}
            label="Observability"
            hint="Rule effectiveness + agent distribution."
          />
          <FleetLink
            href={`${dashboardBase}/enrollment`}
            label="Enrollment"
            hint="Enrollment profiles + MDM installer downloads."
          />
        </ul>
      </section>
    </div>
  );
}

function ReachabilityCard({ status }: { status: FleetStatus }) {
  const tone =
    status.reachability === "ok" ? "ok" : status.reachability === "unreachable" ? "err" : "warn";
  const label =
    status.reachability === "ok"
      ? "Reachable"
      : status.reachability === "unreachable"
        ? "Unreachable"
        : "Unknown";
  const detail =
    status.reachability === "ok"
      ? "Control plane health probe returned ok."
      : status.reachability === "unreachable"
        ? "We couldn't reach fleet.sigmashake.com from this browser. Check your network."
        : "Health probe hasn't completed yet.";
  return (
    <article className={`fleet-card fleet-card--${tone}`}>
      <header className="fleet-card__head">
        <span className={`fleet-card__dot fleet-card__dot--${tone}`} aria-hidden="true" />
        <h4 className="fleet-card__title">Control plane</h4>
      </header>
      <p className="fleet-card__value">{label}</p>
      <p className="fleet-card__detail">{detail}</p>
      <p className="fleet-card__foot">
        Last checked {new Date(status.checkedAt).toLocaleTimeString()}
      </p>
    </article>
  );
}

interface EnrollmentCardProps {
  status: FleetStatus;
  client: WorkspaceApiClient | null;
  orgSlug: string;
  overview: FleetOverview | null;
  onEnrolled: (status: FleetStatus) => void;
}

function ConnectedBanner({ status }: { status: FleetStatus }) {
  const enr = status.enrollment;
  if (!enr) return null;
  return (
    <section className="fleet__connected" role="status" aria-live="polite">
      <span className="fleet__connected-dot" aria-hidden="true" />
      <span className="fleet__connected-text">
        <strong>Connected to Fleet ✓</strong>
        <span className="fleet__connected-detail">
          {enr.orgId ? ` · org ${enr.orgId}` : ""}
          {enr.agentId ? ` · agent ${enr.agentId}` : ""}
        </span>
      </span>
    </section>
  );
}

function EnrollmentCard({ status, client, orgSlug, overview, onEnrolled }: EnrollmentCardProps) {
  const enr = status.enrollment;
  const [connecting, setConnecting] = useState(false);
  const [connectError, setConnectError] = useState<string | null>(null);
  const canAutoEnroll = !!(client?.hasLocalCapabilities && orgSlug && overview?.authed);

  const cache = useWorkspaceCache();
  const handleConnect = useCallback(async () => {
    if (!client || !orgSlug) return;
    setConnecting(true);
    setConnectError(null);
    try {
      const next = await client.autoEnrollFleet(orgSlug);
      onEnrolled(next);
      // Push the fresh status into the shared cache so the nav rail badge
      // flips immediately instead of waiting for the next 30s tick.
      cache.fleet.refresh();
    } catch (err) {
      setConnectError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }, [client, orgSlug, onEnrolled, cache.fleet]);

  if (!enr) {
    return (
      <article className="fleet-card fleet-card--warn">
        <header className="fleet-card__head">
          <span className="fleet-card__dot fleet-card__dot--warn" aria-hidden="true" />
          <h4 className="fleet-card__title">This machine</h4>
        </header>
        <p className="fleet-card__value">Unknown</p>
        <p className="fleet-card__detail">
          Run <code>ssg fleet status</code> from a terminal to check this machine's enrollment. The
          Workspace cloud surface can't see local agent state — open Workspace in SigmaShake Desktop
          for live data.
        </p>
      </article>
    );
  }
  if (!enr.enrolled) {
    return (
      <article className="fleet-card fleet-card--warn">
        <header className="fleet-card__head">
          <span className="fleet-card__dot fleet-card__dot--warn" aria-hidden="true" />
          <h4 className="fleet-card__title">This machine</h4>
        </header>
        <p className="fleet-card__value">Not enrolled</p>
        {canAutoEnroll ? (
          <>
            <p className="fleet-card__detail">
              You're signed in to <code>{orgSlug}.fleet.sigmashake.com</code>. One click and this
              machine joins your Fleet org — no enrollment code needed.
            </p>
            <button
              type="button"
              className="fleet-card__cta fleet-card__cta--primary"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? "Connecting…" : "Connect this machine"}
            </button>
            {connectError ? (
              <p className="fleet-card__detail fleet-card__bad" role="alert">
                {connectError}
              </p>
            ) : null}
          </>
        ) : !client?.hasLocalCapabilities ? (
          <p className="fleet-card__detail">
            Open Workspace in SigmaShake Desktop to one-click enroll this machine. The cloud
            surface can't store the agent JWT locally.
          </p>
        ) : !orgSlug ? (
          <p className="fleet-card__detail">
            Connect your org below first — once Workspace knows which tenant subdomain to talk to,
            you can enroll this machine with one click.
          </p>
        ) : (
          <p className="fleet-card__detail">
            Sign in at <code>{orgSlug}.fleet.sigmashake.com</code> to unlock one-click enrollment.
          </p>
        )}
      </article>
    );
  }
  const tone = enr.jwtExpired ? "warn" : "ok";
  return (
    <article className={`fleet-card fleet-card--${tone}`}>
      <header className="fleet-card__head">
        <span className={`fleet-card__dot fleet-card__dot--${tone}`} aria-hidden="true" />
        <h4 className="fleet-card__title">This machine</h4>
      </header>
      <p className="fleet-card__value">
        {enr.agentId ?? "agent"} <span className="fleet-card__sub">· {enr.orgId ?? "org"}</span>
      </p>
      <ul className="fleet-card__kv">
        <li>
          <span>Agent JWT</span>
          <span className={enr.jwtExpired ? "fleet-card__bad" : "fleet-card__good"}>
            {enr.jwtExpired ? "Expired — re-enroll" : "Valid"}
          </span>
        </li>
        <li>
          <span>Policy bundle</span>
          <span>
            {enr.bundleVersion ? `v${enr.bundleVersion}` : "—"}{" "}
            <span className="fleet-card__muted">({enr.bundleState})</span>
          </span>
        </li>
      </ul>
      {enr.jwtExpired ? (
        canAutoEnroll ? (
          <>
            <p className="fleet-card__detail">
              The agent JWT has expired. Re-enroll this machine with one click using your existing
              SSO session.
            </p>
            <button
              type="button"
              className="fleet-card__cta fleet-card__cta--primary"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? "Re-enrolling…" : "Re-enroll this machine"}
            </button>
            {connectError ? (
              <p className="fleet-card__detail fleet-card__bad" role="alert">
                {connectError}
              </p>
            ) : null}
          </>
        ) : (
          <p className="fleet-card__detail">
            Run <code>ssg fleet enroll --code=&lt;code&gt;</code> with a fresh enrollment code from
            your org admin.
          </p>
        )
      ) : null}
    </article>
  );
}

interface OverviewCardProps {
  orgSlug: string;
  overview: FleetOverview | null;
  dashboardBase: string;
}

function OverviewCard({ orgSlug, overview, dashboardBase }: OverviewCardProps) {
  if (!orgSlug) {
    return (
      <article className="fleet-card fleet-card--info">
        <header className="fleet-card__head">
          <span className="fleet-card__dot fleet-card__dot--info" aria-hidden="true" />
          <h4 className="fleet-card__title">Your org</h4>
        </header>
        <p className="fleet-card__value">Not connected</p>
        <p className="fleet-card__detail">
          Tell Workspace which Fleet org to talk to and we'll surface live agent + policy + audit
          counts here.
        </p>
      </article>
    );
  }
  if (!overview) {
    return (
      <article className="fleet-card fleet-card--info">
        <header className="fleet-card__head">
          <span className="fleet-card__dot fleet-card__dot--info" aria-hidden="true" />
          <h4 className="fleet-card__title">Your org</h4>
        </header>
        <p className="fleet-card__value">Loading…</p>
        <p className="fleet-card__detail">
          Fetching live data from {orgSlug}.fleet.sigmashake.com.
        </p>
      </article>
    );
  }
  if (!overview.authed) {
    return (
      <article className="fleet-card fleet-card--warn">
        <header className="fleet-card__head">
          <span className="fleet-card__dot fleet-card__dot--warn" aria-hidden="true" />
          <h4 className="fleet-card__title">Your org</h4>
        </header>
        <p className="fleet-card__value">Sign in required</p>
        <p className="fleet-card__detail">
          {overview.error ??
            `No active SSO session for ${orgSlug}.fleet.sigmashake.com. Sign in to see live data here.`}
        </p>
        <a href={dashboardBase} target="_blank" rel="noreferrer" className="fleet-card__cta">
          Sign in to Fleet →
        </a>
      </article>
    );
  }
  return (
    <article className="fleet-card fleet-card--ok">
      <header className="fleet-card__head">
        <span className="fleet-card__dot fleet-card__dot--ok" aria-hidden="true" />
        <h4 className="fleet-card__title">Your org</h4>
      </header>
      <p className="fleet-card__value">
        {overview.session?.orgSlug ?? orgSlug}
        {overview.session?.role ? (
          <span className="fleet-card__sub"> · {overview.session.role}</span>
        ) : null}
      </p>
      <ul className="fleet-card__kv">
        <li>
          <span>Agents</span>
          <span>
            <span className="fleet-card__good">{overview.counts.agentsActive}</span> active
            <span className="fleet-card__muted"> / {overview.counts.agentsTotal} total</span>
          </span>
        </li>
        <li>
          <span>Policies</span>
          <span>
            {overview.counts.policiesPending > 0 ? (
              <span className="fleet-card__bad">{overview.counts.policiesPending} pending</span>
            ) : (
              <span className="fleet-card__good">all clear</span>
            )}
            <span className="fleet-card__muted">
              {" "}
              / {overview.counts.policiesApproved} approved
            </span>
          </span>
        </li>
        <li>
          <span>Audit (24h)</span>
          <span>{overview.counts.auditLast24h}</span>
        </li>
      </ul>
    </article>
  );
}

interface ConnectOrgCardProps {
  orgSlug: string;
  overview: FleetOverview | null;
  onSlugChange: (slug: string) => void;
}

function ConnectOrgCard({ orgSlug, overview, onSlugChange }: ConnectOrgCardProps) {
  const [draft, setDraft] = useState(orgSlug);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(orgSlug), [orgSlug]);
  const dirty = draft.trim() !== orgSlug;
  const submit = useCallback(
    (e?: React.FormEvent) => {
      e?.preventDefault();
      const next = draft.trim().toLowerCase();
      if (next === "") {
        setError(null);
        onSlugChange("");
        return;
      }
      if (!FLEET_SLUG_RE.test(next)) {
        setError("Slug must be 2–40 characters, lowercase letters, digits, and dashes.");
        return;
      }
      setError(null);
      onSlugChange(next);
    },
    [draft, onSlugChange],
  );

  // Once we're authed and not editing, collapse to a compact summary.
  if (overview?.authed && !dirty) {
    return (
      <section className="fleet__connect fleet__connect--compact">
        <span className="fleet__connect-label">Connected to</span>
        <code className="fleet__connect-slug">{orgSlug}.fleet.sigmashake.com</code>
        <button
          type="button"
          className="fleet__connect-link"
          onClick={() => {
            setDraft("");
            onSlugChange("");
          }}
        >
          Disconnect
        </button>
      </section>
    );
  }

  return (
    <section className="fleet__connect">
      <h4 className="fleet__h4">Connect your org</h4>
      <p className="panel__muted fleet__connect-hint">
        Enter the subdomain of your Fleet dashboard — for{" "}
        <code>acme-corp.fleet.sigmashake.com</code> that's <strong>acme-corp</strong>. The slug is
        stored in this Workspace's settings.
      </p>
      <form className="fleet__connect-form" onSubmit={submit}>
        <input
          type="text"
          className="fleet__connect-input"
          placeholder="acme-corp"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
          autoCorrect="off"
          spellCheck={false}
          maxLength={40}
        />
        <button
          type="submit"
          className={`fleet__connect-submit${dirty ? " fleet__connect-submit--primary" : ""}`}
          disabled={!dirty}
        >
          {orgSlug && draft.trim() === "" ? "Clear" : "Save"}
        </button>
      </form>
      {error ? <p className="fleet__connect-error">{error}</p> : null}
    </section>
  );
}

interface SectionProps {
  overview: FleetOverview;
  dashboardBase: string;
}

function AgentsSection({ overview, dashboardBase }: SectionProps) {
  if (overview.agents.length === 0) {
    return (
      <section className="fleet__section">
        <header className="fleet__section-head">
          <h4 className="fleet__h4">Agents</h4>
          <a
            href={`${dashboardBase}/agents`}
            target="_blank"
            rel="noreferrer"
            className="fleet__section-link"
          >
            Manage →
          </a>
        </header>
        <p className="panel__muted">
          No agents yet. Generate an enrollment profile from the dashboard and install on a machine.
        </p>
      </section>
    );
  }
  return (
    <section className="fleet__section">
      <header className="fleet__section-head">
        <h4 className="fleet__h4">
          Agents <span className="fleet__section-meta">{overview.agents.length}</span>
        </h4>
        <a
          href={`${dashboardBase}/agents`}
          target="_blank"
          rel="noreferrer"
          className="fleet__section-link"
        >
          Manage →
        </a>
      </header>
      <ul className="fleet__table">
        {overview.agents.slice(0, 10).map((a) => (
          <AgentRow key={a.id} agent={a} />
        ))}
      </ul>
    </section>
  );
}

function AgentRow({ agent }: { agent: FleetAgentSummary }) {
  const tone = agent.status === "active" ? "ok" : agent.status === "revoked" ? "err" : "warn";
  return (
    <li className="fleet__row">
      <span className={`fleet-card__dot fleet-card__dot--${tone}`} aria-hidden="true" />
      <span className="fleet__row-main">
        <span className="fleet__row-title">{agent.label ?? agent.id}</span>
        <span className="fleet__row-sub">
          {agent.agentVersion ? `v${agent.agentVersion}` : "—"}
          {agent.lastHeartbeatAt ? ` · ${timeAgo(agent.lastHeartbeatAt)}` : " · no heartbeat"}
        </span>
      </span>
      <span className="fleet__row-tag">{agent.status}</span>
    </li>
  );
}

function PoliciesSection({ overview, dashboardBase }: SectionProps) {
  const pending = overview.policies.filter((p) => p.status === "pending_review");
  return (
    <section className="fleet__section">
      <header className="fleet__section-head">
        <h4 className="fleet__h4">
          Policies <span className="fleet__section-meta">{overview.policies.length}</span>
        </h4>
        <a
          href={`${dashboardBase}/policies`}
          target="_blank"
          rel="noreferrer"
          className="fleet__section-link"
        >
          Manage →
        </a>
      </header>
      {pending.length > 0 ? (
        <ul className="fleet__table">
          {pending.slice(0, 5).map((p) => (
            <PolicyRow key={p.id} policy={p} highlight />
          ))}
        </ul>
      ) : (
        <p className="panel__muted">
          No policies waiting for approval. Approved policies stay enforced across every agent in
          your org.
        </p>
      )}
    </section>
  );
}

function PolicyRow({ policy, highlight }: { policy: FleetPolicySummary; highlight?: boolean }) {
  const tone = highlight ? "warn" : "ok";
  return (
    <li className="fleet__row">
      <span className={`fleet-card__dot fleet-card__dot--${tone}`} aria-hidden="true" />
      <span className="fleet__row-main">
        <span className="fleet__row-title">{policy.name}</span>
        <span className="fleet__row-sub">
          v{policy.version} · layer {policy.priorityLayer} · {timeAgo(policy.updatedAt)}
        </span>
      </span>
      <span className="fleet__row-tag">{policy.status.replace(/_/g, " ")}</span>
    </li>
  );
}

function AuditSection({ overview, dashboardBase }: SectionProps) {
  if (overview.audit.length === 0) {
    return (
      <section className="fleet__section">
        <header className="fleet__section-head">
          <h4 className="fleet__h4">Recent audit</h4>
          <a
            href={`${dashboardBase}/audit`}
            target="_blank"
            rel="noreferrer"
            className="fleet__section-link"
          >
            Browse →
          </a>
        </header>
        <p className="panel__muted">No audit events yet.</p>
      </section>
    );
  }
  return (
    <section className="fleet__section">
      <header className="fleet__section-head">
        <h4 className="fleet__h4">
          Recent audit <span className="fleet__section-meta">{overview.audit.length}</span>
        </h4>
        <a
          href={`${dashboardBase}/audit`}
          target="_blank"
          rel="noreferrer"
          className="fleet__section-link"
        >
          Browse →
        </a>
      </header>
      <ul className="fleet__table">
        {overview.audit.map((e) => (
          <AuditRow key={e.id} event={e} />
        ))}
      </ul>
    </section>
  );
}

function AuditRow({ event }: { event: FleetAuditEvent }) {
  return (
    <li className="fleet__row">
      <span className="fleet-card__dot fleet-card__dot--info" aria-hidden="true" />
      <span className="fleet__row-main">
        <span className="fleet__row-title">{event.eventType}</span>
        <span className="fleet__row-sub">
          {timeAgo(event.createdAt)}
          {event.agentId ? ` · ${event.agentId.slice(0, 12)}` : ""}
        </span>
      </span>
      <span className="fleet__row-summary">{event.summary}</span>
    </li>
  );
}

interface FleetLinkProps {
  href: string;
  label: string;
  hint: string;
}

function FleetLink({ href, label, hint }: FleetLinkProps) {
  return (
    <li className="fleet__link-item">
      <a href={href} target="_blank" rel="noreferrer" className="fleet__link">
        <span className="fleet__link-label">{label}</span>
        <span className="fleet__link-arrow" aria-hidden="true">
          ↗
        </span>
      </a>
      <p className="fleet__link-hint">{hint}</p>
    </li>
  );
}

function timeAgo(ms: number): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 60_000) return "just now";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}

export { FleetView as default };
