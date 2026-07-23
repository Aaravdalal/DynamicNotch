# Persistent media-control daemon. Reads one action per line from stdin and
# drives the CURRENT Windows SMTC session directly (play/pause/next/prev) —
# far more reliable than broadcasting global media keys, which land on whatever
# app happens to hold media-key focus instead of the session we're showing.
# WinRT is initialised once so each keypress is instant (no per-press spawn).
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
$mgr = Await ($mgrType::RequestAsync()) ($mgrType)

while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line) { break }   # parent closed stdin — exit
    $action = $line.Trim().ToLower()
    if ($action -eq '') { continue }
    try {
        $session = $mgr.GetCurrentSession()   # re-read each time — the active app can change
        if ($session) {
            switch ($action) {
                'playpause' { $null = Await ($session.TryTogglePlayPauseAsync()) ([bool]) }
                'play'      { $null = Await ($session.TryPlayAsync()) ([bool]) }
                'pause'     { $null = Await ($session.TryPauseAsync()) ([bool]) }
                'next'      { $null = Await ($session.TrySkipNextAsync()) ([bool]) }
                'prev'      { $null = Await ($session.TrySkipPreviousAsync()) ([bool]) }
            }
        }
    } catch {}
}
