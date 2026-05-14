# Start the free-claude-code proxy server (Windows)
$proxyDir = Join-Path $PSScriptRoot "..\proxy"
Set-Location $proxyDir

Write-Host "Starting free-claude-code proxy on port 8082..." -ForegroundColor Green
Write-Host "Admin UI: http://localhost:8082/admin" -ForegroundColor Cyan

uv run uvicorn server:app --host 0.0.0.0 --port 8082
