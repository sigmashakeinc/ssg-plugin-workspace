// Monorepo-wide "Distribution" view. Read-only, cross-channel release status
// for the SigmaShake distribution, consolidated into a single pane with two
// modes:
//
//   - Inventory  the matrix — every shippable artifact (SSG CLI, SSG Desktop,
//                the VS Code extension, plugins, rule sets) as one row per
//                (product, version, OS): the channels + region reach it ships
//                through, file size, build time, when it was last built +
//                distributed, and how many versions exist.
//   - Pipeline   the flow graph — monorepo source → per-platform build →
//                publish channels → the public download page, with drift
//                flagged in amber.
//
// Auto-refreshes so version drift and fresh builds surface without a reload.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type {
  DistArtifactRow,
  DistArtifactStatus,
  DistChannelRef,
  DistCliChannel,
  DistEdge,
  DistInventory,
  DistNode,
  DistNodeState,
  DistProductRollup,
  DistributionData,
  DistributionDrift,
} from "../api/types";
import { friendlyError } from "../lib/errors";
import { withTimeout } from "../lib/with-timeout";
import { useWorkspaceCache } from "../lib/workspace-cache";
import { ProgressStrip } from "./ProgressStrip";

interface Props {
  client: WorkspaceApiClient | null;
  root: string;
}

type ViewMode = "inventory" | "pipeline";

const REFRESH_MS = 15_000;
const COLUMN_LABELS = ["Source", "Build", "Publish", "Live"];

export function DistributionView({ client, root }: Props) {
  // Hydrate from the shared workspace cache so re-entering this tab shows the
  // most recent successful fetch instantly instead of replaying the spinner.
  const cache = useWorkspaceCache();
  const cacheSeed = cache.distribution.data;
  const [data, setData] = useState<DistributionData | null>(cacheSeed);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!cacheSeed);
  const [refreshing, setRefreshing] = useState(false);
  const [mode, setMode] = useState<ViewMode>("inventory");
  const [selected, setSelected] = useState<string | null>(null);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState<{
    tone: "ok" | "err";
    text: string;
  } | null>(null);
  // Live cross-channel lane drift (R2 + GitHub release). Loaded alongside the
  // orchestrator-state distribution data so the operator sees published-CDN
  // skew immediately, not just local build state. Independent failure: a
  // drift fetch failure doesn't blank the inventory.
  const [drift, setDrift] = useState<DistributionDrift | null>(null);

  const load = useCallback(
    async (loadMode: "initial" | "refresh") => {
      if (!client) return;
      if (loadMode === "initial") setLoading(true);
      else setRefreshing(true);
      try {
        const next = await withTimeout(
          client.getDistribution(root || undefined),
          "Distribution scan",
        );
        setData(next);
        setError(null);
        setLastLoadedAt(Date.now());
      } catch (err) {
        setError(friendlyError(err));
        // Keep cached data on refresh failure so the operator doesn't lose
        // context when the daemon is just temporarily slow.
        if (loadMode === "initial" && !cacheSeed) setData(null);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
      // Drift probe — fire-and-forget alongside the main load so it never
      // delays the main render. A failure here just means the banner stays
      // empty; the inventory + pipeline tabs still work.
      client
        .getDistributionDrift()
        .then(setDrift)
        .catch(() => {});
    },
    [client, root, cacheSeed],
  );

  useEffect(() => {
    load("initial");
  }, [load]);

  useEffect(() => {
    const id = setInterval(() => load("refresh"), REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const runSync = useCallback(async () => {
    if (!client) return;
    setConfirmOpen(false);
    setSyncing(true);
    setSyncMsg(null);
    try {
      const r = await client.triggerSync();
      setSyncMsg({
        tone: "ok",
        text: r.version
          ? `Release ${r.version} started — builds are running on all three platforms.`
          : "Release started — builds are running on all three platforms.",
      });
      load("refresh");
    } catch (err) {
      setSyncMsg({ tone: "err", text: friendlyError(err) });
    } finally {
      setSyncing(false);
    }
  }, [client, load]);

  if (loading && !data) {
    return (
      <div className="panel">
        <h3 className="panel__h3">Distribution</h3>
        <ProgressStrip loading label="Checking your release channels…" />
        <div className="dist__skeleton-grid">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="dist__skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="panel">
        <div className="state-card state-card--error">
          <h2 className="state-card__title">Couldn&apos;t load distribution status</h2>
          <p className="state-card__body">{error}</p>
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            onClick={() => load("initial")}
            disabled={loading}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const selectedNode = data.nodes.find((n) => n.id === selected) ?? null;
  const unreachable: string[] = [];
  if (!data.sources.orchestrator) unreachable.push("the release orchestrator");
  if (!data.sources.npm) unreachable.push("the npm registry");
  if (!data.sources.downloads) unreachable.push("the download CDN");

  return (
    <div className="panel dist">
      <ProgressStrip loading={refreshing} label={refreshing ? "Refreshing channels" : ""} />
      <header className="dist__head">
        <div className="dist__head-text">
          <h3 className="panel__h3">Distribution</h3>
          <p className="dist__summary">
            <span className={`dist__verdict dist__verdict--${data.inSync ? "ok" : "warn"}`}>
              {data.inSync ? "In sync" : "Needs attention"}
            </span>
            {data.summary}
          </p>
        </div>
        <div className="dist__head-actions">
          {lastLoadedAt && (
            <span className="dist__stamp">
              {refreshing ? "Refreshing…" : <RelativeStamp at={lastLoadedAt} />}
            </span>
          )}
          <button
            type="button"
            className="pill-btn"
            onClick={() => load("refresh")}
            disabled={refreshing}
          >
            Refresh
          </button>
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            onClick={() => setConfirmOpen(true)}
            disabled={syncing || data.releaseInProgress || !data.sources.orchestrator}
            title={
              !data.sources.orchestrator
                ? "The release orchestrator isn't running on this machine"
                : data.releaseInProgress
                  ? "A release is already in progress"
                  : "Build and release SSG Desktop on all three platforms"
            }
          >
            {data.releaseInProgress
              ? "Release in progress…"
              : syncing
                ? "Starting…"
                : "Build & release all platforms"}
          </button>
        </div>
      </header>

      {drift && <DriftBanner drift={drift} />}

      <div className="dist__modes" role="tablist" aria-label="Distribution view mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "inventory"}
          className={`detail__tab${mode === "inventory" ? " detail__tab--active" : ""}`}
          onClick={() => setMode("inventory")}
        >
          Inventory
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "pipeline"}
          className={`detail__tab${mode === "pipeline" ? " detail__tab--active" : ""}`}
          onClick={() => setMode("pipeline")}
        >
          Pipeline
        </button>
      </div>

      {error && data && <div className="error">{error}</div>}

      {syncMsg && (
        <div className={syncMsg.tone === "ok" ? "dist__sync-ok" : "error"}>{syncMsg.text}</div>
      )}

      {data.warnings.length > 0 && (
        <ul className="dist__warnings">
          {data.warnings.map((w, i) => (
            <li key={i} className="dist__warning">
              {w}
            </li>
          ))}
        </ul>
      )}

      {mode === "inventory" ? (
        data.inventory ? (
          <DistInventoryPanel inventory={data.inventory} />
        ) : (
          <p className="dist__hint">
            The inventory matrix needs a newer SigmaShake than the one running on this machine —
            restart SigmaShake to pick it up. The Pipeline view still works.
          </p>
        )
      ) : (
        <>
          {unreachable.length > 0 && (
            <p className="dist__unreachable">
              Couldn&apos;t reach {unreachable.join(", ")} — the affected steps show as
              &ldquo;unknown&rdquo; below.
            </p>
          )}
          <DistGraph
            nodes={data.nodes}
            edges={data.edges}
            selected={selected}
            onSelect={setSelected}
          />
          {selectedNode ? (
            <div className={`dist__detail dist__detail--${selectedNode.state}`}>
              <div className="dist__detail-head">
                <span className="dist__detail-title">{selectedNode.label}</span>
                {selectedNode.sublabel && (
                  <span className="dist__detail-version">{selectedNode.sublabel}</span>
                )}
              </div>
              <p className="dist__detail-body">{selectedNode.detail}</p>
              {selectedNode.url && (
                <a
                  className="dist__detail-link"
                  href={selectedNode.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {selectedNode.url.replace(/^https?:\/\//, "")}
                </a>
              )}
            </div>
          ) : (
            <p className="dist__hint">
              Each box is one step in getting a release out the door. Click any box for details.
              Green means it matches the monorepo; amber means it has drifted out of sync.
            </p>
          )}
        </>
      )}

      {confirmOpen && (
        <div className="modal-backdrop" onClick={() => setConfirmOpen(false)}>
          <div
            className="modal"
            role="dialog"
            aria-labelledby="dist-sync-title"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="modal__head">
              <h2 className="modal__title" id="dist-sync-title">
                Build &amp; release all platforms?
              </h2>
              <p className="modal__subtitle">
                This starts a fresh build of SSG Desktop on Linux, macOS, and Windows through the
                release orchestrator, then publishes the result. It uses the version committed on{" "}
                <code>main</code> and can take several minutes. Only do this when the monorepo is in
                a releasable state.
              </p>
            </header>
            <footer className="modal__footer">
              <button type="button" className="pill-btn" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              <button type="button" className="pill-btn pill-btn--primary" onClick={runSync}>
                Start the release
              </button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Cross-channel parity banner (R2 + GitHub release skew) ──────────────────

function DriftBanner({ drift }: { drift: DistributionDrift }) {
  return (
    <>
      <DesktopDriftBanner drift={drift} />
      <CliChannelBanner
        channels={drift.cliChannels}
        reference={drift.cliReferenceVersion}
        driftedCount={drift.cliDriftedCount}
        note={drift.cliNote}
      />
    </>
  );
}

// Desktop lane parity (R2 update.json + GitHub release assets).
function DesktopDriftBanner({ drift }: { drift: DistributionDrift }) {
  if (drift.driftedCount === 0) {
    return (
      <div className="dist__drift dist__drift--ok" data-testid="dist-drift-ok">
        <span className="dist__drift-pill dist__drift-pill--ok">All desktop lanes in sync</span>
        <span className="dist__drift-summary">
          Every lane (linux-x64, win-x64, macos-x64, macos-arm64) is at{" "}
          <strong>{drift.r2HighestVersion ?? "—"}</strong> on R2 and present on GitHub release{" "}
          <strong>{drift.ghLatestTag ?? "—"}</strong>.
        </span>
      </div>
    );
  }
  return (
    <div className="dist__drift dist__drift--warn" data-testid="dist-drift-warn">
      <div className="dist__drift-head">
        <span className="dist__drift-pill dist__drift-pill--warn">
          {drift.driftedCount} desktop lane{drift.driftedCount === 1 ? "" : "s"} need follow-up
        </span>
        <span className="dist__drift-summary">
          Highest R2 version <strong>{drift.r2HighestVersion ?? "—"}</strong>; latest GitHub release{" "}
          <strong>{drift.ghLatestTag ?? "—"}</strong>. Cross-host catch-up required:
        </span>
      </div>
      <ul className="dist__drift-list">
        {drift.lanes
          .filter((l) => l.verdict !== "ok")
          .map((lane) => (
            <li key={lane.lane} className={`dist__drift-row dist__drift-row--${lane.verdict}`}>
              <span className="dist__drift-lane">{lane.lane}</span>
              <span className={`dist__drift-verdict dist__drift-verdict--${lane.verdict}`}>
                {lane.verdict.toUpperCase()}
              </span>
              <span className="dist__drift-note">{lane.note}</span>
              {lane.catchUpCommand && (
                <code className="dist__drift-cmd">{lane.catchUpCommand}</code>
              )}
            </li>
          ))}
      </ul>
    </div>
  );
}

// SSG CLI publish-channel parity (npm reference vs PyPI / crates.io / GitHub).
function CliChannelBanner({
  channels,
  reference,
  driftedCount,
  note,
}: {
  channels: DistCliChannel[];
  reference: string | null;
  driftedCount: number;
  note: string;
}) {
  if (channels.length === 0) return null;
  const drifted = driftedCount > 0;
  return (
    <div
      className={`dist__drift dist__cli-drift dist__drift--${drifted ? "warn" : "ok"}`}
      data-testid={drifted ? "dist-cli-drift-warn" : "dist-cli-drift-ok"}
    >
      <div className="dist__drift-head">
        <span className={`dist__drift-pill dist__drift-pill--${drifted ? "warn" : "ok"}`}>
          {drifted
            ? `${driftedCount} CLI channel${driftedCount === 1 ? "" : "s"} behind npm`
            : "CLI channels in sync"}
        </span>
        <span className="dist__drift-summary">
          Reference <strong>{reference ?? "—"}</strong> (npm). {note}
        </span>
      </div>
      <ul className="dist__drift-list">
        {channels.map((ch) => (
          <li key={ch.channel} className={`dist__drift-row dist__drift-row--${ch.verdict}`}>
            <span className="dist__drift-lane">{ch.label}</span>
            <span className={`dist__drift-verdict dist__drift-verdict--${ch.verdict}`}>
              {ch.verdict.toUpperCase()}
            </span>
            <span className="dist__drift-note">{ch.note}</span>
            {ch.url && (
              <a className="dist__drift-cmd" href={ch.url} target="_blank" rel="noreferrer">
                {ch.version ?? "—"}
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── Inventory matrix ─────────────────────────────────────────────────────────

function DistInventoryPanel({ inventory }: { inventory: DistInventory }) {
  return (
    <div className="dist-inv">
      <div className="dist-inv__rollups">
        {inventory.products.map((p) => (
          <RollupCard key={p.product} rollup={p} />
        ))}
      </div>
      <MatrixTable inventory={inventory} />
      {inventory.channels.length > 0 && <ChannelLegend channels={inventory.channels} />}
      {inventory.notes.length > 0 && (
        <ul className="dist-inv__notes">
          {inventory.notes.map((n, i) => (
            <li key={i} className="dist-inv__note">
              {n}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RollupCard({ rollup }: { rollup: DistProductRollup }) {
  return (
    <div className="dist-inv__rollup">
      <span className="dist-inv__rollup-label">{rollup.label}</span>
      <span className="dist-inv__rollup-version">{rollup.currentVersion ?? "—"}</span>
      <div className="dist-inv__rollup-stats">
        <RollupStat label="Platforms" value={String(rollup.platformCount)} />
        <RollupStat label="Channels" value={String(rollup.channelCount)} />
        <RollupStat
          label="Versions"
          value={rollup.versionCount !== null ? String(rollup.versionCount) : "—"}
        />
        <RollupStat label="Total size" value={fmtBytes(rollup.totalSizeBytes)} />
        <RollupStat label="Build time" value={fmtDuration(rollup.lastBuildDurationMs)} />
        <RollupStat label="Distributed" value={fmtWhen(rollup.lastDistributedAt)} />
      </div>
    </div>
  );
}

function RollupStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="dist-inv__stat">
      <span className="dist-inv__stat-value">{value}</span>
      <span className="dist-inv__stat-label">{label}</span>
    </div>
  );
}

function MatrixTable({ inventory }: { inventory: DistInventory }) {
  // Group rows by product, preserving the products[] order; drop products
  // that produced no rows (e.g. an unreachable hub).
  const groups = inventory.products
    .map((product) => ({
      product,
      rows: inventory.rows.filter((r) => r.product === product.product),
    }))
    .filter((g) => g.rows.length > 0);

  return (
    <div className="dist-inv__table-wrap">
      <table className="dist-inv__table">
        <thead>
          <tr>
            <th>Artifact</th>
            <th>Version</th>
            <th>Channels &amp; reach</th>
            <th>Size</th>
            <th>Build time</th>
            <th>Last built</th>
            <th>Distributed</th>
            <th>Status</th>
          </tr>
        </thead>
        {groups.map((g) => (
          <tbody key={g.product.product}>
            <tr className="dist-inv__group">
              <td colSpan={8}>
                <span className="dist-inv__group-name">{g.product.label}</span>
                {g.product.currentVersion && (
                  <span className="dist-inv__group-version">v{g.product.currentVersion}</span>
                )}
                <span className="dist-inv__group-meta">
                  {g.rows.length} {g.rows.length === 1 ? "artifact" : "artifacts"}
                </span>
              </td>
            </tr>
            {g.rows.map((row) => (
              <MatrixRow key={row.id} row={row} />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  );
}

function MatrixRow({ row }: { row: DistArtifactRow }) {
  return (
    <tr className="dist-inv__row" title={row.note}>
      <td>
        <div className="dist-inv__os">
          <span className="dist-inv__os-name">{row.name ?? row.osLabel}</span>
          <span className="dist-inv__os-host">
            {row.name ? row.osLabel : (row.buildHost ?? "")}
          </span>
        </div>
      </td>
      <td>
        <span className="dist-inv__mono">{row.version}</span>
      </td>
      <td>
        <div className="dist-inv__channels">
          {row.channels.map((c) => (
            <span key={c.id} className="dist-inv__chip" title={c.reach}>
              {c.label}
            </span>
          ))}
        </div>
        {row.regions.length > 0 && <div className="dist-inv__reach">{row.regions.join(" · ")}</div>}
      </td>
      <td>
        <span className="dist-inv__mono">{fmtBytes(row.fileSizeBytes)}</span>
      </td>
      <td>
        <span className="dist-inv__mono">{fmtDuration(row.buildDurationMs)}</span>
      </td>
      <td className="dist-inv__when">{fmtWhen(row.builtAt)}</td>
      <td className="dist-inv__when">{fmtWhen(row.distributedAt)}</td>
      <td>
        <StatusPill status={row.status} />
      </td>
    </tr>
  );
}

const STATUS_LABEL: Record<DistArtifactStatus, string> = {
  live: "Live",
  building: "Building",
  stale: "Stale",
  pending: "Pending",
  missing: "Not here",
  unknown: "Unknown",
};

function StatusPill({ status }: { status: DistArtifactStatus }) {
  return (
    <span className={`dist-inv__status dist-inv__status--${status}`}>{STATUS_LABEL[status]}</span>
  );
}

function ChannelLegend({ channels }: { channels: DistChannelRef[] }) {
  return (
    <div className="dist-inv__legend">
      <span className="dist-inv__legend-title">Channels &amp; region reach</span>
      <div className="dist-inv__legend-items">
        {channels.map((c) => (
          <div key={c.id} className="dist-inv__legend-item">
            <span className="dist-inv__chip">{c.label}</span>
            <span className="dist-inv__legend-reach">{c.reach}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── formatters ───────────────────────────────────────────────────────────────

function fmtBytes(n: number | null): string {
  if (n === null) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  const rounded = v < 10 ? v.toFixed(1) : String(Math.round(v));
  return `${rounded} ${units[i] ?? "B"}`;
}

function fmtDuration(ms: number | null): string {
  if (ms === null) return "—";
  if (ms < 1000) return `${ms} ms`;
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return sec ? `${min}m ${sec}s` : `${min}m`;
  const hr = Math.floor(min / 60);
  return `${hr}h ${min % 60}m`;
}

function fmtWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const diff = Date.now() - d.getTime();
  const day = 86_400_000;
  if (diff >= 0 && diff < day) {
    const hours = Math.floor(diff / 3_600_000);
    if (hours < 1) {
      const mins = Math.max(1, Math.floor(diff / 60_000));
      return `${mins}m ago`;
    }
    return `${hours}h ago`;
  }
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Pipeline graph ───────────────────────────────────────────────────────────

interface GraphProps {
  nodes: DistNode[];
  edges: DistEdge[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}

function DistGraph({ nodes, edges, selected, onSelect }: GraphProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [paths, setPaths] = useState<Array<{ d: string; state: DistNodeState }>>([]);

  const columns = [0, 1, 2, 3].map((col) => nodes.filter((n) => n.column === col));

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const base = wrap.getBoundingClientRect();
    const next: Array<{ d: string; state: DistNodeState }> = [];
    for (const edge of edges) {
      const from = nodeRefs.current.get(edge.from);
      const to = nodeRefs.current.get(edge.to);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const x1 = a.right - base.left;
      const y1 = a.top - base.top + a.height / 2;
      const x2 = b.left - base.left;
      const y2 = b.top - base.top + b.height / 2;
      const mx = (x1 + x2) / 2;
      next.push({
        d: `M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`,
        state: edge.state,
      });
    }
    setPaths(next);
  }, [edges]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  return (
    <div className="dist-graph" ref={wrapRef}>
      <svg className="dist-graph__edges" aria-hidden="true">
        {paths.map((p, i) => (
          <path key={i} d={p.d} className={`dist-edge dist-edge--${p.state}`} fill="none" />
        ))}
      </svg>
      <div className="dist-graph__cols">
        {columns.map((colNodes, col) => (
          <div className="dist-graph__col" key={col}>
            <span className="dist-graph__col-label">{COLUMN_LABELS[col] ?? ""}</span>
            {colNodes.map((n) => (
              <button
                key={n.id}
                type="button"
                ref={(el) => {
                  if (el) nodeRefs.current.set(n.id, el);
                  else nodeRefs.current.delete(n.id);
                }}
                className={
                  "dist-node dist-node--" +
                  n.state +
                  (selected === n.id ? " dist-node--selected" : "")
                }
                onClick={() => onSelect(selected === n.id ? null : n.id)}
              >
                <span className="dist-node__dot" aria-hidden="true" />
                <span className="dist-node__label">{n.label}</span>
                {n.sublabel && <span className="dist-node__sublabel">{n.sublabel}</span>}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function RelativeStamp({ at }: { at: number }) {
  const [, force] = useState(0);
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 5000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.floor((Date.now() - at) / 1000);
  if (secs < 5) return <>Updated just now</>;
  if (secs < 60) return <>Updated {secs}s ago</>;
  const mins = Math.floor(secs / 60);
  return <>Updated {mins}m ago</>;
}
