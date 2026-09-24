$ErrorActionPreference = 'Stop'

$projectDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$secretPath = Join-Path (Split-Path -Parent $projectDir) '.secrets\youtube-api-key.dpapi'
$python = 'C:\Users\User\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
$snapshot = Join-Path $projectDir 'site\data.json'
$collector = Join-Path $projectDir 'scripts\collect_youtube.py'
$publisher = Join-Path $projectDir 'scripts\publish_snapshot.py'
$logDir = Join-Path $projectDir 'logs'
$logPath = Join-Path $logDir 'hourly-update.log'

New-Item -ItemType Directory -Path $logDir -Force | Out-Null
Add-Type -AssemblyName System.Security
$protectedBytes = [System.IO.File]::ReadAllBytes($secretPath)
$plainBytes = [System.Security.Cryptography.ProtectedData]::Unprotect(
    $protectedBytes,
    $null,
    [System.Security.Cryptography.DataProtectionScope]::CurrentUser
)

try {
    $env:YOUTUBE_API_KEY = [System.Text.Encoding]::UTF8.GetString($plainBytes).Trim()
    $env:DASHBOARD_DATA_PATH = $snapshot
    $startedAt = Get-Date -Format o
    $collectorOutput = & $python $collector 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Collector failed: $collectorOutput" }
    $publisherOutput = & $python $publisher $snapshot 2>&1
    if ($LASTEXITCODE -ne 0) { throw "Publisher failed: $publisherOutput" }
    "[$startedAt] OK collector=$collectorOutput publisher=$publisherOutput" | Add-Content -LiteralPath $logPath -Encoding utf8
} catch {
    "[$(Get-Date -Format o)] ERROR $($_.Exception.Message)" | Add-Content -LiteralPath $logPath -Encoding utf8
    throw
} finally {
    Remove-Item Env:YOUTUBE_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:DASHBOARD_DATA_PATH -ErrorAction SilentlyContinue
    [Array]::Clear($plainBytes, 0, $plainBytes.Length)
}

