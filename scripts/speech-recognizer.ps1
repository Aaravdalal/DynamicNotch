Add-Type -AssemblyName System.Speech
$recognizer = New-Object System.Speech.Recognition.SpeechRecognitionEngine
$recognizer.SetInputToDefaultAudioDevice()
$gram = New-Object System.Speech.Recognition.DictationGrammar
$recognizer.LoadGrammar($gram)

try {
    # Listen for up to 6 seconds for a phrase
    $result = $recognizer.Recognize((New-Object System.TimeSpan(0, 0, 6)))
    if ($result -ne $null) {
        Write-Output "RESULT:$($result.Text)"
    } else {
        Write-Output "RESULT:"
    }
} catch {
    Write-Output "ERROR: $_"
}
