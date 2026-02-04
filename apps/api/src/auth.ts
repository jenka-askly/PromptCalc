/**
 * Purpose: Resolve user identity using Easy Auth headers or dev-only overrides.
 * Persists: None.
 * Security Risks: Reads authentication headers and environment-based dev overrides.
 */

import type { HttpRequest } from "@azure/functions";
import { createHash } from "crypto";

type UserContext = {
  userId: string;
  isAuthenticated: boolean;
  identityProvider?: string;
  claims?: Record<string, string>;
};

type ClientPrincipal = {
  identityProvider?: string;
  userId?: string;
  userDetails?: string;
  claims?: Array<{ typ?: string; val?: string }>;
};

const base64UrlEncode = (value: Buffer): string =>
  value
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");

const hashPrincipalId = (principalId: string): string => {
  const hash = createHash("sha256").update(principalId, "utf8").digest();
  return `u_${base64UrlEncode(hash)}`;
};

const parseClientPrincipal = (encoded: string): ClientPrincipal | null => {
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    return JSON.parse(decoded) as ClientPrincipal;
  } catch {
    return null;
  }
};

const getPrincipalIdFromClaims = (claims: ClientPrincipal["claims"]): string | undefined => {
  if (!claims) {
    return undefined;
  }
  const candidate = claims.find((claim) =>
    ["http://schemas.microsoft.com/identity/claims/objectidentifier", "oid", "sub"].includes(
      String(claim.typ)
    )
  );
  return typeof candidate?.val === "string" ? candidate.val : undefined;
};

const resolveEasyAuthContext = (req: HttpRequest): UserContext | null => {
  const principalHeader = req.headers.get("x-ms-client-principal");
  if (principalHeader) {
    const principal = parseClientPrincipal(principalHeader);
    const principalId =
      (typeof principal?.userId === "string" && principal.userId) ||
      getPrincipalIdFromClaims(principal?.claims) ||
      (typeof principal?.userDetails === "string" && principal.userDetails);
    if (principalId) {
      return {
        userId: hashPrincipalId(principalId),
        isAuthenticated: true,
        identityProvider: principal?.identityProvider ?? "easy-auth",
      };
    }
  }

  const principalId = req.headers.get("x-ms-client-principal-id");
  const principalName = req.headers.get("x-ms-client-principal-name");
  const fallbackId = principalId || principalName;
  if (fallbackId) {
    return {
      userId: hashPrincipalId(fallbackId),
      isAuthenticated: true,
      identityProvider: "easy-auth",
    };
  }

  return null;
};

const resolveFakeEasyAuthContext = (req: HttpRequest): UserContext | null => {
  if (process.env.PROMPTCALC_ACCEPT_FAKE_EASYAUTH !== "true") {
    return null;
  }
  const fakePrincipalId = req.headers.get("x-promptcalc-fake-principal-id");
  if (!fakePrincipalId) {
    return null;
  }
  return {
    userId: hashPrincipalId(fakePrincipalId),
    isAuthenticated: true,
    identityProvider: "fake-easyauth",
  };
};

export const getUserContext = (req: HttpRequest): UserContext => {
  const devUserId = process.env.DEV_USER_ID?.trim();
  if (devUserId) {
    return { userId: devUserId, isAuthenticated: false, identityProvider: "dev" };
  }

  const fakeContext = resolveFakeEasyAuthContext(req);
  if (fakeContext) {
    return fakeContext;
  }

  const easyAuthContext = resolveEasyAuthContext(req);
  if (easyAuthContext) {
    return easyAuthContext;
  }

  return { userId: "unauthenticated", isAuthenticated: false };
};

export const getUserId = (req: HttpRequest): string => getUserContext(req).userId;
