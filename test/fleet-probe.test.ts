// Unit coverage for the Fleet reachability probe. We stub global fetch
// per-test so each branch is exercised in isolation. Restore the real fetch
// in afterEach to avoid leaking stubs into other suites.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  emptyEnrollmentStatus,
  fleetSignInUrl,
  probeFleetReachability,
} from "../src/client/lib/fleet-probe";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

function stubFetch(impl: typeof fetch) {
  globalThis.fetch = impl as typeof fetch;
}

describe("probeFleetReachability", () => {
  it('returns "ok" when /api/health responds 200 with {ok: true}', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await probeFleetReachability()).toBe("ok");
  });

  it('returns "unreachable" when /api/health responds 200 with {ok: false}', async () => {
    stubFetch(
      async () =>
        new Response(JSON.stringify({ ok: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    expect(await probeFleetReachability()).toBe("unreachable");
  });

  it('returns "unreachable" when /api/health responds non-200', async () => {
    stubFetch(async () => new Response("nope", { status: 503 }));
    expect(await probeFleetReachability()).toBe("unreachable");
  });

  it('returns "unreachable" when /api/health body is not JSON', async () => {
    stubFetch(
      async () =>
        new Response("plain text", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
    );
    expect(await probeFleetReachability()).toBe("unreachable");
  });

  it('returns "unreachable" when fetch rejects', async () => {
    stubFetch(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await probeFleetReachability()).toBe("unreachable");
  });
});

describe("fleetSignInUrl", () => {
  it("points at the canonical Fleet root", () => {
    expect(fleetSignInUrl()).toBe("https://fleet.sigmashake.com");
  });
});

describe("emptyEnrollmentStatus", () => {
  let prev: typeof globalThis.fetch;
  beforeEach(() => {
    prev = globalThis.fetch;
  });
  afterEach(() => {
    globalThis.fetch = prev;
  });

  it('returns a "not-yet-checked" base shape ready to be merged with probe results', () => {
    const base = emptyEnrollmentStatus();
    expect(base.reachability).toBe("unknown");
    expect(base.enrollment).toBeNull();
    expect(base.signInUrl).toBe("https://fleet.sigmashake.com");
    // checkedAt is an ISO timestamp, generated at call time.
    expect(() => new Date(base.checkedAt).toISOString()).not.toThrow();
    expect(new Date(base.checkedAt).getTime()).toBeGreaterThan(0);
  });
});
