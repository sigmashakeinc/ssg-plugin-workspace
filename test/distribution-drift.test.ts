// Covers the cross-channel parity probe — see src/distribution-drift.ts.
// Uses a hand-rolled fetch stub so tests are deterministic against R2 + GitHub
// (no network). Mirrors the 0.1.98-vs-0.1.99 incident: arm64 stranded behind
// x64 on R2, AND missing from the latest GH release.

import { describe, expect, it } from "bun:test";

import { buildDistributionDrift } from "../src/distribution-drift";

function makeFetchStub(
  routes: Array<{ urlContains: string; method?: string; status: number; body?: unknown }>,
): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? "GET";
    for (const r of routes) {
      if (url.includes(r.urlContains) && (!r.method || r.method === method)) {
        return new Response(r.body === undefined ? "" : JSON.stringify(r.body), {
          status: r.status,
          headers: { "content-type": "application/json" },
        });
      }
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

describe("buildDistributionDrift", () => {
  it("returns OK for every lane when R2 + GH agree", async () => {
    const stub = makeFetchStub([
      { urlContains: "stable-linux-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-win-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-macos-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-macos-arm64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-linux-x64-SigmaShakeDesktop.tar.zst", method: "HEAD", status: 200 },
      { urlContains: "stable-win-x64-SigmaShakeDesktop-Setup.exe", method: "HEAD", status: 200 },
      { urlContains: "stable-macos-x64-SigmaShakeDesktop.dmg", method: "HEAD", status: 200 },
      { urlContains: "stable-macos-arm64-SigmaShakeDesktop.dmg", method: "HEAD", status: 200 },
      {
        urlContains: "api.github.com/repos/sigmashakeinc/desktop/releases/latest",
        status: 200,
        body: {
          tag_name: "v0.1.99",
          assets: [
            { name: "stable-linux-x64-SigmaShakeDesktop.AppImage" },
            { name: "stable-win-x64-SigmaShakeDesktop-Setup.exe" },
            { name: "stable-macos-x64-SigmaShakeDesktop.dmg" },
            { name: "stable-macos-arm64-SigmaShakeDesktop.dmg" },
          ],
        },
      },
    ]);
    const drift = await buildDistributionDrift(stub);
    expect(drift.driftedCount).toBe(0);
    expect(drift.r2HighestVersion).toBe("0.1.99");
    expect(drift.ghLatestTag).toBe("v0.1.99");
    for (const lane of drift.lanes) {
      expect(lane.verdict).toBe("ok");
      expect(lane.catchUpCommand).toBeNull();
    }
  });

  it("flags arm64 as STALE when x64 ships 0.1.99 but arm64 stays at 0.1.98 — the original incident", async () => {
    const stub = makeFetchStub([
      { urlContains: "stable-linux-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-win-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-macos-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-macos-arm64-update.json", status: 200, body: { version: "0.1.98" } },
      { urlContains: "SigmaShakeDesktop", method: "HEAD", status: 200 },
      {
        urlContains: "api.github.com/repos/sigmashakeinc/desktop/releases/latest",
        status: 200,
        body: {
          tag_name: "v0.1.99",
          assets: [
            { name: "stable-linux-x64-SigmaShakeDesktop.AppImage" },
            { name: "stable-win-x64-SigmaShakeDesktop-Setup.exe" },
            { name: "stable-macos-x64-SigmaShakeDesktop.dmg" },
            // intentionally no stable-macos-arm64-* asset on this release
          ],
        },
      },
    ]);
    const drift = await buildDistributionDrift(stub);
    expect(drift.r2HighestVersion).toBe("0.1.99");
    expect(drift.driftedCount).toBe(1);
    const arm64 = drift.lanes.find((l) => l.lane === "macos-arm64");
    expect(arm64?.verdict).toBe("stale");
    expect(arm64?.r2Version).toBe("0.1.98");
    expect(arm64?.ghHasAsset).toBe(false);
    expect(arm64?.catchUpCommand).toBe("/publish desktop-only-mac");
  });

  it("flags BROKEN when update.json claims a version but blob HEAD 404s", async () => {
    const stub = makeFetchStub([
      { urlContains: "stable-linux-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-win-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-macos-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-macos-arm64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-linux-x64-SigmaShakeDesktop.tar.zst", method: "HEAD", status: 404 },
      { urlContains: "stable-win-x64-SigmaShakeDesktop-Setup.exe", method: "HEAD", status: 200 },
      { urlContains: "stable-macos-x64-SigmaShakeDesktop.dmg", method: "HEAD", status: 200 },
      { urlContains: "stable-macos-arm64-SigmaShakeDesktop.dmg", method: "HEAD", status: 200 },
      {
        urlContains: "api.github.com/repos/sigmashakeinc/desktop/releases/latest",
        status: 200,
        body: { tag_name: "v0.1.99", assets: [] },
      },
    ]);
    const drift = await buildDistributionDrift(stub);
    const linux = drift.lanes.find((l) => l.lane === "linux-x64");
    expect(linux?.verdict).toBe("broken");
    expect(linux?.r2BlobHttp).toBe(404);
    expect(linux?.catchUpCommand).toBe("/publish desktop-only-linux");
  });

  it("flags MISSING when a lane has never published", async () => {
    const stub = makeFetchStub([
      { urlContains: "stable-linux-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-win-x64-update.json", status: 404 },
      { urlContains: "stable-macos-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-macos-arm64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "SigmaShakeDesktop", method: "HEAD", status: 200 },
      {
        urlContains: "api.github.com/repos/sigmashakeinc/desktop/releases/latest",
        status: 200,
        body: { tag_name: "v0.1.99", assets: [] },
      },
    ]);
    const drift = await buildDistributionDrift(stub);
    const win = drift.lanes.find((l) => l.lane === "win-x64");
    expect(win?.verdict).toBe("missing");
    expect(win?.r2Version).toBeNull();
    expect(win?.catchUpCommand).toBe("/publish desktop-only-win");
  });

  // ── CLI publish-channel parity (npm reference vs PyPI / crates.io / GitHub) ──

  const DESKTOP_OK_ROUTES = [
    { urlContains: "stable-linux-x64-update.json", status: 200, body: { version: "0.1.99" } },
    { urlContains: "stable-win-x64-update.json", status: 200, body: { version: "0.1.99" } },
    { urlContains: "stable-macos-x64-update.json", status: 200, body: { version: "0.1.99" } },
    { urlContains: "stable-macos-arm64-update.json", status: 200, body: { version: "0.1.99" } },
    { urlContains: "SigmaShakeDesktop", method: "HEAD", status: 200 },
    {
      urlContains: "sigmashakeinc/desktop/releases/latest",
      status: 200,
      body: {
        tag_name: "v0.1.99",
        assets: [
          { name: "stable-linux-x64-SigmaShakeDesktop.AppImage" },
          { name: "stable-win-x64-SigmaShakeDesktop-Setup.exe" },
          { name: "stable-macos-x64-SigmaShakeDesktop.dmg" },
          { name: "stable-macos-arm64-SigmaShakeDesktop.dmg" },
        ],
      },
    },
  ];

  it("flags a CLI channel STALE when it lags the npm reference", async () => {
    const stub = makeFetchStub([
      ...DESKTOP_OK_ROUTES,
      { urlContains: "registry.npmjs.org", status: 200, body: { "dist-tags": { latest: "0.29.99" } } },
      { urlContains: "pypi.org/pypi/sigmashake/json", status: 200, body: { info: { version: "0.29.99" } } },
      // crates.io is one patch behind — the genuine stale case.
      { urlContains: "crates.io/api/v1/crates/sigmashake-ssg", status: 200, body: { crate: { max_stable_version: "0.29.98" } } },
      { urlContains: "sigmashakeinc/ssg/releases/latest", status: 200, body: { tag_name: "v0.29.99" } },
    ]);
    const drift = await buildDistributionDrift(stub);
    expect(drift.cliReferenceVersion).toBe("0.29.99");
    expect(drift.sources.cli).toBe(true);
    const byId = Object.fromEntries(drift.cliChannels.map((c) => [c.channel, c]));
    expect(byId.npm?.verdict).toBe("ok");
    expect(byId.npm?.version).toBe("0.29.99");
    expect(byId.pypi?.verdict).toBe("ok");
    expect(byId["github-cli"]?.verdict).toBe("ok");
    expect(byId.cargo?.verdict).toBe("stale");
    expect(byId.cargo?.version).toBe("0.29.98");
    expect(drift.cliDriftedCount).toBe(1);
    // Desktop lanes are unaffected by CLI-channel skew.
    expect(drift.driftedCount).toBe(0);
  });

  it("marks non-npm CLI channels UNKNOWN (not stale) when npm is unreachable", async () => {
    const stub = makeFetchStub([
      ...DESKTOP_OK_ROUTES,
      // npm registry down → no reference → can't call the others stale.
      { urlContains: "registry.npmjs.org", status: 503 },
      { urlContains: "pypi.org/pypi/sigmashake/json", status: 200, body: { info: { version: "0.29.99" } } },
      { urlContains: "crates.io/api/v1/crates/sigmashake-ssg", status: 200, body: { crate: { max_stable_version: "0.29.99" } } },
      { urlContains: "sigmashakeinc/ssg/releases/latest", status: 200, body: { tag_name: "v0.29.99" } },
    ]);
    const drift = await buildDistributionDrift(stub);
    expect(drift.cliReferenceVersion).toBeNull();
    const byId = Object.fromEntries(drift.cliChannels.map((c) => [c.channel, c]));
    expect(byId.npm?.verdict).toBe("unknown");
    expect(byId.pypi?.verdict).toBe("unknown");
    expect(byId.cargo?.verdict).toBe("unknown");
    // A reachable registry still reports its version even when uncomparable.
    expect(byId.pypi?.version).toBe("0.29.99");
    // Unknown is not drift — no false alarms from a flaky registry.
    expect(drift.cliDriftedCount).toBe(0);
  });

  it("degrades gracefully when GitHub API is unreachable", async () => {
    const stub = makeFetchStub([
      { urlContains: "stable-linux-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-win-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-macos-x64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "stable-macos-arm64-update.json", status: 200, body: { version: "0.1.99" } },
      { urlContains: "SigmaShakeDesktop", method: "HEAD", status: 200 },
      { urlContains: "api.github.com", status: 500 },
    ]);
    const drift = await buildDistributionDrift(stub);
    expect(drift.sources.github).toBe(false);
    expect(drift.sources.r2).toBe(true);
    // R2 + GH agreement check skips when GH is down; lanes still resolve OK
    // on the R2-only path.
    expect(drift.driftedCount).toBe(0);
  });
});
