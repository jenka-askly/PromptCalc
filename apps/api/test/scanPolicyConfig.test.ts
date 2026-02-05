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

  it("uses off when scan_off and redkit are enabled", () => {
    const config = resolveScanPolicyConfig({
      PROMPTCALC_REDKIT: "1",
      PROMPTCALC_SCAN_OFF: "1",
    } as NodeJS.ProcessEnv);
    expect(config.mode).toBe("off");
  });

  it("does not allow off mode when redkit is disabled", () => {
    const config = resolveScanPolicyConfig({
      PROMPTCALC_REDKIT: "0",
      PROMPTCALC_SCAN_OFF: "1",
    } as NodeJS.ProcessEnv);
    expect(config.mode).toBe("enforce");
    expect(config.redTeamCapabilityAvailable).toBe(false);
  });

  it("falls back to enforce runtime mode when not armed", () => {
    expect(resolveRuntimeScanPolicyMode("warn", false)).toBe("enforce");
    expect(resolveRuntimeScanPolicyMode("off", false)).toBe("enforce");
  });
});
