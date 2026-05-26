// Monorepo-wide "Observability" panel — the consolidated health board for
// every SigmaShake platform service, read from sigmashake-observ.
//
// Cloud-only by design: the workspace Worker holds the OBSERV service binding,
// so local + electrobun + vscode runtimes render an "open in cloud" CTA.
//
// sigmashake-observ is a synthetic uptime monitor — it keeps state, not
// history. This view surfaces exactly that: a current status per service, a
// small recent-checks ring, and a capped incident log. Nothing heavier.

import { useCallback } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type { ObservIncident, ObservService, ObservStatus } from "../api/types";
import { useWorkspaceCache } from "../lib/workspace-cache";
import "../styles/observability.css";
import { ProgressStrip } from "./ProgressStrip";

interface Props {
  client: WorkspaceApiClient | null;
}

// The monitor cron runs every 5 min. 13 min covers two missed ticks before we
// flag the board as stale.
const STALE_AFTER_MS = 13 * 60 * 1000;

export function ObservabilityView({ client }: Props) {
  const cache = useWorkspaceCache();
  const slice = cache.observability;
  const board = slice.data;

  const refresh = useCallback(() => {
    slice.refresh();
  }, [slice]);

  // Cloud-only — the OBSERV service binding lives on the workspace Worker.
  const isCloud = client?.runtime === "cloud";

  if (!isCloud) {
    return (
      <div className="panel observ">
        <header className="observ__header">
          <div>
            <h3 className="panel__h3">Observability</h3>
            <p className="panel__muted">
              One board for the health of every SigmaShake service — what is up, what is
              down, and what changed.
            </p>
          </div>
        </header>
        <div className="state-card">
          <h2 className="state-card__title">Open Observability in the cloud</h2>
          <p className="state-card__body">
            The health board is served by sigmashake-observ through a service binding that
            only the workspace.sigmashake.com Cloudflare Worker holds. Open it in your
            browser to see which services are healthy.
          </p>
          <p className="state-card__hints" style={{ marginTop: 16 }}>
            <a
              className="pill-btn pill-btn--primary"
              href="https://workspace.sigmashake.com/"
              target="_blank"
              rel="noreferrer"
            >
              Open workspace.sigmashake.com →
            </a>
          </p>
        </div>
      </div>
    );
  }

  if (!board && slice.loading) {
    return (
      <div className="panel observ">
        <h3 className="panel__h3">Observability</h3>
        <ProgressStrip loading={true} label="Loading the service-health board…" />
      </div>
    );
  }

  if (!board && slice.error) {
    return (
      <div className="panel observ">
        <h3 className="panel__h3">Observability</h3>
        <div className="state-card state-card--error">
          <p className="state-card__body">{slice.error}</p>
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            onClick={refresh}
            disabled={slice.loading}
            style={{ marginTop: 12 }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!board) return null;

  const monitored = board.services.filter((s) => s.monitored);
  const unmonitored = board.services.filter((s) => !s.monitored);
  const sorted = [...monitored].sort(byStatusThenName);
  const counts = tallyStatuses(monitored);
  const neverProbed = board.generatedAt === 0;
  const stale = !neverProbed && Date.now() - board.generatedAt > STALE_AFTER_MS;
  const incidents = board.incidents.slice(0, 25);
  const allHealthy =
    !neverProbed && counts.down === 0 && counts.degraded === 0 && counts.unknown === 0;

  return (
    <div className="panel observ">
      <ProgressStrip loading={slice.loading} label={slice.loading ? "Refreshing…" : ""} />
      <header className="observ__header">
        <div>
          <h3 className="panel__h3">Observability</h3>
          <p className="panel__muted">
            Live health of every SigmaShake platform service, probed every 5 minutes by
            sigmashake-observ. Keeps state, not history — current status, a recent-checks
            ring, and the incident log.
          </p>
        </div>
        <button
          type="button"
          className="fleet__refresh"
          onClick={refresh}
          disabled={slice.loading}
          title="Re-read the health board"
        >
          {slice.loading ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {neverProbed ? (
        <div className="observ__banner observ__banner--info">
          <strong>Awaiting the first probe.</strong>{" "}
          <span>
            sigmashake-observ runs every 5 minutes — the board fills in on the next tick.
          </span>
        </div>
      ) : stale ? (
        <div className="observ__banner observ__banner--warn">
          <strong>Monitoring data is stale.</strong>{" "}
          <span>Last probe {relAge(board.generatedAt)} ago — the observ cron may be stuck.</span>
        </div>
      ) : allHealthy ? (
        <div className="observ__banner observ__banner--ok">
          <strong>All monitored services are healthy.</strong>{" "}
          <span>{counts.up} services responding normally.</span>
        </div>
      ) : null}

      <section className="observ__summary">
        <StatCard label="Healthy" value={counts.up} tone="ok" hint="Responding normally" />
        <StatCard label="Degraded" value={counts.degraded} tone="warn" hint="Responding 5xx" />
        <StatCard label="Down" value={counts.down} tone="err" hint="No response to probes" />
        <StatCard
          label="Monitored"
          value={monitored.length}
          tone="muted"
          hint={`of ${board.services.length} on the board`}
        />
      </section>

      <section className="observ__grid">
        {sorted.map((s) => (
          <ServiceCard key={s.slug} service={s} />
        ))}
      </section>

      <IncidentLog incidents={incidents} />

      {unmonitored.length > 0 ? <UnmonitoredNote services={unmonitored} /> : null}

      <p className="observ__foot">
        {neverProbed
          ? "No probe has run yet."
          : `Board generated ${relAge(board.generatedAt)} ago · monitor cron runs every 5 min.`}
      </p>
    </div>
  );
}

// ── Summary stat cards ───────────────────────────────────────────────────────

type Tone = "ok" | "warn" | "err" | "muted";

interface StatCardProps {
  label: string;
  value: number;
  tone: Tone;
  hint: string;
}

function StatCard({ label, value, tone, hint }: StatCardProps) {
  return (
    <article className={`observ-stat observ-stat--${tone}`}>
      <span className="observ-stat__value">{value}</span>
      <span className="observ-stat__label">{label}</span>
      <span className="observ-stat__hint">{hint}</span>
    </article>
  );
}

// ── Per-service card ─────────────────────────────────────────────────────────

function ServiceCard({ service }: { service: ObservService }) {
  const tone = statusTone(service.status);
  return (
    <article className={`observ-card observ-card--${tone}`}>
      <header className="observ-card__head">
        <span className={`observ-card__dot observ-card__dot--${tone}`} aria-hidden="true" />
        <span className="observ-card__name" title={service.slug}>
          {service.name}
        </span>
        <StatusPill status={service.status} />
      </header>
      <p className="observ-card__blurb">{service.blurb}</p>
      <Sparkline checks={service.recentChecks} />
      <dl className="observ-card__meta">
        <div>
          <dt>Since</dt>
          <dd>{relAge(service.since)}</dd>
        </div>
        <div>
          <dt>Uptime</dt>
          <dd>{fmtUptime(service.uptimeRecent)}</dd>
        </div>
        <div>
          <dt>Latency</dt>
          <dd>{service.lastLatencyMs != null ? `${service.lastLatencyMs}ms` : "—"}</dd>
        </div>
        <div>
          <dt>HTTP</dt>
          <dd>{service.lastHttpCode != null ? service.lastHttpCode : "—"}</dd>
        </div>
      </dl>
      {service.lastError && service.status !== "up" ? (
        <p className="observ-card__error" title={service.lastError}>
          {service.lastError}
        </p>
      ) : null}
    </article>
  );
}

function Sparkline({ checks }: { checks: ObservService["recentChecks"] }) {
  if (checks.length === 0) {
    return <div className="observ-spark observ-spark--empty">No checks yet</div>;
  }
  // Show the most recent ~48 slots so the row stays compact.
  const slots = checks.slice(-48);
  return (
    <div className="observ-spark" title={`${checks.length} recent checks`}>
      {slots.map((c, i) => (
        <span
          key={`${c.at}-${i}`}
          className={`observ-spark__bar observ-spark__bar--${c.ok ? "ok" : "bad"}`}
        />
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: ObservStatus }) {
  const label = status === "up" ? "healthy" : status;
  return <span className={`observ-pill observ-pill--${statusTone(status)}`}>{label}</span>;
}

// ── Incident log ─────────────────────────────────────────────────────────────

function IncidentLog({ incidents }: { incidents: ObservIncident[] }) {
  return (
    <section className="observ-incidents">
      <h4 className="observ-incidents__title">Recent incidents</h4>
      {incidents.length === 0 ? (
        <p className="observ-incidents__empty">
          No status changes recorded — every service has held steady.
        </p>
      ) : (
        <ul className="observ-incidents__list">
          {incidents.map((inc) => (
            <li key={`${inc.slug}-${inc.at}`} className="observ-incident">
              <span className={`observ-pill observ-pill--${incidentTone(inc.kind)}`}>
                {inc.kind}
              </span>
              <span className="observ-incident__name">{inc.name}</span>
              <span className="observ-incident__detail">{inc.detail}</span>
              <span className="observ-incident__age">{relAge(inc.at)} ago</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ── Unmonitored / local services ─────────────────────────────────────────────

function UnmonitoredNote({ services }: { services: ObservService[] }) {
  const cloud = services.filter((s) => s.scope === "cloud");
  const local = services.filter((s) => s.scope === "local");
  return (
    <details className="observ-extra">
      <summary className="observ-extra__summary">
        On the board but not probed ({services.length})
      </summary>
      <div className="observ-extra__body">
        {cloud.length > 0 ? (
          <p className="observ-extra__line">
            <strong>Cloud, not yet wired:</strong> {cloud.map((s) => s.name).join(", ")}. Add a
            service binding to sigmashake-observ to start monitoring one.
          </p>
        ) : null}
        {local.length > 0 ? (
          <p className="observ-extra__line">
            <strong>Local services:</strong> {local.map((s) => s.name).join(", ")}. These bind
            127.0.0.1 and are not reachable from the cloud monitor.
          </p>
        ) : null}
      </div>
    </details>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_RANK: Record<ObservStatus, number> = { down: 0, degraded: 1, unknown: 2, up: 3 };

function byStatusThenName(a: ObservService, b: ObservService): number {
  const r = STATUS_RANK[a.status] - STATUS_RANK[b.status];
  return r !== 0 ? r : a.name.localeCompare(b.name);
}

function tallyStatuses(services: ObservService[]): {
  up: number;
  degraded: number;
  down: number;
  unknown: number;
} {
  const counts = { up: 0, degraded: 0, down: 0, unknown: 0 };
  for (const s of services) counts[s.status] += 1;
  return counts;
}

function statusTone(status: ObservStatus): Tone {
  if (status === "up") return "ok";
  if (status === "degraded") return "warn";
  if (status === "down") return "err";
  return "muted";
}

function incidentTone(kind: ObservIncident["kind"]): Tone {
  if (kind === "recovered") return "ok";
  if (kind === "degraded") return "warn";
  return "err";
}

function fmtUptime(u: number | null): string {
  return u == null ? "—" : `${Math.round(u * 100)}%`;
}

function relAge(epochMs: number): string {
  if (!epochMs) return "—";
  const diff = Date.now() - epochMs;
  if (diff < 60_000) return "just now";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  return `${Math.floor(hr / 24)}d`;
}
