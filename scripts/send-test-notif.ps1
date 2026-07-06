# Sends a test notification to the Dynamic Notch Local API
$Payload = @{
    sender = "Aarav"
    text = "Hey, checking if the dynamic notch works!"
    app = "messages"
    time = "now"
}

$Json = $Payload | ConvertTo-Json
$Headers = @{ "Content-Type" = "application/json" }

try {
    Invoke-RestMethod -Uri "http://127.0.0.1:8080/notify" -Method Post -Body $Json -Headers $Headers
    Write-Host "Test notification sent successfully!" -ForegroundColor Green
} catch {
    Write-Host "Failed to send notification: $_" -ForegroundColor Red
}
