/**
 * Purpose: Provide the platform CSP template for sandboxed artifact rendering.
 * Persists: None.
 * Security Risks: Governs iframe Content Security Policy for untrusted HTML.
 */

// must be kept in sync with spec/policy.yaml
const CSP_TEMPLATE =
  "default-src 'none'; connect-src 'none'; img-src 'none'; font-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'";

export const getCspTemplate = (): string => CSP_TEMPLATE;
