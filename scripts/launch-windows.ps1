param([Parameter(Position = 0)][ValidateSet('start', 'restart')][string]$Command = 'start', [switch]$RuntimeOnly, [switch]$Dev, [switch]$Logs, [switch]$Setup, [switch]$Attached)
# Shared snapshot validation, account quotas and typed cloud contracts rebuild through the shared launcher; backend policies deploy separately.
# Auth lifecycle passed live two-device acceptance; the shared launcher rebuilds current source.
# Auth workspace ownership, async credential storage and session controls rebuild through the shared launcher.
# Auth restores saved sign-in and remembers Don't show again; rebuilt through the shared launcher.
# GitHub sign-in requires the exact v2 callback registered in its OAuth App; see docs/convex-sync.md.
# Convex Auth v2 and MCP rebuild through the shared launcher; reconnect cloud sync in Settings after upgrading.
# MCP tools and schemas rebuild from current source on every launch; see docs/local-mcp.md.
# Gold and Oil pages are in the Focus workspace.
# Finnhub prioritizes saved portfolio stocks for pre-market/live feeds and REST refreshes; see docs/finnhub-streaming.md.
# btd restart gracefully closes this checkout before rebuilding and reopening it.
# Telegram: natural screenshot requests use MCP and send photos without captions or follow-up text.
# Trading Volumes defaults to a compact YTD table beside the expanded dot plot.
# Crypto bypasses Finnhub for coins, stock proxies and live updates; shared builds refresh app and MCP.
# Convex snapshot writes are restored; record-era cloud tables are retained as an archive.
# Database sync restored to 3208321: optional Convex snapshots, GitHub sign-in and complete-copy conflict choices.
# Efficiency updates preserve all-page startup readiness; verification is recorded in docs/efficiency-results.md.
# Backup and sync snapshots resolve asynchronous defaults inside function bodies for build compatibility.
# Backup imports recover on failure; Escape cancels edits; public WebSocket resources are supported.
# Shared option chains, single-capture backups, targeted refresh and live status updates: docs/efficiency-results.md.
# Settings > Controller controls includes a live controller diagram and navigation-safe input test.
# Controller page switching follows visible workspace/page order, including custom ordering and hidden pages.
# Compact layouts keep Treasury curves, market controls, probability statistics and heatmap details accessible.
# Personal Finance charts keep readable values while Totals and Goal resize to the screen.
# Obscure hides recurring bill names and amounts; Reveal restores editable names.
# Personal Finance: Steam Deck layout keeps recurring bill names readable and the Goal panel visible.

$ErrorActionPreference = 'Stop'
# Controller support: standard gamepads navigate desktop controls and pages; Settings includes the control reference.
# Charts watchlists now follow user data backup, restore, cloud sync and clear, with automatic profile migration.
# GitHub sync sign-in validates backend configuration before opening the browser.
# Settings supports GitHub browser sign-in and regional Convex deployments; local saves remain independent.
# Optional Convex sync runs behind local stores; no account or cloud connection is required to launch.
# Crypto opens directly with market data; the Workspace header, USD badge and Copy snapshot action are removed.
# Portfolio stocks highlight the full row on hover and while editing or focusing row controls.
# Launchers open the desktop workspace directly, including Portfolio, charts and Agents.
# Current dark navy and blue colour scheme is locked in AGENTS.md; palette changes require an explicit user request.
# Public API routing: Hyperliquid/CoinGecko crypto prices and World Bank/IMF annual context. Finnhub is stock-only when configured.
# MCP: public Polymarket reads registered; all implemented pages support screenshot access.
# AllTick API removed from Settings; Financial Modeling Prep remains inactive and Finnhub is stock-only.
# Polymarket: redesigned market cards, probability charts, depth and activity; public datasets and startup preloading retained.
# YouTube PiP: movable, resizable always-on-top desktop window, including outside Budget Terminal; playback survives pop-out and return.
$runtimeCheck = Join-Path $PSScriptRoot 'runtime.cjs'
$nodeVersion = '24.22.1'
# Official https://nodejs.org/dist/v24.22.1/SHASUMS256.txt
$nodeHashes = @{
  x64 = 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5'
  arm64 = 'a0c807319fede24c4a0d8f84564c82a619bd313b16b10c007c383c2609e99171'
}

function Test-BudgetNode([string]$Candidate) {
  if (-not $Candidate -or -not (Test-Path -LiteralPath $Candidate -PathType Leaf)) { return $false }
  try {
    & $Candidate $runtimeCheck *> $null
    return $LASTEXITCODE -eq 0
  } catch { return $false }
}

function Get-BudgetNode {
  if ($env:NODE_TLS_REJECT_UNAUTHORIZED -eq '0') {
    throw 'Certificate verification is disabled by NODE_TLS_REJECT_UNAUTHORIZED. Remove this setting before starting Budget Terminal.'
  }
  if (-not $env:LOCALAPPDATA) { throw 'LOCALAPPDATA is required to locate the private Node.js runtime.' }
  $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  $nodeArchitecture = switch ($architecture) {
    'AMD64' { 'x64' }
    'ARM64' { 'arm64' }
    default { throw "Unsupported Windows architecture: $architecture. Use 64-bit Windows." }
  }
  $runtimeRoot = Join-Path $env:LOCALAPPDATA 'BudgetTerminal\runtimes'
  $folder = "node-v$nodeVersion-win-$nodeArchitecture"
  $nodeDirectory = Join-Path $runtimeRoot $folder
  $managedNode = Join-Path $nodeDirectory 'node.exe'
  $candidates = @($managedNode)
  $candidates += @(Get-Command node.exe -All -ErrorAction SilentlyContinue | ForEach-Object { $_.Source })
  if ($env:ProgramFiles) { $candidates += Join-Path $env:ProgramFiles 'nodejs\node.exe' }
  foreach ($candidate in ($candidates | Select-Object -Unique)) {
    # A bare embedded node.exe can fall through to another installation's npm.cmd,
    # which explicitly starts its own (possibly unsupported) sibling node.exe.
    $npm = Join-Path (Split-Path -Parent $candidate) 'node_modules\npm\bin\npm-cli.js'
    $npmCommand = Join-Path (Split-Path -Parent $candidate) 'npm.cmd'
    if ((Test-BudgetNode $candidate) -and (Test-Path -LiteralPath $npm) -and
        (Test-Path -LiteralPath $npmCommand)) { return $candidate }
  }

  Write-Host "Installing supported Node.js $nodeVersion for Budget Terminal (no administrator access needed)..."
  New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
  $stage = Join-Path $runtimeRoot ('.install-' + [Guid]::NewGuid().ToString('N'))
  New-Item -ItemType Directory -Path $stage | Out-Null
  try {
    $archive = Join-Path $stage "$folder.zip"
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -UseBasicParsing -Uri "https://nodejs.org/dist/v$nodeVersion/$folder.zip" -OutFile $archive
    if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $nodeHashes[$nodeArchitecture]) {
      throw 'Node.js download checksum did not match the official release. The download will not be executed.'
    }
    Expand-Archive -LiteralPath $archive -DestinationPath $stage
    $extracted = Join-Path $stage $folder
    if (-not (Test-BudgetNode (Join-Path $extracted 'node.exe')) -or
        -not (Test-Path -LiteralPath (Join-Path $extracted 'node_modules\npm\bin\npm-cli.js'))) {
      throw 'The downloaded Node.js runtime is incomplete or unsupported.'
    }
    # Only move/delete our generated staging paths inside the dedicated runtime folder.
    $safeRoot = [IO.Path]::GetFullPath($runtimeRoot) + [IO.Path]::DirectorySeparatorChar
    foreach ($target in @($stage, $extracted, $nodeDirectory)) {
      if (-not [IO.Path]::GetFullPath($target).StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) {
        throw 'Runtime installation path is outside the Budget Terminal runtime folder.'
      }
    }
    if (Test-Path -LiteralPath $nodeDirectory) { Remove-Item -LiteralPath $nodeDirectory -Recurse -Force }
    Move-Item -LiteralPath $extracted -Destination $nodeDirectory
    return $managedNode
  } finally {
    $safeRoot = [IO.Path]::GetFullPath($runtimeRoot) + [IO.Path]::DirectorySeparatorChar
    if ([IO.Path]::GetFullPath($stage).StartsWith($safeRoot, [StringComparison]::OrdinalIgnoreCase)) {
      Remove-Item -LiteralPath $stage -Recurse -Force
    }
  }
}

function Stop-BudgetTerminal {
  $electronPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\node_modules\electron\dist\electron.exe'))
  $running = @(Get-CimInstance Win32_Process -Filter "Name = 'electron.exe'" | Where-Object {
    $_.ExecutablePath -and $_.ExecutablePath -ieq $electronPath -and $_.CommandLine -notmatch '\s--type='
  })
  foreach ($candidate in $running) {
    $process = Get-Process -Id $candidate.ProcessId -ErrorAction SilentlyContinue
    if (-not $process -or $process.HasExited) { continue }
    # Only close the application window, never unrelated Electron tools or test fixtures.
    if ($process.MainWindowTitle -ne 'Budget Terminal') {
      throw 'Budget Terminal is still starting or has no application window. Wait for it to open, then run btd restart again.'
    }
    Write-Host 'Closing Budget Terminal and saving pending data...'
    if (-not $process.CloseMainWindow()) { throw 'Could not request a clean shutdown. Close Budget Terminal, then run btd restart again.' }
    if (-not $process.WaitForExit(30000)) {
      throw 'Budget Terminal did not finish saving within 30 seconds. Restart stopped without forcing it closed. Check the app before trying again.'
    }
    Write-Host 'Budget Terminal closed. Preparing the latest desktop build...'
  }
}

function Start-BudgetTerminal {
  # Incremental charts, indexed live updates and cache checkpoints: docs/performance.md.
  # Settings uses compact horizontal categories without the redundant Preferences label, overview or introductory header.
  try {
    if ($Command -eq 'restart' -and ($RuntimeOnly -or $Setup)) { throw 'Restart cannot be combined with setup or runtime-only options.' }
    if (-not ($Attached -or $RuntimeOnly -or $Dev -or $Setup)) {
      $logDirectory = Join-Path $env:LOCALAPPDATA 'BudgetTerminal\launcher-logs'
      New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
      $session = [Guid]::NewGuid().ToString('N')
      $arguments = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + (Join-Path $PSScriptRoot 'launch-windows.ps1') + '"'), '-Attached')
      if ($Command -eq 'restart') { $arguments += '-Command'; $arguments += 'restart' }
      if ($Logs) { $arguments += '-Logs' }
      Start-Process -FilePath (Join-Path $PSHOME 'powershell.exe') -ArgumentList $arguments -WindowStyle Hidden -WorkingDirectory (Split-Path -Parent $PSScriptRoot) -RedirectStandardOutput (Join-Path $logDirectory "$session.log") -RedirectStandardError (Join-Path $logDirectory "$session.error.log") | Out-Null
      $action = if ($Command -eq 'restart') { 'restarting' } else { 'starting' }
      Write-Host "Budget Terminal is $action independently. You can close this terminal. Startup logs: $logDirectory"
      return
    }
    if ($Setup -and ($RuntimeOnly -or $Dev -or $Logs)) {
      throw 'Setup cannot be combined with launch options.'
    }
    $node = Get-BudgetNode
    # The selected complete toolchain also owns npm.cmd and all nested scripts.
    $env:PATH = (Split-Path -Parent $node) + [IO.Path]::PathSeparator + $env:PATH
    if ($RuntimeOnly) { Write-Output $node; return }
    if ($Command -eq 'restart') { Stop-BudgetTerminal }
    if (-not $Setup) { & (Join-Path $PSScriptRoot 'install-bt.ps1') -Quiet }
    $launchArguments = @()
    if ($Setup) { $launchArguments += '--setup' }
    if ($Dev) { $launchArguments += '--dev' }
    if ($Logs) { $launchArguments += '--logs' }
    & $node (Join-Path $PSScriptRoot 'launch.cjs') @launchArguments
    if ($Setup -and $LASTEXITCODE -eq 0) {
      & (Join-Path $PSScriptRoot 'install-bt.ps1')
      Write-Host 'Checks passed. Open a new terminal and type btd for the desktop app.'
    }
    exit $LASTEXITCODE
  } catch {
    Write-Host "Budget Terminal startup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
}

if ($MyInvocation.InvocationName -ne '.') { Start-BudgetTerminal }
