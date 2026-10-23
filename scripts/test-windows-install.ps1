#requires -Version 7.0
[CmdletBinding()]
param(
  [string]$Installer,
  [string]$ReportPath
)

$ErrorActionPreference = 'Stop'
if (-not $IsWindows) { throw 'Run this acceptance test on a clean Windows 10/11 x64 machine or Windows CI runner.' }

$repo = Split-Path $PSScriptRoot -Parent
$version = (Get-Content (Join-Path $repo 'package.json') -Raw | ConvertFrom-Json).version
if (-not $Installer) { $Installer = Join-Path $repo "releases/v$version/Game-UI-Studio-Setup-$version-x64.exe" }
if (-not $ReportPath) { $ReportPath = Join-Path $repo 'artifacts/windows-installer-native.json' }
$Installer = (Resolve-Path $Installer).Path
$ReportPath = [IO.Path]::GetFullPath($ReportPath)

$homeDir = Join-Path $env:LOCALAPPDATA 'GameUIStudio'
$defaultInstall = Join-Path $env:LOCALAPPDATA 'Programs/Game UI Studio'
$desktopShortcut = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Game UI Studio.lnk'
$menuDir = Join-Path ([Environment]::GetFolderPath('Programs')) 'Game UI Studio'
$uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\GameUIStudio'
$settingsKey = 'HKCU:\Software\GameUIStudio'

# Installation writes the current user's shortcuts and uninstall entry. Never run
# this destructive lifecycle test over an existing user's application or project.
foreach ($location in @($homeDir, $defaultInstall, $desktopShortcut, $menuDir, $uninstallKey, $settingsKey)) {
  if (Test-Path -LiteralPath $location) { throw "Refusing to test over an existing installation or user data: $location" }
}
foreach ($name in @('STUDIO_DESKTOP_HOME', 'STUDIO_DATA_DIR')) {
  if ([Environment]::GetEnvironmentVariable($name)) { throw "Unset $name before running the clean-user acceptance test." }
}

$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('Game UI Studio acceptance 用户 ' + [guid]::NewGuid().ToString('N'))
$installDir = Join-Path $testRoot 'Installed App 应用'
$nodeExe = Join-Path $installDir 'node.exe'
$launcher = Join-Path $installDir 'app/scripts/desktop-launcher.mjs'
$stateFile = Join-Path $homeDir 'runtime/state.json'
$projectFile = Join-Path $homeDir 'data/project.json'
$checks = [Collections.Generic.List[object]]::new()
$ownedProcesses = [Collections.Generic.List[object]]::new()
$logDir = Join-Path (Split-Path $ReportPath -Parent) 'windows-installer-logs'
New-Item -ItemType Directory -Path $testRoot, $logDir -Force | Out-Null
$report = [ordered]@{
  schemaVersion = 1
  platform = 'Windows native'
  os = [Environment]::OSVersion.VersionString
  powershell = $PSVersionTable.PSVersion.ToString()
  startedAt = [DateTime]::UtcNow.ToString('o')
  installer = [IO.Path]::GetFileName($Installer)
  installerSha256 = (Get-FileHash -LiteralPath $Installer -Algorithm SHA256).Hash.ToLowerInvariant()
  status = 'running'
  checks = $checks
}

function Assert-True([bool]$condition, [string]$message) {
  if (-not $condition) { throw $message }
}

function Wait-Until([scriptblock]$operation, [string]$description, [int]$seconds = 30) {
  $deadline = [DateTime]::UtcNow.AddSeconds($seconds)
  $lastError = $null
  do {
    try { $value = & $operation; if ($value) { return $value } }
    catch { $lastError = $_.Exception.Message }
    Start-Sleep -Milliseconds 150
  } while ([DateTime]::UtcNow -lt $deadline)
  throw "Timed out waiting for $description. $lastError"
}

function Invoke-CheckedProcess([string]$file, [string]$arguments, [int]$seconds = 60) {
  $process = Start-Process -FilePath $file -ArgumentList $arguments -PassThru
  if (-not $process.WaitForExit($seconds * 1000)) {
    $process.Kill()
    throw "Process timed out: $file"
  }
  if ($process.ExitCode -ne 0) { throw "Process failed ($($process.ExitCode)): $file" }
}

function Read-ReadyState {
  $state = Wait-Until {
    if (Test-Path -LiteralPath $stateFile) {
      $candidate = Get-Content -LiteralPath $stateFile -Raw | ConvertFrom-Json
      if ($candidate.phase -eq 'ready') { return $candidate }
    }
  } 'launcher ready state'
  Assert-True ($state.url -match '^http://127\.0\.0\.1:\d+/?$') 'Launcher must listen only on loopback.'
  $health = Invoke-RestMethod -Uri ($state.url.TrimEnd('/') + '/api/health') -TimeoutSec 5
  Assert-True ($health.ok -and $health.app -eq 'Game UI Studio') 'Installed service health check failed.'
  return $state
}

function Start-Studio([string]$name) {
  $vbs = Join-Path $installDir 'launch.vbs'
  $wrapper = Start-Process -FilePath (Join-Path $env:WINDIR 'System32/wscript.exe') `
    -ArgumentList ('//B //Nologo "' + $vbs + '" --no-open') -PassThru `
    -RedirectStandardOutput (Join-Path $logDir "$name.stdout.txt") `
    -RedirectStandardError (Join-Path $logDir "$name.stderr.txt")
  $ownedProcesses.Add($wrapper)
  $state = Read-ReadyState
  $process = Get-Process -Id $state.pid
  Assert-True ($process.Path -eq $nodeExe) 'The shortcut launcher did not start the bundled runtime.'
  $ownedProcesses.Add($process)
  return $state
}

function Stop-Studio {
  Invoke-CheckedProcess $nodeExe ('"' + $launcher + '" --stop') 30
  Wait-Until { -not (Test-Path -LiteralPath $stateFile) } 'state removal after stop' | Out-Null
}

function Check([string]$name, [scriptblock]$operation) {
  try {
    & $operation
    $checks.Add([ordered]@{ name = $name; status = 'passed' })
    Write-Host "PASS $name"
  } catch {
    $checks.Add([ordered]@{ name = $name; status = 'failed'; error = $_.Exception.Message })
    throw
  }
}

try {
  Check 'silent install in a path containing spaces and Unicode' {
    # NSIS requires /D to be last and unquoted, including paths containing spaces.
    Invoke-CheckedProcess $Installer ("/S /D=$installDir") 120
    foreach ($relative in @('node.exe', 'launch.vbs', 'Uninstall.exe', 'app/dist/index.html', 'app/scripts/desktop-launcher.mjs')) {
      Assert-True (Test-Path -LiteralPath (Join-Path $installDir $relative)) "Missing installed file: $relative"
    }
  }
  Check 'current-user shortcuts and uninstall registration' {
    Assert-True (Test-Path -LiteralPath $desktopShortcut) 'Desktop shortcut is missing.'
    Assert-True (Test-Path -LiteralPath $menuDir) 'Start Menu folder is missing.'
    foreach ($name in @('Game UI Studio.lnk', 'Stop Game UI Studio.lnk', 'Project data.lnk', 'Uninstall.lnk')) {
      Assert-True (Test-Path -LiteralPath (Join-Path $menuDir $name)) "Missing Start Menu entry: $name"
    }
    Assert-True (Test-Path -LiteralPath $uninstallKey) 'Per-user uninstall registration is missing.'
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut($desktopShortcut)
    Assert-True ($shortcut.Arguments.Contains($installDir)) 'Shortcut does not point at this installation.'
    Assert-True ($shortcut.TargetPath -match '(?i)wscript\.exe$') 'Shortcut must use the windowless launcher.'
  }
  Check 'bundled runtime serves the editor and saves an actual project change' {
    $script:state = Start-Studio 'first-start'
    $script:baseUrl = $state.url.TrimEnd('/')
    $page = Invoke-WebRequest -Uri $baseUrl -TimeoutSec 10
    Assert-True ($page.StatusCode -eq 200 -and $page.Content -match 'type="module"') 'Built editor page was not served.'
    $project = Invoke-RestMethod -Uri "$baseUrl/api/project" -TimeoutSec 10
    $project.name = 'Windows installer persistence 验证'
    $project.revision++
    $saved = Invoke-RestMethod -Uri "$baseUrl/api/project" -Method Put -ContentType 'application/json; charset=utf-8' `
      -Body ([Text.Encoding]::UTF8.GetBytes(($project | ConvertTo-Json -Depth 100))) -TimeoutSec 10
    Assert-True ($saved.name -eq $project.name) 'Saved project name did not match.'
    $disk = Get-Content -LiteralPath $projectFile -Raw | ConvertFrom-Json
    Assert-True ($disk.name -eq $project.name) 'Project did not persist to LocalAppData.'
  }
  Check 'second launch reuses the running instance' {
    Invoke-CheckedProcess $nodeExe ('"' + $launcher + '" --no-open') 30
    $second = Read-ReadyState
    Assert-True ($second.pid -eq $state.pid -and $second.url -eq $state.url) 'Duplicate launch created a different instance.'
  }
  Check 'stop and restart preserve the project' {
    Stop-Studio
    $script:state = Start-Studio 'restart'
    $loaded = Invoke-RestMethod -Uri ($state.url.TrimEnd('/') + '/api/project') -TimeoutSec 10
    Assert-True ($loaded.name -eq 'Windows installer persistence 验证') 'Restart lost the project change.'
  }
  Check 'reinstall stops the old instance and preserves data' {
    $priorPid = $state.pid
    Invoke-CheckedProcess $Installer ("/S /D=$installDir") 120
    Wait-Until { -not (Test-Path -LiteralPath $stateFile) } 'old service stopping during reinstall' | Out-Null
    $script:state = Start-Studio 'after-reinstall'
    Assert-True ($state.pid -ne $priorPid) 'Reinstall reused the old process.'
    $loaded = Invoke-RestMethod -Uri ($state.url.TrimEnd('/') + '/api/project') -TimeoutSec 10
    Assert-True ($loaded.name -eq 'Windows installer persistence 验证') 'Reinstall lost the saved project.'
  }
  Check 'uninstall removes the application and shortcuts while retaining project data' {
    Invoke-CheckedProcess (Join-Path $installDir 'Uninstall.exe') '/S' 120
    Wait-Until { -not (Test-Path -LiteralPath $nodeExe) } 'application removal' 45 | Out-Null
    Wait-Until { -not (Test-Path -LiteralPath $stateFile) } 'service stopping during uninstall' | Out-Null
    Assert-True (-not (Test-Path -LiteralPath $desktopShortcut)) 'Uninstall left the desktop shortcut.'
    Assert-True (-not (Test-Path -LiteralPath $menuDir)) 'Uninstall left the Start Menu folder.'
    Assert-True (-not (Test-Path -LiteralPath $uninstallKey)) 'Uninstall left its registration.'
    Assert-True (-not (Test-Path -LiteralPath $settingsKey)) 'Uninstall left its installation registry key.'
    $retained = Get-Content -LiteralPath $projectFile -Raw | ConvertFrom-Json
    Assert-True ($retained.name -eq 'Windows installer persistence 验证') 'Uninstall removed or replaced user project data.'
  }
  $report.status = 'passed'
} catch {
  $report.status = 'failed'
  $report.error = $_.Exception.Message
  throw
} finally {
  # Cleanup is confined to this run's installation and initially absent data.
  if ((Test-Path -LiteralPath $nodeExe) -and (Test-Path -LiteralPath $launcher)) {
    try { Invoke-CheckedProcess $nodeExe ('"' + $launcher + '" --stop') 15 } catch { Write-Warning $_ }
  }
  foreach ($process in $ownedProcesses) {
    try { if (-not $process.HasExited) { $process.Kill(); $process.WaitForExit(5000) | Out-Null } } catch { Write-Warning $_ }
  }
  $uninstaller = Join-Path $installDir 'Uninstall.exe'
  if (Test-Path -LiteralPath $uninstaller) {
    try { Invoke-CheckedProcess $uninstaller '/S' 60 } catch { Write-Warning $_ }
  }
  foreach ($location in @($testRoot, $homeDir)) {
    try { if (Test-Path -LiteralPath $location) { Remove-Item -LiteralPath $location -Recurse -Force } } catch { Write-Warning $_ }
  }
  $report.finishedAt = [DateTime]::UtcNow.ToString('o')
  $report | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $ReportPath -Encoding utf8
  Write-Host "Acceptance report: $ReportPath"
}
