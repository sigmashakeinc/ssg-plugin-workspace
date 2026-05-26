/**
 * Stress test — workspace buildInfraGraph: N=5000 calls; assert no exceptions, heap < 50MB.
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
    kv_namespaces: [{ binding: "KV", id: `kv-${slug}` }],
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

const CONFIGS: [string, ParsedWrangler][] = Array.from({ length: 5 }, (_, i) => {
  const slug = `svc-${i}`;
  return [slug, makeParsed(slug)];
});
const DESC_MAP = new Map(CONFIGS.map(([slug]) => [slug, `Svc ${slug}`]));

describe("workspace — stress (N=5000 buildInfraGraph)", () => {
  it("no exceptions and heap bounded", () => {
    const N = 5000;
    const heapBefore = process.memoryUsage().heapUsed;
    let errors = 0;

    for (let i = 0; i < N; i++) {
      try {
        buildInfraGraph(CONFIGS, { projectDescriptions: DESC_MAP, root: "/ws" });
      } catch {
        errors++;
      }
    }

    const heapDelta = process.memoryUsage().heapUsed - heapBefore;
    expect(errors).toBe(0);
    expect(heapDelta).toBeLessThan(50 * 1024 * 1024);
  });
});
