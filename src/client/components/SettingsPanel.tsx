// Workspace mode picker. Doubles as the first-run gate (when settings.onboarded
// is false the App auto-mounts this so the operator picks before seeing
// anything else) and as the always-accessible Settings dialog opened from the
// topbar gear button.
//
// Three modes (see types.ts WorkspaceMode): Stack, Services, Hybrid. Saving
// flips onboarded=true so subsequent sessions skip the gate.

import { useEffect, useMemo, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type { WorkspaceMode, WorkspaceSettings } from "../api/types";

interface ModeOption {
  mode: WorkspaceMode;
  name: string;
  hint: string;
  tag?: { label: string; tone: "common" | "advanced" };
  icon: React.ReactNode;
}

const MODE_OPTIONS: ModeOption[] = [
  {
    mode: "stack",
    name: "Manage your monorepo",
    hint: "Run scripts, inspect health, and edit configs across every project in your workspace. Best when you live in a SigmaShake-shaped codebase.",
    tag: { label: "Most common", tone: "common" },
    icon: <IconStack />,
  },
  {
    mode: "services",
    name: "Manage connected services",
    hint: "Connect SaaS accounts (Slack, Stripe, GitHub, etc.) and run actions on them — no terminal needed. Connectors ship next.",
    icon: <IconPlug />,
  },
  {
    mode: "hybrid",
    name: "Show both",
    hint: "Side-by-side: your monorepo on the left, connected services below. Pick this if you want everything in one console.",
    tag: { label: "Power user", tone: "advanced" },
    icon: <IconCombined />,
  },
];

interface Props {
  client: WorkspaceApiClient;
  settings: WorkspaceSettings;
  /** True for the first-run gate — hides Cancel so the user must commit. */
  forceChoice: boolean;
  onClose: () => void;
  onSaved: (next: WorkspaceSettings) => void;
}

export function SettingsPanel({ client, settings, forceChoice, onClose, onSaved }: Props) {
  const [mode, setMode] = useState<WorkspaceMode>(settings.mode);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const dirty = mode !== settings.mode || !settings.onboarded;

  useEffect(() => {
    if (forceChoice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, forceChoice]);

  async function save() {
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const next = await client.setSettings({ mode, onboarded: true });
      onSaved(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  const titleId = useMemo(() => `settings-title-${Math.random().toString(36).slice(2, 8)}`, []);

  return (
    <div className="modal-backdrop" onClick={forceChoice ? undefined : onClose}>
      <div
        className="modal"
        role="dialog"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <h2 className="modal__title" id={titleId}>
            {forceChoice ? "Welcome to Workspace" : "Workspace mode"}
          </h2>
          <p className="modal__subtitle">
            {forceChoice
              ? "Pick how you want to use Workspace. You can change this any time from the gear icon in the top bar."
              : "Switch what Workspace shows you. The other rails will reappear when you switch back."}
          </p>
        </header>

        <div className="modal__body">
          <div className="settings-field">
            <span className="settings-field__label">What do you want to manage?</span>
            <div className="type-picker">
              {MODE_OPTIONS.map((opt) => (
                <button
                  key={opt.mode}
                  type="button"
                  className={
                    "type-picker__card type-picker__card--" +
                    opt.mode +
                    (mode === opt.mode ? " type-picker__card--active" : "")
                  }
                  onClick={() => setMode(opt.mode)}
                >
                  {opt.tag && (
                    <span className={`type-picker__badge type-picker__badge--${opt.tag.tone}`}>
                      {opt.tag.label}
                    </span>
                  )}
                  <div className="type-picker__icon">{opt.icon}</div>
                  <span className="type-picker__name">{opt.name}</span>
                  <span className="type-picker__hint">{opt.hint}</span>
                </button>
              ))}
            </div>
          </div>

          {error && <div className="error">{error}</div>}
        </div>

        <footer className="modal__footer">
          {!forceChoice && (
            <button type="button" className="pill-btn" onClick={onClose} disabled={submitting}>
              Cancel
            </button>
          )}
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            onClick={save}
            disabled={(!dirty && !forceChoice) || submitting}
            title={
              forceChoice
                ? "Save your choice and continue"
                : dirty
                  ? "Save mode change"
                  : "No changes"
            }
          >
            {submitting ? "Saving…" : forceChoice ? "Continue" : "Save"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function IconStack() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="3" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
      <rect x="3" y="13" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="13" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function IconPlug() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M9 3v5M15 3v5M6 8h12v3a6 6 0 0 1-12 0V8zM12 17v4"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function IconCombined() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="3" width="8" height="18" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
      <rect x="13" y="3" width="8" height="8" rx="1.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="M13 15h8M13 18h8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
