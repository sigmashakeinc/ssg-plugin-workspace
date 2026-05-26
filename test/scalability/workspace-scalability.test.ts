/**
 * Scalability test — workspace buildInfraGraph.
 * N=5, 50, 500 service configs; time(500) < 200 * time(5).
 */
import { describe, expect, it } from "vitest";
import { buildInfraGraph } from "../../src/lib/build-infra-graph";
import type { ParsedWrangler } from "../../src/lib/wrangler-parser";

function makeConfigs(n: number): [string, ParsedWrangler][] {
  return Array.from({ length: n }, (_, i) => {
    const slug = `svc-${i}`;
    return [
      slug,
      {
        name: slug,
        slug,
        routes: [{ pattern: `${slug}.example.com/*`, zone_name: "example.com" }],
        d1_databases:
          i % 3 === 0
            ? [{ binding: "DB", database_name: `${slug}-db`, database_id: `id-${i}` }]
            : [],
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
      },
    ] as [string, ParsedWrangler];
  });
}

function run(configs: [string, ParsedWrangler][]): number {
  const desc = new Map(configs.map(([slug]) => [slug, slug]));
  const t0 = performance.now();
  buildInfraGraph(configs, { projectDescriptions: desc, root: "/ws" });
  return performance.now() - t0;
}

describe("workspace — scalability", () => {
  it("sub-quadratic: time(500 services) < 200 * time(5 services)", () => {
    const c5 = makeConfigs(5);
    const c500 = makeConfigs(500);

    // Warm up
    run(c5);

    const t5 = Array.from({ length: 20 }, () => run(c5)).reduce((s, v) => s + v, 0) / 20;
    const t500 = run(c500);

    expect(t500).toBeLessThan(200 * Math.max(t5, 0.001));
  });
});
