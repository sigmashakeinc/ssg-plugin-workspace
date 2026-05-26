import type { ProjectCard } from "../api/types";

interface Props {
  projects: ProjectCard[];
  selected: string | null;
  onSelect: (slug: string) => void;
}

export function ProjectGrid({ projects, selected, onSelect }: Props) {
  if (projects.length === 0) {
    return <div className="empty">No projects.</div>;
  }
  return (
    <div className="grid">
      {projects.map((p) => (
        <div
          key={p.slug}
          className={`card${p.slug === selected ? " card--selected" : ""}`}
          onClick={() => onSelect(p.slug)}
        >
          <div className="card__head">
            <span className="card__slug">{p.slug}</span>
            <span className={`card__type card__type--${p.type}`}>{p.type}</span>
          </div>
          {p.description && <div className="card__desc">{p.description}</div>}
        </div>
      ))}
    </div>
  );
}
