Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ClassNameProperty, "ApplicationFrameWindow")
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
foreach ($win in $windows) {
    Write-Output "App Frame Window: " $win.Current.Name
    if ($win.Current.Name -match "Recorder|Project Llama") {
        Write-Output "Found matching window!"
        $textEls = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
        foreach ($el in $textEls) {
            Write-Output ("Element: " + $el.Current.Name + " (" + $el.Current.ControlType.ProgrammaticName + ")")
        }
    }
}
