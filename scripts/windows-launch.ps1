$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot ".runtime"
$nodeVersion = "22.23.2"
$nodeArchiveName = "node-v$nodeVersion-win-x64.zip"
$nodeFolderName = "node-v$nodeVersion-win-x64"
$nodeDirectory = Join-Path $runtimeRoot $nodeFolderName
$nodeExecutable = Join-Path $nodeDirectory "node.exe"
$npmExecutable = Join-Path $nodeDirectory "npm.cmd"
$archivePath = Join-Path $runtimeRoot $nodeArchiveName
$releaseUrl = "https://nodejs.org/dist/v$nodeVersion"

function Invoke-CheckedCommand {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [Parameter(ValueFromRemainingArguments = $true)][string[]]$CommandArguments
  )

  & $FilePath @CommandArguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed with exit code $LASTEXITCODE`: $FilePath $CommandArguments"
  }
}

Set-Location $projectRoot
New-Item -ItemType Directory -Force $runtimeRoot | Out-Null

if (-not (Test-Path $nodeExecutable)) {
  Write-Host "Downloading the private Node.js runtime for WatchTogether..." -ForegroundColor Cyan
  Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/$nodeArchiveName" -OutFile $archivePath

  $checksumText = (Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/SHASUMS256.txt").Content
  $checksumPattern = "^[a-fA-F0-9]{64}\s+" + [Regex]::Escape($nodeArchiveName) + "$"
  $checksumLine = ($checksumText -split "`n" | ForEach-Object { $_.Trim() } | Where-Object { $_ -match $checksumPattern } | Select-Object -First 1)
  if (-not $checksumLine) {
    throw "The official Node.js checksum was not found."
  }

  $expectedHash = ($checksumLine -split "\s+")[0].ToUpperInvariant()
  $actualHash = (Get-FileHash -Algorithm SHA256 $archivePath).Hash.ToUpperInvariant()
  if ($actualHash -ne $expectedHash) {
    Remove-Item -Force $archivePath
    throw "The Node.js archive checksum is invalid. The downloaded file was removed."
  }

  Write-Host "Extracting Node.js..." -ForegroundColor Cyan
  Expand-Archive -Path $archivePath -DestinationPath $runtimeRoot -Force
  Remove-Item -Force $archivePath
}

$env:Path = "$nodeDirectory;$env:Path"
Write-Host "Using Node.js $(& $nodeExecutable --version)" -ForegroundColor Green

$environmentPath = Join-Path $projectRoot ".env"
if (-not (Test-Path $environmentPath)) {
  Copy-Item (Join-Path $projectRoot ".env.example") $environmentPath
  Write-Host "Created .env from .env.example. You can set WATCHTOGETHER_MEDIA_DIR later." -ForegroundColor Yellow
}

$packageLockPath = Join-Path $projectRoot "package-lock.json"
$packageLockHash = (Get-FileHash -Algorithm SHA256 $packageLockPath).Hash
$dependencyStampPath = Join-Path $runtimeRoot "dependencies.sha256"
$installedDependencyHash = if (Test-Path $dependencyStampPath) { (Get-Content $dependencyStampPath -Raw).Trim() } else { "" }
$nodeModulesPath = Join-Path $projectRoot "node_modules"
$dependenciesChanged = (-not (Test-Path $nodeModulesPath)) -or ($installedDependencyHash -ne $packageLockHash)

if ($dependenciesChanged) {
  Write-Host "Installing project dependencies..." -ForegroundColor Cyan
  Invoke-CheckedCommand $npmExecutable "ci"
  Set-Content -Path $dependencyStampPath -Value $packageLockHash -Encoding ASCII
}

$revision = "working-copy"
try {
  $git = Get-Command git.exe -ErrorAction Stop
  $revisionOutput = & $git.Source -C $projectRoot rev-parse HEAD 2>$null
  if ($LASTEXITCODE -eq 0 -and $revisionOutput) {
    $revision = $revisionOutput.Trim()
  }
} catch {
  $revision = (Get-Item (Join-Path $projectRoot "package.json")).LastWriteTimeUtc.Ticks.ToString()
}

$buildStamp = "$revision`:$packageLockHash"
$buildStampPath = Join-Path $runtimeRoot "build.txt"
$installedBuildStamp = if (Test-Path $buildStampPath) { (Get-Content $buildStampPath -Raw).Trim() } else { "" }
$buildIdPath = Join-Path $projectRoot ".next\BUILD_ID"

if ($dependenciesChanged -or -not (Test-Path $buildIdPath) -or $installedBuildStamp -ne $buildStamp) {
  Write-Host "Building WatchTogether..." -ForegroundColor Cyan
  Invoke-CheckedCommand $npmExecutable "run" "build"
  Set-Content -Path $buildStampPath -Value $buildStamp -Encoding ASCII
}

$port = 47821
$portSetting = Select-String -Path $environmentPath -Pattern "^WATCHTOGETHER_PORT=(\d+)$" | Select-Object -First 1
if ($portSetting -and $portSetting.Matches.Count -gt 0) {
  $port = [int]$portSetting.Matches[0].Groups[1].Value
}

Write-Host "Starting WatchTogether at http://localhost:$port" -ForegroundColor Green
$openBrowserCommand = "Start-Sleep -Seconds 3; Start-Process 'http://localhost:$port'"
Start-Process powershell.exe -WindowStyle Hidden -ArgumentList "-NoProfile", "-Command", $openBrowserCommand
Invoke-CheckedCommand $npmExecutable "start"
