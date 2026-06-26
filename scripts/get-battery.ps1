$battery = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue

if ($battery) {
    # 2=Unknown, 3=Fully Charged, 6=Charging, 7=Charging/High, 8=Charging/Low, 9=Charging/Critical
    $charging = $false
    if ($battery.BatteryStatus -eq 2 -or $battery.BatteryStatus -eq 3 -or $battery.BatteryStatus -eq 6 -or $battery.BatteryStatus -eq 7 -or $battery.BatteryStatus -eq 8 -or $battery.BatteryStatus -eq 9) {
        $charging = $true
    }
    
    $percent = $battery.EstimatedChargeRemaining

    # Power plan (to check for saver mode)
    $plan = Get-CimInstance -Namespace root\cimv2\power -Class Win32_PowerPlan -Filter "IsActive='true'" -ErrorAction SilentlyContinue | Select-Object -ExpandProperty ElementName
    $saver = $false
    if ($plan -match 'saver' -or $plan -match 'eco') {
        $saver = $true
    }

    $cStr = "false"
    if ($charging) { $cStr = "true" }
    $sStr = "false"
    if ($saver) { $sStr = "true" }

    Write-Output "true|$cStr|$percent|$sStr"
} else {
    Write-Output "false"
}
