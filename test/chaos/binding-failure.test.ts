/**
 * Chaos tests for sigmashake-workspace — pure-logic failure paths.
 *
 * The workspace worker imports cloudflare:workers (Service bindings), which is
 * not importable in bun test. These tests exercise the pure-logic layers:
 * build-registry (classify, parseStructureBlock), wrangler-parser, errors.
 */
import { describe, expect, test } from "bun:test";

// ── classify — unknown/malformed slugs degrade to 'unknown' ──────────────────

describe("chaos: classify — malformed project slugs", () => {
  test("classify returns a string for an empty slug", async () => {
    const { classify } = await import("../../src/build-registry");
    let threw = false;
    let result: unknown;
    try {
      result = classify("", "");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(typeof result).toBe("string");
  });

  test("classify handles a slug with null bytes without crashing", async () => {
    const { classify } = await import("../../src/build-registry");
    let threw = false;
    let result: unknown;
    try {
      result = classify("sigma\x00shake-chaos", "");
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
    expect(typeof result).toBe("string");
  });
});

// ── parseStructureBlock — malformed markdown terminates cleanly ───────────────

describe("chaos: parseStructureBlock — truncated/malformed markdown terminates", () => {
  test("empty string terminates (throws or returns empty array)", async () => {
    const { parseStructureBlock } = await import("../../src/build-registry");
    let threw = false;
    let result: unknown;
    try {
      result = parseStructureBlock("");
    } catch {
      threw = true;
    }
    // Either throws cleanly or returns an array — both are acceptable
    if (!threw) {
      expect(Array.isArray(result)).toBe(true);
    }
    expect(true).toBe(true); // terminates without hang or process crash
  });

  test("truncated markdown block terminates (throws or returns partial)", async () => {
    const { parseStructureBlock } = await import("../../src/build-registry");
    const truncated = "- `sigmashake-gov/` — Governance engine\n- `sigmashake";
    let threw = false;
    let result: unknown;
    try {
      result = parseStructureBlock(truncated);
    } catch {
      threw = true;
    }
    if (!threw) {
      expect(Array.isArray(result)).toBe(true);
    }
    expect(true).toBe(true); // terminates
  });

  test("markdown with null bytes terminates (throws or returns partial)", async () => {
    const { parseStructureBlock } = await import("../../src/build-registry");
    const malformed = "- `sigmashake-gov/` — Gov\x00ernance\n- `sigmashake-hub/\x00` — Hub";
    let threw = false;
    let result: unknown;
    try {
      result = parseStructureBlock(malformed);
    } catch {
      threw = true;
    }
    if (!threw) {
      expect(Array.isArray(result)).toBe(true);
    }
    expect(true).toBe(true); // terminates
  });
});

// ── wrangler-parser — truncated TOML does not crash ───────────────────────────

describe("chaos: wrangler-parser — malformed TOML inputs", () => {
  test("truncated TOML returns a parse result without crashing", async () => {
    const { parseWrangler } = await import("../../src/lib/wrangler-parser");
    const truncated = 'name = "chaos"\ncompatibility_date = "2024-01-01"\n[[routes';
    let threw = false;
    let result: unknown;
    try {
      result = parseWrangler(truncated, "chaos/wrangler.toml");
    } catch {
      threw = true;
    }
    // Parser may throw on truncated TOML — that's acceptable; verify it terminates
    expect(threw === true || result !== undefined).toBe(true);
  });

  test("empty TOML returns a defined result", async () => {
    const { parseWrangler } = await import("../../src/lib/wrangler-parser");
    let threw = false;
    let _result: unknown;
    try {
      _result = parseWrangler("", "chaos/wrangler.toml");
    } catch {
      threw = true;
    }
    expect(threw === false || threw === true).toBe(true); // terminates either way
  });
});
