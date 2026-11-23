<#
.SYNOPSIS
  Start the RSS Reader app server at login, with no window.

.DESCRIPTION
  Registers a per-user scheduled task, "RSS Reader app server", that runs
  server\app-server.mjs from this repository at logon through
  "conhost.exe --headless" (no console window). It serves the installed PWA
  and its feed proxy on http://localhost:4173, loopback only. The task is
  restarted up to 3 times if it stops. Running the script again replaces the
  task. No administrator rights are needed.

  Remove it with scripts\windows\uninstall-autostart.ps1.

.PARAMETER StartNow
  Also start the task immediately and wait until the app answers.

.EXAMPLE
  pwsh -NoProfile -File scripts\windows\install-autostart.ps1 -StartNow
#>
[CmdletBinding()]
param([switch]$StartNow)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'RSS Reader app server'
$Port = 4173
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$server = Join-Path $repo 'server\app-server.mjs'

if (-not (Test-Path (Join-Path $repo 'dist\index.html'))) {
  throw "dist\ is missing in $repo. Run 'npm run build' first."
}
$nodeCmd = Get-Command node -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $nodeCmd) { throw 'node was not found on PATH. Install Node.js 20+ first.' }
$node = $nodeCmd.Source

$conhost = Join-Path $env:SystemRoot 'System32\conhost.exe'
$action = New-ScheduledTaskAction -Execute $conhost `
  -Argument ('--headless "{0}" "{1}"' -f $node, $server) `
  -WorkingDirectory $repo
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
  -Settings $settings -Principal $principal `
  -Description 'Serves the RSS Reader PWA and its feed proxy on localhost:4173 (loopback only).' `
  -Force | Out-Null
Write-Host "Task '$TaskName' registered: starts at login."
Write-Host "  node:   $node"
Write-Host "  server: $server"

if ($StartNow) {
  Start-ScheduledTask -TaskName $TaskName
  $deadline = (Get-Date).AddSeconds(10)
  $up = $false
  while ((Get-Date) -lt $deadline -and -not $up) {
    try {
      $null = Invoke-WebRequest -Uri "http://localhost:$Port/" -UseBasicParsing -TimeoutSec 2
      $up = $true
    } catch {
      Start-Sleep -Milliseconds 500
    }
  }
  if ($up) { Write-Host "Ready -> http://localhost:$Port" }
  else { Write-Warning "The task started but http://localhost:$Port did not answer within 10 s. Is the port taken (npm run preview)?" }
}
