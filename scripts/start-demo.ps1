<#
Start the ACME Project Tracker demo on this computer. LOCAL USE ONLY.

  scripts\start-demo.ps1           start the database, backend and frontend
  scripts\start-demo.ps1 -Reset    the same, after putting the demo data back as seeded

What it does:
  1. starts the Docker container acme-postgres and creates the database acme_demo if it is missing
     (a new database is always seeded)
  2. with -Reset, runs scripts\seed_demo.py --reset
  3. opens two windows: the backend (scripts\dev_server.py, port 3001) and the frontend (npm run dev, port 3000)
  4. opens http://localhost:3000 and prints the demo e-mail addresses

Passwords are never printed: they are in .env.local under DEMO_ADMIN_PASSWORD,
DEMO_MANAGER_PASSWORD and DEMO_EMPLOYEE_PASSWORD.
#>
param([switch]$Reset)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$python = Join-Path $repo '.venv\Scripts\python.exe'
if (-not (Test-Path $python)) { throw "No virtual environment at $python. Create it first (see README)." }

Write-Host 'Starting the database (acme-postgres)...'
docker start acme-postgres | Out-Null
for ($i = 0; $i -lt 30; $i++) {
    docker exec acme-postgres pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 1
}

$exists = docker exec acme-postgres psql -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'acme_demo';"
if ("$exists".Trim() -ne '1') {
    Write-Host 'Creating the database acme_demo...'
    docker exec acme-postgres psql -U postgres -c 'CREATE DATABASE acme_demo;' | Out-Null
    $Reset = $true # a new database needs the demo data
}

$env:POSTGRES_NAME = 'acme_demo'
if ($Reset) {
    Write-Host 'Seeding the demo data...'
    & $python (Join-Path $repo 'scripts\seed_demo.py') --reset | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Seeding the demo data failed.' }
}

Write-Host 'Starting the backend (port 3001) and the frontend (port 3000) in their own windows...'
$backend = "`$env:POSTGRES_NAME = 'acme_demo'; Set-Location '$repo'; & '$python' scripts\dev_server.py"
Start-Process powershell -ArgumentList '-NoExit', '-Command', $backend
Start-Process powershell -ArgumentList '-NoExit', '-Command', "Set-Location '$repo\frontend'; npm run dev"

for ($i = 0; $i -lt 60; $i++) {
    try {
        Invoke-WebRequest 'http://localhost:3000' -UseBasicParsing -TimeoutSec 2 | Out-Null
        break
    } catch { Start-Sleep -Seconds 1 }
}
Start-Process 'http://localhost:3000'

Write-Host ''
Write-Host 'Demo accounts (passwords: .env.local, DEMO_*_PASSWORD):'
Write-Host '  admin     admin@acme-demo.test'
Write-Host '  manager   marta@acme-demo.test (Platform), ken@acme-demo.test (Data)'
Write-Host '  employee  ana@acme-demo.test, bo@acme-demo.test, hal@acme-demo.test (no team, no work)'
Write-Host '            also cy, di, eli, fay, gus @acme-demo.test'
Write-Host 'Close the two new windows to stop the demo.'
