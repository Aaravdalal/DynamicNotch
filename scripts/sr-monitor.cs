using System;
using System.Diagnostics;
using System.Windows.Automation;
using System.Threading;
using System.Runtime.InteropServices;

namespace SRMonitor
{
    class Program
    {
        [DllImport("user32.dll")]
        static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll", SetLastError = true)]
        static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

        static void Main(string[] args)
        {
            if (args.Length > 0 && args[0] == "toggle")
            {
                var procs = Process.GetProcessesByName("VoiceRecorder");
                if (procs.Length > 0)
                {
                    SetForegroundWindow(procs[0].MainWindowHandle);
                    Thread.Sleep(50);
                    keybd_event(0x20, 0, 0, 0); // Space down
                    keybd_event(0x20, 0, 2, 0); // Space up
                }
                return;
            }

            while (true)
            {
                Thread.Sleep(100);
                
                if (Console.KeyAvailable)
                {
                    var key = Console.ReadKey(true).KeyChar;
                    if (key == 't') 
                    {
                        var procs = Process.GetProcessesByName("VoiceRecorder");
                        if (procs.Length > 0)
                        {
                            SetForegroundWindow(procs[0].MainWindowHandle);
                            Thread.Sleep(50);
                            keybd_event(0x20, 0, 0, 0); // Space down
                            keybd_event(0x20, 0, 2, 0); // Space up
                        }
                    }
                }

                var vrs = Process.GetProcessesByName("VoiceRecorder");
                if (vrs.Length == 0)
                {
                    Console.WriteLine("NONE");
                    continue;
                }

                var proc = vrs[0];
                var root = AutomationElement.RootElement;
                var cond = new PropertyCondition(AutomationElement.ProcessIdProperty, proc.Id);
                var win = root.FindFirst(TreeScope.Children, cond);
                
                if (win == null)
                {
                    Console.WriteLine("NONE");
                    continue;
                }

                var textCond = new PropertyCondition(AutomationElement.ControlTypeProperty, ControlType.Text);
                var els = win.FindAll(TreeScope.Descendants, textCond);
                
                string timeStr = null;
                bool isPaused = false;
                
                foreach (AutomationElement el in els)
                {
                    string name = el.Current.Name;
                    if (System.Text.RegularExpressions.Regex.IsMatch(name, @"^\d{2}:\d{2}:\d{2}\.\d{2}$") || 
                        System.Text.RegularExpressions.Regex.IsMatch(name, @"^\d{2}:\d{2}:\d{2}$"))
                    {
                        timeStr = name;
                    }
                    if (name.IndexOf("Resume", StringComparison.OrdinalIgnoreCase) >= 0)
                    {
                        isPaused = true;
                    }
                }

                if (timeStr != null)
                {
                    Console.WriteLine("RECORDING:" + timeStr + ":" + (isPaused ? "PAUSED" : "ACTIVE"));
                }
                else
                {
                    Console.WriteLine("NONE");
                }
            }
        }
    }
}
