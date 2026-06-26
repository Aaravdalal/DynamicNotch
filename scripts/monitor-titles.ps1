# Generic Window Monitor
while ($true) {
    try {
        Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object {
            $title = $_.MainWindowTitle
            $proc = $_.ProcessName
            Write-Output "UPDATE|$proc|$title"
        }
        # Special check for Spotify if window not found (it hides window title when playing sometimes)
        $spotify = Get-Process -Name Spotify -ErrorAction SilentlyContinue
        if ($spotify) {
            # If we don't find a window title, just output the process name to keep it alive
            # media.js will handle the actual detection
            Write-Output "UPDATE|Spotify|Spotify"
        }
    } catch {}
    Start-Sleep -Seconds 2
}
