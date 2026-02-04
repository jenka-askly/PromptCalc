/**
 * Purpose: Deterministically scan generated calculator artifacts for forbidden patterns and required safety markers.
 * Persists: None.
 * Security Risks: Processes untrusted HTML content to enforce sandbox policies.
 */

import type { PromptCalcPolicy } from "./policy";

export type ScanResult =
  | { ok: true }
  | { ok: false; code: string; message: string; ruleId?: string };

const normalize = (value: string): string => value.toLowerCase();

const matchesPattern = (normalizedHtml: string, pattern: string): boolean =>
  normalizedHtml.includes(normalize(pattern));

const hasRequiredCspMarkers = (normalizedHtml: string, directives: string[]): boolean => {
  const markers = ["content-security-policy", ...directives];
  return markers.every((marker) => normalizedHtml.includes(normalize(marker)));
};

export const scanArtifactHtml = (
  artifactHtml: string,
  policy: PromptCalcPolicy
): ScanResult => {
  const normalizedHtml = normalize(artifactHtml);

  if (!hasRequiredCspMarkers(normalizedHtml, policy.requiredCspDirectives)) {
    return {
      ok: false,
      code: "MISSING_CSP",
      message: "Artifact is missing the required CSP directives.",
    };
  }

  if (!normalizedHtml.includes(normalize(policy.requiredBannerText))) {
    return {
      ok: false,
      code: "MISSING_CSP",
      message: "Artifact is missing the required safety banner.",
    };
  }

  for (const rule of policy.bannedPatterns) {
    const patterns = rule.patterns ?? [];
    for (const pattern of patterns) {
      if (matchesPattern(normalizedHtml, pattern)) {
        return {
          ok: false,
          code: rule.id,
          ruleId: pattern,
          message: `Artifact contains banned pattern: ${pattern}`,
        };
      }
    }
  }

  for (const rule of policy.bannedTags) {
    const tags = rule.tags ?? [];
    for (const tag of tags) {
      if (matchesPattern(normalizedHtml, `<${tag}`)) {
        return {
          ok: false,
          code: rule.id,
          ruleId: tag,
          message: `Artifact contains banned tag: ${tag}`,
        };
      }
    }
  }

  return { ok: true };
};
