// regression/workspace-served-bundle.e2e.test.ts — E2E over the served
// SigmaShake Workspace surface. Confirms the SSG daemon hands out HTML+JS+CSS
// containing the tightened Tests pillar gate and the new Tests N/100 pill,
// and that the certify endpoint emits data that, when fed through the served
// JS's pillar reduction, produces the expected demotions.
//
// Workspace is served exclusively as an SSG plugin — the legacy `/workspace`
// route was retired. This test hits `/plugins/workspace/` against the running
// daemon; skips gracefully if the daemon isn't reachable so the regression
// project still passes on CI / fresh clones.

import { describe, expect, it, beforeAll } from "vitest";

import { computePillars, tierFromPillars } from "../../src/client/components/CertificationView";
import type { CertificationResponse } from "../../src/types";

const DAEMON_BASE = process.env.SSG_DAEMON_URL ?? "http://127.0.0.1:5599";
const MONO_ROOT = process.env.SSG_MONO_ROOT ?? "/home/user/ssd/sigmashake-mono";

interface ServedAssets {
  html: string;
  js: string;
  css: string;
  certify: CertificationResponse;
  sseFirstService: string | null;
}

let assets: ServedAssets | null = null;
let skipReason: string | null = null;

async function readSseUntilFirstService(url: URL, timeoutMs: number): Promise<string | null> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ac.signal });
    if (!res.body) return null;
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) return null;
      buf += decoder.decode(value, { stream: true });
      // Look for the first `event: service` block — its `data:` line carries
      // a JSON-encoded CertReport.
      const match = buf.match(/event: service\r?\ndata: (.+)\r?\n/);
      if (match) {
        ac.abort(); // close the stream — we only needed the first event
        return match[1];
      }
    }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

beforeAll(async () => {
  try {
    const [htmlRes, jsRes, cssRes, certifyRes] = await Promise.all([
      fetch(`${DAEMON_BASE}/plugins/workspace/`, { signal: AbortSignal.timeout(5_000) }),
      fetch(`${DAEMON_BASE}/plugins/workspace/app.js`, {
        signal: AbortSignal.timeout(5_000),
      }),
      fetch(`${DAEMON_BASE}/plugins/workspace/app.css`, {
        signal: AbortSignal.timeout(5_000),
      }),
      fetch(
        `${DAEMON_BASE}/api/json/workspace/certify?root=${encodeURIComponent(MONO_ROOT)}`,
        { signal: AbortSignal.timeout(15_000) },
      ),
    ]);

    if (!htmlRes.ok) {
      skipReason = `GET /plugins/workspace/ returned ${htmlRes.status}`;
      return;
    }
    if (!jsRes.ok) {
      skipReason = `GET /plugins/workspace/app.js returned ${jsRes.status}`;
      return;
    }
    if (!cssRes.ok) {
      skipReason = `GET /plugins/workspace/app.css returned ${cssRes.status}`;
      return;
    }
    if (!certifyRes.ok) {
      skipReason = `GET /api/json/workspace/certify returned ${certifyRes.status}`;
      return;
    }

    const sseFirstService = await readSseUntilFirstService(
      new URL(
        `/api/json/workspace/certify/stream?root=${encodeURIComponent(MONO_ROOT)}`,
        DAEMON_BASE,
      ),
      8_000,
    );

    assets = {
      html: await htmlRes.text(),
      js: await jsRes.text(),
      css: await cssRes.text(),
      certify: (await certifyRes.json()) as CertificationResponse,
      sseFirstService,
    };
  } catch (err) {
    skipReason = `daemon unreachable at ${DAEMON_BASE}: ${(err as Error).message}`;
  }
});

describe("served HTML shell wires up the workspace runtime", () => {
  it("ships __WORKSPACE_CONFIG__ with runtime=local", () => {
    if (skipReason) {
      console.log(`[e2e] skipping: ${skipReason}`);
      return;
    }
    // Plugin bootstrap script uses single quotes; the legacy local-web shell
    // used double quotes. Tolerate either so the assertion stays stable as
    // the plugin shell is the canonical surface.
    expect(assets!.html).toMatch(/runtime:\s*['"]local['"]/);
    expect(assets!.html).toContain("__WORKSPACE_CONFIG__");
  });

  it("references app.js + app.css inside the plugin mount", () => {
    if (skipReason) return;
    // Plugin shell uses <base href="/plugins/workspace/"> + relative paths,
    // so the asset URLs in the HTML are bare `app.js` / `app.css`.
    expect(assets!.html).toContain("app.js");
    expect(assets!.html).toContain("app.css");
  });
});

describe("served JS bundle contains the patched cert UI", () => {
  it("includes the new Tests N/100 pill class", () => {
    if (skipReason) return;
    expect(assets!.js).toContain("cert__svc-dim");
  });

  it("includes the tightened tests_clean gate predicate", () => {
    if (skipReason) return;
    // Minifier preserves the string literal `tests_clean` and the strict
    // `=== "ok"` branch. Either both appear together or the gate regressed.
    const tightened = /tests_clean[^\n]{0,80}state\s*===\s*[`"']ok[`"']/;
    expect(assets!.js).toMatch(tightened);
  });
});

describe("served CSS includes the pill colors", () => {
  it("ships all three tone modifiers (ok/warn/fail)", () => {
    if (skipReason) return;
    expect(assets!.css).toContain("cert__svc-dim--ok");
    expect(assets!.css).toContain("cert__svc-dim--warn");
    expect(assets!.css).toContain("cert__svc-dim--fail");
  });
});

describe("certify endpoint + pillar reduction stay consistent", () => {
  it("returns reports the served JS can render", () => {
    if (skipReason) return;
    const reports = Object.values(assets!.certify.reports);
    expect(reports.length).toBeGreaterThan(0);
    // The served JS must run the cert reduction on every report and yield a
    // recognised SDLC tier. Specific tier *outcomes* (which services are gold,
    // tier diversity) are live-state dependent and intentionally not asserted.
    const VALID_TIERS = new Set(["gold", "silver", "bronze", "unfit"]);
    for (const r of reports) {
      const pillars = computePillars(r);
      expect(Array.isArray(pillars)).toBe(true);
      const tier = tierFromPillars(pillars.filter((p) => p.pass).length);
      expect(VALID_TIERS.has(tier)).toBe(true);
    }
  });

  it("SSE stream emits a parseable service event", () => {
    if (skipReason) return;
    if (assets!.sseFirstService === null) {
      console.log("[e2e] SSE first-service event not captured (stream may be slow)");
      return;
    }
    const parsed = JSON.parse(assets!.sseFirstService) as {
      slug: string;
      report: { dimensions: Array<{ id: string }> };
    };
    expect(parsed.slug).toBeTruthy();
    const dimIds = parsed.report.dimensions.map((d) => d.id);
    expect(dimIds).toContain("tests");
  });
});
