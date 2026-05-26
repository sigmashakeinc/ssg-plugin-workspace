#!/usr/bin/env bun
// Builds a static readiness snapshot from .sigmashake/production-readiness.json
// for the cloud Worker, which has no filesystem at runtime.
//
// Evaluation rules at build time:
//   - manual checks    → resolve straight from the manifest's `manual` block
//                         (status + evidence + updatedAt). Cloud + local agree.
//   - path-exists      → existsSync against the build host's filesystem. The
//                         paths are checked-in repo files, so build-time state
//                         is durable for the lifetime of this Worker bundle.
//   - cert-signal      → "unknown" with a clear hint. The cert scanner needs
//                         the operator's project tree + `.last-*-result`
//                         sentinels — the Worker can't reproduce either. The
//                         SPA already explains "open SigmaShake Desktop" via
//                         the `evidence` field.
//
// The local + electrobun + vscode + plugin runtimes still call the SSG daemon's
// /api/json/workspace/readiness for live cert-signal data. Only the cloud
// runtime reads the generated snapshot.
//
// Run automatically by the `generate` script in package.json.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type {
  ReadinessCategory,
  ReadinessProduct,
  ReadinessRequirement,
  ReadinessResponse,
  ReadinessStatus,
  ReadinessTotals,
} from "./types";

const MANIFEST_REL = join(".sigmashake", "production-readiness.json");

interface ManifestManual {
  status?: string;
  evidence?: string;
  updatedAt?: string;
}

interface ManifestCheck {
  kind?: string;
  project?: string;
  signal?: string;
  path?: string;
}

interface ManifestRequirement {
  id?: string;
  title?: string;
  detail?: string;
  category?: string;
  blocking?: boolean;
  check?: ManifestCheck;
  manual?: ManifestManual;
  remediation?: string;
}

interface ManifestProduct {
  id?: string;
  name?: string;
  blurb?: string;
  projects?: string[];
  requirements?: ManifestRequirement[];
}

interface Manifest {
  version?: number;
  updatedAt?: string;
  products?: ManifestProduct[];
}

const VALID_CATEGORIES: ReadinessCategory[] = [
  "quality",
  "security",
  "reliability",
  "release",
  "compliance",
  "docs",
];

function normalizeCategory(raw: string | undefined): ReadinessCategory {
  return VALID_CATEGORIES.includes(raw as ReadinessCategory)
    ? (raw as ReadinessCategory)
    : "quality";
}

function normalizeManualStatus(raw: string | undefined): ReadinessStatus {
  if (raw === "met" || raw === "unmet" || raw === "partial") return raw;
  return "unknown";
}

interface Resolved {
  status: ReadinessStatus;
  evidence: string;
  updatedAt?: string;
}

function resolveManual(manual: ManifestManual | undefined): Resolved {
  if (!manual) {
    return {
      status: "unknown",
      evidence: "manual requirement has no recorded status",
    };
  }
  return {
    status: normalizeManualStatus(manual.status),
    evidence: manual.evidence ?? "no evidence recorded",
    ...(manual.updatedAt !== undefined && { updatedAt: manual.updatedAt }),
  };
}

function resolvePathExists(monoRoot: string, rel: string | undefined): Resolved {
  if (!rel || rel.includes("..")) {
    return { status: "unknown", evidence: "check is missing a valid path" };
  }
  if (existsSync(join(monoRoot, rel))) {
    return { status: "met", evidence: `present: ${rel}` };
  }
  return { status: "unmet", evidence: `missing: ${rel}` };
}

function resolveCertSignal(project: string | undefined, signal: string | undefined): Resolved {
  if (!project || !signal) {
    return {
      status: "unknown",
      evidence: "cert-signal check is missing a project or signal",
    };
  }
  return {
    status: "unknown",
    evidence: `live signal "${signal}" (${project}) — open SigmaShake Desktop for live data`,
  };
}

function resolveRequirement(req: ManifestRequirement, monoRoot: string): ReadinessRequirement {
  const check = req.check ?? {};
  let resolved: Resolved;
  let source: "auto" | "manual" = "auto";

  if (check.kind === "cert-signal") {
    resolved = resolveCertSignal(check.project, check.signal);
  } else if (check.kind === "path-exists") {
    resolved = resolvePathExists(monoRoot, check.path);
  } else if (check.kind === "manual") {
    resolved = resolveManual(req.manual);
    source = "manual";
  } else {
    resolved = {
      status: "unknown",
      evidence: `unrecognized check kind "${check.kind ?? "none"}"`,
    };
  }

  const out: ReadinessRequirement = {
    id: req.id ?? "unknown",
    title: req.title ?? req.id ?? "Untitled requirement",
    detail: req.detail ?? "",
    category: normalizeCategory(req.category),
    blocking: req.blocking === true,
    status: resolved.status,
    source,
    evidence: resolved.evidence,
  };
  if (resolved.status !== "met" && req.remediation) out.remediation = req.remediation;
  if (resolved.updatedAt) out.updatedAt = resolved.updatedAt;
  return out;
}

function evaluateProduct(product: ManifestProduct, monoRoot: string): ReadinessProduct {
  const reqs = Array.isArray(product.requirements) ? product.requirements : [];
  const requirements = reqs.map((r) => resolveRequirement(r, monoRoot));
  const totals: ReadinessTotals = {
    met: 0,
    unmet: 0,
    partial: 0,
    unknown: 0,
    total: requirements.length,
  };
  let blockerCount = 0;
  for (const r of requirements) {
    totals[r.status] += 1;
    if (r.blocking && r.status !== "met") blockerCount += 1;
  }
  return {
    id: product.id ?? "unknown",
    name: product.name ?? product.id ?? "Untitled product",
    blurb: product.blurb ?? "",
    projects: Array.isArray(product.projects) ? product.projects : [],
    ready: blockerCount === 0,
    blockerCount,
    totals,
    requirements,
  };
}

export function evaluateManifestAt(monoRoot: string): ReadinessResponse {
  const path = join(monoRoot, MANIFEST_REL);
  if (!existsSync(path)) {
    return {
      generatedAt: Date.now(),
      ready: false,
      readyProductCount: 0,
      productCount: 0,
      totalBlockers: 0,
      products: [],
      manifestError:
        `no production-readiness manifest at ${MANIFEST_REL} — ` +
        "create it to start tracking production readiness",
    };
  }
  let parsed: Manifest;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      generatedAt: Date.now(),
      ready: false,
      readyProductCount: 0,
      productCount: 0,
      totalBlockers: 0,
      products: [],
      manifestError: `manifest failed to parse: ${message}`,
    };
  }
  if (!parsed || !Array.isArray(parsed.products)) {
    return {
      generatedAt: Date.now(),
      ready: false,
      readyProductCount: 0,
      productCount: 0,
      totalBlockers: 0,
      products: [],
      manifestError: "manifest is malformed — expected a top-level `products` array",
    };
  }
  const products = parsed.products.map((p) => evaluateProduct(p, monoRoot));
  let readyProductCount = 0;
  let totalBlockers = 0;
  for (const p of products) {
    if (p.ready) readyProductCount += 1;
    totalBlockers += p.blockerCount;
  }
  return {
    generatedAt: Date.now(),
    ready: products.length > 0 && readyProductCount === products.length,
    readyProductCount,
    productCount: products.length,
    totalBlockers,
    products,
    manifestError: null,
  };
}

function main(): void {
  const ROOT = resolve(import.meta.dir, "..");
  const MONO_ROOT = resolve(ROOT, "..");
  const OUT = join(ROOT, "src", "readiness.generated.ts");
  const report = evaluateManifestAt(MONO_ROOT);
  const banner =
    "// AUTO-GENERATED by src/build-readiness.ts — do not edit.\n" +
    "// Re-run `bun run src/build-readiness.ts` or `bun run generate`.\n\n";
  const body =
    "import type {ReadinessResponse} from './types';\n\n" +
    "export const READINESS_REPORT: ReadinessResponse = " +
    JSON.stringify(report, null, 2) +
    ";\n";
  writeFileSync(OUT, banner + body);
  const tag = report.manifestError
    ? `error: ${report.manifestError}`
    : `${report.readyProductCount}/${report.productCount} products ready, ` +
      `${report.totalBlockers} total blockers`;
  console.log(`readiness: wrote snapshot → src/readiness.generated.ts (${tag})`);
}

if (import.meta.main) {
  main();
}
