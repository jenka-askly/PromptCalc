<!--
Purpose: Describe the PromptCalc scaffold and point to the canonical specification.
Persists: None.
Security Risks: None.
-->

# PromptCalc

PromptCalc is a spec-driven prototype for turning prompts into constrained, offline calculator UIs. The canonical specification lives in [`spec/SPEC.md`](spec/SPEC.md) and is the single source of truth.

## Local development
- Use Node.js 20 and Azure Functions Core Tools v4 for the API.
- Install dependencies: `npm install`
- Start the web app and API together: `npm run dev`

## Quick sanity check
- Open the web app in your browser.
- Click **Check health** to call `/api/health`.
- Confirm the response shows `ok`, `service`, `build`, and a `traceId` (also returned in the `x-trace-id` header).
