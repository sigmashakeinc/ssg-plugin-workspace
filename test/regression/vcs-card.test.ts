// regression/vcs-card.test.ts — pin sigmashake-vcs into the live, generated
// registry. The existing registry-shape.test.ts asserts the build-registry.ts
// CONTRACT (kind names, type imports) but never reads the generated array, so
// a parent-CLAUDE.md edit that dropped the `- \`sigmashake-vcs/\` —` bullet
// would silently shrink the live registry until someone noticed VCS missing
// from workspace.sigmashake.com. This test reads the generated registry and
// asserts VCS's shape so that drift is caught at test time.
//
// Runs in node env via the `regression` vitest project; the generated module
// is plain TS importable in node.

import { describe, expect, it } from "vitest";

import { PROJECTS_REGISTRY } from "../../src/registry.generated";

describe("sigmashake-vcs in the live registry", () => {
  const vcs = PROJECTS_REGISTRY.find((p) => p.slug === "sigmashake-vcs");

  it("is present", () => {
    expect(
      vcs,
      "sigmashake-vcs is missing from PROJECTS_REGISTRY — check CLAUDE.md <structure>",
    ).toBeDefined();
  });

  it("is classified as a Cloudflare Worker", () => {
    expect(vcs?.type).toBe("cf-worker");
  });

  it("declares a wrangler config and a project-level CLAUDE.md", () => {
    expect(vcs?.hasWranglerToml).toBe(true);
    expect(vcs?.hasClaudeMd).toBe(true);
  });

  it("describes the Vibe Coder Sim builder + the DO architecture", () => {
    // Description is sourced verbatim from CLAUDE.md, so the regex is the
    // contract — pin the substrings, not the punctuation.
    expect(vcs?.description).toMatch(/Vibe Coder Sim/i);
    expect(vcs?.description).toMatch(/vcs\.sigmashake\.com/);
    expect(vcs?.description).toMatch(/Cloudflare Worker/i);
    expect(vcs?.description).toMatch(/Durable Object/i);
  });

  it("has dir === slug (no rename indirection in the registry)", () => {
    expect(vcs?.dir).toBe("sigmashake-vcs");
  });

  it("ships an empty scripts[] (cloud has no live discovery)", () => {
    // Same invariant build-registry.test.ts asserts globally for all cards —
    // pin it for VCS specifically so a future regen with a populated scripts
    // field on this card is forced through review.
    expect(vcs?.scripts).toEqual([]);
  });

  it("auto-detected the test buckets that ship in sigmashake-vcs/test/", () => {
    // Each of these corresponds to a real subdirectory under sigmashake-vcs/test/.
    // The detector populates testKinds from filesystem presence, so a dropped
    // bucket on the VCS side surfaces as a missing flag here.
    const kinds = vcs?.testKinds ?? {};
    expect(kinds.integration, "integration/ bucket missing").toBe(true);
    expect(kinds.e2e, "e2e/ bucket missing").toBe(true);
    expect(kinds.api, "api/ bucket missing").toBe(true);
    expect(kinds.configuration, "configuration/ bucket missing").toBe(true);
    expect(kinds.sast, "sast/ bucket missing").toBe(true);
    expect(kinds.dependencies, "dependencies/ bucket missing").toBe(true);
  });

  it("sorts alphabetically — sigmashake-vcs sits between -twitch-events and -vibe", () => {
    const slugs = PROJECTS_REGISTRY.map((p) => p.slug);
    const sorted = [...slugs].sort();
    expect(slugs).toEqual(sorted);
    const idx = slugs.indexOf("sigmashake-vcs");
    expect(idx).toBeGreaterThan(0);
    // Adjacent neighbours are stable because all three slugs share the same
    // length-prefix sort behaviour ("sigmashake-v…" cluster).
    expect(slugs[idx - 1]).toBe("sigmashake-twitch-events");
    expect(slugs[idx + 1]).toBe("sigmashake-vibe");
  });
});
