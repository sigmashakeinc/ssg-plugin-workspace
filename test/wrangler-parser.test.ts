// Unit coverage for the hand-rolled wrangler config parser. Covers both the
// TOML and JSONC paths plus the extension-dispatch helper. The parser is
// load-bearing for the infrastructure graph (cloud Worker + SSG daemon both
// consume it), so every binding kind needs explicit coverage.

import { describe, expect, it } from "vitest";

import {
  parseWrangler,
  parseWranglerConfig,
  parseWranglerJsonc,
  WRANGLER_FILENAMES,
} from "../src/lib/wrangler-parser";

const SAMPLE_TOML = `name = "sigmashake-demo"
main = "src/worker.ts"
compatibility_date = "2026-05-15"

[assets]
directory = "public"
binding = "ASSETS"

[[routes]]
pattern = "demo.sigmashake.com/*"
zone_name = "sigmashake.com"

[[d1_databases]]
binding = "DB"
database_name = "sigmashake-demo-db"
database_id = "78172045-a204-45ff-8269-a599c06a6206"

[[kv_namespaces]]
binding = "SESSIONS"
id = "bd4b23aa6f094d11a91d603898b834d4"

[[r2_buckets]]
binding = "ATTACHMENTS"
bucket_name = "sigmashake-demo-attachments"

[[services]]
binding = "EMAILER"
service = "sigmashake-emailer"
entrypoint = "Emailer"

[[queues.producers]]
binding = "TRIAGE_QUEUE"
queue   = "demo-triage"

[[queues.consumers]]
queue             = "demo-triage"
max_batch_size    = 10

[[tail_consumers]]
service = "sigmashake-alerts"

[[secrets_store_secrets]]
binding     = "ANTHROPIC_API_KEY"
store_id    = "45e951924d174a18960477e7cb3c93b2"
secret_name = "ANTHROPIC_API_KEY__prod"

[[dispatch_namespaces]]
binding = "TENANTS"
namespace = "demo-tenants"

[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "demo_events"

[durable_objects]
bindings = [
  {name = "MATCH_ROOM", class_name = "MatchRoom"},
  {name = "ASK_ROOM",   class_name = "AskRoom"},
]

[triggers]
crons = ["*/5 * * * *", "0 0 * * *"]
`;

describe("parseWrangler (TOML)", () => {
  const parsed = parseWrangler(SAMPLE_TOML, "/abs/sigmashake-demo/wrangler.toml");

  it("derives the slug from the parent directory", () => {
    expect(parsed.slug).toBe("sigmashake-demo");
  });

  it("captures top-level name + main", () => {
    expect(parsed.name).toBe("sigmashake-demo");
    expect(parsed.main).toBe("src/worker.ts");
  });

  it("parses routes with zone_name", () => {
    expect(parsed.routes).toEqual([
      { pattern: "demo.sigmashake.com/*", zoneName: "sigmashake.com" },
    ]);
  });

  it("parses D1 databases", () => {
    expect(parsed.d1).toEqual([
      {
        binding: "DB",
        databaseName: "sigmashake-demo-db",
        databaseId: "78172045-a204-45ff-8269-a599c06a6206",
      },
    ]);
  });

  it("parses KV namespaces", () => {
    expect(parsed.kv).toEqual([{ binding: "SESSIONS", id: "bd4b23aa6f094d11a91d603898b834d4" }]);
  });

  it("parses R2 buckets", () => {
    expect(parsed.r2).toEqual([
      { binding: "ATTACHMENTS", bucketName: "sigmashake-demo-attachments" },
    ]);
  });

  it("parses service bindings with optional entrypoint", () => {
    expect(parsed.services).toEqual([
      { binding: "EMAILER", service: "sigmashake-emailer", entrypoint: "Emailer" },
    ]);
  });

  it("parses queue producers and consumers", () => {
    expect(parsed.queueProducers).toEqual([{ binding: "TRIAGE_QUEUE", queue: "demo-triage" }]);
    expect(parsed.queueConsumers).toEqual([{ queue: "demo-triage" }]);
  });

  it("parses tail consumers", () => {
    expect(parsed.tailConsumers).toEqual([{ service: "sigmashake-alerts" }]);
  });

  it("parses secrets_store_secrets", () => {
    expect(parsed.secrets).toEqual([
      {
        binding: "ANTHROPIC_API_KEY",
        secretName: "ANTHROPIC_API_KEY__prod",
        storeId: "45e951924d174a18960477e7cb3c93b2",
      },
    ]);
  });

  it("parses dispatch namespaces", () => {
    expect(parsed.dispatchNamespaces).toEqual([{ binding: "TENANTS", namespace: "demo-tenants" }]);
  });

  it("parses analytics engine datasets", () => {
    expect(parsed.analytics).toEqual([{ binding: "ANALYTICS", dataset: "demo_events" }]);
  });

  it("parses durable_object bindings across multiple lines", () => {
    expect(parsed.durableObjects).toEqual([
      { name: "MATCH_ROOM", className: "MatchRoom" },
      { name: "ASK_ROOM", className: "AskRoom" },
    ]);
  });

  it("parses crons from [triggers]", () => {
    expect(parsed.crons).toEqual(["*/5 * * * *", "0 0 * * *"]);
  });

  it("parses [assets] directory + binding", () => {
    expect(parsed.assets).toEqual({ directory: "public", binding: "ASSETS" });
  });

  it("ignores '#' inside quoted strings (comment-stripping is string-aware)", () => {
    const toml = `name = "sigmashake-demo"
[[routes]]
pattern = "demo.sigmashake.com/#fragment"
`;
    const p = parseWrangler(toml, "/x/sigmashake-demo/wrangler.toml");
    expect(p.routes).toEqual([{ pattern: "demo.sigmashake.com/#fragment" }]);
  });

  it("strips full-line + trailing TOML comments", () => {
    const toml = `# A leading comment
name = "x" # inline comment
[[routes]]
pattern = "x.example.com/*"
`;
    const p = parseWrangler(toml);
    expect(p.name).toBe("x");
    expect(p.routes[0]?.pattern).toBe("x.example.com/*");
  });

  it("drops rows without their primary key (no binding ⇒ no row)", () => {
    const toml = `[[d1_databases]]
database_name = "no-binding"
`;
    const p = parseWrangler(toml);
    expect(p.d1).toEqual([]);
  });

  it("returns an empty parsed shape for empty input", () => {
    const p = parseWrangler("", "/x/sigmashake-blank/wrangler.toml");
    expect(p.name).toBe("");
    expect(p.routes).toEqual([]);
    expect(p.d1).toEqual([]);
    expect(p.crons).toEqual([]);
    expect(p.assets).toBeUndefined();
    expect(p.slug).toBe("sigmashake-blank");
  });
});

describe("parseWranglerJsonc", () => {
  it("strips // and /* */ comments and trailing commas", () => {
    const jsonc = `{
      // top comment
      "name": "sigmashake-jsonc",
      "main": "src/worker.ts",
      "routes": [{"pattern": "j.example.com/*", "zone_name": "example.com"}],
      "d1_databases": [
        {"binding": "DB", "database_name": "j-db", "database_id": "id-1"},
      ],
      /* block comment */
      "kv_namespaces": [{"binding": "KV", "id": "kv-1"}],
      "queues": {
        "producers": [{"binding": "Q", "queue": "queue-1"}],
        "consumers": [{"queue": "queue-1"}]
      },
      "tail_consumers": [{"service": "alerts"}],
      "triggers": {"crons": ["0 0 * * *"]}
    }`;
    const p = parseWranglerJsonc(jsonc, "/abs/sigmashake-jsonc/wrangler.jsonc");
    expect(p.name).toBe("sigmashake-jsonc");
    expect(p.main).toBe("src/worker.ts");
    expect(p.routes).toEqual([{ pattern: "j.example.com/*", zoneName: "example.com" }]);
    expect(p.d1).toEqual([{ binding: "DB", databaseName: "j-db", databaseId: "id-1" }]);
    expect(p.kv).toEqual([{ binding: "KV", id: "kv-1" }]);
    expect(p.queueProducers).toEqual([{ binding: "Q", queue: "queue-1" }]);
    expect(p.queueConsumers).toEqual([{ queue: "queue-1" }]);
    expect(p.tailConsumers).toEqual([{ service: "alerts" }]);
    expect(p.crons).toEqual(["0 0 * * *"]);
  });

  it("accepts a single `route` string in addition to the routes array", () => {
    const jsonc = `{
      "name": "x",
      "route": "x.example.com/*"
    }`;
    const p = parseWranglerJsonc(jsonc);
    expect(p.routes).toEqual([{ pattern: "x.example.com/*" }]);
  });

  it("preserves `//` and `,}` that appear inside string literals", () => {
    // The trailing comma here is INSIDE a string and must not be stripped.
    const jsonc = `{
      "name": "x",
      "routes": [
        {"pattern": "https://example.com/?x=1,"}
      ]
    }`;
    const p = parseWranglerJsonc(jsonc);
    expect(p.routes[0]?.pattern).toBe("https://example.com/?x=1,");
  });

  it("returns an empty shape on invalid JSON", () => {
    const p = parseWranglerJsonc("{this is not json", "/x/sigmashake-bad/wrangler.json");
    expect(p.name).toBe("");
    expect(p.routes).toEqual([]);
  });

  it("parses durable_objects.bindings", () => {
    const jsonc = `{
      "name": "x",
      "durable_objects": {
        "bindings": [
          {"name": "ROOM", "class_name": "Room"}
        ]
      }
    }`;
    const p = parseWranglerJsonc(jsonc);
    expect(p.durableObjects).toEqual([{ name: "ROOM", className: "Room" }]);
  });

  it("parses assets directory + binding", () => {
    const jsonc = `{
      "name": "x",
      "assets": {"directory": "public", "binding": "ASSETS"}
    }`;
    const p = parseWranglerJsonc(jsonc);
    expect(p.assets).toEqual({ directory: "public", binding: "ASSETS" });
  });
});

describe("parseWranglerConfig", () => {
  it("dispatches on extension: .toml → TOML parser", () => {
    const p = parseWranglerConfig('name = "t"', "/abs/sigmashake-x/wrangler.toml");
    expect(p.name).toBe("t");
  });

  it("dispatches on extension: .json → JSONC parser", () => {
    const p = parseWranglerConfig('{"name": "j"}', "/abs/sigmashake-x/wrangler.json");
    expect(p.name).toBe("j");
  });

  it("dispatches on extension: .jsonc → JSONC parser", () => {
    const p = parseWranglerConfig('{"name": "jc" /* note */}', "/abs/sigmashake-x/wrangler.jsonc");
    expect(p.name).toBe("jc");
  });

  it("treats unknown extensions as TOML", () => {
    const p = parseWranglerConfig('name = "u"', "/abs/x/wrangler");
    expect(p.name).toBe("u");
  });
});

describe("WRANGLER_FILENAMES", () => {
  it("matches wrangler's resolution order: toml → jsonc → json", () => {
    expect(WRANGLER_FILENAMES).toEqual(["wrangler.toml", "wrangler.jsonc", "wrangler.json"]);
  });
});
