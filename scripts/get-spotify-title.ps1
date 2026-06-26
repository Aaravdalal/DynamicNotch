$spotify = Get-Process Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle } | Select-Object -First 1

if ($spotify) {
    if (-not [string]::IsNullOrWhiteSpace($spotify.MainWindowTitle)) {
        Write-Output $spotify.MainWindowTitle
    } else {
        Write-Output ""
    }
} else {
    Write-Output ""
}
