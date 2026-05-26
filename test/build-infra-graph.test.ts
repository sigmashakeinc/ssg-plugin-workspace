// Unit coverage for the InfraGraph builder. Verifies node dedup across
// workers, edge polarity (route/binding/service/queue_produces/queue_consumes/
// cron/tail/owns), friendly label heuristics, and stable sort order.

import { describe, expect, it } from "vitest";

import { buildInfraGraph } from "../src/lib/build-infra-graph";
import type { ParsedWrangler } from "../src/lib/wrangler-parser";

function blank(slug: string, name = slug): ParsedWrangler {
  return {
    filePath: `/abs/${slug}/wrangler.toml`,
    slug,
    name,
    routes: [],
    d1: [],
    kv: [],
    r2: [],
    services: [],
    queueProducers: [],
    queueConsumers: [],
    tailConsumers: [],
    secrets: [],
    dispatchNamespaces: [],
    analytics: [],
    durableObjects: [],
    crons: [],
  };
}

const DESCRIPTIONS = new Map([
  ["sigmashake-alpha", "Alpha worker"],
  ["sigmashake-beta", "Beta worker"],
]);

describe("buildInfraGraph — basic worker shape", () => {
  it("emits a worker node per parsed config with description as the hint", () => {
    const alpha = blank("sigmashake-alpha");
    alpha.main = "src/worker.ts";
    const graph = buildInfraGraph([alpha], {
      projectDescriptions: DESCRIPTIONS,
      root: "/registry",
    });
    const worker = graph.nodes.find((n) => n.id === "worker:sigmashake-alpha");
    expect(worker).toBeDefined();
    expect(worker?.kind).toBe("worker");
    expect(worker?.label).toBe("sigmashake-alpha");
    expect(worker?.hint).toBe("Alpha worker");
    expect(worker?.slug).toBe("sigmashake-alpha");
    expect(worker?.meta).toEqual({ name: "sigmashake-alpha", main: "src/worker.ts" });
  });

  it("uses the generic worker hint when no description is supplied", () => {
    const x = blank("sigmashake-mystery");
    const graph = buildInfraGraph([x], {
      projectDescriptions: new Map(),
      root: "/registry",
    });
    const worker = graph.nodes.find((n) => n.id === "worker:sigmashake-mystery");
    expect(worker?.hint).toMatch(/Cloud service/);
  });

  it("returns generatedAt and root verbatim", () => {
    const graph = buildInfraGraph([], {
      projectDescriptions: new Map(),
      root: "/x",
      generatedAt: 42,
    });
    expect(graph.generatedAt).toBe(42);
    expect(graph.root).toBe("/x");
  });

  it("defaults generatedAt to 0 when not provided (deterministic builds)", () => {
    const graph = buildInfraGraph([], {
      projectDescriptions: new Map(),
      root: "/x",
    });
    expect(graph.generatedAt).toBe(0);
  });
});

describe("buildInfraGraph — route + domain dedup", () => {
  it("produces a route edge and a domain node per host", () => {
    const w = blank("sigmashake-alpha");
    w.routes = [{ pattern: "alpha.sigmashake.com/*", zoneName: "sigmashake.com" }];
    const graph = buildInfraGraph([w], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const domain = graph.nodes.find((n) => n.id === "domain:alpha.sigmashake.com");
    expect(domain?.kind).toBe("domain");
    expect(domain?.meta).toMatchObject({ zone: "sigmashake.com" });
    expect(graph.edges).toContainEqual({
      from: "worker:sigmashake-alpha",
      to: "domain:alpha.sigmashake.com",
      kind: "route",
      label: "alpha.sigmashake.com/*",
    });
  });

  it("dedupes wildcard hosts shared across workers", () => {
    const a = blank("sigmashake-alpha");
    a.routes = [{ pattern: "*.fleet.sigmashake.com/*" }];
    const b = blank("sigmashake-beta");
    b.routes = [{ pattern: "*.fleet.sigmashake.com/*" }];
    const graph = buildInfraGraph([a, b], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const domainNodes = graph.nodes.filter((n) => n.kind === "domain");
    expect(domainNodes).toHaveLength(1);
    expect(domainNodes[0]?.label).toBe("*.fleet.sigmashake.com");
    const routeEdges = graph.edges.filter((e) => e.kind === "route");
    expect(routeEdges).toHaveLength(2);
  });
});

describe("buildInfraGraph — shared resources", () => {
  it("dedupes D1 nodes by database name", () => {
    const a = blank("sigmashake-alpha");
    a.d1 = [{ binding: "DB", databaseName: "shared-db", databaseId: "id-1" }];
    const b = blank("sigmashake-beta");
    b.d1 = [{ binding: "HUB_DB", databaseName: "shared-db", databaseId: "id-1" }];
    const graph = buildInfraGraph([a, b], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const d1Nodes = graph.nodes.filter((n) => n.kind === "d1");
    expect(d1Nodes).toHaveLength(1);
    const d1 = d1Nodes[0]!;
    expect(d1.label).toBe("shared-db");
    const bindingEdges = graph.edges.filter((e) => e.to === d1.id && e.kind === "binding");
    expect(bindingEdges.map((e) => e.label).sort()).toEqual(["DB", "HUB_DB"]);
  });

  it("dedupes KV by id and gives the shared sessions namespace a friendly label", () => {
    const a = blank("sigmashake-alpha");
    a.kv = [{ binding: "ACCOUNTS_SESSIONS", id: "28b7cc7730d1422caeda5fe8934ce73a" }];
    const b = blank("sigmashake-beta");
    b.kv = [{ binding: "SESSIONS", id: "28b7cc7730d1422caeda5fe8934ce73a" }];
    const graph = buildInfraGraph([a, b], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const kvNodes = graph.nodes.filter((n) => n.kind === "kv");
    expect(kvNodes).toHaveLength(1);
    expect(kvNodes[0]?.label).toBe("sessions");
  });

  it("falls back to a lowercased binding label for non-shared KV ids", () => {
    const a = blank("sigmashake-alpha");
    a.kv = [{ binding: "MY_KV", id: "ad-hoc-id" }];
    const graph = buildInfraGraph([a], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const kv = graph.nodes.find((n) => n.kind === "kv");
    expect(kv?.label).toBe("my_kv");
  });

  it("dedupes R2 buckets by bucket name", () => {
    const a = blank("sigmashake-alpha");
    a.r2 = [{ binding: "ATTACHMENTS", bucketName: "shared-bucket" }];
    const b = blank("sigmashake-beta");
    b.r2 = [{ binding: "BLOBS", bucketName: "shared-bucket" }];
    const graph = buildInfraGraph([a, b], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    expect(graph.nodes.filter((n) => n.kind === "r2")).toHaveLength(1);
  });
});

describe("buildInfraGraph — service bindings", () => {
  it("emits a service edge to a known internal worker", () => {
    const a = blank("sigmashake-alpha");
    a.services = [{ binding: "EMAILER", service: "sigmashake-beta", entrypoint: "Emailer" }];
    const b = blank("sigmashake-beta");
    const graph = buildInfraGraph([a, b], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const edge = graph.edges.find(
      (e) =>
        e.kind === "service" &&
        e.from === "worker:sigmashake-alpha" &&
        e.to === "worker:sigmashake-beta",
    );
    expect(edge).toBeDefined();
    expect(edge?.label).toBe("EMAILER (Emailer)");
    // No standalone service node should exist for an internal target.
    expect(graph.nodes.find((n) => n.id === "service:sigmashake-beta")).toBeUndefined();
  });

  it("creates an external service node when the target slug is unknown", () => {
    const a = blank("sigmashake-alpha");
    a.services = [{ binding: "EXT", service: "some-external" }];
    const graph = buildInfraGraph([a], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    expect(graph.nodes.find((n) => n.id === "service:some-external")).toBeDefined();
    const edge = graph.edges.find(
      (e) => e.from === "worker:sigmashake-alpha" && e.to === "service:some-external",
    );
    expect(edge?.label).toBe("EXT");
  });

  it("resolves service bindings by wrangler `name` even when name != slug", () => {
    const a = blank("sigmashake-alpha");
    a.services = [{ binding: "TOWN_SQUARE", service: "renamed-worker" }];
    const b = blank("sigmashake-beta", "renamed-worker");
    const graph = buildInfraGraph([a, b], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const edge = graph.edges.find(
      (e) => e.from === "worker:sigmashake-alpha" && e.to === "worker:sigmashake-beta",
    );
    expect(edge).toBeDefined();
  });
});

describe("buildInfraGraph — queues and crons", () => {
  it("shares a queue node between producer and consumer; edge polarity differs", () => {
    const producer = blank("sigmashake-alpha");
    producer.queueProducers = [{ binding: "Q", queue: "demo" }];
    const consumer = blank("sigmashake-beta");
    consumer.queueConsumers = [{ queue: "demo" }];
    const graph = buildInfraGraph([producer, consumer], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const queueNodes = graph.nodes.filter((n) => n.kind === "queue");
    expect(queueNodes).toHaveLength(1);
    expect(queueNodes[0]?.id).toBe("queue:demo");
    expect(graph.edges).toContainEqual({
      from: "worker:sigmashake-alpha",
      to: "queue:demo",
      kind: "queue_produces",
      label: "Q",
    });
    expect(graph.edges).toContainEqual({
      from: "queue:demo",
      to: "worker:sigmashake-beta",
      kind: "queue_consumes",
    });
  });

  it("translates cron expressions into human-readable labels", () => {
    const a = blank("sigmashake-alpha");
    a.crons = ["*/5 * * * *", "0 0 * * *", "13 7 * * *", "0 14 1 * *", "*/3 * * * *"];
    const graph = buildInfraGraph([a], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const cronNodes = graph.nodes.filter((n) => n.kind === "cron");
    const labels = cronNodes.map((n) => n.label).sort();
    expect(labels).toContain("Every 5 minutes");
    expect(labels).toContain("Daily at midnight UTC");
    expect(labels).toContain("Daily at 7:13 UTC");
    expect(labels).toContain("Monthly on the 1st at 14:00 UTC");
    // Anything unrecognized falls through verbatim under a "Cron:" prefix.
    expect(labels).toContain("Cron: */3 * * * *");
  });

  it("cron edges flow from the trigger node into the worker", () => {
    const a = blank("sigmashake-alpha");
    a.crons = ["*/5 * * * *"];
    const graph = buildInfraGraph([a], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const edge = graph.edges.find((e) => e.kind === "cron");
    expect(edge?.from).toBe("cron:sigmashake-alpha:*/5 * * * *");
    expect(edge?.to).toBe("worker:sigmashake-alpha");
    expect(edge?.label).toBe("*/5 * * * *");
  });
});

describe("buildInfraGraph — secrets, durable objects, dispatch, analytics, assets, tail", () => {
  it("strips __prod / __dev suffixes from secret labels", () => {
    const a = blank("sigmashake-alpha");
    a.secrets = [
      {
        binding: "API_KEY",
        secretName: "ANTHROPIC_API_KEY__prod",
        storeId: "store-1",
      },
    ];
    const graph = buildInfraGraph([a], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const secret = graph.nodes.find((n) => n.kind === "secret");
    expect(secret?.label).toBe("ANTHROPIC_API_KEY");
  });

  it("scopes durable_object nodes per slug so two workers can each own a 'Room' class", () => {
    const a = blank("sigmashake-alpha");
    a.durableObjects = [{ name: "ROOM", className: "Room" }];
    const b = blank("sigmashake-beta");
    b.durableObjects = [{ name: "ROOM", className: "Room" }];
    const graph = buildInfraGraph([a, b], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const ids = graph.nodes
      .filter((n) => n.kind === "durable_object")
      .map((n) => n.id)
      .sort();
    expect(ids).toEqual(["do:sigmashake-alpha:Room", "do:sigmashake-beta:Room"]);
  });

  it("emits dispatch + analytics nodes", () => {
    const a = blank("sigmashake-alpha");
    a.dispatchNamespaces = [{ binding: "TENANTS", namespace: "demo-tenants" }];
    a.analytics = [{ binding: "EVT", dataset: "demo_events" }];
    const graph = buildInfraGraph([a], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    expect(graph.nodes.some((n) => n.kind === "dispatch_namespace")).toBe(true);
    expect(graph.nodes.some((n) => n.kind === "analytics")).toBe(true);
  });

  it("emits an assets node with the directory in the label", () => {
    const a = blank("sigmashake-alpha");
    a.assets = { directory: "public", binding: "ASSETS" };
    const graph = buildInfraGraph([a], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const assets = graph.nodes.find((n) => n.kind === "assets");
    expect(assets?.label).toBe("static (public)");
    expect(graph.edges).toContainEqual({
      from: "worker:sigmashake-alpha",
      to: "assets:sigmashake-alpha",
      kind: "owns",
      label: "ASSETS",
    });
  });

  it("resolves tail consumers to internal workers when names match, else service node", () => {
    const a = blank("sigmashake-alpha");
    a.tailConsumers = [{ service: "sigmashake-alerts" }, { service: "unknown-tail" }];
    const alerts = blank("sigmashake-alerts");
    const graph = buildInfraGraph([a, alerts], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const tailEdges = graph.edges.filter((e) => e.kind === "tail");
    expect(tailEdges.map((e) => e.to).sort()).toEqual([
      "service:unknown-tail",
      "worker:sigmashake-alerts",
    ]);
  });
});

describe("buildInfraGraph — sort stability", () => {
  it("workers come first, then by kind, then by label", () => {
    const a = blank("sigmashake-beta");
    a.kv = [{ binding: "KV", id: "kv-1" }];
    a.d1 = [{ binding: "DB", databaseName: "db-a" }];
    const b = blank("sigmashake-alpha");
    const graph = buildInfraGraph([a, b], {
      projectDescriptions: DESCRIPTIONS,
      root: "/x",
    });
    const kinds = graph.nodes.map((n) => n.kind);
    expect(kinds[0]).toBe("worker");
    expect(kinds[1]).toBe("worker");
    expect(graph.nodes[0]?.slug).toBe("sigmashake-alpha");
    expect(graph.nodes[1]?.slug).toBe("sigmashake-beta");
  });
});
