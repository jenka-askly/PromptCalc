/**
 * Purpose: Coordinate prompt scan policy decisions and deferred generation execution.
 * Persists: None.
 * Security Risks: Enables dev-only override flow; must require explicit per-request proceed action.
 */

import { decideScanOverrideFlow } from "./scanOverrideFlow";
import type { ScanPolicyMode } from "./scanPolicy";

export type PromptScanResult = {
  allowed: boolean;
  refusalCode: string | null;
  reason: string;
  categories: string[];
};

export type PipelineResult<T> =
  | { kind: "ok"; payload: T; overrideUsed: boolean; scanOutcome: "allow" | "deny" | "skipped" }
  | { kind: "scan_block"; promptScan: PromptScanResult }
  | {
      kind: "scan_warn";
      promptScan: PromptScanResult;
      requiresUserProceed: true;
    }
  | { kind: "scan_skipped"; requiresUserProceed: true };

export const runGenerationPipeline = async <T>(params: {
  mode: ScanPolicyMode;
  redTeamArmed: boolean;
  proceedOverride: boolean;
  runPromptScan: () => Promise<PromptScanResult>;
  runGenerator: () => Promise<T>;
}): Promise<PipelineResult<T>> => {
  const { mode, redTeamArmed, proceedOverride, runPromptScan, runGenerator } = params;

  if (mode === "off" && redTeamArmed && !proceedOverride) {
    return {
      kind: "scan_skipped",
      requiresUserProceed: true,
    };
  }

  let promptScanResult: PromptScanResult | null = null;
  if (!(mode === "off" && redTeamArmed)) {
    promptScanResult = await runPromptScan();
    const decision = decideScanOverrideFlow({
      mode,
      redTeamArmed,
      proceedOverride,
      promptDenied: !promptScanResult.allowed,
      promptScanSummary: {
        refusalCode: promptScanResult.refusalCode,
        reason: promptScanResult.reason,
        categories: promptScanResult.categories,
      },
    });

    if (decision.action === "scan_block") {
      return {
        kind: "scan_block",
        promptScan: promptScanResult,
      };
    }

    if (decision.action === "scan_warn") {
      return {
        kind: "scan_warn",
        promptScan: promptScanResult,
        requiresUserProceed: true,
      };
    }

    const payload = await runGenerator();
    return {
      kind: "ok",
      payload,
      overrideUsed: decision.overrideUsed,
      scanOutcome: decision.scanOutcome,
    };
  }

  const payload = await runGenerator();
  return {
    kind: "ok",
    payload,
    overrideUsed: true,
    scanOutcome: "skipped",
  };
};
