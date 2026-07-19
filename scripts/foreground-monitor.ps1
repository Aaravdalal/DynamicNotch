param(
  [int]$ExcludePid = -1
)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FgWin {
    [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

$lastPid = -1

while ($true) {
    try {
        $hwnd = [FgWin]::GetForegroundWindow()
        if ($hwnd -ne [IntPtr]::Zero) {
            $procId = 0
            [FgWin]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
            if ($procId -ne 0 -and $procId -ne $lastPid -and $procId -ne $ExcludePid) {
                $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
                if ($proc) {
                    try {
                        $exePath = $proc.MainModule.FileName
                    } catch {
                        $exePath = $null
                    }
                    if ($exePath -and (Test-Path $exePath)) {
                        Write-Host "EVENT:$exePath|$($proc.ProcessName)"
                        $lastPid = $procId
                    }
                }
            }
        }
    } catch {}

    Start-Sleep -Milliseconds 600
}
