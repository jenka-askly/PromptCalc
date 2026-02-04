/**
 * Purpose: Normalize and format AI scan issue payloads for logging and client responses.
 * Persists: None.
 * Security Risks: Handles AI scan findings that may include snippets of generated HTML; keep truncation to avoid log sprawl.
 */

export type AiScanIssueSummary = {
  category?: string;
  code?: string;
  severity?: string;
  message?: string;
  summary?: string;
  evidence?: string;
  allowed?: boolean;
};

const MAX_FIELD_LENGTH = 400;

const truncateText = (value: string, maxLength: number): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;

const coerceIssueText = (value: unknown): string | undefined => {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? truncateText(trimmed, MAX_FIELD_LENGTH) : undefined;
};

const safeJsonStringify = (value: unknown, maxLength: number): string | undefined => {
  try {
    const serialized = JSON.stringify(value);
    return truncateText(serialized, maxLength);
  } catch {
    return undefined;
  }
};

const normalizeIssueObject = (record: Record<string, unknown>): AiScanIssueSummary => {
  const category = coerceIssueText(record.category ?? record.type ?? record.kind);
  const code = coerceIssueText(record.code ?? record.id);
  const severity = coerceIssueText(record.severity ?? record.level);
  const message = coerceIssueText(record.message ?? record.reason);
  const summary = coerceIssueText(record.summary ?? record.description);
  const evidence = coerceIssueText(record.evidence ?? record.snippet);
  const allowed = typeof record.allowed === "boolean" ? record.allowed : undefined;

  if (category || code || severity || message || summary || evidence || allowed !== undefined) {
    return {
      category,
      code,
      severity,
      message,
      summary,
      evidence,
      allowed,
    };
  }

  const fallback = safeJsonStringify(record, MAX_FIELD_LENGTH);
  return fallback ? { message: fallback } : { message: "Unrecognized AI scan issue." };
};

export const summarizeAiScanIssues = (issues: unknown[]): AiScanIssueSummary[] =>
  issues.map((issue) => {
    if (typeof issue === "string") {
      return { message: truncateText(issue, MAX_FIELD_LENGTH) };
    }
    if (issue && typeof issue === "object") {
      return normalizeIssueObject(issue as Record<string, unknown>);
    }
    if (issue === null || issue === undefined) {
      return { message: "Unknown AI scan issue." };
    }
    return { message: truncateText(String(issue), MAX_FIELD_LENGTH) };
  });

export const formatAiScanIssueSummary = (summary: AiScanIssueSummary): string => {
  const parts: string[] = [];
  if (summary.category) {
    parts.push(`category=${summary.category}`);
  }
  if (summary.code) {
    parts.push(`code=${summary.code}`);
  }
  if (summary.severity) {
    parts.push(`severity=${summary.severity}`);
  }
  const message = summary.message ?? summary.summary;
  if (message) {
    parts.push(`message=${message}`);
  }
  if (summary.summary && summary.summary !== summary.message) {
    parts.push(`summary=${summary.summary}`);
  }
  if (summary.evidence) {
    parts.push(`evidence=${summary.evidence}`);
  }
  if (summary.allowed !== undefined) {
    parts.push(`allowed=${summary.allowed}`);
  }
  return parts.length > 0 ? parts.join(" | ") : "Unknown AI scan issue.";
};

export const stringifyAiScanIssueSummaries = (
  summaries: AiScanIssueSummary[],
  maxLength = 4096
): string => safeJsonStringify(summaries, maxLength) ?? "[]";

const normalizeCategory = (value: string): string =>
  value.trim().toLowerCase().replace(/[\s-]+/g, "_");

const buildIssueText = (summary: AiScanIssueSummary): string =>
  [
    summary.category,
    summary.code,
    summary.message,
    summary.summary,
    summary.evidence,
  ]
    .filter((value): value is string => Boolean(value))
    .join(" | ");

const OFFLINE_WARNING_REGEX = /do not enter passwords?/i;
const DOM_EVENT_REGEX = /(addeventlistener|getelementbyid|queryselector)/i;
const INLINE_JS_REGEX = /(inline script|inline javascript|\binline js\b)/i;
const UNSAFE_INLINE_REGEX = /unsafe-inline/i;
const POSTMESSAGE_REGEX = /postmessage/i;
const DYNAMIC_EXECUTION_MISLABEL_REGEX = /(dynamic|execution|eval|code)/i;

const isOfflineWarningBanner = (text: string): boolean => OFFLINE_WARNING_REGEX.test(text);

const isDomEventDynamicMislabel = (text: string): boolean =>
  DOM_EVENT_REGEX.test(text) && DYNAMIC_EXECUTION_MISLABEL_REGEX.test(text);

const isNeverFailIssue = (text: string, normalizedCategory?: string): boolean => {
  if (isOfflineWarningBanner(text)) {
    return true;
  }
  if (isDomEventDynamicMislabel(text)) {
    return true;
  }
  if (normalizedCategory && ALLOWED_AI_SCAN_CATEGORIES.has(normalizedCategory)) {
    return true;
  }
  if (INLINE_JS_REGEX.test(text)) {
    return true;
  }
  if (UNSAFE_INLINE_REGEX.test(text)) {
    return true;
  }
  if (POSTMESSAGE_REGEX.test(text)) {
    return true;
  }
  return false;
};

const NETWORKING_REGEX = /(fetch|xmlhttprequest|websocket|sendbeacon|eventsource)\b/i;
const EXTERNAL_RESOURCE_REGEX = /(<script\s+src|<img\s+src|<link\s+href|@import|url\()/i;
const DYNAMIC_CODE_REGEX =
  /(eval\s*\(|new function\s*\(|settimeout\s*\(\s*['"]|setinterval\s*\(\s*['"]|createelement\s*\(\s*['"]script['"]\s*\))/i;
const FUNCTION_CONSTRUCTOR_REGEX = /\bFunction\s*\(/;
const NAVIGATION_REGEX = /(window\.open|top\.location|parent\.location|target=_top|location\.href\s*=)/i;
const PASSWORD_INPUT_REGEX = /type\s*=\s*['"]password['"]|input[^>]+password/i;
const LOGIN_FORM_REGEX = /(login|sign[-\s]?in|enter password)/i;
const FORM_FIELD_REGEX = /(input|field|form)/i;
const DATA_EXFILTRATION_REGEX = /(exfil|encode|base64|leak|transmit)/i;

const isCredentialCapture = (text: string): boolean => {
  if (isOfflineWarningBanner(text)) {
    return false;
  }
  if (PASSWORD_INPUT_REGEX.test(text)) {
    return true;
  }
  if (LOGIN_FORM_REGEX.test(text) && FORM_FIELD_REGEX.test(text)) {
    return true;
  }
  return false;
};

export const DISALLOWED_AI_SCAN_CATEGORIES = new Set([
  "networking",
  "external_resource",
  "dynamic_code",
  "navigation",
  "credential_capture",
  "data_exfiltration",
]);

export const ALLOWED_AI_SCAN_CATEGORIES = new Set([
  "inline_script",
  "inline_event_handler",
  "unsafe_inline_csp",
  "postmessage",
]);

const detectCategoryFromText = (text: string): string | undefined => {
  const normalized = text.toLowerCase();
  if (NETWORKING_REGEX.test(normalized)) {
    return "networking";
  }
  if (EXTERNAL_RESOURCE_REGEX.test(normalized)) {
    return "external_resource";
  }
  if (DYNAMIC_CODE_REGEX.test(normalized) || FUNCTION_CONSTRUCTOR_REGEX.test(text)) {
    return "dynamic_code";
  }
  if (NAVIGATION_REGEX.test(normalized)) {
    return "navigation";
  }
  if (isCredentialCapture(text)) {
    return "credential_capture";
  }
  if (DATA_EXFILTRATION_REGEX.test(normalized)) {
    return "data_exfiltration";
  }
  if (POSTMESSAGE_REGEX.test(normalized)) {
    return "postmessage";
  }
  if (INLINE_JS_REGEX.test(normalized)) {
    return "inline_script";
  }
  if (/inline event handler/.test(normalized)) {
    return "inline_event_handler";
  }
  if (UNSAFE_INLINE_REGEX.test(normalized)) {
    return "unsafe_inline_csp";
  }
  return undefined;
};

type AiScanIssuePartition = {
  disallowed: unknown[];
  allowed: unknown[];
  uncategorized: unknown[];
};

export const partitionAiScanIssues = (issues: unknown[]): AiScanIssuePartition => {
  const disallowed: unknown[] = [];
  const allowed: unknown[] = [];
  const uncategorized: unknown[] = [];

  for (const issue of issues) {
    if (typeof issue === "string") {
      const category = detectCategoryFromText(issue);
      if (category && DISALLOWED_AI_SCAN_CATEGORIES.has(category)) {
        disallowed.push(issue);
      } else if (category && ALLOWED_AI_SCAN_CATEGORIES.has(category)) {
        allowed.push(issue);
      } else {
        uncategorized.push(issue);
      }
      continue;
    }

    if (issue && typeof issue === "object") {
      const record = issue as Record<string, unknown>;
      const rawCategory = coerceIssueText(record.category ?? record.type ?? record.kind);
      const category = rawCategory ? normalizeCategory(rawCategory) : undefined;
      const allowedFlag = typeof record.allowed === "boolean" ? record.allowed : undefined;

      if (category && DISALLOWED_AI_SCAN_CATEGORIES.has(category) && allowedFlag !== true) {
        disallowed.push(issue);
        continue;
      }
      if (allowedFlag === true || (category && ALLOWED_AI_SCAN_CATEGORIES.has(category))) {
        allowed.push(issue);
        continue;
      }
      uncategorized.push(issue);
      continue;
    }

    uncategorized.push(issue);
  }

  return { disallowed, allowed, uncategorized };
};

export type AiScanPolicyDecision = {
  disallowed: AiScanIssueSummary[];
  allowed: AiScanIssueSummary[];
  ignored: AiScanIssueSummary[];
  uncategorized: AiScanIssueSummary[];
};

const coerceSummaryCategory = (
  summary: AiScanIssueSummary,
  fallbackText: string
): string | undefined => {
  const category = summary.category ? normalizeCategory(summary.category) : undefined;
  return category ?? detectCategoryFromText(fallbackText);
};

const normalizeEvidence = (summary: AiScanIssueSummary): string | undefined =>
  summary.evidence ?? summary.message ?? summary.summary;

const detectDisallowedCategory = (
  normalizedCategory: string | undefined,
  text: string
): string | undefined => {
  if (normalizedCategory && DISALLOWED_AI_SCAN_CATEGORIES.has(normalizedCategory)) {
    if (normalizedCategory === "credential_capture" && !isCredentialCapture(text)) {
      return undefined;
    }
    if (normalizedCategory === "dynamic_code") {
      const normalized = text.toLowerCase();
      if (
        !DYNAMIC_CODE_REGEX.test(normalized) &&
        !FUNCTION_CONSTRUCTOR_REGEX.test(text)
      ) {
        return undefined;
      }
    }
    return normalizedCategory;
  }

  if (NETWORKING_REGEX.test(text)) {
    return "networking";
  }
  if (EXTERNAL_RESOURCE_REGEX.test(text)) {
    return "external_resource";
  }
  if (DYNAMIC_CODE_REGEX.test(text) || FUNCTION_CONSTRUCTOR_REGEX.test(text)) {
    return "dynamic_code";
  }
  if (NAVIGATION_REGEX.test(text)) {
    return "navigation";
  }
  if (isCredentialCapture(text)) {
    return "credential_capture";
  }
  if (DATA_EXFILTRATION_REGEX.test(text)) {
    return "data_exfiltration";
  }

  return undefined;
};

export const evaluateAiScanPolicy = (issues: unknown[]): AiScanPolicyDecision => {
  const summaries = summarizeAiScanIssues(issues);
  const disallowed: AiScanIssueSummary[] = [];
  const allowed: AiScanIssueSummary[] = [];
  const ignored: AiScanIssueSummary[] = [];
  const uncategorized: AiScanIssueSummary[] = [];

  for (const summary of summaries) {
    const text = buildIssueText(summary);
    const normalizedCategory = coerceSummaryCategory(summary, text);

    if (isNeverFailIssue(text, normalizedCategory)) {
      ignored.push({ ...summary, category: normalizedCategory ?? summary.category });
      continue;
    }

    const disallowedCategory = detectDisallowedCategory(normalizedCategory, text);
    if (disallowedCategory) {
      disallowed.push({
        ...summary,
        category: disallowedCategory,
        evidence: normalizeEvidence(summary),
      });
      continue;
    }

    if (normalizedCategory && ALLOWED_AI_SCAN_CATEGORIES.has(normalizedCategory)) {
      allowed.push({ ...summary, category: normalizedCategory });
      continue;
    }

    uncategorized.push(summary);
  }

  return { disallowed, allowed, ignored, uncategorized };
};
