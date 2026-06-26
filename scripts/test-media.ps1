[CmdletBinding()]
Param()

try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
    
    $op = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $info = [Windows.Foundation.IAsyncInfo]$op
    while ($info.Status -eq 0) { Start-Sleep -Milliseconds 10 }
    
    if ($info.Status -ne 1) { Write-Output "Failed"; exit 0 }
    
    $manager = $op.GetResults()
    
    $session = $manager.GetCurrentSession()
    if ($null -eq $session) { Write-Output "No session found"; exit 0 }
    
    $playbackInfo = $session.GetPlaybackInfo()
    $status = $playbackInfo.PlaybackStatus.ToString()
    Write-Output "Status: $status"
    
    if ($status -eq "Playing") {
        $propsOp = $session.TryGetMediaPropertiesAsync()
        $propsInfo = [Windows.Foundation.IAsyncInfo]$propsOp
        while ($propsInfo.Status -eq 0) { Start-Sleep -Milliseconds 10 }
        $props = $propsOp.GetResults()
        
        Write-Output "Title: $($props.Title)"
        Write-Output "Artist: $($props.Artist)"
    }
} catch {
    Write-Output "Error: $_"
}
