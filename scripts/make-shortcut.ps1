# Creates (or refreshes) a Desktop shortcut for the RSS Reader.
#   powershell -ExecutionPolicy Bypass -File scripts\make-shortcut.ps1
#
# The shortcut runs "Launch RSS Reader.bat", which starts the local app
# server in WSL and then opens the installed app / browser at localhost:4173.
$ErrorActionPreference = 'Stop'

$repo = Split-Path -Parent $PSScriptRoot
$png  = Join-Path $repo 'public\icons\icon-192.png'
$ico  = Join-Path $repo 'public\icons\app.ico'
$bat  = Join-Path $repo 'Launch RSS Reader.bat'

if (-not (Test-Path $bat)) { throw "Missing $bat" }

# --- icon: render the app PNG at a size Windows likes, save as .ico ---------
if (Test-Path $png) {
  Add-Type -AssemblyName System.Drawing
  $src = [System.Drawing.Image]::FromFile($png)
  $bmp = New-Object System.Drawing.Bitmap 64, 64
  $gfx = [System.Drawing.Graphics]::FromImage($bmp)
  $gfx.InterpolationMode = 'HighQualityBicubic'
  $gfx.DrawImage($src, 0, 0, 64, 64)
  $gfx.Dispose()

  $icon = [System.Drawing.Icon]::FromHandle($bmp.GetHicon())
  $stream = New-Object System.IO.MemoryStream
  $icon.Save($stream)
  [System.IO.File]::WriteAllBytes($ico, $stream.ToArray())

  $stream.Dispose(); $icon.Dispose(); $bmp.Dispose(); $src.Dispose()
  Write-Host "icon  -> $ico"
}

# --- shortcut ---------------------------------------------------------------
$desktop  = [Environment]::GetFolderPath('Desktop')
$lnkPath  = Join-Path $desktop 'RSS Reader.lnk'
$shell    = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($lnkPath)
$shortcut.TargetPath = $bat
$shortcut.WorkingDirectory = $repo
$shortcut.IconLocation = "$ico,0"
$shortcut.Description = 'Start the local RSS Reader app server and open it'
$shortcut.Save()

Write-Host "link  -> $lnkPath"
