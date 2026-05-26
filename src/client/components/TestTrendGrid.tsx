// TestTrendGrid — a GitHub-contribution-style grid of recorded test runs.
//
// The Tests panel's matrix and drill-down answer "is this kind green *now*?".
// This component answers "has it been green?" — it renders one coloured cell
// per recorded run (from `TestReportBundle.history`, written by the SSG
// daemon to `.test-history-<kind>.jsonl`), oldest top-left → newest
// bottom-right, exactly like a GitHub contribution graph.
//
//   green  — clean pass (every test ran and passed)
//   amber  — passed, but some tests were skipped / todo
//   red    — failed (a non-zero exit or at least one failing test)
//
// Two variants: `inline` is a compact strip shown on a collapsed kind row so
// the trend reads at a glance; `full` is the wrapped grid with a legend and
// a pass-rate / streak / last-run summary, shown inside the drill-down.

import type { TestHistoryEntry } from "../api/types";
import { formatRelativeShort } from "../lib/test-run-history";

/** Pass / partial / fail — the three colours a trend cell can take. */
export type TrendCellState = "pass" | "partial" | "fail";

/** Classify one recorded run into a trend-cell colour. */
export function trendCellState(e: TestHistoryEntry): TrendCellState {
  if (!e.ok || e.failed > 0) return "fail";
  if (e.skipped > 0 || e.todo > 0) return "partial";
  return "pass";
}

const STATE_WORD: Record<TrendCellState, string> = {
  pass: "Passed",
  partial: "Passed (some skipped)",
  fail: "Failed",
};

/** How many of the most recent runs the compact `inline` strip shows. */
const INLINE_MAX = 20;

interface Props {
  /** Recorded runs, oldest first — the order the daemon ships them in. */
  entries: TestHistoryEntry[];
  /**
   * `inline` — a compact strip for a collapsed kind row.
   * `full` — the wrapped grid with legend + pass-rate / streak summary.
   */
  variant: "inline" | "full";
}

export function TestTrendGrid({ entries, variant }: Props) {
  if (entries.length === 0) return null;

  if (variant === "inline") {
    const shown = entries.slice(-INLINE_MAX);
    return (
      <div
        className="tests__trend-strip"
        title={`Test run history — last ${shown.length} run${
          shown.length === 1 ? "" : "s"
        }, oldest left`}
        aria-label={`Run history sparkline, ${shown.length} runs`}
      >
        {shown.map((e, i) => (
          <TrendCell key={e.at + ":" + i} entry={e} latest={i === shown.length - 1} />
        ))}
      </div>
    );
  }

  const greens = entries.filter((e) => trendCellState(e) !== "fail").length;
  const greenPct = Math.round((greens / entries.length) * 100);
  const streak = currentStreak(entries);
  const newest = entries[entries.length - 1];

  return (
    <section className="tests__trend">
      <div className="tests__trend-head">
        <span className="tests__trend-title">Run history</span>
        <span className="tests__trend-count">
          {entries.length} run{entries.length === 1 ? "" : "s"} recorded
        </span>
      </div>
      <div
        className="tests__trend-grid"
        role="img"
        aria-label={`${entries.length} recorded runs, ${greenPct}% green`}
      >
        {entries.map((e, i) => (
          <TrendCell key={e.at + ":" + i} entry={e} latest={i === entries.length - 1} />
        ))}
      </div>
      <div className="tests__trend-foot">
        <div className="tests__trend-legend" aria-hidden="true">
          <span className="tests__trend-legend-item">
            <span className="tests__trend-cell tests__trend-cell--pass" />
            pass
          </span>
          <span className="tests__trend-legend-item">
            <span className="tests__trend-cell tests__trend-cell--partial" />
            skips
          </span>
          <span className="tests__trend-legend-item">
            <span className="tests__trend-cell tests__trend-cell--fail" />
            fail
          </span>
        </div>
        <div className="tests__trend-stats">
          <span
            className={`tests__trend-rate${
              greenPct >= 80 ? " tests__trend-rate--ok" : " tests__trend-rate--warn"
            }`}
          >
            {greenPct}% green
          </span>
          {streak && (
            <span
              className={`tests__trend-streak tests__trend-streak--${
                streak.failing ? "fail" : "ok"
              }`}
            >
              {streak.failing
                ? `failing — last ${streak.count} run${streak.count === 1 ? "" : "s"}`
                : `${streak.count} green in a row`}
            </span>
          )}
          <span className="tests__trend-last" title={new Date(newest.at).toLocaleString()}>
            last run {formatRelativeShort(newest.at)}
          </span>
        </div>
      </div>
    </section>
  );
}

/** A single coloured run square with a native hover tooltip. */
function TrendCell({ entry, latest }: { entry: TestHistoryEntry; latest: boolean }) {
  const state = trendCellState(entry);
  return (
    <span
      className={`tests__trend-cell tests__trend-cell--${state}${
        latest ? " tests__trend-cell--latest" : ""
      }`}
      title={cellTitle(entry, latest)}
    />
  );
}

/** Multi-line native tooltip text for one run. */
function cellTitle(e: TestHistoryEntry, latest: boolean): string {
  const counts = [`${e.passed}/${e.total} passed`];
  if (e.failed > 0) counts.push(`${e.failed} failed`);
  if (e.skipped > 0) counts.push(`${e.skipped} skipped`);
  if (e.todo > 0) counts.push(`${e.todo} todo`);
  const meta = [`${fmtDur(e.durationMs)}`, `run "${e.script}"`];
  if (e.broad) meta.push("whole-suite run");
  return [
    `${STATE_WORD[trendCellState(e)]}${latest ? " · most recent run" : ""}`,
    new Date(e.at).toLocaleString(),
    counts.join(", "),
    meta.join(" · "),
  ].join("\n");
}

/**
 * The run streak at the newest end — how many consecutive most-recent runs
 * share the newest run's fail / not-fail verdict. `pass` and `partial` both
 * count as "not failing" so a green streak isn't broken by a skipped test.
 */
function currentStreak(
  entries: TestHistoryEntry[],
): { failing: boolean; count: number } | null {
  if (entries.length === 0) return null;
  const newestEntry = entries[entries.length - 1];
  if (!newestEntry) return null;
  const failing = trendCellState(newestEntry) === "fail";
  let count = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i];
    if (!e) break;
    if ((trendCellState(e) === "fail") === failing) count += 1;
    else break;
  }
  return { failing, count };
}

/** Compact human duration. `null` → em dash. */
function fmtDur(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) {
    const s = ms / 1000;
    return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
  }
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
