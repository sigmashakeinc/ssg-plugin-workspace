// Coverage for the build-time CLAUDE.md → ProjectCard[] parser. The output
// is shipped as a static registry to the cloud Worker, so misreading the
// structure block silently dropping a project would surface as a missing
// card in production. Worth keeping a regression net under it.

import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { classify, parseStructureBlock, partitionByDirExistence } from "../src/build-registry";
import type { ProjectCard } from "../src/types";

const FIXTURE = `# unrelated preamble

<structure>
- \`sigmashake-gov/\` — Governance engine: rule parser, evaluator, dashboard, CLI (\`ssg\`)
  - See \`sigmashake-gov/CLAUDE.md\` for project-specific commands and constraints
- \`sigmashake-hub/\` — Rules hub: public registry of \`.rules\` governance files (Cloudflare Worker)
  - See \`sigmashake-hub/CLAUDE.md\` for project-specific commands when it exists
- \`sigmashake-chat-elixir/\` — Elixir/Phoenix chat stack (Twitch IRC, YouTube, XP economy, effects)
  - See \`sigmashake-chat-elixir/CLAUDE.md\` for commands, layout, and debugging runbook
- \`sigmashake-bop/\` — \`dancing-claude\` npm package (pure JS, zero deps): viral Claude Code statusline
- \`sigmashake-example-native/\` — Pure-Rust binary using winit/wgpu (fixture-only stand-in for native classification)
  - See \`sigmashake-example-native/CLAUDE.md\` for build env
- \`shared/agent-config/skills/\` — Canonical skill definitions for all subprojects
- \`.claude/skills/\` — Symlinks into \`shared/agent-config/skills/\`
- \`.sigmashake/\` — Monorepo-level governance rules
</structure>

# unrelated postamble`;

describe("classify", () => {
  it("identifies Cloudflare Workers from the description body", () => {
    expect(classify("sigmashake-x", "This is a Cloudflare Worker.")).toBe("cf-worker");
    expect(classify("sigmashake-x", "Workers for Platforms host.")).toBe("cf-worker");
  });

  it("identifies Elixir / BEAM projects", () => {
    expect(classify("sigmashake-x", "Phoenix app with Mix release.")).toBe("elixir");
    expect(classify("sigmashake-x", "Runs on the BEAM.")).toBe("elixir");
  });

  it("identifies Rust / native projects", () => {
    expect(classify("sigmashake-x", "Pure-Rust binary using winit/wgpu.")).toBe("native");
  });

  it("identifies Bun / TypeScript projects", () => {
    expect(classify("sigmashake-x", "TypeScript npm package using Bun.")).toBe("bun");
  });

  it("falls back to the slug suffix for oblique descriptions", () => {
    expect(classify("sigmashake-foo-elixir", "vague description")).toBe("elixir");
    expect(classify("sigmashake-bop", "vague description")).toBe("bun");
  });

  it('returns "unknown" when nothing matches', () => {
    expect(classify("sigmashake-x", "Bare prose with no signals.")).toBe("unknown");
  });
});

describe("parseStructureBlock", () => {
  it("extracts every top-level `sigmashake-*` bullet", () => {
    const projects = parseStructureBlock(FIXTURE);
    const slugs = projects.map((p) => p.slug);
    expect(slugs).toEqual(
      [
        "sigmashake-bop",
        "sigmashake-chat-elixir",
        "sigmashake-example-native",
        "sigmashake-gov",
        "sigmashake-hub",
      ].sort(),
    );
  });

  it("ignores non-sigmashake bullets (shared/, .claude/, .sigmashake/)", () => {
    const slugs = parseStructureBlock(FIXTURE).map((p) => p.slug);
    expect(slugs).not.toContain("shared");
    expect(slugs.every((s) => s.startsWith("sigmashake-"))).toBe(true);
  });

  it("classifies based on top-line description first", () => {
    const projects = parseStructureBlock(FIXTURE);
    const hub = projects.find((p) => p.slug === "sigmashake-hub");
    expect(hub?.type).toBe("cf-worker");
    expect(hub?.hasWranglerToml).toBe(true);
  });

  it("promotes type via sub-bullet content when the top line is generic", () => {
    // sigmashake-gov's top line doesn't include "Cloudflare Worker" or a
    // language identifier — the sub-bullet "CLAUDE.md" present is the only
    // signal here. Its hasClaudeMd flag flips to true.
    const projects = parseStructureBlock(FIXTURE);
    const gov = projects.find((p) => p.slug === "sigmashake-gov");
    expect(gov?.hasClaudeMd).toBe(true);
  });

  it("classifies via slug suffix for elixir projects", () => {
    const projects = parseStructureBlock(FIXTURE);
    const elx = projects.find((p) => p.slug === "sigmashake-chat-elixir");
    expect(elx?.type).toBe("elixir");
  });

  it("returns the projects sorted alphabetically by slug", () => {
    const slugs = parseStructureBlock(FIXTURE).map((p) => p.slug);
    const sorted = [...slugs].sort();
    expect(slugs).toEqual(sorted);
  });

  it("throws when the structure block is missing", () => {
    expect(() => parseStructureBlock("no structure here")).toThrow(/no <structure> block/);
  });

  it("preserves the one-line description on each card", () => {
    const projects = parseStructureBlock(FIXTURE);
    const gov = projects.find((p) => p.slug === "sigmashake-gov");
    expect(gov?.description).toMatch(/^Governance engine/);
  });

  it("defaults scripts to an empty array (cloud has no live discovery)", () => {
    const projects = parseStructureBlock(FIXTURE);
    for (const p of projects) {
      expect(p.scripts).toEqual([]);
    }
  });
});

function card(slug: string): ProjectCard {
  return {
    slug,
    dir: slug,
    type: "unknown",
    description: "",
    scripts: [],
    hasWranglerToml: false,
    hasClaudeMd: false,
  };
}

describe("partitionByDirExistence", () => {
  it("keeps entries whose directory exists and drops removed ones", () => {
    const root = mkdtempSync(join(tmpdir(), "ssg-registry-"));
    try {
      mkdirSync(join(root, "sigmashake-live"));
      const { present, missing } = partitionByDirExistence(
        [card("sigmashake-live"), card("sigmashake-removed")],
        root,
      );
      expect(present.map((p) => p.slug)).toEqual(["sigmashake-live"]);
      expect(missing.map((p) => p.slug)).toEqual(["sigmashake-removed"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("treats every entry as present when all directories exist", () => {
    const root = mkdtempSync(join(tmpdir(), "ssg-registry-"));
    try {
      mkdirSync(join(root, "sigmashake-a"));
      mkdirSync(join(root, "sigmashake-b"));
      const { present, missing } = partitionByDirExistence(
        [card("sigmashake-a"), card("sigmashake-b")],
        root,
      );
      expect(present).toHaveLength(2);
      expect(missing).toHaveLength(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("drops every entry when the structure block has gone fully stale", () => {
    const root = mkdtempSync(join(tmpdir(), "ssg-registry-"));
    try {
      const { present, missing } = partitionByDirExistence(
        [card("sigmashake-ghost-one"), card("sigmashake-ghost-two")],
        root,
      );
      expect(present).toHaveLength(0);
      expect(missing).toHaveLength(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
