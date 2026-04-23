$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendPath = Join-Path $repoRoot "frontend"

$existingWeb = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingWeb) {
  Write-Host "Web app already listening on port 3000 (PID $($existingWeb.OwningProcess)). Reusing existing process."
  Wait-Process -Id $existingWeb.OwningProcess
  exit 0
}

Set-Location $repoRoot
npm --prefix frontend run dev
