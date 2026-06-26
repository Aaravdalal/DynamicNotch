using System;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.Diagnostics;

public class HidMonitor : Form {
    [DllImport("user32.dll")]
    public static extern bool RegisterRawInputDevices(RAWINPUTDEVICE[] pRawInputDevices, uint uiNumDevices, uint cbSize);

    [StructLayout(LayoutKind.Sequential)]
    public struct RAWINPUTDEVICE {
        public ushort usUsagePage;
        public ushort usUsage;
        public uint dwFlags;
        public IntPtr hwndTarget;
    }

    public HidMonitor() {
        this.WindowState = FormWindowState.Minimized;
        this.ShowInTaskbar = false;

        RAWINPUTDEVICE[] rid = new RAWINPUTDEVICE[1];
        rid[0].usUsagePage = 0x01; // Generic Desktop
        rid[0].usUsage = 0x02;     // Mouse (Precision touchpads often emulate mouse raw input)
        rid[0].dwFlags = 0x00000100; // RIDEV_INPUTSINK
        rid[0].hwndTarget = this.Handle;
        
        RegisterRawInputDevices(rid, 1, (uint)Marshal.SizeOf(typeof(RAWINPUTDEVICE)));
    }

    protected override void WndProc(ref Message m) {
        if (m.Msg == 0x00FF) { // WM_INPUT
            // Log timestamp or activity to help debugging if needed
            // But for the final product, we just act.
            
            // Check for Task View
            bool isTV = false;
            foreach (Process p in Process.GetProcesses()) {
                if (p.ProcessName == "MultitaskingViewHost" || p.MainWindowTitle == "Task View") {
                    isTV = true;
                    break;
                }
            }

            if (isTV) {
                EmulateClick();
            }
        }
        base.WndProc(ref m);
    }

    [DllImport("user32.dll")]
    static extern void mouse_event(int dwFlags, int dx, int dy, int dwData, int dwExtraInfo);

    void EmulateClick() {
        mouse_event(0x02, 0, 0, 0, 0); // Left down
        mouse_event(0x04, 0, 0, 0, 0); // Left up
    }

    public static void Main() {
        Application.Run(new HidMonitor());
    }
}
