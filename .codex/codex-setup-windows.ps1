param(
  [switch]$Verify
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Split-Path -Parent $repoRoot
$miseToml = Join-Path $repoRoot "mise.toml"

if (-not (Test-Path -LiteralPath $miseToml)) {
  throw "mise.toml not found at $miseToml"
}

$env:CI = "true"
$env:NPM_CONFIG_AUDIT = "false"
$env:NPM_CONFIG_FUND = "false"
$env:NPM_CONFIG_UPDATE_NOTIFIER = "false"
$env:NPM_CONFIG_CONFIRM_MODULES_PURGE = "false"
$env:PNPM_DISABLE_SELF_UPDATE_CHECK = "true"

Write-Host "Trusting mise config: $miseToml"
& mise trust $miseToml

if ($LASTEXITCODE -ne 0) {
  exit $LASTEXITCODE
}

Write-Host "Installing mise-managed tools"
Push-Location $repoRoot
try {
  & mise install -y
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

Write-Host "Installing APM dependencies"
Push-Location $repoRoot
try {
  & apm install --frozen
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
} finally {
  Pop-Location
}

if ($Verify) {
  Write-Host "Verifying mise-managed tools"
  & pnpm --version
  if ($LASTEXITCODE -ne 0) {
    exit $LASTEXITCODE
  }
}

Write-Host "Setup complete."
