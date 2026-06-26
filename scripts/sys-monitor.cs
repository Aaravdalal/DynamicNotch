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
            void EnumAudioEndpoints(int dataFlow, int stateMask, out IntPtr ppDevices);
            int GetDefaultAudioEndpoint(int dataFlow, int role, out IMMDevice ppEndpoint);
        }

        [ComImport]
        [Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IMMDevice
        {
            int Activate(ref Guid iid, int dwClsCtx, IntPtr pActivationParams, [MarshalAs(UnmanagedType.IUnknown)] out object ppInterface);
        }

        [ComImport]
        [Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IAudioEndpointVolume
        {
            void RegisterControlChangeNotify(IntPtr pNotify);
            void UnregisterControlChangeNotify(IntPtr pNotify);
            void GetChannelCount(out int pnChannelCount);
            void SetMasterVolumeLevel(float fLevelDB, Guid pguidEventContext);
            void SetMasterVolumeLevelScalar(float fLevel, Guid pguidEventContext);
            int GetMasterVolumeLevel(out float pfLevelDB);
            int GetMasterVolumeLevelScalar(out float pfLevel);
            void SetMute(bool bMute, Guid pguidEventContext);
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

        static int GetVolume()
        {
            try
            {
                var enumeratorType = Type.GetTypeFromCLSID(new Guid("BCDE0395-E52F-467C-8E3D-C4579291692E"));
                var enumerator = (IMMDeviceEnumerator)Activator.CreateInstance(enumeratorType);
                IMMDevice device;
                enumerator.GetDefaultAudioEndpoint(0, 1, out device);
                if (device == null) return -1;
                
                var iid = new Guid("5CDF2C82-841E-4546-9722-0CF74078229A");
                object epvObj;
                device.Activate(ref iid, 1, IntPtr.Zero, out epvObj);
                var epv = (IAudioEndpointVolume)epvObj;
                float vol;
                epv.GetMasterVolumeLevelScalar(out vol);
                bool isMuted;
                epv.GetMute(out isMuted);
                
                if (isMuted) return 0;
                return (int)Math.Round(vol * 100);
            }
            catch
            {
                return -1;
            }
        }

        static int GetBrightness()
        {
            try
            {
                var searcher = new ManagementObjectSearcher("root\\WMI", "SELECT * FROM WmiMonitorBrightness");
                foreach (ManagementObject queryObj in searcher.Get())
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

        static void Main(string[] args)
        {
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

            while (true)
            {
                Thread.Sleep(250);

                LASTINPUTINFO lastInput = new LASTINPUTINFO();
                lastInput.cbSize = (uint)Marshal.SizeOf(lastInput);
                GetLastInputInfo(ref lastInput);
                
                bool isUserActive = (Environment.TickCount - lastInput.dwTime) < 15000;

                int dnd = GetDndState();
                if (dnd != -1 && dnd != lastDnd)
                {
                    Console.WriteLine("DND|" + dnd);
                    lastDnd = dnd;
                }

                int vol = GetVolume();
                if (vol != -1 && vol != lastVol)
                {
                    Console.WriteLine("VOL|" + vol);
                    lastVol = vol;
                }

                int bright = GetBrightness();
                if (bright != -1 && bright != lastBright)
                {
                    if (isUserActive)
                    {
                        if (Math.Abs(bright - lastBright) >= 3) 
                        {
                            Console.WriteLine("BRIGHT|" + bright);
                        }
                    }
                    lastBright = bright;
                }
            }
        }
    }
}
