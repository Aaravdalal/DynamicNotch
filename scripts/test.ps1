Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$spotify = Get-Process Spotify -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1

if (-not $spotify) {
    Write-Output ""
    exit
}

$rootElement = [System.Windows.Automation.AutomationElement]::FromHandle($spotify.MainWindowHandle)

# Find all text elements in the Spotify window
$condition = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Text)
$textElements = $rootElement.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)

# In Spotify's UI, the song title and artist are usually among the first few distinct text elements in the playback bar.
# Alternatively, checking for the "Now playing" region if accessible.
$texts = @()
foreach ($element in $textElements) {
    $name = $element.Current.Name
    if (-not [string]::IsNullOrWhiteSpace($name) -and $name -ne "Spotify Free" -and $name -ne "Spotify Premium") {
        $texts += $name
    }
}

# Dump all texts found to see where the song is
$texts | ConvertTo-Json
