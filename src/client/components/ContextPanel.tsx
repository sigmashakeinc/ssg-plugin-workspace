import { useEffect, useState } from "react";
import type { WorkspaceApiClient } from "../api/client";
import type { ContextEntry, ContextGroup, ContextUsage, ProjectCard } from "../api/types";
import { friendlyError } from "../lib/errors";

interface Props {
  card: ProjectCard;
  client: WorkspaceApiClient;
}

const KIND_LABEL: Record<ContextEntry["kind"], string> = {
  "claude-md": "Claude",
  "agents-md": "AGENTS.md",
  "gemini-md": "Gemini",
  "cursor-rules": "Cursor",
  "copilot-instructions": "Copilot",
  skill: "Skill",
  "memory-index": "Memory index",
  "memory-page": "Memory page",
  "governance-rule": "Governance",
  other: "Other",
};

const SCOPE_LABEL: Record<ContextEntry["scope"], string> = {
  project: "Project",
  shared: "Shared",
  global: "Personal",
};

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`;
  return `${Math.round(n / 1000)}k`;
}

export function ContextPanel({ card, client }: Props) {
  const [usage, setUsage] = useState<ContextUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setUsage(null);
    (async () => {
      try {
        const res = await client.getContextUsage(card.slug);
        if (!cancelled) setUsage(res);
      } catch (err) {
        if (!cancelled) setError(friendlyError(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [card.slug, client]);

  if (error) {
    return (
      <div className="panel">
        <div className="state-card state-card--error">
          <h2 className="state-card__title">Couldn&apos;t read context</h2>
          <p className="state-card__body">{error}</p>
        </div>
      </div>
    );
  }

  if (loading || !usage) {
    return (
      <div className="panel">
        <h3 className="panel__h3">Agent context</h3>
        <p className="panel__sub">Counting the files your AI agent loads…</p>
      </div>
    );
  }

  const alwaysOnPct =
    usage.totalEstimatedTokens > 0
      ? Math.round((usage.alwaysOnTokens / usage.totalEstimatedTokens) * 100)
      : 0;

  return (
    <div className="panel ctx">
      <header className="ctx__head">
        <div className="ctx__head-row">
          <h3 className="panel__h3">Agent context</h3>
          <span className="ctx__refresh-stamp" title={new Date(usage.generatedAt).toLocaleString()}>
            measured just now
          </span>
        </div>
        <p className="panel__sub">
          Every file your AI coding agent has to read to start working in{" "}
          <strong>{card.slug}</strong>. Token estimates use chars/4 — within ~10% of
          Anthropic&apos;s tokenizer.
        </p>
      </header>

      <section className="ctx__totals">
        <div className="ctx__total-card ctx__total-card--always">
          <div className="ctx__total-label">Loaded every turn</div>
          <div className="ctx__total-value">~{fmtTokens(usage.alwaysOnTokens)} tok</div>
          <div className="ctx__total-sub">The agent reads these on every message you send.</div>
        </div>
        <div className="ctx__total-card ctx__total-card--ondemand">
          <div className="ctx__total-label">On-demand</div>
          <div className="ctx__total-value">~{fmtTokens(usage.onDemandTokens)} tok</div>
          <div className="ctx__total-sub">
            Skills + memory pages + governance — only when invoked.
          </div>
        </div>
        <div className="ctx__total-card ctx__total-card--total">
          <div className="ctx__total-label">Combined</div>
          <div className="ctx__total-value">~{fmtTokens(usage.totalEstimatedTokens)} tok</div>
          <div className="ctx__total-sub">
            {fmtBytes(usage.totalBytes)} on disk · {alwaysOnPct}% always-on
          </div>
        </div>
      </section>

      <div className="ctx__groups">
        {usage.groups.map((g) => (
          <ContextGroupCard key={g.id} group={g} />
        ))}
      </div>
    </div>
  );
}

function ContextGroupCard({ group }: { group: ContextGroup }) {
  const [open, setOpen] = useState(group.entries.length <= 6);
  if (group.entries.length === 0) {
    return (
      <details className="ctx__group ctx__group--empty">
        <summary className="ctx__group-summary">
          <span className="ctx__group-title">{group.label}</span>
          <span className="ctx__group-tokens">none</span>
        </summary>
        <p className="ctx__group-desc">{group.description}</p>
        <p className="ctx__group-empty">
          Nothing here — this group doesn&apos;t contribute any context for this project.
        </p>
      </details>
    );
  }
  return (
    <details
      className="ctx__group"
      open={open}
      onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}
    >
      <summary className="ctx__group-summary">
        <span className="ctx__group-title">{group.label}</span>
        <span className="ctx__group-meta">
          {group.entries.length} file{group.entries.length === 1 ? "" : "s"} ·{" "}
          {fmtBytes(group.totalBytes)}
        </span>
        <span className="ctx__group-tokens">~{fmtTokens(group.totalEstimatedTokens)} tok</span>
      </summary>
      <p className="ctx__group-desc">{group.description}</p>
      <table className="ctx__table">
        <thead>
          <tr>
            <th>File</th>
            <th>Kind</th>
            <th>Load</th>
            <th className="ctx__num">Size</th>
            <th className="ctx__num">Lines</th>
            <th className="ctx__num">~Tokens</th>
          </tr>
        </thead>
        <tbody>
          {group.entries.map((e) => (
            <tr key={e.path}>
              <td>
                <div className="ctx__file-label" title={e.path}>
                  {e.label}
                </div>
                <div className="ctx__file-hint">{e.hint}</div>
              </td>
              <td>
                <span className={`ctx__pill ctx__pill--${e.kind}`}>{KIND_LABEL[e.kind]}</span>
              </td>
              <td>
                <span
                  className={`ctx__load ctx__load--${e.loadMode}`}
                  title={
                    e.loadMode === "always"
                      ? "Loaded into every agent turn — counts against the running token budget."
                      : "Loaded only when the agent invokes this file."
                  }
                >
                  {e.loadMode === "always" ? "every turn" : "on demand"}
                </span>
                <div className="ctx__file-scope">{SCOPE_LABEL[e.scope]}</div>
              </td>
              <td className="ctx__num">{fmtBytes(e.bytes)}</td>
              <td className="ctx__num">{e.lines.toLocaleString()}</td>
              <td className="ctx__num">~{fmtTokens(e.estimatedTokens)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
