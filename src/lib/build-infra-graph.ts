// Build an InfraGraph from a set of parsed wrangler config files.
//
// The output is intentionally non-technical-friendly: every node carries a
// plain-English `label` and `hint`. Shared resources (e.g. the hub D1
// referenced by 4 workers, the shared sessions KV, the alerts tail consumer)
// are deduped into single nodes so the graph reflects actual coupling.

import type { InfraEdge, InfraGraph, InfraNode } from "../types";
import type { ParsedWrangler } from "./wrangler-parser";

export interface ProjectMeta {
  slug: string;
  description: string;
}

interface BuildOptions {
  /** Map of slug → one-line description (used as node hint). */
  projectDescriptions: Map<string, string>;
  /** Workspace root path or `/registry` placeholder. */
  root: string;
  /**
   * Stable timestamp to embed in the output. Callers pass the git HEAD
   * commit time so the generated file is deterministic across rebuilds —
   * otherwise the deploy guard (deploy-guarded.sh) sees a no-op diff
   * against origin/main on every regenerated build.
   */
  generatedAt?: number;
}

const ENG = {
  // Plain-English explanations shown in tooltips.
  worker: "Cloud service that runs your code on Cloudflare’s edge network",
  domain: "The public web address users type into a browser",
  d1: "SQL database where structured rows are stored",
  kv: "Fast key-value lookup store (small JSON-shaped data)",
  r2: "File storage — like an S3 bucket for blobs, images, archives",
  queue: "Background job queue for async work",
  durableObject: "Live coordination object — holds in-memory state and WebSockets per key",
  service: "Direct call into another internal Cloudflare Worker",
  secret: "Encrypted secret pulled from the shared Secrets Store",
  dispatch: "Workers-for-Platforms namespace that hosts dynamically-deployed tenant workers",
  analytics: "Append-only metrics datastore for telemetry events",
  cron: "Scheduled trigger that fires this worker on a CRON expression",
  assets: "Static files (HTML, CSS, JS, images) shipped with the worker",
} as const;

function workerId(slug: string): string {
  return `worker:${slug}`;
}
function d1Id(name?: string, id?: string): string {
  return `d1:${name ?? id ?? "unknown"}`;
}
function kvId(id?: string): string {
  return `kv:${id ?? "unknown"}`;
}
function r2Id(name?: string): string {
  return `r2:${name ?? "unknown"}`;
}
function queueId(name: string): string {
  return `queue:${name}`;
}
function doId(slug: string, className?: string): string {
  return `do:${slug}:${className ?? "unknown"}`;
}
function secretId(secretName?: string): string {
  return `secret:${secretName ?? "unknown"}`;
}
function dispatchId(namespace?: string): string {
  return `dispatch:${namespace ?? "unknown"}`;
}
function analyticsId(dataset?: string): string {
  return `analytics:${dataset ?? "unknown"}`;
}
function domainId(host: string): string {
  return `domain:${host}`;
}
function cronId(slug: string, expr: string): string {
  return `cron:${slug}:${expr}`;
}
function assetsId(slug: string): string {
  return `assets:${slug}`;
}

function hostFromPattern(pattern: string): string {
  // "ask.sigmashake.com/*" → "ask.sigmashake.com"
  // "*.fleet.sigmashake.com/*" → "*.fleet.sigmashake.com"
  return pattern.split("/")[0] ?? pattern;
}

function cronHint(expr: string): string {
  // Cheap human translation for the cron expressions actually used in this
  // monorepo. Falls back to the raw expression.
  if (expr === "*/5 * * * *") return "Every 5 minutes";
  if (expr === "*/10 * * * *") return "Every 10 minutes";
  if (expr === "*/15 * * * *") return "Every 15 minutes";
  if (expr === "*/30 * * * *") return "Every half hour";
  if (expr === "0 * * * *") return "Hourly, on the hour";
  if (expr === "0 0 * * *") return "Daily at midnight UTC";
  if (expr === "0 14 1 * *") return "Monthly on the 1st at 14:00 UTC";
  if (/^\d+ \d+ \* \* \*$/.test(expr))
    return `Daily at ${expr.split(" ").slice(0, 2).reverse().join(":")} UTC`;
  return `Cron: ${expr}`;
}

export function buildInfraGraph(parsed: ParsedWrangler[], opts: BuildOptions): InfraGraph {
  const nodes = new Map<string, InfraNode>();
  const edges: InfraEdge[] = [];

  function addNode(node: InfraNode) {
    const existing = nodes.get(node.id);
    if (!existing) {
      nodes.set(node.id, node);
      return;
    }
    // Merge meta keys without overwriting existing values.
    if (node.meta) {
      existing.meta = { ...node.meta, ...(existing.meta ?? {}) };
    }
    if (!existing.hint && node.hint) existing.hint = node.hint;
  }

  // Cloudflare service bindings + tail consumers reference a target by its
  // wrangler `name`, which need not equal the directory slug. Resolve names
  // back to slugs so internal links land on the right worker node.
  const nameToSlug = new Map<string, string>();
  for (const p of parsed) {
    if (p.slug && p.name) nameToSlug.set(p.name, p.slug);
  }

  // Pass 1 — workers
  for (const p of parsed) {
    const slug = p.slug;
    if (!slug) continue;
    const description = opts.projectDescriptions.get(slug) ?? "";
    addNode({
      id: workerId(slug),
      kind: "worker",
      label: slug,
      hint: description || ENG.worker,
      slug,
      meta: { name: p.name, ...(p.main ? { main: p.main } : {}) },
    });
  }

  // Pass 2 — resources + edges per worker
  for (const p of parsed) {
    const slug = p.slug;
    if (!slug) continue;
    const wid = workerId(slug);

    // Routes → domain nodes
    for (const route of p.routes) {
      const host = hostFromPattern(route.pattern);
      const id = domainId(host);
      addNode({
        id,
        kind: "domain",
        label: host,
        hint: ENG.domain,
        meta: { pattern: route.pattern, ...(route.zoneName ? { zone: route.zoneName } : {}) },
      });
      edges.push({ from: wid, to: id, kind: "route", label: route.pattern });
    }

    // D1 databases
    for (const db of p.d1) {
      const id = d1Id(db.databaseName, db.databaseId);
      addNode({
        id,
        kind: "d1",
        label: db.databaseName ?? db.binding,
        hint: ENG.d1,
        meta: {
          ...(db.databaseName ? { name: db.databaseName } : {}),
          ...(db.databaseId ? { id: db.databaseId } : {}),
        },
      });
      edges.push({ from: wid, to: id, kind: "binding", label: db.binding });
    }

    // KV namespaces — keyed by id so shared namespaces dedupe across workers.
    for (const kv of p.kv) {
      const id = kvId(kv.id);
      addNode({
        id,
        kind: "kv",
        label: friendlyKvLabel(kv.binding, kv.id),
        hint: ENG.kv,
        meta: { ...(kv.id ? { id: kv.id } : {}) },
      });
      edges.push({ from: wid, to: id, kind: "binding", label: kv.binding });
    }

    // R2 buckets
    for (const r2 of p.r2) {
      const id = r2Id(r2.bucketName);
      addNode({
        id,
        kind: "r2",
        label: r2.bucketName ?? r2.binding,
        hint: ENG.r2,
        meta: { ...(r2.bucketName ? { bucket: r2.bucketName } : {}) },
      });
      edges.push({ from: wid, to: id, kind: "binding", label: r2.binding });
    }

    // Service bindings — preferentially point at known internal worker nodes.
    for (const svc of p.services) {
      const targetSlug = nameToSlug.get(svc.service);
      if (targetSlug) {
        edges.push({
          from: wid,
          to: workerId(targetSlug),
          kind: "service",
          label: svc.binding + (svc.entrypoint ? ` (${svc.entrypoint})` : ""),
        });
      } else {
        const id = `service:${svc.service}`;
        addNode({
          id,
          kind: "service",
          label: svc.service,
          hint: ENG.service,
        });
        edges.push({ from: wid, to: id, kind: "service", label: svc.binding });
      }
    }

    // Queues — produce + consume edges. A queue node is shared between
    // producing and consuming workers.
    for (const prod of p.queueProducers) {
      const id = queueId(prod.queue);
      addNode({
        id,
        kind: "queue",
        label: prod.queue,
        hint: ENG.queue,
        meta: { name: prod.queue },
      });
      edges.push({ from: wid, to: id, kind: "queue_produces", label: prod.binding });
    }
    for (const cons of p.queueConsumers) {
      const id = queueId(cons.queue);
      addNode({
        id,
        kind: "queue",
        label: cons.queue,
        hint: ENG.queue,
        meta: { name: cons.queue },
      });
      edges.push({ from: id, to: wid, kind: "queue_consumes" });
    }

    // Durable Objects
    for (const dobj of p.durableObjects) {
      const id = doId(slug, dobj.className);
      addNode({
        id,
        kind: "durable_object",
        label: dobj.className ?? dobj.name,
        hint: ENG.durableObject,
        meta: { binding: dobj.name, ...(dobj.className ? { className: dobj.className } : {}) },
      });
      edges.push({ from: wid, to: id, kind: "owns", label: dobj.name });
    }

    // Secrets
    for (const sec of p.secrets) {
      const id = secretId(sec.secretName);
      addNode({
        id,
        kind: "secret",
        label: friendlySecretLabel(sec.secretName ?? sec.binding),
        hint: ENG.secret,
        meta: {
          ...(sec.secretName ? { name: sec.secretName } : {}),
          ...(sec.storeId ? { storeId: sec.storeId } : {}),
        },
      });
      edges.push({ from: wid, to: id, kind: "binding", label: sec.binding });
    }

    // Dispatch namespaces (Workers for Platforms)
    for (const dn of p.dispatchNamespaces) {
      const id = dispatchId(dn.namespace);
      addNode({
        id,
        kind: "dispatch_namespace",
        label: dn.namespace ?? dn.binding,
        hint: ENG.dispatch,
        meta: { ...(dn.namespace ? { namespace: dn.namespace } : {}) },
      });
      edges.push({ from: wid, to: id, kind: "owns", label: dn.binding });
    }

    // Analytics
    for (const an of p.analytics) {
      const id = analyticsId(an.dataset);
      addNode({
        id,
        kind: "analytics",
        label: an.dataset ?? an.binding,
        hint: ENG.analytics,
        meta: { ...(an.dataset ? { dataset: an.dataset } : {}) },
      });
      edges.push({ from: wid, to: id, kind: "binding", label: an.binding });
    }

    // Assets bundle
    if (p.assets?.directory) {
      const id = assetsId(slug);
      addNode({
        id,
        kind: "assets",
        label: `static (${p.assets.directory})`,
        hint: ENG.assets,
        meta: { directory: p.assets.directory },
      });
      edges.push({ from: wid, to: id, kind: "owns", label: p.assets.binding ?? "ASSETS" });
    }

    // Cron triggers
    for (const expr of p.crons) {
      const id = cronId(slug, expr);
      addNode({
        id,
        kind: "cron",
        label: cronHint(expr),
        hint: ENG.cron,
        meta: { expr },
      });
      edges.push({ from: id, to: wid, kind: "cron", label: expr });
    }

    // Tail consumers — edges to other workers (often sigmashake-alerts).
    for (const t of p.tailConsumers) {
      const targetSlug = nameToSlug.get(t.service);
      const target = targetSlug
        ? workerId(targetSlug)
        : (() => {
            const id = `service:${t.service}`;
            addNode({ id, kind: "service", label: t.service, hint: ENG.service });
            return id;
          })();
      edges.push({ from: wid, to: target, kind: "tail", label: "logs" });
    }
  }

  const nodeList = [...nodes.values()];
  // Stable sort: workers first, then by kind, then by label.
  nodeList.sort((a, b) => {
    if (a.kind === "worker" && b.kind !== "worker") return -1;
    if (b.kind === "worker" && a.kind !== "worker") return 1;
    if (a.kind !== b.kind) return a.kind.localeCompare(b.kind);
    return a.label.localeCompare(b.label);
  });
  edges.sort((a, b) => {
    if (a.from !== b.from) return a.from.localeCompare(b.from);
    if (a.to !== b.to) return a.to.localeCompare(b.to);
    return (a.label ?? "").localeCompare(b.label ?? "");
  });

  return {
    nodes: nodeList,
    edges,
    generatedAt: opts.generatedAt ?? 0,
    root: opts.root,
  };
}

function friendlyKvLabel(binding: string, id?: string): string {
  // The shared sessions namespace is the most-reused one — give it a
  // recognizable label rather than the raw id.
  if (id === "28b7cc7730d1422caeda5fe8934ce73a") return "sessions";
  return binding.toLowerCase();
}

function friendlySecretLabel(name: string): string {
  // Strip the __prod / __dev suffix wrangler uses for env-scoped secrets.
  return name.replace(/__(prod|preview|dev|staging)$/, "");
}
