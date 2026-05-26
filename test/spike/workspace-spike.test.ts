/**
 * Spike test — workspace: 100 parallel buildInfraGraph calls; all complete, < 200ms.
 */
import { describe, expect, it } from "vitest";
import { buildInfraGraph } from "../../src/lib/build-infra-graph";
import type { ParsedWrangler } from "../../src/lib/wrangler-parser";

function makeParsed(slug: string): ParsedWrangler {
  return {
    name: slug,
    slug,
    routes: [],
    d1_databases: [],
    kv_namespaces: [],
    r2_buckets: [],
    queues: { producers: [], consumers: [] },
    durable_objects: { bindings: [] },
    services: [],
    secrets_store_secrets: [],
    dispatch_namespaces: [],
    analytics_engine_datasets: [],
    triggers: { crons: [] },
    assets: null,
  };
}

const CONFIGS: [string, ParsedWrangler][] = [
  ["svc-a", makeParsed("svc-a")],
  ["svc-b", makeParsed("svc-b")],
];
const DESC_MAP = new Map(CONFIGS.map(([slug]) => [slug, slug]));

describe("workspace — spike (N=100 parallel buildInfraGraph)", () => {
  it("all concurrent calls complete without error", async () => {
    const N = 100;
    const t0 = performance.now();
    const results = await Promise.allSettled(
      Array.from({ length: N }, () =>
        Promise.resolve(buildInfraGraph(CONFIGS, { projectDescriptions: DESC_MAP, root: "/ws" })),
      ),
    );
    const elapsed = performance.now() - t0;
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(0);
    expect(elapsed).toBeLessThan(200);
  });
});
