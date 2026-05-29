// Production vs non-production classification for monorepo subprojects.
//
// The sigmashake-mono tree fuses two operations:
//   - the SigmaShake governance platform (the B2B product — "production")
//   - the OBS / Twitch / YouTube streaming op that markets it ("non-production")
//
// This module is the single source of truth for the *default* split. The
// operator adjusts it per-project via `WorkspaceSettings.lineOverrides`, which
// always wins over the seed below. `resolveLine()` folds the two together.
//
// Identity note: keys are project slugs (the directory name, e.g.
// `sigmashake-obs`). Adding a brand-new streaming service? Drop its slug into
// STREAMING_SLUGS so it defaults correctly without the operator having to
// re-bucket it by hand.

import type { ProjectLine } from "../api/types";

export type { ProjectLine };

/**
 * Seed set of the OBS / Twitch / YouTube streaming-op services — everything
 * whose job is to run or enrich the live stream that markets the product, not
 * the product itself. Anything NOT listed here defaults to "production".
 *
 * Borderline calls (e.g. sigmashake-discord is a community bot that also
 * carries a GitHub webhook) are seeded to their most common day-to-day use and
 * left for the operator to flip.
 */
export const STREAMING_SLUGS: ReadonlySet<string> = new Set<string>([
  "sigmashake-abyss", // SIGMA ABYSS edge — Agent Realm / Oracle Bazaar (stream game infra)
  "sigmashake-ask", // viewer Q&A surface
  "sigmashake-bets", // SaltyBet-piggyback parimutuel betting
  "sigmashake-break-the-bot", // Break the Bot stream game archive
  "sigmashake-chat-elixir", // Twitch/YouTube chat stack
  "sigmashake-discord", // community Discord bot + YouTube content mining
  "sigmashake-emotes", // animated Twitch emotes for Navi
  "sigmashake-mmo", // SIGMA ABYSS retro auto-battler MMO
  "sigmashake-modcontrol", // remote OBS moderator control plane
  "sigmashake-navi-cache", // Navi brain reply cache backup
  "sigmashake-navi-elixir", // Navi avatar brain (TTS/STT/FSM)
  "sigmashake-obs", // OBS control plane + stream automation
  "sigmashake-streamcord", // Twitch/YouTube go-live alerts
  "sigmashake-trends", // pre-stream trending-topic aggregator
  "sigmashake-twitch", // clip orchestrator + segment pipeline
  "sigmashake-twitch-events", // Twitch EventSub webhook receiver
  "sigmashake-vcs", // Vibe Coder Sim character builder
  "sigmashake-yt-chat", // YouTube chat (stub)
]);

/** Human-facing label for each line. */
export const LINE_LABEL: Record<ProjectLine, string> = {
  production: "Production",
  "non-production": "Non-production",
};

/** Short chip text (kept tight for the card badge). */
export const LINE_BADGE: Record<ProjectLine, string> = {
  production: "Prod",
  "non-production": "Stream",
};

/** Longer descriptor for tooltips / settings copy. */
export const LINE_DESCRIPTION: Record<ProjectLine, string> = {
  production: "SigmaShake governance platform — the product we ship and sell.",
  "non-production": "OBS / Twitch / YouTube streaming op that markets the product.",
};

/** The seeded default for a slug, before any operator override. */
export function defaultLine(slug: string): ProjectLine {
  return STREAMING_SLUGS.has(slug) ? "non-production" : "production";
}

/** True only for the two literal line values — guards untrusted JSON. */
export function isProjectLine(value: unknown): value is ProjectLine {
  return value === "production" || value === "non-production";
}

/**
 * Resolve the effective line for a slug: an operator override (if present and
 * valid) wins over the seeded default.
 */
export function resolveLine(
  slug: string,
  overrides: Record<string, ProjectLine> | undefined,
): ProjectLine {
  const override = overrides?.[slug];
  if (isProjectLine(override)) return override;
  return defaultLine(slug);
}

/**
 * Sanitise an untrusted overrides map: keep only well-formed slug keys mapped
 * to a valid line. Shared by the client settings normaliser and (mirrored) by
 * the daemon so a hand-edited workspace.json can't poison the UI.
 */
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export function normalizeLineOverrides(raw: unknown): Record<string, ProjectLine> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, ProjectLine> = {};
  for (const [slug, line] of Object.entries(raw as Record<string, unknown>)) {
    if (SLUG_RE.test(slug) && isProjectLine(line)) out[slug] = line;
  }
  return out;
}

/**
 * Compute the next overrides map after setting one project's line. Passing the
 * slug's seeded default *clears* the override (keeps the map minimal) so the
 * stored set only ever contains genuine deviations from the seed.
 */
export function withLineOverride(
  overrides: Record<string, ProjectLine>,
  slug: string,
  line: ProjectLine,
): Record<string, ProjectLine> {
  const next = { ...overrides };
  if (line === defaultLine(slug)) {
    delete next[slug];
  } else {
    next[slug] = line;
  }
  return next;
}

/**
 * Apply a batch of line assignments at once (the bulk editor's primitive).
 * Each entry is folded through `withLineOverride`, so assignments that match a
 * slug's seeded default clear that slug's override instead of recording a
 * redundant one. The input map is not mutated.
 */
export function withLineOverrides(
  overrides: Record<string, ProjectLine>,
  updates: Record<string, ProjectLine>,
): Record<string, ProjectLine> {
  let next = { ...overrides };
  for (const [slug, line] of Object.entries(updates)) {
    if (isProjectLine(line)) next = withLineOverride(next, slug, line);
  }
  return next;
}
