<!--
Purpose: Define the canonical PromptCalc specification, manifest fields, and safety policies for prototype artifacts.
Persists: None.
Security Risks: Describes enforcement rules for untrusted, AI-generated calculator artifacts.
-->

# PromptCalc Specification (SPEC)

## Status
This document is the single source of truth for the PromptCalc prototype specification. All other docs, schemas, and policies must align to this file.

## Spec version
`specVersion: "1.1"`

## Overview
PromptCalc produces offline calculator artifacts (HTML with inline CSS/JS) that run in a locked-down iframe. The artifact is always untrusted. All enforcement and validation happen outside the artifact.

## Manifest
Every calculator must include a manifest with the following required fields:

- `specVersion` (string, must be `1.1`)
- `title` (string)
- `description` (string)
- `executionModel` (enum): `"form" | "expression"`
- `capabilities` (array of strings)
- `inputs` (array of strings)
- `outputs` (array of strings)
- `limitations` (array of strings)
- `safetyNotes` (array of strings)
- `hash` (string, integrity hash of the full artifact)

## Execution models
- `form`: inputs are typed fields; computation uses explicit JavaScript arithmetic with named functions. No expression parsing.
- `expression`: UI includes an expression display/keypad or formula input; evaluation must use a safe arithmetic evaluator (shunting-yard) for `+ - * /` and parentheses. No `eval`, `Function`, or dynamic code execution.

## Artifact constraints
- Output is a complete, self-contained HTML artifact with inline CSS/JS only.
- External resources, network access, and dynamic imports are prohibited.
- Re-prompt/edit behavior is strict: always regenerate the full artifact; never patch/diff. Rescan full output every time.

## Runtime controls
- Iframe watchdog: require `{type:"ready"}` within N seconds or unload + quarantine the artifact.
- Parent message rate limiting + strict schema validation for all postMessage traffic.

## Deterministic banned list
The scanner must deterministically reject artifacts containing any banned constructs, including DoS primitives:
- `setInterval`, `requestAnimationFrame`, `while(true)`, `for(;;)`

## Refusal codes
When rejecting or refusing output, use one of the following codes:
- `DISALLOWED_NETWORK_ACCESS`
- `DISALLOWED_DYNAMIC_CODE`
- `DISALLOWED_RESOURCE_CONSUMPTION`
- `DISALLOWED_NAVIGATION`
- `DISALLOWED_EXTERNAL_DEPENDENCIES`
- `DISALLOWED_CREDENTIAL_PROMPT`

## Enforcement policy
All enforcement code is human-owned and trusted; AI-generated artifacts are always untrusted.

## Invariants
- No model-generated code execution ever; spec-driven only.
- One renderer entry point (later): `CalculatorRenderer`.
- One compute entry point (later): `SafeEvaluator`.
