<#
Purpose: Exercise the PromptCalc generation endpoint against a running local API host.
Persists: Creates calculator metadata in PromptCalcMeta and blobs under users/<userId>/calcs/<calcId>/.
Security Risks: Sends prompts to the local API; avoid logging secrets.
#>

param(
  [string]$BaseUrl = "http://localhost:7071/api"
)

$ErrorActionPreference = "Stop"

$payload = @{
  prompt = "Simple tip calculator with bill + tip% + total."
}

Write-Host "Generating calculator..."
$response = Invoke-RestMethod -Method Post -Uri "$BaseUrl/calcs/generate" -ContentType "application/json" -Body (
  $payload | ConvertTo-Json -Depth 5
)

$response | ConvertTo-Json -Depth 6 | Write-Host
Write-Host "Generation complete."
