/**
 * Purpose: Provide minimal Azure Functions type stubs for offline TypeScript builds.
 * Persists: None.
 * Security Risks: Describes HTTP trigger request/response shapes.
 */

export type HttpRequest = {
  json: () => Promise<unknown>;
  headers: { get: (name: string) => string | null };
  query: Record<string, string | undefined>;
  params: Record<string, string | undefined>;
  method?: string;
  url?: string;
  body?: unknown;
};

export type HttpResponseInit = {
  status?: number;
  jsonBody?: unknown;
  headers?: Record<string, string>;
};

export type InvocationContext = {
  traceContext?: {
    traceparent?: string;
    tracestate?: string;
  };
  log: (...args: unknown[]) => void;
};

export const app: {
  http: (
    name: string,
    options: {
      route?: string;
      methods?: string[];
      authLevel?: string;
      handler: (
        req: HttpRequest,
        context: InvocationContext
      ) => Promise<HttpResponseInit> | HttpResponseInit;
    }
  ) => void;
};
