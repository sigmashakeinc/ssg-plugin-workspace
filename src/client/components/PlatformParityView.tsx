// Platform parity matrix — SigmaShake Desktop feature checklist across
// Linux / macOS / Windows.
//
// Data source: the `platformParity` slice of WorkspaceCacheProvider, which
// calls GET /api/json/workspace/platform-parity. The SSG daemon merges the
// static catalog with the persisted result store (~/.sigmashake/platform-parity.json),
// so the matrix shows each feature × OS cell with its most recent verdict.
//
// The view is the operator's single answer to "are we consistent across
// every OS we ship for?" — every cell has status, last-checked timestamp,
// evidence, an OS-specific verification recipe, and a Recheck/Attest control.

import { useMemo, useState } from "react";
import { PLATFORM_PARITY_CATALOG } from "../../platform-parity-catalog";
import type { WorkspaceApiClient } from "../api/client";
import type {
  PlatformOs,
  PlatformParityCategory,
  PlatformParityFeature,
  PlatformParityResult,
  PlatformParityStatus,
} from "../api/types";
import { friendlyError } from "../lib/errors";
import { useWorkspaceCache } from "../lib/workspace-cache";
import { ProgressStrip } from "./ProgressStrip";
import "../styles/platform-parity.css";

type Tone = "ok" | "warn" | "err" | "muted" | "skip";

const STATUS_TONE: Record<PlatformParityStatus, Tone> = {
  pass: "ok",
  partial: "warn",
  fail: "err",
  skipped: "skip",
  unknown: "muted",
  "not-applicable": "muted",
};

const STATUS_LABEL: Record<PlatformParityStatus, string> = {
  pass: "Pass",
  partial: "Partial",
  fail: "Fail",
  skipped: "Skipped",
  unknown: "Unknown",
  "not-applicable": "N/A",
};

const STATUS_GLYPH: Record<PlatformParityStatus, string> = {
  pass: "✓",
  partial: "~",
  fail: "✗",
  skipped: "·",
  unknown: "?",
  "not-applicable": "—",
};

const CATEGORY_LABEL: Record<PlatformParityCategory, string> = {
  integration: "Integration",
  files: "Files & paths",
  ui: "UI",
  runtime: "SSG features",
  ipc: "IPC bridge",
  data: "Data & state",
  security: "Security",
  notifications: "Notifications",
  distribution: "Distribution",
};

const CATEGORY_ORDER: PlatformParityCategory[] = [
  "integration",
  "files",
  "ui",
  "runtime",
  "ipc",
  "data",
  "security",
  "notifications",
  "distribution",
];

const OS_ORDER: { id: PlatformOs; label: string; shortLabel: string }[] = [
  { id: "linux", label: "Linux", shortLabel: "L" },
  { id: "darwin", label: "macOS", shortLabel: "M" },
  { id: "win32", label: "Windows", shortLabel: "W" },
];

const CATALOG_BY_ID = new Map(PLATFORM_PARITY_CATALOG.map((e) => [e.id, e]));

// Daemon-side catalog ships with empty strings for label/description/verification
// to keep the bundle lean (those live in the workspace catalog so copy edits
// don't force a daemon rebuild). Hydrate them client-side at render time.
function hydrate(f: PlatformParityFeature): PlatformParityFeature {
  const ref = CATALOG_BY_ID.get(f.id);
  if (!ref) return f;
  return {
    ...f,
    label: f.label && f.label !== f.id ? f.label : ref.label,
    description: f.description || ref.description,
    verification: {
      linux: f.verification.linux || ref.verification.linux,
      darwin: f.verification.darwin || ref.verification.darwin,
      win32: f.verification.win32 || ref.verification.win32,
    },
  };
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

function absoluteTime(epochMs: number): string {
  try {
    return new Date(epochMs).toLocaleString();
  } catch {
    return new Date(epochMs).toISOString();
  }
}

function osLabel(os: PlatformOs): string {
  return OS_ORDER.find((o) => o.id === os)?.label ?? os;
}

interface Props {
  client: WorkspaceApiClient | null;
}

export function PlatformParityView({ client }: Props) {
  const cache = useWorkspaceCache();
  const slice = cache.platformParity;
  const raw = slice.data;
  const data = useMemo(() => {
    if (!raw) return null;
    return { ...raw, features: raw.features.map(hydrate) };
  }, [raw]);

  const [categoryFilter, setCategoryFilter] = useState<"all" | PlatformParityCategory>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "issues">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);

  if (!data && slice.loading && !slice.error) {
    return (
      <div className="parity">
        <header className="parity__hero parity__hero--skeleton">
          <ProgressStrip loading label="Scanning platform parity" />
        </header>
        <div className="parity__matrix-skeleton">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
            <div key={i} className="parity__skeleton-row" />
          ))}
        </div>
      </div>
    );
  }

  if (!data && slice.error) {
    return (
      <div className="parity parity--empty">
        <h2 className="parity__empty-title">Couldn&apos;t load platform parity</h2>
        <p className="parity__empty-body">{friendlyError(slice.error)}</p>
        <button type="button" className="parity__btn" onClick={() => slice.refresh()}>
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const visible = data.features.filter((f) => {
    if (categoryFilter !== "all" && f.category !== categoryFilter) return false;
    if (statusFilter === "issues") {
      const cells = [f.results.linux, f.results.darwin, f.results.win32];
      const hasIssue = cells.some((c) => {
        if (!c) return true;
        return c.status === "fail" || c.status === "partial" || c.status === "unknown";
      });
      if (!hasIssue) return false;
    }
    return true;
  });

  const groups = groupByCategory(visible);
  const selected = selectedId ? (data.features.find((f) => f.id === selectedId) ?? null) : null;

  const canRun = Boolean(client?.runPlatformParity) && Boolean(client?.hasLocalCapabilities);
  const canAttest = Boolean(client?.attestPlatformParity) && Boolean(client?.hasLocalCapabilities);

  const handleRunAll = async () => {
    if (!client) return;
    setRunBusy(true);
    setRunError(null);
    try {
      await client.runPlatformParity({});
      await slice.refresh();
    } catch (err) {
      setRunError(friendlyError(err));
    } finally {
      setRunBusy(false);
    }
  };

  return (
    <div className="parity">
      <header className="parity__hero">
        <ProgressStrip
          loading={slice.loading || runBusy}
          label={
            slice.loading || runBusy
              ? runBusy
                ? "Running auto-probes on this host"
                : "Refreshing in background"
              : `Updated ${timeAgo(data.generatedAt)}`
          }
        />
        <div className="parity__verdict">
          <ScoreRing score={data.summary.parityScore} />
          <div className="parity__verdict-text">
            <h2 className="parity__verdict-title">{data.summary.parityScore}% cross-OS parity</h2>
            <p className="parity__verdict-meta">
              {data.summary.pass} pass &middot; {data.summary.fail} fail &middot;{" "}
              {data.summary.partial} partial &middot; {data.summary.unknown} unknown &middot;{" "}
              {data.summary.skipped} skipped &middot; {data.summary.notApplicable} N/A
            </p>
            <p className="parity__verdict-meta">
              {data.summary.blockingGaps === 0 ? (
                <span className="parity__verdict-gap parity__verdict-gap--clear">
                  Every blocking feature is green on every OS column
                </span>
              ) : (
                <span className="parity__verdict-gap parity__verdict-gap--blocked">
                  {data.summary.blockingGaps} blocking feature
                  {data.summary.blockingGaps === 1 ? "" : "s"} still need{" "}
                  {data.summary.blockingGaps === 1 ? "a" : ""} green column
                </span>
              )}
            </p>
            <p className="parity__verdict-sub">
              Live evaluation of SigmaShake Desktop features across Linux + macOS + Windows.
              Auto-checks run on this host; manual attestations record per-OS field verdicts. This
              host: <code>{data.currentHostLabel}</code> (<code>{data.currentHostId}</code>).
            </p>
          </div>
          <div className="parity__controls">
            <button
              type="button"
              className="parity__btn parity__btn--primary"
              onClick={handleRunAll}
              disabled={!canRun || runBusy}
              title={
                canRun
                  ? "Run every auto-probe on this host"
                  : "Auto-probes need SigmaShake running locally"
              }
            >
              {runBusy ? "Running…" : "Run auto-probes here"}
            </button>
            <button
              type="button"
              className="parity__btn"
              onClick={() => slice.refresh()}
              disabled={slice.loading}
            >
              Re-scan
            </button>
          </div>
        </div>
        {runError ? <p className="parity__error">{runError}</p> : null}
        {data.storeError ? <p className="parity__warning">Note: {data.storeError}</p> : null}
      </header>

      <div className="parity__filters">
        <div className="parity__filter-group">
          <span className="parity__filter-label">Category</span>
          <button
            type="button"
            className={`parity__chip${categoryFilter === "all" ? " parity__chip--active" : ""}`}
            onClick={() => setCategoryFilter("all")}
          >
            All ({data.features.length})
          </button>
          {CATEGORY_ORDER.map((cat) => {
            const count = data.features.filter((f) => f.category === cat).length;
            if (count === 0) return null;
            return (
              <button
                key={cat}
                type="button"
                className={`parity__chip${categoryFilter === cat ? " parity__chip--active" : ""}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {CATEGORY_LABEL[cat]} ({count})
              </button>
            );
          })}
        </div>
        <div className="parity__filter-group">
          <span className="parity__filter-label">Show</span>
          <button
            type="button"
            className={`parity__chip${statusFilter === "all" ? " parity__chip--active" : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            All features
          </button>
          <button
            type="button"
            className={`parity__chip${statusFilter === "issues" ? " parity__chip--active" : ""}`}
            onClick={() => setStatusFilter("issues")}
          >
            Issues only
          </button>
        </div>
      </div>

      {data.hostsSeen.length > 0 ? (
        <div className="parity__hosts">
          <span className="parity__hosts-label">Hosts seen</span>
          {data.hostsSeen.map((h) => (
            <span key={`${h.os}-${h.hostId}`} className="parity__host-chip">
              <span className={`parity__host-os parity__host-os--${h.os}`}>{osLabel(h.os)}</span>
              <span className="parity__host-name">{h.hostLabel}</span>
              <span className="parity__host-time">{timeAgo(h.lastCheckedAt)}</span>
            </span>
          ))}
        </div>
      ) : null}

      <div className="parity__matrix">
        <div className="parity__matrix-head">
          <div className="parity__matrix-feature-col">Feature</div>
          {OS_ORDER.map((os) => (
            <div key={os.id} className="parity__matrix-os-col">
              {os.label}
            </div>
          ))}
          <div className="parity__matrix-meta-col">Severity</div>
        </div>
        {groups.length === 0 ? (
          <p className="parity__empty-body parity__empty-body--inline">
            No features match the current filters.
          </p>
        ) : (
          groups.map((g) => (
            <section key={g.category} className="parity__cat">
              <h3 className="parity__cat-title">{CATEGORY_LABEL[g.category]}</h3>
              <ul className="parity__cat-list">
                {g.items.map((f) => (
                  <MatrixRow
                    key={f.id}
                    feature={f}
                    selected={selectedId === f.id}
                    onSelect={() => setSelectedId((cur) => (cur === f.id ? null : f.id))}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </div>

      {selected ? (
        <DetailPanel
          feature={selected}
          canAttest={canAttest}
          canRecheck={canRun}
          onClose={() => setSelectedId(null)}
          onRecheck={async () => {
            if (!client) return;
            setRunBusy(true);
            setRunError(null);
            try {
              await client.runPlatformParity({ featureIds: [selected.id] });
              await slice.refresh();
            } catch (err) {
              setRunError(friendlyError(err));
            } finally {
              setRunBusy(false);
            }
          }}
          onAttest={async (os, status, evidence) => {
            if (!client) return;
            await client.attestPlatformParity({
              featureId: selected.id,
              os,
              status,
              evidence,
            });
            await slice.refresh();
          }}
        />
      ) : null}
    </div>
  );
}

interface MatrixRowProps {
  feature: PlatformParityFeature;
  selected: boolean;
  onSelect: () => void;
}

// Implemented as a real <button> rather than role=button+tabIndex so keyboard
// focus and screen-reader semantics come from the native element. Cells inside
// are visual-only; the parent button absorbs click + keyboard activation.
function MatrixRow({ feature, selected, onSelect }: MatrixRowProps) {
  return (
    <li className={`parity__row-wrap${selected ? " parity__row-wrap--selected" : ""}`}>
      <button
        type="button"
        className="parity__row"
        onClick={onSelect}
        aria-expanded={selected}
        aria-label={`${feature.label} — ${feature.severity}`}
      >
        <div className="parity__row-feature">
          <span className="parity__row-label">{feature.label}</span>
          <span className="parity__row-desc">{feature.description}</span>
        </div>
        {OS_ORDER.map((os) => (
          <div key={os.id} className="parity__row-cell">
            <CellBadge result={feature.results[os.id]} />
          </div>
        ))}
        <div className="parity__row-meta">
          <span
            className={`parity__sev parity__sev--${feature.severity}`}
            title={
              feature.severity === "blocking" ? "Blocking — must work on every OS" : "Recommended"
            }
          >
            {feature.severity === "blocking" ? "Blocking" : "Recommended"}
          </span>
        </div>
      </button>
    </li>
  );
}

function CellBadge({ result }: { result: PlatformParityResult | null }) {
  if (!result) {
    return (
      <span
        className="parity__cell parity__cell--muted"
        title="No verdict yet — run a probe or attest manually"
      >
        <span className="parity__cell-glyph">?</span>
        <span className="parity__cell-label">Unknown</span>
      </span>
    );
  }
  const tone = STATUS_TONE[result.status];
  return (
    <span
      className={`parity__cell parity__cell--${tone}`}
      title={`${STATUS_LABEL[result.status]} · ${result.evidence} · ${absoluteTime(result.lastCheckedAt)}`}
    >
      <span className="parity__cell-glyph">{STATUS_GLYPH[result.status]}</span>
      <span className="parity__cell-label">{STATUS_LABEL[result.status]}</span>
      <span className="parity__cell-time">{timeAgo(result.lastCheckedAt)}</span>
    </span>
  );
}

interface DetailPanelProps {
  feature: PlatformParityFeature;
  canAttest: boolean;
  canRecheck: boolean;
  onClose: () => void;
  onRecheck: () => void | Promise<void>;
  onAttest: (
    os: PlatformOs,
    status: PlatformParityStatus,
    evidence: string,
  ) => void | Promise<void>;
}

function DetailPanel({
  feature,
  canAttest,
  canRecheck,
  onClose,
  onRecheck,
  onAttest,
}: DetailPanelProps) {
  return (
    <aside className="parity__detail" role="dialog" aria-label={feature.label}>
      <header className="parity__detail-head">
        <div className="parity__detail-titles">
          <h3 className="parity__detail-title">{feature.label}</h3>
          <span className="parity__detail-id">{feature.id}</span>
          <span
            className={`parity__sev parity__sev--${feature.severity}`}
            style={{ marginLeft: 8 }}
          >
            {feature.severity === "blocking" ? "Blocking" : "Recommended"}
          </span>
        </div>
        <button type="button" className="parity__detail-close" onClick={onClose}>
          Close
        </button>
      </header>
      <p className="parity__detail-desc">{feature.description}</p>
      <p className="parity__detail-scope">
        Scope:{" "}
        {feature.expectedFor === "all" ? "Linux + macOS + Windows" : osLabel(feature.expectedFor)}
        {" · "}
        Verification:{" "}
        {feature.verificationKind === "auto" ? "automated probe on the host" : "manual attestation"}
      </p>

      <div className="parity__detail-grid">
        {OS_ORDER.map((os) => (
          <CellDetail
            key={os.id}
            osId={os.id}
            osLabel={os.label}
            feature={feature}
            canAttest={canAttest}
            onAttest={onAttest}
          />
        ))}
      </div>

      {canRecheck && feature.verificationKind === "auto" ? (
        <div className="parity__detail-actions">
          <button
            type="button"
            className="parity__btn parity__btn--primary"
            onClick={() => onRecheck()}
          >
            Re-run auto-probe on this host
          </button>
          <span className="parity__detail-actions-hint">
            Records a verdict for the OS column matching the host running SigmaShake.
          </span>
        </div>
      ) : null}
    </aside>
  );
}

interface CellDetailProps {
  osId: PlatformOs;
  osLabel: string;
  feature: PlatformParityFeature;
  canAttest: boolean;
  onAttest: (
    os: PlatformOs,
    status: PlatformParityStatus,
    evidence: string,
  ) => void | Promise<void>;
}

function CellDetail({ osId, osLabel, feature, canAttest, onAttest }: CellDetailProps) {
  const result = feature.results[osId];
  const isNa = result?.status === "not-applicable";
  const [editing, setEditing] = useState(false);
  const [draftStatus, setDraftStatus] = useState<PlatformParityStatus>(
    result?.status === "not-applicable" ? "pass" : (result?.status ?? "pass"),
  );
  const [draftEvidence, setDraftEvidence] = useState(result?.evidence ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const recipe = feature.verification[osId];

  const submit = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await onAttest(osId, draftStatus, draftEvidence.trim() || "Manually attested.");
      setEditing(false);
    } catch (err) {
      setSaveError(friendlyError(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <article className={`parity__detail-col parity__detail-col--${osId}`}>
      <header className="parity__detail-col-head">
        <h4 className="parity__detail-col-title">{osLabel}</h4>
        {result ? (
          <span className={`parity__cell parity__cell--${STATUS_TONE[result.status]}`}>
            <span className="parity__cell-glyph">{STATUS_GLYPH[result.status]}</span>
            <span className="parity__cell-label">{STATUS_LABEL[result.status]}</span>
          </span>
        ) : (
          <span className="parity__cell parity__cell--muted">
            <span className="parity__cell-glyph">?</span>
            <span className="parity__cell-label">Unknown</span>
          </span>
        )}
      </header>

      {isNa ? (
        <p className="parity__detail-na">{result?.evidence}</p>
      ) : (
        <>
          <dl className="parity__detail-meta">
            <div className="parity__detail-meta-row">
              <dt>Last checked</dt>
              <dd>
                {result ? (
                  <>
                    <span title={absoluteTime(result.lastCheckedAt)}>
                      {timeAgo(result.lastCheckedAt)}
                    </span>
                    <span className="parity__detail-meta-abs">
                      {absoluteTime(result.lastCheckedAt)}
                    </span>
                  </>
                ) : (
                  "Never"
                )}
              </dd>
            </div>
            <div className="parity__detail-meta-row">
              <dt>Attestation</dt>
              <dd>{result ? result.attestation : "—"}</dd>
            </div>
            <div className="parity__detail-meta-row">
              <dt>Probe duration</dt>
              <dd>{result?.durationMs != null ? `${result.durationMs} ms` : "—"}</dd>
            </div>
            <div className="parity__detail-meta-row">
              <dt>Recorded by</dt>
              <dd>{result ? `${result.hostLabel} (${result.hostId})` : "—"}</dd>
            </div>
            <div className="parity__detail-meta-row">
              <dt>Evidence</dt>
              <dd>{result?.evidence ?? "No evidence recorded yet."}</dd>
            </div>
            {result?.error ? (
              <div className="parity__detail-meta-row parity__detail-meta-row--error">
                <dt>Error</dt>
                <dd>{result.error}</dd>
              </div>
            ) : null}
          </dl>
          <details className="parity__detail-recipe">
            <summary>How to verify on {osLabel}</summary>
            <p>{recipe || "No verification recipe recorded for this OS."}</p>
          </details>
          {canAttest ? (
            <div className="parity__detail-attest">
              {!editing ? (
                <button
                  type="button"
                  className="parity__btn parity__btn--ghost"
                  onClick={() => setEditing(true)}
                >
                  Record manual verdict
                </button>
              ) : (
                <div className="parity__attest-form">
                  <label className="parity__attest-label">
                    Status
                    <select
                      value={draftStatus}
                      onChange={(e) => setDraftStatus(e.target.value as PlatformParityStatus)}
                      className="parity__attest-select"
                    >
                      <option value="pass">Pass — works on this OS</option>
                      <option value="partial">Partial — works with caveats</option>
                      <option value="fail">Fail — broken on this OS</option>
                      <option value="skipped">Skipped — waived for now</option>
                      <option value="unknown">Unknown — clear verdict</option>
                    </select>
                  </label>
                  <label className="parity__attest-label">
                    Evidence
                    <textarea
                      value={draftEvidence}
                      onChange={(e) => setDraftEvidence(e.target.value)}
                      rows={3}
                      maxLength={800}
                      placeholder="What you observed when verifying on this OS"
                      className="parity__attest-textarea"
                    />
                  </label>
                  {saveError ? (
                    <p className="parity__error parity__error--inline">{saveError}</p>
                  ) : null}
                  <div className="parity__attest-actions">
                    <button
                      type="button"
                      className="parity__btn parity__btn--primary"
                      onClick={() => void submit()}
                      disabled={saving}
                    >
                      {saving ? "Saving…" : "Save attestation"}
                    </button>
                    <button
                      type="button"
                      className="parity__btn parity__btn--ghost"
                      onClick={() => setEditing(false)}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </>
      )}
    </article>
  );
}

function ScoreRing({ score }: { score: number }) {
  const clamped = Math.max(0, Math.min(100, score));
  const tone: Tone = clamped >= 80 ? "ok" : clamped >= 50 ? "warn" : clamped >= 25 ? "warn" : "err";
  const radius = 28;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference * (1 - clamped / 100);
  return (
    <div className={`parity__ring parity__ring--${tone}`}>
      <svg
        width="72"
        height="72"
        viewBox="0 0 72 72"
        role="img"
        aria-label={`Parity score ${clamped} of 100`}
      >
        <circle
          cx="36"
          cy="36"
          r={radius}
          stroke="currentColor"
          strokeWidth="6"
          opacity="0.18"
          fill="none"
        />
        <circle
          cx="36"
          cy="36"
          r={radius}
          stroke="currentColor"
          strokeWidth="6"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 36 36)"
        />
      </svg>
      <span className="parity__ring-label">{clamped}</span>
    </div>
  );
}

interface CategoryGroup {
  category: PlatformParityCategory;
  items: PlatformParityFeature[];
}

function groupByCategory(features: PlatformParityFeature[]): CategoryGroup[] {
  const map = new Map<PlatformParityCategory, PlatformParityFeature[]>();
  for (const f of features) {
    const arr = map.get(f.category) ?? [];
    arr.push(f);
    map.set(f.category, arr);
  }
  const out: CategoryGroup[] = [];
  for (const category of CATEGORY_ORDER) {
    const items = map.get(category);
    if (items && items.length > 0) {
      const sorted = [...items].sort((a, b) => rowRank(a) - rowRank(b));
      out.push({ category, items: sorted });
    }
  }
  return out;
}

function rowRank(f: PlatformParityFeature): number {
  const cells = [f.results.linux, f.results.darwin, f.results.win32];
  const worst = cells.reduce<PlatformParityStatus>((acc, c) => {
    const status = c?.status ?? "unknown";
    if (status === "fail") return "fail";
    if (status === "partial" && acc !== "fail") return "partial";
    if (status === "unknown" && acc !== "fail" && acc !== "partial") return "unknown";
    return acc;
  }, "pass");
  const statusRank: Record<PlatformParityStatus, number> = {
    fail: 0,
    partial: 1,
    unknown: 2,
    skipped: 3,
    pass: 4,
    "not-applicable": 5,
  };
  return statusRank[worst] * 2 + (f.severity === "blocking" ? 0 : 1);
}
