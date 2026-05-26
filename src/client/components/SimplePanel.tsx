import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkspaceApiClient } from "../api/client";
import type { ProjectCard } from "../api/types";
import { friendlyError } from "../lib/errors";
import { FeatureIdeasCard } from "./FeatureIdeasCard";

interface Props {
  card: ProjectCard;
  client: WorkspaceApiClient | null;
  onSwitchToAdvanced?: () => void;
}

const PROJECT_TYPE_LABEL: Record<ProjectCard["type"], string> = {
  "cf-worker": "Website or web app",
  bun: "Script or local app",
  elixir: "Always-on service",
  native: "Native binary",
  unknown: "Project",
};

const PROJECT_TYPE_DESCRIPTION: Record<ProjectCard["type"], string> = {
  "cf-worker": "Lives on the internet — anyone with the link can open it.",
  bun: "Runs on your own computer. Good for automations and small tools.",
  elixir: "An always-on background service that keeps running on its own.",
  native: "A fast standalone program — used only for performance-critical tools.",
  unknown: "A project in your monorepo.",
};

interface ActionDef {
  /** Script name (must exist on `card.scripts`). */
  script: string;
  label: string;
  hint: string;
  /** Whether this is the primary CTA in its row. */
  primary?: boolean;
}

// Curated, plain-English action set. We hide any action whose script isn't
// declared by the project's package.json so users never see broken buttons.
const ACTION_DEFS: ActionDef[] = [
  {
    script: "dev",
    label: "Preview on this computer",
    hint: "Run the app locally so you can poke around before sharing it with the world.",
    primary: true,
  },
  {
    script: "deploy",
    label: "Publish to the internet",
    hint: "Push the current version live so anyone with the link can use it.",
    primary: true,
  },
  {
    script: "build",
    label: "Prepare it for release",
    hint: "Bundle and optimize the app so it's ready to be published.",
  },
  {
    script: "test",
    label: "Self-test the app",
    hint: "Run the automated checks so you know nothing's broken.",
  },
  {
    script: "typecheck",
    label: "Spot-check for mistakes",
    hint: "Look for obvious typos and code errors without running the app.",
  },
];

export function SimplePanel({ card, client, onSwitchToAdvanced }: Props) {
  const [pkgName, setPkgName] = useState<string | null>(null);
  const [pkgDesc, setPkgDesc] = useState<string | null>(null);
  const [pkgRaw, setPkgRaw] = useState<string | null>(null);
  const [claudeBlurb, setClaudeBlurb] = useState<string | null>(null);
  const [liveUrl, setLiveUrl] = useState<string | null>(null);
  const [runningScript, setRunningScript] = useState<string | null>(null);
  const [runLines, setRunLines] = useState<string[]>([]);
  const [runDone, setRunDone] = useState(true);
  const [runError, setRunError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<(() => Promise<void>) | null>(null);

  // Read package.json + CLAUDE.md (if available) + wrangler.toml route
  useEffect(() => {
    let cancelled = false;
    if (!client?.hasLocalCapabilities) {
      setPkgName(card.slug);
      setPkgDesc(card.description || null);
      return;
    }
    (async () => {
      try {
        const raw = await client.readFile(card.slug, "package.json");
        if (cancelled) return;
        setPkgRaw(raw);
        try {
          const parsed = JSON.parse(raw) as { name?: string; description?: string };
          setPkgName(parsed.name ?? card.slug);
          setPkgDesc(parsed.description ?? card.description ?? null);
        } catch {
          setPkgName(card.slug);
          setPkgDesc(card.description ?? null);
        }
      } catch {
        setPkgName(card.slug);
        setPkgDesc(card.description ?? null);
      }
      if (card.hasClaudeMd) {
        try {
          const md = await client.readFile(card.slug, "CLAUDE.md");
          if (cancelled) return;
          setClaudeBlurb(extractClaudeBlurb(md));
        } catch {
          // ignore
        }
      }
      if (card.hasWranglerToml) {
        try {
          const toml = await client.readFile(card.slug, "wrangler.toml");
          if (cancelled) return;
          setLiveUrl(extractLiveUrl(toml));
        } catch {
          // ignore
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card, client]);

  // Auto-scroll the log to the bottom as new lines stream in.
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, []);

  const runScript = useCallback(
    async (script: string) => {
      if (!client?.hasLocalCapabilities) return;
      if (cancelRef.current) {
        await cancelRef.current();
      }
      setRunningScript(script);
      setRunLines([]);
      setRunDone(false);
      setRunError(null);
      try {
        const handle = await client.runScript(card.slug, script);
        cancelRef.current = handle.cancel;
        for await (const ev of handle.events) {
          if (ev.line) setRunLines((cur) => [...cur, ev.line]);
          if (ev.done) {
            setRunDone(true);
            if (ev.exitCode && ev.exitCode !== 0) {
              setRunError(`Exited with code ${ev.exitCode}`);
            }
            cancelRef.current = null;
            return;
          }
        }
      } catch (err) {
        setRunError(friendlyError(err));
        setRunDone(true);
        cancelRef.current = null;
      } finally {
        setRunningScript(null);
      }
    },
    [client, card.slug],
  );

  const stopRun = useCallback(async () => {
    if (cancelRef.current) {
      await cancelRef.current();
      cancelRef.current = null;
    }
  }, []);

  const saveMeta = useCallback(
    async (next: { name?: string; description?: string }) => {
      if (!client || !pkgRaw) return;
      setSaveState("saving");
      setSaveError(null);
      try {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = JSON.parse(pkgRaw) as Record<string, unknown>;
        } catch {
          throw new Error("package.json isn't valid JSON — open the Edit tab to fix it.");
        }
        if (next.name !== undefined) parsed.name = next.name;
        if (next.description !== undefined) parsed.description = next.description;
        const out = `${JSON.stringify(parsed, null, 2)}\n`;
        await client.writeFile({
          project: card.slug,
          file: "package.json",
          content: out,
        });
        setPkgRaw(out);
        setSaveState("saved");
        setTimeout(() => setSaveState("idle"), 1400);
      } catch (err) {
        setSaveState("error");
        setSaveError(friendlyError(err));
      }
    },
    [client, card.slug, pkgRaw],
  );

  const availableActions = ACTION_DEFS.filter((a) => card.scripts.includes(a.script));
  const typeLabel = PROJECT_TYPE_LABEL[card.type];
  const typeBlurb = PROJECT_TYPE_DESCRIPTION[card.type];
  const cloudReadOnly = !client?.hasLocalCapabilities;

  return (
    <div className="simple">
      <section className="simple__hero">
        <div className="simple__hero-row">
          <span className={`simple__chip simple__chip--${card.type}`}>{typeLabel}</span>
          {liveUrl && (
            <a
              className="simple__live"
              href={liveUrl}
              target="_blank"
              rel="noreferrer"
              title={`Open ${liveUrl} in a new tab`}
            >
              <span
                aria-hidden="true"
                style={{
                  display: "inline-block",
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  background: "var(--ss-ok, #10b981)",
                  marginRight: 6,
                }}
              />
              {liveUrl.replace(/^https?:\/\//, "")}
            </a>
          )}
        </div>
        <EditableHeading
          value={pkgName ?? card.slug}
          placeholder={card.slug}
          disabled={cloudReadOnly}
          onCommit={(v) => saveMeta({ name: v })}
        />
        <EditableDescription
          value={pkgDesc ?? ""}
          placeholder={
            card.description || "Tell future-you what this service does in plain English."
          }
          disabled={cloudReadOnly}
          onCommit={(v) => saveMeta({ description: v })}
        />
        <p className="simple__type-blurb">{typeBlurb}</p>
        {saveState === "saving" && <p className="simple__save simple__save--info">Saving…</p>}
        {saveState === "saved" && <p className="simple__save simple__save--ok">Saved ✓</p>}
        {saveState === "error" && saveError && (
          <p className="simple__save simple__save--err">{saveError}</p>
        )}
      </section>

      {!cloudReadOnly && availableActions.length > 0 && (
        <section className="simple__actions">
          <h3 className="simple__h3">What would you like to do?</h3>
          <div className="simple__action-grid">
            {availableActions.map((a) => (
              <ActionButton
                key={a.script}
                action={a}
                projectLabel={pkgName ?? card.slug}
                running={runningScript === a.script}
                disabled={runningScript !== null && runningScript !== a.script}
                onConfirm={() => runScript(a.script)}
              />
            ))}
          </div>
        </section>
      )}

      {!cloudReadOnly && (runLines.length > 0 || runningScript || runError) && (
        <section className="simple__log-wrap">
          <header className="simple__log-head">
            <span className="simple__log-title">
              {runningScript
                ? `Running ${runningScript}…`
                : runError
                  ? "Finished with errors"
                  : runDone
                    ? "Finished"
                    : "Output"}
            </span>
            {runningScript && (
              <button
                type="button"
                className="simple__stop"
                onClick={stopRun}
                title="Stop the running script"
              >
                Stop
              </button>
            )}
          </header>
          <div className="simple__log" ref={logRef}>
            {runLines.length === 0 && runningScript && (
              <div className="simple__log-empty">Starting…</div>
            )}
            {runLines.map((l, i) => (
              <div key={i} className="simple__log-line">
                {l}
              </div>
            ))}
            {runError && <div className="simple__log-line simple__log-line--err">{runError}</div>}
          </div>
        </section>
      )}

      {!cloudReadOnly && client && <FeatureIdeasCard card={card} client={client} />}

      {claudeBlurb && (
        <section className="simple__notes">
          <h3 className="simple__h3">What this does, in plain English</h3>
          <div className="simple__notes-body">{claudeBlurb}</div>
        </section>
      )}

      {onSwitchToAdvanced && !cloudReadOnly && (
        <p className="simple__footer">
          Need full control?{" "}
          <button type="button" className="simple__link" onClick={onSwitchToAdvanced}>
            Switch to advanced mode
          </button>{" "}
          to see git status, raw scripts, and edit config files directly.
        </p>
      )}
    </div>
  );
}

interface ActionButtonProps {
  action: ActionDef;
  projectLabel: string;
  running: boolean;
  disabled: boolean;
  onConfirm: () => void;
}

// Two-step button: first click "arms" the action and changes the label to a
// confirmation prompt; second click within 5s actually runs it. Stops a stray
// click on "Publish to the internet" from immediately deploying.
function ActionButton({ action, projectLabel, running, disabled, onConfirm }: ActionButtonProps) {
  const [armed, setArmed] = useState(false);
  const armTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Disarm on unmount or when the action starts running.
    return () => {
      if (armTimer.current) clearTimeout(armTimer.current);
    };
  }, []);

  useEffect(() => {
    if (running && armed) setArmed(false);
  }, [running, armed]);

  const arm = useCallback(() => {
    setArmed(true);
    if (armTimer.current) clearTimeout(armTimer.current);
    armTimer.current = setTimeout(() => setArmed(false), 5000);
  }, []);

  const disarm = useCallback(() => {
    setArmed(false);
    if (armTimer.current) clearTimeout(armTimer.current);
  }, []);

  const handleClick = useCallback(() => {
    if (running || disabled) return;
    if (armed) {
      disarm();
      onConfirm();
    } else {
      arm();
    }
  }, [armed, running, disabled, onConfirm, arm, disarm]);

  return (
    <button
      type="button"
      className={
        "simple__action" +
        (action.primary ? " simple__action--primary" : "") +
        (running ? " simple__action--active" : "") +
        (armed ? " simple__action--armed" : "")
      }
      disabled={disabled}
      onClick={handleClick}
      onBlur={disarm}
      aria-pressed={armed}
    >
      <span className="simple__action-label">
        {armed ? `Tap again to ${action.label.toLowerCase()}` : action.label}
      </span>
      <span className="simple__action-hint">
        {armed
          ? `This will run "${action.script}" on ${projectLabel}. Tap elsewhere to cancel.`
          : action.hint}
      </span>
    </button>
  );
}

interface EditableHeadingProps {
  value: string;
  placeholder: string;
  disabled?: boolean;
  onCommit: (v: string) => void;
}

function EditableHeading({ value, placeholder, disabled, onCommit }: EditableHeadingProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      type="text"
      className="simple__title-input"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={false}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft.trim() && draft !== value) onCommit(draft.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") {
          setDraft(value);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function EditableDescription({ value, placeholder, disabled, onCommit }: EditableHeadingProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <textarea
      className="simple__desc-input"
      value={draft}
      placeholder={placeholder}
      disabled={disabled}
      spellCheck={true}
      rows={2}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft.trim());
      }}
    />
  );
}

function extractClaudeBlurb(md: string): string | null {
  // Drop the first heading; collect the first ~3 paragraphs that aren't
  // headings, code fences, or HTML tags so the user sees the prose intro
  // rather than the file layout / commands tables.
  const lines = md.split(/\r?\n/);
  const paragraphs: string[] = [];
  let buf: string[] = [];
  let inCodeFence = false;
  const flush = () => {
    if (buf.length === 0) return;
    const text = buf.join(" ").trim();
    if (text && !text.startsWith("#") && !text.startsWith("<")) {
      paragraphs.push(text);
    }
    buf = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (line.startsWith("```")) {
      inCodeFence = !inCodeFence;
      flush();
      continue;
    }
    if (inCodeFence) continue;
    if (line === "") {
      flush();
      if (paragraphs.length >= 3) break;
      continue;
    }
    if (line.startsWith("#")) {
      flush();
      continue;
    }
    if (line.startsWith("|") || line.startsWith("---")) continue;
    buf.push(line);
  }
  flush();
  if (paragraphs.length === 0) return null;
  return paragraphs.slice(0, 3).join("\n\n");
}

function extractLiveUrl(toml: string): string | null {
  // Pull the first `pattern = "<host>/..."` from a `[[routes]]` block, or
  // the `pattern` from `[routes]`. Workers use one of these two shapes.
  const patternMatch = toml.match(/pattern\s*=\s*["']([^"']+)["']/);
  if (!patternMatch?.[1]) return null;
  const raw = patternMatch[1];
  // Strip path glob (e.g. "/*" or "/api/*") so the user lands on the root.
  const host = raw.replace(/\/.*$/, "");
  if (!host || host.includes("*")) return null;
  return host.startsWith("http") ? host : `https://${host}`;
}
