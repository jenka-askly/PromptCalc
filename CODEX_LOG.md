<!--
Purpose: Maintain an append-only log of CODEX-driven merges for continuity.
Persists: None.
Security Risks: None.
-->

# CODEX Log

## 2026-02-04
**Summary**
- Updated generation instructions to avoid `<form>` tags and enforce button click handlers for calculators.
- Added deterministic artifact post-processing to rewrite form buttons, prevent submit navigation, and log form presence.
- Added unit coverage for form safety rewrites plus continuity status updates.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Revalidate CNC/tip calculators in sandboxed iframe to confirm no blocked form submission warnings.

## 2026-02-04
**Summary**
- Refined AI scan rubric to explicitly allow warning banners, DOM event wiring, and clarified dynamic code execution scope.
- Added deterministic post-processing guardrails plus tests to suppress known false positives while reporting disallowed evidence.
- Updated AI scan refusal messaging with targeted alternatives and logged ignored/allowed issue groups.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Confirm offline warning banner text no longer triggers credential-capture refusals.

## 2026-02-05
**Summary**
- Aligned AI artifact scan rubric with sandbox policy to allow inline JS, postMessage, and unsafe-inline CSP while still refusing true violations.
- Added AI scan policy handling tests and updated status/decision notes.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Verify CNC calculator prompts no longer fail AI_SCAN_FAILED when only inline JS/postMessage/unsafe-inline are present.

## 2026-02-04
**Summary**
- Added continuity documentation (status, decisions, prompts, runbook, codex log).
- Linked continuity docs from the README.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Validate continuity docs after next merge and update PROJECT_STATUS.md + CODEX_LOG.md.

## 2026-02-04
**Summary**
- Expanded AI scan refusal logging to include issue summaries and returned readable refusal details to the UI.
- Added AI scan issue formatting test coverage and refreshed runbook/status notes for AI_SCAN_FAILED.

**Commit/PR**
- <commit-hash-or-pr-link>

**Notes**
- Verify AI scan issue summaries appear in `artifact.aiScan.failed` logs when generation is refused.
