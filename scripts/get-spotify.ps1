[CmdletBinding()]
Param()

try {
    # Load Windows Runtime types for media controls
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
    
    # Get the GlobalSystemMediaTransportControlsSessionManager
    $manager = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync().GetAwaiter().GetResult()
    
    # Get the current session
    $session = $manager.GetCurrentSession()
    
    if ($null -eq $session) {
        Write-Output ""
        exit 0
    }
    
    # Get playback info
    $playbackInfo = $session.GetPlaybackInfo()
    $playbackStatus = $playbackInfo.PlaybackStatus.ToString()
    
    # Only return info if playing
    if ($playbackStatus -ne "Playing") {
        Write-Output ""
        exit 0
    }
    
    # Get media properties
    $mediaProperties = $session.TryGetMediaPropertiesAsync().GetAwaiter().GetResult()
    
    $artist = $mediaProperties.Artist
    $title = $mediaProperties.Title
    
    if ([string]::IsNullOrWhiteSpace($title) -and [string]::IsNullOrWhiteSpace($artist)) {
        Write-Output ""
        exit 0
    }
    
    # Format output as "Artist - Title" or just "Title"
    if (-not [string]::IsNullOrWhiteSpace($artist)) {
        Write-Output "$artist - $title"
    } else {
        Write-Output "$title"
    }
    
} catch {
    Write-Output ""
}
