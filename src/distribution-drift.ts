// Distribution drift probe — cross-channel parity report for SigmaShake Desktop.
//
// The motivating incident: x64 shipped to R2 at 0.1.99 and rolled into the
// GitHub release at v0.1.99, while arm64 sat at 0.1.98 in R2 and was *entirely
// missing* from the v0.1.99 GitHub release. Users on Apple Silicon downloaded
// the x64 binary (because the website served it as the macOS default) and ran
// it through Rosetta 2 — which hangs reliably on macOS 15.7+.
//
// This module probes the four surfaces that matter for cross-host
// coordination:
//
//   1. R2 update.json per lane  — the in-app Electrobun Updater target
//   2. R2 blob HEAD per lane    — proof the artifact is actually downloadable
//   3. GH latest release tag    — the user-facing first-download path
//   4. GH per-lane asset list   — does the latest tag have arm64? mac-x64? …
//
// All four are unauthenticated public reads; the cloud Worker proxies them
// because the CDN + GitHub API both block cross-origin browser fetches.
// Cached 60s in the Worker — drift moves on the order of minutes, not seconds.

const LANES = ["linux-x64", "win-x64", "macos-x64", "macos-arm64"] as const;
export type LaneId = (typeof LANES)[number];

const CDN_BASE = "https://download.sigmashake.com/desktop/electrobun";
const GH_API = "https://api.github.com/repos/sigmashakeinc/desktop/releases/latest";

const LANE_BLOB_FILENAME: Record<LaneId, string> = {
  "linux-x64": "stable-linux-x64-SigmaShakeDesktop.tar.zst",
  "win-x64": "stable-win-x64-SigmaShakeDesktop-Setup.exe",
  "macos-x64": "stable-macos-x64-SigmaShakeDesktop.dmg",
  "macos-arm64": "stable-macos-arm64-SigmaShakeDesktop.dmg",
};

const LANE_CATCHUP_MODE: Record<LaneId, string> = {
  "linux-x64": "desktop-only-linux",
  "win-x64": "desktop-only-win",
  "macos-x64": "desktop-only-mac",
  "macos-arm64": "desktop-only-mac",
};

export type LaneVerdict = "ok" | "stale" | "broken" | "missing" | "unknown";

export interface LaneDrift {
  lane: LaneId;
  r2Version: string | null;
  r2BlobHttp: number | null;
  ghHasAsset: boolean | null;
  verdict: LaneVerdict;
  /** One-line operator-readable explanation. */
  note: string;
  /** Suggested command to catch this lane up, if relevant. */
  catchUpCommand: string | null;
}

export interface DistributionDrift {
  generatedAt: string;
  ghLatestTag: string | null;
  /** Highest R2 update.json version across all lanes — the de-facto "current". */
  r2HighestVersion: string | null;
  /** Number of lanes whose verdict !== "ok". */
  driftedCount: number;
  lanes: LaneDrift[];
  /** SSG CLI publish channels reachable from a browser-facing Worker. */
  cliChannels: CliChannelDrift[];
  /** Number of CLI channels that are genuinely skewed (verdict === "stale"). */
  cliDriftedCount: number;
  /** The reference version every CLI channel is compared against (npm latest). */
  cliReferenceVersion: string | null;
  sources: {
    r2: boolean;
    github: boolean;
    /** True when at least one CLI registry answered. */
    cli: boolean;
  };
  /**
   * Why some CLI channels aren't probed here: apt + Flatpak live on the
   * sigmashake.com zone (a Worker on the same zone gets HTTP 522 on a loopback
   * fetch), and Docker/GHCR needs a token handshake. Those are covered by the
   * SSG daemon's /api/json/workspace/distribution view instead.
   */
  cliNote: string;
}

// ── SSG CLI publish channels ────────────────────────────────────────────────
// The desktop lanes above only cover SigmaShake Desktop. The CLI ships to npm,
// PyPI, crates.io, and GitHub Releases — all off the sigmashake.com zone, so
// this browser-facing Worker can reach them directly. npm is the coordinator
// package and the source of truth, so every other channel is compared to it.

const CLI_CHANNEL_META: Record<string, {label: string; short: string; url: string}> = {
  npm: {
    label: "npm — @sigmashake/ssg",
    short: "npm",
    url: "https://www.npmjs.com/package/@sigmashake/ssg",
  },
  pypi: {
    label: "PyPI — sigmashake",
    short: "PyPI",
    url: "https://pypi.org/project/sigmashake/",
  },
  cargo: {
    label: "crates.io — sigmashake-ssg",
    short: "crates.io",
    url: "https://crates.io/crates/sigmashake-ssg",
  },
  "github-cli": {
    label: "GitHub Releases — ssg",
    short: "GitHub Releases",
    url: "https://github.com/sigmashakeinc/ssg/releases/latest",
  },
};

export type CliChannelId = "npm" | "pypi" | "cargo" | "github-cli";
export type CliChannelVerdict = "ok" | "stale" | "unknown";

export interface CliChannelDrift {
  channel: CliChannelId;
  label: string;
  /** Latest version the channel serves, or null when the registry didn't answer. */
  version: string | null;
  verdict: CliChannelVerdict;
  note: string;
  url: string;
}

interface ProbeResult {
  r2Version: string | null;
  r2BlobHttp: number | null;
}

/**
 * R2-bucket-shaped interface — minimal slice we actually call. Avoids pulling
 * @cloudflare/workers-types into the test bundle (tests stub with a literal).
 */
export interface R2BindingLike {
  get(key: string): Promise<{ json(): Promise<unknown> } | null>;
  head(key: string): Promise<{ size?: number } | null>;
}

function laneUpdateKey(lane: LaneId): string {
  return `desktop/electrobun/stable-${lane}-update.json`;
}

function laneBlobKey(lane: LaneId): string {
  return `desktop/electrobun/${LANE_BLOB_FILENAME[lane]}`;
}

async function probeLane(
  lane: LaneId,
  fetchImpl: typeof fetch,
  r2: R2BindingLike | null,
): Promise<ProbeResult> {
  // Prefer the R2 binding when available — direct HTTPS to
  // download.sigmashake.com fails with HTTP 522 from any Worker also on
  // sigmashake.com (Cloudflare drops same-zone loopback fetches). R2 reads
  // sidestep the loopback. Falls back to HTTPS for `bun test` and for any
  // caller that wires the function up without an R2 binding.
  if (r2) {
    const [obj, head] = await Promise.all([
      r2.get(laneUpdateKey(lane)).catch(() => null),
      r2.head(laneBlobKey(lane)).catch(() => null),
    ]);
    let r2Version: string | null = null;
    if (obj) {
      try {
        const data = (await obj.json()) as { version?: unknown };
        if (typeof data.version === "string") r2Version = data.version;
      } catch {
        // malformed update.json — leave null, will surface as "unknown"
      }
    }
    return {
      r2Version,
      // r2.head() returns null on a missing object (→ 404) and a metadata
      // object (size, etc.) on a present one (→ 200). We don't see real HTTP
      // codes from the binding.
      r2BlobHttp: head ? 200 : 404,
    };
  }

  const updateJsonUrl = `${CDN_BASE}/stable-${lane}-update.json?cb=${Date.now()}`;
  const blobUrl = `${CDN_BASE}/${LANE_BLOB_FILENAME[lane]}`;

  const [updateRes, blobRes] = await Promise.all([
    fetchImpl(updateJsonUrl, { method: "GET" }).catch(() => null),
    fetchImpl(blobUrl, { method: "HEAD" }).catch(() => null),
  ]);

  let r2Version: string | null = null;
  if (updateRes?.ok) {
    try {
      const json = (await updateRes.json()) as { version?: unknown };
      if (typeof json.version === "string") r2Version = json.version;
    } catch {
      // malformed update.json — leave version null, will surface as "unknown"
    }
  }

  return {
    r2Version,
    r2BlobHttp: blobRes?.status ?? null,
  };
}

interface GitHubRelease {
  tag_name?: string;
  assets?: Array<{ name?: string }>;
}

async function probeGitHubLatest(
  fetchImpl: typeof fetch,
): Promise<{ tag: string | null; assetNames: Set<string> }> {
  try {
    const res = await fetchImpl(GH_API, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "sigmashake-workspace-distribution-drift/1.0",
      },
    });
    if (!res.ok) return { tag: null, assetNames: new Set() };
    const body = (await res.json()) as GitHubRelease;
    const tag = typeof body.tag_name === "string" ? body.tag_name : null;
    const names = new Set<string>();
    if (Array.isArray(body.assets)) {
      for (const a of body.assets) {
        if (a && typeof a.name === "string") names.add(a.name);
      }
    }
    return { tag, assetNames: names };
  } catch {
    return { tag: null, assetNames: new Set() };
  }
}

function laneHasGhAsset(lane: LaneId, assetNames: Set<string>): boolean {
  // We're permissive about extension — any asset whose name starts with
  // `stable-<lane>-` proves that lane shipped (.dmg, .app.tar.zst, .exe,
  // .AppImage, .patch, update.json all count).
  const prefix = `stable-${lane}-`;
  for (const n of assetNames) {
    if (n.startsWith(prefix)) return true;
  }
  return false;
}

function classifyLane(
  lane: LaneId,
  r2Version: string | null,
  r2BlobHttp: number | null,
  ghHasAsset: boolean | null,
  highestR2Version: string | null,
): { verdict: LaneVerdict; note: string } {
  if (r2Version === null) {
    return {
      verdict: "missing",
      note: `No stable-${lane}-update.json on R2 — this lane has never published.`,
    };
  }
  if (r2BlobHttp !== 200) {
    return {
      verdict: "broken",
      note: `R2 update.json claims ${r2Version} but blob ${LANE_BLOB_FILENAME[lane]} returns HTTP ${r2BlobHttp ?? "(no response)"} — users hit 404.`,
    };
  }
  if (highestR2Version && r2Version !== highestR2Version) {
    return {
      verdict: "stale",
      note: `Lane at ${r2Version}; another lane already shipped ${highestR2Version}.`,
    };
  }
  if (ghHasAsset === false) {
    return {
      verdict: "stale",
      note: `R2 is current at ${r2Version} but no stable-${lane}-* asset is on the latest GitHub release.`,
    };
  }
  return {
    verdict: "ok",
    note: `R2 at ${r2Version}, blob HTTP 200, GitHub asset present.`,
  };
}

function maxSemver(versions: Array<string | null>): string | null {
  const valid = versions.filter((v): v is string => typeof v === "string" && /^\d/.test(v));
  if (valid.length === 0) return null;
  return valid.sort((a, b) => {
    const pa = a.split(".").map((n) => parseInt(n, 10) || 0);
    const pb = b.split(".").map((n) => parseInt(n, 10) || 0);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
      const d = (pb[i] ?? 0) - (pa[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  })[0];
}

/** True when two semver-ish strings share the same numeric core (v-prefix ok). */
function versionsEqual(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const norm = (s: string) =>
    s
      .replace(/^v/, "")
      .split(".")
      .map((n) => parseInt(n, 10) || 0);
  const pa = norm(a);
  const pb = norm(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return false;
  }
  return true;
}

async function fetchNpmCliVersion(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("https://registry.npmjs.org/@sigmashake%2Fssg", {
      headers: {accept: "application/json"},
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {"dist-tags"?: {latest?: unknown}};
    const v = body["dist-tags"]?.latest;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

async function fetchPyPiCliVersion(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl("https://pypi.org/pypi/sigmashake/json", {
      headers: {accept: "application/json"},
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {info?: {version?: unknown}};
    const v = body.info?.version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

async function fetchCratesCliVersion(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    // crates.io 403s without a non-empty User-Agent.
    const res = await fetchImpl("https://crates.io/api/v1/crates/sigmashake-ssg", {
      headers: {
        accept: "application/json",
        "user-agent": "sigmashake-workspace-distribution-drift/1.0",
      },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      crate?: {max_stable_version?: unknown; newest_version?: unknown};
    };
    const v = body.crate?.max_stable_version ?? body.crate?.newest_version;
    return typeof v === "string" ? v : null;
  } catch {
    return null;
  }
}

async function fetchGithubCliVersion(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(
      "https://api.github.com/repos/sigmashakeinc/ssg/releases/latest",
      {
        headers: {
          accept: "application/vnd.github+json",
          "user-agent": "sigmashake-workspace-distribution-drift/1.0",
        },
      },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as {tag_name?: unknown};
    return typeof body.tag_name === "string" ? body.tag_name : null;
  } catch {
    return null;
  }
}

function classifyCliChannel(
  channel: CliChannelId,
  version: string | null,
  reference: string | null,
): CliChannelDrift {
  const meta = CLI_CHANNEL_META[channel]!;
  const base = {channel, label: meta.label, version, url: meta.url};
  if (version === null) {
    return {...base, verdict: "unknown", note: `Couldn't reach ${meta.short}.`};
  }
  if (channel === "npm") {
    return {...base, verdict: "ok", note: `npm serves ${version} — the CLI reference version.`};
  }
  if (reference === null) {
    return {
      ...base,
      verdict: "unknown",
      note: `${meta.short} serves ${version}; npm reference unavailable to compare against.`,
    };
  }
  if (versionsEqual(version, reference)) {
    return {...base, verdict: "ok", note: `Matches npm (${reference}).`};
  }
  return {
    ...base,
    verdict: "stale",
    note: `${meta.short} serves ${version}; npm is on ${reference}. This channel hasn't caught up.`,
  };
}

export async function buildDistributionDrift(
  fetchImpl: typeof fetch = fetch,
  r2: R2BindingLike | null = null,
): Promise<DistributionDrift> {
  const [probes, gh, cliVersions] = await Promise.all([
    Promise.all(LANES.map((lane) => probeLane(lane, fetchImpl, r2))),
    probeGitHubLatest(fetchImpl),
    Promise.all([
      fetchNpmCliVersion(fetchImpl),
      fetchPyPiCliVersion(fetchImpl),
      fetchCratesCliVersion(fetchImpl),
      fetchGithubCliVersion(fetchImpl),
    ]),
  ]);

  const r2Versions = probes.map((p) => p.r2Version);
  const highest = maxSemver(r2Versions);

  // npm is the coordinator package — the reference every other CLI channel is
  // measured against. A channel behind npm is genuinely stale.
  const [npmV, pypiV, cargoV, ghCliV] = cliVersions;
  const cliReferenceVersion = npmV;
  const cliChannels: CliChannelDrift[] = [
    classifyCliChannel("npm", npmV, cliReferenceVersion),
    classifyCliChannel("pypi", pypiV, cliReferenceVersion),
    classifyCliChannel("cargo", cargoV, cliReferenceVersion),
    classifyCliChannel("github-cli", ghCliV, cliReferenceVersion),
  ];
  const cliDriftedCount = cliChannels.filter((c) => c.verdict === "stale").length;
  const cliAnySuccess = cliChannels.some((c) => c.version !== null);

  let driftedCount = 0;
  let r2AnySuccess = false;
  const lanes: LaneDrift[] = LANES.map((lane, i) => {
    const { r2Version, r2BlobHttp } = probes[i]!;
    if (r2Version !== null) r2AnySuccess = true;
    const ghHasAsset = gh.tag === null ? null : laneHasGhAsset(lane, gh.assetNames);
    const { verdict, note } = classifyLane(lane, r2Version, r2BlobHttp, ghHasAsset, highest);
    if (verdict !== "ok") driftedCount += 1;
    return {
      lane,
      r2Version,
      r2BlobHttp,
      ghHasAsset,
      verdict,
      note,
      catchUpCommand: verdict === "ok" ? null : `/publish ${LANE_CATCHUP_MODE[lane]}`,
    };
  });

  return {
    generatedAt: new Date().toISOString(),
    ghLatestTag: gh.tag,
    r2HighestVersion: highest,
    driftedCount,
    lanes,
    cliChannels,
    cliDriftedCount,
    cliReferenceVersion,
    sources: {
      r2: r2AnySuccess,
      github: gh.tag !== null,
      cli: cliAnySuccess,
    },
    cliNote:
      "apt + Flatpak (sigmashake.com zone — Workers hit HTTP 522 on a same-zone fetch) and Docker/GHCR (needs a token handshake) are tracked by the SSG daemon's Distribution view.",
  };
}
