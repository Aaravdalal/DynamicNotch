Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Window {
    public delegate bool WindowEnumProc(IntPtr hwnd, IntPtr lparam);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumWindows(WindowEnumProc lpEnumFunc, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowTextLength(IntPtr hWnd);

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    public static extern int GetWindowText(IntPtr hWnd, StringBuilder lpString, int nMaxCount);

    [DllImport("user32.dll")]
    public static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);

    public static string GetWindows() {
        StringBuilder result = new StringBuilder();
        EnumWindows((hWnd, lParam) => {
            if (IsWindowVisible(hWnd)) {
                int length = GetWindowTextLength(hWnd);
                if (length > 0) {
                    StringBuilder builder = new StringBuilder(length + 1);
                    GetWindowText(hWnd, builder, builder.Capacity);
                    string title = builder.ToString();
                    
                    uint pid = 0;
                    GetWindowThreadProcessId(hWnd, out pid);
                    
                    try {
                        var proc = System.Diagnostics.Process.GetProcessById((int)pid);
                        result.AppendLine("UPDATE|" + proc.ProcessName + "|" + title);
                    } catch {
                        result.AppendLine("UPDATE|Unknown|" + title);
                    }
                }
            }
            return true;
        }, IntPtr.Zero);
        return result.ToString();
    }
}
"@

while ($true) {
    try {
        $windows = [Window]::GetWindows()
        Write-Output $windows
        
        $spotify = Get-Process -Name Spotify -ErrorAction SilentlyContinue
        if ($spotify) {
            Write-Output "UPDATE|Spotify|Spotify"
        }
    } catch {}
    Start-Sleep -Seconds 2
}
