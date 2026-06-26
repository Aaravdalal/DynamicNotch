Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { "$($_.ProcessName)|$($_.MainWindowTitle)" }
