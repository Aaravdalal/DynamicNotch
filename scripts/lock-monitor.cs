using System;
using System.Diagnostics;
using Microsoft.Win32;
using System.Threading;

class LockMonitor
{
    static void Main()
    {
        Console.WriteLine("Lock Monitor Started");
        
        SystemEvents.SessionSwitch += (s, e) =>
        {
            if (e.Reason == SessionSwitchReason.SessionLock)
            {
                Console.WriteLine("EVENT:LOCK");
            }
            else if (e.Reason == SessionSwitchReason.SessionUnlock)
            {
                // Add a tiny delay to let the desktop actually render before firing the animation
                Thread.Sleep(500); 
                Console.WriteLine("EVENT:UNLOCK");
            }
        };

        // Keep the main thread alive indefinitely to listen to the events
        Thread.Sleep(Timeout.Infinite);
    }
}
