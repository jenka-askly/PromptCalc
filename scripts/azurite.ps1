<#
Purpose: Start Azurite with local storage paths for PromptCalc development.
Persists: Writes blobs and table data under ./.azurite and logs to ./.azurite/debug.log.
Security Risks: Runs local storage emulator with filesystem access.
#>

& "$PSScriptRoot\azurite.cmd" --silent --skipApiVersionCheck --location .\.azurite --debug .\.azurite\debug.log
