// Unit coverage for the production / non-production classification helpers.

import { describe, expect, it } from "vitest";
import {
  defaultLine,
  isProjectLine,
  LINE_BADGE,
  LINE_LABEL,
  normalizeLineOverrides,
  resolveLine,
  STREAMING_SLUGS,
  withLineOverride,
  withLineOverrides,
} from "../src/client/lib/project-lines";

describe("defaultLine", () => {
  it("seeds streaming-op services to non-production", () => {
    expect(defaultLine("sigmashake-obs")).toBe("non-production");
    expect(defaultLine("sigmashake-navi-elixir")).toBe("non-production");
    expect(defaultLine("sigmashake-mmo")).toBe("non-production");
  });

  it("seeds platform services to production", () => {
    expect(defaultLine("sigmashake-gov")).toBe("production");
    expect(defaultLine("sigmashake-hub")).toBe("production");
    expect(defaultLine("sigmashake-fleet")).toBe("production");
  });

  it("treats unknown slugs as production by default", () => {
    expect(defaultLine("sigmashake-brand-new-thing")).toBe("production");
  });

  it("STREAMING_SLUGS is internally consistent with defaultLine", () => {
    for (const slug of STREAMING_SLUGS) {
      expect(defaultLine(slug)).toBe("non-production");
    }
  });
});

describe("isProjectLine", () => {
  it("accepts only the two line values", () => {
    expect(isProjectLine("production")).toBe(true);
    expect(isProjectLine("non-production")).toBe(true);
    expect(isProjectLine("prod")).toBe(false);
    expect(isProjectLine(undefined)).toBe(false);
    expect(isProjectLine(null)).toBe(false);
  });
});

describe("resolveLine", () => {
  it("returns the seeded default when no override exists", () => {
    expect(resolveLine("sigmashake-obs", {})).toBe("non-production");
    expect(resolveLine("sigmashake-gov", undefined)).toBe("production");
  });

  it("lets a valid override win over the seed", () => {
    expect(resolveLine("sigmashake-obs", { "sigmashake-obs": "production" })).toBe("production");
    expect(resolveLine("sigmashake-gov", { "sigmashake-gov": "non-production" })).toBe(
      "non-production",
    );
  });

  it("ignores a malformed override and falls back to the seed", () => {
    const bad = { "sigmashake-obs": "sideways" } as unknown as Record<
      string,
      "production" | "non-production"
    >;
    expect(resolveLine("sigmashake-obs", bad)).toBe("non-production");
  });
});

describe("withLineOverride", () => {
  it("records a deviation from the seed", () => {
    const next = withLineOverride({}, "sigmashake-obs", "production");
    expect(next).toEqual({ "sigmashake-obs": "production" });
  });

  it("clears the override when set back to the seeded default", () => {
    const start = { "sigmashake-obs": "production" as const };
    const next = withLineOverride(start, "sigmashake-obs", "non-production");
    expect(next).toEqual({});
  });

  it("does not mutate the input map", () => {
    const start = { "sigmashake-gov": "non-production" as const };
    withLineOverride(start, "sigmashake-hub", "non-production");
    expect(start).toEqual({ "sigmashake-gov": "non-production" });
  });
});

describe("withLineOverrides (batch)", () => {
  it("applies many assignments in one pass", () => {
    const next = withLineOverrides(
      {},
      {
        "sigmashake-obs": "production",
        "sigmashake-gov": "non-production",
      },
    );
    expect(next).toEqual({
      "sigmashake-obs": "production",
      "sigmashake-gov": "non-production",
    });
  });

  it("clears overrides whose target equals the seed default", () => {
    const start = { "sigmashake-obs": "production" as const };
    // sigmashake-obs's seed default is non-production → this clears it;
    // sigmashake-gov's default is production → also a no-op clear.
    const next = withLineOverrides(start, {
      "sigmashake-obs": "non-production",
      "sigmashake-gov": "production",
    });
    expect(next).toEqual({});
  });

  it("skips malformed line values", () => {
    const next = withLineOverrides(
      {},
      { "sigmashake-obs": "bogus" as unknown as "production" },
    );
    expect(next).toEqual({});
  });

  it("does not mutate the input map", () => {
    const start = { "sigmashake-hub": "non-production" as const };
    withLineOverrides(start, { "sigmashake-obs": "production" });
    expect(start).toEqual({ "sigmashake-hub": "non-production" });
  });
});

describe("normalizeLineOverrides", () => {
  it("drops invalid keys and values", () => {
    expect(
      normalizeLineOverrides({
        "sigmashake-obs": "non-production",
        "BAD KEY": "production",
        "sigmashake-gov": "nope",
      }),
    ).toEqual({ "sigmashake-obs": "non-production" });
  });

  it("returns {} for non-object input", () => {
    expect(normalizeLineOverrides(null)).toEqual({});
    expect(normalizeLineOverrides("x")).toEqual({});
  });
});

describe("label tables", () => {
  it("cover both lines", () => {
    expect(LINE_LABEL.production).toBeTruthy();
    expect(LINE_LABEL["non-production"]).toBeTruthy();
    expect(LINE_BADGE.production).toBeTruthy();
    expect(LINE_BADGE["non-production"]).toBeTruthy();
  });
});
