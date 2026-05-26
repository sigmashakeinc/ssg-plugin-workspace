// Single-pane overview: every project's health, distribution status, fleet
// posture, and "things that need attention" on one screen. The whole landing
// is designed to fit in a single viewport — header + KPI strip stay pinned,
// tabbed body (Attention / All projects / Drift) scrolls internally so the
// page itself never grows. A persistent search + pagination keep the
// All-projects strip from sprawling vertically.
//
// Data sources, all read in parallel on mount:
//   - ProjectCard[] (already in the parent)
//   - getHealth(allSlugs) → per-project git/deploy/build/test sentinels
//   - getDistribution() → cross-channel release status. Local/electrobun only.
//   - getFleetStatus() → reachability + enrollment (cheap public probe)
//
// Anything missing fails open: a stat that can't load shows "n/a", the rest
// of the page still renders. Never block the whole overview on one fetch.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type {
  DistributionData,
  FleetStatus,
  HealthSummary,
  ProjectCard,
  ProjectType,
  TestStatus,
} from "../api/types";
import { buildTestMatrix, TEST_CATALOG } from "../lib/test-catalog";
import { withTimeout } from "../lib/with-timeout";
import { useWorkspaceCache } from "../lib/workspace-cache";
import { AttentionDetailPanel, type AttentionFocus } from "./AttentionDetailPanel";
import "../styles/overview-progress.css";

// ── Per-source load progress ─────────────────────────────────────────────

type SourceState = "queued" | "loading" | "done" | "error" | "timeout";

interface SourceProgress {
  name: string;
  state: SourceState;
  startedAt: number | null;
  elapsedMs: number | null;
  /** Short human message shown on error/timeout. */
  msg: string | null;
  /** For health-scan: how many projects have resolved so far. */
  resolved?: number;
  total?: number;
}

// ─────────────────────────────────────────────────────────────────────────────

interface Props {
  client: WorkspaceApiClient | null;
  projects: ProjectCard[];
  onSelectProject: (slug: string) => void;
  onGoToDistribution: () => void;
  onGoToMap: () => void;
  onGoToFleet: () => void;
}

const STALE_BUILD_MS = 7 * 24 * 3600 * 1000;
const PAGE_SIZE = 20;

type Tab = "attention" | "all" | "drift";

export function OverviewView({
  client,
  projects,
  onSelectProject,
  onGoToDistribution,
  onGoToMap,
  onGoToFleet,
}: Props) {
  // Hydrate the heavy data slices from the shared cache so this view paints
  // instantly when re-entered from another tab. The local `load()` still
  // owns its own refresh cycle for health (which is per-slug and isn't in
  // the global cache); the cache just primes the cross-cutting state.
  const cache = useWorkspaceCache();
  const [health, setHealth] = useState<Record<string, HealthSummary>>({});
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [distribution, setDistribution] = useState<DistributionData | null>(
    cache.distribution.data,
  );
  const [distributionError, setDistributionError] = useState<string | null>(
    cache.distribution.error,
  );
  const [fleet, setFleet] = useState<FleetStatus | null>(cache.fleet.data);
  const [refreshing, setRefreshing] = useState(false);
  const [lastLoadedAt, setLastLoadedAt] = useState<number | null>(
    cache.distribution.lastFetchedAt ?? cache.fleet.lastFetchedAt,
  );

  // Per-source progress rows shown while load() is in flight.
  const [sources, setSources] = useState<SourceProgress[]>([]);
  // Tick every 250 ms while loading to update elapsed time display.
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [tick, setTick] = useState(0);

  const [tab, setTab] = useState<Tab>("attention");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);

  const slugs = useMemo(() => projects.map((p) => p.slug), [projects]);
  const _slugsKey = slugs.join(",");
  const canLocal = !!client?.hasLocalCapabilities;

  const load = useCallback(
    async (initial: boolean) => {
      if (!client) return;
      if (initial) setHealthLoading(true);
      else setRefreshing(true);

      // Build the initial source list for this run.
      const initialSources: SourceProgress[] = [];
      if (canLocal && slugs.length > 0) {
        initialSources.push({
          name: "Health scan",
          state: "queued",
          startedAt: null,
          elapsedMs: null,
          msg: null,
          resolved: 0,
          total: slugs.length,
        });
      }
      if (canLocal) {
        initialSources.push({
          name: "Distribution",
          state: "queued",
          startedAt: null,
          elapsedMs: null,
          msg: null,
        });
      }
      initialSources.push({
        name: "Fleet probe",
        state: "queued",
        startedAt: null,
        elapsedMs: null,
        msg: null,
      });
      setSources(initialSources);

      // Start the elapsed-time ticker.
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = setInterval(() => setTick((n) => n + 1), 250);

      const update = (name: string, patch: Partial<SourceProgress>) => {
        setSources((prev) => prev.map((s) => (s.name === name ? { ...s, ...patch } : s)));
      };

      const promises: Promise<unknown>[] = [];

      if (canLocal && slugs.length > 0) {
        const start = Date.now();
        update("Health scan", { state: "loading", startedAt: start });
        // 45s ceiling — health scan parallelizes 2-3 git spawns × N projects.
        // A cold scan on a slow disk with 40+ projects can stretch past the
        // default 15s when git status on a large tree is slow.
        promises.push(
          withTimeout(client.getHealth(slugs), "Health scan", 45_000)
            .then((res) => {
              setHealth(res);
              setHealthError(null);
              update("Health scan", {
                state: "done",
                elapsedMs: Date.now() - start,
                resolved: slugs.length,
              });
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              const isTimeout = msg.includes("took longer than");
              setHealthError(msg);
              update("Health scan", {
                state: isTimeout ? "timeout" : "error",
                elapsedMs: Date.now() - start,
                msg: isTimeout ? "timed out" : msg.slice(0, 80),
              });
            }),
        );
      }

      if (canLocal) {
        const start = Date.now();
        update("Distribution", { state: "loading", startedAt: start });
        promises.push(
          withTimeout(client.getDistribution(), "Distribution scan")
            .then((d) => {
              setDistribution(d);
              setDistributionError(null);
              update("Distribution", {
                state: "done",
                elapsedMs: Date.now() - start,
              });
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              const isTimeout = msg.includes("took longer than");
              setDistributionError(msg);
              update("Distribution", {
                state: isTimeout ? "timeout" : "error",
                elapsedMs: Date.now() - start,
                msg: isTimeout ? "timed out" : msg.slice(0, 80),
              });
            }),
        );
      }

      {
        const start = Date.now();
        update("Fleet probe", { state: "loading", startedAt: start });
        promises.push(
          withTimeout(client.getFleetStatus(), "Fleet status check")
            .then((f) => {
              setFleet(f);
              update("Fleet probe", {
                state: "done",
                elapsedMs: Date.now() - start,
              });
            })
            .catch((err: unknown) => {
              const msg = err instanceof Error ? err.message : String(err);
              const isTimeout = msg.includes("took longer than");
              update("Fleet probe", {
                state: isTimeout ? "timeout" : "error",
                elapsedMs: Date.now() - start,
                msg: isTimeout ? "timed out" : msg.slice(0, 80),
              });
              // Fleet probe failing is benign — render reachability=unknown
            }),
        );
      }

      await Promise.allSettled(promises);

      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
      setHealthLoading(false);
      setRefreshing(false);
      setLastLoadedAt(Date.now());
    },
    [client, canLocal, slugs],
  );

  useEffect(() => {
    load(true);
  }, [load]);

  // Clean up the elapsed-time ticker on unmount.
  useEffect(() => {
    return () => {
      if (tickRef.current) {
        clearInterval(tickRef.current);
        tickRef.current = null;
      }
    };
  }, []);

  // Group projects by type for the breakdown card
  const byType = useMemo(() => {
    const out: Record<ProjectType, ProjectCard[]> = {
      "cf-worker": [],
      bun: [],
      elixir: [],
      native: [],
      unknown: [],
    };
    for (const p of projects) out[p.type].push(p);
    return out;
  }, [projects]);

  // Compute attention buckets
  const attention = useMemo(() => {
    const deployBlocked: ProjectCard[] = [];
    const ahead: Array<{ card: ProjectCard; n: number }> = [];
    const staleBuild: Array<{ card: ProjectCard; days: number }> = [];
    const failingTests: ProjectCard[] = [];
    const neverTested: ProjectCard[] = [];
    const now = Date.now();
    for (const p of projects) {
      const h = health[p.slug];
      if (!h) continue;
      if (h.deployGateOk === false) deployBlocked.push(p);
      if (h.gitAheadOriginMain > 0) ahead.push({ card: p, n: h.gitAheadOriginMain });
      if (
        h.lastBuildAt != null &&
        now - h.lastBuildAt > STALE_BUILD_MS &&
        p.scripts.includes("build")
      ) {
        staleBuild.push({ card: p, days: Math.floor((now - h.lastBuildAt) / 86_400_000) });
      }
      if (h.lastTestOk === false) failingTests.push(p);
      // "never tested" only flagged for projects that DO declare a test script
      if (h.lastTestAt == null && p.scripts.some((s) => s.startsWith("test"))) {
        neverTested.push(p);
      }
    }
    return { deployBlocked, ahead, staleBuild, failingTests, neverTested };
  }, [projects, health]);

  const attentionTotal =
    attention.deployBlocked.length +
    attention.ahead.length +
    attention.staleBuild.length +
    attention.failingTests.length;

  const distWarnCount = distribution?.warnings?.length ?? 0;
  const fleetReach = fleet?.reachability ?? "unknown";

  // Apply search to all-projects list, then paginate. Reset page when query changes.
  const filteredProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return projects;
    return projects.filter(
      (p) =>
        p.slug.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.type.toLowerCase().includes(q),
    );
  }, [projects, query]);
  const pageCount = Math.max(1, Math.ceil(filteredProjects.length / PAGE_SIZE));
  const clampedPage = Math.min(page, pageCount - 1);
  const pagedProjects = useMemo(
    () => filteredProjects.slice(clampedPage * PAGE_SIZE, clampedPage * PAGE_SIZE + PAGE_SIZE),
    [filteredProjects, clampedPage],
  );
  useEffect(() => {
    setPage(0);
  }, []);

  const anyLoading = healthLoading || refreshing;

  return (
    <div className="overview">
      {/* ── Sticky header: title, refresh, KPI strip, tabs ───────────── */}
      <div className="overview__sticky">
        <header className="overview__header">
          <div className="overview__header-text">
            <h2 className="overview__title">Overview</h2>
            <p className="overview__subtitle">
              {projects.length} project{projects.length === 1 ? "" : "s"}.{" "}
              {canLocal
                ? "Live health from the SigmaShake daemon."
                : "Browse-only — install SigmaShake Desktop for live health."}
            </p>
          </div>
          <div className="overview__header-actions">
            {lastLoadedAt && (
              <span className="overview__stamp" title={new Date(lastLoadedAt).toLocaleString()}>
                {formatRelative(lastLoadedAt)}
              </span>
            )}
            <button
              type="button"
              className="pill-btn"
              onClick={() => load(false)}
              disabled={refreshing}
            >
              {refreshing ? "Refreshing…" : "Refresh"}
            </button>
          </div>
        </header>

        {/* Per-source progress rows — collapses to zero height when idle. */}
        <LoadProgress sources={sources} active={anyLoading} now={tick} />

        {/* Inline KPI strip — single row, no wrap on desktop. */}
        <div className="overview__kpis" role="list">
          <Kpi
            tone={attentionTotal === 0 ? "ok" : attentionTotal > 5 ? "fail" : "warn"}
            label="Attention"
            value={String(attentionTotal)}
            hint={
              attentionTotal === 0
                ? "Nothing urgent"
                : `${attention.deployBlocked.length} blocked · ${attention.failingTests.length} failing · ${attention.staleBuild.length} stale`
            }
            onClick={() => setTab("attention")}
          />
          <Kpi
            tone="info"
            label="Projects"
            value={String(projects.length)}
            hint={Object.entries(byType)
              .filter(([, v]) => v.length > 0)
              .map(([k, v]) => `${v.length} ${shortType(k as ProjectType)}`)
              .join(" · ")}
            onClick={() => setTab("all")}
          />
          <Kpi
            tone={distribution?.inSync ? "ok" : distWarnCount > 0 ? "warn" : "unknown"}
            label="Distribution"
            value={
              distribution
                ? distribution.inSync
                  ? "In sync"
                  : `${distWarnCount} drift${distWarnCount === 1 ? "" : "s"}`
                : distributionError
                  ? "n/a"
                  : "—"
            }
            hint={distribution?.summary ?? distributionError ?? "Loading…"}
            onClick={
              distWarnCount > 0 ? () => setTab("drift") : canLocal ? onGoToDistribution : undefined
            }
          />
          <Kpi
            tone={fleetReach === "ok" ? "ok" : fleetReach === "unreachable" ? "fail" : "unknown"}
            label="Fleet"
            value={fleetReach === "ok" ? "Reachable" : fleetReach === "unreachable" ? "Down" : "—"}
            hint={
              fleet?.enrollment?.enrolled
                ? `Agent ${fleet.enrollment.agentId} enrolled${fleet.enrollment.jwtExpired ? " · JWT expired" : ""}`
                : "Not enrolled"
            }
            onClick={onGoToFleet}
          />
        </div>

        {/* Tab strip */}
        <nav className="overview__tabs">
          <OverviewTab
            id="attention"
            active={tab}
            onSelect={setTab}
            label="Attention"
            count={attentionTotal}
            tone={attentionTotal === 0 ? "ok" : "fail"}
          />
          <OverviewTab
            id="all"
            active={tab}
            onSelect={setTab}
            label="All projects"
            count={projects.length}
          />
          <OverviewTab
            id="drift"
            active={tab}
            onSelect={setTab}
            label="Release drift"
            count={distWarnCount}
            tone={distWarnCount === 0 ? "ok" : "warn"}
          />
          <div className="overview__tabs-spacer" />
          <button
            type="button"
            className="pill-btn"
            onClick={onGoToMap}
            title="Visual service map of every project"
          >
            Service map →
          </button>
        </nav>
      </div>

      {/* ── Tab body — owns its own scroll ───────────────────────────── */}
      <div className="overview__body" role="tabpanel">
        {tab === "attention" && (
          <AttentionTab
            client={client}
            canLocal={canLocal}
            healthLoading={healthLoading}
            healthError={healthError}
            attentionTotal={attentionTotal}
            attention={attention}
            health={health}
            onSelectProject={onSelectProject}
          />
        )}
        {tab === "all" && (
          <AllProjectsTab
            allCount={projects.length}
            query={query}
            onQueryChange={setQuery}
            pagedProjects={pagedProjects}
            filteredCount={filteredProjects.length}
            page={clampedPage}
            pageCount={pageCount}
            onPage={setPage}
            health={health}
            onSelectProject={onSelectProject}
          />
        )}
        {tab === "drift" && (
          <DriftTab
            distribution={distribution}
            distributionError={distributionError}
            onGoToDistribution={onGoToDistribution}
            canLocal={canLocal}
          />
        )}
      </div>
    </div>
  );
}

// ── Per-source load-progress list ────────────────────────────────────────

interface LoadProgressProps {
  sources: SourceProgress[];
  active: boolean;
  /** Incrementing counter from the 250 ms ticker — triggers re-render. */
  now: number;
}

function LoadProgress({ sources, active }: LoadProgressProps) {
  if (sources.length === 0) return null;
  const wallNow = Date.now();
  return (
    <div className={`ovp${active ? " ovp--active" : ""}`} aria-live="polite">
      {sources.map((s) => {
        const elapsed =
          s.elapsedMs != null ? s.elapsedMs : s.startedAt != null ? wallNow - s.startedAt : null;
        return (
          <div key={s.name} className="ovp__row">
            <span className={`ovp__dot ovp__dot--${s.state}`} aria-hidden="true" />
            <span className="ovp__name">
              {s.name}
              {s.state === "loading" &&
              typeof s.resolved === "number" &&
              typeof s.total === "number" &&
              s.total > 0 ? (
                <span className="ovp__fraction">
                  {" "}
                  {s.resolved}/{s.total}
                </span>
              ) : null}
            </span>
            <span className={`ovp__state ovp__state--${s.state}`}>{s.state}</span>
            {elapsed != null && <span className="ovp__elapsed">{fmtMs(elapsed)}</span>}
            {s.msg && <span className="ovp__msg">{s.msg}</span>}
          </div>
        );
      })}
    </div>
  );
}

function fmtMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── KPI strip ────────────────────────────────────────────────────────────

interface KpiProps {
  tone: "ok" | "warn" | "fail" | "info" | "unknown";
  label: string;
  value: string;
  hint: string;
  onClick?: () => void;
}

function Kpi({ tone, label, value, hint, onClick }: KpiProps) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      className={`overview__kpi overview__kpi--${tone}${onClick ? " overview__kpi--clickable" : ""}`}
      onClick={onClick}
      role="listitem"
    >
      <span className="overview__kpi-label">{label}</span>
      <span className="overview__kpi-value">{value}</span>
      <span className="overview__kpi-hint" title={hint}>
        {hint}
      </span>
    </Tag>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────

interface OverviewTabProps {
  id: Tab;
  active: Tab;
  onSelect: (t: Tab) => void;
  label: string;
  count?: number;
  tone?: "ok" | "warn" | "fail";
}

function OverviewTab({ id, active, onSelect, label, count, tone }: OverviewTabProps) {
  const isActive = id === active;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      className={`overview__tab${isActive ? " overview__tab--active" : ""}`}
      onClick={() => onSelect(id)}
    >
      <span>{label}</span>
      {typeof count === "number" && (
        <span className={`overview__tab-badge${tone ? ` overview__tab-badge--${tone}` : ""}`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Attention tab ───────────────────────────────────────────────────────

interface AttentionTabProps {
  client: WorkspaceApiClient | null;
  canLocal: boolean;
  healthLoading: boolean;
  healthError: string | null;
  attentionTotal: number;
  attention: {
    deployBlocked: ProjectCard[];
    ahead: Array<{ card: ProjectCard; n: number }>;
    staleBuild: Array<{ card: ProjectCard; days: number }>;
    failingTests: ProjectCard[];
    neverTested: ProjectCard[];
  };
  health: Record<string, HealthSummary>;
  onSelectProject: (slug: string) => void;
}

function AttentionTab({
  client,
  canLocal,
  healthLoading,
  healthError,
  attentionTotal,
  attention,
  health,
  onSelectProject,
}: AttentionTabProps) {
  // Identity of the row currently expanded into a detail panel. `null` when
  // nothing is expanded. We encode bucket so two rows for the same slug in
  // different buckets don't fight over the same panel — clicking "tests
  // failing: foo" should open the test focus, while "deploy blocked: foo"
  // should open the deploy focus.
  const [expanded, setExpanded] = useState<{
    slug: string;
    focus: AttentionFocus;
  } | null>(null);

  if (!canLocal) {
    return (
      <div className="overview__empty">
        Browse-only — install SigmaShake Desktop to see what needs attention.
      </div>
    );
  }
  if (healthLoading && attentionTotal === 0) {
    return <div className="overview__empty">Scanning all projects…</div>;
  }
  if (healthError) {
    return (
      <div className="overview__empty overview__empty--err">Health check error: {healthError}</div>
    );
  }
  if (attentionTotal === 0) {
    return (
      <div className="overview__empty">
        <span aria-hidden="true">✓</span> Every project is clean, up-to-date, and tests pass.
      </div>
    );
  }
  const toggle = (slug: string, focus: AttentionFocus) => {
    setExpanded((prev) =>
      prev && prev.slug === slug && prev.focus === focus ? null : { slug, focus },
    );
  };
  return (
    <div className="overview__attention-grid">
      <AttentionGroup
        label="Deploy blocked"
        tone="fail"
        blurb="Cloudflare Worker projects whose deploy gate refused — uncommitted/unpushed work, or strict-mode drift vs. origin/main."
        focus="deploy"
        items={attention.deployBlocked.map((p) => ({
          slug: p.slug,
          detail: "uncommitted/unpushed work",
        }))}
        client={client}
        expanded={expanded}
        onToggle={toggle}
        onOpen={onSelectProject}
      />
      <AttentionGroup
        label="Tests failing"
        tone="fail"
        blurb="Most recent test run exited non-zero (the project wrote 'fail' to .last-test-result)."
        focus="tests"
        items={attention.failingTests.map((p) => ({
          slug: p.slug,
          detail: relTime(health[p.slug]?.lastTestAt),
        }))}
        client={client}
        expanded={expanded}
        onToggle={toggle}
        onOpen={onSelectProject}
      />
      <AttentionGroup
        label="Unpushed commits"
        tone="warn"
        blurb="Branch is ahead of origin/main — push to bring origin in line."
        focus="git"
        items={attention.ahead.map(({ card, n }) => ({
          slug: card.slug,
          detail: `+${n} commit${n === 1 ? "" : "s"}`,
        }))}
        client={client}
        expanded={expanded}
        onToggle={toggle}
        onOpen={onSelectProject}
      />
      <AttentionGroup
        label="Stale builds"
        tone="warn"
        blurb="Last build artifact older than 7 days, but a build script exists."
        focus="build"
        items={attention.staleBuild.map(({ card, days }) => ({
          slug: card.slug,
          detail: `${days}d old`,
        }))}
        client={client}
        expanded={expanded}
        onToggle={toggle}
        onOpen={onSelectProject}
      />
      <AttentionGroup
        label="Never tested"
        tone="info"
        blurb="A test script exists but no .last-test-result sentinel has been written yet."
        focus="tests"
        items={attention.neverTested.slice(0, 12).map((p) => ({
          slug: p.slug,
          detail: "no test run yet",
        }))}
        truncatedFrom={attention.neverTested.length}
        client={client}
        expanded={expanded}
        onToggle={toggle}
        onOpen={onSelectProject}
      />
    </div>
  );
}

interface AttentionGroupProps {
  label: string;
  tone: "fail" | "warn" | "info";
  blurb: string;
  /** Which detail block to open by default when a row is expanded. */
  focus: AttentionFocus;
  items: Array<{ slug: string; detail: string }>;
  truncatedFrom?: number;
  client: WorkspaceApiClient | null;
  expanded: { slug: string; focus: AttentionFocus } | null;
  onToggle: (slug: string, focus: AttentionFocus) => void;
  onOpen: (slug: string) => void;
}

function AttentionGroup({
  label,
  tone,
  blurb,
  focus,
  items,
  truncatedFrom,
  client,
  expanded,
  onToggle,
  onOpen,
}: AttentionGroupProps) {
  if (items.length === 0) return null;
  const hidden =
    truncatedFrom != null && truncatedFrom > items.length ? truncatedFrom - items.length : 0;
  return (
    <article className={`overview__attention overview__attention--${tone}`}>
      <header className="overview__attention-head">
        <span className="overview__attention-dot" aria-hidden="true" />
        <span className="overview__attention-label">{label}</span>
        <span className="overview__attention-count">{truncatedFrom ?? items.length}</span>
      </header>
      <p className="overview__attention-blurb">{blurb}</p>
      <ul className="overview__attention-list">
        {items.map((it) => {
          const isOpen = expanded != null && expanded.slug === it.slug && expanded.focus === focus;
          return (
            <li key={it.slug} className="overview__attention-item">
              <div className="overview__attention-row-wrap">
                <button
                  type="button"
                  className={`overview__attention-row${isOpen ? " overview__attention-row--open" : ""}`}
                  onClick={() => onToggle(it.slug, focus)}
                  aria-expanded={isOpen}
                >
                  <span className="overview__attention-caret" aria-hidden="true">
                    {isOpen ? "▾" : "▸"}
                  </span>
                  <span className="overview__attention-slug">{it.slug}</span>
                  <span className="overview__attention-detail">{it.detail}</span>
                </button>
                <button
                  type="button"
                  className="overview__attention-open"
                  onClick={() => onOpen(it.slug)}
                  title={`Open ${it.slug} detail`}
                >
                  Open →
                </button>
              </div>
              {isOpen && client && (
                <AttentionDetailPanel client={client} slug={it.slug} focus={focus} />
              )}
            </li>
          );
        })}
        {hidden > 0 && <li className="overview__attention-more">+{hidden} more</li>}
      </ul>
    </article>
  );
}

// ── All projects tab — search + paginate + health strip ─────────────────

interface AllProjectsTabProps {
  allCount: number;
  query: string;
  onQueryChange: (q: string) => void;
  pagedProjects: ProjectCard[];
  filteredCount: number;
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  health: Record<string, HealthSummary>;
  onSelectProject: (slug: string) => void;
}

function AllProjectsTab({
  allCount,
  query,
  onQueryChange,
  pagedProjects,
  filteredCount,
  page,
  pageCount,
  onPage,
  health,
  onSelectProject,
}: AllProjectsTabProps) {
  const first = filteredCount === 0 ? 0 : page * PAGE_SIZE + 1;
  const last = Math.min(filteredCount, (page + 1) * PAGE_SIZE);
  return (
    <>
      <div className="overview__toolbar">
        <input
          type="search"
          className="overview__search"
          placeholder="Filter projects (slug, description, type)…"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          spellCheck={false}
        />
        <HealthLegend />
        <span className="overview__pager-summary">
          {filteredCount === allCount
            ? `${first}–${last} of ${allCount}`
            : `${first}–${last} of ${filteredCount} (filtered from ${allCount})`}
        </span>
        <div className="overview__pager">
          <button
            type="button"
            className="overview__pager-btn"
            disabled={page <= 0}
            onClick={() => onPage(Math.max(0, page - 1))}
            aria-label="Previous page"
          >
            ←
          </button>
          <span className="overview__pager-page">
            {page + 1} / {pageCount}
          </span>
          <button
            type="button"
            className="overview__pager-btn"
            disabled={page >= pageCount - 1}
            onClick={() => onPage(Math.min(pageCount - 1, page + 1))}
            aria-label="Next page"
          >
            →
          </button>
        </div>
      </div>
      {filteredCount === 0 ? (
        <div className="overview__empty">
          No projects match <code>{query}</code>.
        </div>
      ) : (
        <div className="overview__strip-list">
          {pagedProjects.map((p) => (
            <HealthStripRow
              key={p.slug}
              card={p}
              health={health[p.slug] ?? null}
              onSelect={onSelectProject}
            />
          ))}
        </div>
      )}
    </>
  );
}

// ── Drift tab ───────────────────────────────────────────────────────────

interface DriftTabProps {
  distribution: DistributionData | null;
  distributionError: string | null;
  onGoToDistribution: () => void;
  canLocal: boolean;
}

function DriftTab({
  distribution,
  distributionError,
  onGoToDistribution,
  canLocal,
}: DriftTabProps) {
  if (!canLocal) {
    return (
      <div className="overview__empty">
        Browse-only — release drift requires SigmaShake Desktop.
      </div>
    );
  }
  if (distributionError) {
    return (
      <div className="overview__empty overview__empty--err">
        Distribution check failed: {distributionError}
      </div>
    );
  }
  if (!distribution) {
    return <div className="overview__empty">Loading distribution status…</div>;
  }
  const warnings = distribution.warnings ?? [];
  if (warnings.length === 0) {
    return (
      <div className="overview__empty">
        <span aria-hidden="true">✓</span> All distribution channels are in sync.
        {distribution.summary ? ` ${distribution.summary}` : ""}
      </div>
    );
  }
  return (
    <>
      <div className="overview__toolbar overview__toolbar--simple">
        <span className="overview__pager-summary">
          {warnings.length} warning{warnings.length === 1 ? "" : "s"}
        </span>
        <button type="button" className="pill-btn" onClick={onGoToDistribution}>
          Open Distribution →
        </button>
      </div>
      <ul className="overview__warn-list">
        {warnings.map((w, i) => (
          <li key={i} className="overview__warn-item">
            <span className="overview__warn-dot" aria-hidden="true" />
            <span>{w}</span>
          </li>
        ))}
      </ul>
    </>
  );
}

// ── GitHub-style per-project health strip ──────────────────────────────
//
// One row per project. Each row has:
//   - left: type chip + slug (click → open project detail)
//   - right: a strip of 23 colored cells. First 4 are core health
//     (git / deploy / build / last test). Remaining 19 are the canonical
//     test-kind taxonomy (TEST_CATALOG → 4 categories × 19 kinds total).
//     A cell's color encodes status; hover shows the dimension + value.

type CellTone = "ok" | "warn" | "fail" | "stale" | "unknown" | "missing";

interface CellInput {
  tone: CellTone;
  title: string;
  /** Optional group label for visually clustering related cells. */
  group?: string;
}

interface HealthStripRowProps {
  card: ProjectCard;
  health: HealthSummary | null;
  onSelect: (slug: string) => void;
}

function HealthStripRow({ card, health, onSelect }: HealthStripRowProps) {
  const cells = useMemo<CellInput[]>(() => buildCells(card, health), [card, health]);
  const summary = useMemo(() => summarizeCells(cells), [cells]);
  return (
    <article className="overview__strip-row">
      <button
        type="button"
        className="overview__strip-head"
        onClick={() => onSelect(card.slug)}
        title={card.description || card.slug}
      >
        <span className={`overview__strip-chip overview__strip-chip--${card.type}`}>
          {typeShort(card.type)}
        </span>
        <span className="overview__strip-slug">{card.slug}</span>
      </button>
      <div className="overview__strip-cells" role="list">
        {cells.map((c, i) => (
          <span
            key={i}
            role="listitem"
            className={`overview__strip-cell overview__strip-cell--${c.tone}`}
            title={c.title}
          />
        ))}
      </div>
      <span className="overview__strip-summary" title={summary.title}>
        <span className="overview__strip-summary-num">{summary.ok}</span>
        <span className="overview__strip-summary-sep">/</span>
        <span className="overview__strip-summary-denom">{summary.total}</span>
      </span>
    </article>
  );
}

function HealthLegend() {
  const items: Array<{ tone: CellTone; label: string }> = [
    { tone: "ok", label: "Pass" },
    { tone: "warn", label: "Warn" },
    { tone: "fail", label: "Fail" },
    { tone: "stale", label: "Stale" },
    { tone: "unknown", label: "No data" },
    { tone: "missing", label: "Off" },
  ];
  return (
    <div className="overview__strip-legend" role="list">
      {items.map((it) => (
        <span key={it.tone} role="listitem" className="overview__strip-legend-item">
          <span
            className={`overview__strip-cell overview__strip-cell--${it.tone}`}
            aria-hidden="true"
          />
          <span>{it.label}</span>
        </span>
      ))}
    </div>
  );
}

function buildCells(card: ProjectCard, health: HealthSummary | null): CellInput[] {
  const cells: CellInput[] = [];
  const now = Date.now();

  // Core health (4)
  if (!health) {
    for (const label of ["Git", "Deploy gate", "Build", "Last test"]) {
      cells.push({ tone: "unknown", title: `${label}: no daemon data`, group: "core" });
    }
  } else {
    cells.push({
      tone: health.gitDirty
        ? "warn"
        : health.gitAheadOriginMain > 0 || health.gitBehindOriginMain > 0
          ? "warn"
          : "ok",
      title: `Git: ${
        health.gitDirty
          ? "dirty working tree"
          : health.gitAheadOriginMain > 0
            ? `+${health.gitAheadOriginMain} ahead of origin/main`
            : health.gitBehindOriginMain > 0
              ? `-${health.gitBehindOriginMain} behind origin/main`
              : "clean"
      }`,
      group: "core",
    });
    cells.push({
      tone: health.deployGateOk === null ? "unknown" : health.deployGateOk ? "ok" : "fail",
      title: `Deploy gate: ${
        health.deployGateOk === null
          ? "no deploy target"
          : health.deployGateOk
            ? "cleared"
            : "blocked (unpushed changes)"
      }`,
      group: "core",
    });
    const buildAge = health.lastBuildAt == null ? null : now - health.lastBuildAt;
    cells.push({
      tone:
        buildAge == null
          ? card.scripts.includes("build")
            ? "missing"
            : "unknown"
          : buildAge < 24 * 3600 * 1000
            ? "ok"
            : buildAge < 7 * 24 * 3600 * 1000
              ? "warn"
              : "stale",
      title: `Build: ${
        buildAge == null
          ? card.scripts.includes("build")
            ? "no record yet"
            : "no build script"
          : `${formatAge(buildAge)} ago`
      }`,
      group: "core",
    });
    const testAge = health.lastTestAt == null ? null : now - health.lastTestAt;
    cells.push({
      tone:
        testAge == null
          ? card.scripts.some((s) => s.startsWith("test"))
            ? "missing"
            : "unknown"
          : health.lastTestOk === false
            ? "fail"
            : testAge < 7 * 24 * 3600 * 1000
              ? "ok"
              : "stale",
      title: `Last test: ${
        testAge == null
          ? card.scripts.some((s) => s.startsWith("test"))
            ? "never run"
            : "no test script"
          : (health.lastTestOk === false ? "failing · " : "passing · ") +
            formatAge(testAge) +
            " ago"
      }`,
      group: "core",
    });
  }

  // Test kinds (19) — derived from the canonical TEST_CATALOG via the
  // shared buildTestMatrix(). The matrix returns 4 status values which we
  // map onto the same tone palette as the core cells.
  const matrix = buildTestMatrix(card, health);
  for (const cat of matrix.categories) {
    for (const result of cat.results) {
      const def = TEST_CATALOG.find((c) => c.id === cat.category)!.kinds.find(
        (k) => k.id === result.kindId,
      );
      cells.push({
        tone: testStatusToTone(result.status),
        title: `${def?.label ?? result.kindId} (${cat.category}): ${statusBlurb(result.status)}${
          result.script ? ` · ${result.script}` : ""
        }`,
        group: cat.category,
      });
    }
  }
  return cells;
}

function testStatusToTone(s: TestStatus): CellTone {
  if (s === "passing") return "ok";
  if (s === "failing") return "fail";
  if (s === "stale") return "stale";
  if (s === "missing") return "missing";
  return "unknown";
}

function statusBlurb(s: TestStatus): string {
  switch (s) {
    case "passing":
      return "passing";
    case "failing":
      return "failing";
    case "stale":
      return "stale";
    case "missing":
      return "not configured";
    default:
      return "configured · no run data";
  }
}

function summarizeCells(cells: CellInput[]): {
  ok: number;
  total: number;
  title: string;
} {
  let ok = 0;
  let total = 0;
  let problems = 0;
  for (const c of cells) {
    if (c.tone === "missing") continue;
    total += 1;
    if (c.tone === "ok") ok += 1;
    else if (c.tone === "fail" || c.tone === "warn" || c.tone === "stale") {
      problems += 1;
    }
  }
  return {
    ok,
    total,
    title:
      total === 0
        ? "No tracked checks for this project."
        : `${ok}/${total} green · ${problems} need${problems === 1 ? "s" : ""} attention`,
  };
}

function typeShort(t: ProjectType): string {
  if (t === "cf-worker") return "CF";
  if (t === "bun") return "JS";
  if (t === "elixir") return "EX";
  if (t === "native") return "NX";
  return "·";
}

function shortType(t: ProjectType): string {
  if (t === "cf-worker") return "worker";
  if (t === "bun") return "bun";
  if (t === "elixir") return "elixir";
  if (t === "native") return "native";
  return "other";
}

function formatAge(ms: number): string {
  if (ms < 60_000) return "<1m";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function formatRelative(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 0) return "just now";
  const sec = Math.floor(delta / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function relTime(ts: number | null | undefined): string {
  if (ts == null) return "never";
  return formatRelative(ts);
}
