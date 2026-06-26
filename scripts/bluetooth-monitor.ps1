$lastConnected = @{}

# Pre-populate already connected devices so we don't spam on startup
try {
    $initial = Get-PnpDevice -Class Bluetooth, AudioEndpoint -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -and $_.FriendlyName -notmatch 'Radio|Adapter|Enumerator|Bluetooth Device|Microsoft|High Definition|Realtek|Microphone Array|Speakers' }
    foreach ($dev in $initial) {
        $lastConnected[$dev.FriendlyName] = $true
    }
} catch {}

# Helper: get BT battery from Windows registry
function Get-BluetoothBattery($deviceName) {
    try {
        # Method 1: Query via WMI/CIM for battery-reporting BT devices
        $btDevices = Get-CimInstance -Namespace root\cimv2 -ClassName Win32_PnPEntity -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like "*$deviceName*" -or $_.Caption -like "*$deviceName*" }

        foreach ($d in $btDevices) {
            $instanceId = $d.DeviceID
            if ($instanceId) {
                # Check registry for battery level
                $regPath = "HKLM:\SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices"
                if (Test-Path $regPath) {
                    $subkeys = Get-ChildItem $regPath -ErrorAction SilentlyContinue
                    foreach ($key in $subkeys) {
                        $batt = (Get-ItemProperty -Path $key.PSPath -Name "BatteryLevel" -ErrorAction SilentlyContinue).BatteryLevel
                        $name = (Get-ItemProperty -Path $key.PSPath -Name "FriendlyName" -ErrorAction SilentlyContinue).FriendlyName
                        if ($name -and $name -like "*$deviceName*" -and $null -ne $batt) {
                            return [int]$batt
                        }
                    }
                }
            }
        }

        # Method 2: Check via PnP battery percentage in registry
        $btPortDevices = Get-ChildItem "HKLM:\SYSTEM\CurrentControlSet\Services\BTHPORT\Parameters\Devices" -ErrorAction SilentlyContinue
        foreach ($key in $btPortDevices) {
            $batt = (Get-ItemProperty -Path $key.PSPath -Name "BatteryLevel" -ErrorAction SilentlyContinue).BatteryLevel
            if ($null -ne $batt -and $batt -ge 0 -and $batt -le 100) {
                return [int]$batt
            }
        }

        # Method 3: Try Bluetooth LE battery service via Get-PnpDeviceProperty
        $bleDevices = Get-PnpDevice -Class Bluetooth -Status OK -ErrorAction SilentlyContinue |
            Where-Object { $_.FriendlyName -like "*$deviceName*" }
        foreach ($d in $bleDevices) {
            $battProp = Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction SilentlyContinue
            if ($battProp -and $battProp.Data -ge 0) {
                return [int]$battProp.Data
            }
        }
    } catch {}
    return -1
}

Write-Host "Monitoring Bluetooth via polling..."

while ($true) {
    try {
        $devices = Get-PnpDevice -Class Bluetooth, AudioEndpoint -Status OK -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -and $_.FriendlyName -notmatch 'Radio|Adapter|Enumerator|Bluetooth Device|Microsoft|High Definition|Realtek|Microphone Array|Speakers' }

        $current = @{}
        foreach ($dev in $devices) {
            $name = $dev.FriendlyName
            $current[$name] = $true

            $t = 'device'
            if ($name -match 'AirPod|Bud|headphone|earphone|WF-|WH-|Jabra|Galaxy Buds|Audio') {
                $t = 'earbuds'
            } elseif ($name -match 'speaker|JBL|UE|Bose|Sonos') {
                $t = 'speaker'
            }

            # Get actual battery level
            $battery = Get-BluetoothBattery $name

            # If it wasn't connected last check, OR if it's connected and battery is different (and valid)
            $isNew = -not $lastConnected.ContainsKey($name)
            $hasBattChange = $lastConnected.ContainsKey($name) -and $lastConnected[$name] -ne $battery -and $battery -ne -1

            if ($isNew -or $hasBattChange) {
                $json = @{ name = $name; connected = $true; battery = $battery; type = $t } | ConvertTo-Json -Compress
                Write-Host "EVENT:$json"
            }
            
            # Update state with current battery
            $current[$name] = $battery
        }
        $lastConnected = $current
    } catch {}

    Start-Sleep -Seconds 3
}
