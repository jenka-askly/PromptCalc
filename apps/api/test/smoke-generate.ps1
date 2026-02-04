<#
Purpose: Smoke test the /api/calcs/generate endpoint locally with a sample prompt.
Persists: None.
Security Risks: Sends a prompt to the local API; do not include secrets.
#>

$uri = "http://localhost:7071/api/calcs/generate"
$body = @{
  prompt = "Make a tip calculator with bill, tip %, people, total per person."
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri $uri -ContentType "application/json" -Body $body
