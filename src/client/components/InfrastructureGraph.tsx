// InfrastructureGraph — visual map of a single worker's Cloudflare footprint.
//
// Layout: 3×3 grid with the selected worker in the center cell and resources
// clustered into 8 surrounding cells by category. An SVG overlay draws thin
// connection lines from each populated cell to the worker so the structure
// reads as a graph rather than a static directory. Designed for non-technical
// viewers — every label is plain English, mouse-over reveals a one-line hint.

import { useEffect, useMemo, useState } from "react";

import type { WorkspaceApiClient } from "../api/client";
import type {
  InfraEdge,
  InfraEdgeKind,
  InfraGraph,
  InfraNode,
  InfraNodeKind,
  ProjectCard,
} from "../api/types";

interface Props {
  card: ProjectCard;
  client: WorkspaceApiClient;
}

const CELLS: Array<{
  area: string;
  gridArea: string;
  label: string;
  blurb: string;
  kinds: InfraNodeKind[];
  position: "nw" | "n" | "ne" | "w" | "e" | "sw" | "s" | "se";
}> = [
  {
    area: "secrets",
    gridArea: "1 / 1",
    label: "Secrets",
    blurb: "Encrypted credentials this service can decrypt at runtime",
    kinds: ["secret"],
    position: "nw",
  },
  {
    area: "domains",
    gridArea: "1 / 2",
    label: "Web addresses",
    blurb: "Public URLs Cloudflare routes to this worker",
    kinds: ["domain"],
    position: "n",
  },
  {
    area: "databases",
    gridArea: "1 / 3",
    label: "Databases & metrics",
    blurb: "SQL stores (D1) and append-only metrics datastores",
    kinds: ["d1", "analytics"],
    position: "ne",
  },
  {
    area: "services",
    gridArea: "2 / 1",
    label: "Connected workers",
    blurb: "Other internal workers this service binds to directly",
    kinds: ["service"],
    position: "w",
  },
  {
    area: "storage",
    gridArea: "2 / 3",
    label: "File storage & assets",
    blurb: "R2 buckets for blobs plus bundled static files",
    kinds: ["r2", "assets"],
    position: "e",
  },
  {
    area: "queues",
    gridArea: "3 / 1",
    label: "Background work",
    blurb: "Queues + live coordination objects (Durable Objects)",
    kinds: ["queue", "durable_object"],
    position: "sw",
  },
  {
    area: "schedules",
    gridArea: "3 / 2",
    label: "Schedules & tenants",
    blurb: "Scheduled triggers and Workers-for-Platforms tenant namespaces",
    kinds: ["cron", "dispatch_namespace"],
    position: "s",
  },
  {
    area: "lookups",
    gridArea: "3 / 3",
    label: "Quick lookups",
    blurb: "KV namespaces — fast key-value reads",
    kinds: ["kv"],
    position: "se",
  },
];

const KIND_BADGE_LABEL: Record<InfraNodeKind, string> = {
  worker: "worker",
  domain: "domain",
  d1: "database",
  kv: "lookup",
  r2: "bucket",
  queue: "queue",
  durable_object: "DO",
  service: "worker",
  secret: "secret",
  dispatch_namespace: "tenant host",
  analytics: "metrics",
  cron: "schedule",
  assets: "files",
};

const EDGE_KIND_HINT: Record<InfraEdgeKind, string> = {
  route: "Public route — Cloudflare sends traffic from this address to this worker",
  binding: "Worker code can read/write this resource via a named binding",
  service: "Worker calls another worker directly",
  tail: "Forwards every log + error event to the target worker",
  queue_produces: "Worker enqueues background jobs here",
  queue_consumes: "Worker pulls jobs off this queue",
  cron: "Cloudflare wakes this worker on this schedule",
  owns: "Worker hosts this resource — it lives inside the worker",
};

interface Selection {
  node: InfraNode;
  /** Edges touching this node, oriented from the user's reading direction. */
  incoming: InfraEdge[];
  outgoing: InfraEdge[];
}

export function InfrastructureGraph({ card, client }: Props) {
  const [graph, setGraph] = useState<InfraGraph | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setSelected(null);
    client
      .listInfrastructure()
      .then((g) => {
        if (cancelled) return;
        setGraph(g);
        setLoading(false);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  const view = useMemo(() => {
    if (!graph) return null;
    return computeWorkerView(card.slug, graph);
  }, [graph, card.slug]);

  const selection = useMemo<Selection | null>(() => {
    if (!graph || !selected) return null;
    const node = graph.nodes.find((n) => n.id === selected);
    if (!node) return null;
    const incoming = graph.edges.filter((e) => e.to === selected);
    const outgoing = graph.edges.filter((e) => e.from === selected);
    return { node, incoming, outgoing };
  }, [graph, selected]);

  if (loading) {
    return (
      <div className="ig">
        <div className="ig__state">
          <p className="ig__state-title">Loading infrastructure map…</p>
          <p className="ig__state-body">
            Reading <code>wrangler.toml</code> for every project in your workspace.
          </p>
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="ig">
        <div className="ig__state ig__state--error">
          <p className="ig__state-title">Couldn’t load the infrastructure map</p>
          <pre className="ig__state-trace">{error}</pre>
        </div>
      </div>
    );
  }
  if (!graph || !view) {
    return (
      <div className="ig">
        <div className="ig__state">
          <p className="ig__state-title">No worker selected</p>
        </div>
      </div>
    );
  }
  if (!view.worker) {
    return (
      <div className="ig">
        <div className="ig__state">
          <p className="ig__state-title">
            <code>{card.slug}</code> isn’t a Cloudflare Worker
          </p>
          <p className="ig__state-body">
            This view only maps projects that have a <code>wrangler.toml</code> at their root. Bun /
            Elixir / native projects don’t live on Cloudflare.
          </p>
        </div>
      </div>
    );
  }

  const sharedCount = countSharedResources(graph, card.slug);

  return (
    <div className="ig">
      <header className="ig__header">
        <div>
          <h3 className="ig__title">Service map for {card.slug}</h3>
          <p className="ig__subtitle">
            Every Cloudflare resource this service touches. Click any chip to learn more.
          </p>
        </div>
        <div className="ig__stats">
          <Stat label="Bindings" value={view.bindingCount} />
          <Stat label="Public URLs" value={view.domainCount} />
          <Stat label="Shared with others" value={sharedCount} />
        </div>
      </header>

      <div className="ig__board">
        <Lines view={view} />
        <div className="ig__grid">
          {CELLS.map((cell) => (
            <Cell
              key={cell.area}
              cell={cell}
              nodes={view.cells.get(cell.area) ?? []}
              selectedId={selected}
              onSelect={setSelected}
              graph={graph}
              workerSlug={card.slug}
            />
          ))}
          <div className="ig__hub ig__cell--hub" data-area="hub">
            <div className="ig__hub-chip">
              <span className="ig__hub-eyebrow">Worker</span>
              <span className="ig__hub-label">{card.slug}</span>
              {view.worker.hint ? <span className="ig__hub-hint">{view.worker.hint}</span> : null}
            </div>
          </div>
        </div>
      </div>

      <Details
        selection={selection}
        graph={graph}
        workerSlug={card.slug}
        onClear={() => setSelected(null)}
      />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="ig__stat">
      <span className="ig__stat-value">{value}</span>
      <span className="ig__stat-label">{label}</span>
    </div>
  );
}

interface CellProps {
  cell: (typeof CELLS)[number];
  nodes: InfraNode[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  graph: InfraGraph;
  workerSlug: string;
}

function Cell({ cell, nodes, selectedId, onSelect, graph, workerSlug }: CellProps) {
  const empty = nodes.length === 0;
  const classes = ["ig__cell", `ig__cell--${cell.position}`, empty ? "ig__cell--empty" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} style={{ gridArea: cell.gridArea }} data-area={cell.area}>
      <div className="ig__cell-head">
        <span className="ig__cell-label">{cell.label}</span>
        <span className="ig__cell-count">{nodes.length}</span>
      </div>
      {empty ? (
        <p className="ig__cell-empty">{cell.blurb}</p>
      ) : (
        <ul className="ig__cell-list">
          {nodes.map((n) => {
            const shared = countNodeSharers(graph, n.id, workerSlug);
            const sel = n.id === selectedId;
            return (
              <li key={n.id}>
                <button
                  type="button"
                  className={
                    "ig__chip" +
                    (sel ? " ig__chip--selected" : "") +
                    (shared > 0 ? " ig__chip--shared" : "")
                  }
                  onClick={() => onSelect(sel ? null : n.id)}
                  title={n.hint ?? ""}
                >
                  <span className={`ig__chip-dot ig__chip-dot--${n.kind}`} />
                  <span className="ig__chip-label">{n.label}</span>
                  <span className="ig__chip-kind">{KIND_BADGE_LABEL[n.kind]}</span>
                  {shared > 0 ? (
                    <span
                      className="ig__chip-shared"
                      title={`Also used by ${shared} other ${shared === 1 ? "worker" : "workers"}`}
                    >
                      ↔ {shared}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Lines({ view }: { view: WorkerView }) {
  // Anchor coordinates inside the 100×100 viewBox. Worker hub is at the
  // center; each surrounding cell anchor is offset toward that cell's
  // corner/edge of the 3×3 grid.
  const HUB = { x: 50, y: 50 };
  const ANCHOR: Record<string, { x: number; y: number }> = {
    secrets: { x: 18, y: 22 },
    domains: { x: 50, y: 13 },
    databases: { x: 82, y: 22 },
    services: { x: 13, y: 50 },
    storage: { x: 87, y: 50 },
    queues: { x: 18, y: 78 },
    schedules: { x: 50, y: 87 },
    lookups: { x: 82, y: 78 },
  };
  return (
    <svg className="ig__lines" viewBox="0 0 100 100" preserveAspectRatio="none">
      <defs>
        <linearGradient id="ig-line" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(245,158,11,0.55)" />
          <stop offset="100%" stopColor="rgba(245,158,11,0)" />
        </linearGradient>
      </defs>
      {CELLS.map((cell) => {
        const populated = (view.cells.get(cell.area) ?? []).length > 0;
        if (!populated) return null;
        const a = ANCHOR[cell.area] ?? HUB;
        return (
          <line
            key={cell.area}
            x1={a.x}
            y1={a.y}
            x2={HUB.x}
            y2={HUB.y}
            stroke="url(#ig-line)"
            strokeWidth={0.4}
            strokeLinecap="round"
          />
        );
      })}
    </svg>
  );
}

interface DetailsProps {
  selection: Selection | null;
  graph: InfraGraph;
  workerSlug: string;
  onClear: () => void;
}

function Details({ selection, graph, workerSlug, onClear }: DetailsProps) {
  if (!selection) {
    return (
      <div className="ig__details ig__details--empty">
        Click a resource to see what it does and who else uses it.
      </div>
    );
  }
  const { node, incoming, outgoing } = selection;
  // Identify the "binding name" from the worker → node edge (the friendly
  // label the worker code uses, e.g. `DB`, `EMAILER`).
  const myEdge =
    outgoing.find((e) => e.from === `worker:${workerSlug}`) ??
    incoming.find((e) => e.to === `worker:${workerSlug}`);
  const sharers = collectSharers(graph, node.id, workerSlug);
  return (
    <div className="ig__details">
      <header className="ig__details-head">
        <div>
          <div className="ig__details-eyebrow">{KIND_BADGE_LABEL[node.kind]}</div>
          <h4 className="ig__details-title">{node.label}</h4>
          {node.hint ? <p className="ig__details-hint">{node.hint}</p> : null}
        </div>
        <button
          type="button"
          className="ig__details-close"
          onClick={onClear}
          aria-label="Close details"
        >
          ✕
        </button>
      </header>

      {myEdge ? (
        <p className="ig__details-binding">
          <strong>This worker calls it</strong>
          <code>{myEdge.label ?? "—"}</code>
          <span className="ig__details-binding-hint">{EDGE_KIND_HINT[myEdge.kind]}</span>
        </p>
      ) : null}

      {sharers.length > 0 ? (
        <div className="ig__details-shared">
          <div className="ig__details-shared-title">
            Also used by {sharers.length} {sharers.length === 1 ? "other worker" : "other workers"}
          </div>
          <ul className="ig__details-shared-list">
            {sharers.map((s) => (
              <li key={s}>{s.replace(/^worker:/, "")}</li>
            ))}
          </ul>
        </div>
      ) : node.kind !== "worker" ? (
        <div className="ig__details-shared">
          <div className="ig__details-shared-title">Used only by this worker</div>
        </div>
      ) : null}

      {node.meta && Object.keys(node.meta).length > 0 ? (
        <details className="ig__details-meta">
          <summary>Technical detail</summary>
          <dl>
            {Object.entries(node.meta).map(([k, v]) => (
              <div key={k} className="ig__details-meta-row">
                <dt>{k}</dt>
                <dd>{v}</dd>
              </div>
            ))}
          </dl>
        </details>
      ) : null}
    </div>
  );
}

// ── Derivation helpers ───────────────────────────────────────────────────────

interface WorkerView {
  worker: InfraNode | null;
  /** Resources grouped by cell area. */
  cells: Map<string, InfraNode[]>;
  bindingCount: number;
  domainCount: number;
}

function computeWorkerView(slug: string, graph: InfraGraph): WorkerView {
  const workerId = `worker:${slug}`;
  const worker = graph.nodes.find((n) => n.id === workerId) ?? null;
  const nodesById = new Map(graph.nodes.map((n) => [n.id, n]));
  const touching = new Set<string>();
  for (const e of graph.edges) {
    if (e.from === workerId) touching.add(e.to);
    if (e.to === workerId) touching.add(e.from);
  }
  // Don't include the worker itself in the surrounding cells.
  touching.delete(workerId);

  const cells = new Map<string, InfraNode[]>();
  for (const cell of CELLS) cells.set(cell.area, []);

  let domainCount = 0;
  for (const id of touching) {
    const node = nodesById.get(id);
    if (!node) continue;
    if (node.kind === "worker") {
      // A linked worker (service binding / tail consumer target) lives in the
      // "Connected workers" cell rather than its own cell.
      cells.get("services")?.push(node);
      continue;
    }
    if (node.kind === "domain") domainCount += 1;
    const cell = CELLS.find((c) => c.kinds.includes(node.kind));
    if (cell) cells.get(cell.area)?.push(node);
  }

  // Stable sort within each cell — pinned label first, then by label.
  for (const list of cells.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label));
  }

  return {
    worker,
    cells,
    bindingCount: touching.size,
    domainCount,
  };
}

function countNodeSharers(graph: InfraGraph, nodeId: string, excludingSlug: string): number {
  return collectSharers(graph, nodeId, excludingSlug).length;
}

function collectSharers(graph: InfraGraph, nodeId: string, excludingSlug: string): string[] {
  const exclude = `worker:${excludingSlug}`;
  const sharers = new Set<string>();
  for (const e of graph.edges) {
    if (e.from === nodeId && e.to.startsWith("worker:") && e.to !== exclude) {
      sharers.add(e.to);
    }
    if (e.to === nodeId && e.from.startsWith("worker:") && e.from !== exclude) {
      sharers.add(e.from);
    }
  }
  return [...sharers].sort();
}

function countSharedResources(graph: InfraGraph, slug: string): number {
  const workerId = `worker:${slug}`;
  const touching = new Set<string>();
  for (const e of graph.edges) {
    if (e.from === workerId) touching.add(e.to);
    if (e.to === workerId) touching.add(e.from);
  }
  let shared = 0;
  for (const id of touching) {
    if (id.startsWith("worker:")) continue;
    if (collectSharers(graph, id, slug).length > 0) shared += 1;
  }
  return shared;
}
