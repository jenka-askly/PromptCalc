/**
 * Purpose: Decide prompt-scan override behavior for enforce/warn/off modes before generation.
 * Persists: None.
 * Security Risks: Controls whether denied prompts can proceed in dev-only red-team mode.
 */

import type { ScanPolicyMode } from "./scanPolicy";

export type PromptScanSummary = {
  refusalCode: string | null;
  reason: string;
  categories: string[];
};

export type ScanOverrideDecision =
  | { action: "continue"; scanOutcome: "allow" | "deny" | "skipped"; overrideUsed: boolean }
  | {
      action: "scan_block";
      scanOutcome: "deny";
      overrideUsed: false;
    }
  | {
      action: "scan_warn";
      scanOutcome: "deny";
      overrideUsed: false;
      requiresUserProceed: true;
      scanSummary: PromptScanSummary;
    }
  | {
      action: "scan_skipped";
      scanOutcome: "skipped";
      overrideUsed: false;
      requiresUserProceed: true;
    };

export const decideScanOverrideFlow = (params: {
  mode: ScanPolicyMode;
  redTeamArmed: boolean;
  proceedOverride: boolean;
  promptDenied: boolean;
  promptScanSummary?: PromptScanSummary;
}): ScanOverrideDecision => {
  const { mode, redTeamArmed, proceedOverride, promptDenied, promptScanSummary } = params;

  if (mode === "off" && redTeamArmed) {
    if (!proceedOverride) {
      return {
        action: "scan_skipped",
        scanOutcome: "skipped",
        overrideUsed: false,
        requiresUserProceed: true,
      };
    }

    return {
      action: "continue",
      scanOutcome: "skipped",
      overrideUsed: true,
    };
  }

  if (!promptDenied) {
    return {
      action: "continue",
      scanOutcome: "allow",
      overrideUsed: false,
    };
  }

  if (mode === "warn" && redTeamArmed) {
    if (!proceedOverride) {
      return {
        action: "scan_warn",
        scanOutcome: "deny",
        overrideUsed: false,
        requiresUserProceed: true,
        scanSummary: promptScanSummary ?? {
          refusalCode: null,
          reason: "Prompt scan denied this request.",
          categories: [],
        },
      };
    }

    return {
      action: "continue",
      scanOutcome: "deny",
      overrideUsed: true,
    };
  }

  return {
    action: "scan_block",
    scanOutcome: "deny",
    overrideUsed: false,
  };
};
