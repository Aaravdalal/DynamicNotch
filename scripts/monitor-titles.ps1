# Robust Window Monitor
Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
using System.Collections.Generic;

public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);
    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@

$callback = {
    param($hwnd, $lparam)
    if ([Win32]::IsWindowVisible($hwnd)) {
        $sb = New-Object System.Text.StringBuilder 256
        [void][Win32]::GetWindowText($hwnd, $sb, $sb.Capacity)
        $title = $sb.ToString()
        if ($title) {
            $pid = 0
            [Win32]::GetWindowThreadProcessId($hwnd, [ref]$pid)
            try {
                $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
                if ($proc) {
                    Write-Output "UPDATE|$($proc.ProcessName)|$title"
                }
            } catch {}
        }
    }
    return $true
}

$procDelegate = New-Object Win32+EnumWindowsProc -ArgumentList $callback

while ($true) {
    try {
        [Win32]::EnumWindows($procDelegate, [IntPtr]::Zero)
    } catch {}
    Start-Sleep -Seconds 2
}
