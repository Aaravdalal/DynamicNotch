# Seek the current SMTC media session to a position (milliseconds). Best-effort:
# not every app supports position changes; if it doesn't, the scrubber simply
# re-syncs to the real position on the next SMTC update.
param([long]$PositionMs = 0)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime | Out-Null

$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]

function Await($op, $type) {
    $m = $asTaskGeneric.MakeGenericMethod($type)
    $t = $m.Invoke($null, @($op))
    $t.Wait(-1) | Out-Null
    $t.Result
}

try {
    [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime] | Out-Null
    $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
    $mgr = Await ($mgrType::RequestAsync()) ($mgrType)
    $session = $mgr.GetCurrentSession()
    if ($session) {
        # SMTC positions are in 100-ns ticks.
        $ticks = [long]($PositionMs * 10000)
        $null = Await ($session.TryChangePlaybackPositionAsync($ticks)) ([bool])
    }
} catch {}
