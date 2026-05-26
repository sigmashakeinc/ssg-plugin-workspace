// Coverage for the unknown→user-facing error mapping. Every branch in
// friendlyError gets a representative input; unrecognized errors must NOT
// be hidden — they fall through to the raw message.

import { describe, expect, it } from "vitest";
import { CapabilityError } from "../src/client/api/client";
import { friendlyError } from "../src/client/lib/errors";

describe("friendlyError", () => {
  it("returns the CapabilityError message verbatim when one is present", () => {
    const e = new CapabilityError("Custom message");
    expect(friendlyError(e)).toBe("Custom message");
  });

  it("falls back to a generic explanation when CapabilityError carries no body", () => {
    const e = new CapabilityError("");
    expect(friendlyError(e)).toMatch(/SigmaShake desktop app/i);
  });

  it("maps TypeError into a 'reach SigmaShake' message", () => {
    expect(friendlyError(new TypeError("failed to fetch"))).toMatch(/Couldn't reach SigmaShake/i);
  });

  it("maps Error messages matching the network regex", () => {
    expect(friendlyError(new Error("Load failed"))).toMatch(/Couldn't reach SigmaShake/i);
    expect(friendlyError(new Error("NetworkError when attempting to fetch"))).toMatch(
      /Couldn't reach SigmaShake/i,
    );
  });

  it("translates HTTP status codes embedded in the message", () => {
    expect(friendlyError(new Error("health: 401"))).toMatch(/Reload the page/i);
    expect(friendlyError(new Error("forbidden: 403"))).toMatch(/Reload the page/i);
    expect(friendlyError(new Error("not found: 404"))).toMatch(/moved or renamed/i);
    expect(friendlyError(new Error("local_only: 501"))).toMatch(/SigmaShake desktop app/i);
    expect(friendlyError(new Error("rate: 429"))).toMatch(/Too many requests/i);
    expect(friendlyError(new Error("upstream: 502"))).toMatch(/up to date/i);
  });

  it("passes unknown error messages through verbatim", () => {
    expect(friendlyError(new Error("kaboom"))).toBe("kaboom");
  });

  it("handles non-Error throwables (strings, undefined)", () => {
    expect(friendlyError("plain string error")).toBe("plain string error");
    expect(friendlyError(undefined)).toMatch(/Something went wrong/i);
    expect(friendlyError(null)).toMatch(/Something went wrong/i);
  });

  it("does NOT match digits glued to other digits (e.g. timestamp 1234017)", () => {
    // The status regex uses \b boundaries so a substring inside a larger
    // number must not trigger the 401 → "reload the page" branch.
    expect(friendlyError(new Error("epoch 1234017 failed"))).toBe("epoch 1234017 failed");
  });
});
