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

type PromptCalcPolicyFile = Partial<PromptCalcPolicy> & {
  version?: string | number;
  name?: string;
  banned?: string[];
  required?: string[];
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

const normalizeRequiredFields = (
  parsed: PromptCalcPolicyFile
): Pick<PromptCalcPolicy, "requiredBannerText" | "requiredCspDirectives"> => {
  const requiredEntries = Array.isArray(parsed.required)
    ? parsed.required.filter((entry): entry is string => typeof entry === "string")
    : [];

  const bannerEntry = requiredEntries.find((entry) =>
    entry.toLowerCase().includes("generated calculator")
  );

  const directiveEntries = requiredEntries.filter((entry) => {
    const normalized = entry.toLowerCase();
    if (normalized === "content-security-policy") {
      return false;
    }
    return (
      normalized.startsWith("default-src") ||
      normalized.startsWith("connect-src") ||
      normalized.startsWith("img-src") ||
      normalized.startsWith("script-src") ||
      normalized.startsWith("style-src") ||
      normalized.startsWith("base-uri") ||
      normalized.startsWith("form-action") ||
      normalized.startsWith("object-src")
    );
  });

  return {
    requiredBannerText: bannerEntry ?? DEFAULT_POLICY.requiredBannerText,
    requiredCspDirectives:
      directiveEntries.length > 0
        ? directiveEntries
        : DEFAULT_POLICY.requiredCspDirectives,
  };
};

const normalizeBannedPatterns = (parsed: PromptCalcPolicyFile): PolicyRule[] => {
  if (Array.isArray(parsed.bannedPatterns)) {
    return parsed.bannedPatterns as PolicyRule[];
  }

  if (!Array.isArray(parsed.banned)) {
    return DEFAULT_POLICY.bannedPatterns;
  }

  const patterns = parsed.banned.filter((entry): entry is string => typeof entry === "string");
  if (patterns.length === 0) {
    return DEFAULT_POLICY.bannedPatterns;
  }

  return [
    {
      id: "DISALLOWED_PATTERN",
      patterns,
    },
  ];
};

const loadPolicyFromFile = async (policyPath: string): Promise<PromptCalcPolicy> => {
  const contents = await readFile(policyPath, "utf-8");
  const parsed = parse(contents) as PromptCalcPolicyFile | null;

  if (!parsed || typeof parsed !== "object") {
    return DEFAULT_POLICY;
  }

  const normalizedRequired = normalizeRequiredFields(parsed);

  return {
    ...DEFAULT_POLICY,
    ...parsed,
    specVersion:
      parsed.specVersion ??
      (parsed.version !== undefined ? String(parsed.version) : DEFAULT_POLICY.specVersion),
    requiredBannerText:
      typeof parsed.requiredBannerText === "string"
        ? parsed.requiredBannerText
        : normalizedRequired.requiredBannerText,
    requiredCspDirectives: Array.isArray(parsed.requiredCspDirectives)
      ? parsed.requiredCspDirectives
      : normalizedRequired.requiredCspDirectives,
    bannedPatterns: normalizeBannedPatterns(parsed),
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
    path.resolve(__dirname, "../../spec/policy.yaml"),
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
