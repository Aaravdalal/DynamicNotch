using System;
using System.Runtime.InteropServices;
using System.Threading;

class BatteryMonitor
{
    private const int SYSTEM_POWER_STATUS_SIZE = 12; // bytes

    [StructLayout(LayoutKind.Sequential)]
    public struct SYSTEM_POWER_STATUS
    {
        public byte ACLineStatus;
        public byte BatteryFlag;
        public byte BatteryLifePercent;
        public byte SystemStatusFlag;
        public int BatteryLifeTime;
        public int BatteryFullLifeTime;
    }

    [DllImport("kernel32.dll")]
    public static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS sps);

    static void Main(string[] args)
    {
        Console.WriteLine("Battery Monitor Started. Listening for changes...");

        SYSTEM_POWER_STATUS status;
        GetSystemPowerStatus(out status);

        byte lastAcStatus = 255;
        byte lastPercent = 255;
        byte lastSaver = 255;
        bool lastRegistrySaver = false;

        while (true)
        {
            if (GetSystemPowerStatus(out status))
            {
                bool changed = false;

                if (status.ACLineStatus != lastAcStatus)
                {
                    changed = true;
                    lastAcStatus = status.ACLineStatus;
                }

                if (status.BatteryLifePercent != lastPercent)
                {
                    changed = true;
                    lastPercent = status.BatteryLifePercent;
                }
                
                if (status.SystemStatusFlag != lastSaver) 
                {
                    changed = true;
                    lastSaver = status.SystemStatusFlag;
                }

                bool currentRegistrySaver = false;
                try
                {
                    using (Microsoft.Win32.RegistryKey key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Control\Power\User\PowerSchemes"))
                    {
                        if (key != null)
                        {
                            bool isCharging = status.ACLineStatus == 1;
                            string overlay = isCharging 
                                ? (string)key.GetValue("ActiveOverlayAcPowerScheme") 
                                : (string)key.GetValue("ActiveOverlayDcPowerScheme");
                                
                            if (overlay == "961cc777-2547-4f9d-8174-7d86181b8a7a" || overlay == "ded574b5-45a0-4f42-8737-46345c09c238")
                            {
                                currentRegistrySaver = true;
                            }
                        }
                    }
                } 
                catch {}

                if (currentRegistrySaver != lastRegistrySaver)
                {
                    changed = true;
                    lastRegistrySaver = currentRegistrySaver;
                }

                if (changed)
                {
                    bool isCharging = status.ACLineStatus == 1;
                    int percent = status.BatteryLifePercent;
                    bool isSaver = status.SystemStatusFlag == 1 || currentRegistrySaver;
                    
                    if (percent > 100) percent = 100;

                    Console.WriteLine(string.Format("EVENT:{0}|{1}|{2}", 
                        isCharging ? "true" : "false", 
                        percent, 
                        isSaver ? "true" : "false"));
                }
            }

            Thread.Sleep(500); // Check every half second - very cheap in C#
        }
    }
}
