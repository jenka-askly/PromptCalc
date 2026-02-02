<!--
Purpose: Capture structured logging requirements for the PromptCalc backend.
Persists: None.
Security Risks: Logging must avoid sensitive payloads.
-->

# Logging

Required structured fields:
- `timestampUtc`
- `operation`
- `requestId`
- `outcome`
- `durationMs`

Correlation IDs must be propagated from incoming requests when possible.
