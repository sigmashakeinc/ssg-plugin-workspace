// vitest.config.ts — workspace test config with dual pools.
//
// Two projects:
//   - "unit":        plain node env for the settings-store localStorage shim
//                    (no Worker runtime needed). Runs in vitest's default pool.
//   - "integration": boots Miniflare with the ACCOUNTS_SESSIONS KV binding +
//                    real ASSETS dir so SELF.fetch hits the actual worker.
//                    Mirrors the pattern used by sigmashake-{mcp,fleet}.

import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";
import {
  DEFAULT_COMPAT_DATE,
  DEFAULT_COMPAT_FLAGS,
} from "../shared/test-helpers/vitest-pool-workers";

// The local workerd bundled with @cloudflare/vitest-pool-workers caps the
// supported compatibility_date below what production accepts. We deliberately
// pin the test runtime to the shared default rather than reading
// wrangler.toml's 2026-05-15 — bumping past workerd's max breaks Miniflare
// start-up. Production CF runs ahead of the bundled workerd; if any test
// genuinely needs a newer flag-gated behavior, bump pool-workers first.

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "unit",
          globals: false,
          environment: "node",
          // Every top-level test/*.test.ts file runs here. Sub-dirs
          // (regression/, configuration/, load/, etc.) belong to their own
          // projects.
          include: ["test/*.test.ts"],
          // worker.test.ts + worker-cloud-degradation.test.ts need the
          // cloudflare:test runtime; they run in the integration project.
          exclude: ["test/worker.test.ts", "test/worker-cloud-degradation.test.ts"],
        },
      },
      {
        plugins: [
          cloudflareTest({
            miniflare: {
              compatibilityDate: DEFAULT_COMPAT_DATE,
              compatibilityFlags: [...DEFAULT_COMPAT_FLAGS],
              kvNamespaces: ["ACCOUNTS_SESSIONS"],
              // Stub the SUPPORT + SALES + OBSERV service bindings declared
              // in wrangler.toml. Without these, Miniflare refuses to boot
              // ("binding refers to a service … but no such service is
              // defined") and every worker.test.ts case silently no-ops.
              // Individual tests can override via vi.spyOn(env.SUPPORT, …).
              serviceBindings: {
                SUPPORT() {
                  return new Response(JSON.stringify({ tickets: [] }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  });
                },
                SALES() {
                  return new Response(JSON.stringify({ leads: [] }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  });
                },
                OBSERV() {
                  return new Response(JSON.stringify({ services: [] }), {
                    status: 200,
                    headers: { "content-type": "application/json" },
                  });
                },
              },
            },
            wrangler: { configPath: "./wrangler.toml" },
          }),
        ],
        test: {
          name: "integration",
          include: ["test/worker.test.ts", "test/worker-cloud-degradation.test.ts"],
        },
      },
      // Regression + configuration: node env, static file inspection.
      {
        test: {
          name: "regression",
          include: ["test/regression/**/*.test.ts"],
          environment: "node",
        },
      },
      {
        test: {
          name: "configuration",
          include: ["test/configuration/**/*.test.ts"],
          environment: "node",
        },
      },
      // Performance tests: node env, in-process hot-path assertions.
      {
        test: {
          name: "perf",
          include: [
            "test/load/**/*.test.ts",
            "test/stress/**/*.test.ts",
            "test/spike/**/*.test.ts",
            "test/soak/**/*.test.ts",
            "test/scalability/**/*.test.ts",
          ],
          environment: "node",
        },
      },
    ],
  },
});
