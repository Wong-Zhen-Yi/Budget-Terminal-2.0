param([switch]$Uninstall, [switch]$Desktop)
$ErrorActionPreference = 'Stop'
# Charts watchlists now follow user data backup, restore, cloud sync and clear, with automatic profile migration.
$command = if ($Desktop) { 'BTD' } else { 'BT' }
$interface = if ($Desktop) { 'desktop app' } else { 'TUI' }
$bin = Join-Path $env:LOCALAPPDATA 'BudgetTerminal\bin'
$shim = Join-Path $bin "$command.cmd"
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$entries = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $bin.TrimEnd('\') })
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
if ($Uninstall) {
  if (Test-Path -LiteralPath $shim) { Remove-Item -LiteralPath $shim }
  $otherCommand = if ($Desktop) { 'BT.cmd' } else { 'BTD.cmd' }
  if (-not (Test-Path -LiteralPath (Join-Path $bin $otherCommand) -PathType Leaf)) {
    [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')
  }
  Publish-PathChange
  Write-Host "$command command removed. Reopen PowerShell to refresh PATH."
  return
}
$launcher = Join-Path $PSScriptRoot 'launch-windows.ps1'
# Quote the checkout path; keep machine-specific paths outside the public repository.
$mode = if ($Desktop) { '' } else { ' -Tui' }
$content = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$launcher`"$mode %*`r`nexit /b %errorlevel%`r`n"
if ((Test-Path -LiteralPath $shim -PathType Leaf) -and
    [IO.File]::ReadAllText($shim, [Text.Encoding]::Default) -eq $content -and
    @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ieq $bin.TrimEnd('\') }).Count -gt 0) {
  Write-Host "$command is installed. Type $command in a new terminal window to open the $interface when needed."
  return
}
New-Item -ItemType Directory -Path $bin -Force | Out-Null
[IO.File]::WriteAllText($shim, $content, [Text.Encoding]::Default)
[Environment]::SetEnvironmentVariable('Path', ((@($bin) + $entries) -join ';'), 'User')
Publish-PathChange
$env:Path = $bin + ';' + $env:Path
Write-Host "$command installed. Open a new terminal window, then type $command. No administrator access is needed."
