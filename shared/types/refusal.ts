/**
 * Purpose: Enumerate refusal codes for constrained PromptCalc execution.
 * Persists: None.
 * Security Risks: None.
 */

export type RefusalCode =
  | "DISALLOWED_NETWORK"
  | "DISALLOWED_EXTERNAL_DEPENDENCY"
  | "DISALLOWED_CREDENTIAL_UI"
  | "DISALLOWED_SCRAPING"
  | "TOO_COMPLEX_V1_SCOPE"
  | "DISALLOWED_RESOURCE_CONSUMPTION";
