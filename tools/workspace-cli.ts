#!/usr/bin/env bun
/**
 * sigmashake-workspace — operator / agent CLI.
 *
 * A headless control surface over the monorepo workspace API — the SSG daemon's
 * `/api/json/workspace/*` routes. Lets an AI agent enumerate monorepo projects,
 * read per-project health, pull the workspace context bundle, and read the
 * AI-native scorecard without the workspace SPA. Zero dependencies.
 *
 * Config (env):
 *   WORKSPACE_BASE_URL  API base (default http://127.0.0.1:7901 — the SSG daemon)
 *   WORKSPACE_TOKEN     SSG dashboard token (sent as X-SigmaShake-Token) when set
 *
 * Usage:
 *   sigmashake-workspace projects
 *   sigmashake-workspace health [--projects a,b,c]
 *   sigmashake-workspace context
 *   sigmashake-workspace ai-native [--slug <name>]
 *   sigmashake-workspace --help
 *
 * Exit codes: 0 ok, 1 runtime/HTTP error, 2 usage error.
 */

const BASE_URL = (
  process.env.WORKSPACE_BASE_URL ?? "http://127.0.0.1:7901"
).replace(/\/+$/, "");

interface Flags {
  _: string[];
  [key: string]: string | boolean | string[];
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {_: []};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      flags._.push(arg);
    }
  }
  return flags;
}

function out(data: unknown): void {
  console.log(JSON.stringify(data, null, 2));
}

function fail(message: string, code = 1): never {
  console.error(`error: ${message}`);
  process.exit(code);
}

const HELP = `sigmashake-workspace — monorepo workspace CLI

Usage:
  sigmashake-workspace projects                  list monorepo projects
  sigmashake-workspace health [--projects a,b]   per-project git/deploy/test health
  sigmashake-workspace context                   aggregated workspace context bundle
  sigmashake-workspace ai-native [--slug <name>] AI-native readiness scorecard
  sigmashake-workspace --help

Env:
  WORKSPACE_BASE_URL  API base (default http://127.0.0.1:7901 — the SSG daemon)
  WORKSPACE_TOKEN     SSG dashboard token, sent as X-SigmaShake-Token when set`;

async function get(path: string): Promise<void> {
  const headers: Record<string, string> = {};
  const tok = process.env.WORKSPACE_TOKEN;
  if (tok) headers["X-SigmaShake-Token"] = tok;
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {headers});
  } catch (err) {
    fail(
      `request failed: ${err instanceof Error ? err.message : String(err)} — is the SSG daemon running on ${BASE_URL}?`,
    );
  }
  const text = await res.text();
  let parsed: unknown = text;
  try {
    parsed = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  out({ok: res.ok, status: res.status, path, response: parsed});
  if (!res.ok) process.exit(1);
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const cmd = flags._[0];
  if (!cmd || flags.help || cmd === "help") {
    console.log(HELP);
    process.exit(cmd ? 0 : 2);
  }
  switch (cmd) {
    case "projects":
      await get("/api/json/workspace/projects");
      break;
    case "health": {
      const p = typeof flags.projects === "string" ? flags.projects : "";
      await get(
        `/api/json/workspace/health${p ? `?projects=${encodeURIComponent(p)}` : ""}`,
      );
      break;
    }
    case "context":
      await get("/api/json/workspace/context");
      break;
    case "ai-native": {
      const slug = typeof flags.slug === "string" ? flags.slug : "";
      await get(
        `/api/json/workspace/ai-native${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`,
      );
      break;
    }
    default:
      fail(`unknown command: ${cmd}`, 2);
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));
