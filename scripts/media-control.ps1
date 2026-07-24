# ─── SMTC media control (persistent) ───
# Reads one command per line from stdin and applies it to the *current* Windows
# media session — the same session smtc-monitor.ps1 reports. This replaces the
# old global media-key presses (keybd_event), which fired at whatever app had
# key focus and often did nothing. Session control targets the exact player, so
# play/pause/next/prev/seek are reliable. Kept alive by media.js so the WinRT
# session manager loads once and every command is low-latency.
#
# Commands:  playpause | play | pause | next | prev | seek <positionMs>

$ErrorActionPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

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

$mgr = $null
try { $mgr = Await ($mgrType::RequestAsync()) ($mgrType) } catch {}

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }   # stdin closed → parent gone
    $line = $line.Trim()
    if ($line -eq '') { continue }

    try {
        if (-not $mgr) { $mgr = Await ($mgrType::RequestAsync()) ($mgrType) }
        $session = if ($mgr) { $mgr.GetCurrentSession() } else { $null }
        if (-not $session) { continue }

        $parts = $line.Split(' ')
        switch ($parts[0]) {
            'playpause' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
            'play'      { $null = Await ($session.TryPlayAsync()) ([bool]) }
            'pause'     { $null = Await ($session.TryPauseAsync()) ([bool]) }
            'next'      { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
            'prev'      { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
            'seek' {
                if ($parts.Count -ge 2) {
                    $ms = [long]$parts[1]
                    if ($ms -lt 0) { $ms = 0 }
                    # SMTC positions are in 100-ns ticks.
                    $null = Await ($session.TryChangePlaybackPositionAsync([long]($ms * 10000))) ([bool])
                }
            }
        }
    } catch {}
}
