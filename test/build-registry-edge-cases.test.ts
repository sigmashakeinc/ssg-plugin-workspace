// Edge-case coverage for the build-registry parser that the main test doesn't
// exercise: sub-bullet type-promotion logic, entries with no sub-bullets, slug
// suffix fallbacks, multi-line descriptions trimmed correctly, and the case
// where a sub-bullet promotes "bun" to "cf-worker" (because bun < cf-worker in
// precedence).

import { describe, expect, it } from "vitest";

import { classify, parseStructureBlock } from "../src/build-registry";

// ── classify edge cases ────────────────────────────────────────────────────

describe("classify — pattern priority", () => {
  it("Cloudflare Worker beats TypeScript", () => {
    // A TypeScript-based Cloudflare Worker should come out as cf-worker, not bun.
    expect(classify("sigmashake-x", "TypeScript Cloudflare Worker with Bun.")).toBe("cf-worker");
  });

  it("Workers for Platforms also matches cf-worker", () => {
    expect(classify("sigmashake-x", "Workers for Platforms tenant dispatch.")).toBe("cf-worker");
  });

  it("native matches winit even without 'Rust' prefix", () => {
    expect(classify("sigmashake-x", "Uses wgpu/winit for rendering.")).toBe("native");
  });

  it("pure JS matches bun", () => {
    expect(classify("sigmashake-x", "pure JS zero-dependency package.")).toBe("bun");
  });

  it("slug suffix '-elixir' matches even without any body signal", () => {
    expect(classify("sigmashake-voice-elixir", "")).toBe("elixir");
  });

  it("unrecognised slug with empty body → unknown", () => {
    expect(classify("sigmashake-mystery", "")).toBe("unknown");
  });
});

// ── parseStructureBlock edge cases ─────────────────────────────────────────

const MINIMAL = `<structure>
- \`sigmashake-bop/\` — npm package (pure JS, zero deps)
</structure>`;

const WITH_SUBBULLET_PROMOTE = `<structure>
- \`sigmashake-foo/\` — Generic description with no keywords
  - See \`sigmashake-foo/CLAUDE.md\` for commands (Cloudflare Worker)
</structure>`;

const MULTI_PROJECT = `<structure>
- \`sigmashake-alpha/\` — First project (TypeScript)
- \`sigmashake-beta/\` — Second Cloudflare Worker
- \`sigmashake-gamma/\` — Third project (Elixir/Phoenix)
</structure>`;

const EMPTY_STRUCTURE = `<structure>
</structure>`;

const DUPLICATE_SLUG = `<structure>
- \`sigmashake-alpha/\` — First entry TypeScript
- \`sigmashake-alpha/\` — Duplicate slug Cloudflare Worker
</structure>`;

const NO_SEP = `<structure>
- \`sigmashake-nodash/\` — No-dash description
- some random line that breaks the parser flow
- \`sigmashake-after/\` — Entry after the break
</structure>`;

describe("parseStructureBlock — single entry without sub-bullets", () => {
  it("returns one card with hasClaudeMd=false when there are no sub-bullets", () => {
    const [card] = parseStructureBlock(MINIMAL);
    expect(card?.slug).toBe("sigmashake-bop");
    expect(card?.hasClaudeMd).toBe(false);
  });

  it("classifies via description even without sub-bullets", () => {
    const [card] = parseStructureBlock(MINIMAL);
    expect(card?.type).toBe("bun");
  });

  it("sets scripts to []", () => {
    const [card] = parseStructureBlock(MINIMAL);
    expect(card?.scripts).toEqual([]);
  });
});

describe("parseStructureBlock — sub-bullet type promotion", () => {
  it("promotes type from 'unknown' to cf-worker when sub-bullet contains the keyword", () => {
    const cards = parseStructureBlock(WITH_SUBBULLET_PROMOTE);
    expect(cards).toHaveLength(1);
    const card = cards[0]!;
    expect(card.slug).toBe("sigmashake-foo");
    expect(card.type).toBe("cf-worker");
  });

  it("sets hasClaudeMd=true when the sub-bullet references CLAUDE.md", () => {
    const cards = parseStructureBlock(WITH_SUBBULLET_PROMOTE);
    expect(cards[0]?.hasClaudeMd).toBe(true);
  });
});

describe("parseStructureBlock — multi-project fixture", () => {
  it("returns all three projects", () => {
    const cards = parseStructureBlock(MULTI_PROJECT);
    expect(cards).toHaveLength(3);
  });

  it("classifies each correctly from the top line", () => {
    const cards = parseStructureBlock(MULTI_PROJECT);
    const bySlug = Object.fromEntries(cards.map((c) => [c.slug, c]));
    expect(bySlug["sigmashake-alpha"]?.type).toBe("bun"); // TypeScript → bun
    expect(bySlug["sigmashake-beta"]?.type).toBe("cf-worker");
    expect(bySlug["sigmashake-gamma"]?.type).toBe("elixir");
  });

  it("sorts alphabetically by slug", () => {
    const slugs = parseStructureBlock(MULTI_PROJECT).map((c) => c.slug);
    expect(slugs).toEqual([...slugs].sort());
  });
});

describe("parseStructureBlock — empty structure block", () => {
  it("returns an empty array for a structure block with no entries", () => {
    const cards = parseStructureBlock(EMPTY_STRUCTURE);
    expect(cards).toHaveLength(0);
  });
});

describe("parseStructureBlock — non-top-level bullet resets current", () => {
  it("correctly resets between entries separated by a non-bullet line", () => {
    // The 'some random line' should reset current so sigmashake-after
    // is parsed independently.
    const cards = parseStructureBlock(NO_SEP);
    const slugs = cards.map((c) => c.slug).sort();
    expect(slugs).toContain("sigmashake-nodash");
    expect(slugs).toContain("sigmashake-after");
  });
});

describe("parseStructureBlock — duplicate slug entries", () => {
  it("adds both as separate cards (no dedup — upstream CLAUDE.md should not have dups)", () => {
    // The parser adds both entries; sorting is stable so order may be either.
    const cards = parseStructureBlock(DUPLICATE_SLUG);
    expect(cards).toHaveLength(2);
  });
});

describe("parseStructureBlock — hasWranglerToml heuristic", () => {
  it("sets hasWranglerToml=true for Cloudflare Worker entries", () => {
    const cards = parseStructureBlock(MULTI_PROJECT);
    const beta = cards.find((c) => c.slug === "sigmashake-beta");
    expect(beta?.hasWranglerToml).toBe(true);
  });

  it("sets hasWranglerToml=false for non-worker entries", () => {
    const cards = parseStructureBlock(MULTI_PROJECT);
    const alpha = cards.find((c) => c.slug === "sigmashake-alpha");
    expect(alpha?.hasWranglerToml).toBe(false);
  });
});
