import { useEffect, useState } from "react";
import type { WorkspaceApiClient } from "../api/client";
import type { HealthSummary, ProjectCard } from "../api/types";
import { friendlyError } from "../lib/errors";

interface Props {
  card: ProjectCard;
  client: WorkspaceApiClient;
}

export function InspectPanel({ card, client }: Props) {
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setHealth(null);
    (async () => {
      try {
        const res = await client.getHealth([card.slug]);
        if (!cancelled) setHealth(res[card.slug] ?? null);
      } catch (err) {
        if (!cancelled) setError(friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card.slug, client]);

  if (error) {
    return (
      <div className="panel">
        <div className="state-card state-card--error">
          <h2 className="state-card__title">Couldn&apos;t check health</h2>
          <p className="state-card__body">{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !health) {
    return (
      <div className="panel">
        <h3 className="panel__h3">Health</h3>
        <div className="health-grid">
          {[0, 1, 2, 3].map((i) => (
            <div className="health-card" key={i}>
              <div className="health-card__head">
                <div className="health-card__icon" />
                <span className="health-card__label">Loading…</span>
              </div>
              <div className="health-card__value">—</div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const gitVariant: HealthVariant = health.gitDirty
    ? "warn"
    : health.gitAheadOriginMain > 0 || health.gitBehindOriginMain > 0
      ? "warn"
      : "ok";
  const gitWord = health.gitDirty
    ? "Dirty"
    : health.gitAheadOriginMain > 0
      ? `Ahead +${health.gitAheadOriginMain}`
      : health.gitBehindOriginMain > 0
        ? `Behind -${health.gitBehindOriginMain}`
        : "Clean";

  const deployVariant: HealthVariant =
    health.deployGateOk === null ? "unknown" : health.deployGateOk ? "ok" : "fail";
  const deployWord =
    health.deployGateOk === null ? "n/a" : health.deployGateOk ? "Cleared" : "Blocked";

  const buildLabel = formatRelativeTime(health.lastBuildAt);
  const buildVariant: HealthVariant =
    health.lastBuildAt == null
      ? "unknown"
      : Date.now() - health.lastBuildAt < 24 * 3600 * 1000
        ? "ok"
        : "warn";

  const testVariant: HealthVariant =
    health.lastTestAt == null ? "unknown" : health.lastTestOk ? "ok" : "fail";
  const testWord = health.lastTestAt == null ? "Never" : health.lastTestOk ? "Passed" : "Failed";

  return (
    <div className="panel">
      <h3 className="panel__h3">Health</h3>
      <div className="health-grid">
        <HealthCard
          variant={gitVariant}
          label="Git status"
          value={gitWord}
          icon={<IconBranch />}
          details={[`${health.gitAheadOriginMain} ahead · ${health.gitBehindOriginMain} behind`]}
        />
        <HealthCard
          variant={deployVariant}
          label="Deploy gate"
          value={deployWord}
          icon={<IconShield />}
          details={
            health.deployGateOk === false
              ? ["You have local changes that aren't pushed yet — push them before deploying."]
              : health.deployGateOk
                ? ["Everything's pushed — safe to deploy."]
                : ["This project doesn't deploy anywhere."]
          }
        />
        <HealthCard
          variant={buildVariant}
          label="Last build"
          value={buildLabel ?? "Never"}
          icon={<IconHammer />}
          details={
            health.lastBuildAt
              ? [new Date(health.lastBuildAt).toLocaleString()]
              : ["Hasn't been built yet."]
          }
        />
        <HealthCard
          variant={testVariant}
          label="Last test"
          value={testWord}
          icon={<IconBeaker />}
          details={
            health.lastTestAt
              ? [new Date(health.lastTestAt).toLocaleString()]
              : ["Hasn't been tested yet."]
          }
        />
      </div>
    </div>
  );
}

type HealthVariant = "ok" | "warn" | "fail" | "unknown";

interface HealthCardProps {
  variant: HealthVariant;
  label: string;
  value: string;
  icon: React.ReactNode;
  details: string[];
}

function HealthCard({ variant, label, value, icon, details }: HealthCardProps) {
  return (
    <div className={`health-card health-card--${variant}`}>
      <div className="health-card__head">
        <div className="health-card__icon">{icon}</div>
        <span className="health-card__label">{label}</span>
      </div>
      <div className="health-card__value">{value}</div>
      {details.length > 0 && (
        <ul className="health-card__detail-list">
          {details.map((d, i) => (
            <li key={i}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function formatRelativeTime(ts: number | null): string | null {
  if (ts == null) return null;
  const delta = Date.now() - ts;
  if (delta < 0) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function IconBranch() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="3" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="4" cy="13" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="12" cy="6" r="1.6" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M4 4.7 V11.3 M4 8 C 4 6.3 5.6 6 7 6 H 10"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

function IconShield() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M8 1.5 L13.5 3.6 V8 C 13.5 11.2 11.2 13.6 8 14.5 C 4.8 13.6 2.5 11.2 2.5 8 V3.6 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M5.5 8 L7.3 9.7 L10.5 6.5"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function IconHammer() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M10 2 L14 6 L11.5 8.5 L7.5 4.5 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M9 6 L3 12 L4.5 13.5 L10.5 7.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function IconBeaker() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M6 2 H10 V6 L13 12 C 13.5 13 12.7 14 11.6 14 H 4.4 C 3.3 14 2.5 13 3 12 L6 6 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
      <path d="M4.5 10 H 11.5" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
