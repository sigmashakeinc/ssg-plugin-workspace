import { useEffect, useRef, useState } from "react";
import type { WorkspaceApiClient } from "../api/client";
import type { ProjectCard } from "../api/types";
import { friendlyError } from "../lib/errors";

interface Props {
  card: ProjectCard;
  client: WorkspaceApiClient;
}

export function RunPanel({ card, client }: Props) {
  const [script, setScript] = useState<string>(card.scripts[0] ?? "");
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<(() => Promise<void>) | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setScript(card.scripts[0] ?? "");
    setLines([]);
    setExitCode(null);
    setError(null);
  }, [card.scripts]);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, []);

  async function start() {
    if (!script) return;
    setRunning(true);
    setLines([]);
    setExitCode(null);
    setError(null);
    try {
      const handle = await client.runScript(card.slug, script);
      cancelRef.current = handle.cancel;
      for await (const ev of handle.events) {
        if (ev.line) setLines((prev) => [...prev, ev.line]);
        if (ev.done) {
          setExitCode(ev.exitCode ?? 0);
          break;
        }
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setRunning(false);
      cancelRef.current = null;
    }
  }

  async function cancel() {
    if (cancelRef.current) await cancelRef.current();
  }

  if (card.scripts.length === 0) {
    return (
      <div className="panel">
        <div className="state-card">
          <h2 className="state-card__title">No scripts</h2>
          <p className="state-card__body">
            This project doesn&apos;t declare any package.json scripts, so there&apos;s nothing to
            run from here.
          </p>
        </div>
      </div>
    );
  }

  const friendlyCommand =
    script && card.slug.startsWith("sigmashake-")
      ? `bun run ${card.slug.replace(/^sigmashake-/, "")}:${script}`
      : `bun run ${script}`;

  const logState = running ? "running" : exitCode === 0 ? "ok" : exitCode != null ? "fail" : "idle";
  const headerTitle = running
    ? `Running ${script}…`
    : exitCode === 0
      ? `Finished — ${script}`
      : exitCode != null
        ? `Failed — ${script} (exit ${exitCode})`
        : `Ready — ${script}`;

  return (
    <div className="panel">
      <h3 className="panel__h3">Run a script</h3>
      <div className="run__header">
        <div className="select-pill">
          <select
            className="select-pill__field"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            disabled={running}
          >
            {card.scripts.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        {running ? (
          <button type="button" className="pill-btn pill-btn--danger" onClick={cancel}>
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            onClick={start}
            disabled={!script}
          >
            <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M2.5 1.5 L10 6 L2.5 10.5 Z" fill="currentColor" />
            </svg>
            Run
          </button>
        )}
        <span className="edit__status" title="Command that will execute">
          {friendlyCommand}
        </span>
      </div>

      <div className={`log-block log-block--${logState}`}>
        <header className="log-block__head">
          <span className="log-block__title">{headerTitle}</span>
        </header>
        {error && <div className="error">{error}</div>}
        <div className="log-block__pane" ref={logRef}>
          {lines.length === 0 ? (
            <div className="log-block__empty">
              {running ? "Starting…" : "No output yet. Press Run to start."}
            </div>
          ) : (
            lines.map((l, i) => (
              <span key={i} className="log-block__line">
                {l}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
