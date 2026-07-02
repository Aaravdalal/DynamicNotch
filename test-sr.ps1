Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "ApplicationFrameWindow")
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
foreach ($win in $windows) {
    if ($win.Current.Name -match "Sound Recorder") {
        Write-Output "Found Sound Recorder"
        $textEls = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($el in $textEls) {
            if ($el.Current.Name -match "\d{2}:\d{2}:\d{2}") {
                Write-Output ("Time: " + $el.Current.Name)
            }
        }
    }
}
