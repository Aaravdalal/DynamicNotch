[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media, ContentType = WindowsRuntime] | Out-Null
$manager = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync().GetAwaiter().GetResult()
$session = $manager.GetCurrentSession()
if ($session) {
    $info = $session.TryGetMediaPropertiesAsync().GetAwaiter().GetResult()
    Write-Output "UPDATE|$($info.Artist)|$($info.Title)"
}
