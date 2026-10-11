<#
.SYNOPSIS
  Start the Promptly demo on this machine with one command.

.DESCRIPTION
  Checks Docker and the database container (promptly-db), stops servers left over on ports 4000 and 5173,
  starts the API and the web app in their own windows, waits until both answer, and opens
  http://localhost:5173/ in the browser. Running it again restarts both servers.
  Phones: run .\scripts\start-tunnel.ps1 afterwards. Staff PINs and the demo script are in DEMO.md.

.EXAMPLE
  .\scripts\start-demo.ps1
.EXAMPLE
  .\scripts\start-demo.ps1 -NoBrowser
#>
param([switch]$NoBrowser)

$Root = Split-Path $PSScriptRoot -Parent
$Backend = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$Db = 'promptly-db'
$WebUrl = 'http://localhost:5173/'
$ApiUrl = 'http://localhost:4000/api/health'

function Say([string]$text) { Write-Host "==> $text" -ForegroundColor Cyan }
function Warn([string]$text) { Write-Host "!!  $text" -ForegroundColor Yellow }
function Stop-Demo([string]$text) { Write-Host ''; Write-Host "XX  $text" -ForegroundColor Red; exit 1 }

# ---------- Node.js ----------
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  $nodeDir = 'C:\Program Files\nodejs'
  if (Test-Path (Join-Path $nodeDir 'node.exe')) { $env:Path = "$nodeDir;$env:Path" }
  else { Stop-Demo 'Node.js is not installed. Install Node 22 from https://nodejs.org and run this again.' }
}

# ---------- Database: Docker running, promptly-db up, tables present ----------
Say "Checking Docker and the database container ($Db)"
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Stop-Demo 'Docker is not installed. Install Docker Desktop, start it, and run this again.' }
& docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { Stop-Demo 'Docker is not running. Start Docker Desktop, wait until it shows "Engine running", then run this again.' }

$running = & docker inspect -f '{{.State.Running}}' $Db 2>$null
if ($LASTEXITCODE -ne 0) {
  Say "Creating the database container $Db (first run only)"
  & docker run -d --name $Db -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=promptly -p 5432:5432 postgres:16 | Out-Null
  if ($LASTEXITCODE -ne 0) { Stop-Demo "Could not create $Db. Is something else using port 5432?" }
} elseif ("$running".Trim() -ne 'true') {
  Say "Starting the database container $Db"
  & docker start $Db | Out-Null
}

$ready = $false
for ($i = 0; $i -lt 30; $i++) {
  & docker exec $Db pg_isready -U postgres -d promptly 2>&1 | Out-Null
  if ($LASTEXITCODE -eq 0) { $ready = $true; break }
  Start-Sleep -Seconds 1
}
if (-not $ready) { Stop-Demo "The database did not get ready within 30 s. See: docker logs $Db" }

$sql = "select count(*) from information_schema.tables where table_schema = 'public' and table_name in ('Token', 'Staff', 'Appointment')"
$tables = & docker exec $Db psql -U postgres -d promptly -tAc $sql 2>$null
if ("$tables".Trim() -ne '3') {
  Stop-Demo @'
The database tables are missing or out of date. Run these once, then start the demo again:
      cd backend
      npm run db:push
      npm run db:seed      (first time only: it prints new staff PINs, put them in DEMO.md)
'@
}

# ---------- Packages and backend/.env ----------
foreach ($dir in @($Backend, $Frontend)) {
  if (-not (Test-Path (Join-Path $dir 'node_modules'))) {
    Say "Installing packages in $(Split-Path $dir -Leaf) (first run only)"
    Push-Location $dir
    & npm install
    $code = $LASTEXITCODE
    Pop-Location
    if ($code -ne 0) { Stop-Demo "npm install failed in $dir" }
  }
}

$envFile = Join-Path $Backend '.env'
if (-not (Test-Path $envFile)) {
  Copy-Item (Join-Path $Backend '.env.example') $envFile
  Say 'Created backend/.env from backend/.env.example'
}
if (-not (Select-String -Path $envFile -Pattern '^VAPID_PUBLIC_KEY=.+' -Quiet)) {
  Say 'No Web Push keys in backend/.env: generating a pair (npm run push:keys)'
  Push-Location $Backend
  $keys = & node scripts/vapid-keys.mjs
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -eq 0) {
    $lines = @('', '# Web Push for the localhost demo (npm run push:keys). Keep the private key out of git.')
    $lines += $keys | Where-Object { $_ -match '^VAPID_(PUBLIC|PRIVATE)_KEY=' }
    $lines += 'VAPID_SUBJECT=mailto:promptly-demo@example.com'
    Add-Content -Path $envFile -Value $lines -Encoding ASCII
  } else {
    Warn 'Could not generate push keys. Push stays off; the in-page banner, sound and vibration still work.'
  }
}

# ---------- Stop servers left over from an earlier run ----------
# Only Node servers on our two ports: the server and the Node processes above it (npm, tsx watch or vite).
function Stop-PortOwner([int]$port) {
  $owners = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue |
    Select-Object -ExpandProperty OwningProcess -Unique
  foreach ($procId in $owners) {
    $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$procId"
    if (-not $proc) { continue }
    if ($proc.Name -ne 'node.exe') { Stop-Demo "Port $port is used by $($proc.Name) (PID $procId). Close that program and run this again." }
    Say "Port $port is taken by an earlier server (PID $procId): restarting it"
    $chain = @($proc)
    $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($proc.ParentProcessId)"
    while ($parent -and $parent.Name -eq 'node.exe') {
      $chain += $parent
      $parent = Get-CimInstance Win32_Process -Filter "ProcessId=$($parent.ParentProcessId)"
    }
    $chain | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  }
}
Stop-PortOwner 4000
Stop-PortOwner 5173
Start-Sleep -Seconds 1

# ---------- Start the API and the web app, each in its own window ----------
# A plain Command Prompt window that stays open (/k), so an error stays readable.
function Start-Window([string]$title, [string]$dir, [string]$command) {
  Start-Process cmd.exe -WorkingDirectory $dir -ArgumentList "/k title $title & $command"
}
Say 'Starting the API in a new window (http://localhost:4000)'
Start-Window 'Promptly API - port 4000' $Backend 'npm run dev'
Say 'Starting the web app in a new window (http://localhost:5173)'
Start-Window 'Promptly web - port 5173' $Frontend 'npm run dev'

function Wait-Http([string]$url, [string]$name, [int]$seconds) {
  for ($i = 0; $i -lt $seconds; $i++) {
    try { Invoke-WebRequest -UseBasicParsing -TimeoutSec 2 -Uri $url | Out-Null; return } catch { Start-Sleep -Seconds 1 }
  }
  Stop-Demo "$name did not answer at $url within $seconds s. Look at its window for the error."
}
Wait-Http $ApiUrl 'The API' 90
Wait-Http $WebUrl 'The web app' 90

try { $pushKey = (Invoke-RestMethod -Uri 'http://localhost:4000/api/push/key' -TimeoutSec 5).publicKey } catch { $pushKey = $null }
if ($pushKey) { Say 'Web Push is on (VAPID keys in backend/.env)' }
else { Warn 'Web Push is off. The in-page banner, sound and vibration still work.' }

if (-not $NoBrowser) { Start-Process $WebUrl }

Write-Host ''
Write-Host 'Promptly is running:' -ForegroundColor Green
Write-Host '  Landing  http://localhost:5173/'
Write-Host '  Kiosk    http://localhost:5173/kiosk'
Write-Host '  Book     http://localhost:5173/book'
Write-Host '  Counter  http://localhost:5173/counter   (staff login)'
Write-Host '  Board    http://localhost:5173/board'
Write-Host '  Ops      http://localhost:5173/ops       (supervisor login)'
Write-Host '  Lab      http://localhost:5173/lab'
Write-Host '  API      http://localhost:4000/api/health'
Write-Host ''
Write-Host 'Phones: run .\scripts\start-tunnel.ps1 and print tickets from the kiosk at the address it gives.'
Write-Host 'Staff PINs and the demo script: DEMO.md. Before presenting: Ops > Reset demo.'
Write-Host 'To stop: close the two server windows.'
