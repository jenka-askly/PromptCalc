/**
 * Purpose: Ensure server-side effective red-team profile ignores unsafe client toggles unless PROMPTCALC_REDKIT is enabled.
 * Persists: None.
 * Security Risks: Validates dev-only safety bypass controls are capability-gated by environment.
 */

import { describe, expect, it } from "vitest";

import { resolveEffectiveRedTeamProfile } from "../src/functions/calcs";

describe("resolveEffectiveRedTeamProfile", () => {
  it("forces safe defaults when PROMPTCALC_REDKIT is disabled", () => {
    const profile = resolveEffectiveRedTeamProfile(
      {
        enabled: true,
        scanMode: "off",
        strictInstructions: false,
        promptVerification: false,
        dumpCollateral: true,
      },
      { PROMPTCALC_REDKIT: "0" } as NodeJS.ProcessEnv
    );

    expect(profile.enabled).toBe(false);
    expect(profile.scanMode).toBe("enforce");
    expect(profile.strictInstructions).toBe(true);
    expect(profile.promptVerification).toBe(true);
    expect(profile.dumpCollateral).toBe(false);
  });
});
