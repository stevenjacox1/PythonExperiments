$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

$existingWeb = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingWeb) {
  Write-Host "Stopping existing web app on port 3000 (PID $($existingWeb.OwningProcess)) to ensure a clean start from frontend/."
  Stop-Process -Id $existingWeb.OwningProcess -Force
}

Set-Location (Join-Path $repoRoot "frontend")
npm run dev
