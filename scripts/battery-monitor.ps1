$lastPercent = -1
$lastIsCharging = -1
$lastIsSaver = -1

Write-Host "Battery Monitor Started. Listening for changes..."

function Get-SaverOn {
    try {
        # Windows 11 Energy Saver toggle state:
        # HKLM\SYSTEM\CurrentControlSet\Control\Power\EnergySaverState
        # 1 = ON, 0 = OFF
        $regPath = "HKLM:\SYSTEM\CurrentControlSet\Control\Power"
        $val = Get-ItemProperty -Path $regPath -Name EnergySaverState -ErrorAction SilentlyContinue
        if ($val -and $val.EnergySaverState -ne $null) {
            $on = ($val.EnergySaverState -eq 1)
            Write-Host ("DEBUG: EnergySaverState reg=" + $val.EnergySaverState + " => saver=" + $on)
            return $on
        }
    } catch {}
    return $false
}

while ($true) {
    try {
        $bat = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue

        $percent = 100
        $isCharging = $false

        if ($bat) {
            $percent = $bat.EstimatedChargeRemaining
            $isCharging = ($bat.BatteryStatus -eq 2) -or ($bat.BatteryStatus -ge 6 -and $bat.BatteryStatus -le 9)
        }

        $isSaver = Get-SaverOn

        if ($percent -ne $lastPercent -or $isCharging -ne $lastIsCharging -or $isSaver -ne $lastIsSaver) {
            $chgStr = if ($isCharging) { "true" } else { "false" }
            $savStr = if ($isSaver) { "true" } else { "false" }
            Write-Host "EVENT:$chgStr|$percent|$savStr"

            $lastPercent = $percent
            $lastIsCharging = $isCharging
            $lastIsSaver = $isSaver
        }
    } catch {}

    Start-Sleep -Milliseconds 1000
}