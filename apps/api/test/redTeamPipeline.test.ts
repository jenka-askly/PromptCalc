/**
 * Purpose: Verify red-team scan policy modes enforce/warn/off and per-request proceed behavior.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it, vi } from "vitest";

import { runGenerationPipeline } from "../src/generation/pipeline";

describe("red-team generation pipeline", () => {
  it("enforce mode blocks deny and does not call generator", async () => {
    const runPromptScan = vi.fn(async () => ({
      allowed: false,
      refusalCode: "DISALLOWED_NETWORK",
      reason: "Networking requested",
      categories: ["networking"],
    }));
    const runGenerator = vi.fn(async () => ({ calcId: "calc-1" }));

    const result = await runGenerationPipeline({
      mode: "enforce",
      redTeamArmed: false,
      proceedOverride: false,
      runPromptScan,
      runGenerator,
    });

    expect(result.kind).toBe("scan_block");
    expect(runPromptScan).toHaveBeenCalledTimes(1);
    expect(runGenerator).not.toHaveBeenCalled();
  });

  it("warn mode without token behaves like enforce", async () => {
    const runPromptScan = vi.fn(async () => ({
      allowed: false,
      refusalCode: "DISALLOWED_NETWORK",
      reason: "Networking requested",
      categories: ["networking"],
    }));
    const runGenerator = vi.fn(async () => ({ calcId: "calc-1" }));

    const result = await runGenerationPipeline({
      mode: "warn",
      redTeamArmed: false,
      proceedOverride: false,
      runPromptScan,
      runGenerator,
    });

    expect(result.kind).toBe("scan_block");
    expect(runGenerator).not.toHaveBeenCalled();
  });

  it("enforce mode ignores proceedOverride even when request is tampered", async () => {
    const runPromptScan = vi.fn(async () => ({
      allowed: false,
      refusalCode: "DISALLOWED_NETWORK",
      reason: "Networking requested",
      categories: ["networking"],
    }));
    const runGenerator = vi.fn(async () => ({ calcId: "calc-1" }));

    const result = await runGenerationPipeline({
      mode: "enforce",
      redTeamArmed: true,
      proceedOverride: true,
      runPromptScan,
      runGenerator,
    });

    expect(result.kind).toBe("scan_block");
    expect(runPromptScan).toHaveBeenCalledTimes(1);
    expect(runGenerator).not.toHaveBeenCalled();
  });

  it("warn mode with token returns scan_warn, then proceeds when override is set", async () => {
    const runPromptScan = vi.fn(async () => ({
      allowed: false,
      refusalCode: "DISALLOWED_NETWORK",
      reason: "Networking requested",
      categories: ["networking"],
    }));
    const runGenerator = vi.fn(async () => ({ calcId: "calc-1" }));

    const firstResult = await runGenerationPipeline({
      mode: "warn",
      redTeamArmed: true,
      proceedOverride: false,
      runPromptScan,
      runGenerator,
    });

    expect(firstResult.kind).toBe("scan_warn");
    expect(runGenerator).not.toHaveBeenCalled();

    const secondResult = await runGenerationPipeline({
      mode: "warn",
      redTeamArmed: true,
      proceedOverride: true,
      runPromptScan,
      runGenerator,
    });

    expect(secondResult.kind).toBe("ok");
    expect(runGenerator).toHaveBeenCalledTimes(1);
  });

  it("off mode with token skips scan but still requires proceed", async () => {
    const runPromptScan = vi.fn(async () => ({
      allowed: true,
      refusalCode: null,
      reason: "Allowed",
      categories: [],
    }));
    const runGenerator = vi.fn(async () => ({ calcId: "calc-1" }));

    const firstResult = await runGenerationPipeline({
      mode: "off",
      redTeamArmed: true,
      proceedOverride: false,
      runPromptScan,
      runGenerator,
    });

    expect(firstResult.kind).toBe("scan_skipped");
    expect(runPromptScan).not.toHaveBeenCalled();
    expect(runGenerator).not.toHaveBeenCalled();

    const secondResult = await runGenerationPipeline({
      mode: "off",
      redTeamArmed: true,
      proceedOverride: true,
      runPromptScan,
      runGenerator,
    });

    expect(secondResult.kind).toBe("ok");
    expect(runPromptScan).not.toHaveBeenCalled();
    expect(runGenerator).toHaveBeenCalledTimes(1);
  });
});
