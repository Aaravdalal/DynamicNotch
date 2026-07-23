# ─── SMTC media monitor ───
# Streams the current Windows media session (title / artist / album / play state /
# real position + duration) as JSON lines prefixed "SMTC|". This is the accurate
# source the notch's scrubber and controls read, replacing window-title scraping
# and the old guessed progress counter.
#
# Emits on every poll while something is loaded, and "SMTC|NONE" when no session
# exists. media.js dedupes, so re-emitting the same line is cheap.

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

# WinRT IAsyncOperation<T> -> synchronous await helper.
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($op, $type) {
    $m = $asTaskGeneric.MakeGenericMethod($type)
    $t = $m.Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
}

[Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
$mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
$propType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties]

$mgr = $null
try { $mgr = Await ($mgrType::RequestAsync()) ($mgrType) } catch {}

# Cache media properties (title/artist) — they only change when the track does,
# and TryGetMediaPropertiesAsync is the one expensive call. Position/status come
# fresh every tick from the cheap synchronous getters.
$lastKey = ''
$cachedTitle = ''; $cachedArtist = ''; $cachedAlbum = ''

while ($true) {
    try {
        if (-not $mgr) { try { $mgr = Await ($mgrType::RequestAsync()) ($mgrType) } catch {} }
        $session = if ($mgr) { $mgr.GetCurrentSession() } else { $null }

        if (-not $session) {
            Write-Output "SMTC|NONE"
        }
        else {
            $playback = $session.GetPlaybackInfo()
            $timeline = $session.GetTimelineProperties()
            $status = [string]$playback.PlaybackStatus   # Playing / Paused / Stopped / Closed
            $appId = [string]$session.SourceAppUserModelId
            $posMs = [long]$timeline.Position.TotalMilliseconds
            $durMs = [long]$timeline.EndTime.TotalMilliseconds

            # Refresh title/artist only when the app or a track boundary changes.
            $key = "$appId|$posMs|$durMs"
            if ($appId -ne $script:lastAppId -or $durMs -ne $script:lastDur) {
                try {
                    $props = Await ($session.TryGetMediaPropertiesAsync()) ($propType)
                    $cachedTitle = [string]$props.Title
                    $cachedArtist = [string]$props.Artist
                    $cachedAlbum = [string]$props.AlbumTitle
                } catch {}
                $script:lastAppId = $appId
                $script:lastDur = $durMs
            }
            # Always refresh props if we have no title yet (first load race).
            if ([string]::IsNullOrEmpty($cachedTitle)) {
                try {
                    $props = Await ($session.TryGetMediaPropertiesAsync()) ($propType)
                    $cachedTitle = [string]$props.Title
                    $cachedArtist = [string]$props.Artist
                    $cachedAlbum = [string]$props.AlbumTitle
                } catch {}
            }

            $obj = [ordered]@{
                title      = $cachedTitle
                artist     = $cachedArtist
                album      = $cachedAlbum
                appId      = $appId
                status     = $status
                positionMs = $posMs
                durationMs = $durMs
            }
            Write-Output ("SMTC|" + ($obj | ConvertTo-Json -Compress))
        }
    }
    catch {
        Write-Output "SMTC|NONE"
    }
    Start-Sleep -Milliseconds 900
}
