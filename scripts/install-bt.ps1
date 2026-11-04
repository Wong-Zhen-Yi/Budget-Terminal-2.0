param([switch]$Uninstall)
$ErrorActionPreference = 'Stop'
$bin = Join-Path $env:LOCALAPPDATA 'BudgetTerminal\bin'
$shim = Join-Path $bin 'BT.cmd'
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
  [Environment]::SetEnvironmentVariable('Path', ($entries -join ';'), 'User')
  Publish-PathChange
  Write-Host 'BT command removed. Reopen PowerShell to refresh PATH.'
  return
}
$launcher = Join-Path $PSScriptRoot 'launch-windows.ps1'
New-Item -ItemType Directory -Path $bin -Force | Out-Null
# Quote the checkout path; keep machine-specific paths outside the public repository.
$content = "@echo off`r`npowershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$launcher`" -Tui %*`r`nexit /b %errorlevel%`r`n"
[IO.File]::WriteAllText($shim, $content, [Text.Encoding]::Default)
[Environment]::SetEnvironmentVariable('Path', ((@($bin) + $entries) -join ';'), 'User')
Publish-PathChange
$env:Path = $bin + ';' + $env:Path
Write-Host 'BT installed. Open a new PowerShell window, then type BT. No administrator access is needed.'
