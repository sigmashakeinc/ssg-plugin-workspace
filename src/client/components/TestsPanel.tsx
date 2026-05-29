import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WorkspaceApiClient } from "../api/client";
import type {
  HealthSummary,
  ProjectCard,
  TestCaseResult,
  TestCategoryResult,
  TestHistoryEntry,
  TestMatrix,
  TestRunner,
  TestRunReport,
  TestStatus,
} from "../api/types";
import { friendlyError } from "../lib/errors";
import {
  buildTestMatrix,
  type KindHistoryMap,
  statusLabel,
  TEST_CATALOG,
} from "../lib/test-catalog";
import {
  buildStderrTail,
  formatDuration,
  formatRelativeShort,
  loadRunHistory,
  saveRunRecord,
  type TestRunRecord,
} from "../lib/test-run-history";
import "../styles/tests-panel.css";
import { TestTrendGrid } from "./TestTrendGrid";

/** Per-kind structured report keyed by `TestKindDef.id`. */
type ReportMap = Partial<Record<string, TestRunReport>>;

/** Per-kind recorded run history keyed by `TestKindDef.id`, oldest first. */
type TrendMap = Partial<Record<string, TestHistoryEntry[]>>;

interface Props {
  card: ProjectCard;
  client: WorkspaceApiClient;
}

interface RunState {
  /** Which kindId is actively running (only one at a time). */
  kindId: string;
  script: string;
  lines: string[];
  done: boolean;
  error: string | null;
  startedAt: number;
}

/** Progress of a "Run all tests" sweep across every configured suite. */
interface RunAllState {
  total: number;
  /** 1-based index of the suite currently running. */
  current: number;
  /** Human label of the suite currently running. */
  label: string;
}

export function TestsPanel({ card, client }: Props) {
  const [health, setHealth] = useState<HealthSummary | null>(null);
  const [healthError, setHealthError] = useState<string | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [runState, setRunState] = useState<RunState | null>(null);
  const [runAll, setRunAll] = useState<RunAllState | null>(null);
  const [kindHistory, setKindHistory] = useState<KindHistoryMap>({});
  const [reports, setReports] = useState<ReportMap>({});
  // Per-kind recorded run history (daemon `.test-history-<kind>.jsonl`) — the
  // data behind the GitHub-style trend grid. Distinct from `kindHistory`
  // above, which is this browser's localStorage record of Run-button clicks.
  const [trend, setTrend] = useState<TrendMap>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const cancelRef = useRef<(() => Promise<void>) | null>(null);
  // Cancellation token for an in-flight "Run all" sweep; `.cancelled` is flipped
  // by stopRun so the sequential loop bails before kicking off the next suite.
  const runAllRef = useRef<{ cancelled: boolean } | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  // Re-fetch the health sentinel whenever the project changes or we just
  // finished a run (so the matrix re-grades the unit kind in place).
  const refreshHealth = useCallback(async () => {
    setHealthLoading(true);
    setHealthError(null);
    try {
      const res = await client.getHealth([card.slug]);
      setHealth(res[card.slug] ?? null);
    } catch (err) {
      setHealthError(friendlyError(err));
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, [card.slug, client]);

  // Per-kind structured reports — counts, per-test results, durations. The
  // cloud runtime has no filesystem so getTestReport throws CapabilityError;
  // an older daemon 404s. Either way the panel degrades to the matrix-only
  // view rather than surfacing an error — the drill-down is additive.
  const refreshReports = useCallback(async () => {
    try {
      const bundle = await client.getTestReport(card.slug);
      setReports(bundle.reports ?? {});
      setTrend(bundle.history ?? {});
    } catch {
      setReports({});
      setTrend({});
    }
  }, [card.slug, client]);

  useEffect(() => {
    let cancelled = false;
    setHealth(null);
    setHealthError(null);
    setHealthLoading(true);
    (async () => {
      try {
        const res = await client.getHealth([card.slug]);
        if (!cancelled) setHealth(res[card.slug] ?? null);
      } catch (err) {
        if (!cancelled) setHealthError(friendlyError(err));
      } finally {
        if (!cancelled) setHealthLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card.slug, client]);

  // Load reports + history + reset the expanded set whenever the project changes.
  useEffect(() => {
    setReports({});
    setTrend({});
    setExpanded(new Set());
    refreshReports();
  }, [refreshReports]);

  // Load localStorage history whenever the project changes.
  useEffect(() => {
    const map: KindHistoryMap = {};
    for (const cat of TEST_CATALOG) {
      for (const kind of cat.kinds) {
        const history = loadRunHistory(card.slug, kind.id);
        if (history.length > 0) map[kind.id] = history[0];
      }
    }
    setKindHistory(map);
  }, [card.slug]);

  // Auto-scroll the run log.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, []);

  const matrix: TestMatrix = useMemo(
    () => buildTestMatrix(card, health, kindHistory),
    [card, health, kindHistory],
  );

  const toggleExpand = useCallback((kindId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(kindId)) next.delete(kindId);
      else next.add(kindId);
      return next;
    });
  }, []);

  const runKind = useCallback(
    async (kindId: string, script: string) => {
      if (cancelRef.current) {
        await cancelRef.current();
      }
      const startedAt = Date.now();
      setRunState({ kindId, script, lines: [], done: false, error: null, startedAt });
      let allLines: string[] = [];
      let exitCode = 0;
      try {
        const handle = await client.runScript(card.slug, script);
        cancelRef.current = handle.cancel;
        for await (const ev of handle.events) {
          if (ev.line) {
            allLines = [...allLines, ev.line];
            setRunState((cur) =>
              cur && cur.kindId === kindId ? { ...cur, lines: allLines } : cur,
            );
          }
          if (ev.done) {
            exitCode = ev.exitCode ?? 0;
            setRunState((cur) =>
              cur && cur.kindId === kindId
                ? {
                    ...cur,
                    done: true,
                    error: exitCode === 0 ? null : `Exited with code ${exitCode}`,
                  }
                : cur,
            );
            cancelRef.current = null;
            refreshHealth();
            // The daemon has just written `.last-test-report-<kind>.json`;
            // pull it in and auto-expand the kind so its fresh metrics show.
            refreshReports();
            setExpanded((prev) => new Set(prev).add(kindId));
            break;
          }
        }
      } catch (err) {
        exitCode = 1;
        setRunState((cur) =>
          cur && cur.kindId === kindId ? { ...cur, done: true, error: friendlyError(err) } : cur,
        );
        cancelRef.current = null;
      }
      // Persist run to localStorage regardless of outcome.
      const endedAt = Date.now();
      const record: TestRunRecord = {
        startedAt,
        endedAt,
        duration: endedAt - startedAt,
        exitCode,
        command: `bun run ${card.slug.replace(/^sigmashake-/, "")}:${script}`,
        stderrTail: buildStderrTail(allLines, exitCode),
      };
      const updated = saveRunRecord(card.slug, kindId, record);
      setKindHistory((prev) => ({ ...prev, [kindId]: updated[0] }));
    },
    [card.slug, client, refreshHealth, refreshReports],
  );

  // Every configured (runnable) suite across all categories, in catalog order,
  // deduped by script — the work list for "Run all tests".
  const runnableKinds = useMemo(() => {
    const seen = new Set<string>();
    const out: Array<{ kindId: string; script: string; label: string }> = [];
    for (const cat of matrix.categories) {
      const def = TEST_CATALOG.find((c) => c.id === cat.category);
      for (const r of cat.results) {
        if (!r.script || seen.has(r.script)) continue;
        seen.add(r.script);
        const label = def?.kinds.find((k) => k.id === r.kindId)?.label ?? r.kindId;
        out.push({ kindId: r.kindId, script: r.script, label });
      }
    }
    return out;
  }, [matrix]);

  const runAllTests = useCallback(async () => {
    if (runnableKinds.length === 0 || runAllRef.current) return;
    // PSU safety (see CLAUDE.md): this workstation hard-resets on concurrent
    // CPU+GPU power co-spikes, so suites MUST run strictly one-at-a-time. Do
    // NOT parallelize this loop — each `await runKind` fully completes (or is
    // cancelled) before the next suite starts.
    const token = { cancelled: false };
    runAllRef.current = token;
    try {
      for (let i = 0; i < runnableKinds.length; i++) {
        if (token.cancelled) break;
        const { kindId, script, label } = runnableKinds[i];
        setRunAll({ total: runnableKinds.length, current: i + 1, label });
        await runKind(kindId, script);
      }
    } finally {
      runAllRef.current = null;
      setRunAll(null);
    }
  }, [runnableKinds, runKind]);

  const stopRun = useCallback(async () => {
    // Halt the whole "Run all" sweep, not just the current suite.
    if (runAllRef.current) runAllRef.current.cancelled = true;
    if (cancelRef.current) {
      await cancelRef.current();
      cancelRef.current = null;
    }
  }, []);

  return (
    <div className="panel tests">
      <TestsHeader
        matrix={matrix}
        reports={reports}
        loading={healthLoading}
        runnableCount={runnableKinds.length}
        runAll={runAll}
        anyRunning={Boolean(runState && !runState.done)}
        onRunAll={runAllTests}
        onStopAll={stopRun}
      />

      {healthError && (
        <div className="tests__health-error">
          Couldn&apos;t reach the SigmaShake daemon for live status: {healthError}. The catalog
          below still reflects what&apos;s configured in this project.
        </div>
      )}

      {matrix.categories.map((cat) => (
        <TestCategorySection
          key={cat.category}
          result={cat}
          activeRun={runState}
          kindHistory={kindHistory}
          reports={reports}
          trend={trend}
          expanded={expanded}
          onToggleExpand={toggleExpand}
          onRun={runKind}
        />
      ))}

      {runState && (
        <section className="tests__run-log">
          <header className="tests__run-log-head">
            <span className="tests__run-log-title">
              {runState.done
                ? runState.error
                  ? `Finished with errors — ${runState.script}`
                  : `Finished — ${runState.script}`
                : `Running \`${runState.script}\`…`}
            </span>
            {!runState.done && (
              <button type="button" className="pill-btn pill-btn--danger" onClick={stopRun}>
                Stop
              </button>
            )}
          </header>
          <div className="tests__run-log-body" ref={logRef}>
            {runState.lines.length === 0 && !runState.done && (
              <div className="tests__run-log-empty">Starting…</div>
            )}
            {runState.lines.map((line, i) => (
              <div key={i} className="tests__run-log-line">
                {line}
              </div>
            ))}
            {runState.error && (
              <div className="tests__run-log-line tests__run-log-line--err">{runState.error}</div>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function TestsHeader({
  matrix,
  reports,
  loading,
  runnableCount,
  runAll,
  anyRunning,
  onRunAll,
  onStopAll,
}: {
  matrix: TestMatrix;
  reports: ReportMap;
  loading: boolean;
  runnableCount: number;
  runAll: RunAllState | null;
  anyRunning: boolean;
  onRunAll: () => void;
  onStopAll: () => void;
}) {
  const { totals } = matrix;
  const total = totals.passing + totals.failing + totals.stale + totals.missing + totals.unknown;
  const covered = total - totals.missing;
  const allPossible = totals.missing === 0;
  // Roll the recorded reports into a service-wide test tally. Skip `broad`
  // reports — those are the whole-suite numbers copied onto a sibling kind by
  // a `test`-script run, so counting them would multiply the real total.
  const recorded = useMemo(() => rollUpReports(reports), [reports]);
  return (
    <header className="tests__overview">
      <div className="tests__overview-row">
        <h3 className="panel__h3">Test coverage</h3>
        <div className="tests__overview-actions">
          {loading && <span className="tests__overview-loading">Loading…</span>}
          {runnableCount >= 1 &&
            (runAll ? (
              <div className="tests__runall-progress">
                <span className="tests__run-spinner" aria-hidden="true" />
                <span className="tests__runall-progress-text">
                  Running {runAll.label} — {runAll.current}/{runAll.total}
                </span>
                <button type="button" className="pill-btn pill-btn--danger" onClick={onStopAll}>
                  Stop
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="pill-btn pill-btn--primary"
                onClick={onRunAll}
                disabled={anyRunning}
                title={
                  runnableCount === 1
                    ? "Run the configured test suite for this service"
                    : `Run all ${runnableCount} configured test suites for this service, one after another`
                }
              >
                Run all tests
              </button>
            ))}
        </div>
      </div>
      <div className="tests__overview-grade">
        <span className="tests__overview-num">
          {covered}
          <span className="tests__overview-denom">
            {" / "}
            {total}
          </span>
        </span>
        <span className="tests__overview-label">test classes configured</span>
      </div>
      <p className="tests__overview-blurb">
        {allPossible
          ? "Every possible test class for this service is configured — you've covered the full taxonomy."
          : `${totals.missing} test class${totals.missing === 1 ? "" : "es"} not configured yet. Each missing row below shows the script name to add.`}
      </p>
      <div className="tests__overview-pills">
        <SummaryPill status="passing" count={totals.passing} />
        <SummaryPill status="failing" count={totals.failing} />
        <SummaryPill status="stale" count={totals.stale} />
        <SummaryPill status="unknown" count={totals.unknown} />
        <SummaryPill status="missing" count={totals.missing} />
      </div>
      {recorded.classes > 0 && (
        <div
          className={`tests__recorded${recorded.failed > 0 ? " tests__recorded--warn" : " tests__recorded--ok"}`}
        >
          <span className="tests__recorded-num">{recorded.total.toLocaleString()}</span>
          <span className="tests__recorded-text">
            {recorded.total === 1 ? "test" : "tests"} recorded across {recorded.classes}{" "}
            {recorded.classes === 1 ? "class" : "classes"} —{" "}
            <strong className="tests__recorded-pass">
              {recorded.passed.toLocaleString()} passed
            </strong>
            {recorded.failed > 0 && (
              <>
                {", "}
                <strong className="tests__recorded-fail">
                  {recorded.failed.toLocaleString()} failed
                </strong>
              </>
            )}
            {recorded.skipped > 0 && `, ${recorded.skipped.toLocaleString()} skipped`}. Expand any
            row below to drill into per-test results.
          </span>
        </div>
      )}
    </header>
  );
}

function SummaryPill({ status, count }: { status: TestStatus; count: number }) {
  return (
    <span
      className={`tests__summary-pill tests__summary-pill--${status}`}
      title={statusLabel(status)}
    >
      <span className="tests__summary-pill-dot" aria-hidden="true" />
      <span className="tests__summary-pill-count">{count}</span>
      <span className="tests__summary-pill-label">{statusLabel(status)}</span>
    </span>
  );
}

interface TestCategorySectionProps {
  result: TestCategoryResult;
  activeRun: RunState | null;
  kindHistory: KindHistoryMap;
  reports: ReportMap;
  trend: TrendMap;
  expanded: Set<string>;
  onToggleExpand: (kindId: string) => void;
  onRun: (kindId: string, script: string) => void;
}

function TestCategorySection({
  result,
  activeRun,
  kindHistory,
  reports,
  trend,
  expanded,
  onToggleExpand,
  onRun,
}: TestCategorySectionProps) {
  const def = TEST_CATALOG.find((c) => c.id === result.category);
  if (!def) return null;
  const kindResults = new Map(result.results.map((r) => [r.kindId, r]));
  return (
    <section className="tests__category">
      <header className="tests__category-head">
        <span className="tests__category-icon" aria-hidden="true">
          {def.icon}
        </span>
        <div className="tests__category-titles">
          <h4 className="tests__category-title">{def.label}</h4>
          <p className="tests__category-blurb">{def.description}</p>
        </div>
      </header>
      <div className="tests__kind-list">
        {def.kinds.map((kind) => {
          const r = kindResults.get(kind.id);
          if (!r) return null;
          const running = Boolean(activeRun && activeRun.kindId === kind.id && !activeRun.done);
          const lastRun = kindHistory[kind.id];
          const report = reports[kind.id];
          const kindTrend = trend[kind.id] ?? [];
          const isExpanded = expanded.has(kind.id);
          // A row drills down when there's a recorded report, recorded run
          // history, OR at least a runnable script (so the empty-state CTA
          // has something to do).
          const expandable = Boolean(report) || kindTrend.length > 0 || Boolean(r.script);
          const runDisabled = Boolean(activeRun && !activeRun.done && !running);
          return (
            <article
              key={kind.id}
              className={`tests__kind tests__kind--${r.status}${
                isExpanded ? " tests__kind--expanded" : ""
              }`}
            >
              <div className="tests__kind-main">
                <div className="tests__kind-row">
                  <div className="tests__kind-row-lead">
                    {expandable && (
                      <button
                        type="button"
                        className="tests__kind-toggle"
                        aria-expanded={isExpanded}
                        aria-label={`${isExpanded ? "Collapse" : "Expand"} ${kind.label} details`}
                        onClick={() => onToggleExpand(kind.id)}
                      >
                        <span
                          className={`tests__chev${isExpanded ? " tests__chev--open" : ""}`}
                          aria-hidden="true"
                        >
                          ▶
                        </span>
                      </button>
                    )}
                    <span className="tests__kind-label">{kind.label}</span>
                    {report && <KindMetricChip report={report} />}
                  </div>
                  <StatusPill status={r.status} />
                </div>
                <p className="tests__kind-description">{kind.description}</p>
                <p className="tests__kind-note">{r.note}</p>
                {r.lastRunAt && (
                  <p className="tests__kind-meta">
                    Last run {formatRelative(r.lastRunAt)} &middot;{" "}
                    {new Date(r.lastRunAt).toLocaleString()}
                  </p>
                )}
                {kindTrend.length > 0 && <TestTrendGrid entries={kindTrend} variant="inline" />}
              </div>
              <div className="tests__kind-actions">
                {r.script ? (
                  <>
                    <button
                      type="button"
                      className={`pill-btn${r.status === "passing" ? "" : " pill-btn--primary"}`}
                      disabled={runDisabled || running}
                      onClick={() => onRun(kind.id, r.script!)}
                      title={`Run \`bun run ${r.script}\` for this project`}
                    >
                      {running ? (
                        <>
                          <span className="tests__run-spinner" aria-hidden="true" />
                          Running…
                        </>
                      ) : (
                        `Run ${r.script}`
                      )}
                    </button>
                    <KindRunStatus running={running} lastRun={lastRun} />
                  </>
                ) : (
                  <span
                    className="tests__kind-script-hint"
                    title={`Add a "${kind.scriptCandidates[0]}" script to package.json to enable this test class.`}
                  >
                    Add <code>{kind.scriptCandidates[0]}</code>
                  </span>
                )}
              </div>
              {isExpanded &&
                (report ? (
                  <TestKindDrilldown report={report} history={kindTrend} />
                ) : (
                  <EmptyDrilldown script={r.script} kindLabel={kind.label} history={kindTrend} />
                ))}
            </article>
          );
        })}
      </div>
    </section>
  );
}

/** Compact "142 tests · 1.3s" badge shown on a kind row once it has a report. */
function KindMetricChip({ report }: { report: TestRunReport }) {
  const { summary, caseGranularity } = report;
  const noun = caseGranularity === "file" ? "files" : "tests";
  return (
    <span
      className={`tests__chip${report.ok ? " tests__chip--ok" : " tests__chip--fail"}`}
      title={`Last run: ${report.summary.passed} passed, ${report.summary.failed} failed`}
    >
      <span className="tests__chip-num">{summary.total.toLocaleString()}</span> {noun}
      {summary.failed > 0 && (
        <span className="tests__chip-fail"> · {summary.failed.toLocaleString()} failed</span>
      )}
      {summary.durationMs != null && (
        <span className="tests__chip-dur"> · {fmtDur(summary.durationMs)}</span>
      )}
    </span>
  );
}

/** Drill-down body for a kind that has no recorded report yet. */
function EmptyDrilldown({
  script,
  kindLabel,
  history,
}: {
  script: string | null;
  kindLabel: string;
  history: TestHistoryEntry[];
}) {
  const hasHistory = history.length > 0;
  return (
    <div className={`tests__drill${hasHistory ? "" : " tests__drill--empty"}`}>
      {hasHistory && <TestTrendGrid entries={history} variant="full" />}
      {script ? (
        <p className="tests__drill-empty-text">
          {hasHistory ? (
            <>
              The latest <code>{script}</code> run&apos;s per-test detail isn&apos;t on disk —
              re-run it to capture the full breakdown alongside the trend above.
            </>
          ) : (
            <>
              No detailed run recorded for <strong>{kindLabel}</strong> yet. Hit{" "}
              <code>Run {script}</code> above — the daemon parses the run and captures the test
              count, every test name and result, durations, and the runner here.
            </>
          )}
        </p>
      ) : (
        <p className="tests__drill-empty-text">
          No script configured for <strong>{kindLabel}</strong>, so there&apos;s nothing to drill
          into yet.
        </p>
      )}
    </div>
  );
}

/** The full per-kind drill-down: counts, pass-rate bar, per-test list, output. */
function TestKindDrilldown({
  report,
  history,
}: {
  report: TestRunReport;
  history: TestHistoryEntry[];
}) {
  const { summary, runner, caseGranularity } = report;
  const blankRun = runner === "unknown" && report.cases.length === 0;
  const [failuresOnly, setFailuresOnly] = useState(summary.failed > 0);
  const [showOutput, setShowOutput] = useState(blankRun);
  const noun = caseGranularity === "file" ? "files" : "tests";

  return (
    <div className="tests__drill">
      <div className="tests__drill-statgrid">
        <StatTile label={caseGranularity === "file" ? "Test files" : "Tests"} tone="total">
          {summary.total.toLocaleString()}
        </StatTile>
        <StatTile label="Passed" tone="pass">
          {summary.passed.toLocaleString()}
        </StatTile>
        <StatTile label="Failed" tone={summary.failed > 0 ? "fail" : "muted"}>
          {summary.failed.toLocaleString()}
        </StatTile>
        {summary.skipped > 0 && (
          <StatTile label="Skipped" tone="skip">
            {summary.skipped.toLocaleString()}
          </StatTile>
        )}
        {summary.todo > 0 && (
          <StatTile label="Todo" tone="muted">
            {summary.todo.toLocaleString()}
          </StatTile>
        )}
        <StatTile label="Duration" tone="muted">
          {fmtDur(summary.durationMs)}
        </StatTile>
        {summary.fileCount != null && caseGranularity !== "file" && (
          <StatTile label="Files" tone="muted">
            {summary.fileCount.toLocaleString()}
          </StatTile>
        )}
        <StatTile label="Result" tone={report.ok ? "pass" : "fail"}>
          {report.ok ? "Passed" : "Failed"}
        </StatTile>
      </div>

      {summary.total > 0 && <PassRateBar report={report} />}

      <div className="tests__drill-meta">
        <span>
          Runner <strong>{runnerLabel(runner)}</strong>
        </span>
        <span>
          Script <code>{report.script}</code>
        </span>
        <span>
          Exit code{" "}
          <strong className={report.exitCode === 0 ? "tests__mono-ok" : "tests__mono-fail"}>
            {report.exitCode}
          </strong>
        </span>
        <span title={new Date(report.generatedAt).toLocaleString()}>
          Ran {formatRelative(report.generatedAt)}
        </span>
      </div>

      {report.broad && (
        <p className="tests__drill-broad">
          These numbers come from the whole-suite <code>test</code> script — they cover every kind
          the suite runs, not just this one.
        </p>
      )}

      {history.length > 0 && <TestTrendGrid entries={history} variant="full" />}

      {blankRun ? (
        <p className="tests__drill-note">
          The output didn&apos;t match a known test runner, so per-test results aren&apos;t
          available — the exit code above is the verdict. Raw output is below.
        </p>
      ) : (
        <CaseList report={report} failuresOnly={failuresOnly} onSetFiltered={setFailuresOnly} />
      )}

      {report.outputTail.length > 0 && (
        <div className="tests__drill-output">
          <button
            type="button"
            className="tests__drill-output-toggle"
            onClick={() => setShowOutput((v) => !v)}
          >
            {showOutput ? "Hide" : "Show"} raw output ({report.outputTail.length}{" "}
            {report.outputTail.length === 1 ? "line" : "lines"})
          </button>
          {showOutput && (
            <pre className="tests__drill-output-body">
              {report.outputTail.map((line, i) => (
                <span key={i} className="tests__drill-output-line">
                  {line || " "}
                </span>
              ))}
            </pre>
          )}
        </div>
      )}

      {report.casesTruncated && (
        <p className="tests__drill-note">
          The per-{noun.replace(/s$/, "")} list was capped to keep the report small — failures are
          always kept; some passing rows are omitted.
        </p>
      )}
    </div>
  );
}

interface CaseGroup {
  file: string;
  cases: TestCaseResult[];
  passed: number;
  failed: number;
}

const CASE_RENDER_CAP = 600;

/** The per-test (or per-file) result list, grouped by source file. */
function CaseList({
  report,
  failuresOnly,
  onSetFiltered,
}: {
  report: TestRunReport;
  failuresOnly: boolean;
  onSetFiltered: (v: boolean) => void;
}) {
  const { groups, shown, hiddenByCap } = useMemo(
    () => groupCases(report.cases, failuresOnly),
    [report.cases, failuresOnly],
  );
  const fileNoun = report.caseGranularity === "file" ? "file" : "test";

  if (report.cases.length === 0) {
    return (
      <p className="tests__drill-note">
        This run reported counts but no individual {fileNoun} names — see the raw output below.
      </p>
    );
  }

  return (
    <div className="tests__cases">
      <div className="tests__cases-bar">
        <span className="tests__cases-title">
          {report.caseGranularity === "file" ? "Test files" : "What was tested"}
        </span>
        {report.summary.failed > 0 && (
          <div className="tests__cases-filter" role="group" aria-label="Filter results">
            <button
              type="button"
              className={`tests__filter-btn${failuresOnly ? " tests__filter-btn--on" : ""}`}
              onClick={() => onSetFiltered(true)}
            >
              Failures ({report.summary.failed})
            </button>
            <button
              type="button"
              className={`tests__filter-btn${!failuresOnly ? " tests__filter-btn--on" : ""}`}
              onClick={() => onSetFiltered(false)}
            >
              All ({report.cases.length})
            </button>
          </div>
        )}
      </div>
      {shown === 0 ? (
        <p className="tests__drill-note">No matching {fileNoun}s.</p>
      ) : (
        <div className="tests__case-groups">
          {groups.map((g) => (
            <CaseGroupBlock
              key={g.file || "(ungrouped)"}
              group={g}
              granularity={report.caseGranularity}
            />
          ))}
        </div>
      )}
      {hiddenByCap > 0 && (
        <p className="tests__drill-note">
          +{hiddenByCap.toLocaleString()} more not shown — narrow with the Failures filter or read
          the raw output.
        </p>
      )}
    </div>
  );
}

function CaseGroupBlock({
  group,
  granularity,
}: {
  group: CaseGroup;
  granularity: TestRunReport["caseGranularity"];
}) {
  // For file-granularity reports each "case" is itself a file — the per-file
  // grouping header would just echo the row, so render the rows flat.
  const showHeader = granularity !== "file" && group.file.length > 0;
  return (
    <div className="tests__case-group">
      {showHeader && (
        <div className="tests__case-group-head">
          <span className="tests__case-group-file" title={group.file}>
            {group.file}
          </span>
          <span className="tests__case-group-tally">
            {group.passed > 0 && <span className="tests__tally-pass">{group.passed}✓</span>}
            {group.failed > 0 && <span className="tests__tally-fail">{group.failed}✗</span>}
          </span>
        </div>
      )}
      <ul className="tests__case-rows">
        {group.cases.map((c, i) => (
          <CaseRow key={`${c.name}-${i}`} c={c} granularity={granularity} />
        ))}
      </ul>
    </div>
  );
}

function CaseRow({
  c,
  granularity,
}: {
  c: TestCaseResult;
  granularity: TestRunReport["caseGranularity"];
}) {
  // The runner's failure detail — the "reason why" behind a red row. Only a
  // failed case carries one; auto-expanded so it's visible without a click.
  const reason = c.status === "failed" ? c.failureMessage : undefined;
  const [open, setOpen] = useState<boolean>(Boolean(reason));
  return (
    <li className={`tests__case-item tests__case-item--${c.status}`}>
      <div className="tests__case">
        <span className={`tests__case-dot tests__case-dot--${c.status}`} aria-hidden="true" />
        <span className="tests__case-name" title={c.name}>
          {c.name}
        </span>
        {granularity === "file" && typeof c.subCount === "number" && (
          <span className="tests__case-sub">
            {c.subCount} {c.subCount === 1 ? "test" : "tests"}
          </span>
        )}
        {reason && (
          <button
            type="button"
            className="tests__case-why"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "hide reason" : "why?"}
          </button>
        )}
        <span className={`tests__case-status tests__case-status--${c.status}`}>{c.status}</span>
        {c.durationMs != null && <span className="tests__case-dur">{fmtDur(c.durationMs)}</span>}
      </div>
      {reason && open && (
        <pre className="tests__case-reason" title="Failure detail captured from the test runner">
          {reason}
        </pre>
      )}
    </li>
  );
}

function StatTile({
  label,
  tone,
  children,
}: {
  label: string;
  tone: "total" | "pass" | "fail" | "skip" | "muted";
  children: React.ReactNode;
}) {
  return (
    <div className={`tests__stat tests__stat--${tone}`}>
      <span className="tests__stat-value">{children}</span>
      <span className="tests__stat-label">{label}</span>
    </div>
  );
}

/** Stacked pass / fail / skip proportion bar. */
function PassRateBar({ report }: { report: TestRunReport }) {
  const { passed, failed, skipped, todo, total } = report.summary;
  const denom = total > 0 ? total : passed + failed + skipped + todo || 1;
  const other = skipped + todo;
  const pct = (n: number) => `${(n / denom) * 100}%`;
  const rate = denom > 0 ? Math.round((passed / denom) * 100) : 0;
  return (
    <div className="tests__rate">
      <div className="tests__rate-bar" role="img" aria-label={`${rate}% passing`}>
        {passed > 0 && (
          <span className="tests__rate-seg tests__rate-seg--pass" style={{ width: pct(passed) }} />
        )}
        {failed > 0 && (
          <span className="tests__rate-seg tests__rate-seg--fail" style={{ width: pct(failed) }} />
        )}
        {other > 0 && (
          <span className="tests__rate-seg tests__rate-seg--skip" style={{ width: pct(other) }} />
        )}
      </div>
      <span className="tests__rate-label">{rate}% pass rate</span>
    </div>
  );
}

function KindRunStatus({
  running,
  lastRun,
}: {
  running: boolean;
  lastRun: TestRunRecord | undefined;
}) {
  const [open, setOpen] = useState(false);

  if (running) {
    return (
      <span className="tests__run-status tests__run-status--running">
        <span className="tests__run-spinner" aria-hidden="true" />
        Running…
      </span>
    );
  }

  if (!lastRun) return null;

  const passed = lastRun.exitCode === 0;
  const label = passed ? "pass" : "FAIL";
  const statusMod = passed ? "pass" : "fail";

  return (
    <div className="tests__kind-last-run-block">
      <span className={`tests__kind-last-run tests__kind-last-run--${statusMod}`}>
        Last run: {formatRelativeShort(lastRun.startedAt)} &middot; {label}{" "}
        {formatDuration(lastRun.duration)} &middot; exit {lastRun.exitCode}
      </span>
      {!passed && lastRun.stderrTail.length > 0 && (
        <div className="tests__stderr-tail">
          <button type="button" className="tests__stderr-toggle" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide" : "Show"} last output ({lastRun.stderrTail.length} lines)
          </button>
          {open && (
            <div className="tests__stderr-lines">
              {lastRun.stderrTail.map((line, i) => (
                <span key={i} className="tests__stderr-line">
                  {line}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: TestStatus }) {
  return (
    <span className={`tests__pill tests__pill--${status}`} title={statusLabel(status)}>
      <span className="tests__pill-dot" aria-hidden="true" />
      {statusLabel(status)}
    </span>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────

function formatRelative(ts: number | null): string {
  if (ts == null) return "never";
  const delta = Date.now() - ts;
  if (delta < 0) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

/** Human duration from milliseconds. `null` → em dash. */
function fmtDur(ms: number | null | undefined): string {
  if (ms == null) return "—";
  if (ms < 1) return "<1ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

function runnerLabel(runner: TestRunner): string {
  switch (runner) {
    case "bun":
      return "bun test";
    case "vitest":
      return "Vitest";
    case "playwright":
      return "Playwright";
    default:
      return "unknown runner";
  }
}

/** Sum recorded reports into a service-wide tally, ignoring `broad` copies. */
function rollUpReports(reports: ReportMap): {
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  classes: number;
} {
  let total = 0;
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  let classes = 0;
  for (const report of Object.values(reports)) {
    if (!report) continue;
    classes += 1;
    if (report.broad) continue;
    total += report.summary.total;
    passed += report.summary.passed;
    failed += report.summary.failed;
    skipped += report.summary.skipped;
  }
  return { total, passed, failed, skipped, classes };
}

/**
 * Group cases by source file, sort failures first (both within a group and
 * across groups), optionally filter to failures only, and cap the rendered
 * count so a huge suite can't lock the UI.
 */
function groupCases(
  cases: TestCaseResult[],
  failuresOnly: boolean,
): { groups: CaseGroup[]; shown: number; hiddenByCap: number } {
  const filtered = failuresOnly ? cases.filter((c) => c.status === "failed") : cases;
  const byFile = new Map<string, TestCaseResult[]>();
  for (const c of filtered) {
    const key = c.file ?? "";
    const arr = byFile.get(key);
    if (arr) arr.push(c);
    else byFile.set(key, [c]);
  }
  const rank = (s: TestCaseResult["status"]) =>
    s === "failed" ? 0 : s === "skipped" ? 1 : s === "todo" ? 2 : 3;
  const groups: CaseGroup[] = [];
  for (const [file, list] of byFile) {
    const sorted = [...list].sort((a, b) => rank(a.status) - rank(b.status));
    groups.push({
      file,
      cases: sorted,
      passed: list.filter((c) => c.status === "passed").length,
      failed: list.filter((c) => c.status === "failed").length,
    });
  }
  // Groups with failures float to the top; then alphabetical by file.
  groups.sort((a, b) => {
    if (a.failed > 0 !== b.failed > 0) return a.failed > 0 ? -1 : 1;
    return a.file.localeCompare(b.file);
  });
  // Cap total rendered rows. Failures are listed first so they survive the cap.
  let budget = CASE_RENDER_CAP;
  const capped: CaseGroup[] = [];
  let shown = 0;
  for (const g of groups) {
    if (budget <= 0) break;
    const slice = g.cases.slice(0, budget);
    budget -= slice.length;
    shown += slice.length;
    capped.push({ ...g, cases: slice });
  }
  return { groups: capped, shown, hiddenByCap: filtered.length - shown };
}
