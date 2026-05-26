// Indeterminate progress strip. Sits at the top of a panel header while a
// background fetch is in flight so the user can tell that work is happening
// even when cached data is already on screen. Goes invisible (height: 0,
// opacity: 0) when idle so it doesn't push layout around.

interface Props {
  loading: boolean;
  /** Optional label rendered to the right of the bar. */
  label?: string;
  /**
   * When provided, renders as a determinate bar at `progress / total`. The
   * cert and distribution scans use this to show "scanned 24 of 41 services"
   * during the first paint.
   */
  progress?: number;
  total?: number;
}

export function ProgressStrip({ loading, label, progress, total }: Props) {
  const isDeterminate = typeof progress === "number" && typeof total === "number" && total > 0;
  const pct = isDeterminate ? Math.min(100, Math.max(0, (progress! / total!) * 100)) : 0;
  return (
    <div
      className={
        "progress-strip" +
        (loading ? " progress-strip--active" : "") +
        (isDeterminate ? " progress-strip--determinate" : "")
      }
      aria-hidden={!loading}
    >
      <div className="progress-strip__track">
        <div
          className={`progress-strip__bar${isDeterminate ? "" : " progress-strip__bar--indet"}`}
          style={isDeterminate ? { width: `${pct}%` } : undefined}
        />
      </div>
      {label ? (
        <span className="progress-strip__label">
          {label}
          {isDeterminate ? ` · ${progress}/${total}` : ""}
        </span>
      ) : null}
    </div>
  );
}
