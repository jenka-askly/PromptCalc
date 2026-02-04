/**
 * Purpose: Derive or generate trace identifiers for API request correlation.
 * Persists: None.
 * Security Risks: Handles trace headers; avoid logging raw headers directly.
 */

import { randomUUID } from "crypto";

const TRACEPARENT_PARTS = 4;
const TRACE_ID_INDEX = 1;

const isValidTraceId = (value: string): boolean =>
  /^[0-9a-f]{32}$/i.test(value);

export const getTraceId = (traceparent?: string | null): string => {
  if (traceparent) {
    const parts = traceparent.trim().split("-");
    if (parts.length >= TRACEPARENT_PARTS && isValidTraceId(parts[TRACE_ID_INDEX])) {
      return parts[TRACE_ID_INDEX];
    }
  }

  return randomUUID().replace(/-/g, "");
};
