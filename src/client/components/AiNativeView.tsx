// Monorepo-wide "AI Native" view. For every app it answers two questions:
//
//   1. How AI-native is it? Five capability signals — agent docs, a CLI, an
//      MCP server, a JSON API, and agent integration — fold into a 0-100
//      score and a tier (AI-Native / Capable / Partial / Opaque). The tier
//      says whether an agent can discover, drive, and reason about the
//      service without a human in the loop.
//
//   2. How fast does "doing anything" with it come back? A latency gauge,
//      measured on loopback where the service declares a port and is running,
//      classified by architecture otherwise. The standing goal is a
//      sub-millisecond response — the gauge is honest about when an
//      architecture (an edge Worker, an LLM-backed service) can't reach it.
//
// Data source: the AiNativeResponse slice of the shared WorkspaceCache, which
// hits the SSG daemon's /api/json/workspace/ai-native endpoint. The cloud
// runtime can't scan the operator's tree or probe their loopback, so it
// surfaces a "open in SigmaShake Desktop" message instead.

import { useMemo, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type {
  AiLatencyGauge,
  AiLatencyTier,
  AiLatencyVerdict,
  AiNativeReport,
  AiNativeSignal,
  AiNativeSignalState,
  AiNativeTier,
} from "../api/types";
import { friendlyError } from "../lib/errors";
import { useWorkspaceCache } from "../lib/workspace-cache";
import { ProgressStrip } from "./ProgressStrip";

interface Props {
  client: WorkspaceApiClient | null;
}

// ── Display constants ─────────────────────────────────────────────────────────

const TIER_LABELS: Record<AiNativeTier, string> = {
  native: "AI-Native",
  capable: "Capable",
  partial: "Partial",
  opaque: "Opaque",
};

const TIER_BLURB: Record<AiNativeTier, string> = {
  native:
    "Agents can discover, drive, and reason about this service end-to-end.",
  capable: "An agent has real control surfaces but a gap or two remains.",
  partial: "An agent can reach it, but only awkwardly — key surfaces missing.",
  opaque: "Effectively closed to agents — they'd have to reverse-engineer it.",
};

const SIGNAL_STATE_LABEL: Record<AiNativeSignalState, string> = {
  ok: "Present",
  warn: "Partial",
  missing: "Missing",
  na: "N/A",
};

// Single-letter glyph for the compact signal dots on a collapsed row.
const SIGNAL_GLYPH: Record<AiNativeSignal["id"], string> = {
  "agent-docs": "D",
  cli: "C",
  mcp: "M",
  "json-api": "A",
  integration: "I",
};

// Latency tiers, fastest → slowest. The gauge renders these as a track.
const LATENCY_TIERS: { id: AiLatencyTier; label: string; short: string }[] = [
  { id: "nanosecond", label: "Nanoseconds", short: "ns" },
  { id: "microsecond", label: "Microseconds", short: "µs" },
  { id: "submillisecond", label: "Sub-millisecond", short: "<1 ms" },
  { id: "millisecond", label: "Milliseconds", short: "ms" },
  { id: "edge", label: "Edge round-trip", short: "edge" },
  { id: "second", label: "Seconds", short: "s+" },
];

const VERDICT_LABEL: Record<AiLatencyVerdict, string> = {
  meets: "Meets sub-ms goal",
  acceptable: "Acceptable",
  slow: "Slow",
  unmeasured: "Not measured",
};

type SortMode = "tier-asc" | "tier-desc" | "score-desc" | "latency" | "slug";

// ── Helpers ───────────────────────────────────────────────────────────────────

const TIER_RANK: Record<AiNativeTier, number> = {
  opaque: 0,
  partial: 1,
  capable: 2,
  native: 3,
};

function gapCount(report: AiNativeReport): number {
  // `na` — a signal that does not apply to this architecture — is not a gap.
  return report.signals.filter((s) => s.state !== "ok" && s.state !== "na")
    .length;
}

/** Concern rank for the "latency" sort — slow + unmeasured float to the top. */
function latencyConcern(gauge: AiLatencyGauge): number {
  if (gauge.verdict === "slow") return 0;
  if (gauge.verdict === "unmeasured") return 1;
  if (gauge.verdict === "acceptable") return 2;
  return 3; // meets
}

/** Sub-millisecond reads as microseconds — the goal is to think small. */
function formatLatency(ms: number): string {
  if (ms < 1) return `${Math.round(ms * 1000)} µs`;
  if (ms < 10) return `${ms.toFixed(2)} ms`;
  return `${Math.round(ms)} ms`;
}

function timeAgo(epochMs: number): string {
  const delta = Math.max(0, Date.now() - epochMs);
  if (delta < 60_000) return "just now";
  const mins = Math.floor(delta / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function TierBadge({ tier, large = false }: { tier: AiNativeTier; large?: boolean }) {
  return (
    <span
      className={`ain__tier ain__tier--${tier}${large ? " ain__tier--large" : ""}`}
    >
      {TIER_LABELS[tier]}
    </span>
  );
}

function TierCount({ tier, count }: { tier: AiNativeTier; count: number }) {
  return (
    <span className={`ain__tier-count ain__tier-count--${tier}`}>
      {count} {TIER_LABELS[tier]}
    </span>
  );
}

function SignalDot({ signal }: { signal: AiNativeSignal }) {
  return (
    <span
      className={`ain__dot ain__dot--${signal.state}`}
      title={`${signal.label}: ${SIGNAL_STATE_LABEL[signal.state]}`}
    >
      {SIGNAL_GLYPH[signal.id]}
    </span>
  );
}

/** Compact latency pill for a collapsed service row. */
function LatencyChip({ gauge }: { gauge: AiLatencyGauge }) {
  const text =
    gauge.observedMs !== null
      ? formatLatency(gauge.observedMs)
      : (LATENCY_TIERS.find((t) => t.id === gauge.tier)?.short ?? "—");
  return (
    <span
      className={`ain__lat-chip ain__lat-chip--${gauge.verdict}`}
      title={gauge.note}
    >
      <span className="ain__lat-chip-dot" aria-hidden="true" />
      {text}
      {gauge.observedMs === null ? (
        <span className="ain__lat-chip-tag">expected</span>
      ) : null}
    </span>
  );
}

/** The full latency gauge — a labelled track with the sub-ms goal flagged. */
function LatencyGaugePanel({ gauge }: { gauge: AiLatencyGauge }) {
  const activeIdx = LATENCY_TIERS.findIndex((t) => t.id === gauge.tier);
  const targetIdx = LATENCY_TIERS.findIndex((t) => t.id === gauge.targetTier);
  return (
    <div className={`ain__gauge ain__gauge--${gauge.verdict}`}>
      <div className="ain__gauge-head">
        <span className="ain__gauge-title">Response latency</span>
        <span className={`ain__verdict ain__verdict--${gauge.verdict}`}>
          {VERDICT_LABEL[gauge.verdict]}
        </span>
        {gauge.observedMs !== null ? (
          <span className="ain__gauge-measured">
            measured {formatLatency(gauge.observedMs)}
            {gauge.probedPort !== null ? ` · :${gauge.probedPort}` : ""}
          </span>
        ) : (
          <span className="ain__gauge-measured ain__gauge-measured--dim">
            architecture estimate
          </span>
        )}
      </div>
      <div className="ain__track" role="img" aria-label={gauge.note}>
        {LATENCY_TIERS.map((t, i) => (
          <div
            key={t.id}
            className={
              "ain__track-seg" +
              (i === activeIdx ? " ain__track-seg--active" : "") +
              (i === targetIdx ? " ain__track-seg--target" : "") +
              (targetIdx >= 0 && i <= targetIdx ? " ain__track-seg--inGoal" : "")
            }
          >
            <span className="ain__track-short">{t.short}</span>
            {i === targetIdx ? (
              <span className="ain__track-goal">goal</span>
            ) : null}
          </div>
        ))}
      </div>
      <p className="ain__gauge-note">{gauge.note}</p>
    </div>
  );
}

function SignalCard({ signal }: { signal: AiNativeSignal }) {
  return (
    <li className={`ain__signal ain__signal--${signal.state}`}>
      <div className="ain__signal-top">
        <span className={`ain__signal-state ain__signal-state--${signal.state}`}>
          {SIGNAL_STATE_LABEL[signal.state]}
        </span>
        <span className="ain__signal-label">{signal.label}</span>
      </div>
      <p className="ain__signal-note">{signal.note}</p>
      {signal.evidence.length > 0 ? (
        <ul className="ain__evidence">
          {signal.evidence.map((e, i) => (
            <li key={i} className="ain__evidence-item">
              {e}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ServiceRow({
  report,
  expanded,
  onToggle,
}: {
  report: AiNativeReport;
  expanded: boolean;
  onToggle: () => void;
}) {
  const gaps = gapCount(report);
  return (
    <article
      className={`ain__svc ain__svc--${report.tier}${expanded ? " ain__svc--expanded" : ""}`}
    >
      <button
        type="button"
        className="ain__svc-row"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={`ain__svc-stripe ain__svc-stripe--${report.tier}`} />
        <TierBadge tier={report.tier} />
        <span className="ain__svc-slug">{report.slug}</span>
        <span className="ain__svc-score" title="AI-native capability score">
          {report.score}
          <span className="ain__svc-score-max">/100</span>
        </span>
        <div className="ain__svc-dots" title="agent Docs · Cli · Mcp · json Api · Integration">
          {report.signals.map((s) => (
            <SignalDot key={s.id} signal={s} />
          ))}
        </div>
        <LatencyChip gauge={report.latency} />
        <span className="ain__svc-arch">{report.architecture}</span>
        <div className="ain__svc-meta">
          {gaps > 0 ? (
            <span className="ain__svc-gaps">
              {gaps} gap{gaps === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="ain__svc-gaps ain__svc-gaps--clear">covered</span>
          )}
        </div>
        <span className="ain__svc-chevron" aria-hidden="true">
          {expanded ? "▼" : "▶"}
        </span>
      </button>

      {expanded ? (
        <div className="ain__svc-detail">
          <div className={`ain__reco ain__reco--${report.tier}`}>
            <span className="ain__reco-label">Next step</span>
            <p className="ain__reco-text">{report.recommendation}</p>
          </div>
          <ul className="ain__signals">
            {report.signals.map((s) => (
              <SignalCard key={s.id} signal={s} />
            ))}
          </ul>
          <LatencyGaugePanel gauge={report.latency} />
          <p className="ain__svc-scanned">
            Scanned {timeAgo(report.generatedAt)}
            {report.cached ? " (cached)" : ""} · {report.architecture}
          </p>
        </div>
      ) : null}
    </article>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function AiNativeView({ client }: Props) {
  const cache = useWorkspaceCache();
  const slice = cache.aiNative;
  const data = slice.data;

  const [sort, setSort] = useState<SortMode>("tier-asc");
  const [expandedSlug, setExpandedSlug] = useState<string | null>(null);

  const sorted = useMemo(() => {
    if (!data) return [];
    const list = Object.values(data.reports);
    if (sort === "tier-asc") {
      return [...list].sort(
        (a, b) =>
          TIER_RANK[a.tier] - TIER_RANK[b.tier] || a.score - b.score,
      );
    }
    if (sort === "tier-desc") {
      return [...list].sort(
        (a, b) =>
          TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.score - a.score,
      );
    }
    if (sort === "score-desc") {
      return [...list].sort((a, b) => b.score - a.score);
    }
    if (sort === "latency") {
      return [...list].sort(
        (a, b) =>
          latencyConcern(a.latency) - latencyConcern(b.latency) ||
          (b.latency.observedMs ?? 0) - (a.latency.observedMs ?? 0),
      );
    }
    return [...list].sort((a, b) => a.slug.localeCompare(b.slug));
  }, [data, sort]);

  // ── Loading skeleton ────────────────────────────────────────────────────────
  if (!data && slice.loading && !slice.error) {
    return (
      <div className="ain">
        <header className="ain__hero ain__hero--skeleton">
          <ProgressStrip loading label="Scanning every service for AI-native surfaces" />
          <div className="ain__hero-score">
            <div className="ain__skeleton-gauge" />
            <div className="ain__hero-text">
              <div className="ain__skeleton-line" style={{ width: 260 }} />
              <div className="ain__skeleton-line" style={{ width: 380 }} />
            </div>
          </div>
        </header>
        <div className="ain__list">
          {Array.from({ length: 10 }).map((_, i) => (
            <div key={i} className="ain__skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  // ── Error / cloud-gated state ───────────────────────────────────────────────
  if (!data && slice.error) {
    const cloud = client?.hasLocalCapabilities === false;
    return (
      <div className="ain ain--empty">
        <h2 className="ain__empty-title">
          {cloud ? "AI Native runs on your machine" : "Couldn't run the AI-native scan"}
        </h2>
        <p className="ain__empty-body">{friendlyError(slice.error)}</p>
        {!cloud ? (
          <button
            type="button"
            className="ain__retry"
            onClick={() => slice.refresh()}
          >
            Retry scan
          </button>
        ) : null}
      </div>
    );
  }

  if (!data) return null;

  const tierCounts: Record<AiNativeTier, number> = {
    native: 0,
    capable: 0,
    partial: 0,
    opaque: 0,
  };
  for (const r of Object.values(data.reports)) tierCounts[r.tier]++;
  const total = sorted.length;

  return (
    <div className="ain">
      {/* ── Hero scorecard ─────────────────────────────────────────────────── */}
      <header className="ain__hero">
        <ProgressStrip
          loading={slice.loading}
          label={
            slice.loading
              ? "Refreshing in background"
              : slice.lastFetchedAt
                ? `Updated ${timeAgo(slice.lastFetchedAt)}`
                : ""
          }
        />
        <div className="ain__hero-score">
          <TierBadge tier={data.overallTier} large />
          <div className="ain__hero-text">
            <h2 className="ain__hero-title">
              AI-native readiness:{" "}
              <span className={`ain__hero-tier ain__hero-tier--${data.overallTier}`}>
                {TIER_LABELS[data.overallTier]}
              </span>{" "}
              <span className="ain__hero-num">{data.overallScore}/100</span>
            </h2>
            <p className="ain__hero-blurb">{TIER_BLURB[data.overallTier]}</p>
            <p className="ain__hero-meta">
              {total} service{total === 1 ? "" : "s"} scanned{" "}
              <TierCount tier="native" count={tierCounts.native} />{" "}
              <TierCount tier="capable" count={tierCounts.capable} />{" "}
              <TierCount tier="partial" count={tierCounts.partial} />{" "}
              <TierCount tier="opaque" count={tierCounts.opaque} />
            </p>
            <p className="ain__hero-latency">
              <strong>{data.probedCount}</strong> of {total} services carry a
              measured latency · <strong>{data.submillisecondCount}</strong>{" "}
              meet the sub-millisecond goal on loopback · the rest measured by
              cold MCP / CLI control-surface invocation.
            </p>
          </div>
        </div>
        <p className="ain__hero-axes">
          Each app is gauged on two axes — <strong>capability</strong> (can an
          agent discover, drive, and reason about it: agent docs, a CLI, an MCP
          server, a JSON API, agent integration) and <strong>latency</strong>{" "}
          (how fast it answers, against a sub-millisecond goal).
        </p>
        <div className="ain__hero-controls">
          <label className="ain__sort">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortMode)}
            >
              <option value="tier-asc">Opaque first</option>
              <option value="tier-desc">AI-Native first</option>
              <option value="score-desc">Highest score</option>
              <option value="latency">Slowest / unmeasured first</option>
              <option value="slug">A to Z</option>
            </select>
          </label>
          <button
            type="button"
            className="ain__rescan"
            onClick={() => slice.refresh()}
            disabled={slice.loading}
            title="Re-scan and re-probe every service now"
          >
            Re-scan
          </button>
        </div>
      </header>

      {/* ── Service list ───────────────────────────────────────────────────── */}
      <div className="ain__list">
        {sorted.map((report) => {
          const isExpanded = expandedSlug === report.slug;
          return (
            <ServiceRow
              key={report.slug}
              report={report}
              expanded={isExpanded}
              onToggle={() =>
                setExpandedSlug(isExpanded ? null : report.slug)
              }
            />
          );
        })}
      </div>
    </div>
  );
}
