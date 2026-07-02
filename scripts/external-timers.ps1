Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement

$lastChromeTime = ""
$chromePauseCount = 0

while ($true) {
    Start-Sleep -Milliseconds 250
    $activeTimer = $false

    # 1. Check Chrome Google Timer
    $chrome = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -match "^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s?-\s?" } | Select-Object -First 1
    if ($chrome) {
        $title = $chrome.MainWindowTitle
        $title -match "^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s?-\s?" | Out-Null
        $h = 0; $m = 0; $s = 0;
        if ($matches[1]) { $h = [int]$matches[1]; $m = [int]$matches[2]; $s = [int]$matches[3]; }
        else { $m = [int]$matches[2]; $s = [int]$matches[3]; }
        
        $total = ($h * 3600) + ($m * 60) + $s
        
        $isPaused = "ACTIVE"
        if ($title -eq $lastChromeTime) {
            $chromePauseCount++
            if ($chromePauseCount -ge 4) { $isPaused = "PAUSED" }
        } else {
            $chromePauseCount = 0
            $lastChromeTime = $title
        }

        Write-Output "CHROME_TIMER:${total}:${isPaused}"
        $activeTimer = $true
    } else {
        $chromePauseCount = 0
        $lastChromeTime = ""
    }

    # 2. Check Windows Focus Session
    if (-not $activeTimer) {
        $clockRunning = Get-Process Time -ErrorAction SilentlyContinue
        if ($clockRunning) {
            $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, "Clock")
            $clockWin = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
            
            if ($clockWin) {
                $allText = $clockWin.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
                foreach ($el in $allText) {
                    $name = $el.Current.Name
                    if ($name -match "^(?:(\d{1,2}):)?(\d{1,2}):(\d{2})$") {
                        $h = 0; $m = 0; $s = 0;
                        if ($matches[1]) { $h = [int]$matches[1]; $m = [int]$matches[2]; $s = [int]$matches[3]; }
                        else { $m = [int]$matches[2]; $s = [int]$matches[3]; }
                        $total = ($h * 3600) + ($m * 60) + $s
                        Write-Output "FOCUS_SESSION:${total}:ACTIVE"
                        $activeTimer = $true
                        break
                    }
                }
            }
        }
    }

    if (-not $activeTimer) {
        Write-Output "NONE_TIMER"
    }

    # 3. Check Microphone Usage (Replaces Sound Recorder / Voice Recorder UIAutomation)
    $micActive = $false
    # Check Packaged apps
    $micKeysPackaged = Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone" -Exclude "NonPackaged" -ErrorAction SilentlyContinue
    foreach ($key in $micKeysPackaged) {
        $lastStop = (Get-ItemProperty $key.PSPath -Name LastUsedTimeStop -ErrorAction SilentlyContinue).LastUsedTimeStop
        if ($null -ne $lastStop -and $lastStop -eq 0) {
            $micActive = $true
            break
        }
    }
    
    # Check NonPackaged apps if not already found active
    if (-not $micActive) {
        $micKeysNonPackaged = Get-ChildItem "HKCU:\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\microphone\NonPackaged" -ErrorAction SilentlyContinue
        foreach ($key in $micKeysNonPackaged) {
            $lastStop = (Get-ItemProperty $key.PSPath -Name LastUsedTimeStop -ErrorAction SilentlyContinue).LastUsedTimeStop
            if ($null -ne $lastStop -and $lastStop -eq 0) {
                $micActive = $true
                break
            }
        }
    }

    if ($micActive) {
        Write-Output "MIC_ACTIVE"
    } else {
        $vrRunning = Get-Process VoiceRecorder, SoundRecorder -ErrorAction SilentlyContinue
        if ($vrRunning) {
            Write-Output "MIC_PAUSED"
        } else {
            Write-Output "MIC_INACTIVE"
        }
    }
}
