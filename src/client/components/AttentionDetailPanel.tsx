// Expandable detail panel rendered beneath an attention row when the operator
// clicks one. Pulls the per-project deep-dive payload from the SSG daemon's
// /api/json/workspace/attention-details endpoint and shows:
//
//   - Why this row fired (plain-English reason + raw evidence: file lists,
//     commit subjects, sentinel content)
//   - What to do about it (copy-pasteable shell command)
//   - Why AI isn't already on it (runtime status + active jobs + last
//     assignment + manual-dispatch commands)
//
// All three blocks fail open — a probe that fails simply hides that block;
// the rest of the panel still renders.

import { useEffect, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type {
  AttentionAiDetail,
  AttentionBuildDetail,
  AttentionCommitInfo,
  AttentionDeployDetail,
  AttentionDetails,
  AttentionGitDetail,
  AttentionTestsDetail,
} from "../api/types";

interface Props {
  client: WorkspaceApiClient;
  slug: string;
  /** Which bucket the row belongs to — drives which block opens first. */
  focus: AttentionFocus;
}

export type AttentionFocus = "deploy" | "tests" | "build" | "git" | "ai";

type AssignKind = "fix-tests" | "fix-deploy" | "fix-build" | "push" | "investigate";

/** Default assignment kind for the focused bucket. */
function focusToKind(focus: AttentionFocus): AssignKind {
  if (focus === "tests") return "fix-tests";
  if (focus === "deploy") return "fix-deploy";
  if (focus === "build") return "fix-build";
  if (focus === "git") return "push";
  return "investigate";
}

export function AttentionDetailPanel({ client, slug, focus }: Props) {
  const [data, setData] = useState<AttentionDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Bump to re-trigger the loader after a successful assignment. Avoids
  // forcing the parent to re-key the panel just to refresh `lastAssignment`.
  const [reloadTick, setReloadTick] = useState(0);
  // In-flight state for the Dispatch button — null when idle, "sending"
  // while the fetch is open, error string on failure.
  const [assignState, setAssignState] = useState<null | "sending" | "done" | { error: string }>(
    null,
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: reloadTick is an intentional re-fetch trigger, not an effect-body read
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setData(null);
    client
      .getAttentionDetails(slug)
      .then((d) => {
        if (cancelled) return;
        setData(d);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, slug, reloadTick]);

  const onDispatch = async () => {
    setAssignState("sending");
    try {
      await client.assignAi(slug, focusToKind(focus));
      setAssignState("done");
      // Refresh so the AI block shows the new lastAssignment line.
      setReloadTick((n) => n + 1);
      // Clear the "done" pill after a short beat — the lastAssignment line
      // itself is the durable feedback.
      setTimeout(() => setAssignState(null), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setAssignState({ error: msg });
    }
  };

  if (loading) {
    return (
      <div className="attn-detail attn-detail--loading" role="status">
        Loading evidence for {slug}…
      </div>
    );
  }
  if (error) {
    return (
      <div className="attn-detail attn-detail--error">
        Couldn't load details for {slug}: {error}
      </div>
    );
  }
  if (!data) return null;

  // Order blocks so the focused bucket is on top. Skip blocks that aren't
  // applicable — there's no point telling the operator "no test script" if
  // they clicked into the deploy bucket.
  const blocks = [
    {
      id: "deploy" as const,
      render: data.deploy.applicable ? <DeployBlock detail={data.deploy} /> : null,
    },
    {
      id: "tests" as const,
      render: data.tests.applicable ? <TestsBlock detail={data.tests} /> : null,
    },
    {
      id: "build" as const,
      render: data.build.applicable ? <BuildBlock detail={data.build} /> : null,
    },
    {
      id: "git" as const,
      render:
        data.git.dirty || data.git.aheadOriginMain > 0 || data.git.behindOriginMain > 0 ? (
          <GitBlock detail={data.git} />
        ) : null,
    },
    {
      id: "ai" as const,
      render: (
        <AiBlock
          detail={data.ai}
          assignState={assignState}
          onDispatch={onDispatch}
          kindLabel={focusToKind(focus)}
        />
      ),
    },
  ];
  const ordered = [
    ...blocks.filter((b) => b.id === focus),
    ...blocks.filter((b) => b.id !== focus),
  ].filter((b) => b.render !== null);

  return (
    <div className="attn-detail">
      <div className="attn-detail__stamp">
        Updated {new Date(data.generatedAt).toLocaleTimeString()}
      </div>
      {ordered.map((b) => (
        <section key={b.id} className="attn-detail__block">
          {b.render}
        </section>
      ))}
    </div>
  );
}

// ── Reusable block scaffold ──────────────────────────────────────────────

interface BlockProps {
  title: string;
  tone: "ok" | "warn" | "fail" | "info";
  reason: string;
  suggestedFix?: string;
  children?: React.ReactNode;
}

function Block({ title, tone, reason, suggestedFix, children }: BlockProps) {
  return (
    <div className={`attn-block attn-block--${tone}`}>
      <header className="attn-block__head">
        <span className="attn-block__dot" aria-hidden="true" />
        <h4 className="attn-block__title">{title}</h4>
      </header>
      <p className="attn-block__reason">{reason}</p>
      {children}
      {suggestedFix ? <FixCommand command={suggestedFix} /> : null}
    </div>
  );
}

function FixCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="attn-block__fix">
      <span className="attn-block__fix-label">What to do</span>
      <div className="attn-block__fix-row">
        <code className="attn-block__fix-cmd">{command}</code>
        <button
          type="button"
          className="attn-block__fix-copy"
          onClick={() => {
            try {
              void navigator.clipboard?.writeText(command);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            } catch {
              // ignore — clipboard may be blocked in cloud preview
            }
          }}
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// ── Per-bucket renderers ────────────────────────────────────────────────

function DeployBlock({ detail }: { detail: AttentionDeployDetail }) {
  const tone = detail.ok === true ? "ok" : detail.ok === false ? "fail" : "info";
  return (
    <Block
      title="Deploy gate"
      tone={tone}
      reason={detail.reason}
      suggestedFix={detail.suggestedFix || undefined}
    >
      {detail.changedFiles.length > 0 && (
        <Evidence
          label={`Changed vs. origin/main (${detail.changedFiles.length})`}
          items={detail.changedFiles}
        />
      )}
      {detail.untrackedFiles.length > 0 && (
        <Evidence
          label={`Untracked (${detail.untrackedFiles.length})`}
          items={detail.untrackedFiles}
        />
      )}
      {detail.unpushedCommits.length > 0 && <CommitList commits={detail.unpushedCommits} />}
    </Block>
  );
}

function TestsBlock({ detail }: { detail: AttentionTestsDetail }) {
  const tone = detail.ok === true ? "ok" : detail.ok === false ? "fail" : "warn";
  return (
    <Block
      title="Tests"
      tone={tone}
      reason={detail.reason}
      suggestedFix={detail.suggestedFix || undefined}
    >
      {detail.scripts.length > 0 && <Evidence label="Scripts" items={detail.scripts} />}
      {detail.lastRunAt != null && (
        <div className="attn-block__meta">
          Last run {new Date(detail.lastRunAt).toLocaleString()}
        </div>
      )}
      {detail.sentinelValue && detail.sentinelValue.trim().length > 0 && detail.ok === false && (
        <details className="attn-block__details">
          <summary>Sentinel content</summary>
          <pre className="attn-block__pre">{detail.sentinelValue}</pre>
        </details>
      )}
    </Block>
  );
}

function BuildBlock({ detail }: { detail: AttentionBuildDetail }) {
  const tone = detail.ageDays != null && detail.ageDays >= 7 ? "warn" : "info";
  return (
    <Block
      title="Build"
      tone={tone}
      reason={detail.reason}
      suggestedFix={detail.suggestedFix || undefined}
    >
      {detail.scripts.length > 0 && <Evidence label="Scripts" items={detail.scripts} />}
      {detail.lastBuildAt != null && (
        <div className="attn-block__meta">
          Last build {new Date(detail.lastBuildAt).toLocaleString()}
        </div>
      )}
    </Block>
  );
}

function GitBlock({ detail }: { detail: AttentionGitDetail }) {
  const reasonParts: string[] = [];
  if (detail.dirty) reasonParts.push(`${detail.dirtyFiles.length} dirty file(s)`);
  if (detail.aheadOriginMain > 0)
    reasonParts.push(`${detail.aheadOriginMain} commit(s) ahead of origin/main`);
  if (detail.behindOriginMain > 0)
    reasonParts.push(`${detail.behindOriginMain} commit(s) behind origin/main`);
  const reason = reasonParts.join(" · ");
  return (
    <Block
      title="Working tree"
      tone="warn"
      reason={reason || "Working tree matches origin/main."}
      suggestedFix={detail.suggestedFix || undefined}
    >
      {detail.dirtyFiles.length > 0 && (
        <Evidence label={`Dirty files (${detail.dirtyFiles.length})`} items={detail.dirtyFiles} />
      )}
      {detail.unpushedCommits.length > 0 && <CommitList commits={detail.unpushedCommits} />}
    </Block>
  );
}

interface AiBlockProps {
  detail: AttentionAiDetail;
  assignState: null | "sending" | "done" | { error: string };
  onDispatch: () => void;
  kindLabel: AssignKind;
}

function AiBlock({ detail, assignState, onDispatch, kindLabel }: AiBlockProps) {
  // The AI block is the answer to "why isn't AI working on this?" — render
  // it differently from the file-based blocks so it reads as commentary,
  // not another failed check.
  const tone = detail.activeJobs.length > 0 ? "info" : detail.runtimeConfigured ? "info" : "warn";
  const buttonLabel = (() => {
    if (assignState === "sending") return "Recording…";
    if (assignState === "done") return "Recorded ✓";
    if (assignState && typeof assignState === "object") return "Retry";
    return `Record ${kindLabel} intent`;
  })();
  return (
    <div className={`attn-block attn-block--${tone}`}>
      <header className="attn-block__head">
        <span className="attn-block__dot" aria-hidden="true" />
        <h4 className="attn-block__title">
          Why AI isn't on this {detail.activeJobs.length > 0 ? "yet" : ""}
        </h4>
      </header>
      <p className="attn-block__reason">{detail.explanation}</p>
      {detail.activeJobs.length > 0 && (
        <div className="attn-block__jobs">
          <div className="attn-block__jobs-label">In flight</div>
          <ul className="attn-block__jobs-list">
            {detail.activeJobs.map((j) => (
              <li key={j.jobId} className="attn-block__jobs-row">
                <code className="attn-block__jobs-script">{j.script}</code>
                <span className="attn-block__jobs-age">started {relTime(j.startedAt)}</span>
                {j.done && <span className="attn-block__jobs-done">exit {j.exitCode}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {detail.lastAssignment && (
        <div className="attn-block__meta">
          Last assignment: <code>{detail.lastAssignment.kind}</code> at{" "}
          {new Date(detail.lastAssignment.ts).toLocaleString()}
          {detail.lastAssignment.reason ? ` — ${detail.lastAssignment.reason}` : ""}
        </div>
      )}
      <div className="attn-block__dispatch">
        <button
          type="button"
          className="attn-block__dispatch-btn"
          onClick={onDispatch}
          disabled={assignState === "sending"}
        >
          {buttonLabel}
        </button>
        <span className="attn-block__dispatch-hint">
          Appends to <code>~/.sigmashake/workspace-assignments.jsonl</code>. Doesn't spawn an agent
          — the daemon has no autonomous runtime yet, so a future cron/timer (or you) will pick this
          up.
        </span>
      </div>
      {assignState && typeof assignState === "object" && (
        <div className="attn-block__meta attn-block__meta--err">
          Couldn't record: {assignState.error}
        </div>
      )}
      {detail.manualDispatch.length > 0 && (
        <div className="attn-block__manual">
          <div className="attn-block__manual-label">Or dispatch one yourself</div>
          {detail.manualDispatch.map((cmd, i) => (
            <FixCommand key={i} command={cmd} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Evidence helpers ────────────────────────────────────────────────────

function Evidence({ label, items }: { label: string; items: string[] }) {
  return (
    <details className="attn-block__details">
      <summary className="attn-block__details-summary">{label}</summary>
      <ul className="attn-block__list">
        {items.map((it, i) => (
          <li key={i}>
            <code>{it}</code>
          </li>
        ))}
      </ul>
    </details>
  );
}

function CommitList({ commits }: { commits: AttentionCommitInfo[] }) {
  return (
    <details className="attn-block__details">
      <summary className="attn-block__details-summary">Unpushed commits ({commits.length})</summary>
      <ul className="attn-block__list">
        {commits.map((c) => (
          <li key={c.sha} className="attn-block__commit">
            <code className="attn-block__commit-sha">{c.sha.slice(0, 7)}</code>
            <span className="attn-block__commit-subject">{c.subject}</span>
            <span className="attn-block__commit-author">{c.author}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function relTime(ts: number): string {
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
