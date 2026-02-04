/**
 * Purpose: Enumerate refusal codes for constrained PromptCalc execution.
 * Persists: None.
 * Security Risks: None.
 */

export type RefusalCode =
  | "AI_SCAN_FAILED"
  | "DISALLOWED_NETWORK"
  | "DISALLOWED_EXTERNAL_DEPENDENCY"
  | "DISALLOWED_CREDENTIAL_UI"
  | "DISALLOWED_EVAL"
  | "DISALLOWED_SCRAPING"
  | "GENERATION_DISABLED"
  | "MISSING_CSP"
  | "MISSING_OPENAI_KEY"
  | "OPENAI_ERROR"
  | "TOO_COMPLEX_V1_SCOPE"
  | "DISALLOWED_RESOURCE_CONSUMPTION"
  | "TOO_LARGE_ARTIFACT";
