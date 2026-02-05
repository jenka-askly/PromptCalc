/**
 * Purpose: Resolve dev-only red-team scan policy modes and runtime overrides.
 * Persists: None.
 * Security Risks: Reads environment feature flags controlling scan bypass behavior.
 */

export type ScanPolicyMode = "enforce" | "warn" | "off";

export type ScanPolicyConfig = {
  mode: ScanPolicyMode;
  redTeamCapabilityAvailable: boolean;
};

export const isRedTeamEnabled = (): boolean => process.env.PROMPTCALC_REDKIT === "1";

const isEnabledFlag = (value: string | undefined): boolean => value === "1";

export const resolveScanPolicyConfig = (
  env: NodeJS.ProcessEnv = process.env
): ScanPolicyConfig => {
  const redTeamCapabilityAvailable = env === process.env ? isRedTeamEnabled() : isEnabledFlag(env.PROMPTCALC_REDKIT);

  if (!redTeamCapabilityAvailable) {
    return {
      mode: "enforce",
      redTeamCapabilityAvailable: false,
    };
  }

  return {
    mode: "warn",
    redTeamCapabilityAvailable: true,
  };
};

export const resolveRuntimeScanPolicyMode = (
  mode: ScanPolicyMode,
  redTeamArmed: boolean
): ScanPolicyMode => {
  if (mode === "enforce") {
    return "enforce";
  }

  return redTeamArmed ? mode : "enforce";
};
