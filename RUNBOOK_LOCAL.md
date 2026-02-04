<!--
Purpose: Document local development and debugging steps for PromptCalc.
Persists: None.
Security Risks: None.
-->

# PromptCalc Local Runbook

## Prereqs
- Node.js 20
- Azure Functions Core Tools v4

## Run commands
- Install dependencies: `npm install`
- Start web + API: `npm run dev`

## URLs
- Web: http://localhost:5173
- API: http://localhost:7071

## Quick API tests (PowerShell)
Generate a calculator:
```powershell
$payload = @{ prompt = "Simple tip calculator with bill + tip% + total." }
Invoke-RestMethod -Method Post -Uri "http://localhost:7071/api/calcs/generate" -ContentType "application/json" -Body (
  $payload | ConvertTo-Json -Depth 5
) | ConvertTo-Json -Depth 6 | Write-Host
```

Fetch a calculator version:
```powershell
$calcId = "<calc-id>"
$versionId = "<version-id>"
Invoke-RestMethod -Method Get -Uri "http://localhost:7071/api/calcs/$calcId/versions/$versionId" -ContentType "application/json" |
  ConvertTo-Json -Depth 6 | Write-Host
```

## Logs
- Logs appear in the running terminal sessions (web + API).
- Use the `traceId` from API responses (including `x-trace-id`) to correlate requests.

## Known issues
- WATCHDOG_TIMEOUT: artifact failed to signal readiness within the watchdog window.
- DISALLOWED_PATTERN: policy scanner found a banned construct (often `new Function`).
- OpenAI 400 schema errors: Responses API rejected `text.format` schema; current fallback is `json_object`.
