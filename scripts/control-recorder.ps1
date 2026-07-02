param($Action)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$vrs = Get-Process VoiceRecorder, SoundRecorder -ErrorAction SilentlyContinue
if (-not $vrs) { exit }
$root = [System.Windows.Automation.AutomationElement]::RootElement
foreach ($vr in $vrs) {
    $cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, $vr.Id)
    $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
    if (-not $win) {
        $condW = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window)
        $and = New-Object System.Windows.Automation.AndCondition($cond, $condW)
        $win = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $and)
    }
    if ($win) {
        $btnCond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Button)
        $btns = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, $btnCond)
        foreach ($btn in $btns) {
            $name = $btn.Current.Name
            if ($Action -eq "Pause" -and ($name -match "Pause" -or $name -match "Resume")) {
                $invoke = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) -as [System.Windows.Automation.InvokePattern]
                if ($invoke) { $invoke.Invoke(); exit }
            }
            if ($Action -eq "Stop" -and $name -match "Stop") {
                $invoke = $btn.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) -as [System.Windows.Automation.InvokePattern]
                if ($invoke) { $invoke.Invoke(); exit }
            }
        }
    }
}
