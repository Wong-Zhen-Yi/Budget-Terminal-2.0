param([Parameter(Mandatory = $true)][string]$NodePath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launch-windows.ps1')
function Assert-Check($Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

& {
  $script:detachedLaunch = $null
  function Start-Process {
    param($FilePath, $ArgumentList, $WindowStyle, $WorkingDirectory, $RedirectStandardOutput, $RedirectStandardError)
    $script:detachedLaunch = $PSBoundParameters
  }
  Start-BudgetTerminal
  Assert-Check ($script:detachedLaunch.WindowStyle -eq 'Hidden') 'Desktop startup must create an independent hidden process.'
  Assert-Check ($script:detachedLaunch.ArgumentList -contains '-Attached') 'The worker must not recursively detach.'
  Assert-Check ($script:detachedLaunch.ArgumentList -contains ('"' + (Join-Path $PSScriptRoot 'launch-windows.ps1') + '"')) 'Quote the worker path for checkouts containing spaces.'
  Assert-Check ($script:detachedLaunch.RedirectStandardOutput -ne $script:detachedLaunch.RedirectStandardError) 'Retain separate startup output and errors.'
  Assert-Check (-not $script:detachedLaunch.ContainsKey('Wait')) 'The calling terminal must return immediately.'
}
Write-Host 'PASS: desktop launch detaches with a hidden worker and startup logs.'

& {
  $Command = 'restart'
  $script:detachedLaunch = $null
  function Start-Process {
    param($FilePath, $ArgumentList, $WindowStyle, $WorkingDirectory, $RedirectStandardOutput, $RedirectStandardError)
    $script:detachedLaunch = $PSBoundParameters
  }
  Start-BudgetTerminal
  Assert-Check ($script:detachedLaunch.ArgumentList -contains 'restart') 'Forward restart into the detached worker.'
  Assert-Check ($script:detachedLaunch.WindowStyle -eq 'Hidden') 'Restart must use a hidden worker.'
}
& {
  $expectedPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\node_modules\electron\dist\electron.exe'))
  $script:closed = 0
  $script:waited = 0
  $script:shutdownCompletes = $true
  $script:running = @(
    @{ ProcessId = 101; ExecutablePath = $expectedPath; CommandLine = 'electron.exe .' },
    @{ ProcessId = 102; ExecutablePath = $expectedPath; CommandLine = 'electron.exe --type=renderer' },
    @{ ProcessId = 103; ExecutablePath = 'C:\unrelated\electron.exe'; CommandLine = 'electron.exe .' }
  )
  function Get-CimInstance { $script:running }
  function Get-Process {
    param($Id, $ErrorAction)
    Assert-Check ($Id -eq 101) 'Never close renderer processes or another checkout.'
    $fixture = [pscustomobject]@{ HasExited = $false; MainWindowTitle = 'Budget Terminal' }
    $fixture | Add-Member ScriptMethod CloseMainWindow { $script:closed++; return $true }
    $fixture | Add-Member ScriptMethod WaitForExit { param($Milliseconds); $script:waited++; Assert-Check ($Milliseconds -eq 30000) 'Bound graceful shutdown.'; return $script:shutdownCompletes }
    return $fixture
  }
  Stop-BudgetTerminal
  Assert-Check ($script:closed -eq 1 -and $script:waited -eq 1) 'Request window close and await save completion.'
  $script:shutdownCompletes = $false
  $failure = ''
  try { Stop-BudgetTerminal } catch { $failure = $_.Exception.Message }
  Assert-Check ($failure -like '*without forcing*') 'Timeout must stop restart without killing the app.'
  $script:running = @()
  Stop-BudgetTerminal
  Assert-Check ($script:closed -eq 2) 'Restart with no running app proceeds without closing anything.'
}
Write-Host 'PASS: restart forwarding, exact executable isolation, clean shutdown wait, timeout and closed-app handling.'

Assert-Check (Test-BudgetNode $NodePath) 'The running supported Node must be detected.'
Assert-Check (-not (Test-BudgetNode 'missing-node.exe')) 'Missing Node must be rejected.'
$originalData = $env:LOCALAPPDATA
$originalPath = $env:Path
$originalTls = $env:NODE_TLS_REJECT_UNAUTHORIZED
$originalArchitecture = $env:PROCESSOR_ARCHITECTURE
$originalWow = $env:PROCESSOR_ARCHITEW6432
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('budget-windows-launcher-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  $env:LOCALAPPDATA = $testRoot
  & {
    . (Join-Path $PSScriptRoot 'install-bt.ps1')
    $script:fixtureUserPath = 'C:\fixture-bin'
    $script:pathWrites = 0
    function Get-BudgetUserPath { $script:fixtureUserPath }
    function Set-BudgetUserPath([string]$Value) { $script:fixtureUserPath = $Value; $script:pathWrites++ }
    function Publish-PathChange {}
    $bin = Join-Path $testRoot 'BudgetTerminal\bin'
    New-Item -ItemType Directory -Path $bin -Force | Out-Null
    $legacyShim = Join-Path $bin 'BT.cmd'
    $desktopShim = Join-Path $bin 'BTD.cmd'
    $launcher = Join-Path $PSScriptRoot 'launch-windows.ps1'
    Set-Content -LiteralPath $legacyShim -Value "@echo off`r`npowershell.exe -File `"$launcher`" -Tui %*"
    Install-BudgetDesktopCommand
    Assert-Check (-not (Test-Path -LiteralPath $legacyShim)) 'Remove the retired command for this checkout.'
    $content = [IO.File]::ReadAllText($desktopShim)
    Assert-Check ($content.Contains('"' + $launcher + '" %*')) 'The desktop command quotes the checkout and forwards options.'
    Assert-Check (-not $content.Contains('-Tui')) 'The installed command must open the desktop app.'
    Assert-Check ($script:fixtureUserPath -eq ($bin + ';C:\fixture-bin')) 'Install the command directory on the fixture PATH.'
    Install-BudgetDesktopCommand
    Assert-Check ($script:pathWrites -eq 1) 'Repeated installation must not rewrite PATH.'
    Set-Content -LiteralPath $legacyShim -Value 'unrelated command fixture'
    Install-BudgetDesktopCommand
    Assert-Check ((Get-Content -LiteralPath $legacyShim) -eq 'unrelated command fixture') 'Preserve unrelated commands.'
    $Uninstall = $true
    Install-BudgetDesktopCommand
    Assert-Check (-not (Test-Path -LiteralPath $desktopShim)) 'Uninstall removes the desktop command.'
    Assert-Check ($script:fixtureUserPath.Contains($bin)) 'Preserve PATH while another command remains.'
    Remove-Item -LiteralPath $legacyShim
    Install-BudgetDesktopCommand
    Assert-Check ($script:fixtureUserPath -eq 'C:\fixture-bin') 'Uninstall removes the unused command directory from PATH.'
  }
  Write-Host 'PASS: desktop command installs idempotently, removes its retired command, preserves unrelated commands and uninstalls safely.'
  $env:PROCESSOR_ARCHITECTURE = 'AMD64'
  $env:PROCESSOR_ARCHITEW6432 = ''
  $env:NODE_TLS_REJECT_UNAUTHORIZED = '0'
  $failure = ''
  try { Get-BudgetNode | Out-Null } catch { $failure = $_.Exception.Message }
  Assert-Check ($failure -like '*verification is disabled*') 'Reject disabled TLS before discovery or download.'
  $env:NODE_TLS_REJECT_UNAUTHORIZED = ''

  # Reproduce an old Node first on PATH, followed by a supported installation.
  function Get-Command { @(@{ Source = (Join-Path $testRoot 'missing-node.exe') }, @{ Source = $NodePath }) }
  Assert-Check ((Get-BudgetNode) -eq $NodePath) 'Find a supported Node after the broken/old first PATH entry.'

  function Test-BudgetNode([string]$Candidate) {
    return $Candidate -eq $NodePath -or ($Candidate -like "$testRoot*" -and (Test-Path -LiteralPath $Candidate -PathType Leaf))
  }
  # Embedded runtimes without npm must not fall through to an older npm.cmd.
  $bareDirectory = Join-Path $testRoot 'bare'
  New-Item -ItemType Directory -Path $bareDirectory | Out-Null
  $bareNode = Join-Path $bareDirectory 'node.exe'
  Set-Content -LiteralPath $bareNode -Value 'fixture'
  function Get-Command { @(@{ Source = $bareNode }, @{ Source = $NodePath }) }
  Assert-Check ((Get-BudgetNode) -eq $NodePath) 'Skip bare Node installations without a matching npm wrapper.'

  # No installed Node: exercise offline download, checksum, staging and reuse paths.
  function Get-Command { @() }
  $script:downloadCount = 0
  $script:checksumMatches = $false
  function Invoke-WebRequest($Uri, $OutFile, [switch]$UseBasicParsing) {
    Assert-Check ($Uri -eq 'https://nodejs.org/dist/v24.22.1/node-v24.22.1-win-x64.zip') 'Download only the pinned official HTTPS release.'
    $script:downloadCount++
    Set-Content -LiteralPath $OutFile -Value 'fixture'
  }
  function Get-FileHash($LiteralPath, $Algorithm) {
    Assert-Check ($Algorithm -eq 'SHA256') 'Verify SHA-256 before extracting.'
    return @{ Hash = $(if ($script:checksumMatches) { $nodeHashes.x64 } else { 'bad-checksum' }) }
  }
  function Expand-Archive($LiteralPath, $DestinationPath) {
    Assert-Check $script:checksumMatches 'Never extract a failed checksum.'
    $folder = Join-Path $DestinationPath 'node-v24.22.1-win-x64'
    New-Item -ItemType Directory -Path (Join-Path $folder 'node_modules\npm\bin') -Force | Out-Null
    Set-Content -LiteralPath (Join-Path $folder 'node.exe') -Value 'fixture'
    Set-Content -LiteralPath (Join-Path $folder 'npm.cmd') -Value 'fixture'
    Set-Content -LiteralPath (Join-Path $folder 'node_modules\npm\bin\npm-cli.js') -Value 'fixture'
  }
  $failure = ''
  try { Get-BudgetNode | Out-Null } catch { $failure = $_.Exception.Message }
  Assert-Check ($failure -like '*checksum did not match*') 'Reject a corrupt download.'
  Assert-Check (@(Get-ChildItem -LiteralPath (Join-Path $testRoot 'BudgetTerminal\runtimes')).Count -eq 0) 'Clean up rejected downloads.'
  $script:checksumMatches = $true
  $installed = Get-BudgetNode
  Assert-Check (Test-Path -LiteralPath $installed) 'Install the verified runtime outside the checkout.'
  Assert-Check ((Get-BudgetNode) -eq $installed) 'Reuse the managed runtime on the next launch.'
  Assert-Check ($script:downloadCount -eq 2) 'Reuse must not download again.'
  Write-Host 'PASS: Windows launcher finds later PATH runtimes, blocks TLS bypasses, verifies downloads, cleans failures and reuses its private runtime.'
} finally {
  $env:LOCALAPPDATA = $originalData
  $env:Path = $originalPath
  $env:NODE_TLS_REJECT_UNAUTHORIZED = $originalTls
  $env:PROCESSOR_ARCHITECTURE = $originalArchitecture
  $env:PROCESSOR_ARCHITEW6432 = $originalWow
  $safeTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not [IO.Path]::GetFullPath($testRoot).StartsWith($safeTemp, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe probe cleanup path.' }
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}
