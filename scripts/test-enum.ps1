Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Text;
public class Window {
    [DllImport("user32.dll")]
    public static extern bool EnumVisibleWindows(IntPtr hWnd, int lParam);
    
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

    public static void ListWindows() {
        EnumWindows(new WindowEnumProc(EnumWindow), IntPtr.Zero);
    }

    private static bool EnumWindow(IntPtr hWnd, IntPtr lParam) {
        if (IsWindowVisible(hWnd)) {
            int length = GetWindowTextLength(hWnd);
            if (length > 0) {
                StringBuilder builder = new StringBuilder(length + 1);
                GetWindowText(hWnd, builder, builder.Capacity);
                Console.WriteLine("WIN|" + builder.ToString());
            }
        }
        return true;
    }
}
"@
[Window]::ListWindows()
