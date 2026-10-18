param([switch]$NoBrowser)

$ErrorActionPreference = 'Stop'
$projectRoot = $PSScriptRoot
$logRoot = Join-Path $projectRoot 'startup-logs'

function Test-TcpPort([int]$Port) {
    $socket = New-Object System.Net.Sockets.TcpClient
    try {
        $connection = $socket.ConnectAsync('127.0.0.1', $Port)
        return ($connection.Wait(600) -and $socket.Connected)
    } catch {
        return $false
    } finally {
        $socket.Dispose()
    }
}

function Start-SiteTask([ValidateSet('frontend', 'backend')][string]$Service) {
    $taskName = if ($Service -eq 'frontend') { 'ShuYouFang-Frontend' } else { 'ShuYouFang-Backend' }
    $runner = Join-Path $projectRoot 'site-service.ps1'
    $description = "ShuYouFang local $Service service; manual start only."
    $arguments = '-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "{0}" -Service {1}' -f $runner, $Service
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $executable = "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe"
    $action = New-ScheduledTaskAction -Execute $executable -Argument $arguments -WorkingDirectory $projectRoot
    $principal = New-ScheduledTaskPrincipal -UserId $identity -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
    $existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue

    if ($existing -and $existing.Description -ne $description) {
        throw "Task name already used: $taskName"
    }
    if (!$existing -or $existing.State -ne 'Running') {
        Register-ScheduledTask -TaskName $taskName -Action $action -Principal $principal -Settings $settings -Description $description -Force | Out-Null
    }
    Start-ScheduledTask -TaskName $taskName
}

function Wait-SiteServices {
    $deadline = (Get-Date).AddSeconds(30)
    while (!(Test-TcpPort 8005) -or !(Test-TcpPort 5173)) {
        if ((Get-Date) -gt $deadline) {
            throw "Service startup timed out. Check logs: $logRoot"
        }
        Start-Sleep -Milliseconds 400
    }
}

try {
    $requiredFiles = @('server\.env', 'server\src.js', 'client\node_modules\vite\bin\vite.js', 'site-service.ps1')
    foreach ($relativePath in $requiredFiles) {
        $file = Join-Path $projectRoot $relativePath
        if (!(Test-Path -LiteralPath $file)) {
            throw "Missing required file: $file"
        }
    }

    New-Item -ItemType Directory -Path $logRoot -Force | Out-Null
    if (!(Test-TcpPort 8005)) { Start-SiteTask 'backend' }
    if (!(Test-TcpPort 5173)) { Start-SiteTask 'frontend' }
    Wait-SiteServices

    $page = Invoke-WebRequest -Uri 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 5
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch '/src/main.jsx') {
        throw 'Port 5173 is occupied by another website.'
    }
    try {
        Invoke-WebRequest -Uri 'http://127.0.0.1:8005/api/courses' -UseBasicParsing -TimeoutSec 5 | Out-Null
    } catch {
        if (!$_.Exception.Response -or [int]$_.Exception.Response.StatusCode -ne 401) {
            throw 'Backend is unavailable. Check startup logs and MySQL.'
        }
    }

    Write-Host 'Ready: http://127.0.0.1:5173/'
    if (!$NoBrowser) { Start-Process 'http://127.0.0.1:5173/' }
    exit 0
} catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
