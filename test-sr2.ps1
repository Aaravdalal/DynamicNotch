Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ProcessIdProperty, (Get-Process SoundRecorder -ErrorAction SilentlyContinue).Id)
$windows = $root.FindAll([System.Windows.Automation.TreeScope]::Children, $cond)
foreach ($win in $windows) {
    Write-Output "Found Sound Recorder Window"
    $textEls = $win.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($el in $textEls) {
        if ($el.Current.Name -match "\d{2}:\d{2}:\d{2}") {
            Write-Output ("Time: " + $el.Current.Name)
        }
    }
}
