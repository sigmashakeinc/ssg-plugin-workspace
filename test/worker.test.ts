import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

// Tests run against the same wrangler.toml as production, so the auth gate is
// real. Mint a session in the ACCOUNTS_SESSIONS KV binding before each
// authenticated request, then send a matching `session_id` cookie.

const OPERATOR_ID = "11810205";
const SESSION_ID = "test-session-id";
const SESSION_KEY = `session:${SESSION_ID}`;

async function mintOperatorSession() {
  await env.ACCOUNTS_SESSIONS.put(
    SESSION_KEY,
    JSON.stringify({
      userId: OPERATOR_ID,
      login: "test-operator",
      avatar: "https://example.com/avatar.png",
      authType: "github",
      token: "encrypted-blob-not-used-here",
    }),
  );
}

async function mintNonOperatorSession() {
  await env.ACCOUNTS_SESSIONS.put(
    SESSION_KEY,
    JSON.stringify({
      userId: "99999999",
      login: "some-chatter",
      authType: "twitch",
      token: "encrypted-blob-not-used-here",
    }),
  );
}

function authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Cookie", `session_id=${SESSION_ID}`);
  return SELF.fetch(`https://workspace.sigmashake.com${path}`, { ...init, headers });
}

describe("auth gate", () => {
  beforeEach(async () => {
    // Reset any leftover session so each test starts clean.
    await env.ACCOUNTS_SESSIONS.delete(SESSION_KEY);
  });

  it("redirects unauthenticated HTML requests to accounts.sigmashake.com", async () => {
    const res = await SELF.fetch("https://workspace.sigmashake.com/", {
      headers: { Accept: "text/html" },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("Location") ?? "";
    expect(location).toContain("accounts.sigmashake.com/auth/login");
    expect(location).toContain(`next=${encodeURIComponent("https://workspace.sigmashake.com/")}`);
  });

  it("returns 401 JSON for unauthenticated API requests", async () => {
    const res = await SELF.fetch("https://workspace.sigmashake.com/api/workspace/projects");
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unauthorized");
  });

  it("rejects sessions whose userId isn't on the operator allowlist", async () => {
    await mintNonOperatorSession();
    const res = await authedFetch("/api/workspace/projects");
    expect(res.status).toBe(401);
  });

  it("rejects an invalid session_id cookie", async () => {
    // No session minted in KV — the cookie value is a bare guess.
    const res = await SELF.fetch("https://workspace.sigmashake.com/api/workspace/projects", {
      headers: { Cookie: "session_id=does-not-exist" },
    });
    expect(res.status).toBe(401);
  });

  it("leaves /healthz open without a session", async () => {
    const res = await SELF.fetch("https://workspace.sigmashake.com/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

describe("authenticated routes", () => {
  beforeEach(async () => {
    await mintOperatorSession();
  });

  it("GET /api/workspace/projects returns the registry", async () => {
    const res = await authedFetch("/api/workspace/projects");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { root: string; projects: unknown[] };
    expect(body).toHaveProperty("root");
    expect(Array.isArray(body.projects)).toBe(true);
  });

  it("GET /api/workspace/projects exposes the sigmashake-vcs card", async () => {
    // VCS was missing from CLAUDE.md's <structure> until 2026-05-16, so the
    // workspace cloud never surfaced it. Pin the round-trip so a future
    // structure-block edit that drops the bullet trips the test, not prod.
    const res = await authedFetch("/api/workspace/projects");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projects: Array<{
        slug: string;
        type: string;
        hasWranglerToml: boolean;
        hasClaudeMd: boolean;
        description: string;
        testKinds?: Record<string, boolean | undefined>;
      }>;
    };
    const vcs = body.projects.find((p) => p.slug === "sigmashake-vcs");
    expect(vcs, "sigmashake-vcs missing from /api/workspace/projects").toBeDefined();
    expect(vcs?.type).toBe("cf-worker");
    expect(vcs?.hasWranglerToml).toBe(true);
    expect(vcs?.hasClaudeMd).toBe(true);
    expect(vcs?.description).toMatch(/Vibe Coder Sim/i);
    expect(vcs?.testKinds?.integration).toBe(true);
    expect(vcs?.testKinds?.e2e).toBe(true);
    expect(vcs?.testKinds?.sast).toBe(true);
  });

  it("GET /api/session/me reports the signed-in operator", async () => {
    const res = await authedFetch("/api/session/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      userId: string;
      login: string;
      avatar?: string;
    };
    expect(body.userId).toBe(OPERATOR_ID);
    expect(body.login).toBe("test-operator");
  });

  it("GET /api/workspace/infrastructure stays 501 even when authed", async () => {
    const res = await authedFetch("/api/workspace/infrastructure");
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("local_only");
  });

  it("POST /api/workspace/run is local_only", async () => {
    const res = await authedFetch("/api/workspace/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ project: "sigmashake-gov", script: "test" }),
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("local_only");
  });
});

// Parity coverage for OAuth providers other than GitHub. Accounts mints
// sessions with authType set to the upstream OAuth provider — workspace must
// honour those identically since it only reads the session, not the flow.
describe("operator session validation across all accounts OAuth providers", () => {
  beforeEach(async () => {
    await env.ACCOUNTS_SESSIONS.delete(SESSION_KEY);
  });

  async function mintOperatorWithAuthType(authType: string) {
    await env.ACCOUNTS_SESSIONS.put(
      SESSION_KEY,
      JSON.stringify({
        userId: OPERATOR_ID,
        login: `operator-${authType}`,
        avatar: "https://example.com/avatar.png",
        authType,
        token: "encrypted-blob-not-used-here",
      }),
    );
  }

  for (const authType of ["github", "google", "microsoft", "apple"] as const) {
    it(`accepts a session minted by accounts with authType="${authType}"`, async () => {
      await mintOperatorWithAuthType(authType);
      const res = await authedFetch("/api/session/me");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { userId: string; login: string };
      expect(body.userId).toBe(OPERATOR_ID);
      expect(body.login).toBe(`operator-${authType}`);
    });

    it(`exposes registry to operators whose session has authType="${authType}"`, async () => {
      await mintOperatorWithAuthType(authType);
      const res = await authedFetch("/api/workspace/projects");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { projects: unknown[] };
      expect(Array.isArray(body.projects)).toBe(true);
    });
  }
});
