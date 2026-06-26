$powerType = [Windows.System.Power.PowerManager, Windows.System.Power, ContentType=WindowsRuntime]

$lastPercent = -1
$lastIsCharging = -1
$lastIsSaver = -1

Write-Host "Battery Monitor Started. Listening for changes..."

while ($true) {
    try {
        $bat = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue
        
        $percent = 100
        $isCharging = $false
        
        if ($bat) {
            $percent = $bat.EstimatedChargeRemaining
            # BatteryStatus: 2=AC, 6=Charging, 7=Charging/High, 8=Charging/Low, 9=Charging/Critical
            $isCharging = ($bat.BatteryStatus -eq 2) -or ($bat.BatteryStatus -ge 6 -and $bat.BatteryStatus -le 9)
        }

        $isSaver = if ($powerType::EnergySaverStatus -eq 'On') { $true } else { $false }

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
