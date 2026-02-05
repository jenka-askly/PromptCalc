/**
 * Purpose: Verify scan policy mode resolution for dev-only red-team flags.
 * Persists: None.
 * Security Risks: None.
 */

import { describe, expect, it } from "vitest";

import { resolveRuntimeScanPolicyMode, resolveScanPolicyConfig } from "../src/generation/scanPolicy";

describe("scan policy config", () => {
  it("defaults to enforce when redkit is disabled", () => {
    const config = resolveScanPolicyConfig({ PROMPTCALC_REDKIT: "0" } as NodeJS.ProcessEnv);
    expect(config.mode).toBe("enforce");
    expect(config.redTeamCapabilityAvailable).toBe(false);
  });

  it("defaults to warn when redkit is enabled", () => {
    const config = resolveScanPolicyConfig({ PROMPTCALC_REDKIT: "1" } as NodeJS.ProcessEnv);
    expect(config.mode).toBe("warn");
    expect(config.redTeamCapabilityAvailable).toBe(true);
  });

  it("falls back to enforce runtime mode when not armed", () => {
    expect(resolveRuntimeScanPolicyMode("warn", false)).toBe("enforce");
    expect(resolveRuntimeScanPolicyMode("off", false)).toBe("enforce");
  });
});
