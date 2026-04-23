$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$apiPath = Join-Path $repoRoot "api"
$venvActivate = Join-Path $apiPath ".venv\Scripts\Activate.ps1"

$existingApi = Get-NetTCPConnection -LocalPort 7071 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
if ($existingApi) {
  Write-Host "API already listening on port 7071 (PID $($existingApi.OwningProcess)). Reusing existing process."
  Wait-Process -Id $existingApi.OwningProcess
  exit 0
}

if (-not (Test-Path $venvActivate)) {
  Write-Error "Missing API virtual environment at $venvActivate. Run: cd api; python -m venv .venv; .\\.venv\\Scripts\\Activate.ps1; pip install -r requirements.txt"
}

. $venvActivate
Set-Location $apiPath
func start
