Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, [int]10340)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
foreach ($win in $windows) {
    Write-Output "Found Voice Recorder Window: " $win.Current.Name
    $textEls = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($el in $textEls) {
        if ($el.Current.Name -match "\d{2}:\d{2}") {
            Write-Output ("Time: " + $el.Current.Name)
        }
        if ($el.Current.Name -match "Pause|Resume|Record") {
            Write-Output ("Button: " + $el.Current.Name)
        }
    }
}
