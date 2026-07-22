# Kills every process this project started — the Electron windows plus the
# PowerShell/exe monitors they spawn. The app leaves these behind on a hard
# exit, which holds port 8080 (EADDRINUSE on the next launch) and locks
# electron.exe (EBUSY on npm install).
#
# Filters on THIS project's path only, so VS Code and other Electron apps are
# untouched, and skips its own PID so it can't kill the shell running it.

$me = $PID
$targets = Get-CimInstance Win32_Process | Where-Object {
  $_.ProcessId -ne $me -and (
    $_.ExecutablePath -like '*dynamic-notch*' -or
    ($_.CommandLine -like '*dynamic-notch*scripts*' -and
     $_.Name -match 'powershell|sys-monitor|lock-monitor|battery-monitor')
  )
}

if (-not $targets) {
  Write-Host 'Nothing running.'
} else {
  Write-Host ("Killing {0} process(es)..." -f @($targets).Count)
  $targets | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
}

$left = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*dynamic-notch*' }).Count
$port = Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
Write-Host ("Electron left: {0}" -f $left)
Write-Host ("Port 8080: {0}" -f $(if ($port) { 'still held' } else { 'free' }))
