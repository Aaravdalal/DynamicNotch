using System;
using System.Runtime.InteropServices;
using System.Threading;
using System.Management;

namespace SysMonitor
{
    class Program
    {
        [ComImport]
        [Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDeviceEnumerator
        {
            [PreserveSig]
            int EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
            [PreserveSig]
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
        }

        [ComImport]
        [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice
        {
            [PreserveSig]
            int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        }

        [ComImport]
        [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioEndpointVolume
        {
            [PreserveSig]
            int RegisterControlChangeNotify(IntPtr pNotify);
            [PreserveSig]
            int UnregisterControlChangeNotify(IntPtr pNotify);
            [PreserveSig]
            int GetChannelCount(out int pnChannelCount);
            [PreserveSig]
            int SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
            [PreserveSig]
            int SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
            [PreserveSig]
            int GetMasterVolumeLevel(out float pfLevelDB);
            [PreserveSig]
            int GetMasterVolumeLevelScalar(out float pfLevel);
            [PreserveSig]
            int SetMute(bool bMute, Guid pguidEventContext);
            [PreserveSig]
            int GetMute(out bool pbMute);
        }

        [StructLayout(LayoutKind.Sequential)]
        struct LASTINPUTINFO
        {
            public uint cbSize;
            public uint dwTime;
        }

        [DllImport("user32.dll")]
        static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);

        [DllImport("ntdll.dll")]
        static extern int NtQueryWnfStateData(ref ulong StateName, int[] TypeId, IntPtr ExplicitScope, out int ChangeStamp, out int Buffer, ref int BufferSize);

        [DllImport("user32.dll")]
        static extern short GetAsyncKeyState(int vKey);

        const int VK_VOLUME_MUTE = 0xAD;
        const int VK_VOLUME_DOWN = 0xAE;
        const int VK_VOLUME_UP = 0xAF;

        static int GetVolume()
        {
            try
            {
                var enumeratorType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
                var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType);
                IMMDevice device;
                enumerator.GetDefaultAudioEndpoint(0, 1, out device);
                if (device == null)
                {
                    return -1;
                }
                
                var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
                object epvObj;
                int hr = device.Activate(ref iid, 23, IntPtr.Zero, out epvObj);
                if (hr != 0) {
                    Console.WriteLine("DEBUG_VOL|Activate failed with hr: " + hr);
                    return -1;
                }
                var epv = (IAudioEndpointVolume)epvObj;
                
                float vol;
                epv.GetMasterVolumeLevelScalar(out vol);
                bool isMuted;
                epv.GetMute(out isMuted);
                
                int volLevel = isMuted ? 0 : (int)Math.Round(vol * 100);
                
                return volLevel;
            }
            catch (Exception e)
            {
                Console.WriteLine("DEBUG_VOL|" + e.Message);
                return -1;
            }
        }

        // Reused across polls — building a ManagementObjectSearcher every tick
        // was the bulk of the query cost and capped how fast we could sample.
        static ManagementObjectSearcher brightSearcher =
            new ManagementObjectSearcher("root\\WMI", "SELECT CurrentBrightness FROM WmiMonitorBrightness");

        static int GetBrightness()
        {
            try
            {
                foreach (ManagementObject queryObj in brightSearcher.Get())
                {
                    return Convert.ToInt32(queryObj["CurrentBrightness"]);
                }
            }
            catch
            {
                return -1;
            }
            return -1;
        }

        static int GetDndState()
        {
            try
            {
                ulong WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED = 0xd83063ea3bf1c75;
                int changeStamp;
                int buffer = 0;
                int bufferSize = 4;
                int status = NtQueryWnfStateData(ref WNF_SHEL_QUIETHOURS_ACTIVE_PROFILE_CHANGED, null, IntPtr.Zero, out changeStamp, out buffer, ref bufferSize);
                if (status == 0) return buffer > 0 ? 1 : 0;
                return -1;
            }
            catch { return -1; }
        }

        [DllImport("user32.dll")]
        public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, int dwExtraInfo);

        static void Main(string[] args)
        {
            if (args.Length >= 1)
            {
                if (args[0] == "winH")
                {
                    keybd_event(0x5B, 0, 0, 0); // WIN down
                    keybd_event(0x48, 0, 0, 0); // H down
                    keybd_event(0x48, 0, 2, 0); // H up
                    keybd_event(0x5B, 0, 2, 0); // WIN up
                    return;
                }
            }

            if (args.Length >= 2)
            {
                string type = args[0];
                int setVal = int.Parse(args[1]);
                if (type == "vol")
                {
                    try
                    {
                        var enumeratorType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
                        var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType);
                        IMMDevice device;
                        enumerator.GetDefaultAudioEndpoint(0, 1, out device);
                        if (device != null)
                        {
                            var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
                            object epvObj;
                            device.Activate(ref iid, 1, IntPtr.Zero, out epvObj);
                            var epv = (IAudioEndpointVolume)epvObj;
                            epv.SetMute(false, Guid.Empty);
                            epv.SetMasterVolumeLevelScalar((float)setVal / 100f, Guid.Empty);
                        }
                    }
                    catch { }
                }
                else if (type == "bright")
                {
                    try
                    {
                        var classInstance = new ManagementClass("root\\WMI", "WmiMonitorBrightnessMethods", null);
                        foreach (ManagementObject instance in classInstance.GetInstances())
                        {
                            object[] inParams = new object[] { 1, setVal };
                            instance.InvokeMethod("WmiSetBrightness", inParams);
                        }
                    }
                    catch { }
                }
                return;
            }

            int lastVol = GetVolume();
            int lastBright = GetBrightness();
            int lastDnd = GetDndState();

            // Brightness is reported the moment it moves. It used to wait for the
            // value to hold steady for ~240ms before deciding whether the change
            // was a key press or an adaptive-brightness ramp, which made the notch
            // appear long after the key — and a fast run of presses looked like a
            // ramp, so it was dropped altogether.

            // Poll fast (60ms) so volume key presses register almost instantly.
            // Volume runs every tick; brightness (WMI) every 2nd tick (~120ms);
            // DND every 8th tick.
            int tick = 0;
            while (true)
            {
                Thread.Sleep(60);
                tick++;

                if ((GetAsyncKeyState(VK_VOLUME_UP) & 1) != 0 ||
                    (GetAsyncKeyState(VK_VOLUME_DOWN) & 1) != 0 ||
                    (GetAsyncKeyState(VK_VOLUME_MUTE) & 1) != 0)
                {
                    Console.WriteLine("VOL_FLYOUT|" + GetVolume());
                }

                int vol = GetVolume();
                if (vol != -1 && vol != lastVol)
                {
                    Console.WriteLine("VOL|" + vol);
                    lastVol = vol;
                }

                // Brightness every tick (~60ms) — emit as soon as it moves so the
                // notch tracks the key rather than trailing it.
                int bright = GetBrightness();
                if (bright != -1 && bright != lastBright)
                {
                    Console.WriteLine("BRIGHT|" + bright);
                    lastBright = bright;
                }

                // DND every 8th tick (~480ms) — it changes rarely.
                if (tick % 8 == 0)
                {
                    int dnd = GetDndState();
                    if (dnd != -1 && dnd != lastDnd)
                    {
                        Console.WriteLine("DND|" + dnd);
                        lastDnd = dnd;
                    }
                }
            }
        }
    }
}
