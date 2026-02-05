/**
 * Purpose: Expose a health endpoint for local diagnostics with trace correlation.
 * Persists: None.
 * Security Risks: Logs request metadata and trace IDs; avoid PII.
 */

import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import { logEvent } from "@promptcalc/logger";
import { getUserContext } from "../auth";
import { getTraceId } from "../trace";
import { resolveScanPolicyConfig } from "../generation/scanPolicy";

const buildId = process.env.BUILD_ID || "dev";

const toResponse = (
  traceId: string,
  authContext: { isAuthenticated: boolean; identityProvider?: string; userId?: string },
  redTeamCapabilityAvailable: boolean
): HttpResponseInit => ({
  jsonBody: {
    ok: true,
    service: "api",
    build: buildId,
    traceId,
    auth: authContext,
    redTeamCapabilityAvailable,
  },
  headers: {
    "content-type": "application/json",
    "x-trace-id": traceId,
  },
});

export const health = async (
  req: HttpRequest,
  context: InvocationContext
): Promise<HttpResponseInit> => {
  const traceId = getTraceId(req.headers.get("traceparent"));
  const startedAt = Date.now();
  const op = "health";
  const { userId, isAuthenticated, identityProvider } = getUserContext(req);

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.start",
    method: req.method,
    route: "/api/health",
    userId,
    isAuthenticated,
    identityProvider,
  });

  const response = toResponse(traceId, {
    isAuthenticated,
    identityProvider,
    ...(isAuthenticated || identityProvider === "dev" ? { userId } : {}),
  }, resolveScanPolicyConfig().redTeamCapabilityAvailable);
  const durationMs = Date.now() - startedAt;

  logEvent({
    level: "info",
    op,
    traceId,
    event: "request.end",
    durationMs,
    status: response.status ?? 200,
  });

  context.log(`health check completed in ${durationMs}ms`);

  return response;
};

app.http("health", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "health",
  handler: health,
});
