/**
 * Purpose: Load and cache the PromptCalc artifact policy from policy.yaml for server-side scans.
 * Persists: Reads spec/policy.yaml only; no persistence changes.
 * Security Risks: Reads policy configuration that impacts artifact rejection logic.
 */

import { readFile } from "fs/promises";
import path from "path";

import { logEvent } from "@promptcalc/logger";
import { parse } from "yaml";

export type PolicyRule = {
  id: string;
  patterns?: string[];
  tags?: string[];
};

export type PromptCalcPolicy = {
  specVersion: string;
  maxArtifactBytes: number;
  requiredBannerText: string;
  requiredCspDirectives: string[];
  bannedPatterns: PolicyRule[];
  bannedTags: PolicyRule[];
};

const DEFAULT_POLICY: PromptCalcPolicy = {
  specVersion: "1.0",
  maxArtifactBytes: 200_000,
  requiredBannerText: "Generated calculator (offline). Do not enter passwords.",
  requiredCspDirectives: [
    "default-src 'none'",
    "connect-src 'none'",
    "img-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    "form-action 'none'",
    "object-src 'none'",
  ],
  bannedPatterns: [],
  bannedTags: [],
};

let cachedPolicy: PromptCalcPolicy | null = null;

const loadPolicyFromFile = async (policyPath: string): Promise<PromptCalcPolicy> => {
  const contents = await readFile(policyPath, "utf-8");
  const parsed = parse(contents) as Partial<PromptCalcPolicy> | null;

  if (!parsed || typeof parsed !== "object") {
    return DEFAULT_POLICY;
  }

  return {
    ...DEFAULT_POLICY,
    ...parsed,
    requiredCspDirectives: Array.isArray(parsed.requiredCspDirectives)
      ? parsed.requiredCspDirectives
      : DEFAULT_POLICY.requiredCspDirectives,
    bannedPatterns: Array.isArray(parsed.bannedPatterns)
      ? (parsed.bannedPatterns as PolicyRule[])
      : DEFAULT_POLICY.bannedPatterns,
    bannedTags: Array.isArray(parsed.bannedTags)
      ? (parsed.bannedTags as PolicyRule[])
      : DEFAULT_POLICY.bannedTags,
  };
};

export const getPromptCalcPolicy = async (): Promise<PromptCalcPolicy> => {
  if (cachedPolicy) {
    return cachedPolicy;
  }

  const candidates = [
    path.resolve(process.cwd(), "spec/policy.yaml"),
    path.resolve(__dirname, "../../../spec/policy.yaml"),
  ];

  for (const policyPath of candidates) {
    try {
      cachedPolicy = await loadPolicyFromFile(policyPath);
      return cachedPolicy;
    } catch (error) {
      logEvent({
        level: "warn",
        op: "policy.load",
        event: "policy.read.failed",
        policyPath,
        message: error instanceof Error ? error.message : "unknown error",
      });
    }
  }

  cachedPolicy = DEFAULT_POLICY;
  return cachedPolicy;
};

export const resetPromptCalcPolicyCache = (): void => {
  cachedPolicy = null;
};
