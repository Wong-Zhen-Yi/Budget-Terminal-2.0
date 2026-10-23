param([switch]$RuntimeOnly)

$ErrorActionPreference = 'Stop'
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

function Start-BudgetTerminal {
  try {
    $node = Get-BudgetNode
    # The selected complete toolchain also owns npm.cmd and all nested scripts.
    $env:PATH = (Split-Path -Parent $node) + [IO.Path]::PathSeparator + $env:PATH
    if ($RuntimeOnly) { Write-Output $node; return }
    Write-Host "Using Node.js $(& $node --version)."
    & $node (Join-Path $PSScriptRoot 'launch.cjs')
    exit $LASTEXITCODE
  } catch {
    Write-Host "Budget Terminal startup failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
}

if ($MyInvocation.InvocationName -ne '.') { Start-BudgetTerminal }
