#!/usr/bin/env bun

/**
 * sigmashake-workspace parity walkthrough — interactive harness for clearing
 * the manual-attestation backlog on the SigmaShake Desktop platform-parity
 * matrix. Reads `PLATFORM_PARITY_CATALOG`, filters to rows whose
 * `verificationKind === "manual"` AND that apply to the chosen OS, then for
 * each row prints the verification steps and prompts the operator for
 * pass/fail/partial/skip + evidence. Each verdict is POSTed to the local SSG
 * daemon's `/api/json/workspace/platform-parity/attest` so the matrix
 * actually reflects the attestation when the operator is done.
 *
 * Defaults to the current host's OS. Filters with `--os linux|darwin|win32`,
 * `--severity blocking|recommended|all`, `--ids a,b,c`, `--unknown-only`.
 *
 * Config (env):
 *   WORKSPACE_BASE_URL  daemon base URL (default http://127.0.0.1:7901)
 *   WORKSPACE_TOKEN     dashboard token (sent as X-SigmaShake-Token when set)
 *
 * Exit codes: 0 ok, 1 runtime/HTTP/attest error, 2 usage error.
 */

import { platform } from "node:os";
import { createInterface, type Interface } from "node:readline";
import {
  PLATFORM_PARITY_CATALOG,
  type PlatformParityCatalogEntry,
} from "../src/platform-parity-catalog";

type PlatformOs = "linux" | "darwin" | "win32";
type AttestStatus = "pass" | "fail" | "partial" | "skipped" | "unknown";

const BASE_URL = (process.env.WORKSPACE_BASE_URL ?? "http://127.0.0.1:7901").replace(/\/+$/, "");

interface Flags {
  os: PlatformOs;
  severity: "blocking" | "recommended" | "all";
  ids: Set<string> | null;
  unknownOnly: boolean;
  dryRun: boolean;
  listOnly: boolean;
}

function currentOs(): PlatformOs {
  const p = platform();
  if (p === "linux" || p === "darwin" || p === "win32") return p;
  console.error(`error: unsupported os ${p}; pass --os explicitly`);
  process.exit(2);
}

function parseArgs(argv: string[]): Flags {
  const flags: Flags = {
    os: currentOs(),
    severity: "all",
    ids: null,
    unknownOnly: false,
    dryRun: false,
    listOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") {
      printHelp();
      process.exit(0);
    } else if (a === "--os") {
      const v = argv[++i];
      if (v !== "linux" && v !== "darwin" && v !== "win32") {
        console.error(`error: --os must be linux|darwin|win32`);
        process.exit(2);
      }
      flags.os = v;
    } else if (a === "--severity") {
      const v = argv[++i];
      if (v !== "blocking" && v !== "recommended" && v !== "all") {
        console.error(`error: --severity must be blocking|recommended|all`);
        process.exit(2);
      }
      flags.severity = v;
    } else if (a === "--ids") {
      flags.ids = new Set(
        argv[++i]
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      );
    } else if (a === "--unknown-only") {
      flags.unknownOnly = true;
    } else if (a === "--dry-run") {
      flags.dryRun = true;
    } else if (a === "--list") {
      flags.listOnly = true;
    } else {
      console.error(`error: unknown arg ${a}`);
      process.exit(2);
    }
  }
  return flags;
}

function printHelp(): void {
  console.log(
    `sigmashake-workspace parity walkthrough\n\n` +
      `Usage:\n` +
      `  bun tools/parity-walkthrough.ts [flags]\n\n` +
      `Flags:\n` +
      `  --os <linux|darwin|win32>      target column (default: current host)\n` +
      `  --severity <blocking|recommended|all>  filter rows (default: all)\n` +
      `  --ids <a,b,c>                  walk only these feature ids\n` +
      `  --unknown-only                 skip rows already attested\n` +
      `  --dry-run                      print prompts but don't POST attestations\n` +
      `  --list                         list applicable rows + exit (no prompts)\n` +
      `  --help, -h                     this help\n\n` +
      `Env:\n` +
      `  WORKSPACE_BASE_URL  daemon base URL (default http://127.0.0.1:7901)\n` +
      `  WORKSPACE_TOKEN     dashboard token (sent as X-SigmaShake-Token when set)`,
  );
}

function applicable(entry: PlatformParityCatalogEntry, os: PlatformOs): boolean {
  return entry.expectedFor === "all" || entry.expectedFor === os;
}

interface CurrentMatrix {
  features: Array<{
    id: string;
    results: Record<PlatformOs, { status: AttestStatus | "not-applicable" } | null>;
  }>;
}

async function fetchCurrentMatrix(): Promise<CurrentMatrix | null> {
  const headers: Record<string, string> = {};
  const tok = process.env.WORKSPACE_TOKEN;
  if (tok) headers["X-SigmaShake-Token"] = tok;
  try {
    const res = await fetch(`${BASE_URL}/api/json/workspace/platform-parity`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as CurrentMatrix;
  } catch {
    return null;
  }
}

async function postAttest(
  featureId: string,
  os: PlatformOs,
  status: AttestStatus,
  evidence: string,
): Promise<{ ok: boolean; status: number; body: string }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const tok = process.env.WORKSPACE_TOKEN;
  if (tok) headers["X-SigmaShake-Token"] = tok;
  const res = await fetch(`${BASE_URL}/api/json/workspace/platform-parity/attest`, {
    method: "POST",
    headers,
    body: JSON.stringify({ featureId, os, status, evidence }),
  });
  return { ok: res.ok, status: res.status, body: await res.text() };
}

async function ask(rl: Interface, prompt: string): Promise<string> {
  return new Promise((resolve) => rl.question(prompt, (a) => resolve(a)));
}

function parseStatus(input: string): AttestStatus | null {
  const v = input.trim().toLowerCase();
  if (v === "p" || v === "pass") return "pass";
  if (v === "f" || v === "fail") return "fail";
  if (v === "x" || v === "partial") return "partial";
  if (v === "s" || v === "skip" || v === "skipped") return "skipped";
  if (v === "u" || v === "unknown") return "unknown";
  return null;
}

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  const rows = PLATFORM_PARITY_CATALOG.filter(
    (e) => e.verificationKind === "manual" && applicable(e, flags.os),
  )
    .filter((e) => flags.severity === "all" || e.severity === flags.severity)
    .filter((e) => !flags.ids || flags.ids.has(e.id));

  if (rows.length === 0) {
    console.error(`error: no rows match filters`);
    process.exit(2);
  }

  const matrix = await fetchCurrentMatrix();
  const knownCell = (id: string): "attested" | "unknown" => {
    if (!matrix) return "unknown";
    const f = matrix.features.find((x) => x.id === id);
    if (!f) return "unknown";
    const cell = f.results[flags.os];
    if (!cell) return "unknown";
    if (cell.status === "not-applicable") return "attested";
    return cell.status === "pass" ||
      cell.status === "fail" ||
      cell.status === "partial" ||
      cell.status === "skipped"
      ? "attested"
      : "unknown";
  };

  const filtered = flags.unknownOnly ? rows.filter((e) => knownCell(e.id) === "unknown") : rows;

  if (flags.listOnly) {
    console.log(
      `# parity rows applicable to ${flags.os} (manual${flags.severity !== "all" ? ` · ${flags.severity}` : ""}${flags.unknownOnly ? " · unknown-only" : ""}) — ${filtered.length} of ${rows.length}\n`,
    );
    for (const e of filtered) {
      const sev = e.severity === "blocking" ? "*" : " ";
      const state = knownCell(e.id);
      console.log(`  ${sev} [${state}] ${e.id} — ${e.label}`);
    }
    return;
  }

  if (matrix === null) {
    console.error(
      `warning: could not GET ${BASE_URL}/api/json/workspace/platform-parity — current cell states unknown; continuing with prompts anyway`,
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  let done = 0;
  let attested = 0;
  let errored = 0;
  console.log(
    `\nWalking ${filtered.length} manual parity row(s) on the ${flags.os} column.\n` +
      `For each: read the verification, do it, then enter:\n` +
      `  p = pass, f = fail, x = partial, s = skip, u = unknown, q = quit walkthrough\n`,
  );

  for (const e of filtered) {
    done += 1;
    const state = knownCell(e.id);
    console.log(
      `\n[${done}/${filtered.length}] ${e.severity === "blocking" ? "★" : "·"} ${e.id} — ${e.label}`,
    );
    console.log(`  category: ${e.category} · current cell: ${state}`);
    console.log(`  ${e.description}`);
    console.log(`  → verification (${flags.os}):`);
    console.log(`    ${e.verification[flags.os]}`);
    const verdictRaw = (await ask(rl, "  verdict [p/f/x/s/u/q]: ")).trim().toLowerCase();
    if (verdictRaw === "q") {
      console.log("quitting walkthrough.");
      break;
    }
    const status = parseStatus(verdictRaw);
    if (!status) {
      console.log("  (no valid verdict — skipping this row)");
      continue;
    }
    const evidenceRaw = (await ask(rl, "  evidence (one line, ≤800 chars): ")).trim();
    if (!evidenceRaw) {
      console.log("  (empty evidence — skipping this row to keep attestations meaningful)");
      continue;
    }
    if (flags.dryRun) {
      console.log(
        `  [dry-run] would POST {featureId:${e.id}, os:${flags.os}, status:${status}, evidence:"${evidenceRaw.slice(0, 80)}…"}`,
      );
      continue;
    }
    const r = await postAttest(e.id, flags.os, status, evidenceRaw);
    if (!r.ok) {
      errored += 1;
      console.log(`  ⚠ attest POST failed: HTTP ${r.status} ${r.body.slice(0, 200)}`);
    } else {
      attested += 1;
      console.log(`  ✓ attested as ${status}`);
    }
  }
  rl.close();
  console.log(
    `\nwalkthrough done — attested ${attested} · errored ${errored} of ${done} processed.`,
  );
  if (errored > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`fatal: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
