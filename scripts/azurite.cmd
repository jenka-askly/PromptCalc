@echo off
REM Purpose: Start Azurite with local storage paths for PromptCalc development.
REM Persists: Writes blobs and table data under .\.azurite and logs to .\.azurite\debug.log.
REM Security Risks: Runs local storage emulator with filesystem access.

azurite.cmd --silent --skipApiVersionCheck --location .\.azurite --debug .\.azurite\debug.log
