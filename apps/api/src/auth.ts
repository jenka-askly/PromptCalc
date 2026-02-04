/**
 * Purpose: Provide a temporary auth stub for identifying callers in development.
 * Persists: None.
 * Security Risks: Reads environment variables for dev-only user identity.
 */

import type { HttpRequest } from "@azure/functions";

export const getUserId = (_req: HttpRequest): string => {
  if (process.env.NODE_ENV === "development") {
    return process.env.DEV_USER_ID || "dev-user";
  }

  return "unauthenticated";
};
