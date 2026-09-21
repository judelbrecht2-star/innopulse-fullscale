$ErrorActionPreference = 'Stop'

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$apiKey = Read-Host 'Paste the TypeSafe API key (input is masked)' -MaskInput
$apiKey = $apiKey.Trim()
if ([string]::IsNullOrWhiteSpace($apiKey)) {
    throw 'No API key was entered.'
}

$workDirectory = Join-Path $projectRoot 'work'
$logPath = Join-Path $workDirectory 'jev-evaluation-latest.log'
New-Item -ItemType Directory -Path $workDirectory -Force | Out-Null

$env:TYPESAFE_API_KEY = $apiKey
try {
    Write-Host ''
    Write-Host 'Running the live Jev evaluation...'
    & npm run eval:jev 2>&1 | Tee-Object -FilePath $logPath
    $evaluationExitCode = $LASTEXITCODE
}
finally {
    Remove-Item Env:TYPESAFE_API_KEY -ErrorAction SilentlyContinue
    $apiKey = $null
}

Write-Host ''
if ($evaluationExitCode -eq 0) {
    Write-Host "Evaluation finished. Results were also saved to $logPath" -ForegroundColor Green
}
else {
    Write-Host "Evaluation exited with code $evaluationExitCode. See $logPath" -ForegroundColor Yellow
}

Read-Host 'Press Enter to close this window'
