try {
    # Load the assembly specifically
    $winmd = "$env:windir\System32\WinMetadata\Windows.Media.winmd"
    if (Test-Path $winmd) {
        [void][System.Reflection.Assembly]::LoadFile($winmd)
    }
    
    # Try alternate way to get the type if standard way fails
    $managerTask = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]::RequestAsync()
    $timer = 0
    while (-not $managerTask.IsCompleted -and $timer -lt 200) { 
        [System.Threading.Thread]::Sleep(10)
        $timer++
    }
    
    if (-not $managerTask.IsCompleted) {
        Write-Output "Error: Timeout"
        exit
    }
    
    $manager = $managerTask.GetResults()
    $session = $manager.GetCurrentSession()
    
    if ($null -eq $session) {
        Write-Output "None"
        exit
    }

    $propsTask = $session.TryGetMediaPropertiesAsync()
    while (-not $propsTask.IsCompleted) { [System.Threading.Thread]::Sleep(10) }
    $props = $propsTask.GetResults()

    $playback = $session.GetPlaybackInfo()
    $status = $playback.PlaybackStatus.ToString()
    
    $thumbBase64 = ""
    if ($props.Thumbnail) {
        try {
            $streamTask = $props.Thumbnail.OpenReadAsync()
            while (-not $streamTask.IsCompleted) { [System.Threading.Thread]::Sleep(10) }
            $stream = $streamTask.GetResults()
            $reader = New-Object Windows.Storage.Streams.DataReader($stream)
            $loadTask = $reader.LoadAsync($stream.Size)
            while (-not $loadTask.IsCompleted) { [System.Threading.Thread]::Sleep(10) }
            $buffer = New-Object byte[]($stream.Size)
            $reader.ReadBytes($buffer)
            $thumbBase64 = [Convert]::ToBase64String($buffer)
            $stream.Close()
        } catch {}
    }

    $res = @{
        status = $status
        title = $props.Title
        artist = $props.Artist
        album = $props.AlbumTitle
        source = $session.SourceAppUserModelId
        thumbnail = $thumbBase64
    }
    $res | ConvertTo-Json -Compress
} catch {
    Write-Output "Error: $($_.Exception.Message)"
}
