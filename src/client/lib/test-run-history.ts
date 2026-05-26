// localStorage helper for per-kind test run history.
// Key format: ssg:workspace:test-runs:<slug>:<kindId>
// Stores up to MAX_RUNS entries per kind; newest first.

export interface TestRunRecord {
  startedAt: number; // unix ms
  endedAt: number; // unix ms
  duration: number; // ms
  exitCode: number;
  command: string;
  /** Last ~5 stderr/output lines captured (only populated on non-zero exit). */
  stderrTail: string[];
}

const MAX_RUNS = 10;
const MAX_TAIL = 5;

function storageKey(slug: string, kindId: string): string {
  return `ssg:workspace:test-runs:${slug}:${kindId}`;
}

export function loadRunHistory(slug: string, kindId: string): TestRunRecord[] {
  try {
    const raw = localStorage.getItem(storageKey(slug, kindId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveRunRecord(
  slug: string,
  kindId: string,
  record: TestRunRecord,
): TestRunRecord[] {
  const prev = loadRunHistory(slug, kindId);
  const next = [record, ...prev].slice(0, MAX_RUNS);
  try {
    localStorage.setItem(storageKey(slug, kindId), JSON.stringify(next));
  } catch {
    // localStorage quota exceeded — silently ignore
  }
  return next;
}

/** Build the stderrTail from all output lines when the run failed. */
export function buildStderrTail(lines: string[], exitCode: number): string[] {
  if (exitCode === 0) return [];
  return lines.filter((l) => l.trim().length > 0).slice(-MAX_TAIL);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = (ms / 1000).toFixed(1);
  return `${s}s`;
}

export function formatRelativeShort(ts: number): string {
  const delta = Date.now() - ts;
  if (delta < 0) return "just now";
  const minutes = Math.floor(delta / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
