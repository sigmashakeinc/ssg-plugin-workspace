// Monorepo-wide service map — every project in the workspace on one screen,
// laid out left-to-right like a CI/CD pipeline so non-technical readers can
// trace a request from public domain → web service → internal service →
// local app → shared data without leaving the page.
//
// Inputs are the same two sources the rest of the workspace already exposes:
//   - InfraGraph (every Cloudflare worker + the resources it touches)
//   - ProjectCard[] (every directory in the monorepo, including local-only
//     Bun / Elixir / native projects that don't live on Cloudflare)
//
// The component derives column lanes, draws bezier edges between connected
// nodes, and highlights direct neighbours on hover/focus. No live health is
// fetched here — that lives in the Distribution view; this is the topology
// "10,000 ft" view.
//
// Visual language matches the SSG dashboard glass aesthetic so it feels like
// part of the same product, not a bolted-on diagram tool.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type {
  InfraEdgeKind,
  InfraGraph,
  InfraNode,
  InfraNodeKind,
  ProjectCard,
  ProjectType,
} from "../api/types";
import { friendlyError } from "../lib/errors";
import { withTimeout } from "../lib/with-timeout";
import { CloudGate } from "./CloudGate";
import { ProgressStrip } from "./ProgressStrip";

interface Props {
  client: WorkspaceApiClient | null;
  projects: ProjectCard[];
  onSelectProject: (slug: string) => void;
}

type LaneId = "public" | "edge" | "internal" | "local" | "data";

interface Lane {
  id: LaneId;
  label: string;
  blurb: string;
}

const LANES: Lane[] = [
  {
    id: "public",
    label: "Public web addresses",
    blurb: "URLs users type into a browser",
  },
  {
    id: "edge",
    label: "Web services",
    blurb: "Cloud apps that answer public requests",
  },
  {
    id: "internal",
    label: "Internal services",
    blurb: "Cloud helpers other services call",
  },
  {
    id: "local",
    label: "Local apps",
    blurb: "Programs that run on your computer",
  },
  {
    id: "data",
    label: "Shared data & storage",
    blurb: "Databases, files, queues, schedules",
  },
];

/** Stable ids for non-Cloudflare project cards. */
function projectCardId(slug: string): string {
  return `project:${slug}`;
}

interface MapNode {
  id: string;
  lane: LaneId;
  label: string;
  /** Short kind/category label shown above the title. */
  eyebrow: string;
  /** One-line description shown under the title. */
  hint?: string;
  /** Source data the node was derived from. */
  source: "infra" | "project";
  /** True for clickable project nodes (drills into ProjectDetail). */
  projectSlug?: string;
  /** Connection count — drives card density. */
  degree: number;
}

interface MapEdge {
  from: string;
  to: string;
  kind: InfraEdgeKind;
}

interface DerivedMap {
  /** Node lookup by id. */
  nodes: Map<string, MapNode>;
  /** Edges (deduped, deterministic). */
  edges: MapEdge[];
  /** Nodes grouped by lane in display order. */
  lanes: Map<LaneId, MapNode[]>;
  /** Reverse index: node id → ids that share an edge with it. */
  neighbours: Map<string, Set<string>>;
}

const EDGE_DESCRIPTION: Record<InfraEdgeKind, string> = {
  route: "Public traffic",
  binding: "Reads & writes",
  service: "Calls into",
  tail: "Forwards logs",
  queue_produces: "Enqueues work",
  queue_consumes: "Pulls work from",
  cron: "Runs on schedule",
  owns: "Hosts",
};

const KIND_EYEBROW: Record<InfraNodeKind, string> = {
  worker: "Cloud service",
  domain: "Web address",
  d1: "Database",
  kv: "Lookup store",
  r2: "File storage",
  queue: "Queue",
  durable_object: "Live object",
  service: "Cloud service",
  secret: "Secret",
  dispatch_namespace: "Tenant host",
  analytics: "Metrics",
  cron: "Schedule",
  assets: "Static files",
};

const PROJECT_TYPE_EYEBROW: Record<ProjectType, string> = {
  "cf-worker": "Cloud service",
  bun: "Local app",
  elixir: "Local service",
  native: "Native app",
  unknown: "Project",
};

export function MonorepoMap({ client, projects, onSelectProject }: Props) {
  const [graph, setGraph] = useState<InfraGraph | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [enabledLanes, setEnabledLanes] = useState<Set<LaneId>>(
    () => new Set(LANES.map((l) => l.id)),
  );

  // The infrastructure graph leaks every internal worker name + binding id,
  // so the cloud Worker doesn't serve it. Surface the same gate the other
  // local-only features use rather than rendering an empty state.
  const localOnly = !!client && !client.hasLocalCapabilities;

  const loadGraph = useCallback(() => {
    if (!client || localOnly) return () => {};
    let cancelled = false;
    setLoading(true);
    setError(null);
    withTimeout(client.listInfrastructure(), "Service map build")
      .then((g) => {
        if (!cancelled) {
          setGraph(g);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setError(friendlyError(e));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [client, localOnly]);

  useEffect(() => loadGraph(), [loadGraph]);

  const derived = useMemo<DerivedMap | null>(() => {
    if (!graph) return null;
    return deriveMap(graph, projects);
  }, [graph, projects]);

  // Filtered view — strict text + lane filter. Selected node detail still
  // uses the unfiltered `derived` so neighbour lists never disappear when the
  // user types a more aggressive query.
  const filteredDerived = useMemo<DerivedMap | null>(() => {
    if (!derived) return null;
    return filterMap(derived, search, enabledLanes);
  }, [derived, search, enabledLanes]);

  const active = hovered ?? selected;
  const activeNeighbours = active ? derived?.neighbours.get(active) : null;

  const handleSelect = useCallback((id: string | null) => {
    setSelected((cur) => (cur === id ? null : id));
  }, []);

  const toggleLane = useCallback((id: LaneId) => {
    setEnabledLanes((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      // Never let the user filter everything off — at least one lane stays on.
      if (next.size === 0) return cur;
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSearch("");
    setEnabledLanes(new Set(LANES.map((l) => l.id)));
  }, []);

  if (localOnly) {
    return (
      <div className="mmap mmap--gate">
        <h3 className="panel__h3">Service map</h3>
        <CloudGate feature="Service map" />
      </div>
    );
  }

  if (loading) {
    // Skeleton seeded from the already-loaded project list so the operator
    // sees the *right* number of placeholder cards instead of a generic
    // "Loading…" line. Falls back to 12 if projects haven't loaded yet.
    const expected = Math.min(Math.max(projects.length, 6), 24);
    return (
      <div className="mmap mmap--full mmap--loading">
        <header className="mmap__toolbar">
          <div className="mmap__toolbar-row">
            <div className="mmap__toolbar-title">
              <h3 className="mmap__title">Service map</h3>
              <span className="mmap__toolbar-count">Mapping {projects.length || "…"} projects</span>
            </div>
          </div>
          <ProgressStrip loading label="Building the service map" />
        </header>
        <div className="mmap__skeleton-grid">
          {Array.from({ length: expected }).map((_, i) => (
            <div key={i} className="mmap__skeleton-card" />
          ))}
        </div>
      </div>
    );
  }

  if (error || !derived) {
    return (
      <div className="mmap mmap--gate">
        <div className="state-card state-card--error">
          <h2 className="state-card__title">Couldn&apos;t build the service map</h2>
          <p className="state-card__body">{error ?? "No data."}</p>
          <button type="button" className="pill-btn pill-btn--primary" onClick={loadGraph}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  const selectedNode = selected ? (derived.nodes.get(selected) ?? null) : null;
  const totalNodes = derived.nodes.size;
  const shownNodes = filteredDerived?.nodes.size ?? 0;
  const filterActive = search.trim().length > 0 || enabledLanes.size !== LANES.length;

  return (
    <div className="mmap mmap--full">
      <header className="mmap__toolbar">
        <div className="mmap__toolbar-row">
          <div className="mmap__toolbar-title">
            <h3 className="mmap__title">Service map</h3>
            <span className="mmap__toolbar-count">
              {filterActive ? `${shownNodes} / ${totalNodes}` : totalNodes} shown
            </span>
          </div>
          <div className="mmap__search-wrap">
            <input
              type="search"
              className="mmap__search"
              placeholder="Search projects, services, or shared resources…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              aria-label="Search the service map"
            />
            {filterActive ? (
              <button
                type="button"
                className="mmap__search-clear"
                onClick={clearFilters}
                aria-label="Clear search and filters"
              >
                Clear
              </button>
            ) : null}
          </div>
        </div>
        <div className="mmap__chips" role="group" aria-label="Filter by lane">
          {LANES.map((lane) => {
            const on = enabledLanes.has(lane.id);
            return (
              <button
                key={lane.id}
                type="button"
                className={
                  `mmap__chip mmap__chip--${lane.id}` +
                  (on ? " mmap__chip--on" : " mmap__chip--off")
                }
                onClick={() => toggleLane(lane.id)}
                aria-pressed={on}
              >
                <span className={`mmap__chip-dot mmap__chip-dot--${lane.id}`} />
                <span className="mmap__chip-label">{lane.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {selectedNode ? (
        <NodeDetail
          node={selectedNode}
          derived={derived}
          onClear={() => setSelected(null)}
          onOpenProject={onSelectProject}
          onSelectNode={handleSelect}
        />
      ) : null}

      <MapBoard
        derived={filteredDerived ?? derived}
        active={active}
        activeNeighbours={activeNeighbours ?? null}
        selected={selected}
        onSelect={handleSelect}
        onHover={setHovered}
        emptyHint={
          filterActive
            ? "Nothing matches that search. Try fewer letters or re-enable a lane above."
            : "Click any card to see what it does, who it talks to, and jump straight into its workspace page."
        }
      />
    </div>
  );
}

// ── Layout ───────────────────────────────────────────────────────────────────

interface BoardProps {
  derived: DerivedMap;
  active: string | null;
  activeNeighbours: Set<string> | null;
  selected: string | null;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  emptyHint: string;
}

function MapBoard({
  derived,
  active,
  activeNeighbours,
  selected,
  onSelect,
  onHover,
  emptyHint,
}: BoardProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const nodeRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [paths, setPaths] = useState<
    Array<{ d: string; id: string; from: string; to: string; emphasis: boolean }>
  >([]);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const base = wrap.getBoundingClientRect();
    const next: Array<{
      d: string;
      id: string;
      from: string;
      to: string;
      emphasis: boolean;
    }> = [];
    for (let i = 0; i < derived.edges.length; i++) {
      const edge = derived.edges[i]!;
      const fromEl = nodeRefs.current.get(edge.from);
      const toEl = nodeRefs.current.get(edge.to);
      if (!fromEl || !toEl) continue;
      const a = fromEl.getBoundingClientRect();
      const b = toEl.getBoundingClientRect();
      const x1 = a.right - base.left;
      const y1 = a.top - base.top + a.height / 2;
      const x2 = b.left - base.left;
      const y2 = b.top - base.top + b.height / 2;
      // Bezier control points sit one third of the way between the two cards
      // so curves rise/fall gently rather than looping.
      const dx = Math.max(40, (x2 - x1) * 0.45);
      const emphasis = !!active && (edge.from === active || edge.to === active);
      next.push({
        id: `e${i}`,
        from: edge.from,
        to: edge.to,
        emphasis,
        d: `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`,
      });
    }
    setPaths(next);
  }, [derived, active]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // Re-measure once after fonts settle (cards may reflow once after the
  // first paint, especially in the cloud runtime where no font is preloaded).
  useEffect(() => {
    const id = window.setTimeout(measure, 80);
    return () => window.clearTimeout(id);
  }, [measure]);

  // Re-measure whenever a lane scrolls so edges follow the cards.
  const onLaneScroll = useCallback(() => {
    measure();
  }, [measure]);

  const empty = derived.nodes.size === 0;

  return (
    <div className="mmap__board" ref={wrapRef}>
      {empty ? <div className="mmap__empty">{emptyHint}</div> : null}
      <svg className="mmap__edges" aria-hidden="true">
        {paths.map((p) => {
          const dimmed =
            !!active &&
            !p.emphasis &&
            !(activeNeighbours && (activeNeighbours.has(p.from) || activeNeighbours.has(p.to)));
          return (
            <path
              key={p.id}
              d={p.d}
              className={
                "mmap-edge" +
                (p.emphasis ? " mmap-edge--active" : "") +
                (dimmed ? " mmap-edge--dim" : "")
              }
              fill="none"
            />
          );
        })}
      </svg>
      <div className="mmap__lanes">
        {LANES.map((lane) => {
          const nodes = derived.lanes.get(lane.id) ?? [];
          return (
            <section className="mmap__lane" key={lane.id} data-lane={lane.id}>
              <header className="mmap__lane-head">
                <span className="mmap__lane-label">{lane.label}</span>
                <span className="mmap__lane-count">{nodes.length}</span>
              </header>
              <p className="mmap__lane-blurb">{lane.blurb}</p>
              <ul className="mmap__lane-list" onScroll={onLaneScroll}>
                {nodes.map((node) => {
                  const isActive = active === node.id;
                  const isNeighbour =
                    !isActive && !!activeNeighbours && activeNeighbours.has(node.id);
                  const dimmed = !!active && !isActive && !isNeighbour;
                  return (
                    <li key={node.id}>
                      <button
                        ref={(el) => {
                          if (el) nodeRefs.current.set(node.id, el);
                          else nodeRefs.current.delete(node.id);
                        }}
                        type="button"
                        className={
                          "mmap-node" +
                          ` mmap-node--${node.lane}` +
                          (selected === node.id ? " mmap-node--selected" : "") +
                          (isActive ? " mmap-node--active" : "") +
                          (isNeighbour ? " mmap-node--neighbour" : "") +
                          (dimmed ? " mmap-node--dim" : "")
                        }
                        onClick={() => onSelect(node.id)}
                        onMouseEnter={() => onHover(node.id)}
                        onMouseLeave={() => onHover(null)}
                        onFocus={() => onHover(node.id)}
                        onBlur={() => onHover(null)}
                      >
                        <span className="mmap-node__eyebrow">{node.eyebrow}</span>
                        <span className="mmap-node__label">{node.label}</span>
                        {node.hint ? <span className="mmap-node__hint">{node.hint}</span> : null}
                        {node.degree > 0 ? (
                          <span className="mmap-node__degree" aria-hidden="true">
                            {node.degree}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
                {nodes.length === 0 ? <li className="mmap__lane-empty">Nothing here.</li> : null}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

// ── Detail panel ─────────────────────────────────────────────────────────────

interface DetailProps {
  node: MapNode;
  derived: DerivedMap;
  onClear: () => void;
  onOpenProject: (slug: string) => void;
  onSelectNode: (id: string) => void;
}

function NodeDetail({ node, derived, onClear, onOpenProject, onSelectNode }: DetailProps) {
  const neighbourIds = [...(derived.neighbours.get(node.id) ?? [])];
  const upstream: MapNode[] = [];
  const downstream: MapNode[] = [];
  const incoming = new Set<string>();
  const outgoing = new Set<string>();
  for (const edge of derived.edges) {
    if (edge.to === node.id) incoming.add(edge.from);
    if (edge.from === node.id) outgoing.add(edge.to);
  }
  for (const id of neighbourIds) {
    const n = derived.nodes.get(id);
    if (!n) continue;
    if (outgoing.has(id) && !incoming.has(id)) downstream.push(n);
    else if (incoming.has(id) && !outgoing.has(id)) upstream.push(n);
    else if (outgoing.has(id) && incoming.has(id)) {
      upstream.push(n);
      downstream.push(n);
    }
  }
  upstream.sort((a, b) => a.label.localeCompare(b.label));
  downstream.sort((a, b) => a.label.localeCompare(b.label));

  return (
    <div className={`mmap__detail mmap__detail--${node.lane}`}>
      <header className="mmap__detail-head">
        <div>
          <div className="mmap__detail-eyebrow">{node.eyebrow}</div>
          <h4 className="mmap__detail-title">{node.label}</h4>
          {node.hint ? <p className="mmap__detail-body">{node.hint}</p> : null}
        </div>
        <div className="mmap__detail-actions">
          {node.projectSlug ? (
            <button
              type="button"
              className="pill-btn pill-btn--primary"
              onClick={() => onOpenProject(node.projectSlug!)}
            >
              Open {node.projectSlug}
            </button>
          ) : null}
          <button type="button" className="pill-btn" onClick={onClear} aria-label="Close details">
            Close
          </button>
        </div>
      </header>

      <div className="mmap__detail-grid">
        <NeighbourBlock
          title="Incoming"
          empty="Nothing depends on this."
          nodes={upstream}
          onPick={onSelectNode}
        />
        <NeighbourBlock
          title="Outgoing"
          empty="This doesn’t talk to anything else."
          nodes={downstream}
          onPick={onSelectNode}
        />
      </div>
    </div>
  );
}

function NeighbourBlock({
  title,
  empty,
  nodes,
  onPick,
}: {
  title: string;
  empty: string;
  nodes: MapNode[];
  onPick: (id: string) => void;
}) {
  return (
    <div className="mmap__detail-block">
      <span className="mmap__detail-block-title">{title}</span>
      {nodes.length === 0 ? (
        <p className="mmap__detail-empty">{empty}</p>
      ) : (
        <ul className="mmap__detail-list">
          {nodes.map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={`mmap__detail-chip mmap__detail-chip--${n.lane}`}
                onClick={() => onPick(n.id)}
              >
                <span className="mmap__detail-chip-eyebrow">{n.eyebrow}</span>
                <span className="mmap__detail-chip-label">{n.label}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ── Derivation ───────────────────────────────────────────────────────────────

function deriveMap(graph: InfraGraph, projects: ProjectCard[]): DerivedMap {
  const nodes = new Map<string, MapNode>();
  const edges: MapEdge[] = [];
  const projectBySlug = new Map(projects.map((p) => [p.slug, p]));

  // Pass 1 — every Cloudflare worker becomes a node in the appropriate cloud
  // lane (edge if it owns a public route, internal otherwise).
  const workersWithRoutes = new Set<string>();
  for (const e of graph.edges) {
    if (e.kind === "route" && e.from.startsWith("worker:")) {
      workersWithRoutes.add(e.from);
    }
  }
  for (const node of graph.nodes) {
    if (node.kind !== "worker") continue;
    const lane: LaneId = workersWithRoutes.has(node.id) ? "edge" : "internal";
    const slug = node.slug ?? node.id.replace(/^worker:/, "");
    const card = projectBySlug.get(slug);
    nodes.set(node.id, {
      id: node.id,
      lane,
      label: slug,
      eyebrow: lane === "edge" ? "Web service" : "Internal service",
      hint: card?.description ?? node.hint,
      source: "infra",
      projectSlug: slug,
      degree: 0,
    });
  }

  // Pass 2 — public domain nodes.
  for (const node of graph.nodes) {
    if (node.kind !== "domain") continue;
    nodes.set(node.id, {
      id: node.id,
      lane: "public",
      label: node.label,
      eyebrow: KIND_EYEBROW.domain,
      hint: undefined,
      source: "infra",
      degree: 0,
    });
  }

  // Pass 3 — shared data / background nodes (everything cloud-side that isn't
  // a worker or domain ends up in the data lane).
  for (const node of graph.nodes) {
    if (node.kind === "worker" || node.kind === "domain") continue;
    if (node.kind === "secret" || node.kind === "assets") continue;
    nodes.set(node.id, {
      id: node.id,
      lane: "data",
      label: friendlyDataLabel(node),
      eyebrow: KIND_EYEBROW[node.kind] ?? "Resource",
      hint: node.hint,
      source: "infra",
      degree: 0,
    });
  }

  // Pass 4 — non-Cloudflare projects (bun / elixir / native / unknown). These
  // don't appear in the InfraGraph but are part of the monorepo.
  for (const project of projects) {
    if (project.type === "cf-worker") continue;
    const id = projectCardId(project.slug);
    nodes.set(id, {
      id,
      lane: "local",
      label: project.slug,
      eyebrow: PROJECT_TYPE_EYEBROW[project.type],
      hint: shortenDescription(project.description),
      source: "project",
      projectSlug: project.slug,
      degree: 0,
    });
  }

  // Edges — keep only the ones that connect nodes we actually render, so we
  // don't draw lines to missing endpoints (e.g. secrets / assets we filtered
  // out above).
  for (const e of graph.edges) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue;
    edges.push({ from: e.from, to: e.to, kind: e.kind });
  }

  // Degree + neighbours.
  const neighbours = new Map<string, Set<string>>();
  for (const n of nodes.values()) neighbours.set(n.id, new Set());
  for (const e of edges) {
    neighbours.get(e.from)?.add(e.to);
    neighbours.get(e.to)?.add(e.from);
  }
  for (const [id, set] of neighbours) {
    const n = nodes.get(id);
    if (n) n.degree = set.size;
  }

  // Group into lanes — sort by degree (most-connected first) so the visually
  // important nodes anchor near the top of each column.
  const lanes = new Map<LaneId, MapNode[]>();
  for (const lane of LANES) lanes.set(lane.id, []);
  for (const node of nodes.values()) {
    lanes.get(node.lane)?.push(node);
  }
  for (const list of lanes.values()) {
    list.sort((a, b) => {
      if (b.degree !== a.degree) return b.degree - a.degree;
      return a.label.localeCompare(b.label);
    });
  }

  return { nodes, edges, lanes, neighbours };
}

function filterMap(derived: DerivedMap, search: string, enabledLanes: Set<LaneId>): DerivedMap {
  const term = search.trim().toLowerCase();
  const noFilters = !term && enabledLanes.size === LANES.length;
  if (noFilters) return derived;

  const matched = new Set<string>();
  for (const node of derived.nodes.values()) {
    if (!enabledLanes.has(node.lane)) continue;
    if (!term) {
      matched.add(node.id);
      continue;
    }
    const hay =
      node.label.toLowerCase() +
      " " +
      node.eyebrow.toLowerCase() +
      " " +
      (node.hint?.toLowerCase() ?? "") +
      " " +
      (node.projectSlug?.toLowerCase() ?? "");
    if (hay.includes(term)) matched.add(node.id);
  }

  const nodes = new Map<string, MapNode>();
  for (const id of matched) {
    const n = derived.nodes.get(id);
    if (n) nodes.set(id, n);
  }
  const edges = derived.edges.filter((e) => matched.has(e.from) && matched.has(e.to));
  const lanes = new Map<LaneId, MapNode[]>();
  for (const lane of LANES) lanes.set(lane.id, []);
  for (const n of nodes.values()) lanes.get(n.lane)?.push(n);
  for (const list of lanes.values()) {
    list.sort((a, b) => {
      if (b.degree !== a.degree) return b.degree - a.degree;
      return a.label.localeCompare(b.label);
    });
  }
  const neighbours = new Map<string, Set<string>>();
  for (const n of nodes.values()) neighbours.set(n.id, new Set());
  for (const e of edges) {
    neighbours.get(e.from)?.add(e.to);
    neighbours.get(e.to)?.add(e.from);
  }
  return { nodes, edges, lanes, neighbours };
}

function friendlyDataLabel(node: InfraNode): string {
  if (node.kind === "d1" || node.kind === "r2" || node.kind === "queue") {
    return node.label.replace(/^sigmashake-/, "");
  }
  return node.label;
}

function shortenDescription(d: string): string {
  if (!d) return "";
  const firstStop = d.search(/[.;–—(]/);
  const head = firstStop > 30 ? d.slice(0, firstStop) : d;
  return head.length > 90 ? `${head.slice(0, 87).trimEnd()}…` : head;
}

// Silence unused-warning for the edge legend until we surface it.
void EDGE_DESCRIPTION;
