/**
 * Load test — workspace buildInfraGraph.
 * N=1000 sequential calls with 10 service configs; mean < 5ms, p99 < 20ms.
 */
import { describe, expect, it } from "vitest";
import { buildInfraGraph } from "../../src/lib/build-infra-graph";
import type { ParsedWrangler } from "../../src/lib/wrangler-parser";

function makeParsed(slug: string): ParsedWrangler {
  return {
    name: slug,
    slug,
    routes: [{ pattern: `${slug}.sigmashake.com/*`, zone_name: "sigmashake.com" }],
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

const CONFIGS: [string, ParsedWrangler][] = Array.from({ length: 10 }, (_, i) => {
  const slug = `svc-${i}`;
  return [slug, makeParsed(slug)];
});
const DESC_MAP = new Map(CONFIGS.map(([slug]) => [slug, `Service ${slug}`]));

describe("workspace — load (N=1000 buildInfraGraph)", () => {
  it("mean < 5ms, p99 < 20ms", () => {
    const N = 1000;
    const latencies: number[] = [];

    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      buildInfraGraph(CONFIGS, { projectDescriptions: DESC_MAP, root: "/ws" });
      latencies.push(performance.now() - t0);
    }

    latencies.sort((a, b) => a - b);
    const mean = latencies.reduce((s, v) => s + v, 0) / N;
    const p99 = latencies[Math.floor(N * 0.99)];

    expect(mean).toBeLessThan(5);
    expect(p99).toBeLessThan(20);
  });
});
