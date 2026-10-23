$ErrorActionPreference = 'Stop'
Set-Location (Join-Path $PSScriptRoot '..')
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw 'Install Node.js 24 LTS from https://nodejs.org, then reopen PowerShell.'
}
if (-not (Test-Path 'node_modules')) {
  npm.cmd ci
  if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed.' }
}
Write-Host 'Game UI Studio: open http://127.0.0.1:4380 in your local browser. Ctrl+C stops the server.'
npm.cmd run dev
exit $LASTEXITCODE
