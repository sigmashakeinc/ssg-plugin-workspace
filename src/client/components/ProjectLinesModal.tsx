// Bulk editor for the production / non-production split. Lists every project,
// shows where it sits today (seeded default or an operator override), and lets
// the operator multi-select rows and reassign them in one shot.
//
// Every project is auto-categorized out of the box (see lib/project-lines.ts),
// so this modal is purely for adjusting that default — selecting nothing and
// closing changes nothing.

import { useEffect, useMemo, useState } from "react";

import type { ProjectCard } from "../api/types";
import {
  defaultLine,
  LINE_DESCRIPTION,
  LINE_LABEL,
  type ProjectLine,
  resolveLine,
} from "../lib/project-lines";

interface Props {
  projects: ProjectCard[];
  overrides: Record<string, ProjectLine>;
  /** Assign a batch of slugs to lines (one persisted write). */
  onApply: (updates: Record<string, ProjectLine>) => void;
  /** Drop every override so the whole tree falls back to the auto-categorization. */
  onResetAll: () => void;
  onClose: () => void;
}

const LINES: readonly ProjectLine[] = ["production", "non-production"];

export function ProjectLinesModal({ projects, overrides, onApply, onResetAll, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");

  // Close on Escape — matches CreateProjectModal / SettingsPanel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const rows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return projects
      .filter((p) => !needle || p.slug.toLowerCase().includes(needle))
      .map((p) => {
        const line = resolveLine(p.slug, overrides);
        return { slug: p.slug, type: p.type, line, overridden: line !== defaultLine(p.slug) };
      })
      .sort((a, b) => a.slug.localeCompare(b.slug));
  }, [projects, overrides, filter]);

  const overrideCount = useMemo(
    () => projects.filter((p) => resolveLine(p.slug, overrides) !== defaultLine(p.slug)).length,
    [projects, overrides],
  );

  const visibleSlugs = useMemo(() => rows.map((r) => r.slug), [rows]);
  const allVisibleSelected = visibleSlugs.length > 0 && visibleSlugs.every((s) => selected.has(s));

  function toggle(slug: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(slug)) next.delete(slug);
      else next.add(slug);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((cur) => {
      const next = new Set(cur);
      if (allVisibleSelected) {
        for (const s of visibleSlugs) next.delete(s);
      } else {
        for (const s of visibleSlugs) next.add(s);
      }
      return next;
    });
  }

  // Bulk-assign every selected slug to `line` (or back to its seed default).
  function assignSelected(line: ProjectLine | "default") {
    if (selected.size === 0) return;
    const updates: Record<string, ProjectLine> = {};
    for (const slug of selected) {
      updates[slug] = line === "default" ? defaultLine(slug) : line;
    }
    onApply(updates);
    setSelected(new Set());
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal modal--wide"
        role="dialog"
        aria-labelledby="lines-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="modal__head">
          <h2 className="modal__title" id="lines-title">
            Organize projects
          </h2>
          <p className="modal__subtitle">
            Every service is already sorted into <strong>Production</strong> (the SigmaShake
            governance platform) or <strong>Non-production</strong> (the OBS / Twitch streaming op).
            Tick any you want to move, then reassign them — or leave it as-is, it&apos;s done for
            you.
          </p>
        </header>

        <div className="modal__body">
          <div className="lines-toolbar">
            <input
              type="search"
              className="lines-toolbar__search"
              placeholder="Filter projects…"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <button
              type="button"
              className="pill-btn pill-btn--ghost"
              onClick={toggleAllVisible}
              disabled={visibleSlugs.length === 0}
            >
              {allVisibleSelected ? "Select none" : "Select all"}
            </button>
          </div>

          <div className="lines-list" role="list">
            {rows.length === 0 && <div className="empty">No projects match.</div>}
            {rows.map((r) => (
              <label key={r.slug} className="lines-row" role="listitem">
                <input
                  type="checkbox"
                  className="lines-row__check"
                  checked={selected.has(r.slug)}
                  onChange={() => toggle(r.slug)}
                />
                <span className="lines-row__slug">{r.slug}</span>
                {r.overridden && (
                  <span className="lines-row__edited" title="Manually moved off the auto default">
                    edited
                  </span>
                )}
                <span className={`card__type card__type--${r.type}`}>{r.type}</span>
                <span
                  className="lines-row__toggle"
                  role="group"
                  aria-label={`Line for ${r.slug}`}
                >
                  {LINES.map((line) => (
                    <button
                      key={line}
                      type="button"
                      className={`lines-seg lines-seg--${line}${r.line === line ? " lines-seg--active" : ""}`}
                      aria-pressed={r.line === line}
                      title={LINE_DESCRIPTION[line]}
                      onClick={() => onApply({ [r.slug]: line })}
                    >
                      {LINE_LABEL[line]}
                    </button>
                  ))}
                </span>
              </label>
            ))}
          </div>
        </div>

        <footer className="modal__footer lines-footer">
          <div className="lines-footer__status">
            {selected.size > 0 ? (
              <span>
                {selected.size} selected
              </span>
            ) : overrideCount > 0 ? (
              <span>
                {overrideCount} moved off auto ·{" "}
                <button type="button" className="lines-link" onClick={onResetAll}>
                  Reset all to auto
                </button>
              </span>
            ) : (
              <span className="lines-footer__hint">All on the auto-categorization.</span>
            )}
          </div>
          <div className="lines-footer__actions">
            <button
              type="button"
              className="pill-btn"
              onClick={() => assignSelected("production")}
              disabled={selected.size === 0}
            >
              → Production
            </button>
            <button
              type="button"
              className="pill-btn"
              onClick={() => assignSelected("non-production")}
              disabled={selected.size === 0}
            >
              → Non-production
            </button>
            <button
              type="button"
              className="pill-btn pill-btn--ghost"
              onClick={() => assignSelected("default")}
              disabled={selected.size === 0}
              title="Send the selected projects back to their auto-categorized default"
            >
              Reset to auto
            </button>
            <button type="button" className="pill-btn pill-btn--primary" onClick={onClose}>
              Done
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
