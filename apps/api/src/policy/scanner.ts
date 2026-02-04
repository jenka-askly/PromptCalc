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

const findCspContent = (html: string): string | null => {
  const metaMatch = html.match(
    /<meta[^>]+http-equiv=["']content-security-policy["'][^>]+content=["']([^"']+)["'][^>]*>/i
  );
  return metaMatch ? metaMatch[1] : null;
};

const containsRequiredCspDirectives = (content: string, directives: string[]): boolean => {
  const normalized = normalize(content);
  return directives.every((directive) => normalized.includes(normalize(directive)));
};

const matchesPattern = (normalizedHtml: string, pattern: string): boolean =>
  normalizedHtml.includes(normalize(pattern));

export const scanArtifactHtml = (
  artifactHtml: string,
  policy: PromptCalcPolicy
): ScanResult => {
  const normalizedHtml = normalize(artifactHtml);

  const cspContent = findCspContent(artifactHtml);
  if (!cspContent || !containsRequiredCspDirectives(cspContent, policy.requiredCspDirectives)) {
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
