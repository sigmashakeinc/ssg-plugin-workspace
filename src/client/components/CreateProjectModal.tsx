// Friendly "Create a new app" modal. Picks one of four project types and
// scaffolds a starter project under the workspace root via the daemon's
// /api/json/workspace/create endpoint.

import { useEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type { CreateProjectRequest, ProjectCard } from "../api/types";

type AppType = CreateProjectRequest["type"];

interface TypeOption {
  type: AppType;
  name: string;
  hint: string;
  tech: string;
  tag?: { label: string; tone: "common" | "advanced" };
  icon: React.ReactNode;
}

const TYPE_OPTIONS: TypeOption[] = [
  {
    type: "cf-worker",
    name: "Website or web app",
    hint: "Lives on the internet — anyone with the link can open it. Good for sites, dashboards, and APIs.",
    tech: "Cloudflare Worker",
    tag: { label: "Most common", tone: "common" },
    icon: <IconCloud />,
  },
  {
    type: "bun",
    name: "Script or local app",
    hint: "Runs on your own computer. Good for automations, small tools, and quick experiments.",
    tech: "JavaScript / TypeScript",
    icon: <IconBox />,
  },
  {
    type: "elixir",
    name: "Always-on service",
    hint: "A background service that keeps running on its own. Good for bots, queues, and realtime systems.",
    tech: "Elixir",
    tag: { label: "Advanced", tone: "advanced" },
    icon: <IconBolt />,
  },
  {
    type: "native",
    name: "Native binary",
    hint: "Compiles to a fast standalone program. Rarely needed — pick this only for performance-critical tools.",
    tech: "Rust",
    tag: { label: "Advanced", tone: "advanced" },
    icon: <IconCpu />,
  },
];

interface Props {
  client: WorkspaceApiClient;
  onClose: () => void;
  onCreated: (card: ProjectCard) => void;
}

export function CreateProjectModal({ client, onClose, onCreated }: Props) {
  const [name, setName] = useState("");
  const [type, setType] = useState<AppType>("cf-worker");
  const [desc, setDesc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  // Pull naming valid kebab-slug from the friendly name field.
  const slug = useMemo(() => sluggify(name), [name]);
  const slugValid = /^[a-z][a-z0-9-]{1,63}$/.test(slug);

  // Close on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function submit() {
    if (!slugValid || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const card = await client.createProject({
        slug,
        type,
        description: desc.trim(),
      });
      onCreated(card);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        role="dialog"
        aria-labelledby="create-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <h2 className="modal__title" id="create-title">
            Create a new app
          </h2>
          <p className="modal__subtitle">
            Tell us what you want to build and we&apos;ll set up a starter folder for it. Not sure?
            &ldquo;Website or web app&rdquo; is the right pick for most things — you can change it
            later.
          </p>
        </header>

        <div className="modal__body">
          <label className="settings-field">
            <span className="settings-field__label">What kind of app?</span>
            <div className="type-picker">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.type}
                  type="button"
                  className={
                    "type-picker__card type-picker__card--" +
                    opt.type +
                    (type === opt.type ? " type-picker__card--active" : "")
                  }
                  onClick={() => setType(opt.type)}
                >
                  {opt.tag && (
                    <span className={`type-picker__badge type-picker__badge--${opt.tag.tone}`}>
                      {opt.tag.label}
                    </span>
                  )}
                  <div className="type-picker__icon">{opt.icon}</div>
                  <span className="type-picker__name">{opt.name}</span>
                  <span className="type-picker__hint">{opt.hint}</span>
                  <span className="type-picker__tech">{opt.tech}</span>
                </button>
              ))}
            </div>
          </label>

          <label className="settings-field">
            <span className="settings-field__label">What&apos;s it called?</span>
            <input
              ref={nameRef}
              type="text"
              className="settings-field__input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="todo tracker"
              spellCheck={false}
              onKeyDown={(e) => {
                if (e.key === "Enter" && slugValid) submit();
              }}
            />
            {slug && (
              <span className="slug-preview">
                Folder name → <strong>{slug}</strong>
              </span>
            )}
            <span className="settings-field__sublabel">
              Pick a friendly short name. We&apos;ll turn it into a folder name automatically
              (lowercase, hyphens — no spaces or punctuation).
            </span>
          </label>

          <label className="settings-field">
            <span className="settings-field__label">
              What does it do?{" "}
              <span style={{ fontWeight: 400, color: "var(--ss-fg-4)" }}>(optional)</span>
            </span>
            <textarea
              className="settings-field__textarea"
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              placeholder="A simple checklist that syncs across devices."
              rows={2}
            />
            <span className="settings-field__sublabel">
              You can always edit this later from the app&apos;s settings.
            </span>
          </label>

          {error && <div className="error">{error}</div>}
        </div>

        <footer className="modal__footer">
          <button type="button" className="pill-btn" onClick={onClose} disabled={submitting}>
            Cancel
          </button>
          <button
            type="button"
            className="pill-btn pill-btn--primary"
            onClick={submit}
            disabled={!slugValid || submitting}
            title={slugValid ? "Create the new app" : "Enter a friendly name to enable"}
          >
            {submitting ? "Creating…" : "Create app"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function sluggify(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

function IconCloud() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M4.5 11 H 12 A 2.5 2.5 0 0 0 12 6 A 3.5 3.5 0 0 0 5 7 A 2.5 2.5 0 0 0 4.5 11 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function IconBox() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 5 L 8 2 L 13.5 5 V 11 L 8 14 L 2.5 11 Z M 2.5 5 L 8 8 L 13.5 5 M 8 8 V 14"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function IconBolt() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M9 1.5 L 4 9 H 7.5 L 7 14.5 L 12 7 H 8.5 Z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}

function IconCpu() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect
        x="3"
        y="3"
        width="10"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.4"
        fill="none"
      />
      <rect
        x="5.5"
        y="5.5"
        width="5"
        height="5"
        stroke="currentColor"
        strokeWidth="1.2"
        fill="none"
      />
      <path
        d="M6 1.5 V 3 M 10 1.5 V 3 M 6 13 V 14.5 M 10 13 V 14.5 M 1.5 6 H 3 M 1.5 10 H 3 M 13 6 H 14.5 M 13 10 H 14.5"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}
