param([Parameter(Mandatory)][ValidateSet('frontend', 'backend')][string]$Service)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$nodeExecutable = 'D:\node.exe'
if (!(Test-Path -LiteralPath $nodeExecutable)) {
    $nodeExecutable = (Get-Command node -ErrorAction Stop).Source
}

$logRoot = Join-Path $projectRoot 'startup-logs'
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
$outputLog = Join-Path $logRoot "$Service-$stamp.log"
$errorLog = Join-Path $logRoot "$Service-$stamp.error.log"

if ($Service -eq 'backend') {
    $serviceRoot = Join-Path $projectRoot 'server'
    $nodeArguments = 'src.js'
} else {
    $serviceRoot = Join-Path $projectRoot 'client'
    $nodeArguments = 'node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort'
}

try {
    $options = @{
        FilePath = $nodeExecutable
        ArgumentList = $nodeArguments
        WorkingDirectory = $serviceRoot
        WindowStyle = 'Hidden'
        RedirectStandardOutput = $outputLog
        RedirectStandardError = $errorLog
        PassThru = $true
        Wait = $true
    }
    $process = Start-Process @options
    exit $process.ExitCode
} catch {
    $_.Exception.Message | Out-File -LiteralPath $errorLog -Append -Encoding utf8
    exit 1
}
