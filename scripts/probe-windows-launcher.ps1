param([Parameter(Mandatory = $true)][string]$NodePath)

$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'launch-windows.ps1')
function Assert-Check($Condition, [string]$Message) {
  if (-not $Condition) { throw $Message }
}

Assert-Check (Test-BudgetNode $NodePath) 'The running supported Node must be detected.'
Assert-Check (-not (Test-BudgetNode 'missing-node.exe')) 'Missing Node must be rejected.'
$originalData = $env:LOCALAPPDATA
$originalTls = $env:NODE_TLS_REJECT_UNAUTHORIZED
$originalArchitecture = $env:PROCESSOR_ARCHITECTURE
$originalWow = $env:PROCESSOR_ARCHITEW6432
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('budget-windows-launcher-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $testRoot | Out-Null
try {
  $env:LOCALAPPDATA = $testRoot
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
  $env:NODE_TLS_REJECT_UNAUTHORIZED = $originalTls
  $env:PROCESSOR_ARCHITECTURE = $originalArchitecture
  $env:PROCESSOR_ARCHITEW6432 = $originalWow
  $safeTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
  if (-not [IO.Path]::GetFullPath($testRoot).StartsWith($safeTemp, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe probe cleanup path.' }
  Remove-Item -LiteralPath $testRoot -Recurse -Force
}
