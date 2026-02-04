/**
 * Purpose: Provide a temporary auth stub for identifying callers in development.
 * Persists: None.
 * Security Risks: Reads environment variables for dev-only user identity.
 */

import type { HttpRequest } from "@azure/functions";

type UserContext = {
  userId: string;
  isDevUser: boolean;
};

export const getUserContext = (_req: HttpRequest): UserContext => {
  // DEV ONLY: overridden when real auth is enabled
  const devUserId = process.env.DEV_USER_ID?.trim();
  if (devUserId) {
    return { userId: devUserId, isDevUser: true };
  }

  if (process.env.NODE_ENV === "development") {
    return { userId: "dev-user", isDevUser: false };
  }

  return { userId: "unauthenticated", isDevUser: false };
};

export const getUserId = (req: HttpRequest): string => getUserContext(req).userId;
