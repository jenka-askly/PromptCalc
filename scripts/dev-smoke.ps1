<#
Purpose: Exercise PromptCalc persistence and generation endpoints against a running local API host.
Persists: Creates and deletes calculator metadata in PromptCalcMeta and blobs under users/<userId>/calcs/<calcId>/.
Security Risks: Sends sample HTML/manifest content over HTTP to the local API.
#>

param(
  [string]$BaseUrl = "http://localhost:7071/api"
)

$ErrorActionPreference = "Stop"

$sampleManifest = @{
  specVersion = "1.0"
  title = "Offline Add Calculator"
  executionModel = "eventHandlers"
  capabilities = @{ network = $false }
  inputs = @()
  outputs = @()
  limitations = @()
  safetyNotes = @()
}

$sampleArtifact = @"
<!doctype html>
<html><body><h1>Calculator</h1></body></html>
"@

Write-Host "Saving calculator..."
$saveResponse = Invoke-RestMethod -Method Post -Uri "$BaseUrl/calcs/save" -ContentType "application/json" -Body (
  @{
    title = "Offline Add Calculator"
    artifactHtml = $sampleArtifact
    manifest = $sampleManifest
  } | ConvertTo-Json -Depth 5
)

$calcId = $saveResponse.calcId
$versionId = $saveResponse.versionId
Write-Host "Saved calc $calcId version $versionId"

Write-Host "Listing calculators..."
Invoke-RestMethod -Method Get -Uri "$BaseUrl/calcs" | ConvertTo-Json -Depth 5 | Write-Host

Write-Host "Loading version..."
Invoke-RestMethod -Method Get -Uri "$BaseUrl/calcs/$calcId/versions/$versionId" | ConvertTo-Json -Depth 5 | Write-Host

Write-Host "Promoting version..."
Invoke-RestMethod -Method Post -Uri "$BaseUrl/calcs/$calcId/versions/$versionId/promote" | ConvertTo-Json -Depth 5 | Write-Host

Write-Host "Generating calculator..."
$generateResponse = Invoke-RestMethod -Method Post -Uri "$BaseUrl/calcs/generate" -ContentType "application/json" -Body (
  @{
    prompt = "Simple tip calculator with bill + tip% + total."
  } | ConvertTo-Json -Depth 5
)
$generateResponse | ConvertTo-Json -Depth 6 | Write-Host

Write-Host "Deleting calculator..."
Invoke-RestMethod -Method Delete -Uri "$BaseUrl/calcs/$calcId" | ConvertTo-Json -Depth 5 | Write-Host

Write-Host "Smoke test complete."
