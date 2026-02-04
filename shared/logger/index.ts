/**
 * Purpose: Emit structured JSON logs with consistent metadata fields.
 * Persists: None.
 * Security Risks: Callers must avoid logging PII or secrets.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEvent {
  level: LogLevel;
  op: string;
  traceId?: string;
  [key: string]: unknown;
}

export const logEvent = ({ level, op, traceId, ...fields }: LogEvent): void => {
  const entry = {
    ts: new Date().toISOString(),
    level,
    op,
    traceId,
    ...fields,
  };

  console.log(JSON.stringify(entry));
};
