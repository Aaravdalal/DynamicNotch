Add-Type -AssemblyName System.Runtime.WindowsRuntime
[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
$task = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
$awaiter = [System.WindowsRuntimeSystemExtensions]::GetAwaiter($task)
while (-not $awaiter.IsCompleted) { Start-Sleep -Milliseconds 10 }
$manager = $awaiter.GetResult()
Write-Host "Manager: $manager"
if ($manager) {
    $session = $manager.GetCurrentSession()
    Write-Host "Session: $session"
    if ($session) {
        $props = [System.WindowsRuntimeSystemExtensions]::GetAwaiter($session.TryGetMediaPropertiesAsync()).GetResult()
        $timeline = $session.GetTimelineProperties()
        Write-Host "Title: $($props.Title)"
        Write-Host "Position: $($timeline.Position.TotalSeconds)"
        
        # Test changing position (seek to 1 minute = 600000000 ticks)
        # $session.TryChangePlaybackPositionAsync([TimeSpan]::FromSeconds(60))
    }
}
