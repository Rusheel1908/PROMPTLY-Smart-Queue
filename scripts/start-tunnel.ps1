<#
.SYNOPSIS
  Put the running demo on a public https URL (cloudflared quick tunnel), so phones can open it.

.DESCRIPTION
  Needs the demo running first (.\scripts\start-demo.ps1). Starts "cloudflared tunnel --url http://localhost:5173" in
  its own window, waits until the public https://<random>.trycloudflare.com address answers, prints it, copies it to
  the clipboard and opens the kiosk at that address: tickets printed there carry QR codes that phones can open.
  The address changes every time; running this again replaces the previous tunnel. Close the tunnel window to stop it.

  Install cloudflared once (Windows 10/11, asks for admin rights):
      winget install --id Cloudflare.cloudflared
  then open a new PowerShell window.

.EXAMPLE
  .\scripts\start-tunnel.ps1
.EXAMPLE
  .\scripts\start-tunnel.ps1 -NoBrowser -Cloudflared C:\tools\cloudflared.exe
#>
param([switch]$NoBrowser, [string]$Cloudflared)

$Local = 'http://localhost:5173'
$Log = Join-Path $env:TEMP 'promptly-tunnel.log'

function Say([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Stop-Tunnel([string]$text) { Write-Host ''; Write-Host "XX  $text" -ForegroundColor Red; exit 1 }

# ---------- the demo must be running ----------
try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "$Local/" | Out-Null }
catch { Stop-Tunnel "Nothing answers at $Local. Start the demo first: .\scripts\start-demo.ps1" }

# ---------- find cloudflared ----------
if (-not $Cloudflared) {
  $onPath = Get-Command cloudflared -ErrorAction SilentlyContinue
  $candidates = @(
    $(if ($onPath) { $onPath.Source }),
    (Join-Path ${env:ProgramFiles(x86)} 'cloudflared\cloudflared.exe'),
    (Join-Path $env:ProgramFiles 'cloudflared\cloudflared.exe'),
    (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\cloudflared.exe')
  ) | Where-Object { $_ -and (Test-Path $_) }
  $Cloudflared = $candidates | Select-Object -First 1
}
if (-not $Cloudflared -or -not (Test-Path $Cloudflared)) {
  Stop-Tunnel @'
cloudflared is not installed. Install it once (it asks for admin rights), then run this again:
      winget install --id Cloudflare.cloudflared
No winget? Download cloudflared-windows-amd64.msi from https://github.com/cloudflare/cloudflared/releases/latest
'@
}

# ---------- replace a tunnel left from an earlier run ----------
Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" |
  Where-Object { $_.CommandLine -like "*--url $Local*" } |
  ForEach-Object { Say "Stopping the previous tunnel (PID $($_.ProcessId))"; Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Remove-Item $Log -ErrorAction SilentlyContinue

# ---------- start it in its own window (a plain Command Prompt that stays open, so errors stay readable) ----------
Say 'Starting the tunnel in a new window ("Promptly tunnel")'
Start-Process cmd.exe -ArgumentList "/k title Promptly tunnel - close to stop & ""$Cloudflared"" tunnel --no-autoupdate --url $Local --logfile ""$Log"""

# ---------- wait for the public address, then until it answers ----------
$url = $null
for ($i = 0; $i -lt 60 -and -not $url; $i++) {
  Start-Sleep -Seconds 1
  if (Test-Path $Log) {
    $hit = Select-String -Path $Log -Pattern 'https://(?!api\.)[a-z0-9-]+\.trycloudflare\.com' | Select-Object -First 1
    if ($hit) { $url = $hit.Matches[0].Value }
  }
}
if (-not $url) { Stop-Tunnel "cloudflared gave no address within 60 s. Look at the tunnel window, or the log: $Log" }

Say "Tunnel address: $url (waiting until it answers)"
$ok = $false
for ($i = 0; $i -lt 45 -and -not $ok; $i++) {
  try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 5 -Uri "$url/api/health" | Out-Null; $ok = $true } catch { Start-Sleep -Seconds 2 }
}
if (-not $ok) { Write-Host "!!  $url does not answer yet. New addresses can take a minute: try it in the browser shortly." -ForegroundColor Yellow }

try { Set-Clipboard -Value $url } catch { }
if (-not $NoBrowser) { Start-Process "$url/kiosk" }

Write-Host ''
Write-Host "Public address (copied to the clipboard):  $url" -ForegroundColor Green
Write-Host "  Kiosk for phones   $url/kiosk     <- print tickets here: their QR codes open on any phone"
Write-Host "  Book on a phone    $url/book"
Write-Host "  Board              $url/board"
Write-Host ''
Write-Host 'Staff screens can stay on http://localhost:5173 (log in again if you open them on the tunnel address).'
Write-Host 'The address changes on every run. To stop the tunnel, close its window.'
