$lastPercent = -1
$lastIsCharging = -1
$lastIsSaver = -1

# Use the same Win32 API the Windows taskbar uses (GetSystemPowerStatus).
# Win32_Battery.EstimatedChargeRemaining (WMI) is computed differently and
# routinely reads 1% off from the taskbar — this fixes that mismatch.
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class PowerStatus {
    [StructLayout(LayoutKind.Sequential)]
    public struct SYSTEM_POWER_STATUS {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte SystemStatusFlag;
        public int BatteryLifeTime;
        public int BatteryFullLifeTime;
    }
    [DllImport("kernel32.dll")]
    public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS status);
}
"@

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
        $percent = 100
        $isCharging = $false

        $status = New-Object PowerStatus+SYSTEM_POWER_STATUS
        if ([PowerStatus]::GetSystemPowerStatus([ref]$status)) {
            # BatteryLifePercent: 0-100, or 255 when unknown.
            if ($status.BatteryLifePercent -le 100) {
                $percent = [int]$status.BatteryLifePercent
            }
            # ACLineStatus: 1 = plugged in (treated as charging), 0 = on battery.
            $isCharging = ($status.ACLineStatus -eq 1)
        } else {
            # Fallback to WMI if the API call fails for any reason.
            $bat = Get-CimInstance -ClassName Win32_Battery -ErrorAction SilentlyContinue
            if ($bat) {
                $percent = $bat.EstimatedChargeRemaining
                $isCharging = ($bat.BatteryStatus -eq 2) -or ($bat.BatteryStatus -ge 6 -and $bat.BatteryStatus -le 9)
            }
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