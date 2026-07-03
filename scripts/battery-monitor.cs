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

                if (changed)
                {
                    bool isCharging = status.ACLineStatus == 1;
                    int percent = status.BatteryLifePercent;
                    bool isSaver = status.SystemStatusFlag == 1;
                    
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
