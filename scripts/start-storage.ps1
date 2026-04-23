$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$storagePath = Join-Path $repoRoot ".azurite"
New-Item -ItemType Directory -Force $storagePath | Out-Null

$blob = Get-NetTCPConnection -LocalPort 10000 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$queue = Get-NetTCPConnection -LocalPort 10001 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
$table = Get-NetTCPConnection -LocalPort 10002 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($blob -and $queue -and $table -and ($blob.OwningProcess -eq $queue.OwningProcess) -and ($queue.OwningProcess -eq $table.OwningProcess)) {
  Write-Host "Azurite already running on ports 10000/10001/10002 (PID $($blob.OwningProcess)). Reusing existing process."
  Wait-Process -Id $blob.OwningProcess
  exit 0
}

Set-Location $repoRoot
azurite --location .azurite --silent
