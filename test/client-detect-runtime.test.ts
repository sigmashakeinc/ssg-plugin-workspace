// Unit coverage for the runtime detection logic that picks the API client.
// Priority order: window.__WORKSPACE_CONFIG__.runtime > WORKSPACE_RUNTIME
// build-time define > "cloud" fallback.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { CapabilityError, detectRuntime } from "../src/client/api/client";

type WindowShape = {
  __WORKSPACE_CONFIG__?: { runtime: "cloud" | "local" | "electrobun" | "vscode" };
};

const realWindow = (globalThis as { window?: unknown }).window;

beforeEach(() => {
  (globalThis as { window: WindowShape }).window = {};
});

afterEach(() => {
  if (realWindow === undefined) {
    delete (globalThis as { window?: unknown }).window;
  } else {
    (globalThis as { window: unknown }).window = realWindow;
  }
});

describe("detectRuntime", () => {
  it("prefers window.__WORKSPACE_CONFIG__.runtime when set", () => {
    (globalThis as { window: WindowShape }).window = {
      __WORKSPACE_CONFIG__: { runtime: "local" },
    };
    expect(detectRuntime()).toBe("local");
  });

  it("returns the runtime literal from window when set to electrobun", () => {
    (globalThis as { window: WindowShape }).window = {
      __WORKSPACE_CONFIG__: { runtime: "electrobun" },
    };
    expect(detectRuntime()).toBe("electrobun");
  });

  it("returns the runtime literal from window when set to vscode", () => {
    (globalThis as { window: WindowShape }).window = {
      __WORKSPACE_CONFIG__: { runtime: "vscode" },
    };
    expect(detectRuntime()).toBe("vscode");
  });

  it('falls back to "cloud" when neither window override nor WORKSPACE_RUNTIME is set', () => {
    // No window.__WORKSPACE_CONFIG__; WORKSPACE_RUNTIME isn't defined at
    // runtime when tests run (Vite's `define` only fires on real builds).
    expect(detectRuntime()).toBe("cloud");
  });
});

describe("CapabilityError", () => {
  it("subclasses Error and preserves the message + name for friendlyError matching", () => {
    const err = new CapabilityError("explicit reason");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CapabilityError");
    expect(err.message).toBe("explicit reason");
  });
});
