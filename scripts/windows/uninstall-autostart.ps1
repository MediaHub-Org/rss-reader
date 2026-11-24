<#
.SYNOPSIS
  Remove the RSS Reader login task and stop its server.

.DESCRIPTION
  Stops and unregisters the "RSS Reader app server" scheduled task created by
  install-autostart.ps1, then stops any node process running this
  repository's server\app-server.mjs. Safe to run when nothing is installed.
#>
[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$TaskName = 'RSS Reader app server'
$repo = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$server = Join-Path $repo 'server\app-server.mjs'
$removed = $false

$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task) {
  try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction Stop } catch {}
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Task '$TaskName' removed."
  $removed = $true
}

$procs = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object {
    $_.CommandLine -and
    $_.CommandLine.IndexOf($server, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  })
foreach ($p in $procs) {
  try {
    Stop-Process -Id $p.ProcessId -Force -ErrorAction Stop
    Write-Host "Stopped app server (pid $($p.ProcessId))."
    $removed = $true
  } catch {}
}

if (-not $removed) { Write-Host 'Nothing to remove.' }
