import { useState } from "react";

import type { ProjectCard } from "../api/types";
import {
  LINE_BADGE,
  LINE_DESCRIPTION,
  LINE_LABEL,
  type ProjectLine,
  resolveLine,
} from "../lib/project-lines";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";

interface Props {
  projects: ProjectCard[];
  selected: string | null;
  onSelect: (slug: string) => void;
  /** Operator line overrides (slug → line); seed default applies when absent. */
  overrides: Record<string, ProjectLine>;
  /** Move a project between the production / non-production lines. */
  onSetLine: (slug: string, line: ProjectLine) => void;
}

interface MenuState {
  x: number;
  y: number;
  slug: string;
}

export function ProjectGrid({ projects, selected, onSelect, overrides, onSetLine }: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null);

  if (projects.length === 0) {
    return <div className="empty">No projects.</div>;
  }
  return (
    <div className="grid">
      {projects.map((p) => {
        const line = resolveLine(p.slug, overrides);
        return (
          <div
            key={p.slug}
            className={`card${p.slug === selected ? " card--selected" : ""}`}
            onClick={() => onSelect(p.slug)}
            onContextMenu={(event) => {
              event.preventDefault();
              setMenu({ x: event.clientX, y: event.clientY, slug: p.slug });
            }}
          >
            <div className="card__head">
              <span className="card__slug">{p.slug}</span>
              <span className="card__badges">
                <span
                  className={`card__line card__line--${line}`}
                  title={LINE_DESCRIPTION[line]}
                >
                  {LINE_BADGE[line]}
                </span>
                <span className={`card__type card__type--${p.type}`}>{p.type}</span>
              </span>
            </div>
            {p.description && <div className="card__desc">{p.description}</div>}
          </div>
        );
      })}
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={buildMenuItems(menu.slug, resolveLine(menu.slug, overrides), onSelect, onSetLine)}
          onDismiss={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function buildMenuItems(
  slug: string,
  line: ProjectLine,
  onSelect: (slug: string) => void,
  onSetLine: (slug: string, line: ProjectLine) => void,
): ContextMenuItem[] {
  // Offer the move only toward the line the project isn't already on.
  const target: ProjectLine = line === "production" ? "non-production" : "production";
  return [
    {
      label: "Open project",
      onSelect: () => onSelect(slug),
    },
    {
      label: `Move to ${LINE_LABEL[target]}`,
      onSelect: () => onSetLine(slug, target),
    },
    {
      label: "Copy slug",
      shortcut: "⌘C",
      onSelect: () => {
        if (typeof navigator !== "undefined" && navigator.clipboard) {
          void navigator.clipboard.writeText(slug);
        }
      },
    },
  ];
}
