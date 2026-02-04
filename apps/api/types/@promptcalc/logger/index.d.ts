/**
 * Purpose: Provide minimal logger type stubs for offline TypeScript builds.
 * Persists: None.
 * Security Risks: Describes the logging API surface.
 */

export type LogEvent = Record<string, unknown>;

export function logEvent(event: LogEvent): void;
