param([string]$Path)

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class FocusWin {
    [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
"@

try {
    $procs = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 -and $_.Path -eq $Path }
    if ($procs) {
        $p = $procs | Select-Object -First 1
        if ([FocusWin]::IsIconic($p.MainWindowHandle)) {
            [FocusWin]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
        }
        [FocusWin]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
        Write-Output "FOCUSED"
        exit
    }
} catch {}

Write-Output "NOTFOUND"
