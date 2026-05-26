/**
 * Soak test — workspace: N=500; no degradation first vs last 10%.
 */
import { describe, expect, it } from "vitest";
import { buildInfraGraph } from "../../src/lib/build-infra-graph";
import type { ParsedWrangler } from "../../src/lib/wrangler-parser";

function makeParsed(slug: string): ParsedWrangler {
  return {
    name: slug,
    slug,
    routes: [{ pattern: `${slug}.example.com/*`, zone_name: "example.com" }],
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

const CONFIGS: [string, ParsedWrangler][] = Array.from({ length: 8 }, (_, i) => {
  const slug = `svc-${i}`;
  return [slug, makeParsed(slug)];
});
const DESC_MAP = new Map(CONFIGS.map(([slug]) => [slug, slug]));

describe("workspace — soak (N=500)", () => {
  it("no latency degradation across window", () => {
    const N = 500;
    const latencies: number[] = [];
    for (let i = 0; i < N; i++) {
      const t0 = performance.now();
      buildInfraGraph(CONFIGS, { projectDescriptions: DESC_MAP, root: "/ws" });
      latencies.push(performance.now() - t0);
    }
    const slice = Math.floor(N * 0.1);
    const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
    expect(avg(latencies.slice(-slice))).toBeLessThan(avg(latencies.slice(0, slice)) * 3 + 2);
  });
});
