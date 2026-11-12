param([switch]$Uninstall, [switch]$Quiet)
$ErrorActionPreference = 'Stop'
# Charts watchlists now follow user data backup, restore, cloud sync and clear, with automatic profile migration.
function Get-BudgetUserPath { [Environment]::GetEnvironmentVariable('Path', 'User') }
function Set-BudgetUserPath([string]$Value) { [Environment]::SetEnvironmentVariable('Path', $Value, 'User') }
function Publish-PathChange {
  if (-not ('BudgetTerminalEnvironment' -as [type])) {
    Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class BudgetTerminalEnvironment {
  [DllImport("user32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern IntPtr SendMessageTimeout(IntPtr window, uint message,
    UIntPtr parameter, string text, uint flags, uint timeout, out UIntPtr result);
}
'@
  }
  $result = [UIntPtr]::Zero
  [void][BudgetTerminalEnvironment]::SendMessageTimeout([IntPtr]0xffff, 0x1a, [UIntPtr]::Zero, 'Environment', 2, 1000, [ref]$result)
}
function Install-BudgetDesktopCommand {
  $bin = Join-Path $env:LOCALAPPDATA 'BudgetTerminal\bin'
  $shim = Join-Path $bin 'BTD.cmd'
  $launcher = Join-Path $PSScriptRoot 'launch-windows.ps1'
  $userPath = Get-BudgetUserPath
  $entries = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $bin.TrimEnd('\') })
  # Remove only the retired command installed for this checkout, never another command.
  $legacyShim = Join-Path $bin 'BT.cmd'
  if (Test-Path -LiteralPath $legacyShim -PathType Leaf) {
    $legacyContent = [IO.File]::ReadAllText($legacyShim, [Text.Encoding]::Default)
    if ($legacyContent.Contains('"' + $launcher + '" -Tui ')) { Remove-Item -LiteralPath $legacyShim }
  }
  if ($Uninstall) {
    if (Test-Path -LiteralPath $shim) { Remove-Item -LiteralPath $shim }
    if (-not (Test-Path -LiteralPath $legacyShim -PathType Leaf)) { Set-BudgetUserPath ($entries -join ';') }
    Publish-PathChange
    Write-Host 'BTD command removed. Reopen PowerShell to refresh PATH.'
    return
  }
  # Quote the checkout path; keep machine-specific paths outside the public repository.
  $content = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$launcher`" %*`r`nexit /b %errorlevel%`r`n"
  if ((Test-Path -LiteralPath $shim -PathType Leaf) -and
      [IO.File]::ReadAllText($shim, [Text.Encoding]::Default) -eq $content -and
      @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ieq $bin.TrimEnd('\') }).Count -gt 0) {
    if (-not $Quiet) { Write-Host 'BTD is installed. Type btd in a new terminal window to open the desktop app when needed.' }
    return
  }
  New-Item -ItemType Directory -Path $bin -Force | Out-Null
  [IO.File]::WriteAllText($shim, $content, [Text.Encoding]::Default)
  Set-BudgetUserPath ((@($bin) + $entries) -join ';')
  Publish-PathChange
  $env:Path = $bin + ';' + $env:Path
  if (-not $Quiet) { Write-Host 'BTD installed. Open a new terminal window, then type btd. No administrator access is needed.' }
}

if ($MyInvocation.InvocationName -ne '.') { Install-BudgetDesktopCommand }
