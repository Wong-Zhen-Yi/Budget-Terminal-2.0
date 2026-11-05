$ErrorActionPreference = 'Stop'
# Crypto opens directly with market data; the Workspace header, USD badge and Copy snapshot action are removed.
# Portfolio stocks highlight the full row on hover and while editing or focusing row controls.

function Read-BudgetMenuKey {
  # A redirected/noninteractive installer must not launch the default app silently.
  if ([Console]::IsInputRedirected) { return [ConsoleKey]::Escape }
  return [Console]::ReadKey($true).Key
}

function Show-BudgetInterfaceMenu([int]$Selected) {
  Clear-Host
  Write-Host 'Budget Terminal - setup checks passed'
  Write-Host ''
  Write-Host 'Use Up/Down or 1/2 to choose. Press Enter to open. Esc closes this window.'
  Write-Host ''
  $options = @('BTD - Desktop app', 'BT  - Terminal interface')
  for ($index = 0; $index -lt $options.Count; $index++) {
    $marker = if ($index -eq $Selected) { '>' } else { ' ' }
    Write-Host ("  {0} {1}. {2}" -f $marker, ($index + 1), $options[$index])
  }
  Write-Host ''
  Write-Host 'You can also open a new PowerShell or Command Prompt window and type:'
  Write-Host '  btd  - open the desktop app'
  Write-Host '  bt   - open the terminal interface'
  Write-Host 'BT TUI includes Portfolio, candlestick charts and Agents chat. F1/F2 switches views.'
  Write-Host 'Keep this terminal open while using Budget Terminal.'
}

function Select-BudgetInterface {
  $selected = 0
  while ($true) {
    Show-BudgetInterfaceMenu $selected
    switch (Read-BudgetMenuKey) {
      { $_ -in @([ConsoleKey]::UpArrow, [ConsoleKey]::DownArrow) } { $selected = 1 - $selected }
      { $_ -in @([ConsoleKey]::D1, [ConsoleKey]::NumPad1, [ConsoleKey]::Home) } { $selected = 0 }
      { $_ -in @([ConsoleKey]::D2, [ConsoleKey]::NumPad2, [ConsoleKey]::End) } { $selected = 1 }
      ([ConsoleKey]::Enter) { return @('Desktop', 'Tui')[$selected] }
      { $_ -in @([ConsoleKey]::Escape, [ConsoleKey]::Q) } { return 'Exit' }
    }
  }
}

function Start-BudgetInterfaceMenu {
  $selection = Select-BudgetInterface
  $launcher = Join-Path $PSScriptRoot 'launch-windows.ps1'
  if ($selection -eq 'Desktop') { & $launcher }
  elseif ($selection -eq 'Tui') { & $launcher -Tui }
  else { return }
  exit $LASTEXITCODE
}

if ($MyInvocation.InvocationName -ne '.') { Start-BudgetInterfaceMenu }
